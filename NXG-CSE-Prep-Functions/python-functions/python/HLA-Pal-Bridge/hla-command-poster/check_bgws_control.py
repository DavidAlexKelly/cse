"""
BGWS control: what a load and a control put on the command stream, and what
they refuse.

Run offline, no Foundry access needed:

    cd hla-command-poster && python3 check_bgws_control.py

The row is the contract with the streamer (commands.py routes it to the
bridge's POST /bgws/control), so the assertions are on the row itself: the
operation, the target kind, the TTL, and params exactly as commands.py reads
them. And on the refusals, because a scenario BGWS cannot read would otherwise
be queued, sent, and answered only by an error event nobody may be watching.

Stubs the SDK the same way check_group_tasking.py does, and replaces the
publish transport so nothing leaves the process.
"""

import json, sys, types, importlib.util, os

import certifi

for name, attrs in {
    "compute_modules": {"start_compute_module": lambda *a, **k: None},
    "compute_modules.annotations": {"function": lambda f: f},
    "compute_modules.auth": {"RefreshingOauthToken": lambda **k: types.SimpleNamespace(get_token=lambda: "tok")},
}.items():
    mod = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules[name] = mod
os.environ.update(FOUNDRY_URL="example.invalid", DEFAULT_CA_PATH=certifi.where(), COMMAND_STREAM_RID="ri.x")

spec = importlib.util.spec_from_file_location("app", os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)

published = []


class FakeHttp:
    def post(self, url, headers=None, json=None, **kwargs):
        published.extend(json["records"])
        return types.SimpleNamespace(status_code=200, text="{}")


app._http = FakeHttp()
app._ensure_stream = lambda: None
context = types.SimpleNamespace(user_id="checker")

fails = []


def check(label, got, want):
    if got != want:
        fails.append(f"{label}: got {got!r}, want {want!r}")
    print(("  ok   " if got == want else "  FAIL ") + label)


def refused(label, call):
    try:
        call()
    except app.CommandRejected as exc:
        print(f"  ok   {label} ({exc})")
        return
    fails.append(f"{label}: was queued")
    print(f"  FAIL {label}")


SCENARIO = json.dumps({"format": "bgws.foundry", "version": 1, "name": "Check", "units": []}, indent=2)

print("load: one SIM row, the text as given, five-minute TTL")
out = json.loads(app.hla_bgws_load_scenario(context, {"scenario_json": SCENARIO, "federate": " BGWS-1-1 ", "speed": 2}))
row = published[-1]
check("status", out["status"], "queued")
check("request_id is the command_id", out["request_id"], row["command_id"])
check("commandId too", out["commandId"], row["command_id"])
check("operation", row["operation"], "BGWS_LOAD_SCENARIO")
check("target_kind", row["target_kind"], "SIM")
check("no entity", row["entity_uuid"], None)
check("ttl", row["ttl_seconds"], 300)
params = json.loads(row["params"])
check("scenario text unchanged", params["scenario"], SCENARIO)
check("federate trimmed", params["federate"], "BGWS-1-1")
check("options", params["options"], {"speed": 2.0})

app.hla_bgws_load_scenario(context, {"scenario_json": json.dumps({"format": "bgws.scenario", "version": 4})})
params = json.loads(published[-1]["params"])
check("full bgws.scenario accepted, every federate, no options", (params["federate"], params["options"]), ("", {}))

print("load: refused")
refused("missing scenario_json", lambda: app.hla_bgws_load_scenario(context, {}))
refused("blank", lambda: app.hla_bgws_load_scenario(context, {"scenario_json": "  "}))
refused("not JSON", lambda: app.hla_bgws_load_scenario(context, {"scenario_json": "{units: []"}))
refused("not an object", lambda: app.hla_bgws_load_scenario(context, {"scenario_json": "[1, 2]"}))
refused("unknown format", lambda: app.hla_bgws_load_scenario(context, {"scenario_json": '{"format": "sword"}'}))
refused("no format", lambda: app.hla_bgws_load_scenario(context, {"scenario_json": '{"units": []}'}))
refused("zero speed", lambda: app.hla_bgws_load_scenario(context, {"scenario_json": SCENARIO, "speed": 0}))
refused("federate not a string", lambda: app.hla_bgws_load_scenario(context, {"scenario_json": SCENARIO, "federate": 7}))
refused(
    "over the size limit",
    lambda: app.hla_bgws_load_scenario(
        context, {"scenario_json": json.dumps({"format": "bgws.foundry", "pad": "x" * app.MAX_SCENARIO_BYTES})}
    ),
)

print("control: short TTL, lowercase command")
for command, speed in (("START", None), ("pause", None), ("resume", 4.0), ("stop", None), ("speed", 0.5)):
    event = {"command": command}
    if speed is not None:
        event["speed"] = speed
    out = json.loads(app.hla_bgws_control(context, event))
    row = published[-1]
    params = json.loads(row["params"])
    check(f"{command}: operation", row["operation"], "BGWS_CONTROL")
    check(f"{command}: ttl", row["ttl_seconds"], 15)
    check(f"{command}: params", params, {"command": command.lower(), "federate": "",
                                         "options": {} if speed is None else {"speed": speed}})
    check(f"{command}: request_id", out["request_id"], row["command_id"])

print("control: refused")
refused("load is not a control", lambda: app.hla_bgws_control(context, {"command": "load"}))
refused("unknown command", lambda: app.hla_bgws_control(context, {"command": "rewind"}))
refused("missing command", lambda: app.hla_bgws_control(context, {}))
refused("speed without a speed", lambda: app.hla_bgws_control(context, {"command": "speed"}))
refused("negative speed", lambda: app.hla_bgws_control(context, {"command": "speed", "speed": -1}))

print("FAILED:\n  " + "\n  ".join(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
