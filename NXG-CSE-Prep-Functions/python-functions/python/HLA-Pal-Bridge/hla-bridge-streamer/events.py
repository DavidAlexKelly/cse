# events.py
"""
Polls the HLA bridge's event log and publishes it to a Foundry streaming dataset.

Sibling of tracks.py: tracks are where every entity is, once a second; events
are what happened. The bridge records, in the order it heard them:

- RPR WeaponFire and MunitionDetonation from any simulator in the federation
  (source "rpr"), with firer and target resolved to the entities the bridge has
  discovered, so they carry UUID and callsign where those are known;
- every event a BGWS simulation logs (source "bgws"), sent as BGWS_Event
  interactions from BGWS's own FOM module (cse-hla-bridge/foms/BGWS-Events.xml):
  detections, shots, hits, kills, orders, decisions and their reasons,
  messages, smoke, laser designation, the verdict — each with a line for
  people (`text`) and the figures behind it as JSON (`data`).

The bridge numbers events from 1 (`seq`) and serves everything after a number
(GET /events?after=N). This thread keeps that cursor, publishes each page as a
batch, and advances only once the batch is accepted, so a failed publish is
retried rather than lost. The cursor lives in memory: on a restart of this
container the bridge's buffer is read again from the start, and `event_id`,
deterministic per bridge record, makes the second publish overwrite the first
rather than duplicate it. A bridge restart starts a new buffer, so events the
federation sent while the bridge was down are not recoverable: HLA keeps no
history of interactions.

Configured like tracks.py, through the same pipeline-mode alias map and job
token: EVENT_STREAM_ALIAS names the output (or EVENT_STREAM_DATASET_RID gives a
RID). Unset, the thread says so and does nothing, and tracks keep publishing.
"""

import logging
import os
import threading
import time
from datetime import datetime, timezone

import httpx

import tracks

log = logging.getLogger(__name__)

BRIDGE_URL = os.environ.get("BRIDGE_URL", "http://localhost:8080/api/v1/bridge")
EVENT_STREAM_ALIAS = os.environ.get("EVENT_STREAM_ALIAS", "").strip()
EVENT_STREAM_RID_ENV = os.environ.get("EVENT_STREAM_DATASET_RID", "").strip()
EVENT_STREAM_BRANCH_ENV = os.environ.get("EVENT_STREAM_BRANCH", "master").strip() or "master"
EVENT_PUBLISH_URL = os.environ.get("EVENT_PUBLISH_URL", "").strip()
POLL_SECONDS = float(os.environ.get("EVENT_POLL_SECONDS", "1.0"))
# Events per publish. A busy second (an artillery mission landing) can produce
# a few hundred; several pages are sent in one tick if need be.
BATCH = int(os.environ.get("EVENT_BATCH", "500"))

EVENT_RID, EVENT_BRANCH, EVENT_SOURCE = tracks.resolve_alias(EVENT_STREAM_ALIAS, EVENT_STREAM_RID_ENV, EVENT_STREAM_BRANCH_ENV)
_PUBLISHER = tracks.Publisher(EVENT_RID, EVENT_BRANCH, EVENT_PUBLISH_URL, view_env="EVENT_STREAM_VIEW_RID")

_state = {
    "running": False,
    "polls": 0,
    "events_published": 0,
    "publish_failures": 0,
    "poll_failures": 0,
    # Events the bridge's buffer dropped before this thread read past them.
    "gaps": 0,
    "cursor": 0,
    "last_published_at": None,
    "last_error": None,
}
_lock = threading.Lock()
_stop = threading.Event()


def _bump(**changes) -> None:
    with _lock:
        for key, value in changes.items():
            if key.startswith("+"):
                _state[key[1:]] += value
            else:
                _state[key] = value


def is_configured() -> tuple[bool, str]:
    if not EVENT_RID and not EVENT_PUBLISH_URL:
        return False, (
            f"no event stream: set EVENT_STREAM_ALIAS (pipeline mode) or EVENT_STREAM_DATASET_RID ({EVENT_SOURCE})"
        )
    if not EVENT_PUBLISH_URL and not tracks.base_url():
        return False, "no Foundry URL: set FOUNDRY_URL (as for tracks)"
    if tracks.CREDENTIAL_MODE == "none":
        return False, "no credentials (as for tracks: BUILD2_TOKEN in pipeline mode)"
    return True, f"configured ({tracks.CREDENTIAL_MODE})"


def status() -> dict:
    configured, reason = is_configured()
    with _lock:
        snapshot = dict(_state)
    snapshot["configured"] = configured
    snapshot["configuration"] = reason
    snapshot["dataset"] = EVENT_RID or None
    snapshot["branch"] = EVENT_BRANCH
    snapshot["stream_source"] = EVENT_SOURCE
    snapshot["publish_url"] = tracks._redact(_PUBLISHER.url()) or None
    snapshot["body_shape"] = _PUBLISHER.body_shape()
    return snapshot


def _iso(millis) -> str | None:
    if millis in (None, ""):
        return None
    try:
        return datetime.fromtimestamp(float(millis) / 1000.0, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    except (TypeError, ValueError, OSError):
        return None


def event_id(event: dict) -> str:
    """
    Deterministic per bridge record: the source's own numbering where it has
    one, plus the bridge's receive time, so a re-read of the same buffer
    overwrites and a new game reusing the same federate name does not collide.
    """
    if event.get("source") == "bgws":
        origin = f"bgws:{event.get('federate') or '?'}:{event.get('sourceSeq')}"
    else:
        origin = f"rpr:{event.get('kind')}:{event.get('entityName') or '?'}:{event.get('eventCount')}"
    return f"{origin}@{event.get('receivedAt')}"


def to_record(event: dict, federation: str | None) -> dict:
    """
    One row. Every column is coerced to its type (the publish rejects the
    whole batch on one bad record), and absent values are null, never zero.
    """
    s, f, i = tracks._as_str, tracks._as_float, tracks._as_int
    return {
        "event_id": event_id(event),
        "bridge_seq": i(event.get("seq")),
        "received_at": _iso(event.get("receivedAt")),
        "source": s(event.get("source")),
        "kind": s(event.get("kind")),
        "federation": s(federation),
        "federate": s(event.get("federate")),
        "source_seq": i(event.get("sourceSeq")),
        "sim_time_s": f(event.get("simTime")),
        "side": s(event.get("side")),
        "entity_name": s(event.get("entityName")),
        "entity_id": s(event.get("entityId")),
        "entity_unique_id": s(event.get("entityUniqueId")),
        "entity_callsign": s(event.get("entityCallsign")),
        "target_name": s(event.get("targetName")),
        "target_id": s(event.get("targetId")),
        "target_unique_id": s(event.get("targetUniqueId")),
        "target_callsign": s(event.get("targetCallsign")),
        "latitude": f(event.get("latitude")),
        "longitude": f(event.get("longitude")),
        "altitude_m": f(event.get("altitudeMeters")),
        "munition": s(event.get("munition")),
        "quantity": i(event.get("quantity")),
        "result": s(event.get("result")),
        "text": s(event.get("text")),
        "data": s(event.get("data")),
    }


def _fetch(client: httpx.Client, after: int) -> dict:
    response = client.get(f"{BRIDGE_URL}/events", params={"after": after, "limit": BATCH}, timeout=5)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or not isinstance(payload.get("events"), list):
        raise RuntimeError(f"unexpected /events payload: {str(payload)[:200]}")
    return payload


def tick(client: httpx.Client, cursor: int, federation: str | None, publish) -> int:
    """
    Publish everything after `cursor`, a page at a time; returns the new
    cursor. Raises if a publish fails, leaving the cursor where the last
    accepted page ended.
    """
    while True:
        page = _fetch(client, cursor)
        _bump(**{"+polls": 1})
        events = page["events"]
        if not events:
            return cursor
        # Numbers are consecutive in the bridge; a jump, before the page or
        # within it, is events its buffer dropped before they were read.
        previous = cursor
        for e in events:
            seq = e.get("seq") or 0
            if previous and seq > previous + 1:
                missed = seq - previous - 1
                _bump(**{"+gaps": missed})
                log.warning("The bridge dropped %d event(s) before they were read (after %d, next held %d)", missed, previous, seq)
            previous = seq
        publish(client, [to_record(e, federation) for e in events])
        cursor = events[-1].get("seq") or cursor
        _bump(**{"+events_published": len(events)}, cursor=cursor, last_published_at=_iso(time.time() * 1000), last_error=None)
        if len(events) < BATCH:
            return cursor


def _loop() -> None:
    cursor = 0
    federation = None
    federation_checked_at = 0.0
    failures = 0
    with tracks.http_client() as client:
        while not _stop.is_set():
            started = time.monotonic()
            try:
                if time.monotonic() - federation_checked_at > 60:
                    try:
                        r = client.get(f"{BRIDGE_URL}/status", timeout=5)
                        if r.status_code == 200:
                            federation = r.json().get("federationName")
                    except Exception:  # noqa: BLE001 - never fatal
                        pass
                    federation_checked_at = time.monotonic()
                cursor = tick(client, cursor, federation, _PUBLISHER.publish)
                if failures:
                    log.info("Event publishing recovered after %d failure(s)", failures)
                failures = 0
            except httpx.HTTPError as exc:
                failures += 1
                _bump(**{"+poll_failures": 1}, last_error=f"{type(exc).__name__}: {exc}")
                if failures <= 3 or failures % 300 == 0:
                    log.warning("Event poll or publish failed (%d consecutive): %s", failures, exc)
            except Exception as exc:  # noqa: BLE001 - the thread must never die
                failures += 1
                _bump(**{"+publish_failures": 1}, last_error=f"{type(exc).__name__}: {exc}")
                if failures <= 3 or failures % 300 == 0:
                    log.warning("Event publish failed (%d consecutive): %s", failures, exc)
            _stop.wait(max(0.05, POLL_SECONDS - (time.monotonic() - started)))


def start() -> None:
    """Start the event publisher if configured; otherwise say why and do nothing."""
    configured, reason = is_configured()
    if not configured:
        log.warning("Event publisher is OFF: %s", reason)
        return
    log.info("Event publisher: stream %s (branch %s) from %s, every %.1fs", EVENT_RID, EVENT_BRANCH, EVENT_SOURCE, POLL_SECONDS)
    _bump(running=True)
    threading.Thread(target=_loop, name="event-publisher", daemon=True).start()


def stop() -> None:
    _stop.set()
