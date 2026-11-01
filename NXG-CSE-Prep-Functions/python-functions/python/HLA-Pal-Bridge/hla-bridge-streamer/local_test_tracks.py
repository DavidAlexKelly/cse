"""
Local harness for tracks.py — not part of the container image.

Runs the publisher against a stub that impersonates both the bridge and Foundry,
so the parts that depend on how the platform configures the container are
exercised on a laptop instead of in a federation.

    python local_test_tracks.py pipeline   # pipeline mode: alias map + job token
    python local_test_tracks.py functions  # functions mode: OAuth client credentials
    python local_test_tracks.py fallback   # first endpoint 404s, first envelope rejected

Asserts, and exits non-zero on failure.
"""

import json
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SCENARIO = sys.argv[1] if len(sys.argv) > 1 else "pipeline"
DATASET = "ri.foundry.main.dataset.6e22a37b-e083-4977-be80-f407c8bd952b"
ALIAS = "entity_tracks"
JOB_TOKEN = "job-token-from-build2"

# What the bridge would return: deliberately messy, because the real one is.
ENTITIES = [
    {   # fully populated, but numbers arriving as strings
        "uniqueId": "uuid-1", "id": "3161", "name": "HLA.Aircraft3161",
        "callsign": "REAPER01", "entityType": "Aircraft", "dis": "1.2.225.50.1.1",
        "forceId": "FRIENDLY", "simulator": "SWORD", "symbolId": "SFAPMFQ------",
        "latitude": "51.5074", "longitude": -0.1278, "altitudeMeters": 1500.5,
        "headingDegrees": 270.0, "speedMps": 55.5, "damageState": "NoDamage",
        "aggregateState": "Disaggregated", "activity": "Patrolling",
        "posture": "Offensive", "mission": "ISR", "echelon": "Platoon",
        "combatValue": "80", "isCommandPost": "false",
        "lastUpdated": 1755440000000, "discoveredAt": 1755439000000,
    },
    {   # sparse: no position at all, and a NaN speed
        "uniqueId": None, "id": "3162", "name": "HLA.Ground3162",
        "latitude": None, "longitude": "", "speedMps": float("nan"),
        "combatValue": None, "isCommandPost": True,
    },
]

published: list[dict] = []
token_requests: list[str] = []
publish_calls: list[tuple[str, str]] = []   # (path, authorization header)


class Stub(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # keep the test output readable
        pass

    def _send(self, code: int, payload) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.endswith("/entities"):
            self._send(200, ENTITIES)
        elif self.path.endswith("/status"):
            self._send(200, {"federationName": "CSE-Prep"})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length).decode()

        if self.path == "/multipass/api/oauth2/token":
            form = dict(pair.split("=", 1) for pair in raw.split("&") if "=" in pair)
            token_requests.append(form.get("scope", ""))
            self._send(200, {"access_token": "oauth-token", "expires_in": 3600})
            return

        if "/stream-proxy/api/streams/" in self.path or "publishRecords" in self.path:
            publish_calls.append((self.path, self.headers.get("Authorization", "")))

            # The fallback scenario: the preferred endpoint is not served here, and
            # the preferred envelope shape is rejected on the one that is.
            if SCENARIO == "fallback":
                if "/highScale/" in self.path:
                    self._send(404, {"errorName": "NotFound"})
                    return
                if raw.lstrip().startswith("{"):
                    self._send(400, {"errorName": "InvalidArgument",
                                     "message": "expected a bare array of records"})
                    return

            payload = json.loads(raw)
            records = payload["records"] if isinstance(payload, dict) else payload
            published.extend(records)
            self._send(200, {})
            return

        self._send(404, {"error": "not found"})


server = ThreadingHTTPServer(("127.0.0.1", 0), Stub)
port = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()

base = f"http://127.0.0.1:{port}"
workdir = tempfile.mkdtemp(prefix="tracks-test-")

env = {
    "BRIDGE_URL": f"{base}/api/v1/bridge",
    "TRACK_FOUNDRY_BASE_URL": base,
    "TRACK_POLL_SECONDS": "0.2",
}

if SCENARIO == "pipeline" or SCENARIO == "fallback":
    # Pipeline mode: the platform mounts a token file and an alias map, and sets
    # these two variables to their paths. No client credentials exist.
    token_path = os.path.join(workdir, "build2-token")
    alias_path = os.path.join(workdir, "resource-alias-map.json")
    with open(token_path, "w", encoding="utf-8") as handle:
        handle.write(JOB_TOKEN + "\n")   # trailing newline, as a mounted file has
    with open(alias_path, "w", encoding="utf-8") as handle:
        json.dump({ALIAS: {"rid": DATASET, "branch": None},
                   "some_input": {"rid": "ri.foundry.main.dataset.other", "branch": "master"}},
                  handle)
    env.update({
        "BUILD2_TOKEN": token_path,
        "RESOURCE_ALIAS_MAP": alias_path,
        "TRACK_STREAM_ALIAS": ALIAS,
    })
else:
    # Functions mode: no alias map, an explicit RID, and client credentials.
    env.update({
        "TRACK_STREAM_DATASET_RID": DATASET,
        "CLIENT_ID": "stub-client",
        "CLIENT_SECRET": "stub-secret",
    })

os.environ.update(env)
for stale in ("FOUNDRY_HOSTNAME", "FOUNDRY_URL"):
    os.environ.pop(stale, None)

import tracks  # noqa: E402 - env must be set before import

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    print(f"{'PASS' if condition else 'FAIL'}  {label}{' — ' + detail if detail else ''}")
    if not condition:
        failures.append(label)


configured, reason = tracks.is_configured()
check("is_configured", configured, reason)
check("stream resolved", tracks.STREAM_DATASET_RID == DATASET,
      f"{tracks.STREAM_DATASET_RID} from {tracks.STREAM_SOURCE}")

if SCENARIO in ("pipeline", "fallback"):
    check("stream came from the alias map",
          tracks.STREAM_SOURCE.startswith(f"alias '{ALIAS}'"), tracks.STREAM_SOURCE)
    check("null branch in the alias map defaults to master",
          tracks.STREAM_BRANCH == "master", tracks.STREAM_BRANCH)
    check("credential mode is the job token",
          tracks.CREDENTIAL_MODE == "pipeline job token", tracks.CREDENTIAL_MODE)
else:
    check("credential mode is OAuth",
          tracks.CREDENTIAL_MODE == "oauth client credentials", tracks.CREDENTIAL_MODE)

tracks.start()
deadline = time.time() + 20
while time.time() < deadline and len(published) < 4:
    time.sleep(0.2)

state = tracks.status()
check("records published", len(published) >= 4, f"{len(published)} records")
check("no publish failures", state["publish_failures"] == 0, str(state["last_error"]))

if SCENARIO in ("pipeline", "fallback"):
    check("the mounted job token was used, not OAuth",
          all(auth == f"Bearer {JOB_TOKEN}" for _, auth in publish_calls)
          and not token_requests,
          f"{len(token_requests)} token exchanges, auths={set(a for _, a in publish_calls)}")
    if SCENARIO == "pipeline":
        # The job token is documented as being for the API gateway, so that is
        # tried before stream-proxy.
        check("the API gateway is tried first for a job token",
              publish_calls and "/api/v2/highScale/" in publish_calls[0][0],
              publish_calls[0][0] if publish_calls else "no calls")
        check("stream-proxy never needed", not any("/stream-proxy/" in p
                                                  for p, _ in publish_calls),
              json.dumps(sorted({p for p, _ in publish_calls})))
    else:
        check("fell back off the highScale path",
              any("/highScale/" in p for p, _ in publish_calls)
              and any("/api/v2/streams/" in p for p, _ in publish_calls),
              json.dumps(sorted({p for p, _ in publish_calls})))
        check("fell back to the bare-array envelope", state["body_shape"] == "array",
              state["body_shape"])
else:
    check("an OAuth token was minted and reused", len(token_requests) <= 2,
          f"{len(token_requests)} exchanges for {len(published)} records")
    check("publishRecords tried first for an OAuth token",
          publish_calls and "publishRecords" in publish_calls[0][0],
          publish_calls[0][0] if publish_calls else "no calls")

# Record shaping: the column types the stream schema declares.
first = next((r for r in published if r["entity_id"] == "3161"), None)
second = next((r for r in published if r["entity_id"] == "3162"), None)
check("string latitude coerced to float", isinstance(first["latitude"], float)
      and abs(first["latitude"] - 51.5074) < 1e-9, repr(first["latitude"]))
check("string combatValue coerced to int", first["combat_value"] == 80,
      repr(first["combat_value"]))
check('string "false" coerced to bool', first["is_command_post"] is False,
      repr(first["is_command_post"]))
check("timestamps are ISO-8601 Z", first["bridge_last_updated"].endswith("Z"),
      first["bridge_last_updated"])
check("federation carried through", first["federation"] == "CSE-Prep",
      repr(first["federation"]))
check("track_point_id prefers the NETN uuid",
      first["track_point_id"].startswith("uuid-1@"), first["track_point_id"])
check("missing position is null, not zero",
      second["latitude"] is None and second["longitude"] is None,
      repr((second["latitude"], second["longitude"])))
check("NaN dropped rather than sent", second["speed_mps"] is None,
      repr(second["speed_mps"]))
check("no uuid falls back to the instance id",
      second["track_point_id"].startswith("3162@"), second["track_point_id"])
check("every record has all 27 columns",
      all(len(r) == 27 for r in published), str({len(r) for r in published}))

server.shutdown()
print()
if failures:
    print(f"{len(failures)} check(s) failed: {failures}")
    sys.exit(1)
print(f"all checks passed ({SCENARIO})")
