# BGWS in the federation, and into Foundry

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
  counted), with the existing tests.
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
