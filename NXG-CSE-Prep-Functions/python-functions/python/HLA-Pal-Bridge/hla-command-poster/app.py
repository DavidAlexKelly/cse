"""
HLA command gateway.

Validates commands, ensures a stream exists on the configured streaming dataset
branch, then publishes each command as a record. The consumer (bridge compute
module) reads the stream and executes against the local bridge REST API.
"""

import json
import logging
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, NotRequired, TypedDict

import httpx
from compute_modules.annotations import function
from compute_modules.auth import RefreshingOauthToken
from compute_modules import start_compute_module

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────────────────

FOUNDRY_URL = os.environ["FOUNDRY_URL"]
BASE_URL = f"https://{FOUNDRY_URL}"
CA_PATH = os.environ["DEFAULT_CA_PATH"]

# RID of an existing *streaming* dataset (created via + New → Stream, or
# POST /api/v2/streams/datasets/create). Not a normal batch dataset.
COMMAND_STREAM_RID = os.environ["COMMAND_STREAM_RID"]
COMMAND_STREAM_BRANCH = os.environ.get("COMMAND_STREAM_BRANCH", "master")

PUBLISH_PATH_TEMPLATE = os.environ.get(
    "COMMAND_PUBLISH_PATH",
    "/api/v2/highScale/streams/datasets/{dataset_rid}/streams/{branch}/publishRecords",
)

PUBLISH_TIMEOUT_SECONDS = float(os.environ.get("PUBLISH_TIMEOUT_SECONDS", "15"))

# Group tasking reads current entity state from the entity track stream. Unset
# means the group functions are unavailable and say so, rather than the module
# failing to start.
TRACK_STREAM_RID = os.environ.get("TRACK_STREAM_RID", "").strip()
TRACK_STREAM_BRANCH = os.environ.get("TRACK_STREAM_BRANCH", "master").strip()
TRACK_RECORDS_PATH = os.environ.get(
    "TRACK_RECORDS_PATH",
    "/stream-proxy/api/streams/{dataset_rid}/branches/{branch}/records",
)
# Ceiling on how many entities one group command may task. A selector that
# matches more is refused rather than truncated: silently tasking a subset is
# worse than refusing, because the caller believes the whole group was ordered.
MAX_GROUP_SIZE = int(os.environ.get("MAX_GROUP_SIZE", "50"))
DEFAULT_TTL_SECONDS = int(os.environ.get("COMMAND_TTL_SECONDS", "120"))
CONTROL_TTL_SECONDS = int(os.environ.get("CONTROL_TTL_SECONDS", "15"))

SCHEMA_VERSION = 1

# Must match the stream schema on the dataset. Adjust if your UI schema differs.
COMMAND_STREAM_SCHEMA: dict[str, Any] = {
    "fields": [
        {
            "name": "schema_version",
            "schema": {"nullable": False, "dataType": {"type": "integer"}},
        },
        {
            "name": "command_id",
            "schema": {"nullable": False, "dataType": {"type": "string"}},
        },
        {
            "name": "correlation_id",
            "schema": {"nullable": False, "dataType": {"type": "string"}},
        },
        {
            "name": "issued_at",
            "schema": {"nullable": False, "dataType": {"type": "string"}},
        },
        {
            "name": "issued_by",
            "schema": {"nullable": False, "dataType": {"type": "string"}},
        },
        {
            "name": "operation",
            "schema": {"nullable": False, "dataType": {"type": "string"}},
        },
        {
            "name": "target_kind",
            "schema": {"nullable": False, "dataType": {"type": "string"}},
        },
        {
            "name": "entity_uuid",
            "schema": {"nullable": True, "dataType": {"type": "string"}},
        },
        {
            "name": "partition_key",
            "schema": {"nullable": False, "dataType": {"type": "string"}},
        },
        {
            "name": "params",
            "schema": {"nullable": False, "dataType": {"type": "string"}},
        },
        {
            "name": "ttl_seconds",
            "schema": {"nullable": False, "dataType": {"type": "integer"}},
        },
        {
            "name": "not_before",
            "schema": {"nullable": True, "dataType": {"type": "string"}},
        },
    ],
    # Uncomment if you configured a key in the UI:
    # "keyFieldNames": ["partition_key"],
}

_token = RefreshingOauthToken(
    hostname=FOUNDRY_URL,
    scope=["api:streams-write", "api:streams-read", "api:use-streams-read", "api:use-streams-write"],
)

_http = httpx.Client(verify=CA_PATH, timeout=PUBLISH_TIMEOUT_SECONDS)

_stream_ready = False
_stream_lock = threading.Lock()


# ── Operations ───────────────────────────────────────────────────────────────


class Op:
    MOVE = "MOVE"
    PATROL = "PATROL"
    MAGIC_MOVE = "MAGIC_MOVE"
    FIRE_AT_LOCATION = "FIRE_AT_LOCATION"
    FIRE_AT_ENTITY = "FIRE_AT_ENTITY"
    ROE = "ROE"
    CANCEL_TASKS = "CANCEL_TASKS"
    CHANGE_HEADING = "CHANGE_HEADING"
    CHANGE_SPEED = "CHANGE_SPEED"
    CHANGE_ALTITUDE = "CHANGE_ALTITUDE"
    STOP_AT_SIDE_OF_ROAD = "STOP_AT_SIDE_OF_ROAD"
    INJECT_SUPPLIES = "INJECT_SUPPLIES"
    AGGREGATE = "AGGREGATE"
    DISAGGREGATE = "DISAGGREGATE"
    CREATE_OBSTACLE = "CREATE_OBSTACLE"
    DISRUPT_COMMS = "DISRUPT_COMMS"
    SIM_START = "SIM_START"
    SIM_PAUSE = "SIM_PAUSE"
    SIM_STOP = "SIM_STOP"
    CONNECT = "CONNECT"
    DISCONNECT = "DISCONNECT"
    RECONNECT = "RECONNECT"


TARGET_ENTITY = "ENTITY"
TARGET_MAP = "MAP"
TARGET_SIM = "SIM"
TARGET_CONTROL = "CONTROL"

MOVE_TYPES = {"FASTEST", "SHORTEST", "TACTICAL", "DIRECT"}
PATROL_TYPES = {"ONCE", "REPEATING", "RANDOM"}
ROE_VALUES = {
    "HOLD_FIRE",
    "RETURN_FIRE",
    "FIRE_AT_WILL",
    "WEAPONS_TIGHT",
    "WEAPONS_FREE",
}
RESOURCE_TYPES = {"FUEL", "AMMUNITION", "WATER", "RATIONS"}

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


class CommandRejected(Exception):
    """Validation or publish failed. Nothing was queued."""


# ── Validation ───────────────────────────────────────────────────────────────


def _require(event: dict, key: str) -> Any:
    if key not in event or event[key] is None:
        raise CommandRejected(f"{key} is required")
    return event[key]


def _require_uuid(value: Any, field_name: str = "entity_id") -> str:
    if not isinstance(value, str) or not _UUID_RE.match(value.strip()):
        raise CommandRejected(
            f"{field_name} must be a NETN UniqueId (UUID), got {value!r}. HLA object handles are not accepted."
        )
    return value.strip().lower()


def _require_lat_lon(lat: Any, lon: Any) -> tuple[float, float]:
    try:
        lat_f, lon_f = float(lat), float(lon)
    except (TypeError, ValueError):
        raise CommandRejected(f"latitude/longitude must be numbers, got {lat!r}, {lon!r}")
    if not -90.0 <= lat_f <= 90.0:
        raise CommandRejected(f"latitude {lat_f} out of range [-90, 90]")
    if not -180.0 <= lon_f <= 180.0:
        raise CommandRejected(f"longitude {lon_f} out of range [-180, 180]")
    return lat_f, lon_f


def _require_choice(value: Any, allowed: set[str], field_name: str) -> str:
    upper = str(value).strip().upper()
    if upper not in allowed:
        raise CommandRejected(f"{field_name} must be one of {sorted(allowed)}, got {value!r}")
    return upper


def _require_positive(value: Any, field_name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise CommandRejected(f"{field_name} must be a number, got {value!r}")
    if number <= 0:
        raise CommandRejected(f"{field_name} must be greater than zero, got {number}")
    return number


def _normalise_heading(degrees: Any) -> float:
    try:
        return float(degrees) % 360.0
    except (TypeError, ValueError):
        raise CommandRejected(f"heading_degrees must be a number, got {degrees!r}")


# ── Auth / identity ──────────────────────────────────────────────────────────


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_token.get_token()}"}


def _caller(context: Any) -> str:
    for attribute in ("user_id", "userId", "subject", "principal_id"):
        value = getattr(context, attribute, None)
        if value:
            return str(value)
    auth = getattr(context, "auth", None)
    if auth is not None:
        for attribute in ("user_id", "userId"):
            value = getattr(auth, attribute, None)
            if value:
                return str(value)
    return "unknown"


# ── Ensure stream on existing streaming dataset ──────────────────────────────


def _ensure_stream() -> None:
    """
    Checks for the stream on the branch, and creates it (in preview) if the
    Get Stream call reports StreamNotFound.

    Requires COMMAND_STREAM_RID to already be a streaming dataset. Create
    Stream is POST /api/v2/streams/datasets/{datasetRid}/streams?preview=true.
    """
    global _stream_ready
    if _stream_ready:
        return

    with _stream_lock:
        if _stream_ready:
            return

        get_url = f"{BASE_URL}/api/v2/streams/datasets/{COMMAND_STREAM_RID}/streams/{COMMAND_STREAM_BRANCH}"
        try:
            get_resp = _http.get(get_url, headers=_auth_headers())
        except httpx.HTTPError as exc:
            raise CommandRejected(f"Could not reach Get Stream API: {exc}") from exc

        if get_resp.status_code == 200:
            log.info(
                "Stream already exists on %s branch %s",
                COMMAND_STREAM_RID,
                COMMAND_STREAM_BRANCH,
            )
            _stream_ready = True
            return

        if get_resp.status_code not in (404,):
            raise CommandRejected(f"Get Stream failed HTTP {get_resp.status_code}: {get_resp.text[:500]}")

        log.info(
            "Stream not found on %s/%s — creating (preview)",
            COMMAND_STREAM_RID,
            COMMAND_STREAM_BRANCH,
        )
        create_url = f"{BASE_URL}/api/v2/streams/datasets/{COMMAND_STREAM_RID}/streams"
        body = {
            "branchName": COMMAND_STREAM_BRANCH,
            "schema": COMMAND_STREAM_SCHEMA,
            "partitionsCount": int(os.environ.get("COMMAND_STREAM_PARTITIONS", "1")),
            "streamType": os.environ.get("COMMAND_STREAM_TYPE", "LOW_LATENCY"),
            "compressed": False,
        }
        try:
            create_resp = _http.post(
                create_url,
                params={"preview": "true"},
                headers={**_auth_headers(), "Content-Type": "application/json"},
                json=body,
            )
        except httpx.HTTPError as exc:
            raise CommandRejected(f"Could not reach Create Stream API: {exc}") from exc

        # 409 Branch Already Exists → concurrent create; re-GET
        if create_resp.status_code == 409:
            log.info("Create Stream returned 409 (branch exists); re-checking GET")
            get_resp = _http.get(get_url, headers=_auth_headers())
            if get_resp.status_code == 200:
                _stream_ready = True
                return
            raise CommandRejected(f"Stream still missing after 409: GET {get_resp.status_code} {get_resp.text[:300]}")

        if create_resp.status_code >= 400:
            raise CommandRejected(f"Create Stream failed HTTP {create_resp.status_code}: {create_resp.text[:500]}")

        log.info(
            "Created stream on %s branch %s: %s",
            COMMAND_STREAM_RID,
            COMMAND_STREAM_BRANCH,
            create_resp.text[:200],
        )
        _stream_ready = True


# ── Publish ──────────────────────────────────────────────────────────────────


def _publish(record: dict[str, Any]) -> dict[str, Any]:
    _ensure_stream()

    url = BASE_URL + PUBLISH_PATH_TEMPLATE.format(
        dataset_rid=COMMAND_STREAM_RID,
        branch=COMMAND_STREAM_BRANCH,
    )
    try:
        response = _http.post(
            url,
            headers={**_auth_headers(), "Content-Type": "application/json"},
            json={"records": [record]},
        )
    except httpx.HTTPError as exc:
        raise CommandRejected(f"Could not reach publish API: {exc}") from exc

    if response.status_code >= 400:
        # One recovery: stream disappeared / never created → clear cache & retry once
        if response.status_code == 404 and "StreamNotFound" in response.text:
            global _stream_ready
            with _stream_lock:
                _stream_ready = False
            _ensure_stream()
            response = _http.post(
                url,
                headers={**_auth_headers(), "Content-Type": "application/json"},
                json={"records": [record]},
            )

        if response.status_code >= 400:
            raise CommandRejected(
                f"Publishing to the command stream failed with HTTP {response.status_code}: {response.text[:500]}"
            )

    log.info(
        "Queued %s command %s for %s by %s",
        record["operation"],
        record["command_id"],
        record["entity_uuid"] or record["target_kind"],
        record["issued_by"],
    )
    return {
        "ok": True,
        "status": "queued",
        "commandId": record["command_id"],
        "operation": record["operation"],
        "issuedAt": record["issued_at"],
        "expiresInSeconds": record["ttl_seconds"],
        "note": ("Queued on the stream, not executed. Correlate outcomes on commandId."),
    }


def _record(
    context: Any,
    operation: str,
    target_kind: str,
    entity_uuid: str | None,
    params: dict[str, Any],
    ttl_seconds: int | None = None,
    not_before: str | None = None,
    correlation_id: str | None = None,
) -> dict[str, Any]:
    """
    One command row.

    correlation_id defaults to the command_id, which is what a single-entity
    command wants. A group command passes one shared correlation_id across
    every row it emits, so working out what one order actually did is a
    single query against the outcome stream rather than a reconstruction from
    timestamps.
    """
    command_id = str(uuid.uuid4())
    return {
        "schema_version": SCHEMA_VERSION,
        "command_id": command_id,
        "correlation_id": correlation_id or command_id,
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "issued_by": _caller(context),
        "operation": operation,
        "target_kind": target_kind,
        "entity_uuid": entity_uuid,
        "partition_key": entity_uuid or target_kind,
        "params": json.dumps(params, separators=(",", ":"), sort_keys=True),
        "ttl_seconds": DEFAULT_TTL_SECONDS if ttl_seconds is None else ttl_seconds,
        "not_before": not_before,
    }


def _command(
    context: Any,
    operation: str,
    target_kind: str,
    entity_uuid: str | None,
    params: dict[str, Any],
    ttl_seconds: int | None = None,
    not_before: str | None = None,
) -> str:
    return json.dumps(
        _publish(
            _record(
                context,
                operation,
                target_kind,
                entity_uuid,
                params,
                ttl_seconds,
                not_before,
            )
        )
    )


# ── Movement ─────────────────────────────────────────────────────────────────


class MoveRequest(TypedDict):
    entity_id: str
    latitude: float
    longitude: float
    move_type: NotRequired[str]
    speed_meters_per_second: NotRequired[float]


@function
def hla_move_to_location(context, event: MoveRequest) -> str:
    lat, lon = _require_lat_lon(_require(event, "latitude"), _require(event, "longitude"))
    params: dict[str, Any] = {
        "latitude": lat,
        "longitude": lon,
        "moveType": _require_choice(event.get("move_type", "FASTEST"), MOVE_TYPES, "move_type"),
    }
    if event.get("speed_meters_per_second") is not None:
        params["speedMetersPerSecond"] = _require_positive(event["speed_meters_per_second"], "speed_meters_per_second")
    return _command(context, Op.MOVE, TARGET_ENTITY, _require_uuid(_require(event, "entity_id")), params)


class WaypointInput(TypedDict):
    latitude: float
    longitude: float
    speed_meters_per_second: NotRequired[float]


class PatrolRequest(TypedDict):
    entity_id: str
    waypoints: list[WaypointInput]
    patrol_type: NotRequired[str]
    move_type: NotRequired[str]
    duration_seconds: NotRequired[float]
    interval_seconds: NotRequired[float]


@function
def hla_patrol(context, event: PatrolRequest) -> str:
    waypoints = _require(event, "waypoints")
    if not isinstance(waypoints, list) or len(waypoints) < 2:
        raise CommandRejected(
            f"patrol needs at least two waypoints, got {len(waypoints) if isinstance(waypoints, list) else waypoints!r}"
        )
    points: list[dict[str, Any]] = []
    for index, point in enumerate(waypoints):
        lat, lon = _require_lat_lon(point.get("latitude"), point.get("longitude"))
        entry: dict[str, Any] = {"latitude": lat, "longitude": lon}
        if point.get("speed_meters_per_second") is not None:
            entry["speedMetersPerSecond"] = _require_positive(
                point["speed_meters_per_second"], f"waypoints[{index}].speed"
            )
        points.append(entry)
    params: dict[str, Any] = {
        "waypoints": points,
        "patrolType": _require_choice(event.get("patrol_type", "ONCE"), PATROL_TYPES, "patrol_type"),
        "moveType": _require_choice(event.get("move_type", "FASTEST"), MOVE_TYPES, "move_type"),
    }
    if event.get("duration_seconds") is not None:
        params["durationSeconds"] = _require_positive(event["duration_seconds"], "duration_seconds")
    if event.get("interval_seconds") is not None:
        params["intervalSeconds"] = _require_positive(event["interval_seconds"], "interval_seconds")
    return _command(context, Op.PATROL, TARGET_ENTITY, _require_uuid(_require(event, "entity_id")), params)


class MagicMoveRequest(TypedDict):
    entity_id: str
    latitude: float
    longitude: float
    heading_degrees: NotRequired[float]
    altitude_meters: NotRequired[float]


@function
def hla_magic_move(context, event: MagicMoveRequest) -> str:
    lat, lon = _require_lat_lon(_require(event, "latitude"), _require(event, "longitude"))
    params: dict[str, Any] = {
        "latitude": lat,
        "longitude": lon,
        "headingDegrees": _normalise_heading(event.get("heading_degrees", 0.0)),
    }
    if event.get("altitude_meters") is not None:
        params["altitudeMeters"] = float(event["altitude_meters"])
    return _command(
        context,
        Op.MAGIC_MOVE,
        TARGET_ENTITY,
        _require_uuid(_require(event, "entity_id")),
        params,
    )


# ── Fires ────────────────────────────────────────────────────────────────────


class FireAtLocationRequest(TypedDict):
    entity_id: str
    latitude: float
    longitude: float
    duration_seconds: float
    altitude_meters: NotRequired[float]


@function
def hla_fire_at_location(context, event: FireAtLocationRequest) -> str:
    lat, lon = _require_lat_lon(_require(event, "latitude"), _require(event, "longitude"))
    params: dict[str, Any] = {
        "latitude": lat,
        "longitude": lon,
        "durationSeconds": _require_positive(_require(event, "duration_seconds"), "duration_seconds"),
        "altitudeMeters": float(event.get("altitude_meters") or 0.0),
    }
    return _command(
        context,
        Op.FIRE_AT_LOCATION,
        TARGET_ENTITY,
        _require_uuid(_require(event, "entity_id")),
        params,
    )


class FireAtEntityRequest(TypedDict):
    entity_id: str
    target_id: str
    duration_seconds: NotRequired[float]


@function
def hla_fire_at_entity(context, event: FireAtEntityRequest) -> str:
    shooter = _require_uuid(_require(event, "entity_id"), "entity_id")
    target = _require_uuid(_require(event, "target_id"), "target_id")
    if shooter == target:
        raise CommandRejected("entity_id and target_id are the same unit")
    params: dict[str, Any] = {"targetUuid": target}
    if event.get("duration_seconds") is not None:
        params["durationSeconds"] = _require_positive(event["duration_seconds"], "duration_seconds")
    return _command(context, Op.FIRE_AT_ENTITY, TARGET_ENTITY, shooter, params)


# ── Posture ──────────────────────────────────────────────────────────────────


class RoeRequest(TypedDict):
    entity_id: str
    roe: str


@function
def hla_set_roe(context, event: RoeRequest) -> str:
    params = {"roe": _require_choice(_require(event, "roe"), ROE_VALUES, "roe")}
    return _command(context, Op.ROE, TARGET_ENTITY, _require_uuid(_require(event, "entity_id")), params)


class EntityOnlyRequest(TypedDict):
    entity_id: str


@function
def hla_cancel_tasks(context, event: EntityOnlyRequest) -> str:
    return _command(
        context,
        Op.CANCEL_TASKS,
        TARGET_ENTITY,
        _require_uuid(_require(event, "entity_id")),
        {},
    )


@function
def hla_stop_entity(context, event: EntityOnlyRequest) -> str:
    return _command(
        context,
        Op.STOP_AT_SIDE_OF_ROAD,
        TARGET_ENTITY,
        _require_uuid(_require(event, "entity_id")),
        {},
    )


class HeadingRequest(TypedDict):
    entity_id: str
    heading_degrees: float


@function
def hla_set_heading(context, event: HeadingRequest) -> str:
    params = {"headingDegrees": _normalise_heading(_require(event, "heading_degrees"))}
    return _command(
        context,
        Op.CHANGE_HEADING,
        TARGET_ENTITY,
        _require_uuid(_require(event, "entity_id")),
        params,
    )


class SpeedRequest(TypedDict):
    entity_id: str
    speed_meters_per_second: float


@function
def hla_set_speed(context, event: SpeedRequest) -> str:
    params = {
        "speedMetersPerSecond": _require_positive(_require(event, "speed_meters_per_second"), "speed_meters_per_second")
    }
    return _command(
        context,
        Op.CHANGE_SPEED,
        TARGET_ENTITY,
        _require_uuid(_require(event, "entity_id")),
        params,
    )


class AltitudeRequest(TypedDict):
    entity_id: str
    altitude_meters: float


@function
def hla_set_altitude(context, event: AltitudeRequest) -> str:
    params = {"altitudeMeters": float(_require(event, "altitude_meters"))}
    return _command(
        context,
        Op.CHANGE_ALTITUDE,
        TARGET_ENTITY,
        _require_uuid(_require(event, "entity_id")),
        params,
    )


# ── Logistics ────────────────────────────────────────────────────────────────


class InjectSuppliesRequest(TypedDict):
    entity_id: str
    resource_type: str
    quantity: NotRequired[float]
    supply_type: NotRequired[str]


@function
def hla_inject_supplies(context, event: InjectSuppliesRequest) -> str:
    params: dict[str, Any] = {
        "resourceType": _require_choice(_require(event, "resource_type"), RESOURCE_TYPES, "resource_type")
    }
    if event.get("quantity") is not None:
        params["quantity"] = _require_positive(event["quantity"], "quantity")
    if event.get("supply_type"):
        params["supplyType"] = str(event["supply_type"])
    return _command(
        context,
        Op.INJECT_SUPPLIES,
        TARGET_ENTITY,
        _require_uuid(_require(event, "entity_id")),
        params,
    )


class AggregationRequest(TypedDict):
    entity_id: str
    federate: NotRequired[str]
    remove_subunits: NotRequired[bool]


@function
def hla_aggregate(context, event: AggregationRequest) -> str:
    params: dict[str, Any] = {}
    if event.get("federate"):
        params["federate"] = str(event["federate"])
    if event.get("remove_subunits") is not None:
        params["removeSubunits"] = bool(event["remove_subunits"])
    return _command(
        context,
        Op.AGGREGATE,
        TARGET_ENTITY,
        _require_uuid(_require(event, "entity_id")),
        params,
    )


@function
def hla_disaggregate(context, event: AggregationRequest) -> str:
    params: dict[str, Any] = {}
    if event.get("federate"):
        params["federate"] = str(event["federate"])
    return _command(
        context,
        Op.DISAGGREGATE,
        TARGET_ENTITY,
        _require_uuid(_require(event, "entity_id")),
        params,
    )


# ── Environment ──────────────────────────────────────────────────────────────


class ObstacleRequest(TypedDict):
    entity_id: str
    obstacle_type: str
    latitude: float
    longitude: float
    radius_km: NotRequired[float]


@function
def hla_create_obstacle(context, event: ObstacleRequest) -> str:
    lat, lon = _require_lat_lon(_require(event, "latitude"), _require(event, "longitude"))
    params = {
        "obstacleType": str(_require(event, "obstacle_type")),
        "latitude": lat,
        "longitude": lon,
        "radiusKm": _require_positive(event.get("radius_km", 0.5), "radius_km"),
    }
    return _command(
        context,
        Op.CREATE_OBSTACLE,
        TARGET_MAP,
        _require_uuid(_require(event, "entity_id")),
        params,
    )


class DisruptCommsRequest(TypedDict):
    entity_id: str
    latitude: float
    longitude: float
    radius_km: float
    enabled: NotRequired[bool]
    network: NotRequired[str]


@function
def hla_disrupt_comms(context, event: DisruptCommsRequest) -> str:
    lat, lon = _require_lat_lon(_require(event, "latitude"), _require(event, "longitude"))
    params: dict[str, Any] = {
        "latitude": lat,
        "longitude": lon,
        "radiusKm": _require_positive(_require(event, "radius_km"), "radius_km"),
        "enabled": bool(event.get("enabled", True)),
    }
    if event.get("network"):
        params["network"] = _require_uuid(event["network"], "network")
    return _command(
        context,
        Op.DISRUPT_COMMS,
        TARGET_MAP,
        _require_uuid(_require(event, "entity_id")),
        params,
    )


# ── Sim / control ────────────────────────────────────────────────────────────


class EmptyRequest(TypedDict):
    pass


@function
def hla_sim_start(context, event: EmptyRequest) -> str:
    return _command(context, Op.SIM_START, TARGET_SIM, None, {})


@function
def hla_sim_pause(context, event: EmptyRequest) -> str:
    return _command(context, Op.SIM_PAUSE, TARGET_SIM, None, {"reason": "PAUSE"})


@function
def hla_sim_stop(context, event: EmptyRequest) -> str:
    return _command(context, Op.SIM_STOP, TARGET_SIM, None, {"reason": "STOP"})


@function
def hla_connect(context, event: EmptyRequest) -> str:
    """
    Join the federation for the first time, when the bridge started idle.

    With BRIDGE_AUTO_CONNECT=false the bridge serves its REST API and runs its
    loop without joining, so it holds no pRTI licence seat until told to. This
    is what tells it to.

    Mechanically identical to hla_reconnect — both resolve to POST /reconnect on
    the bridge, because the run loop services a first join and a rejoin through
    the same path. They are separate functions because the intent differs, and
    the command stream is the audit trail: "CONNECT" at the top of an exercise
    reads as the deliberate start it was, where a "RECONNECT" would imply
    something had dropped.

    Safe to send when already connected — the bridge answers "no-action".
    """
    return _command(
        context,
        Op.CONNECT,
        TARGET_CONTROL,
        None,
        {},
        ttl_seconds=CONTROL_TTL_SECONDS,
    )


@function
def hla_disconnect(context, event: EmptyRequest) -> str:
    return _command(
        context,
        Op.DISCONNECT,
        TARGET_CONTROL,
        None,
        {},
        ttl_seconds=CONTROL_TTL_SECONDS,
    )


@function
def hla_reconnect(context, event: EmptyRequest) -> str:
    return _command(
        context,
        Op.RECONNECT,
        TARGET_CONTROL,
        None,
        {},
        ttl_seconds=CONTROL_TTL_SECONDS,
    )


# ── Group tasking ────────────────────────────────────────────────────────────
#
# One order, many entities. "Move all friendly forces to point A" is one
# intent, and the fan-out from intent to many commands belongs here rather
# than in whatever is calling it - an LLM, a lasso select on the map, a
# Workshop button.
#
# The division of labour matters: a caller decides what to do and what kind
# of order it is, while this module decides exactly which entities, from
# live state. A caller that enumerates entity ids itself can miss one,
# duplicate one, or invent one, and for "all friendly forces" almost-right
# is worse than useless.
#
# Deliberately stateless. There is no stored plan: the preview and the
# execute calls take the same arguments, and execute re-resolves the
# selector from scratch. Compute modules can run several replicas, so a plan
# cached in memory on one replica would not be found by the next call.
# Instead, execute requires the caller to echo back the entity count the
# preview showed it, and refuses if the world has changed since - see
# _resolve_group.


# Operations a group order may carry. Weapons and umpire actions are absent by
# design, not by oversight: fanning a fire mission out across a selector is a
# different kind of decision from moving a formation, and it should be made one
# entity at a time through the single-entity functions above.
GROUP_OPS = {
    Op.MOVE,
    Op.MAGIC_MOVE,
    Op.CHANGE_SPEED,
    Op.CHANGE_ALTITUDE,
    Op.CHANGE_HEADING,
    Op.STOP_AT_SIDE_OF_ROAD,
    Op.CANCEL_TASKS,
}

# Track-row fields a selector may filter on, and the merged-entity key each maps
# to. Anything else is rejected rather than ignored: a caller that invents a
# field name should be told, not silently handed the whole federation.
SELECTOR_FIELDS = {
    "force_id": "force_id",
    "entity_type": "entity_type",
    "simulator": "simulator",
    "echelon": "echelon",
}

# Track-row columns that carry entity state, newest non-null wins on merge.
_TRACK_FIELDS = (
    "unique_id",
    "entity_id",
    "name",
    "callsign",
    "entity_type",
    "dis_type",
    "force_id",
    "simulator",
    "symbol_id",
    "latitude",
    "longitude",
    "altitude_m",
    "heading_deg",
    "speed_mps",
    "damage_state",
    "aggregate_state",
    "activity",
    "posture",
    "mission",
    "echelon",
    "combat_value",
    "is_command_post",
)


def _track_records() -> list[dict[str, Any]]:
    """Recent raw rows from the entity track stream."""
    if not TRACK_STREAM_RID:
        raise CommandRejected(
            "Group tasking is not configured: TRACK_STREAM_RID is unset, so this "
            "module cannot read which entities exist. Set it to the entity track "
            "stream RID, or task entities one at a time."
        )
    url = BASE_URL + TRACK_RECORDS_PATH.format(
        dataset_rid=TRACK_STREAM_RID,
        branch=TRACK_STREAM_BRANCH,
    )
    try:
        response = _http.get(url, headers=_auth_headers())
    except httpx.HTTPError as exc:
        raise CommandRejected(f"Could not read the entity track stream: {exc}") from exc
    if response.status_code == 204 or not response.content:
        return []
    if response.status_code >= 400:
        raise CommandRejected(
            f"Reading the entity track stream failed with HTTP {response.status_code}: {response.text[:300]}"
        )
    try:
        payload = response.json()
    except ValueError:
        # Newline-delimited JSON is the other shape this endpoint returns.
        rows = []
        for line in response.text.splitlines():
            line = line.strip()
            if line:
                try:
                    parsed = json.loads(line)
                except ValueError:
                    continue
                if isinstance(parsed, dict):
                    rows.append(parsed)
        return rows
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        for key in ("records", "data", "values", "results"):
            value = payload.get(key)
            if isinstance(value, list):
                return [r for r in value if isinstance(r, dict)]
    return []


def _merge_tracks(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """
    Folds sparse track rows into current state per entity.

    This is the whole reason group selection lives here rather than in a
    caller. Track rows are deliberately sparse - the publisher writes null,
    never zero, for anything the federation has not reported, because no
    position and position 0,0 are different facts, and many rows carry only
    a name and nothing else.

    So the newest row for an entity is not its current state. Selecting on
    the latest row per key would read force_id as null for any entity whose
    most recent row happened to be a discovery row, and a selector for
    friendly forces would silently miss it. Rows must be merged instead,
    with the newest non-null value winning per field, which is the same
    approach used elsewhere in the codebase for the map and the SQL replay.
    """
    merged: dict[str, dict[str, Any]] = {}
    ordered = sorted(records, key=lambda r: str(r.get("observed_at") or ""))
    for row in ordered:
        key = row.get("unique_id") or row.get("entity_id")
        if not key:
            continue
        entity = merged.setdefault(str(key), {})
        for field in _TRACK_FIELDS:
            value = row.get(field)
            if value is not None:
                entity[field] = value
        entity["observed_at"] = row.get("observed_at") or entity.get("observed_at")
    return merged


def _current_entities() -> list[dict[str, Any]]:
    return list(_merge_tracks(_track_records()).values())


def _matches(entity: dict[str, Any], selector: dict[str, Any]) -> bool:
    for field, wanted in selector.items():
        actual = entity.get(SELECTOR_FIELDS[field])
        if actual is None:
            return False
        if str(actual).strip().lower() != str(wanted).strip().lower():
            return False
    return True


def _clean_selector(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or not raw:
        raise CommandRejected(
            'selector must be a non-empty object, e.g. {"force_id": "friendly"}. '
            f"Allowed fields: {sorted(SELECTOR_FIELDS)}."
        )
    unknown = sorted(set(raw) - set(SELECTOR_FIELDS))
    if unknown:
        raise CommandRejected(f"Unknown selector field(s) {unknown}. Allowed: {sorted(SELECTOR_FIELDS)}.")
    cleaned = {k: v for k, v in raw.items() if v is not None}
    if not cleaned:
        raise CommandRejected("selector has no usable values — every field was null.")
    return cleaned


def _resolve_group(selector: dict[str, Any]) -> list[dict[str, Any]]:
    """
    The entities a selector currently matches, ordered so two calls agree.

    Only entities carrying a NETN UniqueId are returned. Entities without one
    cannot be tasked at all today - see NON_NETN_TASKING.md - and including
    them in a group would produce commands that are accepted and never
    executed.
    """
    matched = [entity for entity in _current_entities() if entity.get("unique_id") and _matches(entity, selector)]
    matched.sort(key=lambda e: str(e.get("unique_id")))
    return matched


def _group_params(operation: str, event: dict[str, Any]) -> dict[str, Any]:
    """Validate and build the per-entity params for a group operation."""
    if operation in (Op.MOVE, Op.MAGIC_MOVE):
        lat, lon = _require_lat_lon(_require(event, "latitude"), _require(event, "longitude"))
        params: dict[str, Any] = {"latitude": lat, "longitude": lon}
        if operation == Op.MOVE:
            params["moveType"] = _require_choice(event.get("move_type", "FASTEST"), MOVE_TYPES, "move_type")
            if event.get("speed_meters_per_second") is not None:
                params["speedMetersPerSecond"] = _require_positive(
                    event["speed_meters_per_second"], "speed_meters_per_second"
                )
        elif event.get("heading_degrees") is not None:
            params["headingDegrees"] = _normalise_heading(event["heading_degrees"])
        return params
    if operation == Op.CHANGE_SPEED:
        return {
            "speedMetersPerSecond": _require_positive(
                _require(event, "speed_meters_per_second"), "speed_meters_per_second"
            )
        }
    if operation == Op.CHANGE_ALTITUDE:
        return {"altitudeMeters": float(_require(event, "altitude_meters"))}
    if operation == Op.CHANGE_HEADING:
        return {"headingDegrees": _normalise_heading(_require(event, "heading_degrees"))}
    return {}


def _summarise(entity: dict[str, Any]) -> dict[str, Any]:
    return {
        "uniqueId": entity.get("unique_id"),
        "name": entity.get("name") or entity.get("callsign"),
        "entityType": entity.get("entity_type"),
        "forceId": entity.get("force_id"),
        "simulator": entity.get("simulator"),
        "latitude": entity.get("latitude"),
        "longitude": entity.get("longitude"),
    }


def _publish_batch(records: list[dict[str, Any]]) -> None:
    _ensure_stream()
    url = BASE_URL + PUBLISH_PATH_TEMPLATE.format(
        dataset_rid=COMMAND_STREAM_RID,
        branch=COMMAND_STREAM_BRANCH,
    )
    try:
        response = _http.post(
            url,
            headers={**_auth_headers(), "Content-Type": "application/json"},
            json={"records": records},
        )
    except httpx.HTTPError as exc:
        raise CommandRejected(f"Could not reach publish API: {exc}") from exc
    if response.status_code >= 400:
        raise CommandRejected(
            f"Publishing the group to the command stream failed with HTTP {response.status_code}: {response.text[:500]}"
        )


class GroupRequest(TypedDict):
    selector: dict
    operation: str
    latitude: NotRequired[float]
    longitude: NotRequired[float]
    move_type: NotRequired[str]
    speed_meters_per_second: NotRequired[float]
    altitude_meters: NotRequired[float]
    heading_degrees: NotRequired[float]
    expected_entity_count: NotRequired[int]


@function
def hla_plan_group_task(context, event: GroupRequest) -> str:
    """
    Preview a group order without sending anything.

    Resolves the selector against current entity state and reports exactly which
    entities would be tasked and with what. No commands are published and nothing
    reaches the simulation.

    Pass the returned entityCount back as expected_entity_count to
    hla_execute_group_task. That is the confirmation gate: if the matching set
    has changed in between, execution refuses rather than tasking a set nobody
    approved.
    """
    try:
        operation = _require_choice(str(_require(event, "operation")).upper(), GROUP_OPS, "operation")
        selector = _clean_selector(event.get("selector"))
        params = _group_params(operation, event)
        matched = _resolve_group(selector)
        return json.dumps(
            {
                "ok": True,
                "status": "preview",
                "operation": operation,
                "selector": selector,
                "params": params,
                "entityCount": len(matched),
                "withinLimit": len(matched) <= MAX_GROUP_SIZE,
                "maxGroupSize": MAX_GROUP_SIZE,
                "entities": [_summarise(e) for e in matched],
                "note": (
                    "Nothing was sent. Call hla_execute_group_task with the same "
                    f"arguments and expected_entity_count={len(matched)} to execute."
                ),
            }
        )
    except CommandRejected as exc:
        return json.dumps({"ok": False, "error": str(exc)})


@function
def hla_execute_group_task(context, event: GroupRequest) -> str:
    """
    Send one order to every entity a selector matches.

    Requires expected_entity_count from hla_plan_group_task and refuses if the
    matching set has changed since — entities appear, disappear and change force
    identity while an operator is reading a preview.

    Every command shares one correlationId, so the whole order can be followed as
    a unit on the outcome stream. Queued is not executed: a command reaching the
    stream means it was accepted for delivery, not that any federate acted on it.
    """
    try:
        operation = _require_choice(str(_require(event, "operation")).upper(), GROUP_OPS, "operation")
        selector = _clean_selector(event.get("selector"))
        params = _group_params(operation, event)
        matched = _resolve_group(selector)

        if not matched:
            raise CommandRejected(
                f"No entity currently matches {selector}. Nothing was sent. "
                "Check the selector against hla_plan_group_task."
            )
        if len(matched) > MAX_GROUP_SIZE:
            raise CommandRejected(
                f"{len(matched)} entities match {selector}, above the limit of "
                f"{MAX_GROUP_SIZE}. Nothing was sent — tasking a subset silently "
                "would be worse. Narrow the selector or raise MAX_GROUP_SIZE."
            )

        expected = event.get("expected_entity_count")
        if expected is None:
            raise CommandRejected(
                "expected_entity_count is required. Call hla_plan_group_task "
                "first and pass back the entityCount it reported, so an order is "
                "only executed against the set that was actually approved."
            )
        if int(expected) != len(matched):
            raise CommandRejected(
                f"The matching set changed: {expected} entities were approved, "
                f"{len(matched)} match now. Nothing was sent. Re-run "
                "hla_plan_group_task and confirm the new set."
            )

        correlation_id = str(uuid.uuid4())
        records = [
            _record(
                context,
                operation,
                TARGET_ENTITY,
                _require_uuid(entity["unique_id"]),
                params,
                correlation_id=correlation_id,
            )
            for entity in matched
        ]
        _publish_batch(records)

        log.info(
            "Queued group %s: %d command(s) for %s by %s (correlation %s)",
            operation,
            len(records),
            selector,
            _caller(context),
            correlation_id,
        )
        return json.dumps(
            {
                "ok": True,
                "status": "queued",
                "operation": operation,
                "selector": selector,
                "params": params,
                "correlationId": correlation_id,
                "entityCount": len(records),
                "commandIds": [r["command_id"] for r in records],
                "entities": [_summarise(e) for e in matched],
                "note": (
                    "Queued on the stream, not executed. Every command shares "
                    "correlationId — follow the whole order there."
                ),
            }
        )
    except CommandRejected as exc:
        return json.dumps({"ok": False, "error": str(exc)})


if __name__ == "__main__":
    start_compute_module()
