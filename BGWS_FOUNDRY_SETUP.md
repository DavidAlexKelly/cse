# BGWS in Foundry: setup guide

How to set up the whole chain so that Foundry can:
- **send BGWS its initial state**: the area and its terrain, the units, the objectives, and who
  commands each side;
- **run the game**: start, pause, resume, stop, speed;
- **give BGWS units orders**: move, patrol, magic move, stop, cancel, rules of engagement, fire;
- **watch it**: unit positions on a map, and every event BGWS logs (detections, shots, hits,
  orders, decisions and their reasons).

Two repositories hold the code:

| Repository | What is in it |
|---|---|
| `DavidAlexKelly/cse`, branch `claude/confident-cannon-en7fsq` | The HLA–Palantir bridge (Java), the HLA streamer (Python), the Commander functions (Python), and the `/bgws` frontend in `NXG-Mapplications-Repo` |
| `DavidAlexKelly/bgws-jev`, branch `claude/confident-cannon-en7fsq` | BGWS itself (Rust): the simulation, and `bgws federate`, the process that joins the federation and waits for Foundry |

Neither branch has been merged to `main`.

---

## 1. How the pieces fit

```
 Foundry
 ┌───────────────────────────────────────────────────────────────────────────┐
 │  Workshop (Plan & Prepare) ── iframe ──▶  Mapplications app, route /bgws  │
 │                                             │ functions        ▲ streams  │
 │                                             ▼                  │          │
 │  Module B "Commander"  hla_bgws_load_scenario, hla_bgws_control,          │
 │  (functions mode)      hla_move_to_location, hla_patrol, … (orders)       │
 │                                             │                  │          │
 │                              Command Stream Input      HLA Entity Tracks  │
 │                                             │          HLA Events (new)   │
 │                                             ▼          Command Stream Out │
 │  Module A "HLA Streamer"  streamer.py: commands.py │ tracks.py │ events.py│
 │  (pipeline mode)          hla-bridge (Java) on localhost:8080             │
 └─────────────────────────────────────────────│─────────────────────────────┘
                                               │ HLA 4 / Federate Protocol
                                               ▼
                         Pitch pRTI (CSE-Prep federation, via FedPro)
                                               ▲
                                               │ HLA 4 / Federate Protocol
                              ┌────────────────┴────────────────┐
                              │  bgws federate  (a host you run) │
                              │  waits for a scenario; plays it  │
                              └──────────────────────────────────┘
```

**Initial state and control.**
1. The frontend calls `hla_bgws_load_scenario`, then `hla_bgws_control` for start, pause and the rest.
2. The Commander writes one row to the Command Stream Input.
3. `commands.py` in Module A posts it to the bridge (`POST /bgws/control`).
4. The bridge sends a `BGWS_Control` HLA interaction.
5. BGWS loads the scenario. For real terrain it builds the terrain for the area the first time and
   reuses it after.
6. BGWS publishes its units where they stand, then waits for start.
7. BGWS answers every command with a `federate.status` event: state, message, sim time, speed.

**Orders.**
1. The frontend calls the existing `hla_*` order functions with the unit's NETN UUID.
2. The bridge sends NETN-SMC tasking (`MoveToLocation`, `Patrol`, …).
3. BGWS answers with `SMC_Response` and `ETR_TaskStatus`:
   - Accepted or Refused at once;
   - Executing while it carries the order out;
   - then Completed, Cancelled or Error.
4. `commands.py` already republishes those answers to the Command Stream Output as acknowledgements.

**Watching.** BGWS publishes:
- its units, as RPR entities carrying a NETN `UniqueId` (stable across runs) and a `Callsign` (the
  unit's name);
- its whole event log, as `BGWS_Event` interactions.

The bridge serves the units at `/entities` and the events at `/events`. `tracks.py` writes the units
to HLA Entity Tracks, and `events.py` writes the events to HLA Events.

BGWS's own classes, `BGWS_Event` and `BGWS_Control`, live in a small FOM module of its own,
`BGWS-Events.xml`. It uses only standard HLA types, so it merges with the NETN FOM, and both BGWS and
the bridge join with it.

---

## 2. Checklist

| # | Where | What | Section |
|---|---|---|---|
| 1 | Foundry | Create the **HLA Events** stream | §3 |
| 2 | Foundry | Rebuild and redeploy **Module A** (bridge + streamer) from the branch; add the events stream as an output | §4 |
| 3 | Foundry | Rebuild and redeploy **Module B** (Commander) from the branch | §5 |
| 4 | A host on the CSE network | Build and run **`bgws federate`** | §6 |
| 5 | Foundry | Configure, build and deploy the **Mapplications app** with `/bgws` | §7 |
| 6 | Foundry | Add the **`/bgws` iframe** to Workshop | §8 |
| 7 | Everywhere | **First run**: the smoke test | §9 |

---

## 3. Create the HLA Events stream

Create a new **streaming dataset** in the **same project** as the two compute modules. Pipeline-mode
inputs and outputs must live in the module's own project. The existing streams are in
`/[NEXGEN] Common Simulation Platform/CSP/5. Connections`.

- Suggested name: **HLA Events**.
- Branch: `master`.
- Key column: `event_id`.

Schema. These are exactly the columns `events.py` writes (`to_record`). Make **every column
nullable except `event_id`**: the publish validates each record and rejects the whole batch if one is
invalid, and most columns are legitimately empty for some events.

| Column | Type | Meaning |
|---|---|---|
| `event_id` | String | Deterministic key: `bgws:<federate>:<seq>@<received ms>` or `rpr:<kind>:<firer>:<count>@<received ms>`. A re-read overwrites, it does not duplicate |
| `bridge_seq` | Long | The bridge's number for the event (from 1, per bridge run) |
| `received_at` | Timestamp | When the bridge heard it (ISO-8601 UTC string) |
| `source` | String | `bgws` (a BGWS event) or `rpr` (fire or detonation from any simulator) |
| `kind` | String | e.g. `sense.detect`, `fire.hit`, `fire.kill`, `c2.order_received`, `decide.answer`, `task.accepted`, `task.completed`, `federate.status`, `weapon_fire`, `munition_detonation` |
| `federation` | String | The federation name |
| `federate` | String | The BGWS federate that logged it, e.g. `BGWS-1-1` |
| `source_seq` | Long | The event's number in its game's log |
| `sim_time_s` | Double | Simulated seconds since the game started |
| `side` | String | `blue`, `red`, `neutral` or empty |
| `entity_name` | String | HLA instance name of the unit, e.g. `BGWS-1-1-7` |
| `entity_id` | String | The bridge's handle for it (this federation execution only) |
| `entity_unique_id` | String | Its NETN UUID: the same key as the tracks stream's `unique_id` |
| `entity_callsign` | String | Its name, e.g. `Blue 1 Tanks` |
| `target_name` | String | The other unit involved, if any |
| `target_id` | String | |
| `target_unique_id` | String | |
| `target_callsign` | String | |
| `latitude` | Double | Where the unit was |
| `longitude` | Double | |
| `altitude_m` | Double | Metres above the WGS-84 ellipsoid |
| `munition` | String | DIS munition type (RPR fire only) |
| `quantity` | Integer | Rounds (RPR fire only) |
| `result` | String | Detonation result (RPR only) |
| `text` | String | One line for people |
| `data` | String | The figures behind the event, as JSON text (at most 16 KB) |

Volume: roughly 300–600 events in a 30-minute company-sized game, plus a `federate.status` row
every 30 s per BGWS federate.

If ingestion rejects the ISO timestamp string in `received_at`, do the same as the tracks stream
(`STREAMING.md`): make `_iso()` return epoch milliseconds and the column `Long`.

Note the stream's RID; §4 and §7 need it.

---

## 4. Module A, "HLA Streamer" (bridge + streamer)

Source: `NXG-CSE-Prep-Functions/python-functions/python/HLA-Pal-Bridge/`. Background is in
`ARCHITECTURE.md` and `STREAMING.md` there; this section is only what changes.

### 4.1 Rebuild both images from the branch

| Image | Directory | What changed |
|---|---|---|
| `hla-bridge` | `cse-hla-bridge/` | See below |
| `hla-bridge-streamer` | `hla-bridge-streamer/` | See below |

Changes in `hla-bridge`:
- **The build itself.** On `main` it does not compile: every source file started with a stray
  `[main/java/...]` line, `InjectSuppliesRequest.java` held the wrong class, and one regex was
  mangled. All are fixed.
- **Subscription order.** Object classes are subscribed most specific first, so vehicles are
  discovered as `GroundVehicle`, not as a bare `PhysicalEntity`.
- **`GET /events`**, serving fire and detonations from any simulator and BGWS's events.
- **`POST /bgws/control`**, which sends `BGWS_Control`.
- **`foms/BGWS-Events.xml`**, copied into `/foms` by the Dockerfile.

Changes in `hla-bridge-streamer`:
- `events.py`, the new events thread;
- `commands.py`, which now routes `BGWS_LOAD_SCENARIO` and `BGWS_CONTROL`;
- `tracks.py`'s publish path, moved into a shared `Publisher` class.

The bridge's Docker build runs its unit tests (`mvn package`). They pass on the branch: 49 tests
across 5 classes.

### 4.2 Module configuration

Stop the module, change it, start it again. **Sources and outputs only apply on a restart.**

1. **Add an output**: the HLA Events stream, with identifier **`hla-event-stream`**.
2. **Add environment variables** to the `hla-bridge-streamer` container:

   | Variable | Value |
   |---|---|
   | `EVENT_STREAM_ALIAS` | `hla-event-stream` (the identifier above) |
   | `EVENT_POLL_SECONDS` | `1` (default) |
   | `EVENT_BATCH` | `500` (default; events per publish) |

3. **The `hla-bridge` container must be able to send.** `BRIDGE_MODE` must be `full` (the image
   default), not monitor-only. A monitor publishes nothing, so orders and `/bgws/control` both get
   409.
4. **Optional:** `BRIDGE_EVENT_BUFFER` on `hla-bridge` sets how many events the bridge keeps for
   `events.py` to read (default 20000). It only matters if Foundry publishing is down for a long
   time. Overflow is counted (`dropped` on `/events`, `gaps` in the streamer's log), never silent.

Everything else stays as it is: `FEDERATE_NAME`, `FEDERATION_NAME`, `CSE_ENVIRONMENT`,
`TRACK_STREAM_ALIAS`, `COMMAND_STREAM_ALIAS`, `COMMAND_LOG_ALIAS`, minimum replicas 1, and the
sources.

### 4.3 Check it

The module's log shows these:

```
Event publisher: stream ri.foundry.main.dataset.… (branch master) from alias 'hla-event-stream' …
Event publisher: {"events_published": …, "cursor": …, "gaps": 0, …}      (once a minute)
```

`Event publisher is OFF: …` means the alias did not resolve: check the output identifier. The bridge
logs whether the FOM has BGWS's classes:

```
FOM tasking dialect: v4=true …
```

`/diagnostics/fom` lists `HLAinteractionRoot.BGWS_Control` (module "BGWS-Events") as resolved and
published.

---

## 5. Module B, "Commander"

Source: `HLA-Pal-Bridge/hla-command-poster/`. Rebuild and redeploy the `hla-bridge-command-poster`
image from the branch.

- **Two new functions:**

  | Function | Parameters | Writes |
  |---|---|---|
  | `hla_bgws_load_scenario` | `scenario_json` (string, required), `federate` (string, optional), `speed` (float, optional) | operation `BGWS_LOAD_SCENARIO`, TTL 300 s |
  | `hla_bgws_control` | `command`: `start`, `pause`, `resume`, `stop` or `speed` (required); `federate`, `speed` (optional; `speed` required for `speed`) | operation `BGWS_CONTROL`, TTL 15 s |

  Both return the usual queued JSON plus `request_id`, which equals `commandId`. BGWS echoes it in
  the `federate.status` event that answers the command.
- **A fix that matters for every function.** `GroupRequest.selector` was typed `dict`. With
  `foundry-compute-modules` 0.34 a bare `dict` hint fails, and the module stops registering
  functions at `hla_plan_group_task`. It is now `dict[str, str]`. On the branch, all 26 functions
  pass the SDK's schema parser.
- **Scenario size.** Loads over 512 KB are refused rather than truncated
  (`BGWS_MAX_SCENARIO_BYTES`). Scenarios are typically 5–50 KB.
- **Order functions.** `hla_move_to_location`, `hla_patrol`, `hla_magic_move`, `hla_stop_entity`,
  `hla_cancel_tasks`, `hla_set_roe`, `hla_fire_at_entity` and `hla_fire_at_location` are unchanged.
  BGWS now answers them.

After deploying, check that `hla_bgws_load_scenario` and `hla_bgws_control` are listed among the
module's functions. Note their API names (expected `hlaBgwsLoadScenario` and `hlaBgwsControl`); §7
needs them.

---

## 6. Run BGWS: `bgws federate`

BGWS runs **outside Foundry**, on a host that can reach the federation the same way the simulators
do. It joins, waits, and plays whatever Foundry loads. One process is one federate; it can play
several games in a row.

### 6.1 Host requirements

- **Linux** x86-64 (it also builds on macOS). 4+ cores and 8 GB RAM is comfortable for
  company–battalion games.
- **Network to the FedPro server.** This is the same address as the bridge's `FEDPRO_ADDRESS`. In the
  CSE setup it is the firewall host on port `30<env>20`, e.g. `4.165.4.53:30120` for environment 1.
  See `FEDPRO_CONNECTION.md`.
- **Internet for real terrain**, the first time an area is used. It needs
  `build.protomaps.com` (OpenStreetMap land cover, water and roads), `download.mapterhorn.com`
  (elevation) and `github.com`. Data is read by HTTP range requests and cached, so a 5 × 4 km area
  took under a minute here. After that the pack is reused, keyed by the exact area.
  - With no internet, build packs in advance (§6.5), or let only `generated` ground be used
    (`--allow-generated-ground`, see §6.3).

### 6.2 Build

```sh
git clone https://github.com/DavidAlexKelly/bgws-jev && cd bgws-jev
git checkout claude/confident-cannon-en7fsq
cargo build --release -p bgws-run          # Rust stable; the binary is target/release/bgws
```

It also needs the federation's FOM files. Copy them from the bridge repository:

```
cse-hla-bridge/foms/NETN-Merged-With-RPR.xml
```

`BGWS-Events.xml` is built into BGWS; it does not need to be passed.

### 6.3 Run

```sh
bgws federate \
  --hla 4.165.4.53:30120 \                      # the FedPro server (host:port)
  --federation CSE-Prep \                       # the federation the bridge joins
  --fom /opt/bgws/foms/NETN-Merged-With-RPR.xml \
  --federate BGWS-1-1 \                         # how Foundry addresses it (default BGWS-<site>-<app>)
  --site 1 --application 1 \                    # its DIS site/application: unique in the federation
  --packs /var/lib/bgws/packs \                 # where terrain built for Foundry's areas is kept
  --records /var/lib/bgws/records \             # each game's record, when it ends
  --speed 1                                     # default speed until Foundry sets one
```

| Option | Default | Notes |
|---|---|---|
| `--hla` | (required) | FedPro server, `host:port`. |
| `--federation` | `BGWS` | Must match the bridge's `FEDERATION_NAME`. |
| `--fom` | none | The federation's FOM module(s). Repeat for each. |
| `--mim` | none | Only used if BGWS creates the federation. Do not pass it for CSE-Prep. |
| `--federate` | `BGWS-<site>-<app>` | Unique in the federation. A second BGWS needs another name and site. |
| `--site`, `--application` | 1, 1 | DIS identity of its entities (`BGWS-site-app-n`). Pick a site no other simulator uses. |
| `--packs` | `packs` | Terrain cache. Keep it on persistent disk. |
| `--cell-m` | 30 | Grid spacing of terrain built for Foundry. |
| `--allow-generated-ground` | off | Lets scenarios use `"terrain": "generated"`. Off by default, because no other simulator has that ground. |
| `--speed` | 1 | Simulated seconds per wall-clock second until Foundry sets one. |
| `--records` | none | Writes a replayable record of each game: every Foundry order is in it. |

**Start the federation first.** When BGWS joins it also asks to create the federation, as every
BGWS federate does. If CSE-Prep is not up, BGWS would create an empty CSE-Prep of its own. Start it
once the simulators' federation exists.

**Stopping.** On SIGTERM or Ctrl-C it ends the game, writes the record and **resigns**, so a
restart can reuse the name. If it is killed with SIGKILL, the RTI holds the federate name until its
reconnect timeout (10 minutes on CSE-Prep, per `ARCHITECTURE.md`).

### 6.4 Keep it running (example)

`/etc/systemd/system/bgws-federate.service`:

```ini
[Unit]
Description=BGWS federate (waits for Foundry)
After=network-online.target

[Service]
ExecStart=/opt/bgws/bgws federate --hla 4.165.4.53:30120 --federation CSE-Prep \
  --fom /opt/bgws/foms/NETN-Merged-With-RPR.xml --federate BGWS-1-1 --site 1 \
  --packs /var/lib/bgws/packs --records /var/lib/bgws/records
Restart=on-failure
RestartSec=30
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
```

This unit file is an example; it was not run as a service here. `RestartSec=30` gives the RTI time
to clear a crashed federate before the restart.

### 6.5 Terrain in advance (optional)

To build a pack ahead of time, or without internet on the federate host, build on another machine
and copy the folder into `--packs`:

```sh
bgws terrain --bbox WEST,SOUTH,EAST,NORTH --cell-m 30 /var/lib/bgws/packs/foundry_<W>_<S>_<E>_<N>
```

The folder name must match what the federate looks for: `foundry_` followed by the area's west,
south, east and north to 4 decimals, joined by `_`, with `-` written as `m`. For example,
`foundry_20.4400_54.6900_20.5100_54.7300`. The federate prints the folder it uses.

### 6.6 Check it

Its log (stderr) reads like this:

```
HLA: joining CSE-Prep at 4.165.4.53:30120 as BGWS-1-1, waiting for a scenario
[idle] waiting for a scenario
```

In Foundry, a `federate.status` row with `state: idle` appears on HLA Events within 2 minutes
(heartbeats come every 2 minutes when idle and every 30 s otherwise).

---

## 7. The frontend: `NXG-Mapplications-Repo`, route `/bgws`

The app is the existing Mapplications OSDK app. `/bgws` is a new route in it, alongside `/hlamap`,
`/execute` and the rest; see `NXG-Mapplications-Repo/docs/BGWS.md` for the screen itself.

### 7.1 Configure

1. **Event stream RID.** Set it in `.env.production` (and `.env.development` for local work):

   ```
   VITE_HLA_EVENTS_STREAM_RID=ri.foundry.main.dataset.<the HLA Events stream from §3>
   ```

   It can also be set per Workshop page with the `eventStreamRid` field (§8). Until it is set, the
   screen says "event stream not configured" and cannot show BGWS's state. Commands still send.
2. **Command Stream Output.** It defaults to `ri.foundry.main.dataset.28808101-…`. Override it with
   `VITE_HLA_COMMAND_OUTPUT_RID` if needed.
3. **The Developer Console application** (`ri.third-party-applications.main.application.01d93c11-…`).
   Under its resources, add:
   - the functions **`hla_bgws_load_scenario`** and **`hla_bgws_control`**;
   - read access to the **HLA Events** stream, the HLA Entity Tracks stream and the Command Stream
     Output. Tracks and the output stream are probably there already for `/hlamap`.

   Its OAuth scopes already include `api:streams-read`.
4. **SDK (optional).** Regenerate the OSDK with the two new functions and bump
   `@nxg-simulation-execution-testing/sdk`. Until then the app calls them through the Ontology Queries
   REST API under both names (`hlaBgwsLoadScenario`, `hla_bgws_load_scenario`), the same fallback the
   Execute screen uses.

### 7.2 Build and deploy

As for the rest of the app (`README.md`):

```sh
npm install            # needs FOUNDRY_TOKEN for the private registry
npm run check          # lint, typecheck, tests
git tag <x.y.z> && git push origin tag <x.y.z>   # Foundry CI deploys the build
```

**What was and was not checked.** The new code was tested outside Foundry:
- **Checked:**
  - 95 new unit tests (scenario JSON, order mapping, outcome folding, filters, drafts, mock engine);
  - a typecheck;
  - a production build;
  - a headless-browser run of the whole flow in mock mode.
- **Not checked:** this environment cannot install the private packages, so it has not run against
  Foundry. The first real run is §9.

### 7.3 Try it without anything else

Open `/bgws?mock=1`, or set the Workshop `mockDemo` field. A pretend BGWS runs in the browser. It
answers loads and controls, moves units to ordered points, and produces events and outcome rows in
the real shapes. It is useful for demos and for checking the Workshop wiring before the backend is
up.

---

## 8. Workshop

In the Plan & Prepare module (or any module), add an **iframe widget** pointing at the app's `/bgws`
route, bidirectional, like the existing Execute and HLA map iframes. A full-height section works
best.

The iframe's fields (`src/apps/bgws/bgwsConfig.ts`):

| Field | Kind | Use |
|---|---|---|
| `mockDemo` | boolean, in/out | Run the in-browser pretend BGWS (no backend needed). Default false. |
| `mode` | string | `build` or `live`: which half opens. |
| `federate` | string | The BGWS federate to address, e.g. `BGWS-1-1`. Empty for every BGWS federate. |
| `eventStreamRid` | string | HLA Events stream RID, if not built into the app. |
| `scenarioJson` | string, in/out | In: a scenario to open in the builder (e.g. from an object property). Out: the last scenario loaded. |
| `selectedUnitUuid` | string, out | NETN UUID of the selected unit: the key in the tracks and events streams. |
| `selectedUnitCallsign` | string, out | Its name, for headers. |
| `onUnitSelected` | event | Fired when a unit is selected. |
| `onScenarioLoaded` | event | Fired when a load is queued. |

The widget library only has in/out fields, so the "in" ones are declared that way too.

To store scenarios in the ontology, bind `scenarioJson` to a string property of a scenario object.
Then `onScenarioLoaded` with an action can save the last loaded scenario back.

---

## 9. First run: the smoke test

With Modules A and B redeployed, the HLA Events stream wired, `bgws federate` running, and the
frontend deployed:

1. **BGWS is there.** Open `/bgws`. Within 2 minutes the control bar shows `BGWS-1-1 · idle`. If it
   does not, see §11.
2. **Build.** Switch to *Build*:
   - drag a small box (a few km) for the area;
   - keep terrain `real`;
   - place a command post and two units for blue, and one unit and a command post for red;
   - add an objective for blue.
3. **Load.**
   - The progress reads queued → sent, then BGWS `building_terrain` (the first time for this area),
     then `ready`.
   - Before you press Start, the units appear on the *Live* map at the places you put them: that is
     the initial state, published as soon as it is loaded.
4. **Start** at, say, 5x. The state becomes `running` and sim time advances. Events start to arrive
   (`c2.hq`, `c2.order_received`, `decide.*`, …).
5. **Order.**
   - Select a blue unit, choose *Move here*, and click about 1 km away.
   - The order goes queued → sent → accepted → executing.
   - The unit moves. When it arrives (within 75 m), the order goes to **completed**.
   - The events show `task.accepted`, and later `task.completed`.
6. **Pause**, then check that sim time stops. **Resume**, then **Stop**: the units leave the map.

What this run looked like on one machine. Everything except Foundry was real: BGWS's own RTI in place
of pRTI, the real Java bridge, and `bgws federate`.
- **Load:** terrain was built for a 5 × 4 km box near Kaliningrad in under a minute. All five units
  appeared in the bridge's `/entities` with UUIDs and names before the start.
- **Order:** after a start at 10x, a move went accepted → executing → completed. On the way the unit
  halted on its own to dismount its infantry 624 m short; it was sent on again and arrived.
- **Refusal:** a speed change was refused, as it should be.

---

## 10. Reference

### 10.1 The scenario Foundry sends (`bgws.foundry` version 1)

The builder produces this; anything else that writes it works too.

```json
{
  "format": "bgws.foundry", "version": 1,
  "name": "Op Example", "seed": 1, "durationMin": 90,
  "startUtc": "2026-06-01T08:00:00Z", "weather": "clear",
  "area": {"south": 54.65, "west": 20.40, "north": 54.75, "east": 20.55},
  "terrain": "real",
  "command": {"blue": "rules", "red": "rules"},
  "units": [
    {"id": "b-hq", "label": "Blue Coy HQ", "side": "blue", "platform": "generic/cp-company",
     "lat": 54.66, "lon": 20.45},
    {"id": "b-1", "label": "Blue 1 Tanks", "side": "blue", "platform": "generic/mbt",
     "count": 4, "quality": "regular", "lat": 54.68, "lon": 20.46, "headingDeg": 0}
  ],
  "objectives": [
    {"side": "blue", "label": "OBJ GOLD", "lat": 54.71, "lon": 20.47, "radiusM": 600, "holdMin": 10}
  ],
  "breakpointPct": 60
}
```

- **`area`:** at most 150 km a side. Every unit must stand inside it.
- **`terrain`:**
  - `real`: real ground for the area, built once and reused.
  - `generated`: synthetic ground, only if BGWS runs with `--allow-generated-ground`.
- **`side`:** `blue`, `red` or `neutral`.
- **`quality`:** `green`, `regular`, `veteran` or `elite`.
- **`platform`:** a BGWS catalogue id, e.g. `generic/mbt`, `generic/ifv`, `generic/mortar120`,
  `generic/sph155`, `generic/recce`, `generic/infantrySection`, `generic/shorad`. The builder's
  palette lists all 94.
- **`command.<side>`:**
  - `rules`: the side's first command post (`generic/cp-company`, `-battalion`, `-brigade` or
    `-division`) becomes its HQ and plans for the other units. Foundry orders take a unit over from
    its HQ.
  - `foundry`: no HQ. Units hold until Foundry orders them, though they still defend themselves.
- **Objectives:** a side wins by holding its objective for `holdMin`. The game also ends at
  `durationMin`, or when a side falls below `breakpointPct` of its strength.
- **Native scenarios:** a full BGWS scenario (`"format": "bgws.scenario"`, version 4) is also
  accepted unchanged, e.g. one exported from BGWS's own tools.

### 10.2 Control commands

| Command | Effect |
|---|---|
| `load` | Ends any current game, builds the new one (terrain if needed), publishes its units, waits. |
| `start` / `resume` | Runs in real time at the current speed (`options.speed` may set it). |
| `pause` | Holds the clock. Orders are still taken in and answered while paused or before the start. |
| `stop` | Ends the game, writes its record, takes its units off the federation. |
| `speed` | Simulated seconds per wall-clock second (0.1–100 in the UI). |

RPR `StartResume` and `StopFreeze`, which the existing `hla_sim_start` and `hla_sim_pause` send, act
as start and pause.

### 10.3 `federate.status` states

| State | Meaning |
|---|---|
| `idle` | Waiting for a scenario |
| `building_terrain` | Building real terrain for the area. Progress is reported about every 10 s |
| `ready` | Loaded, units published, waiting for start |
| `running` | Playing |
| `paused` | Clock held |
| `finished` | The game ended. `message` has the verdict (winner, reason, strengths) |

`data` also carries `requestId`, `message`, `scenario`, `simTimeS`, `speed`, `units` and
`durationS`. A refused command keeps the state and says why in `message`, e.g. "scenario refused: …".

### 10.4 Orders: what BGWS does

| Function | NETN class | BGWS |
|---|---|---|
| `hla_move_to_location` | MoveToLocation | Moves there. Move type `OnlyRoads` is a road march; otherwise tactical across country. Completed within 75 m of the point. |
| `hla_patrol` | Patrol | Goes through the waypoints. `once`: then holds. Loop/pingpong: repeats until cancelled. |
| `hla_magic_move` | MagicMove | Puts it there with that heading, at once. |
| `hla_stop_entity` | StopAtSideOfRoad | Halts and holds. |
| `hla_cancel_tasks` | CancelTasks | Drops its orders. It holds and is its HQ's again. |
| `hla_set_roe` | ChangeRulesOfEngagement | hold_fire → never; return fire → if fired upon; fire_at_will → always. |
| `hla_fire_at_entity` | DirectFire | Engages that unit. The target must be one of this BGWS's units. |
| `hla_fire_at_location` | IndirectFire | Calls a fire mission on the point for the unit's side. |
| `hla_set_speed` / `_heading` / `_altitude` | Change* | **Refused**: not modelled. |

- **Outside command.** A unit given a Foundry order stays under Foundry's command (its HQ's replans
  pass it by) until its tasks are cancelled. It still returns fire and runs its drills.
- **Stopping short.** A unit that stops short of its point for 2 minutes is sent on once, e.g. after
  dismounting its infantry in a town. If it stops short again, the task ends in Error, with how far
  short it stopped.
- **Answers.** Every order is answered: `SMC_Response` true or false, and `ETR_TaskStatus` Accepted
  or Refused at once, then Executing, then Completed, Cancelled (a newer order replaced it) or Error
  (the unit was lost, or it stopped short twice).

### 10.5 Event kinds worth knowing

| Kind | |
|---|---|
| `sense.detect` | A unit sees an enemy |
| `fire.hit`, `fire.miss`, `fire.kill`, `fire.suppress` | Direct fire and its effect |
| `fires.request`, `fires.impact` | Indirect fire missions |
| `unit.destroyed`, `unit.dismount` | Losses, dismounting |
| `c2.order_received`, `c2.plan_issued` | BGWS's own command and control |
| `decide.question`, `decide.answer`, `decide.apply` | A unit's decision, the option chosen, and why (in `data`) |
| `task.accepted`, `task.refused`, `task.completed`, `task.cancelled`, `task.failed`, `task.resumed` | Foundry's orders |
| `smoke.screen`, `laser.designate`, `laser.lost` | Smoke and laser designation |
| `victory.met`, `victory.lost` | Objectives |
| `federate.status` | The federate's state (§10.3) |
| `weapon_fire`, `munition_detonation` | RPR fire from any simulator (`source = rpr`) |

---

## 11. Troubleshooting

| Symptom | Likely cause | Check / fix |
|---|---|---|
| No `federate.status` rows at all | BGWS not running or not joined; wrong federation; or the events path is off | BGWS's log says "waiting for a scenario". The bridge's `/diagnostics/federates` lists `BGWS-1-1`. Module A's log has "Event publisher: …" lines, not "OFF". |
| Event publisher is OFF | Output identifier not matched | The output identifier must equal `EVENT_STREAM_ALIAS`. Restart the module after changing outputs. |
| Event rows rejected | Schema mismatch | Every column nullable except `event_id`. Types as in §3. The publish error names the column. |
| Load stays at "sent", no BGWS answer | BGWS not in this federation, or `federate` names another one | Leave `federate` empty to address every BGWS. Check `--federation`. |
| Load answered "scenario refused: …" | The scenario is invalid (the reason is in the message) | A unit outside the area, an unknown side, an area that is not a box, an unknown platform, generated terrain not allowed. |
| Stuck in `building_terrain`, or "terrain build failed" | No internet on the BGWS host for that area | Allow `build.protomaps.com`, `download.mapterhorn.com` and `github.com`, or build the pack elsewhere (§6.5). |
| Orders get 409 | Bridge in monitor-only mode, or no v4 dialect | `BRIDGE_MODE=full`. `/status` shows `taskDialect: v4`. |
| Order "sent" but never accepted | The unit's UUID is not a BGWS unit's, or BGWS is not running a game it knows | Use the track's `unique_id`. Orders are taken while ready, running or paused; a finished game takes none. |
| Order refused | Speed, heading or altitude (not modelled); a destroyed unit; a target that is not a BGWS unit | Shown with its reason in BGWS's log and as `task.refused`. |
| Restarted BGWS: "FederateNameAlreadyInUse" | The last run was killed without resigning | Wait for the RTI's reconnect timeout, or start with another `--federate` name. Stop BGWS with SIGTERM, not SIGKILL. |
| Vehicles shown as bare `PhysicalEntity` | Old bridge image | Redeploy from the branch (subscription order fix). |
| Commander module will not register functions | `foundry-compute-modules` 0.34 and the old `selector: dict` hint | Redeploy Module B from the branch. |

**Debug switch.** `BGWS_DEBUG_TASKING=1` in BGWS's environment prints every task interaction it
receives: the class, its parameters, and whether it recognised the entity.

---

## 12. Known limits

- **Not tested against pRTI or Foundry yet.** BGWS's HLA client has only met BGWS's own RTI.
  Pitch's client has been checked against that RTI, and the real bridge has run against it.
  - The task encodings match the bridge's golden byte vectors.
  - The live Foundry streams, functions and Workshop have not been exercised end to end. §9 is that
    test.
- **Events are lost while the bridge is down.** HLA keeps no history of interactions, so anything
  sent while the bridge is down never reaches the stream.
- **One scenario per BGWS federate at a time.** Run more federates (each with its own `--federate`
  and `--site`) for parallel games.
- **No pacing feedback from the federation.** BGWS plays in real time at its speed, not
  time-managed with other simulators. For lock-step federations, `bgws play --time-managed` still
  exists, but it is not driven from Foundry.
- **Direct fire targets must be units of the same BGWS.** Other simulators' entities cannot be
  named as targets yet, because BGWS does not read their UUIDs.
- **Records replay only on the same BGWS build** that recorded them.
- **The frontend's command progress is per browser session.** A reload forgets which commands it
  sent; the streams still have everything.
