# Diagnosing the HLA bridge

Every hard problem on this bridge so far was diagnosable only by reading pod logs
and guessing. This is the set of endpoints and Foundry functions that make the
bridge explain itself instead.

## Start here

| | |
|---|---|
| Function | `bridge_explain` |
| Endpoint | `GET /api/v1/bridge/diagnostics` |

`bridge_explain` returns plain text, ordered most serious first, suitable for a
Workshop text widget or an AIP agent. `bridge_get_diagnostics` returns the same
assessment as JSON with a `verdict` of `HEALTHY`, `DEGRADED` or `BROKEN`.

```
Verdict: DEGRADED
Federation: CSE-Prep  |  connected: True  |  uptime: 0h 14m 2s
Tasking dialect: v4  |  entities: 1
Tasks sent: 6  |  acknowledgements: 0

[OK] Connected to federation 'CSE-Prep' for 0h 14m 2s.
[OK] Tasking dialect: NETN v4 (SMC_EntityControl.Task).
    Detected from the loaded FOM; preference is 'auto'.
[WARN] NETN-SE is not loaded in this federation.
    Endpoints needing these classes return 409: [CreateObstacle, ClearEngineering]
[OK] 1 entity(ies) discovered.
[INFO] No entity has published SupportedActions.
    v4 entities may advertise which control actions their simulator accepts...
[WARN] 6 task(s) sent, none acknowledged.
    The interactions left this bridge but no federate answered...
```

## Before anything else: am I in the right federation?

Everything else in this document describes what the bridge can *see*. This
decides whether it is looking in the right place, and it has to be settled first:
a bridge alone in an empty federation is indistinguishable, from the outside,
from one with a subscription gap. `bridge_get_status` and `bridge_explain` now
report where this bridge actually is:

| Field | Why it matters |
|---|---|
| `federateName` | The name actually joined under. A suffix is appended on collision, so it is not always `FEDERATE_NAME`. |
| `crcCandidate` | Which CRC answered. The candidate list exists because the CRC's address is not stable here (booster on/off), and each instance learns its own — two bridges that picked differently are attached to different RTIs, and therefore to two different federations that share a name. |
| `federateCount` | Federates known from the RTI's MOM, including this bridge. `1` means it is alone. `0` means the RTI has not reported yet, which is not the same thing. |
| `federationCreatedByUs` | `true` means this bridge created the execution instead of joining one, so every other federate is somewhere else and nothing will ever be discovered here. |

Two `ERROR` findings are raised from these, because no change to subscriptions or
to the FOM can fix either:

```
[ERROR] This bridge is the ONLY federate in 'CSE-Prep'.
    From the RTI's own MOM accounting, so it is not a guess: no simulator is
    joined to the federation this bridge is attached to...
[ERROR] This bridge CREATED federation 'CSE-Prep' — it was not already running.
```

### The FOM this bridge expects (NETN v4 only)

The bridge speaks one model: **`NETN-Merged-With-RPR.xml`** — the whole NETN FOM
merged with RPR-FOM v2.0, exported in HLA Evolved format, which is what CSE-Prep
runs. `SWORD_FOM.xml` was a different generation and is no longer loaded or
subscribed against. The difference is not cosmetic:

| | v2-era (`SWORD_FOM.xml`) | v4 (`NETN-Merged-With-RPR.xml`) |
|---|---|---|
| Tasking | `ETR_Root.ETR_Task.*` (38 classes) | `SMC_EntityControl.*` (56) |
| Acknowledgements | none | `ETR_TaskStatus`, `SMC_Response` |
| Aggregate control | `MRM_Interaction.Request.*` | `SMC_EntityControl.Aggregate/Disaggregate/Divide/Merge` |
| Entity identity | on `NETN_*` leaf classes | on `BaseEntity` |
| Symbol attribute | `SymbolId` | **`Symbol`** |
| `UniqueId` | on `NETN_*` leaf classes | **only in `NETN-MIM.xml`** |
| `Posture`, `Mission`, `IsPC` | on `NETN_Aggregate` | **do not exist** |

Consequences worth knowing before reading a null:

- **`posture`, `mission` and `is_command_post` are permanently empty.** The
  attributes are absent from the v4 model. `speed_mps` is empty for a different
  reason — `decodeSpatial` reads position and heading only.
- **The MIM decides whether anything can be tasked.** `UniqueId` is declared only
  there, every NETN task addresses its Taskee by UUID, and 1516-2010 accepts a MIM
  *only* on `createFederationExecution`. A joining federate cannot install one — so
  if whoever creates the federation omits the NETN MIM, this bridge can monitor and
  will never task, and no change here can fix it.
- **Loading the wrong generation fails silently**, which is what made it expensive:
  classes resolve to nothing, `subscribeObjectClass` skips them at `debug`, and
  entities arrive with a position, a callsign, and almost nothing else. If
  `bridge_get_entities` returns rows that look half-filled, check the FOM
  generation before suspecting the publisher.

After deploying, `bridge_get_fom` should show `SMC_EntityControl.*` resolved and
`ETR_Root.ETR_Task.*` absent. If it is the other way round, the federation is
still on the old model and tasking endpoints will 409 with a message saying so.

### Reading `bridge_get_federates` — the decision table

`entities: 0` has three structurally different causes and this one call separates
them. Read `objectsRegistered` across *all* federates, not just ours:

| What you see | What it means | Where to go next |
|---|---|---|
| Only this bridge is listed | Wrong federation, or one we created. Not a subscription problem. | Compare `crcCandidate` and `FEDERATION_NAME` with a bridge that does see entities |
| A simulator with `objectsRegistered > 0`, us empty | It is publishing and we are not seeing it: a subscription gap **on our side** | `bridge_get_fom`, and the `Subscribed …` block in our startup log |
| Every federate at `objectsRegistered: 0` | **Nothing is publishing.** Our `0 entities` is the correct answer | The simulator: is a scenario loaded and running? Nothing in this bridge can help |
| No federate records at all | The RTI has not reported yet — not an empty federation | `bridge_refresh_federates`, then read again |

Worked example, 2026-08-19, which is why this table exists. Both bridges reported
`connected: true, entities: 0`, and it looked like the full-mode bridge was
broken because the monitor had recently been streaming ~400 tracks:

```
{"count": 3, "federates": [
  {"name": "HLA-ENTITY-COMMANDER",    "objectsRegistered": 0, "fomModules": ["file:/tmp/SWORD_FOM…xml"]},
  {"name": "HLA-ENTITY-STREAM-READER","objectsRegistered": 0, "fomModules": []},
  {"name": "SWORD", "type": "MASA SWORD Simulation", "objectsRegistered": 0, "updatesSent": 0}]}
```

Row three: all three federates in **one** execution — so not a wrong-federation
problem — and SWORD registering nothing, so not a subscription problem either.
SWORD was joined but idle, and both bridges were correct to report zero. The
earlier 400 tracks came from a session that had already stopped.

One caveat on trusting a zero: `HLAobjectInstancesRegistered` is decoded as an
`HLAinteger32BE`, and a short or absent encoding decodes to `0` as well. Confirm
against `Discovered entity:` lines in the bridge's own log before concluding that
a simulator is idle.

### Two things that are *not* the cause, both of which have wasted time

- **`BRIDGE_MODE` is not the difference.** Monitor and full mode subscribe to
  exactly the same object classes — the subscription loop in
  `publishAndSubscribe()` runs before the `monitorOnly` branch. Monitor only
  declines to *publish* interaction classes and to contribute FOM modules on
  join. So a full-mode bridge seeing no entities while a monitor sees hundreds is
  never explained by the mode.
- **`simTime: 0.0` means nothing.** Time management is off by default and should
  stay off, and `simTime` is only ever set from a `timeAdvanceGrant`. A perfectly
  healthy monitor reports `0.0` too.

### `BRIDGE_CREATE_FEDERATION`

Creating the federation execution is now **off by default**. If the execution is
absent the simulators are not running, and standing in for them produces the
worst available failure mode: `connected: true`, nothing discovered, nothing
received, reading exactly like a subscription bug. It also seeds the execution
with this bridge's v2-era `SWORD_FOM.xml`, after which a v4 simulator's join can
be refused on a FOM merge it would never otherwise have attempted.

With it off, an absent federation is waited on indefinitely — that wait
deliberately does **not** consume `BRIDGE_RETRY_ATTEMPTS`, so the bridge is still
asking hours later and joins the moment the real federation appears. Set it
`true` only when the bridge is meant to stand up a federation alone, e.g. a local
test with no simulators.

## The rest

| Function | Endpoint | Answers |
|---|---|---|
| `bridge_get_fom` | `GET /diagnostics/fom` | Which interaction classes this federation defines, by dialect and FOM module, and which class each REST operation would send. Replaces guessing from a `fomdump` of a file that may not be the one the RTI loaded. |
| `bridge_get_federates` | `GET /diagnostics/federates` | Who else is joined, from the RTI's own MOM accounting: federate name, host, FOM modules, objects registered, updates sent. |
| `bridge_refresh_federates` | `POST /diagnostics/refresh-federates` | Re-asks the RTI. The automatic request happens once at connect, so a simulator started later is otherwise invisible. Replies asynchronously — call, then read the list. |
| `bridge_get_task_history` | `GET /diagnostics/tasks` | The last 50 tasks sent, with the FOM class each went out as and any acknowledgement received. |
| `bridge_get_interaction_traffic` | `GET /diagnostics/interactions` | Which interaction classes have actually arrived, how many, and when the last one did. |
| `bridge_diagnose_entity` | `GET /entities/{id}/diagnostics` | Whether one entity can be tasked and what is stopping it. |
| `bridge_preview_move_task` | `GET /diagnostics/preview/move-task` | Exactly what a move would put on the wire — field values, datatypes and bytes — without sending it. |

## Reconciling an encoding with another federate

When a task is accepted and nothing happens, and both sides implemented the same
struct independently, the usual cause is not a bug in either implementation but a
disagreement about a datatype. `MoveToLocationTaskStruct.Location` is the sharp
edge: NETN-BASE defines `LocationStruct` as three `MeterFloat64` in the IEEE
1278.1 world coordinate system — **geocentric ECEF metres, not latitude and
longitude** — and the name invites the other reading. We got this wrong ourselves
in an early analysis.

`bridge_preview_move_task` produces the artefact to settle it. Send the output to
the owner of the receiving federate and ask which of the two they decode:

```
TaskParameters.Location.datatype  LocationStruct = 3 x MeterFloat64 {X, Y, Z},
                                  GEOCENTRIC ECEF METRES ... NOT degrees
TaskParameters.Location.input     latitude 60.476000, longitude 25.116000, altitude 500.0 m
TaskParameters.Location.encodedAs X=2874... Y=1347... Z=5514... (metres)
TaskParameters.Location.hex       41 45 ... (24 bytes)
TaskParameters.Speed              VelocityMeterPerSecondFloat32 = 0.000 m/s — 0 means
                                  'entity default'; a receiver reading it literally
                                  would keep the entity stationary
```

### CORRECTION: the C# notes below are about the MxP platform, not Drone1

The findings in the next section were read from
`Accenture.MxP.Module.Defense.Hla` — a **C#** codebase. The Drone1 mockup is a
separate **Java** project (`devops-files/hla-mockup`, `com.accenture.drone`) using
`hla.rti1516e`, the same API family as this bridge. The alignment, stubbed-encode
and missing-module findings are all real, but they constrain the MxP platform's
future HLA work, **not** the drone we are currently tasking. See "What Drone1
actually does" below for the drone.

### What Drone1 actually does (read from DroneFederate.java)

- **Subscribes to exactly two tasks**: `SMC_EntityControl.Task.MoveToLocation`
  and `Task.ChangeAltitude`. Everything else this bridge can send — patrol,
  fires, ROE, cancel, magic move, obstacles, comms, MRM — is not subscribed and
  will be silently ignored. That is the single reason most endpoints "do
  nothing"; it is not an encoding problem.
- **Reads only the first 24 bytes of `TaskParameters`**, as `LocationStruct`
  X/Y/Z, and converts ECEF to geodetic with a Bowring iteration. `Path`,
  `MoveType` and `Speed` are never read. Two consequences: our ECEF encoding is
  correct and agreed, and the empty-array padding question (36 vs 40 bytes) and
  the `Speed = 0` concern are both irrelevant to `/move`.
- **Gates on `Entity`**: `Arrays.equals(params.get(entityParam), droneUuid)`, a
  raw 16-byte comparison against the UUID it publishes as `UniqueId`. Our
  encoding matches. But `DRONE_UUID` defaults to **random on every restart**, so
  never hardcode it — always resolve the current value from `/entities`.
- **Sends no acknowledgement of any kind**: no `ETR_TaskStatus`, no
  `SMC_Response`, and it does not publish `SupportedActions`. So
  `/diagnostics/tasks` will always show tasks as unacknowledged against this
  federate. That is expected, not a fault, and it means observed effect is the
  only available evidence.
- **Orbit radius travels in the Annotation.** It parses
  `(\w+)\s*=\s*(-?\d+(?:\.\d+)?)` out of the Annotation string and honours
  `range=` / `radius=` and `alt=` / `altitude=`. NETN has no orbit-radius field,
  so this is their workaround. `/move` now supports `orbitRadiusMeters`, which
  appends `range=<metres>` to the annotation.
- **Altitude already works** without `ChangeAltitude`: the drone takes the
  altitude from the decoded `Location` when it is above 1 m, and our `/move`
  folds `altitudeMeters` into the ECEF conversion.
- Possible configuration snag on their side: the Dockerfile sets `FOM_DIR=fom`
  while `application.properties` defaults to `fom/netn4`, and their loader does
  not recurse into subdirectories. Worth confirming which path the running
  container uses.

### Known notes on the MxP C# platform (as of 2026-08-16)

From reading their generated C# (`Accenture.MxP.Module.Defense.Hla.Fom`, another
team in the same firm). Recorded because none of it is visible from our side at
runtime, and all of it changes how a failure should be interpreted:

- **They are on HLA 4** (`Hla.Rti1516_2025.FedPro`); we are on 1516-2010 Evolved.
  FedPro bridges the two and the datatype encodings are identical between the
  standards, so this is not itself a problem.
- **Their `LocationStructArray.Decode` omits the alignment padding.** It reads the
  4-byte element count and then reads elements immediately. IEEE 1516 pads after
  the count so the first element starts on its 8-byte boundary, which is what the
  RTI encoder we use inserts (asserted in `HlaEncoderTest`). Any **non-empty**
  `LocationStructArray` we send will therefore be misread by 4 bytes from the
  first element onwards: `Path` on patrol, and the `Area` fields of
  `IndirectFire`, `CreateObstacle` and `DisruptCommunication`. `/move` sends an
  empty `Path`, so whether it is affected depends on whether an empty array
  encodes as 4 bytes or 8 — check `TaskParameters.lengthBytes` from
  `bridge_preview_move_task` against the 36 bytes their decoder implies.
- **Their `Encode` methods for `LocationStruct` and `LocationStructArray` are
  stubs** — the field writes are commented out and the array returns an empty
  span, so encoding produces 24 zero bytes and nothing respectively. Their
  entity positions reach us correctly via the RPR `Spatial` attribute, which is a
  different path, but they cannot currently *send* anything carrying these types.
- **Their `Fom/NETN/NETN-ETR.xml` is a duplicate of `NETN-ENTITY.xml`** — the
  right filename over the wrong content. Its `modelIdentification/name` reads
  `NETN-ENTITY` and it declares zero interaction classes, where the real module
  declares 81. Every other module in their tree is correct (SMC 10, SE 18,
  COM 12, LOG 20, MRM 14, CBRN 22, METOC 30, AIS 66), so this is a single
  misplaced file rather than a systemic gap.

  Consequences: their generated `NETN-ETR.*.cs` files are NETN-ENTITY types
  (`TankerAircraft`, `MachNumber`, `AntiCollisionLightFlashingEnum8`), and
  `MoveToLocationTaskStruct`, `ETR_TaskStatus` and `TaskStatusEnum32` appear
  nowhere in their C#. Their MoveToLocation support is therefore hand-written
  from the NETN prose rather than generated from the XML, which is precisely the
  situation where two implementations drift without either erroring.

  The fix is one file: replace it with the real NETN-ETR 3.0 (mirrored here at
  `NETN-FOM-master/modules/NETN-ETR/NETN-ETR.xml`) and regenerate. That yields
  correct field order and the acknowledgement classes for free. It does not fix
  the alignment defect above — regenerating produces correctly *shaped* decoders
  that are still 4 bytes out on any non-empty array — so both changes are needed.

  Their own federation agreement already requires this: `.ntfa/formal-agreement.md`
  states that a receiving federate is expected to respond to Task interactions
  with `ETR_TaskStatus`, and `.ntfa/netn-objects-interactions.md` lists
  `HLAinteractionRoot.SMC_EntityControl.Task.*` under module NETN-ETR as agreed.

Two things the preview output tends to expose:

- **ECEF versus degrees.** If their decoder reads 2874000.0 as a latitude, the
  entity goes nowhere sensible and nothing errors.
- **`Speed` = 0.** We send 0 to mean "your default". A receiver that honours it
  literally holds the entity still — indistinguishable from a task being ignored.
  Pass `speed_meters_per_second` explicitly to rule this out.

## Three distinctions these endpoints exist to make

**1. "Sent" is not "accepted."** A 200 from a tasking endpoint means the
interaction left the bridge. Whether any federate acted on it is a different
fact, and the only evidence is an acknowledgement — `ETR_TaskStatus` or
`SMC_Response` on v4, `TaskStatusReport` on v2-era. `bridge_get_task_history`
shows both columns. A task with an empty `acknowledgements` list, on a FOM that
*does* define a status class, means nothing is subscribed to that class: NETN-SMC
requires a compliant federate to answer every entity control action, supported or
not.

**2. A resolved handle is not a listening federate.** `bridge_get_fom` says what
the federation *defines*. `bridge_diagnose_entity` says whether a particular
entity will *accept* it, using the entity's own `SupportedActions` attribute —
which NETN-SMC says to check before sending a control action. An entity that
publishes an empty list cannot be tasked whatever the FOM says.

**3. A green tick is not a successful call.** The Foundry functions catch HTTP
errors and return them as a string, so the function succeeds and the UI ticks it.
That is how a day's worth of 409s looked healthy. Failures now carry:

```json
{
  "ok": false,
  "httpStatus": 409,
  "error": "HTTP 409",
  "bridgeError": "Interaction class not available in the loaded FOM: ...",
  "hint": "This federation cannot do that: the interaction class is absent ..."
}
```

Successful responses are unchanged, because downstream apps parse them —
`/entities` returns a bare array. **So check for `"ok": false` (or any `error`
key) rather than trusting the tick.** If you would rather a failed task fail the
function outright and show red in the UI, that is a one-line change in
`_request`; it was left as a payload so existing Workshop wiring keeps working.

## A worked order for "the task returned 200 but nothing moved"

1. `bridge_explain` — verdict and findings. Usually enough.
2. `bridge_get_status` — if there is no `taskDialect` field at all, the running
   image predates the dual-dialect build; rebuild and redeploy.
3. `bridge_get_task_history` — did anything acknowledge? If a task shows
   `Refused`, the simulator heard us and declined: a scenario or permission
   problem, not a FOM problem.
4. `bridge_diagnose_entity` — can that specific entity be tasked at all.
5. `bridge_get_federates` — is the publisher still there, and still sending
   updates? `objectsRegistered > 0` with no entities on our side is a
   subscription gap on ours.
6. If everything above is clean and the entity still does not move, the remaining
   explanation is that the owning federate does not subscribe to the task class.
   MagicMove is the sharpest test — an unconditional teleport with no route
   planning, ROE or start-time semantics. If MagicMove does nothing while
   position updates keep arriving, the federate is publish-only and this is a
   conversation with whoever runs it, not a code change here.

## Cost

Bounded on purpose, because this runs in a 512 MB container beside the RTI: a
50-entry task ring buffer, one counter per interaction class, one record per
federate and per entity. All of it is observational — recording only, never
altering what the bridge sends — so a wrong diagnosis cannot break tasking.
Per-connection state is cleared on reconnect so counts describe the federation
currently attached; task history is deliberately kept across reconnects, since
what was attempted before a drop is exactly what a debugging session wants.

### Fixes prepared for the peer

Since this is one team, the peer-side changes are staged here rather than only
described. Apply order matters — the first two are independent, the third depends
on the first.

**1. Applied in this repo's vendored copy of their tree.**
`devops-files/Accenture.MxP.Module.Defense.Hla/Fom/NETN/NETN-ETR.xml` has been
replaced with the real NETN-ETR 3.0 from `NETN-FOM-master/`. It is a single-file
diff to cherry-pick. Their `NETN-ETR.tt` loads that path as an embedded resource
and emits into namespace `...Fom.Etr`, so nothing else needs changing for the
generator to start producing the tasking classes. Note this is a vendored
snapshot: re-syncing their repository over it will revert the change.

**2. Offered, not applied: `interop/HlaAlignedCodec.cs`.**
A hand-written, alignment-correct reader for the handful of types needed to
receive a task. Requires no regeneration and no generator changes, so it is the
fastest route to a moving drone. Roughly 200 lines to drop in and unit-test
against the vectors in `WIRE_CONTRACT.md`.

**3. Described, not written: the generator patch.**
The root cause sits in `Fom/Generator-DataTypes-ArrayData.tt` and its fixed-record
counterpart. Read from the template source, the array generator:

* emits `HLAvariableArray` decode as a 4-byte count followed by elements, with
  no padding before the first element;
* computes `CalculateSizeInBytes` the same way, so sizes are wrong by the same
  amount;
* emits `Encode` as `return [];` for **every** array type, not just the ones
  noticed so far;
* emits a comment and no code at all for `RPRlengthlessArray`,
  `RPRnullTerminatedArray`, `RPRpaddingTo32Array` and `RPRpaddingTo64Array`, so a
  struct containing one stops advancing the cursor entirely.

Fixing it properly means computing each datatype's octet boundary — recursively,
since a record's boundary is the maximum of its fields' — and emitting an
`Align()` call before each field and each element. That is the change that fixes
every module at once, and it is deliberately not attempted here: it needs a .NET
toolchain to build and test, which this repository does not have, and an untested
T4 change would break their build rather than help.
