"""
Local harness for commands.py's BGWS control routing — not part of the
container image.

    python local_test_commands.py          # a stub plays the bridge
    python local_test_commands.py live URL # a real bridge at URL (e.g.
                                           # http://localhost:8080/api/v1/bridge)

Feeds command rows, shaped as the Commander writes them, straight into
handle_record() — the stream transport is tracks.py's and is exercised by the
other harnesses — and checks what reaches the bridge and what outcome comes
back: the route, the body, requestId = command_id, a refusal kept as REFUSED,
and the TTL and seen-once rules still applied first.

Asserts, and exits non-zero on failure.
"""

import json
import os
import sys
import threading
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LIVE = len(sys.argv) > 2 and sys.argv[1] == "live"

received: list[tuple[str, dict]] = []


class Stub(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        received.append((self.path, body))
        if not self.path.endswith("/bgws/control"):
            self._send(404, {})
        elif body.get("federate") == "NO-SUCH-FOM":
            # What the bridge says when the federation has no BGWS_Control.
            self._send(409, {"error": "Interaction class not available in the loaded FOM: HLAinteractionRoot.BGWS_Control"})
        else:
            self._send(200, {"status": "sent", "requestId": body.get("requestId"), "command": body.get("command"),
                             "federate": body.get("federate"), "task": "BGWS_Control"})


server = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
threading.Thread(target=server.serve_forever, daemon=True).start()
os.environ["BRIDGE_URL"] = sys.argv[2] if LIVE else f"http://127.0.0.1:{server.server_address[1]}/api/v1/bridge"
for stale in ("COMMAND_STREAM_RID", "COMMAND_LOG_RID", "RESOURCE_ALIAS_MAP"):
    os.environ.pop(stale, None)

import commands  # noqa: E402 - env first

failures = []


def check(label, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {label}{' — ' + detail if detail else ''}")
    if not ok:
        failures.append(label)


SCENARIO = json.dumps({
    "format": "bgws.foundry", "version": 1, "name": "Harness", "seed": 1, "durationMin": 30,
    "area": {"south": 54.65, "west": 20.40, "north": 54.75, "east": 20.55}, "terrain": "generated",
    "command": {"blue": "rules", "red": "rules"},
    "units": [{"id": "b-1", "label": "Blue 1", "side": "blue", "platform": "generic/mbt", "count": 4,
               "lat": 54.68, "lon": 20.46, "headingDeg": 0}],
}, separators=(",", ":"))


def row(operation, params, ttl=15, age_s=0.0):
    """One command row, as hla-command-poster's _record() writes it."""
    command_id = str(uuid.uuid4())
    return {
        "schema_version": 1, "command_id": command_id, "correlation_id": command_id,
        "issued_at": (datetime.now(timezone.utc) - timedelta(seconds=age_s)).isoformat(),
        "issued_by": "harness", "operation": operation, "target_kind": "SIM", "entity_uuid": None,
        "partition_key": "SIM", "params": json.dumps(params, separators=(",", ":"), sort_keys=True),
        "ttl_seconds": ttl, "not_before": None,
    }


# 1. A load: the scenario text and options through unchanged, requestId = command_id.
load = row("BGWS_LOAD_SCENARIO", {"scenario": SCENARIO, "federate": "", "options": {"speed": 2.0}}, ttl=300)
out = commands.handle_record(load)
check("load SENT", out and out["stage"] == "SENT", json.dumps(out))
check("load outcome names the class", out and out["fom_class"] == "BGWS_Control", str(out and out["fom_class"]))
if not LIVE:
    path, body = received[-1]
    check("load routed to /bgws/control", path.endswith("/api/v1/bridge/bgws/control"), path)
    check("load requestId is the command_id", body.get("requestId") == load["command_id"], str(body.get("requestId")))
    check("load body", body.get("command") == "load" and body.get("scenario") == SCENARIO
          and body.get("options") == {"speed": 2.0} and body.get("federate") == "", json.dumps(body)[:200])

# 2. Controls: command lowercased, no scenario on the wire, speed's options kept.
for command, options in (("start", None), ("PAUSE", None), ("speed", {"speed": 4.0})):
    params = {"command": command, "federate": "BGWS-1-1"}
    if options:
        params["options"] = options
    rec = row("BGWS_CONTROL", params)
    out = commands.handle_record(rec)
    check(f"{command} SENT", out and out["stage"] == "SENT", json.dumps(out))
    if not LIVE:
        _, body = received[-1]
        check(f"{command} body", body.get("command") == command.lower() and "scenario" not in body
              and body.get("requestId") == rec["command_id"] and body.get("federate") == "BGWS-1-1"
              and body.get("options") == options, json.dumps(body))

# 3. The replay rules still come first: a re-read is silent, a stale control expires.
check("a re-read of the same row is ignored", commands.handle_record(load) is None)
sent_before = len(received)
stale = commands.handle_record(row("BGWS_CONTROL", {"command": "start"}, ttl=15, age_s=60))
check("a 60 s old start (ttl 15) EXPIRES, unsent", stale and stale["stage"] == "EXPIRED" and len(received) == sent_before,
      json.dumps(stale))

# 4. Malformed rows fail at routing, never reaching the bridge.
bad = commands.handle_record(row("BGWS_LOAD_SCENARIO", {"federate": ""}, ttl=300))
check("a load without a scenario FAILS before the bridge", bad and bad["stage"] == "FAILED" and len(received) == sent_before,
      json.dumps(bad))
bad = commands.handle_record(row("BGWS_CONTROL", {}))
check("a control without a command FAILS", bad and bad["stage"] == "FAILED", json.dumps(bad))

# 5. A federation without BGWS_Control: 409 kept as REFUSED, with the reason.
if not LIVE:
    out = commands.handle_record(row("BGWS_CONTROL", {"command": "stop", "federate": "NO-SUCH-FOM"}))
    check("409 is REFUSED with the reason", out and out["stage"] == "REFUSED" and out["http_status"] == 409
          and "BGWS_Control" in (out["detail"] or ""), json.dumps(out))

print("FAILED: " + ", ".join(failures) if failures else "all passed")
sys.exit(1 if failures else 0)
