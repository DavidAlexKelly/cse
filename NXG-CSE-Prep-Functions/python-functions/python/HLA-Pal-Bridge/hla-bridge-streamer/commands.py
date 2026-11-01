# commands.py
"""
Command stream consumer.

Polls the command stream, executes each command against the local bridge REST
API, and publishes the outcome to the command log stream. Written by the command
gateway compute module, which validates and queues; nothing here trusts that a
queued command is a valid one.

Sibling of tracks.py by design: its own daemon thread, its own start()/status(),
so a slow bridge call never stalls situational-awareness publishing. Credentials,
base URL, TLS trust and alias resolution are imported from tracks rather than
reimplemented.

Replay safety rests on two mechanisms. The primary one is TTL: a record older
than its ttl_seconds is dropped, which is why a replayed DISCONNECT cannot
resign the federate every time the container starts - control commands carry
a short TTL for exactly that reason. The secondary one is a bounded LRU of
seen command ids, kept in memory and lost on restart, which is precisely why
TTL has to be the primary defence and not the other way round.

A queued command is not an executed one, and an executed one is not an accepted
one: the bridge returning 200 means the interaction went on the wire, not that a
federate acted on it. Both distinctions are recorded in the outcome stream, which
is the only durable record of what was commanded - BridgeDiagnostics keeps just
50 tasks in memory and loses them on restart.
"""

import json
import logging
import os
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone

import httpx

import tracks

log = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

BRIDGE_URL = os.environ.get("BRIDGE_URL", "http://localhost:8080/api/v1/bridge")
BRIDGE_TIMEOUT = float(os.environ.get("COMMAND_BRIDGE_TIMEOUT_SECONDS", "15"))
POLL_SECONDS = float(os.environ.get("COMMAND_POLL_SECONDS", "1.0"))

COMMAND_STREAM_ALIAS = os.environ.get("COMMAND_STREAM_ALIAS", "hla-command-stream").strip()
COMMAND_STREAM_RID_ENV = os.environ.get("COMMAND_STREAM_RID", "").strip()
COMMAND_STREAM_BRANCH_ENV = os.environ.get("COMMAND_STREAM_BRANCH", "master").strip()

COMMAND_LOG_ALIAS = os.environ.get("COMMAND_LOG_ALIAS", "hla-command-log").strip()
COMMAND_LOG_RID_ENV = os.environ.get("COMMAND_LOG_RID", "").strip()
COMMAND_LOG_BRANCH_ENV = os.environ.get("COMMAND_LOG_BRANCH", "master").strip()

# Stages that mean a command has been finally decided. DEFERRED is deliberately
# absent: a deferred command is held in memory only, so after a restart it must
# be re-read and re-deferred rather than treated as already handled.
TERMINAL_STAGES = frozenset({"SENT", "REFUSED", "FAILED", "EXPIRED", "DUPLICATE"})

SEEN_CAPACITY = int(os.environ.get("COMMAND_SEEN_CAPACITY", "5000"))
DEFERRED_CAPACITY = int(os.environ.get("COMMAND_DEFERRED_CAPACITY", "1000"))

COMMAND_RID, COMMAND_BRANCH, COMMAND_SOURCE = tracks.resolve_alias(
    COMMAND_STREAM_ALIAS, COMMAND_STREAM_RID_ENV, COMMAND_STREAM_BRANCH_ENV
)
LOG_RID, LOG_BRANCH, LOG_SOURCE = tracks.resolve_alias(COMMAND_LOG_ALIAS, COMMAND_LOG_RID_ENV, COMMAND_LOG_BRANCH_ENV)

_bridge = httpx.Client(timeout=BRIDGE_TIMEOUT)
_stop = threading.Event()
_lock = threading.Lock()
_seen: "OrderedDict[str, float]" = OrderedDict()
_deferred: list[dict] = []
_shape_logged = False

_state = {
    "running": False,
    "polls": 0,
    "handled": 0,
    "sent": 0,
    "refused": 0,
    "expired": 0,
    "duplicates": 0,
    "deferred": 0,
    "malformed": 0,
    # command_ids reconstructed from the outcome stream at startup.
    "primed": 0,
    # Records re-read after already being decided. The stream-proxy records
    # endpoint returns the whole stream each poll, so this climbs steadily and is
    # expected; it is the signal that no cursor is being honoured.
    "repeats": 0,
    "poll_failures": 0,
    "outcome_failures": 0,
    # Answers carried back from the federation. `acknowledged` counts rows
    # published; `unacknowledged` is the bridge's own count of tasks it sent that
    # nothing has answered — the number to watch when tasks look accepted but
    # nothing moves.
    "acknowledged": 0,
    "unacknowledged": None,
    "ack_poll_failures": 0,
    "last_command_at": None,
    "last_error": None,
}


def _iso(when: datetime) -> str:
    """ISO-8601 UTC, milliseconds, Z — the format tracks.py already publishes."""
    return when.isoformat(timespec="milliseconds").replace("+00:00", "Z")


# ── Bridge routing ────────────────────────────────────────────────────────────
#
# Field names are verified against cse-hla-bridge's request model classes,
# since none of the translations here are guessable: FireAtEntityRequest
# names its field targetId rather than target or targetUuid; ObstacleRequest
# and DisruptCommsRequest both name the taskee entityId; ObstacleRequest
# takes radiusMeters while DisruptCommsRequest takes radiusKm, and passing
# kilometres to the obstacle endpoint silently creates a half-metre obstacle,
# which looks exactly like the simulator ignoring the command; and
# RoeRequest documents lowercase enumerators such as hold_fire, return_fire
# and fire_at_will.
#
# The gateway's wire vocabulary is deliberately dialect- and bridge-neutral -
# uppercase enums, radiusKm everywhere, per-waypoint speed. This function is
# the only place that knows the bridge's actual shapes, so a bridge API change
# touches one file.

_ENTITY_PATHS = {
    "MOVE": "move",
    "PATROL": "patrol",
    "MAGIC_MOVE": "magic-move",
    "FIRE_AT_LOCATION": "fire-at-location",
    "FIRE_AT_ENTITY": "fire-at-entity",
    "ROE": "roe",
    "CANCEL_TASKS": "cancel-tasks",
    "CHANGE_HEADING": "heading",
    "CHANGE_SPEED": "speed",
    "CHANGE_ALTITUDE": "altitude",
    "STOP_AT_SIDE_OF_ROAD": "stop",
    "INJECT_SUPPLIES": "inject-supplies",
    "AGGREGATE": "aggregate",
    "DISAGGREGATE": "disaggregate",
}

# Control and simulation operations address the federate, not an entity.
# CONNECT, DISCONNECT and RECONNECT need a bridge image that exposes those
# routes; until then they return 404 and are recorded as REFUSED rather than
# failing the loop.
#
# CONNECT and RECONNECT deliberately share an endpoint. The bridge's run loop
# services a first join and a rejoin identically — requestRejoin() only cares
# that no ambassador is currently held — so there is no second route to call.
# They stay distinct operations because the command stream is the audit trail,
# and a CONNECT that opens an exercise should not read as a recovery from a
# dropped session.
_CONTROL_PATHS = {
    "SIM_START": "start",
    "SIM_PAUSE": "pause",
    "SIM_STOP": "stop",
    "CONNECT": "reconnect",
    "DISCONNECT": "disconnect",
    "RECONNECT": "reconnect",
}


def _as_int(value, default=None):
    """The Java records type durations as Integer; a float would be rejected."""
    return default if value is None else int(round(float(value)))


def _route(operation: str, entity_uuid, params: dict) -> tuple[str, dict]:
    """The bridge URL and request body for one command."""
    if operation in _ENTITY_PATHS:
        if not entity_uuid:
            raise ValueError(f"{operation} requires entity_uuid")
        body = dict(params)

        if operation == "FIRE_AT_ENTITY":
            body = {"targetId": params.get("targetUuid")}
            if params.get("durationSeconds") is not None:
                body["durationSeconds"] = _as_int(params["durationSeconds"])

        elif operation == "FIRE_AT_LOCATION":
            body["durationSeconds"] = _as_int(params.get("durationSeconds"), 0)

        elif operation == "ROE":
            body["roe"] = str(params.get("roe", "")).lower()

        elif operation == "PATROL":
            # Waypoint is (latitude, longitude, altitudeMeters) — there is no
            # per-waypoint speed on the bridge, so lift the first one we were
            # given to the top level rather than dropping it silently.
            speed = params.get("speedMetersPerSecond")
            points = []
            for point in params.get("waypoints", []):
                speed = speed or point.get("speedMetersPerSecond")
                points.append(
                    {
                        "latitude": point["latitude"],
                        "longitude": point["longitude"],
                        "altitudeMeters": point.get("altitudeMeters"),
                    }
                )
            body = {
                "waypoints": points,
                "patrolType": params.get("patrolType"),
                "moveType": params.get("moveType"),
                "durationSeconds": _as_int(params.get("durationSeconds")),
                "intervalSeconds": _as_int(params.get("intervalSeconds")),
                "speedMetersPerSecond": speed,
            }

        return f"{BRIDGE_URL}/entities/{entity_uuid}/{_ENTITY_PATHS[operation]}", body

    if operation == "CREATE_OBSTACLE":
        return f"{BRIDGE_URL}/map/obstacle", {
            "type": params.get("obstacleType"),
            "obstacleType": params.get("obstacleType"),
            "latitude": params["latitude"],
            "longitude": params["longitude"],
            "entityId": entity_uuid,
            # radiusMeters here, radiusKm on disrupt-comms. Not a typo.
            "radiusMeters": float(params.get("radiusKm", 0.5)) * 1000.0,
        }

    if operation == "DISRUPT_COMMS":
        return f"{BRIDGE_URL}/map/disrupt-comms", {
            "latitude": params["latitude"],
            "longitude": params["longitude"],
            "radiusKm": params["radiusKm"],
            "enabled": bool(params.get("enabled", True)),
            "entityId": entity_uuid,
            "network": params.get("network"),
        }

    if operation in _CONTROL_PATHS:
        return f"{BRIDGE_URL}/{_CONTROL_PATHS[operation]}", dict(params)

    raise ValueError(f"unknown operation {operation!r}")


# ── Record handling ───────────────────────────────────────────────────────────


def _parse_time(value):
    if not value:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000.0, tz=timezone.utc)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _first_sighting(command_id: str) -> bool:
    with _lock:
        if command_id in _seen:
            _seen.move_to_end(command_id)
            return False
        _seen[command_id] = time.time()
        while len(_seen) > SEEN_CAPACITY:
            _seen.popitem(last=False)
        return True


def handle_record(record: dict, from_deferred: bool = False) -> dict | None:
    """
    Execute one command record. Never raises: every outcome is a log row.

    Returns the outcome to publish, or None when the record has already been
    decided and must be ignored silently.

    The seen-check runs FIRST, before the TTL check, and that ordering matters.
    The stream-proxy records endpoint returns the whole stream on every poll
    rather than only what is new, so every record is re-read once per second. An
    earlier version checked TTL first, so expired records never entered the seen
    set, were re-decided on every poll, and published a fresh EXPIRED row each
    time — thousands of identical outcomes for a handful of stale commands.

    Deciding each command_id exactly once makes the consumer idempotent with
    respect to re-reads, whatever the endpoint returns.
    """
    command_id = record.get("command_id") or "unknown"
    operation = record.get("operation") or "UNKNOWN"
    entity_uuid = record.get("entity_uuid")
    now = datetime.now(timezone.utc)

    def outcome(stage, http_status=None, task_id=None, dialect=None, fom_class=None, detail=None) -> dict:
        return {
            "command_id": command_id,
            "correlation_id": record.get("correlation_id") or command_id,
            "observed_at": _iso(now),
            "stage": stage,
            "operation": operation,
            "entity_uuid": entity_uuid,
            "http_status": http_status,
            "task_id": task_id,
            "dialect": dialect,
            "fom_class": fom_class,
            "detail": detail,
        }

    # Decide each command_id once. A re-read is silent, not another log row.
    if not from_deferred and not _first_sighting(command_id):
        _state["repeats"] += 1
        return None

    # Held for later: keep it in memory so it survives the re-read suppression,
    # and report DEFERRED once.
    not_before = _parse_time(record.get("not_before"))
    if not_before and not_before > now:
        with _lock:
            if len(_deferred) < DEFERRED_CAPACITY:
                _deferred.append(record)
                _state["deferred"] = len(_deferred)
        return outcome("DEFERRED", detail=f"held until {_iso(not_before)}")

    issued_at = _parse_time(record.get("issued_at"))
    ttl = record.get("ttl_seconds")
    if issued_at and ttl:
        age = (now - issued_at).total_seconds()
        if age > float(ttl):
            _state["expired"] += 1
            log.info("Dropping %s %s: %.1fs old, ttl %ss", operation, command_id, age, ttl)
            return outcome("EXPIRED", detail=f"{age:.1f}s old, ttl {ttl}s")

    try:
        params = record.get("params")
        params = json.loads(params) if isinstance(params, str) else (params or {})
        url, body = _route(operation, entity_uuid, params)
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        _state["last_error"] = str(exc)
        return outcome("FAILED", detail=f"could not route: {type(exc).__name__}: {exc}")

    try:
        response = _bridge.post(url, json=body)
    except httpx.HTTPError as exc:
        _state["last_error"] = str(exc)
        return outcome("FAILED", detail=f"{type(exc).__name__}: {exc}")

    try:
        payload = response.json()
    except ValueError:
        payload = {}

    _state["handled"] += 1
    _state["last_command_at"] = _iso(now)

    if response.status_code >= 400:
        # The distinctions a queued design would otherwise throw away:
        # 404 entity unknown, 409 class absent from the FOM or no tasking
        # dialect, 503 RTI unreachable.
        _state["refused"] += 1
        log.warning(
            "Bridge refused %s %s: HTTP %s %s", operation, command_id, response.status_code, response.text[:200]
        )
        return outcome("REFUSED", http_status=response.status_code, detail=response.text[:400])

    _state["sent"] += 1
    return outcome(
        "SENT",
        http_status=response.status_code,
        task_id=payload.get("taskId"),
        dialect=payload.get("dialect"),
        fom_class=payload.get("task"),
        detail=payload.get("status"),
    )


def drain_deferred() -> list[dict]:
    """Records whose not_before has arrived. Called once per tick."""
    now = datetime.now(timezone.utc)
    ready, holding = [], []
    with _lock:
        for record in _deferred:
            when = _parse_time(record.get("not_before"))
            (ready if (when is None or when <= now) else holding).append(record)
        _deferred[:] = holding
        _state["deferred"] = len(_deferred)
    return ready


# ── Stream transport ──────────────────────────────────────────────────────────
#
# stream-proxy, per the platform's compute module documentation:
#   GET  /stream-proxy/api/streams/{rid}/branches/{branch}/records
#   POST /stream-proxy/api/streams/{rid}/branches/{branch}/jsonRecord
#
# The GET response shape is logged once on the first non-empty poll so it can be
# pinned rather than inferred from a parse failure at 1 Hz.


def _records_url() -> str:
    return f"{tracks.base_url()}/stream-proxy/api/streams/{COMMAND_RID}/branches/{COMMAND_BRANCH}/records"


def _json_record_url() -> str:
    return f"{tracks.base_url()}/stream-proxy/api/streams/{LOG_RID}/branches/{LOG_BRANCH}/jsonRecord"


def _is_command(record) -> bool:
    """
    Whether this looks like a command at all.

    Anything without both fields is not ours: a proxy envelope, an offset marker,
    or records from a different stream because the alias resolved elsewhere.
    Passing one to handle_record() is worse than dropping it — the record has no
    command_id, so every one after the first collapses onto the same dedupe key
    and the command log fills with identical DUPLICATE rows saying nothing.
    """
    return isinstance(record, dict) and bool(record.get("command_id")) and bool(record.get("operation"))


# Per-record envelopes the proxy may use. The value may itself be a JSON string.
_PAYLOAD_KEYS = ("value", "payload", "record", "data", "json", "body")


def _unwrap(item):
    """A command record from an item that may be wrapped, or None."""
    if not isinstance(item, dict):
        return None
    if _is_command(item):
        return item
    for key in _PAYLOAD_KEYS:
        inner = item.get(key)
        if isinstance(inner, str):
            try:
                inner = json.loads(inner)
            except ValueError:
                continue
        if _is_command(inner):
            return inner
    return None


def _items(payload) -> list:
    """The record list inside whichever envelope the proxy returns."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("records", "values", "data", "results", "items"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
        return [payload]
    return []


def _extract(payload) -> list[dict]:
    """
    Command records from whichever envelope the proxy returns.

    Deliberately strict. An earlier version fell back to treating the whole
    response body as a single record, which turned a misconfigured alias into an
    endless stream of meaningless outcomes rather than one clear error.
    """
    global _shape_logged

    items = _items(payload)
    records, rejected = [], []
    for item in items:
        unwrapped = _unwrap(item)
        (records if unwrapped is not None else rejected).append(unwrapped if unwrapped is not None else item)

    if rejected:
        _state["malformed"] += len(rejected)
        # One sample, once. The shape of a rejected record is the whole diagnosis:
        # entity-track fields mean the alias points at the wrong stream; an
        # unfamiliar wrapper means _PAYLOAD_KEYS needs another entry.
        if not _shape_logged:
            sample = rejected[0]
            log.warning(
                "Discarding %d record(s) from %s with no command_id/operation. "
                "Sample keys: %s. Sample (truncated): %s. If these look like entity "
                "tracks, the command stream alias is resolving to the wrong stream; "
                "if it is an unfamiliar envelope, add its key to _PAYLOAD_KEYS.",
                len(rejected),
                COMMAND_RID,
                sorted(sample) if isinstance(sample, dict) else type(sample).__name__,
                json.dumps(sample, default=str)[:600],
            )
            _shape_logged = True

    if records and not _shape_logged:
        log.info(
            "Command stream parsed: first command_id=%s operation=%s",
            records[0].get("command_id"),
            records[0].get("operation"),
        )
        _shape_logged = True

    return records


def _fetch(client: httpx.Client) -> list[dict]:
    response = client.get(
        _records_url(),
        headers={"Authorization": f"Bearer {tracks.bearer_token(client)}"},
    )
    if response.status_code == 204 or not response.content:
        return []
    if response.status_code >= 400:
        raise RuntimeError(f"HTTP {response.status_code}: {response.text[:300]}")
    text = response.text.strip()
    try:
        return _extract(response.json())
    except ValueError:
        # Newline-delimited JSON is the other common shape.
        records = []
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
            except ValueError:
                continue
            if isinstance(parsed, dict):
                records.append(parsed)
        return records


def _prime_seen(client: httpx.Client) -> None:
    """
    Rebuild the decided-set from the outcome stream before the first poll.

    The records endpoint replays the whole command stream on every poll and the
    seen-set is in memory, so without this a restart re-decides the entire
    backlog and writes a duplicate outcome for every record — the behaviour that
    filled the log with identical EXPIRED rows.

    The outcome stream is the durable record of what has already been decided,
    so it is the right thing to reconcile against. That is strictly better than
    inferring it from record age: age says nothing about whether a command was
    handled, and a planned order whose not_before has passed during an outage is
    legitimately old and must still run.

    Only TERMINAL_STAGES are seeded. A DEFERRED command was held in memory that
    is now gone, so it has to be re-read and re-deferred rather than skipped.

    Best-effort: if the outcome stream cannot be read, the consumer still starts.
    The cost is duplicate outcome rows for already-decided commands, which is
    noisy but not harmful — and far better than dropping live commands.
    """
    if not LOG_RID:
        log.warning(
            "No outcome stream, so the decided-set cannot be restored. "
            "Commands already handled before this restart will be "
            "decided again and produce duplicate outcome rows."
        )
        return
    try:
        response = client.get(
            f"{tracks.base_url()}/stream-proxy/api/streams/{LOG_RID}/branches/{LOG_BRANCH}/records",
            headers={"Authorization": f"Bearer {tracks.bearer_token(client)}"},
        )
        if response.status_code >= 400:
            raise RuntimeError(f"HTTP {response.status_code}: {response.text[:200]}")
        payload = response.json() if response.content else []
    except Exception as exc:  # noqa: BLE001 - never fatal, always explained
        log.warning(
            "Could not read the outcome stream to restore the "
            "decided-set (%s: %s). Already-handled commands will be "
            "decided again.",
            type(exc).__name__,
            exc,
        )
        return

    restored = 0
    with _lock:
        for item in _items(payload):
            if not isinstance(item, dict):
                continue
            entry = item
            if not entry.get("command_id"):
                for key in _PAYLOAD_KEYS:
                    inner = entry.get(key)
                    if isinstance(inner, str):
                        try:
                            inner = json.loads(inner)
                        except ValueError:
                            continue
                    if isinstance(inner, dict) and inner.get("command_id"):
                        entry = inner
                        break
            command_id = entry.get("command_id")
            if command_id and entry.get("stage") in TERMINAL_STAGES:
                if command_id not in _seen:
                    _seen[command_id] = time.time()
                    restored += 1
        while len(_seen) > SEEN_CAPACITY:
            _seen.popitem(last=False)

    _state["primed"] = restored
    log.info(
        "Restored %d already-decided command(s) from the outcome stream; they will be ignored rather than re-reported.",
        restored,
    )


# ── Acknowledgements ──────────────────────────────────────────────────────────
#
# A SENT row means the bridge dispatched an interaction. It does not mean any
# federate acted on it, and the two are not close: a task addressed to a UUID no
# federate owns is dispatched perfectly and ignored silently, which reads as
# success everywhere a human looks.
#
# The bridge already knows better. It subscribes to ETR_TaskStatus and
# SMC_Response and records them against the taskId it generated
# (BridgeDiagnostics.recordAcknowledgement), exposing the result at
# /diagnostics/tasks. But that history is in memory, in that process, reachable
# only from inside the pod — so the one fact worth having never left the
# container.
#
# These maps carry it out: _TASK_CONTEXT remembers which command a taskId
# belonged to, and _ACKS_SEEN how many of its acknowledgements have already been
# published, so each is reported exactly once.
ACK_CONTEXT_CAPACITY = int(os.environ.get("COMMAND_ACK_CAPACITY", "2000"))
# How often to log the acknowledgement counters. Frequent enough to see during a
# test, rare enough not to fill the log at a 1s poll.
ACK_HEARTBEAT_SECONDS = float(os.environ.get("COMMAND_ACK_HEARTBEAT_SECONDS", "60"))
_TASK_CONTEXT: "OrderedDict[str, dict]" = OrderedDict()
_ACKS_SEEN: "OrderedDict[str, int]" = OrderedDict()


def _remember_task(outcome: dict) -> None:
    """Keep the command context for a taskId so its answer can be attributed."""
    task_id = outcome.get("task_id")
    if not task_id:
        return
    _TASK_CONTEXT[task_id] = {
        "command_id": outcome.get("command_id"),
        "correlation_id": outcome.get("correlation_id"),
        "operation": outcome.get("operation"),
        "entity_uuid": outcome.get("entity_uuid"),
        "dialect": outcome.get("dialect"),
        "fom_class": outcome.get("fom_class"),
    }
    _TASK_CONTEXT.move_to_end(task_id)
    while len(_TASK_CONTEXT) > ACK_CONTEXT_CAPACITY:
        evicted, _ = _TASK_CONTEXT.popitem(last=False)
        _ACKS_SEEN.pop(evicted, None)


def poll_acknowledgements(client: httpx.Client) -> None:
    """
    Publish anything the federation has said about tasks we sent.

    Runs every cycle and is cheap: /diagnostics/tasks is an in-memory read, and
    with no tasks sent yet it is skipped entirely.

    Never raises. A bridge that is down or an image without the route leaves the
    counters flat rather than stopping the consumer — the same policy as the
    command poll itself.
    """
    if not _TASK_CONTEXT:
        return
    # _bridge, not the Foundry client: the bridge is plain HTTP on localhost and
    # carries the command timeout, where `client` is built for Foundry with the
    # rubix CA bundle and its own defaults.
    try:
        response = _bridge.get(f"{BRIDGE_URL}/diagnostics/tasks")
        if response.status_code >= 400:
            _state["ack_poll_failures"] += 1
            return
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:  # noqa: BLE001 - never fatal
        _state["ack_poll_failures"] += 1
        _state["last_error"] = f"ack poll: {type(exc).__name__}: {exc}"
        return

    # Periodic proof-of-life for this whole path.
    #
    # An absent ACKNOWLEDGED row has three causes that look identical from the
    # outcome stream: nothing answered, something answered but the bridge could
    # not attribute it to a task, or this poll is failing. The counters separate
    # them. `sentThisSession` climbing while `unacknowledged` tracks it means
    # nothing is answering; a non-zero ETR_TaskStatus/SMC_Response receive count
    # alongside that means answers are arriving and correlation is the problem.
    heartbeat_due = time.monotonic() - _state.get("ack_heartbeat_at", 0.0)
    if heartbeat_due >= ACK_HEARTBEAT_SECONDS:
        _state["ack_heartbeat_at"] = time.monotonic()
        try:
            traffic = _bridge.get(f"{BRIDGE_URL}/diagnostics/interactions").text[:600]
        except httpx.HTTPError as exc:  # noqa: BLE001 - diagnostic only
            traffic = f"<unavailable: {type(exc).__name__}: {exc}>"
        log.info(
            "Acknowledgement state: sent=%s inHistory=%s acknowledged=%s "
            "unacknowledged=%s published=%s pollFailures=%s | interactions: %s",
            payload.get("sentThisSession"),
            payload.get("inHistory"),
            payload.get("acknowledged"),
            payload.get("unacknowledged"),
            _state["acknowledged"],
            _state["ack_poll_failures"],
            traffic,
        )

    # The bridge's own tally, republished as-is. Sent climbing while this stays
    # equal to it is the signature of tasks nobody is answering.
    _state["unacknowledged"] = payload.get("unacknowledged")

    for task in payload.get("tasks") or []:
        task_id = task.get("taskId")
        context = _TASK_CONTEXT.get(task_id) if task_id else None
        if context is None:
            # Sent by an earlier run of this container, or evicted. The bridge
            # still has it; we no longer know which command it was.
            continue
        acknowledgements = task.get("acknowledgements") or []
        already = _ACKS_SEEN.get(task_id, 0)
        for text in acknowledgements[already:]:
            _state["acknowledged"] += 1
            _publish_outcome(
                client,
                {
                    **context,
                    "observed_at": _iso(datetime.now(timezone.utc)),
                    "stage": "ACKNOWLEDGED",
                    "http_status": None,
                    "task_id": task_id,
                    "detail": text,
                },
            )
        _ACKS_SEEN[task_id] = len(acknowledgements)


def _publish_outcome(client: httpx.Client, outcome: dict) -> None:
    # Every outcome passes through here, which makes it the one place that sees
    # a taskId without threading it through each caller.
    _remember_task(outcome)
    if not LOG_RID:
        return
    try:
        response = client.post(
            _json_record_url(),
            headers={
                "Authorization": f"Bearer {tracks.bearer_token(client)}",
                "Content-Type": "application/json",
            },
            json=outcome,
        )
        if response.status_code >= 400:
            _state["outcome_failures"] += 1
            log.warning(
                "Could not publish outcome for %s: HTTP %s %s",
                outcome["command_id"],
                response.status_code,
                response.text[:200],
            )
    except httpx.HTTPError as exc:
        _state["outcome_failures"] += 1
        log.warning("Could not publish outcome for %s: %s", outcome["command_id"], exc)


# ── Loop ──────────────────────────────────────────────────────────────────────


def is_configured() -> tuple[bool, str]:
    if not tracks.base_url():
        return False, "no Foundry base URL (set FOUNDRY_URL)"
    if not COMMAND_RID:
        return False, f"command stream {COMMAND_SOURCE}"
    return True, ""


def _process(client: httpx.Client, records: list[dict]) -> None:
    """
    Execute records, preserving order within a partition.

    partition_key is the entity for tasking and the target kind for control and
    simulation operations, so a DISCONNECT never queues behind a platoon's
    movement orders.
    """
    grouped: "OrderedDict[str, list[dict]]" = OrderedDict()
    for record, from_deferred in records:
        key = record.get("partition_key") or record.get("entity_uuid") or "_"
        grouped.setdefault(key, []).append((record, from_deferred))
    for batch in grouped.values():
        for record, from_deferred in batch:
            result = handle_record(record, from_deferred=from_deferred)
            # None means already decided on an earlier poll: publishing again
            # would just repeat a row that is already in the log.
            if result is not None:
                _publish_outcome(client, result)


def _loop() -> None:
    with tracks.http_client() as client:
        # Before the first poll, so the backlog is recognised rather than
        # re-decided.
        _prime_seen(client)
        while not _stop.wait(POLL_SECONDS):
            _state["polls"] += 1
            try:
                records = _fetch(client)
            except Exception as exc:  # noqa: BLE001 - reported, never fatal
                _state["poll_failures"] += 1
                _state["last_error"] = f"{type(exc).__name__}: {exc}"
                continue
            deferred = drain_deferred()
            if records or deferred:
                _process(client, [(r, False) for r in records] + [(r, True) for r in deferred])
            # After processing, so a task sent this cycle can be answered on the
            # next one. Acknowledgements arrive asynchronously over the RTI and
            # are never available in the same tick as the send.
            poll_acknowledgements(client)
    _state["running"] = False
    log.info("Command consumer stopped.")


def start() -> None:
    """
    Start the consumer if configured; otherwise say why and do nothing.

    Deliberately not fatal when unconfigured, for the same reason tracks.start()
    is not: exiting would put the container in a restart loop and lose the
    diagnostics that say what is missing.
    """
    configured, reason = is_configured()
    if not configured:
        log.warning("Command consumer is OFF: %s. Bridge at %s; command log: %s", reason, BRIDGE_URL, LOG_SOURCE)
        return

    log.info(
        "Command consumer: reading %s (branch %s, from %s) every %.1fs, "
        "executing against %s, outcomes to %s (branch %s, from %s)",
        COMMAND_RID,
        COMMAND_BRANCH,
        COMMAND_SOURCE,
        POLL_SECONDS,
        BRIDGE_URL,
        LOG_RID or "<none>",
        LOG_BRANCH,
        LOG_SOURCE,
    )
    if not LOG_RID:
        log.warning(
            "No command log stream (%s). Commands will execute but their "
            "outcomes will only exist in these logs, which is the gap this "
            "stream is meant to close.",
            LOG_SOURCE,
        )

    _state["running"] = True
    threading.Thread(target=_loop, name="hla-command-consumer", daemon=True).start()


def stop() -> None:
    _stop.set()


def status() -> dict:
    return dict(_state)
