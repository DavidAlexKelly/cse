"""
Group tasking: the merge and the selector must be exact.

Run offline, no Foundry access needed:

    cd hla-command-poster && python3 check_group_tasking.py

These assertions guard the two places where "nearly right" is worse than an
error. The merge, because track rows are sparse and a naive latest-row-wins read
silently drops entities from a selector. And the confirmation gate, because a
group order that fans out to a set nobody approved is exactly the failure this
design exists to prevent.

Deliberately not named test_*.py: it is a standalone script, not a pytest
suite, and app.py's module-level code (building an httpx.Client, requiring
env vars) is not something pytest should import as a matter of course.
"""

import json, sys, types, importlib.util, os

import certifi

# Stub the compute-module SDK and required env so app.py imports offline
for name, attrs in {
    "compute_modules": {"start_compute_module": lambda *a, **k: None},
    "compute_modules.annotations": {"function": lambda f: f},
    "compute_modules.auth": {"RefreshingOauthToken": lambda **k: types.SimpleNamespace(get_token=lambda: "tok")},
}.items():
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules[name] = mod
os.environ.update(
    FOUNDRY_URL="example.invalid",
    # certifi.where() rather than a hardcoded OS path: app.py builds its
    # httpx.Client at import time with verify=DEFAULT_CA_PATH, so this has to
    # be a CA bundle that actually exists on whatever machine runs this.
    DEFAULT_CA_PATH=certifi.where(),
    COMMAND_STREAM_RID="ri.x",
    TRACK_STREAM_RID="ri.tracks",
)

spec = importlib.util.spec_from_file_location("app", os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)

fails = []


def check(label, got, want):
    if got != want:
        fails.append(f"{label}: got {got!r}, want {want!r}")
    print(("  ok   " if got == want else "  FAIL ") + label)


print("merge: sparse rows must not erase known state")
# DRONE-01 is discovered with a force, then reports position-only rows.
rows = [
    {
        "observed_at": "2026-08-25T10:00:00Z",
        "unique_id": "u1",
        "name": "DRONE-01",
        "force_id": "friendly",
        "entity_type": "aircraft",
    },
    {"observed_at": "2026-08-25T10:00:01Z", "unique_id": "u1", "latitude": 60.1, "longitude": 24.9},
    {"observed_at": "2026-08-25T10:00:02Z", "unique_id": "u1", "latitude": 60.2, "longitude": 25.0},
]
merged = app._merge_tracks(rows)["u1"]
check("force_id survives later sparse rows", merged["force_id"], "friendly")
check("name survives", merged["name"], "DRONE-01")
check("position takes the newest value", merged["latitude"], 60.2)

print("merge: out-of-order rows still resolve newest-wins")
check("newest wins regardless of arrival order", app._merge_tracks(list(reversed(rows)))["u1"]["latitude"], 60.2)

print("selector")
fleet = [
    {"observed_at": "t", "unique_id": "u1", "force_id": "friendly", "entity_type": "aircraft"},
    {"observed_at": "t", "unique_id": "u2", "force_id": "FRIENDLY", "entity_type": "vehicle"},
    {"observed_at": "t", "unique_id": "u3", "force_id": "opposing", "entity_type": "aircraft"},
    {"observed_at": "t", "unique_id": "u4", "entity_type": "aircraft"},  # no force_id
    {"observed_at": "t", "entity_id": "HLA9", "force_id": "friendly"},  # no unique_id
]
app._current_entities = lambda: list(app._merge_tracks(fleet).values())
check(
    "matches both cases of friendly",
    [e["unique_id"] for e in app._resolve_group({"force_id": "friendly"})],
    ["u1", "u2"],
)
check(
    "combined fields narrow",
    [e["unique_id"] for e in app._resolve_group({"force_id": "friendly", "entity_type": "aircraft"})],
    ["u1"],
)
check(
    "null force_id never matches", "u4" in [e["unique_id"] for e in app._resolve_group({"force_id": "friendly"})], False
)
check("no UniqueId means untaskable, so excluded", len(app._resolve_group({"force_id": "friendly"})), 2)

print("selector validation")
for bad, why in [
    ({}, "empty"),
    ({"colour": "red"}, "unknown field"),
    ("friendly", "not an object"),
    ({"force_id": None}, "all null"),
]:
    try:
        app._clean_selector(bad)
        fails.append(f"{why} was accepted")
        print(f"  FAIL {why} accepted")
    except app.CommandRejected:
        print(f"  ok   rejects {why}")

print("weapons are not group-taskable")
check("FIRE_AT_LOCATION absent from GROUP_OPS", app.Op.FIRE_AT_LOCATION in app.GROUP_OPS, False)
check("FIRE_AT_ENTITY absent from GROUP_OPS", app.Op.FIRE_AT_ENTITY in app.GROUP_OPS, False)
check("MOVE present", app.Op.MOVE in app.GROUP_OPS, True)

print("correlation_id")
r1 = app._record(None, "MOVE", "ENTITY", "u1", {}, correlation_id="shared")
r2 = app._record(None, "MOVE", "ENTITY", "u2", {}, correlation_id="shared")
check("batch shares correlation_id", r1["correlation_id"] == r2["correlation_id"] == "shared", True)
check("command_ids stay distinct", r1["command_id"] != r2["command_id"], True)
solo = app._record(None, "MOVE", "ENTITY", "u1", {})
check("single command still self-correlates", solo["correlation_id"], solo["command_id"])

print("execute refuses without confirmation")
out = json.loads(
    app.hla_execute_group_task(
        None, {"selector": {"force_id": "friendly"}, "operation": "MOVE", "latitude": 60.0, "longitude": 25.0}
    )
)
check("missing expected_entity_count refuses", out["ok"], False)
check("...and says why", "expected_entity_count" in out["error"], True)

out = json.loads(
    app.hla_execute_group_task(
        None,
        {
            "selector": {"force_id": "friendly"},
            "operation": "MOVE",
            "latitude": 60.0,
            "longitude": 25.0,
            "expected_entity_count": 5,
        },
    )
)
check("stale count refuses", out["ok"], False)
check("...naming both counts", "5" in out["error"] and "2" in out["error"], True)

out = json.loads(
    app.hla_execute_group_task(
        None,
        {
            "selector": {"force_id": "friendly"},
            "operation": "FIRE_AT_LOCATION",
            "latitude": 60.0,
            "longitude": 25.0,
            "expected_entity_count": 2,
        },
    )
)
check("weapons refused at the group endpoint", out["ok"], False)

print("plan is side-effect free")


def boom(*a, **k):
    raise AssertionError("plan published something")


app._publish_batch = boom
out = json.loads(
    app.hla_plan_group_task(
        None, {"selector": {"force_id": "friendly"}, "operation": "MOVE", "latitude": 60.0, "longitude": 25.0}
    )
)
check("plan succeeds", out["ok"], True)
check("plan reports the count to echo back", out["entityCount"], 2)
check("plan lists the entities", len(out["entities"]), 2)

print()
print("FAILURES: %d" % len(fails))
for f in fails:
    print("  " + f)
sys.exit(1 if fails else 0)
