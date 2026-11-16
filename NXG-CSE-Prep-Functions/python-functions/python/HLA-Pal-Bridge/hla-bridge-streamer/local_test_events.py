"""
Local harness for events.py — not part of the container image.

    python local_test_events.py          # a stub plays the bridge and Foundry
    python local_test_events.py live URL # a real bridge at URL (e.g.
                                         # http://localhost:8080/api/v1/bridge),
                                         # a stub plays Foundry

The stub bridge serves a buffer of events with a gap in its numbering (events
the bridge dropped before they were read), and the stub Foundry refuses the
first publish, so the cursor must hold and the batch be sent again.

Asserts, and exits non-zero on failure.
"""

import json
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

LIVE = len(sys.argv) > 2 and sys.argv[1] == "live"
DATASET = "ri.foundry.main.dataset.00000000-0000-0000-0000-00000000e7e7"
ALIAS = "hla_event_stream"


def bgws(seq, kind, text, **extra):
    e = {"seq": seq, "receivedAt": 1794855907000 + seq, "source": "bgws", "kind": kind, "federate": "BGWS-1-1",
         "sourceSeq": seq + 16, "simTime": 17.0 + seq, "side": "blue", "entityName": "BGWS-1-1-2",
         "entityUniqueId": "f7d2404c-5c99-578a-806b-49ad598d1b8b", "entityCallsign": "Blue 2 mech",
         "latitude": 54.68, "longitude": 20.47, "altitudeMeters": 40.7, "text": text, "data": "{}"}
    e.update(extra)
    return e


# Seq 4 and 5 were dropped by the bridge: the reader must count a gap of 2.
BUFFER = [bgws(1, "unit.dismount", "dismounts"), bgws(2, "decide.apply", "decides"), bgws(3, "fire.hit", "a hit"),
          {"seq": 6, "receivedAt": 1794855998354, "source": "rpr", "kind": "weapon_fire", "entityName": "BGWS-1-1-13",
           "targetName": "BGWS-1-1-7", "munition": "2.8.0.2.0.0.0", "quantity": "3", "eventCount": 1,
           "latitude": float("nan"), "text": "Red 3 platoon fired 3 x 2.8.0.2.0.0.0 at Blue 7 tanks"}]
published: list[dict] = []
refused = {"n": 0}


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

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path.endswith("/events"):
            q = parse_qs(url.query)
            after, limit = int(q.get("after", ["0"])[0]), int(q.get("limit", ["500"])[0])
            # Two at a time, so paging within one tick is exercised.
            page = [e for e in BUFFER if e["seq"] > after][: min(limit, 2)]
            self._send(200, {"events": page, "last": BUFFER[-1]["seq"], "first": 1, "dropped": 2})
        elif url.path.endswith("/status"):
            self._send(200, {"federationName": "CSE-Prep"})
        else:
            self._send(404, {})

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        if "/stream-proxy/api/streams/" in self.path or "publishRecords" in self.path:
            if refused["n"] == 0:
                refused["n"] += 1
                self._send(500, {"errorName": "Transient"})
                return
            payload = json.loads(raw)
            published.extend(payload["records"] if isinstance(payload, dict) else payload)
            self._send(200, {})
            return
        self._send(404, {})


server = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{server.server_address[1]}"
work = tempfile.mkdtemp(prefix="events-test-")
token, aliases = os.path.join(work, "token"), os.path.join(work, "aliases.json")
with open(token, "w") as f:
    f.write("job-token\n")
with open(aliases, "w") as f:
    json.dump({ALIAS: {"rid": DATASET, "branch": None}}, f)
os.environ.update({
    "BRIDGE_URL": sys.argv[2] if LIVE else f"{base}/api/v1/bridge",
    "TRACK_FOUNDRY_BASE_URL": base,
    "BUILD2_TOKEN": token,
    "RESOURCE_ALIAS_MAP": aliases,
    "EVENT_STREAM_ALIAS": ALIAS,
    "EVENT_POLL_SECONDS": "0.2",
    "EVENT_BATCH": "2" if not LIVE else "500",
})
for stale in ("FOUNDRY_HOSTNAME", "FOUNDRY_URL", "TRACK_STREAM_ALIAS"):
    os.environ.pop(stale, None)

import events  # noqa: E402 - env first

failures = []


def check(label, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {label}{' — ' + detail if detail else ''}")
    if not ok:
        failures.append(label)


ok, why = events.is_configured()
check("is_configured", ok, why)
check("stream from the alias map", events.EVENT_RID == DATASET and events.EVENT_BRANCH == "master", f"{events.EVENT_RID} {events.EVENT_BRANCH}")

if LIVE:
    import httpx

    want = httpx.get(f"{sys.argv[2]}/events", params={"limit": 5000}).json()
    expected = len(want["events"])
    check("the live bridge has events", expected > 0, f"{expected}")
else:
    expected = len(BUFFER)

events.start()
deadline = time.time() + 20
while time.time() < deadline and len(published) < expected:
    time.sleep(0.1)
time.sleep(0.5)
events.stop()

ids = [r["event_id"] for r in published]
check("every event published once, after one refused publish", len(published) == expected and len(set(ids)) == expected, f"{len(published)} rows, {len(set(ids))} ids, {expected} expected")
check("the refused batch was sent again", refused["n"] == 1)
check("cursor at the newest event", events.status()["cursor"] == (want["last"] if LIVE else BUFFER[-1]["seq"]) or LIVE, str(events.status()["cursor"]))
if not LIVE:
    check("a gap of 2 counted", events.status()["gaps"] == 2, str(events.status()["gaps"]))
    rpr = next(r for r in published if r["source"] == "rpr")
    check("quantity coerced to int", rpr["quantity"] == 3, repr(rpr["quantity"]))
    check("NaN latitude is null, not a number", rpr["latitude"] is None, repr(rpr["latitude"]))
    check("rpr event id", rpr["event_id"] == "rpr:weapon_fire:BGWS-1-1-13:1@1794855998354", rpr["event_id"])
    b = published[0]
    check("bgws event id", b["event_id"] == "bgws:BGWS-1-1:17@1794855907001", b["event_id"])
    check("federation from /status", b["federation"] == "CSE-Prep", str(b["federation"]))
    check("received_at is ISO-8601 Z", (b["received_at"] or "").endswith("Z"), str(b["received_at"]))
    check("same record, same id (a re-read overwrites)", events.event_id(BUFFER[0]) == b["event_id"])
else:
    kinds = sorted({r["kind"] for r in published})
    check("live rows carry kinds", len(kinds) > 1, ", ".join(kinds[:12]))
    with_uuid = sum(1 for r in published if r["entity_unique_id"])
    check("live rows carry entity UUIDs", with_uuid > 0, f"{with_uuid}/{len(published)}")
    print(json.dumps(published[0], indent=1))

print("FAILED: " + ", ".join(failures) if failures else "all passed")
sys.exit(1 if failures else 0)
