# tracks.py
"""
Polls the HLA bridge and publishes entity tracks to a Foundry streaming dataset.

Runs as a background thread rather than a scheduled job for two reasons: the
bridge's REST API is bound to localhost inside this pod, reachable only from
this container, so the data has to be pushed out rather than pulled in; and
Foundry schedules are minute-granularity at best, so a 1 Hz sample cannot be
driven from the platform side at all.

This module runs in a pipeline mode compute module, the mode that takes
Foundry inputs and writes Foundry outputs, and pipeline mode hands the
container everything it needs rather than leaving it to be guessed.
RESOURCE_ALIAS_MAP names a JSON file mapping the identifier given to each
input/output in the module configuration to its rid and branch; the stream is
configured as an output, and TRACK_STREAM_ALIAS says which identifier to look
up. BUILD2_TOKEN names a file containing a bearer token scoped to exactly
those inputs and outputs, which removes the OAuth client-credentials exchange
entirely - no client id, no secret, no scope names that differ per
enrollment. DEFAULT_CA_PATH names a mounted CA PEM, loaded in addition to the
system trust store rather than instead of it - see _ssl_context().

Functions mode is still supported as a fallback, exchanging client
credentials for a token, so this module keeps working if it is ever
reconfigured, but pipeline mode is the intended and simpler path.

One thing the platform does not give a compute module is egress: it cannot
reach the Foundry URL until a source with a network policy for that URL is
added to it. Until then DNS resolution itself fails, surfacing as
"ConnectError: [Errno -2] Name or service not known" while fetching a token -
an error that reads like an authentication failure and is actually a
networking one. start() says so explicitly when the host does not resolve.

One row is published per entity per tick, evenly sampled, so a gap means the
bridge reported nothing rather than that a value was unchanged - the
distinction a replay needs. Two timestamps are kept for the same reason: the
drone publishes at roughly 1 Hz and this polls at roughly 1 Hz, so the two
will alias and the same sample is often read twice. observed_at is when this
module looked; bridge_last_updated is when the value last actually changed,
and downstream can deduplicate on the second without guessing. track_point_id
is deterministic, built from the unique id and the epoch millisecond, so the
stream can back an ontology object type directly and a retried publish
produces the same key rather than a duplicate track point. Absent values are
published as null, never as zero, since a drone at latitude 0.0 and a drone
with no position are different facts. Values are coerced to the stream's
column types before sending, because the publish validates records against
the schema and rejects the whole batch if any one record is invalid, so one
entity reporting a string where a number belongs must not cost every other
entity in that tick. Nothing here may take the compute module down: every
failure path logs and continues, and the thread is a daemon so it cannot
block shutdown. Failures are logged with backoff rather than on every
attempt, since retrying once a second and logging every attempt would
produce sixty identical lines a minute.
"""

import json
import logging
import os
import socket
import ssl
import threading
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit, urlunsplit

import httpx

log = logging.getLogger(__name__)

BRIDGE_URL = os.environ.get("BRIDGE_URL", "http://localhost:8080/api/v1/bridge")

# ── Configuration ─────────────────────────────────────────────────────────────
# The stream is normally identified by its configured output alias; the explicit
# RID is kept for functions mode, where there is no alias map.
STREAM_ALIAS = os.environ.get("TRACK_STREAM_ALIAS", "").strip()
STREAM_DATASET_RID_ENV = os.environ.get("TRACK_STREAM_DATASET_RID", "").strip()
STREAM_BRANCH_ENV = os.environ.get("TRACK_STREAM_BRANCH", "").strip()
POLL_SECONDS = float(os.environ.get("TRACK_POLL_SECONDS", "1.0"))

# Provided by the platform. Named here rather than read inline so `status()` can
# report which of them the container actually received.
ALIAS_MAP_FILE = os.environ.get("RESOURCE_ALIAS_MAP", "").strip()
BUILD_TOKEN_FILE = os.environ.get("BUILD2_TOKEN", "").strip()
CA_BUNDLE = os.environ.get("DEFAULT_CA_PATH", "").strip()


def _normalise_base(value: str) -> str:
    """
    A base URL with a scheme and no trailing slash.

    The enrollment URL is configured both as a bare host and as a full URL. A bare
    host left httpx with nothing to resolve and reported "Connection refused",
    which looks like a network fault rather than a missing scheme.
    """
    host = (value or "").strip().rstrip("/")
    if not host:
        return ""
    if "://" not in host:
        return f"https://{host}"
    if not host.startswith(("http://", "https://")):
        log.warning("Ignoring Foundry base URL with an unsupported scheme: %s", host)
        return ""
    return host


def _resolve_base_url() -> tuple[str, str]:
    """The Foundry base URL and which variable it came from."""
    for name in ("TRACK_FOUNDRY_BASE_URL", "FOUNDRY_URL", "FOUNDRY_HOSTNAME"):
        url = _normalise_base(os.environ.get(name, ""))
        if url:
            return url, name
    return "", "none"


FOUNDRY_BASE_URL, BASE_URL_SOURCE = _resolve_base_url()


def _redact(url: str) -> str:
    """A URL safe to log, in case one ever carries credentials in its userinfo."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return "(unparseable)"
    if "@" in parts.netloc:
        netloc = f"<redacted>@{parts.netloc.rsplit('@', 1)[1]}"
        return urlunsplit((parts.scheme, netloc, parts.path, "", ""))
    return url


def _host_resolves(url: str) -> tuple[bool, str]:
    """
    Whether the Foundry host resolves from inside this container.

    Checked so the "add a source with a network policy" hint can be given at
    startup rather than inferred from a connection error at 1 Hz.
    """
    try:
        parts = urlsplit(url)
        if not parts.hostname:
            return False, "no host in URL"
        socket.getaddrinfo(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
        return True, ""
    except (OSError, ValueError) as exc:
        return False, f"{type(exc).__name__}: {exc}"


# ── Pipeline mode: the resource alias map ─────────────────────────────────────


def _load_alias_map() -> tuple[dict, str | None]:
    """The configured input/output identifiers, or the reason there are none."""
    if not ALIAS_MAP_FILE:
        return {}, "RESOURCE_ALIAS_MAP is not set (not a pipeline mode module)"
    try:
        with open(ALIAS_MAP_FILE, "r", encoding="utf-8") as handle:
            loaded = json.load(handle)
        if not isinstance(loaded, dict):
            return {}, f"{ALIAS_MAP_FILE} did not contain a JSON object"
        return loaded, None
    except Exception as exc:  # noqa: BLE001 - reported, never fatal
        return {}, f"could not read {ALIAS_MAP_FILE}: {type(exc).__name__}: {exc}"


ALIAS_MAP, ALIAS_MAP_ERROR = _load_alias_map()


def _resolve_stream() -> tuple[str, str, str]:
    """
    The stream to publish to: RID, branch, and where that came from.

    The alias wins when it resolves: it is the identifier the module configuration
    actually grants a token for, so a mismatched explicit RID would fail with a
    permission error rather than anything obvious.
    """
    if STREAM_ALIAS:
        entry = ALIAS_MAP.get(STREAM_ALIAS)
        if isinstance(entry, dict) and entry.get("rid"):
            branch = entry.get("branch") or STREAM_BRANCH_ENV or "master"
            return entry["rid"], branch, f"alias '{STREAM_ALIAS}' in RESOURCE_ALIAS_MAP"
        # Fall through to the explicit RID, but say why: an alias that is set and
        # unresolvable is a configuration mistake worth naming.
        log.warning(
            "TRACK_STREAM_ALIAS='%s' is not in the resource alias map (%s). Known identifiers: %s",
            STREAM_ALIAS,
            ALIAS_MAP_ERROR or "no such identifier",
            sorted(ALIAS_MAP),
        )
    if STREAM_DATASET_RID_ENV:
        return (STREAM_DATASET_RID_ENV, STREAM_BRANCH_ENV or "master", "TRACK_STREAM_DATASET_RID")
    return "", STREAM_BRANCH_ENV or "master", "unresolved"


STREAM_DATASET_RID, STREAM_BRANCH, STREAM_SOURCE = _resolve_stream()


# ── Credentials ───────────────────────────────────────────────────────────────
#
# Pipeline mode: a job token, mounted as a file, scoped to the configured inputs
# and outputs. Functions mode: the third-party application's client credentials,
# exchanged for a token. Pipeline mode is preferred — it is scoped to exactly this
# stream and involves no scope names, which differ between enrollments.
#
# Secrets are never logged, only their presence and origin.

_CLIENT_ID_ENV_VARS = ("CLIENT_ID", "FOUNDRY_CLIENT_ID", "COMPUTE_MODULE_CLIENT_ID")
_CLIENT_SECRET_ENV_VARS = ("CLIENT_SECRET", "FOUNDRY_CLIENT_SECRET", "COMPUTE_MODULE_CLIENT_SECRET")

_credential_search: list[dict] = []


def _read_build_token() -> str:
    """
    The mounted job token.

    Read on demand rather than cached at import: the platform may rotate the file,
    and re-reading a local file at token-refresh frequency costs nothing.
    """
    if not BUILD_TOKEN_FILE:
        return ""
    try:
        with open(BUILD_TOKEN_FILE, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    except OSError as exc:
        log.warning("Could not read the job token at %s: %s", BUILD_TOKEN_FILE, exc)
        return ""


def _discover_credentials() -> tuple[str, str, str, list[dict]]:
    """Credential mode, client id, client secret, and everywhere that was checked."""
    searched: list[dict] = []

    token = _read_build_token()
    searched.append({"kind": "file", "name": "BUILD2_TOKEN", "path": BUILD_TOKEN_FILE or None, "found": bool(token)})
    if token:
        return "pipeline job token", "", "", searched

    client_id = client_secret = ""
    for name in _CLIENT_ID_ENV_VARS:
        value = os.environ.get(name, "").strip()
        searched.append({"kind": "env", "name": name, "found": bool(value)})
        if value and not client_id:
            client_id = value
    for name in _CLIENT_SECRET_ENV_VARS:
        value = os.environ.get(name, "").strip()
        # Presence only — a secret is never reported or logged.
        searched.append({"kind": "env", "name": name, "found": bool(value)})
        if value and not client_secret:
            client_secret = value

    if client_id and client_secret:
        return "oauth client credentials", client_id, client_secret, searched
    return "none", "", "", searched


CREDENTIAL_MODE, CLIENT_ID, CLIENT_SECRET, CREDENTIAL_SEARCH = _discover_credentials()

# Functions mode only. Pipeline mode never reaches this.
_SCOPE_ENV = os.environ.get("TRACK_OAUTH_SCOPE", "").strip()
_SCOPE_CANDIDATES = ([_SCOPE_ENV] if _SCOPE_ENV else []) + [
    "api:streams-write",
    "api:use-streams-write",
    "",
]
_TOKEN_RETRY_SECONDS = float(os.environ.get("TRACK_TOKEN_RETRY_SECONDS", "15"))
_TOKEN_RETRY_CEILING = 120.0

_token_lock = threading.Lock()
_cached_token = ""
_cached_expiry = 0.0
_token_error: str | None = None
_token_scope: str | None = None
_next_token_attempt = 0.0
_token_backoff = 0.0
_token_attempts = 0


def _oauth_token_url() -> str:
    override = os.environ.get("TRACK_OAUTH_TOKEN_URL", "").strip()
    return override or f"{FOUNDRY_BASE_URL}/multipass/api/oauth2/token"


def _exchange(client: httpx.Client, scope: str) -> tuple[str, float]:
    form = {"grant_type": "client_credentials", "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET}
    if scope:
        form["scope"] = scope
    response = client.post(_oauth_token_url(), data=form, timeout=10)
    response.raise_for_status()
    payload = response.json()
    return payload.get("access_token", ""), float(payload.get("expires_in", 3600))


def _bearer_token(client: httpx.Client) -> str:
    """
    A bearer token for the publish call.

    In pipeline mode this is the mounted job token, re-read each time it is
    needed. In functions mode it is minted from client credentials, cached until
    shortly before expiry, and retried with backoff on failure so that a
    misconfiguration does not become a request storm.
    """
    global _cached_token, _cached_expiry, _token_error, _token_scope
    global _next_token_attempt, _token_backoff, _token_attempts

    if CREDENTIAL_MODE == "pipeline job token":
        token = _read_build_token()
        if not token:
            raise RuntimeError(f"the job token at {BUILD_TOKEN_FILE} is empty or unreadable")
        return token

    if not (CLIENT_ID and CLIENT_SECRET):
        return ""

    with _token_lock:
        if _cached_token and time.monotonic() < _cached_expiry:
            return _cached_token
        if time.monotonic() < _next_token_attempt:
            return ""

        _token_attempts += 1
        # A scope that already worked is tried alone; no reason to re-probe.
        scopes = [_token_scope] if _token_scope is not None else list(_SCOPE_CANDIDATES)
        errors: list[str] = []
        for scope in scopes:
            try:
                token, lifetime = _exchange(client, scope)
            except Exception as exc:  # noqa: BLE001 - reported, never fatal
                detail = getattr(getattr(exc, "response", None), "text", "")
                errors.append(
                    f"scope={scope or '(default)'} {type(exc).__name__}: {exc}{' — ' + detail[:200] if detail else ''}"
                )
                continue
            if not token:
                errors.append(f"scope={scope or '(default)'} no access_token in response")
                continue
            _cached_token = token
            # Refresh at 80% of the stated lifetime so a publish never races the
            # expiry boundary.
            _cached_expiry = time.monotonic() + lifetime * 0.8
            _token_error, _token_backoff, _next_token_attempt = None, 0.0, 0.0
            if _token_scope != scope:
                log.info("Foundry token minted with scope %s, valid %.0fs", scope or "(application default)", lifetime)
            _token_scope = scope
            return _cached_token

        _cached_token, _cached_expiry = "", 0.0
        previous, _token_error = _token_error, "; ".join(errors)
        _token_backoff = min(max(_TOKEN_RETRY_SECONDS, _token_backoff * 2), _TOKEN_RETRY_CEILING)
        _next_token_attempt = time.monotonic() + _token_backoff
        if _token_error != previous or _token_attempts % 20 == 0:
            log.warning(
                "Could not mint a Foundry token (attempt %d, next in %.0fs): %s",
                _token_attempts,
                _token_backoff,
                _token_error,
            )
        return ""


# ── Publish endpoint ──────────────────────────────────────────────────────────
#
# Two documented shapes exist for stream records: the stream-proxy service,
# which the pipeline mode documentation uses and which the job token is
# scoped for, and the public Streams API, which a functions mode OAuth token
# uses. Which one a given credential is accepted on is not something this
# container can know in advance, so the candidates are ordered by credential
# mode and a 404/405 moves to the next one permanently. Anything else is a
# real error and is not retried elsewhere, which would only mask it.

PUBLISH_URL_OVERRIDE = os.environ.get("TRACK_PUBLISH_URL", "").strip()
_publish_index = 0
_publish_urls_tried: list[str] = []
# The record envelope. stream-proxy and the public API differ, so the working
# shape is discovered once on a 400/415/422 and then kept.
_BODY_SHAPES = ("records", "array")
_body_index = 0


def _publish_url_candidates() -> list[str]:
    """
    Publish endpoints, best first, ordered by what the credential actually is.

    A job token publishes to stream-proxy rather than the API gateway, even
    though the reserved-variable documentation describes the job token as
    being for calling the API gateway. Observed behaviour takes precedence
    over that description, so stream-proxy is tried first for a job token
    and the gateway is kept as a fallback.

    An OAuth token (functions mode) keeps the gateway first, since it is
    scoped by OAuth scopes rather than to specific resources, which is what
    the public API expects.
    """
    if PUBLISH_URL_OVERRIDE:
        return [PUBLISH_URL_OVERRIDE]
    if not (FOUNDRY_BASE_URL and STREAM_DATASET_RID):
        return []
    stream_proxy = f"{FOUNDRY_BASE_URL}/stream-proxy/api/streams/{STREAM_DATASET_RID}/branches/{STREAM_BRANCH}/records"
    gateway_high_scale = (
        f"{FOUNDRY_BASE_URL}/api/v2/highScale/streams/datasets/{STREAM_DATASET_RID}"
        f"/streams/{STREAM_BRANCH}/publishRecords"
    )
    gateway = f"{FOUNDRY_BASE_URL}/api/v2/streams/datasets/{STREAM_DATASET_RID}/streams/{STREAM_BRANCH}/publishRecords"
    if CREDENTIAL_MODE == "pipeline job token":
        return [stream_proxy, gateway_high_scale, gateway]
    return [gateway_high_scale, gateway, stream_proxy]


def _publish_url() -> str:
    candidates = _publish_url_candidates()
    if not candidates:
        return ""
    return candidates[min(_publish_index, len(candidates) - 1)]


def _body(records: list[dict]) -> str:
    shape = _BODY_SHAPES[min(_body_index, len(_BODY_SHAPES) - 1)]
    if shape == "array":
        return json.dumps(records, allow_nan=False)
    envelope: dict = {"records": records}
    view = os.environ.get("TRACK_STREAM_VIEW_RID", "").strip()
    if view:
        envelope["viewRid"] = view
    return json.dumps(envelope, allow_nan=False)


def is_configured() -> tuple[bool, str]:
    """Whether publishing can run, and why not if it cannot."""
    if not STREAM_DATASET_RID:
        if STREAM_ALIAS:
            return False, (
                f"the output alias '{STREAM_ALIAS}' did not resolve — "
                f"{ALIAS_MAP_ERROR or 'no such identifier in the alias map'}. "
                f"Add the stream as an output on the compute module with that "
                f"identifier, or set TRACK_STREAM_DATASET_RID."
            )
        return False, ("no stream to publish to: set TRACK_STREAM_ALIAS (pipeline mode) or TRACK_STREAM_DATASET_RID")
    if not PUBLISH_URL_OVERRIDE and not FOUNDRY_BASE_URL:
        return False, ("no Foundry URL: set FOUNDRY_URL (or TRACK_FOUNDRY_BASE_URL) to the enrollment URL")
    if CREDENTIAL_MODE == "none":
        return False, (
            "no credentials. In pipeline mode the platform mounts a job token "
            "and sets BUILD2_TOKEN; in functions mode with application "
            "permissions it provides CLIENT_ID and CLIENT_SECRET. Neither was "
            "present — see credential_search."
        )
    return True, f"configured ({CREDENTIAL_MODE})"


# ── Observability ─────────────────────────────────────────────────────────────
# Counters rather than per-tick logs: at 1 Hz, logging every publish would bury
# everything else in the pod. Surfaced by the streamer's periodic summary line and
# its final snapshot on SIGTERM — the streaming module registers no functions, so
# the container log is the diagnostic channel.
_stats = {
    "running": False,
    "polls": 0,
    "records_published": 0,
    "publish_failures": 0,
    "poll_failures": 0,
    "last_published_at": None,
    "last_error": None,
    "last_record_count": 0,
}
_stats_lock = threading.Lock()


def status() -> dict:
    configured, reason = is_configured()
    with _stats_lock:
        snapshot = dict(_stats)
    snapshot["configured"] = configured
    snapshot["configuration"] = reason
    snapshot["dataset"] = STREAM_DATASET_RID or None
    snapshot["branch"] = STREAM_BRANCH
    snapshot["stream_source"] = STREAM_SOURCE
    snapshot["poll_seconds"] = POLL_SECONDS
    snapshot["publish_url"] = _redact(_publish_url()) or None
    snapshot["publish_urls_tried"] = list(_publish_urls_tried)
    snapshot["body_shape"] = _BODY_SHAPES[min(_body_index, len(_BODY_SHAPES) - 1)]
    snapshot["foundry_base_url"] = _redact(FOUNDRY_BASE_URL) or None
    snapshot["foundry_base_url_source"] = BASE_URL_SOURCE
    snapshot["ca_bundle"] = CA_BUNDLE or None
    snapshot["credential_mode"] = CREDENTIAL_MODE
    snapshot["credential_search"] = CREDENTIAL_SEARCH
    snapshot["alias_map_file"] = ALIAS_MAP_FILE or None
    snapshot["alias_map_identifiers"] = sorted(ALIAS_MAP)
    snapshot["alias_map_error"] = ALIAS_MAP_ERROR
    if CREDENTIAL_MODE == "oauth client credentials":
        snapshot["oauth_scope_in_use"] = None if _token_scope is None else _token_scope or "(application default)"
        snapshot["token_attempts"] = _token_attempts
        snapshot["token_error"] = _token_error
    return snapshot


def _bump(**changes) -> None:
    with _stats_lock:
        for key, value in changes.items():
            if key.startswith("+"):
                _stats[key[1:]] += value
            else:
                _stats[key] = value


# ── Record shaping ────────────────────────────────────────────────────────────


def _iso(millis) -> str | None:
    """Epoch milliseconds to an ISO-8601 UTC string, or None."""
    if millis in (None, ""):
        return None
    try:
        return (
            datetime.fromtimestamp(float(millis) / 1000.0, tz=timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )
    except (TypeError, ValueError, OSError):
        return None


# The publish validates every record against the stream schema and rejects the
# whole batch on the first bad one, so a single odd value from the bridge would
# cost the entire tick. Coerce to the column type and drop what cannot be coerced.


def _as_float(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    # NaN and infinities are neither valid JSON numbers nor valid doubles.
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _as_int(value) -> int | None:
    number = _as_float(value)
    return None if number is None else int(number)


def _as_bool(value) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in ("true", "false"):
        return value.strip().lower() == "true"
    if isinstance(value, (int, float)):
        return bool(value)
    return None


def _as_str(value) -> str | None:
    if value is None:
        return None
    return value if isinstance(value, str) else str(value)


def to_record(entity: dict, observed_at: str, observed_millis: int, federation: str | None) -> dict:
    """
    One entity, as one flat row.

    Flat and typed on purpose: this stream is meant to back an ontology object
    type and feed analytics, and neither wants nested structures. Keys are
    snake_case because that is what the dataset schema and object type use; the
    bridge speaks camelCase.
    """
    unique_id = _as_str(entity.get("uniqueId"))
    entity_id = _as_str(entity.get("id"))
    # Prefer the NETN UUID: the HLA instance handle is only stable for the life
    # of one federation execution, so a restart would otherwise start a new track
    # for the same aircraft.
    key = unique_id or entity_id or "unknown"
    return {
        "track_point_id": f"{key}@{observed_millis}",
        "observed_at": observed_at,
        "bridge_last_updated": _iso(entity.get("lastUpdated")),
        "first_seen_at": _iso(entity.get("discoveredAt")),
        "unique_id": unique_id,
        "entity_id": entity_id,
        "name": _as_str(entity.get("name")),
        "callsign": _as_str(entity.get("callsign")),
        "entity_type": _as_str(entity.get("entityType")),
        "dis_type": _as_str(entity.get("dis")),
        "force_id": _as_str(entity.get("forceId")),
        "simulator": _as_str(entity.get("simulator")),
        "symbol_id": _as_str(entity.get("symbolId")),
        "latitude": _as_float(entity.get("latitude")),
        "longitude": _as_float(entity.get("longitude")),
        "altitude_m": _as_float(entity.get("altitudeMeters")),
        "heading_deg": _as_float(entity.get("headingDegrees")),
        "speed_mps": _as_float(entity.get("speedMps")),
        "damage_state": _as_str(entity.get("damageState")),
        "aggregate_state": _as_str(entity.get("aggregateState")),
        "activity": _as_str(entity.get("activity")),
        "posture": _as_str(entity.get("posture")),
        "mission": _as_str(entity.get("mission")),
        "echelon": _as_str(entity.get("echelon")),
        "combat_value": _as_int(entity.get("combatValue")),
        "is_command_post": _as_bool(entity.get("isCommandPost")),
        "federation": _as_str(federation),
    }


# ── Polling and publishing ────────────────────────────────────────────────────


def _poll_entities(client: httpx.Client) -> list[dict] | None:
    response = client.get(f"{BRIDGE_URL}/entities", timeout=5)
    response.raise_for_status()
    payload = response.json()
    # The bridge returns a bare array on success. Anything else is one of the
    # error payloads, which must not be mistaken for "no entities".
    if isinstance(payload, list):
        return payload
    log.warning("Unexpected /entities payload, skipping tick: %s", str(payload)[:200])
    return None


def _publish(client: httpx.Client, records: list[dict]) -> None:
    """
    Send one batch, moving on if this endpoint or envelope is not the right one.

    Raises on failure: the caller counts it, records it and carries on.
    """
    global _publish_index, _body_index

    token = _bearer_token(client)
    if not token:
        raise RuntimeError(_token_error or "no Foundry credential available yet")

    candidates = _publish_url_candidates()
    if not candidates:
        raise RuntimeError("no publish URL: missing Foundry URL or stream RID")

    while True:
        url = _publish_url()
        redacted = _redact(url)
        if redacted not in _publish_urls_tried:
            _publish_urls_tried.append(redacted)
        response = client.post(
            url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            content=_body(records),
            timeout=10,
        )
        # Wrong endpoint for this stack or this token: move to the next and stay.
        #
        # 401/403 count as "wrong endpoint for this credential", not just as
        # "unauthorised". A job token is scoped to declared resources and a
        # gateway that will not accept it rejects with one of those rather than a
        # 404 — so without them here, a single auth-shaped refusal would raise and
        # the candidate that actually works would never be tried.
        if response.status_code in (401, 403, 404, 405) and _publish_index < len(candidates) - 1:
            log.warning("Publish endpoint %s returned %d, trying the next candidate", redacted, response.status_code)
            _publish_index += 1
            continue
        # Right endpoint, wrong envelope: try the other record shape once.
        if response.status_code in (400, 415, 422) and _body_index < len(_BODY_SHAPES) - 1:
            log.warning(
                "Publish to %s rejected the '%s' record envelope (%d: %s), trying '%s'",
                redacted,
                _BODY_SHAPES[_body_index],
                response.status_code,
                (response.text or "")[:200],
                _BODY_SHAPES[_body_index + 1],
            )
            _body_index += 1
            continue
        if response.status_code >= 400:
            # The body names the offending column or record, which is the only way
            # to debug a schema mismatch from outside the platform.
            raise RuntimeError(
                f"HTTP {response.status_code} from {redacted}{' — ' + response.text[:300] if response.text else ''}"
            )
        return


def _ssl_context() -> "ssl.SSLContext | bool":
    """
    A trust store containing both the system CAs and the mounted Foundry CA.

    DEFAULT_CA_PATH is documented as the certificate to use when connecting
    to the compute module service, while the functions mode example passes
    it as the trust store for calls to the enrollment URL. Both can be true,
    but passing that PEM alone as the verify argument breaks the enrollment
    call outright if Foundry's certificate is signed by a public CA, and the
    failure looks like a new bug rather than a misused variable. Loading the
    system defaults and then adding the mounted PEM satisfies either case, so
    the certificate chain stops being something to guess about.
    """
    if not CA_BUNDLE:
        return True
    try:
        context = ssl.create_default_context()
        context.load_verify_locations(cafile=CA_BUNDLE)
        return context
    except Exception as exc:  # noqa: BLE001 - fall back rather than fail to start
        log.warning(
            "Could not load the CA bundle at %s (%s); verifying against the system trust store only.", CA_BUNDLE, exc
        )
        return True


def _client() -> httpx.Client:
    return httpx.Client(verify=_ssl_context())


# ── Shared primitives ─────────────────────────────────────────────────────────
#
# Exposed for commands.py, which consumes the command stream and publishes each
# command's outcome. Sharing these means one implementation of base-URL
# normalisation, credential discovery and TLS trust rather than two that drift
# apart — the publish path here was hard-won and should not be reimplemented.


def http_client() -> httpx.Client:
    """An httpx client with the platform CA trust configured."""
    return _client()


def bearer_token(client: httpx.Client) -> str:
    """A bearer token: the mounted job token, or minted client credentials."""
    return _bearer_token(client)


def base_url() -> str:
    """The Foundry base URL, with a scheme and no trailing slash."""
    return FOUNDRY_BASE_URL


def resolve_alias(alias: str, fallback_rid: str = "", fallback_branch: str = "master") -> tuple[str, str, str]:
    """
    A stream RID and branch for a resource alias, with an explicit fallback.

    The alias wins when it resolves: it is the identifier the module
    configuration actually grants a token for, so a mismatched explicit RID would
    fail with a permission error rather than anything obvious.
    """
    entry = ALIAS_MAP.get(alias) if alias else None
    if isinstance(entry, dict) and entry.get("rid"):
        return entry["rid"], entry.get("branch") or fallback_branch, f"alias '{alias}'"
    if fallback_rid:
        return fallback_rid, fallback_branch, "explicit RID"
    return (
        "",
        fallback_branch,
        (f"unresolved (alias '{alias}'; {ALIAS_MAP_ERROR or 'known: ' + str(sorted(ALIAS_MAP))})"),
    )


def _loop() -> None:
    federation = None
    federation_checked_at = 0.0
    consecutive_failures = 0

    with _client() as client:
        while True:
            started = time.monotonic()
            try:
                # The federation name changes only on reconnect, so re-read it
                # occasionally rather than every tick.
                if time.monotonic() - federation_checked_at > 60:
                    try:
                        status_response = client.get(f"{BRIDGE_URL}/status", timeout=5)
                        if status_response.status_code == 200:
                            federation = status_response.json().get("federationName")
                    except Exception:  # noqa: BLE001 - never fatal
                        pass
                    federation_checked_at = time.monotonic()

                # Poll and publish are counted separately. Lumping them together
                # made a connection error ambiguous — it could be the bridge on
                # localhost or Foundry — and resolving that ambiguity is the whole
                # point of these counters.
                try:
                    entities = _poll_entities(client)
                    _bump(**{"+polls": 1})
                except Exception as exc:  # noqa: BLE001
                    consecutive_failures += 1
                    _bump(
                        **{"+poll_failures": 1},
                        last_error=f"polling {BRIDGE_URL}/entities — {type(exc).__name__}: {exc}",
                    )
                    if consecutive_failures <= 3 or consecutive_failures % 300 == 0:
                        log.warning("Could not poll the bridge (%d consecutive): %s", consecutive_failures, exc)
                    entities = None

                if entities:
                    observed_millis = int(time.time() * 1000)
                    observed_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                    records = [to_record(e, observed_at, observed_millis, federation) for e in entities]
                    try:
                        _publish(client, records)
                        if consecutive_failures:
                            log.info("Track publishing recovered after %d failure(s)", consecutive_failures)
                        _bump(
                            **{"+records_published": len(records)},
                            last_published_at=observed_at,
                            last_record_count=len(records),
                            last_error=None,
                        )
                        consecutive_failures = 0
                    except Exception as exc:  # noqa: BLE001
                        consecutive_failures += 1
                        _bump(
                            **{"+publish_failures": 1},
                            last_error=f"publishing to {_redact(_publish_url())} — {type(exc).__name__}: {exc}",
                        )
                        if consecutive_failures <= 3 or consecutive_failures % 300 == 0:
                            log.warning("Track publish failed (%d consecutive): %s", consecutive_failures, exc)
                elif entities is not None:
                    # Connected, nothing discovered. Not an error, and not worth
                    # a row: an empty tick is already implied by the gap.
                    _bump(last_record_count=0)

            except Exception as exc:  # noqa: BLE001 - the thread must never die
                _bump(last_error=f"loop: {type(exc).__name__}: {exc}")
                log.warning("Track publisher loop error: %s", exc)

            # Fixed rate rather than fixed delay, so the sample interval does not
            # drift with how long the poll took.
            elapsed = time.monotonic() - started
            time.sleep(max(0.05, POLL_SECONDS - elapsed))


def start() -> None:
    """
    Start the publisher if it is configured; otherwise say why and do nothing.

    Deliberately not fatal when unconfigured: exiting would put the container in a
    restart loop, which loses the diagnostics that say what is missing.
    """
    configured, reason = is_configured()
    if not configured:
        log.warning("Entity track publisher is OFF: %s. Full configuration: %s", reason, status())
        return

    log.info(
        "Entity track publisher: stream %s (branch %s) from %s; Foundry at %s "
        "(from %s); credentials: %s; CA bundle: %s",
        STREAM_DATASET_RID,
        STREAM_BRANCH,
        STREAM_SOURCE,
        _redact(FOUNDRY_BASE_URL),
        BASE_URL_SOURCE,
        CREDENTIAL_MODE,
        CA_BUNDLE or "system default",
    )

    # The egress check. A compute module cannot reach the enrollment URL until a
    # source with a network policy for it is attached, and the symptom is a DNS
    # error while fetching a token — which reads as an auth problem. Say it here
    # instead, once, in the words of the fix.
    if FOUNDRY_BASE_URL:
        resolves, why = _host_resolves(FOUNDRY_BASE_URL)
        if not resolves:
            log.error(
                "%s does not resolve from inside this container (%s). Add a source "
                "with a network policy that allows access to the Foundry URL to "
                "this compute module — without it every publish fails with a DNS "
                "error that looks like an authentication failure.",
                _redact(FOUNDRY_BASE_URL),
                why,
            )
    if not CA_BUNDLE:
        log.warning(
            "DEFAULT_CA_PATH is not set, so Foundry's certificate is verified "
            "against the system trust store. If publishes fail with a "
            "certificate error, this is why."
        )

    thread = threading.Thread(target=_loop, name="entity-track-publisher", daemon=True)
    thread.start()
    _bump(running=True)
    log.info("Entity track publisher started: every %.1fs to %s", POLL_SECONDS, _redact(_publish_url()))
