# BGWS — scenario, control and orders from Foundry

Route `/bgws` (`src/apps/bgws/`). BGWS is a constructive wargame simulation (Rust, its own repository)
that joins the HLA federation as a **standing federate**: it starts, joins, and waits for a scenario.
This screen is Foundry's side of it. You use it to:
- build the initial state (area, terrain, weather, units, objectives);
- send it to BGWS;
- start, pause, resume, stop and speed up the game;
- watch it;
- give BGWS units orders.

Foundry never talks to BGWS directly. Every action is a **Commander function** (hla-command-poster),
which writes a row to the command stream. The HLA streamer executes the row against the bridge, and
the bridge sends an HLA interaction. Everything BGWS says comes back on **streams**:

```
Foundry (this screen) ──function──▶ Command Stream Input ──▶ streamer commands.py ──▶ bridge REST ──▶ HLA ──▶ BGWS
        ▲                                                                                             │
        ├── HLA Entity Tracks ◀── tracks.py ◀── bridge /entities ◀── RPR entities + NETN UniqueId ◀───┤
        ├── HLA Events ◀── events.py ◀── bridge /events ◀── BGWS_Event (incl. federate.status) ◀──────┤
        └── Command Stream Output ◀── commands.py (SENT/REFUSED/…, then ACKNOWLEDGED) ◀── SMC/ETR ◀───┘
```

The backend side is described in
`NXG-CSE-Prep-Functions/python-functions/python/HLA-Pal-Bridge/` (`BGWS.md`, `ARCHITECTURE.md`,
`FOM_TASKING.md`, `WIRE_CONTRACT.md`).

## The screen

**Header.** It shows:
- **Build | Live**, to switch between the two halves;
- the health of the three streams (Tracks with the BGWS/total count, Events, Outcomes);
- demo mode;
- the app switcher.

**Control bar** (above both halves):

| Control | Function | Parameters |
|---|---|---|
| Federate | — | Which BGWS federate to address, e.g. `BGWS-1-1`. Empty = every BGWS federate. Suggestions are the federates heard from on the event stream. |
| Load scenario | `hla_bgws_load_scenario` | `{scenario_json, federate?, speed?}`. `scenario_json` is the builder's "bgws.foundry" v1 JSON, or an imported native scenario unchanged. Disabled while the builder reports an error. |
| Start / Pause / Resume / Stop | `hla_bgws_control` | `{command: "start"\|"pause"\|"resume"\|"stop", federate?}` |
| Speed × / Set | `hla_bgws_control` | `{command: "speed", federate?, speed}` (sim s per wall s, 0.1–100). The value is also passed to Load. |

The bar also shows BGWS's own state for each federate in view, from `federate.status` events: the
state, the sim time, the speed, the unit count, the scenario and the message. While a game is
running, the sim time is estimated between BGWS's 30 s heartbeats.

When exactly one federate is in view, the buttons follow its state: Start is enabled only from
ready/paused, and so on. When the state is unknown (no event stream), all of them are enabled.

The last load/control command is shown with its progress:
- **queued → sent**, from the Command Stream Output;
- then **BGWS: <state>**, from the `federate.status` whose `requestId` is that command's id.

**Build** — the scenario builder:
- **Map tools.**
  - *Area*: drag a box to set the area of operations.
  - *+ Unit*: click to place a unit from the palette.
  - *+ Objective*: click to place an objective.
  - *Select*: click to select.
  - Units and objectives can always be dragged. Delete/Backspace removes the selected one; Esc goes
    back to Select.
- **Scenario.** It has:
  - name;
  - start (UTC);
  - duration (min);
  - weather (`clear`, `overcast`, `rain`, `heavy_rain`, `fog`, `snow`, `storm`);
  - terrain: `real` (BGWS builds it from elevation, land cover and OSM roads, which needs internet on
    the BGWS host and takes a minute or more) or `generated`;
  - seed;
  - breakpoint %;
  - command per side: `rules` (BGWS decides, and Foundry orders override) or `foundry` (units hold
    until ordered).
- **Unit palette.** Side, count, quality, and a platform from the BGWS catalogue, grouped by
  domain/class. Command posts are listed first; the first one on a side becomes that side's HQ.
- **Selected unit or objective.** You can edit:
  - for a unit: label, side, count, quality, heading, platform;
  - for an objective: label, side, radius, hold minutes.
- **Checks.**
  - Errors block Load:
    - no area, or an area that is not a valid box or is too big (more than 400 km);
    - fewer than one blue and one red unit;
    - a unit or objective outside the area;
    - a bad count (1–99), duration, breakpoint or start time;
    - duplicate ids.
  - Warnings do not:
    - a platform this app's catalogue does not know (BGWS is the judge);
    - more than one CP on a side;
    - a large area with real terrain (more than 120 km);
    - no objectives;
    - a side under `foundry` command;
    - a scenario over 200 KB.
  - Click a check to select the unit it is about.
- **Drafts.**
  - Save/open by name in this browser's localStorage. Every access is guarded, so blocked storage in
    an iframe only disables drafts.
  - The working copy is autosaved too.
  - **Import JSON** accepts a builder export ("bgws.foundry" v1) or a native BGWS scenario
    ("bgws.scenario"). A native scenario is sent unchanged and cannot be edited here.
  - **Export JSON** downloads exactly what Load would send. **Show JSON** previews it.

**Live:**
- **Events** (left): the HLA Events stream, newest first. You can filter by family (`fire`, `unit`,
  `sense`, `task`, …), by side, by the selected unit, and by text. `federate.status` is hidden unless
  ticked. Click an event to select the unit it names and fly to where it happened.
- **Map** (middle): the HLA Entity Tracks stream on the shared `EntityMap`. You choose either
  *BGWS only* or *All, BGWS highlighted* (other entities faded). The loaded scenario's area and
  objectives are drawn for context.
- **Unit panel** (right): the unit's callsign, side, type, DIS type, damage, speed, heading, position,
  altitude and UUID, then the orders below. Every order is listed with its progression:
  queued → sent → accepted → executing → completed, or refused/cancelled/error/expired/failed.

### Which tracks are BGWS's

BGWS names its entities `BGWS-<site>-<app>-<n>`, and its federates `BGWS-<site>-<app>`. An entity is
treated as BGWS's when one of these is true:
- its name starts with `BGWS-`;
- with a federate selected, its name starts with `<federate>-`;
- its UUID appears in a BGWS event.

The bridge's `simulator` column reads `unknown` for BGWS, so it is not relied on.

## Orders (no new functions)

BGWS accepts the NETN v4 tasking the existing `hla_*` functions already send. Orders are addressed by
the unit's **NETN UniqueId** (the track's `unique_id`), passed as `entity_id`. A unit without one is
never addressed by its HLA handle; the order is refused in the UI instead. The calls go through
`src/apps/hlamap/bridgeClient.ts`, which is unchanged, so its vocabulary mappings apply.
`src/apps/bgws/lib/orders.ts` decides which method to call and with what.

| Order | Function | Parameters sent | BGWS does |
|---|---|---|---|
| Move here (click) | `hla_move_to_location` | `entity_id, latitude, longitude, move_type: FASTEST, speed_meters_per_second: 10` | moves there |
| Patrol (click points, then Send) | `hla_patrol` | `entity_id, patrol_type: ONCE, move_type: FASTEST, waypoints[], duration_seconds, interval_seconds` | goes through the points in order, then holds |
| Magic move (heading, click) | `hla_magic_move` | `entity_id, latitude, longitude, heading_degrees, altitude_meters` (the unit's own) | teleports, sets heading |
| Stop | `hla_stop_entity` | `entity_id` | stops and holds |
| Cancel tasks | `hla_cancel_tasks` | `entity_id` | drops its orders, holds |
| Set ROE | `hla_set_roe` | `entity_id, roe: hold_fire\|return_fire\|fire_at_will` | never / if fired upon / always |
| Fire at unit (click target) | `hla_fire_at_entity` | `entity_id, target_id` (target's UUID), `duration_seconds: 60` | engages the target |
| Fire mission (duration, click) | `hla_fire_at_location` | `entity_id, latitude, longitude, duration_seconds` | fire mission on the point for the unit's side |

Three orders are **not offered**: `hla_set_speed`, `hla_set_heading` and `hla_set_altitude`. BGWS
refuses all three. Patrol is offered as "once" only, because that is how BGWS plays a patrol.

### Outcomes

Each function returns `{"status": "queued", "commandId": …}`. The app then looks up that `command_id`
on the **Command Stream Output** (`lib/outcomes.ts`):

| Row | Shown as |
|---|---|
| `SENT` / `DEFERRED` | sent / deferred |
| `REFUSED` / `FAILED` / `EXPIRED` | refused / failed / expired, with the detail on hover |
| `ACKNOWLEDGED`, detail `… SMC_Response: accepted` | accepted. `rejected/failed` shows as refused |
| `ACKNOWLEDGED`, detail `… task status: Accepted\|Executing\|Completed\|Cancelled\|Refused\|Error` | the same word |

The furthest state reached wins. Rows from different partitions can arrive out of order, and a late
"Accepted" must not undo "Completed".

## Scenario JSON ("bgws.foundry" v1)

`lib/scenario.ts` `buildScenario()` produces the contract's document, key for key:

```json
{
  "format": "bgws.foundry", "version": 1,
  "name": "Op Example", "seed": 1, "durationMin": 90,
  "startUtc": "2026-06-01T08:00:00Z", "weather": "clear",
  "area": {"south": 54.65, "west": 20.40, "north": 54.75, "east": 20.55},
  "terrain": "real",
  "command": {"blue": "rules", "red": "rules"},
  "units": [{"id": "b-1", "label": "Blue 1 tanks", "side": "blue", "platform": "generic/mbt",
             "count": 4, "quality": "regular", "lat": 54.68, "lon": 20.46, "headingDeg": 0}],
  "objectives": [{"side": "blue", "label": "OBJ GOLD", "lat": 54.71, "lon": 20.47, "radiusM": 600, "holdMin": 10}],
  "breakpointPct": 60
}
```

Details:
- Coordinates are rounded to 6 decimals.
- `command.neutral` is included only when there are neutral units.
- Objectives' editor ids are not sent.

## The platform catalogue

`src/apps/bgws/data/platforms.ts` is the BGWS catalogue (94 platforms: id, name, class, domain,
echelon) checked in as typed data, because BGWS's catalogue is not reachable from Foundry. It adds:
- an **APP-6 nature path** per platform, in the vocabulary of `shared/hla/symbology/app6.ts`, so placed
  units draw like live ones;
- an explicit 2525C function ID for drones (`MFQ`) and submarines (`S`).

The vehicle models (`tankmodels/*`, `var_*`) and national sections (`sec_*`) carry no class or domain
in BGWS's export. They are classified by hand and marked `inferred`.

To regenerate the file, export the catalogue from BGWS as JSON (id, name, class, domain, echelon) and
rebuild the array, keeping the nature mappings.

## Embedding in Workshop

Add an **iframe custom widget** pointing at the deployed app's `/bgws`, as for `/hlamap`. The config
is in `src/apps/bgws/bgwsConfig.ts`:

| Field | Type | Use |
|---|---|---|
| `mockDemo` ("mock-demo") | boolean, in/out | Demo mode, shared with HLA Map / Execute / Analysis. |
| `mode` | string, in | `build` or `live`: which half to open on. Empty = build. Lets one module show the builder on a Plan tab and the live view on an Execute tab. |
| `federate` | string, in/out | The federate the controls address. Empty = all. Written back when the operator changes it. |
| `eventStreamRid` | string, in | HLA Events stream RID. Overrides the built-in default. |
| `scenarioJson` | string, in/out | In: a scenario to open in the builder (e.g. from an object property). Out: the JSON last loaded into BGWS from here. |
| `selectedUnitUuid`, `selectedUnitCallsign` | string, out | The selected unit. BGWS UUIDs are name-based and stable across runs. |
| `onUnitSelected` | event | Fired when a unit is selected. |
| `onScenarioLoaded` | event | Fired when `hla_bgws_load_scenario` has queued a scenario. |

Outside Workshop, `?mock=1` (or the header toggle) turns on demo mode. Workshop's own fields are
ignored when the page is not embedded.

## What to configure

1. **HLA Events stream RID.** The stream does not exist yet. Until it is set:
   - the events panel says "event stream not configured";
   - the control bar cannot show BGWS's state, although commands can still be sent.

   Set it either way:
   - per widget, with the Workshop field `eventStreamRid`;
   - at build time, with `VITE_HLA_EVENTS_STREAM_RID` (see `src/apps/bgws/config.ts`).

   Its columns are those of `events.py` `to_record`.
2. **Command Stream Output RID.** The default is `ri.foundry.main.dataset.28808101-…`. Override it
   with `VITE_HLA_COMMAND_OUTPUT_RID`.
3. **Entity tracks.** These use the shared `VITE_HLA_TRACKS_DATASET_RID` (`src/shared/hla/dataset.ts`).
4. **Developer Console application.** Add these as resources:
   - the two new functions, `hla_bgws_load_scenario` and `hla_bgws_control`;
   - read access to the HLA Events and Command Stream Output streams.

   Then regenerate and install the SDK. Until then, the two functions are called through the Ontology
   Queries REST API (`executeQuery` in `src/shared/lib/platformFunctions.ts`), under the names
   `hlaBgwsLoadScenario` / `hla_bgws_load_scenario` and `hlaBgwsControl` / `hla_bgws_control`.
   This works once the app has permission on them. The `hla_*` order functions are already in the
   SDK.
5. **Record size.** A scenario is sent as one command-stream record, typically 5–50 KB. The builder
   warns above 200 KB.

## Demo mode

`hooks/useBgwsMock.ts` runs `lib/mockEngine.ts`, a pretend BGWS federate and backend, in the browser.
It produces the same three feeds in the same shapes:
- tracks;
- events, including `federate.status` with the request's id;
- outcome rows: `SENT`, then `ACKNOWLEDGED` with SMC and ETR statuses.

The screen reads them through the same code as live data. Its behaviour:
- **Load:** loading → building_terrain → ready, then the scenario's units appear as
  `BGWS-1-1-<n>`, with stable UUIDs.
- **Start:** units under `rules` head for their side's nearest objective. Units under `foundry` hold.
- **Orders:** ordered units move in straight lines, and orders complete on arrival.
- **Combat:** opposing units detect each other within 4 km, and shoot within 2.5 km, subject to ROE.
- **Fire missions** land after 20 sim seconds.
- **Heartbeat:** a status every 30 s.

The live track stream is not polled in demo mode.

## Code map

| File | What |
|---|---|
| `index.tsx` | App shell: Workshop context, draft, data sources (live or mock), command bookkeeping |
| `components/TopBar.tsx`, `ControlBar.tsx` | Header; load/control and federate state |
| `components/BuilderView.tsx`, `BuilderMap.tsx` | Scenario builder |
| `components/LiveView.tsx`, `LiveMap.tsx`, `EventsPanel.tsx`, `UnitPanel.tsx`, `OutcomeTrail.tsx` | Live view and orders |
| `api/bgwsClient.ts` | `realBgwsApi`: `executeQuery` for the BGWS functions, hlamap's `bridge` for orders |
| `hooks/useStreamTail.ts` | Generic stream tail, modelled on hlamap's `useEntityTrackStream` |
| `hooks/useBgwsEvents.ts`, `useCommandOutcomes.ts`, `LiveTrackFeed.tsx`, `useBgwsMock.ts` | Data sources |
| `lib/scenario.ts`, `drafts.ts`, `orders.ts`, `control.ts`, `outcomes.ts`, `events.ts`, `symbols.ts`, `geo.ts`, `mockEngine.ts` | Pure logic, unit-tested (`*.test.ts`) |
| `data/platforms.ts` | BGWS platform catalogue with APP-6 mapping |

## Limits worth knowing

- **Federate state needs the event stream.** Without it, the control bar shows what was sent, not what
  BGWS did.
- **Shared outcome stream.** The Command Stream Output carries every viewer's commands. Only the
  commands issued from this screen, in this session, are tracked. A reload forgets them, although
  their rows remain on the stream.
- **Estimated sim time.** It is extrapolated from the last status using browser time against the
  bridge's `received_at`. Clock skew between the two shows up as a small offset.
- **Separate drafts.** Drafts are per browser. Use Export/Import, or the Workshop `scenarioJson` field,
  to share a scenario.
