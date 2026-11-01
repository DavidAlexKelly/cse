# HLA–Palantir Bridge: architecture and handover

The system that lets Foundry watch, and task, entities in an HLA simulation
federation. Read this first; the other documents in this directory are the deep
dives it points at.

Referenced by `streamer.py` as the place the full picture lives.

---

## 1. What this is, in one paragraph

An HLA federation (currently `CSE-Prep`, running on a Pitch RTI outside Foundry)
holds the simulated world: vehicles, aircraft, vessels, their positions and
their damage state. Two things are wanted from Foundry. **Read**: a live picture
of every entity, as a stream that can back an ontology object type. **Write**:
the ability to order an entity to move, patrol, fire or stop, from a Workshop
button, an agent, or a lasso-select on a map. HLA is a Java/C++ world with a
byte-exact wire format and a licence-limited RTI, so neither direction can be
done from Foundry directly. This project is the adapter: a Java federate that
speaks HLA, a Python sidecar that speaks Foundry, and a command gateway that
turns validated intent into stream records.

---

## 2. The pieces

Three images, one directory each, deployed as **two compute modules**.

| Directory | Image | Language | What it does |
|---|---|---|---|
| `cse-hla-bridge/` | `hla-bridge` | Java | The only component that speaks HLA. Joins the federation, subscribes to entity state, encodes tasks onto the wire, serves REST on `localhost:8080/api/v1/bridge` |
| `hla-bridge-streamer/` | `hla-bridge-streamer` | Python | Entity tracks out, commands in. Two daemon threads beside the bridge |
| `hla-command-poster/` | `hla-bridge-command-poster` | Python | The command gateway. Validates intent, writes it to a stream. Never touches HLA |

### Compute module A — "HLA Streamer" (`ri.foundry.main.deployed-app.b4c28899-7810-4925-9558-4182cb37fdae`)

Pipeline mode. Two containers in one pod: `hla-bridge` + `hla-bridge-streamer`,
talking over localhost. This is the **only** module that joins the federation.

| Setting | Value |
|---|---|
| `FEDERATE_NAME` | `HLA-ENTITY-STREAM-READER` |
| `FEDERATION_NAME` | `CSE-Prep` |
| `CSE_ENVIRONMENT` | `5` |
| `BRIDGE_AUTO_CONNECT` | `true` |
| `BRIDGE_ATTRIBUTE_REFRESH_SECONDS` | `5` |
| `TRACK_STREAM_ALIAS` | `hla-entity-stream` → HLA Entity Tracks |
| `COMMAND_STREAM_ALIAS` | `hla-command-input` → Command Stream Input |
| `COMMAND_LOG_ALIAS` | `hla-command-output` → Command Stream Output |
| Minimum replicas | **1** — pipeline mode receives no queries, so the autoscaler would otherwise take it to zero and the stream would simply stop |
| Sources | HLA Pitch (the RTI), Foundry Connection (egress to the Foundry URL) |

### Compute module B — "Commander" (`ri.foundry.main.deployed-app.7a13ba1c-718b-4bfc-a039-acffdf870d21`)

Functions mode, one container, scales 0→1. Registers ~25 callable functions
through the `compute_modules` SDK. Holds no federation state and no RTI licence
seat; its only outbound call is `publishRecords` to a stream.

| Setting | Value |
|---|---|
| `FOUNDRY_URL` | `accenture.palantirfoundry.com` |
| `COMMAND_STREAM_RID` | Command Stream Input |
| `TRACK_STREAM_RID` | *unset* — group tasking is therefore unavailable and says so |

### The three streams

| Stream | RID | Written by | Read by |
|---|---|---|---|
| Command Stream Input | `ri.foundry.main.dataset.e52ee845-7d12-45c7-844c-3795c1495e58` | Commander | Streamer (`commands.py`) |
| Command Stream Output | `ri.foundry.main.dataset.28808101-229f-4424-8769-35c7d5a6e908` | Streamer | humans, dashboards |
| HLA Entity Tracks (1 Hz) | `ri.foundry.main.dataset.6e22a37b-e083-4977-be80-f407c8bd952b` | Streamer (`tracks.py`) | Commander (group selectors); no ontology object type yet |

---

## 3. The flow

```
                    ┌──────────────────────────────────────┐
                    │  Workshop button · agent · map lasso │
                    └───────────────────┬──────────────────┘
                                        │  hla_move_to_location(...)
                                        ▼
   ┌────────────────────────────────────────────────────────────────┐
   │  MODULE B — Commander  (functions mode, 0→1 replicas)          │
   │  app.py: validate → build one row → publishRecords             │
   │  returns {"status":"queued"}  — queued, NOT executed           │
   └───────────────────────────────┬────────────────────────────────┘
                                   ▼
                    ═══ Command Stream Input ═══
                                   │  GET .../records  @1 Hz
   ┌───────────────────────────────▼────────────────────────────────┐
   │  MODULE A — HLA Streamer  (pipeline mode, min 1 replica)       │
   │                                                                 │
   │   commands.py ──POST──►┐                        ┌──── tracks.py │
   │        ▲               │  hla-bridge (Java)     │        │      │
   │        │               │  localhost:8080        │        │      │
   │        └──GET /diagnostics/tasks ◄──────────────┘        │      │
   │                        │      ▲                          │      │
   └────────────────────────┼──────┼──────────────────────────┼──────┘
                            │      │ HLA / FedPro             │
                            ▼      │                          │
                    ┌──────────────┴───────────┐              │
                    │  CSE-Prep federation     │              │
                    │  on the Pitch RTI        │              │
                    └──────────────────────────┘              │
                                   │                          │
              ═══ Command Stream Output ═══      ═══ HLA Entity Tracks ═══
                                                              ╎
                                          world state for group selectors
                                                              ╎
                                                              └──► back to Module B
```

### Read path (situational awareness)

1. The Java bridge receives RTI attribute reflections and keeps the latest state
   per entity in `EntityStateStore`, refreshed every 5 s.
2. `tracks.py` polls `GET /entities` at 1 Hz and publishes **one row per entity
   per tick**, evenly sampled — a gap means the bridge reported nothing, which is
   the distinction a replay needs.
3. Two timestamps, because the source publishes at ~1 Hz and this polls at ~1 Hz,
   so the two alias and the same sample is often read twice: `observed_at` is
   when we looked, `bridge_last_updated` is when the value last actually changed.
   Deduplicate downstream on the second.
4. `track_point_id` is deterministic — `unique_id@epoch_millis` — so the stream
   can back an object type directly and a retried publish overwrites rather than
   duplicating. Keyed on the NETN UniqueId, not the HLA instance handle, because
   the handle only survives one federation execution.
5. Absent values are published as **null, never zero**: a drone at latitude 0.0
   and a drone with no position are different facts.

### Write path (tasking)

1. A caller invokes a Commander function, e.g. `hla_magic_move`.
2. `app.py` validates — lat/lon ranges, UUID shapes, enum choices, heading
   normalisation — and refuses loudly rather than coercing.
3. It writes one row: `command_id`, `correlation_id`, `issued_at`, `issued_by`,
   `operation`, `target_kind` (`ENTITY` / `SIM` / `CONTROL`), `entity_uuid`,
   `partition_key`, `params` (JSON string), `ttl_seconds`, `not_before`.
4. `commands.py` polls the stream at 1 Hz, routes the operation to a bridge path
   (`MOVE` → `/entities/{uuid}/move`, `SIM_PAUSE` → `/pause`, …) and POSTs it.
5. The bridge picks the live FOM dialect, encodes the struct and sends the HLA
   interaction.
6. An outcome row goes to the Command Stream Output. Later, any federation
   answer is published as a second row against the same `command_id`.

---

## 4. Design decisions worth understanding before changing anything

**Why the two modules are separate.** The publisher used to sit beside the
tasking federate, so every publisher tweak redeployed the pod and tore down a
live federation join — and the RTI then holds the unresigned federate name for
`FED_TIMEOUT_RECONNECT` (10 minutes here), blocking the restart. Splitting them
lets the stream be iterated on without disturbing operators' federate. The
Commander was then reduced further to hold no federate at all, so it costs no
Pitch licence seat.

**Why a Java sidecar rather than one Python container.** Entity state comes from
HLA and Pitch ships Java and C++ bindings, not Python. The reader has to be the
Java bridge; the Python container reaches it over localhost. Co-location also
guarantees the read and write paths hit the *same* federate — task history is
per-process, so a command posted to a different pod would task a different
federate with its own view of the world.

**Why a stream between them, rather than an HTTP call.** The bridge's REST API is
bound to localhost inside the pod and is unreachable from anywhere in Foundry.
The stream is the seam: it decouples an always-on RTI-attached federate from a
scale-to-zero gateway, gives replay and a durable audit trail, and lets any
Foundry producer issue tasking without knowing anything about HLA.

**Why 1 Hz is a thread and not a schedule.** Foundry schedules are
minute-granularity at best, so 1 Hz cannot be driven from the platform side.

**Queued ≠ sent ≠ acted upon.** Three distinct facts, and the design keeps them
distinct because conflating them is the failure mode this whole project keeps
running into:
- the Commander returns `queued` — the row is on the stream;
- a `SENT` outcome means the bridge put an interaction on the wire (HTTP 200);
- an `ACKNOWLEDGED` outcome means a federate actually answered.

A task addressed to a UUID no federate owns is dispatched perfectly and ignored
silently, which reads as success everywhere a human looks. So `commands.py`
polls the bridge's in-memory `/diagnostics/tasks` — where `ETR_TaskStatus` and
`SMC_Response` are correlated back to the `taskId` — and republishes each answer.
Without that, the one fact worth having never leaves the pod, and the bridge
keeps only 50 tasks in memory and loses them on restart.

**Replay safety.** stream-proxy returns the **whole stream on every poll**, so
every record is re-read once a second. Two mechanisms:
- *Primary — TTL.* A record older than its `ttl_seconds` is dropped. Control
  operations carry a short TTL (15 s; tasks default to 120 s) precisely so a
  replayed `DISCONNECT` cannot resign the federate every time the container
  starts.
- *Secondary — a bounded LRU of seen `command_id`s*, in memory, lost on restart —
  which is exactly why TTL has to be the primary defence.

The seen-check runs **before** the TTL check. An earlier version had it the other
way round, so expired records never entered the seen set and published a fresh
`EXPIRED` row on every poll — thousands of identical outcomes for a handful of
stale commands.

**Group tasking is stateless.** `hla_plan_group_task` previews, resolving a
selector (`force_id`, `entity_type`, `simulator`, `echelon`) against live track
state, capped at 50 entities; `hla_execute_group_task` re-resolves from scratch
and requires the caller to echo back the count the preview showed, refusing if
the world changed. No plan is stored, because several replicas may run and a plan
cached on one would not be found by the next. Weapons and umpire actions are
deliberately excluded from group orders.

---

## 5. The two NETN dialects — the largest single source of confusion

NETN restructured tasking between FOM v3.0 and v4.0. The two are mutually
unintelligible: different class tree, different parameter names, **radians →
degrees**, **seconds → milliseconds**, `Tasker` as a callsign string → a UUID.

The bridge does **not** get to choose. It may join a federation created by
another federate, and the FOM that federation was created with decides. Sending
the wrong dialect is not an error the RTI reports — the class is simply absent,
or worse, present with different parameters. So both are implemented
(`EtrV2Dialect`, `SmcV4Dialect`) and one is selected at connect time by probing
which `MoveToLocation` class resolves. `BRIDGE_TASK_DIALECT` can force it.

`taskDialect: "none"` means monitoring works and **every tasking endpoint returns
409**. The REST contract is otherwise dialect-neutral: same paths, same bodies,
degrees and seconds and lat/lon throughout, whichever dialect is live.

Below that sits the byte layer, where a mistake produces no error at all: big-
endian, per-field alignment measured from the start of the record, and
`LocationStruct` is **geocentric ECEF metres, not latitude and longitude**
despite the name. `WIRE_CONTRACT.md` holds golden hex vectors and
`HlaEncoderTest` asserts against them in the Docker build.

HTTP status codes from the bridge, all recorded on the outcome stream:

| Code | Meaning |
|---|---|
| 200 | Interaction sent. Not an acknowledgement |
| 400 | Bad request, including one the live dialect cannot express faithfully |
| 404 | Entity unknown to this bridge |
| 409 | This federation cannot do that: class absent from the FOM, or no dialect detected |
| 503 | RTI / FedPro problem |

---

## 6. Operating it

**Diagnostics are logs and streams**, not endpoints: Module A registers no
Foundry functions. It logs the resolved base URL and where it came from, every
rejected candidate with its DNS error, the credential source and the publish URL
at startup; then one summary line a minute per thread; then a full snapshot on
SIGTERM. Deliberately not one line per publish — at 1 Hz that is 86,400 lines a
day.

Healthy looks like `running: true`, `records_published` rising by roughly one per
entity per second, `last_error: null`, and on the command side `sent` and
`acknowledged` climbing together. `sent` climbing while `unacknowledged` tracks it
means nothing in the federation is answering.

Confirm from the platform side with:

```sql
SELECT count(*), max(observed_at)
FROM `ri.foundry.main.dataset.6e22a37b-e083-4977-be80-f407c8bd952b`
```

**Nothing is fatal when unconfigured.** Both threads log why and return; the
container stays up so the configuration can be read rather than crash-looping.

### The traps that have each cost a day

- **No egress by default.** A compute module cannot reach the Foundry URL until a
  source with a network policy for *that* URL is attached. Until then DNS fails
  inside the container and every publish dies with
  `ConnectError: [Errno -2] Name or service not known` while fetching a token —
  which reads as an authentication failure and is not one. The source must also
  be in the same project, have an API name, and have compute-module import
  enabled.
- **Sources only apply on restart.** They can only be added or removed while the
  module is stopped, and network policy changes need a full stop/start. A source
  attached under a running module changes nothing.
- **Minimum replicas must be ≥ 1** on the pipeline module.
- **Federate names must be unique.** Two joins under one name are refused with
  `Federate name ... already in use`; a pod suffix is appended as a safety net,
  but set it deliberately so the RTI's federate list stays readable.
- **Whole-batch rejection.** `publishRecords` validates every record and rejects
  the entire batch if one is invalid, so values are coerced to the column type
  before sending and anything uncoercible — including NaN and infinities — is sent
  as null. One entity reporting a string must not cost every other entity in that
  tick.

---

## 7. Where to read next

| Document | Answers |
|---|---|
| `FOM_TASKING.md` | The two dialects, how one is chosen, what maps to what, the REST endpoint table, HTTP status codes |
| `WIRE_CONTRACT.md` | Byte-level encoding with golden vectors. The ECEF-vs-lat/lon trap, the empty-array padding ambiguity |
| `FEDPRO_CONNECTION.md` | RTI addressing — three addresses for one federation, and why `crcAddress` is not the CRC address |
| `STREAMING.md` | The Foundry publish path, pipeline vs functions mode, credentials, endpoint fallback, record shaping |
| `DIAGNOSTICS.md` | Triage. Start with "am I in the right federation?", then "the task returned 200 but nothing moved" |

Note that `STREAMING.md` predates the current topology: it describes the gateway
as `hla-bridge-functions` with its own `hla-bridge` sidecar joining as
`CSE-HLA-Bridge`, and the streaming federate as `CSE-HLA-Tracks`. The deployed
reality is the one in §2 above — the gateway joins no federation at all. The rest
of that document, in particular the publish path and its traps, is current.

---

## 8. Open items

- No ontology object type is backed by the entity track stream yet, and it has no
  downstream lineage. `track_point_id` was designed to be its primary key.
- `TRACK_STREAM_RID` is unset on the Commander, so group tasking is unavailable
  in the deployment.
- The v4 encodings had not been sent to a live federation at the time of writing;
  `HlaEncoderTest` asserts their wire layout, but that is not the same as an
  acknowledgement from a real federate.
- The empty-`Path` padding ambiguity in `MoveToLocationTaskStruct` (36 vs 40
  bytes) is unresolved. `bridge_preview_move_task` against a running bridge
  settles it, because the RTI's own encoder is the only authority that matters.
