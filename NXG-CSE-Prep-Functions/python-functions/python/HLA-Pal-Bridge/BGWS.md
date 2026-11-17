# BGWS in the federation, and into Foundry

> Setting the whole chain up in Foundry (streams, compute modules, the BGWS host, the `/bgws`
> frontend, Workshop): see [`BGWS_FOUNDRY_SETUP.md`](../../../../../BGWS_FOUNDRY_SETUP.md) at the repository root.

BGWS is a constructive simulation in Rust (`DavidAlexKelly/bgws-jev`). It
joins HLA 4 federations through the Federate Protocol, with the RPR FOM, and
this bridge reads it like any other simulator. This page covers:
- what BGWS sends;
- what was changed here to take it;
- how to run the whole chain on one machine.

## What BGWS sends

- **Entities** (RPR `PhysicalEntity` subclasses: `GroundVehicle`, `Aircraft`,
  `Lifeform.Human`, …):
  - DIS identifier, type, spatial, force, marking, damage;
  - NETN's `UniqueId` and `Callsign`, where the federation's FOM has them.
    - The UUID is a name-based (version 5) UUID of the instance name
      (`BGWS-site-application-entity`), so it is stable across runs.
    - The callsign is the unit's full name.
  - So `GET /entities` gives them a `uniqueId`, and tracks key on it.
- **Fire:** RPR `WeaponFire` and `MunitionDetonation`, naming entities by
  instance name.
- **Its event log:** one `BGWS_Event` interaction per event. The class is
  defined in `cse-hla-bridge/foms/BGWS-Events.xml`, which BGWS joins with,
  and the bridge joins with it too. It uses only HLA basic types, so it
  merges with the NETN FOM. Parameters:
  - `Kind`, `Sequence`, `SimTime`, `Federate`, `Side`;
  - `Entity`, `Target`, each with its `UniqueId` and `Callsign`;
  - `Latitude`, `Longitude`, `Altitude`;
  - `Text` (a line for people) and `Data` (the figures, as JSON).
- **Tasking:** BGWS does not yet accept NETN-SMC tasking. A task addressed
  to a BGWS entity is sent and ignored, with no `SMC_Response`.

## Loading and running a scenario from Foundry

BGWS can join a federation with no scenario (`bgws federate`) and wait to be
given one. `BGWS_Control`, in the same FOM module as `BGWS_Event`, is how:

| Parameter | |
|---|---|
| `Federate` | the BGWS federate to address, e.g. `BGWS-1-1`; empty for every one |
| `Command` | `load`, `start`, `pause`, `resume`, `stop` or `speed` |
| `RequestId` | the caller's id, echoed in the status events that answer it |
| `Scenario` | for `load`: the scenario JSON (`bgws.foundry` v1, or a full `bgws.scenario` v4) |
| `Options` | a JSON object, `{"speed": 2.0}` (simulated seconds per wall-clock second); `{}` when there are none |

All `HLAunicodeString`, so it merges with any FOM.

- **Commander:** `hla_bgws_load_scenario(scenario_json, federate?, speed?)`
  and `hla_bgws_control(command, federate?, speed?)`. Both refuse what BGWS
  could only misread: text that is not a JSON object, an unknown `format`,
  a scenario over 512 KB, an unknown command, `speed` without a positive
  speed. Load lives 300 s on the stream, controls 15 s.
- **Streamer:** `BGWS_LOAD_SCENARIO` and `BGWS_CONTROL` go to the bridge with
  `requestId` = `command_id`.
- **Bridge:** `POST /api/v1/bridge/bgws/control`

  ```json
  {"federate": "", "command": "load", "requestId": "uuid, optional",
   "scenario": {"format": "bgws.foundry", "version": 1, ...},
   "options": {"speed": 2.0}}
  ```

  - `scenario` and `options` may be objects or JSON text. Either way they
    are re-serialised compactly, and anything but an object is a 400.
  - The scenario is sent only with `load`.
  - `requestId` is generated when absent.
  - Answers `{"status": "sent", "requestId", "command", "federate",
    "task": "BGWS_Control"}`.
  - 400 for an unknown command, a load without a scenario, or a speed
    without one. 409 when the federation has no `BGWS_Control` (BGWS's
    module not loaded), or the bridge is in monitor mode. The class is
    published at connect only if it resolves; its absence fails nothing
    else.
  - It does not check the scenario's format: that is BGWS's to decide, and
    the Commander has checked it already.
- **The answer:** BGWS replies with `BGWS_Event` kind `federate.status`, with
  `requestId` in its `data` and a `state`: `loading`, `building_terrain`
  (a real-terrain area, a minute or more), `ready`, `running`, `paused`,
  `finished` or `error` with a message. So look for the `request_id` on the
  events stream. The command outcome row stops at `SENT`: that means
  "on the wire", not "loaded".

RPR `StartResume` and `StopFreeze` (`hla_sim_start`, `hla_sim_pause`) still
work: BGWS reads them as start/resume and pause. But they reach the whole
federation, and cannot load a scenario, name one simulation, or set a speed.

## What changed in this directory

- **The bridge build:**
  - Every Java source file and `application.properties` began with a stray
    `[main/java/...]` path line, which looks like a paste artefact. So
    `mvn package`, and therefore the Docker build, failed. Removed.
  - `InjectSuppliesRequest.java` held a copy of `MagicMoveRequest`, so its
    class was missing. Rebuilt from its uses in `BridgeServer` and the
    Commander's `InjectSuppliesRequest`.
  - A Markdown-escaped regex (`"[\^A-Za-z0-9]"`) in
    `BridgeFederate.instanceSuffix()` did not compile. Fixed.
- **Subscription order:** object classes are now subscribed deepest first.
  An RTI discovers an object at the nearest class subscribed *at that
  moment*, and that class is fixed for the object's life. Subscribing
  `PhysicalEntity` before `Platform.GroundVehicle` made every vehicle already
  in the federation a bare `PhysicalEntity`, without its class or the
  attributes declared below it. It is likely what the catch-all note in
  `BridgeFederate` was seeing.
- **Events:**
  - `EventLog` and `GET /events` in the bridge;
  - fire, detonation and `BGWS_Event` decoding in `FederationAmbassador`;
  - `events.py` in the streamer;
  - the publish path in `tracks.py` moved into a `Publisher` class, which
    both threads use.
  See ARCHITECTURE.md §3, *Read path (events)*.
- **Control:** `BGWS_Control` in `BGWS-Events.xml` (module version 1.1);
  `POST /bgws/control` and `BgwsControl` in the bridge; `BGWS_LOAD_SCENARIO`
  and `BGWS_CONTROL` in `commands.py`; `hla_bgws_load_scenario` and
  `hla_bgws_control` in the Commander. See *Loading and running a scenario
  from Foundry*, above, and ARCHITECTURE.md §3.

## The whole chain on one machine

Using BGWS's own RTI (`bgws mock-rti`, a Federate Protocol server):

```sh
# 1. The RTI
bgws mock-rti                                    # 127.0.0.1:15164

# 2. The bridge (FOM_PATH holding NETN-Merged-With-RPR.xml and BGWS-Events.xml)
FEDPRO_ADDRESS=127.0.0.1:15164 FEDERATION_NAME=CSE-Prep FOM_PATH=./foms \
  FEDERATE_NAME=HLA-ENTITY-STREAM-READER PORT_PROBE_ENABLED=false \
  java -jar cse-hla-bridge/target/hla-bridge-1.0.0.jar

# 3. A BGWS game, creating the federation with the NETN FOM and MIM, at 10x
bgws play gen-kgd-company-attack --hla 127.0.0.1:15164 --federation CSE-Prep \
  --fom cse-hla-bridge/foms/NETN-Merged-With-RPR.xml \
  --mim cse-hla-bridge/foms/NETN-MIM.xml --realtime 10

# 4. Look
curl localhost:8080/api/v1/bridge/entities
curl 'localhost:8080/api/v1/bridge/events?after=0&limit=50'

# 5. The streamer's events thread, publishing to a stub Foundry
python hla-bridge-streamer/local_test_events.py live http://localhost:8080/api/v1/bridge
```

Run this way (2026-11-16):
- **Joining:** the bridge chose NETN v4 tasking and discovered all 15 starting
  units as `GroundVehicle` or `Human`. Each had its UUID, callsign, position,
  heading, speed, force and damage, and dismounted infantry appeared as the
  game went on.
- **Events:** the 34-minute game gave 565 events, served by `GET /events`:
  - the `BGWS_Event`s: decisions, orders, hits, kills, morale, fire missions,
    smoke, …;
  - the RPR fire and detonations, with firer and target resolved to UUID and
    callsign.
- **Streaming:** `events.py` published all 565 to the stub, each exactly
  once, including a batch the stub refused once and that was sent again.

On CSE-Prep itself, BGWS would join the running federation (no `--mim`: its
creator's MIM is in force), with `--hla` set to the FedPro address.

## Tests

- `mvn package`: `EventLogTest` (numbering, paging, absent values, overflow
  counted) and `BgwsControlTest` (commands, object or text scenario, compact
  serialisation, generated requestId, refusals), with the existing tests.
- `python hla-bridge-streamer/local_test_commands.py` checks, with a stub
  bridge, the BGWS control routes:
  - path and body, with `requestId` = `command_id`;
  - TTL and seen-once still applied first;
  - a 409 kept as `REFUSED`.

  With `live URL` it runs against a real bridge.
- `python hla-command-poster/check_bgws_control.py` checks the rows the two
  Commander functions write, and what they refuse.
- Against `bgws mock-rti` (2026-11-16):
  - with `BGWS-Events.xml` in `FOM_PATH`, the bridge published
    `BGWS_Control` and sent load, start, pause and speed;
  - without it, the endpoint answered 409 and nothing else changed.
  - BGWS's own handling of `BGWS_Control` was not yet built, so no
    `federate.status` reply was seen.
- `python hla-bridge-streamer/local_test_events.py` checks, with a stub
  bridge and Foundry:
  - paging;
  - a gap counted, before a page or within it;
  - a refused publish sent again;
  - types coerced, NaN as null;
  - deterministic ids.
- `local_test_tracks.py`: `functions` passes. `pipeline` and `fallback` fail
  exactly as they do on `main` before these changes. They expect the
  gateway first for a job token, while `tracks.py` deliberately tries
  stream-proxy first. That is a stale harness, not a regression.
