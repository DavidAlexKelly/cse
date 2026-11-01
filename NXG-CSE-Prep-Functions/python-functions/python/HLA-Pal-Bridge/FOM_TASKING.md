# NETN tasking: the two dialects this bridge speaks

This document is the reference for how the bridge turns a REST call into an HLA
interaction, for **both** NETN FOM versions. It replaces an earlier version that
described only the v2-era model — about half of which turned out not to apply to
the federation we are actually connected to.

Everything here was read off the FOM modules mirrored in `NETN-FOM-master/`
(NETN-ETR 2.0 vs 3.0, NETN-SMC 1.0, NETN-MRM 3.0, NETN-SE, NETN-COM, NETN-LOG,
NETN-BASE) and off `cse-hla-bridge/foms/SWORD_FOM.xml`. Where something is
inferred rather than read, it says so.

---

## 1. Why there are two

NETN restructured tasking between FOM v3.0 and v4.0. The two schemes are
mutually unintelligible — not renamed constants, but a different class tree,
different parameter names, different datatypes and different units:

| | v2-era (`NETN-ETR` 2.0) | v4 (`NETN-ETR` 3.0 + `NETN-SMC` 1.0) |
|---|---|---|
| Task class | `ETR_Root.ETR_Task.MoveToLocation` | `SMC_EntityControl.Task.MoveToLocation` |
| Who is tasked | `Taskee` (UUID) | `Entity` (UUID, from `SMC_EntityControl`) |
| Who ordered it | `Tasker` — a **Callsign string** | `Tasker` — a **UUID** of the commanding entity |
| When | `StartWhen` — `Datetime18`, 36-byte UTF-16 string | `StartTime` — `EpochTime`, int32 seconds |
| Free text | `Why` | `Annotation` |
| Task-specific data | flat parameters on the subclass | one `TaskParameters` struct per task |
| Durations | int32 **seconds** | `TimeMillisecondInt64` **milliseconds** |
| Headings | `AngleRadianFloat32` — **radians** | `DirectionDegreesFloat32` — **degrees** |
| Umpire actions | `ETR_SimCon.*` branch | ordinary `Task` subclasses |
| Cancelling | `CancelAllTasks` + `CancelSpecifiedTasks` | one `CancelTasks`, empty list = all |
| Acknowledgement | `TaskStatusReport` | `ETR_TaskStatus` **and** `SMC_Response` |

**The bridge does not get to choose.** It may join a federation created by
another federate, and the FOM that federation was created with decides. Sending
the wrong dialect is not an error the RTI reports: the class is simply absent, or
— worse — present with different parameters. So both are implemented and one is
selected at connect time.

`SWORD_FOM.xml` is v2-era, which is why v2 stays: a federation SWORD created will
speak it, and deleting v2 to make a v4 federation work would break the case this
bridge was originally built for.

---

## 2. How the dialect is chosen

At the end of `connect()`, `BridgeFederate.initializeHandles()` resolves every
class name either dialect might use, then `selectDialect()` picks one:

1. `BRIDGE_TASK_DIALECT=v2` or `=v4` forces a choice. If the FOM does not define
   the forced dialect, tasking is **disabled** rather than sending classes
   nothing can receive — an explicit error beats 20 confusing 409s.
2. Otherwise (`auto`, the default): v4 if
   `HLAinteractionRoot.SMC_EntityControl.Task.MoveToLocation` resolves, else
   v2 if `HLAinteractionRoot.ETR_Root.ETR_Task.MoveToLocation` resolves, else
   none.
3. v4 wins if a federation somehow defines both, on the assumption that such a
   federation is mid-migration.

Roughly half the known class names are *expected* to be missing — whichever
dialect this federation does not speak — so they are logged at DEBUG, not WARN.

**Where to look:**

```
FOM tasking dialects present: v2-era=false (…ETR_Root.ETR_Task.MoveToLocation), v4=true (…SMC_EntityControl.Task.MoveToLocation)
Tasking dialect selected: NETN v4 (SMC_EntityControl.Task) (preference 'auto'). Publishing 12 class(es).
Task feedback and reports available: [ETR_TaskStatus, SMC_Response, PositionStatusReport, …]
```

and over REST:

```
GET /api/v1/bridge/status
{ "connected": true, "taskDialect": "v4", "taskDialectName": "NETN v4 (SMC_EntityControl.Task)", … }
```

Every tasking response also carries `"dialect": "v4"` and a `"task"` field naming
the class that actually went on the wire, so a response can be matched against an
RTI trace without first working out which dialect was live.

`taskDialect: "none"` means monitoring works and every tasking endpoint will
return 409.

---

## 3. What maps to what

The bridge knows 33 interaction classes. Their fate under v4:

| v2-era class | v4 | Status |
|---|---|---|
| `StartResume`, `StopFreeze`, `WeaponFire`, `MunitionDetonation` | unchanged (RPR-FOM, not NETN) | works in both |
| `ETR_Task.MoveToLocation` | `Task.MoveToLocation` | implemented |
| `ETR_Task.Patrol` | `Task.Patrol` | implemented |
| `ETR_Task.Patrol.PatrolRepeating` | merged into `Task.Patrol` (`Duration`/`IntervalTime` fields) | implemented |
| `ETR_Task.FireAtLocation` | `Task.IndirectFire` | implemented |
| `ETR_Task.FireAtEntity` | `Task.DirectFire` | implemented |
| `ETR_Task.SetRulesOfEngagement` | `Task.ChangeRulesOfEngagement` | implemented |
| `ETR_SimCon.MagicMove` | `Task.MagicMove` (now an ordinary task) | implemented |
| `ETR_TaskManagement.CancelAllTasks` | `CancelTasks` (empty list) | implemented |
| `ETR_TaskManagement.CancelSpecifiedTasks` | same `CancelTasks` with a `Tasks` array | class exists; no REST endpoint |
| `ETR_SimCon.MagicResource` | **NETN-LOG** `SetSuppliesStatus` | implemented, semantics differ (§6) |
| `ETR_Task.CreateObstacle` | **NETN-SE** `Task.CreateObstacle` | implemented |
| `ETR_Task.ClearObstacle` | **NETN-SE** `Task.ClearEngineering` | resolved, not sent |
| `ETR_Task.DisruptCommunication` | **NETN-COM** `Task.DisruptCommunication` | implemented, `network` now a UUID (§6) |
| `MRM_Interaction.Request.Aggregate` | `SMC_EntityControl.Aggregate` | implemented |
| `MRM_Interaction.Request.Disaggregate` | `SMC_EntityControl.Disaggregate` | implemented |
| `MRM_Response` | `SMC_Response` | subscribed |
| `TaskStatusReport` | `ETR_TaskStatus` (moved to root) | subscribed |
| `StatusReport.PositionStatusReport` (+ Damage/Resource/UnderAttack) | `ETR_Report.*` — the `StatusReport` tier was deleted | subscribed |
| `SpotReport` | `ETR_Report.ObservationReport` (redesigned, C2SIM-aligned) | subscribed |
| `InWeaponRangeReport` | `ETR_Report.InWeaponRangeReport` | subscribed |
| `ETR_Task.TurnToHeading` | `Task.ChangeHeading` | resolved, not sent |
| `ETR_Task.SetOrderedSpeed` | `Task.ChangeSpeed` | resolved, not sent |
| `ETR_Task.StopAtSideOfRoad` | `Task.StopAtSideOfRoad` | resolved, not sent |
| `ETR_Task.MoveToEntity` | **deleted.** Use `FollowEntity` or `MoveToLocation` | no equivalent |
| `ETR_SimCon.QuerySupportedCapabilities` | **deleted** → `BaseEntity.SupportedActions` attribute | replaced, see §5 |
| `ETR_SimCon.CapabilitiesSupported` | **deleted** → same attribute | replaced |

Four of these live in **optional modules** (NETN-SE, NETN-COM, NETN-LOG). If the
federation did not load them, the class is absent and only the endpoints needing
it fail. The startup log lists what resolved.

---

## 4. Resolving a handle is not the same as being able to task

A resolved handle means *we can send*. It says nothing about whether any federate
is listening. v4 provides two ways to find out, and the bridge logs both:

- **`BaseEntity.SupportedActions`** (NETN-SMC, v4 only) — an array of
  `EntityControlActionEnum` published by the entity itself. NETN-SMC says to check
  it *before* sending a control action. The bridge subscribes to it on every
  entity class and logs it once per entity:

  ```
  Entity HLAobjectInstanceHandle<3> supports control actions: [MoveToLocation, MagicMove, Patrol, ChangeSpeed]
  ```

  An empty list is logged as a warning: that entity accepts no control actions at
  all, whatever the FOM defines.

- **`SMC_Response`** — every NETN-SMC compliant federate must answer *every*
  entity control action, supported or not. So silence here means nothing is
  listening, which is a different problem from a task being refused.

If neither appears, the remaining option is the RTI's own MOM: request
`HLAmanager.HLAfederate` subscription reports to ask what the other federate
subscribes to. Not implemented — the MOM federate class is already subscribed for
the identity attributes, so this is a small addition if it becomes necessary.

---

## 5. Reference: NETN v4

### Class tree

```
HLAinteractionRoot                     SendTime (EpochTime), UniqueId (UUID)   [NETN-BASE]
├── SMC_EntityControl                  Entity (UUID)                           [NETN-SMC]
│   ├── Task                           TaskId, Tasker, StartTime, TaskMode,
│   │   │                              Annotation, Activity, MainTask,
│   │   │                              NextTask, PreviousTask
│   │   ├── MoveToLocation             TaskParameters: MoveToLocationTaskStruct
│   │   ├── Patrol                     TaskParameters: PatrolTaskStruct
│   │   ├── MagicMove                  TaskParameters: MagicMoveTaskStruct
│   │   ├── DirectFire                 TaskParameters: DirectFireTaskStruct
│   │   ├── IndirectFire               TaskParameters: IndirectFireTaskStruct
│   │   ├── ChangeRulesOfEngagement    TaskParameters: ChangeRulesOfEngagementTaskStruct
│   │   ├── ChangeHeading / ChangeSpeed / ChangeAltitude / StopAtSideOfRoad / …
│   │   ├── CreateObstacle             TaskParameters: CreateObstacleTaskStruct   [NETN-SE]
│   │   └── DisruptCommunication       TaskParameters: DisruptCommunicationTaskStruct [NETN-COM]
│   ├── CancelTasks                    Tasks (ArrayOfUuid)
│   ├── RequestTaskStatus              Tasks (ArrayOfUuid)
│   ├── SetSuppliesStatus              SupplyStatus (SupplyStatusStruct)        [NETN-LOG]
│   └── Aggregate / Disaggregate / Divide / Merge                              [NETN-MRM]
├── SMC_Response                       Action (UUID), Status (HLAboolean)
├── ETR_TaskStatus                     Task (UUID), TaskStatus (TaskStatusEnum32)
└── ETR_Report                         ReportId, ReportingEntity, TimeStamp, …
    ├── PositionStatusReport / DamageStatusReport / ResourceStatusReport
    ├── UnderAttackStatusReport / InWeaponRangeReport
    └── ObservationReport
```

Only `Entity` and `TaskId` are Required. `UniqueId` and `SendTime` are formally
Optional but NETN-ETR states they are "required for all ETR related
interactions" — and `UniqueId` is what `SMC_Response.Action` correlates against,
so omitting it costs the acknowledgement. The bridge sends both, and omits
`StartTime` so the documented default ("the current `SendTime`", i.e. now) applies.

### TaskParameters structs, as sent

| Task | Struct fields |
|---|---|
| `MoveToLocation` | `Location` (LocationStruct), `Path` (LocationStructArray — sent empty), `MoveType` (enum32), `Speed` (float32 m/s, 0 = entity default) |
| `Patrol` | `Path` (ArrayOfWaypoints), `PatrolType`, `MoveType`, `Duration` (ms int64), `IntervalTime` (ms int64) |
| `MagicMove` | `Location`, `Heading` (degrees float32) |
| `DirectFire` | `Target` (UUID), `Duration` (ms int64), `Round` (RoundStruct) |
| `IndirectFire` | `Area` (LocationStructArray), `Duration`, `Round` |
| `ChangeRulesOfEngagement` | `RulesOfEngagement` (enum8) |
| `CreateObstacle` | `EngineeringTask` {`EngineeringObjectId` UUID, `Name` string, `Duration` ms}, `Area` (LocationStructArray) |
| `DisruptCommunication` | `Network` (UUID, all-zero = all networks), `Area` (LocationStructArray), `DisruptionEnabled` (HLAboolean) |

`Waypoint` = {`Location`, `Speed` (float32 m/s), `SegmentMaxWidth` (float32 m)}.
`RoundStruct` = {`WeaponType`, `MunitionType` (both EntityTypeStruct),
`QuantityFired` (int16), `RateOfFire` (float32)}.

### Datatypes that changed, and how they bite

| Datatype | Encoding | Trap |
|---|---|---|
| `LocationStruct` | 3 × float64 **geocentric ECEF metres** (IEEE 1278.1 §1.6.3 "world coordinate system") | The name invites treating it as lat/lon. It is not. NETN-BASE has separate `GeodeticPoint`/`GeodeticCircle` types for that. Converting to degrees here puts the entity at the centre of the Earth. |
| `DirectionDegreesFloat32` | float32, degrees clockwise from true north, [0,360) | v2 was radians. Sending radians gives a heading of 0–6° that looks almost plausible. |
| `EpochTime` | int32 seconds since Unix epoch | Replaces `Datetime18`, which v4 deletes. int32 wraps in 2038. |
| `TimeMillisecondInt64` | int64 milliseconds | v2 used int32 seconds. Sending seconds makes a 90-second patrol last 90 ms. |
| `UUID` | HLAfixedArray of 16 HLAbyte — 16 raw bytes, octet aligned, no count prefix, **not text** | Same in both dialects. |
| `SupplyStatusStruct` | {EntityTypeStruct, **float64** quantity} | v2's `NETN_SupplyStruct` used float32. |
| `HLAboolean` | int32 (0/1) | `RPRboolean` is 1 byte. Not interchangeable; getting it wrong misaligns every field after it. |
| `EntityTypeStruct` | {octet, octet, int16, octet, octet, octet, octet} = 8 bytes | Unchanged. |

`TaskStatusEnum32` is unchanged between versions: 0 Accepted, 1 Refused,
2 Cancelled, 3 Executing, 4 Completed, 5 Error. (The v4 prose mentions a
"Waiting" state; the enumeration does not define one.)

`MoveTypeEnum32`, `PatrolTypeEnum32`, `PatrolMoveTypeEnum32`,
`RulesOfEngagementEnum8` and `TaskModeEnum8` are also unchanged, which is why
`TaskEnums` is shared by both dialects rather than duplicated.

---

## 6. Reference: NETN v2-era

### Class tree

```
HLAinteractionRoot
└── ETR_Root                              (abstract)
    ├── ETR_Task                          (abstract) TaskId, Taskee, Tasker,
    │   │                                 StartWhen, Why, TaskMode
    │   ├── MoveToLocation                Location (WorldLocationStruct), MoveType
    │   ├── Patrol                        Path, PatrolType, MoveType
    │   │   └── PatrolRepeating           + Duration, IntervalTime (int32 seconds)
    │   ├── FireAtLocation                Location, Duration
    │   ├── FireAtEntity                  Target
    │   ├── SetRulesOfEngagement          RulesOfEngagement
    │   ├── CreateObstacle                UniqueId, ObstacleType, Geometry (AreaVariantStruct)
    │   └── DisruptCommunication          AffectedCommunicationNetwork (string),
    │                                     AffectedArea (GeodeticQuadrangle), DisruptionEnabled
    ├── ETR_SimCon                        (abstract) TaskId, Taskee, Tasker
    │   ├── MagicMove                     Location, Heading (radians)
    │   └── MagicResource                 Resource (NETN_SupplyStruct)
    ├── ETR_TaskManagement                (abstract) TaskManagementId, Taskee, Tasker
    │   ├── CancelAllTasks
    │   └── TaskStatusReport              TaskId, TaskStatus
    └── ETR_Report
        ├── StatusReport.{Position,Damage,Resource,UnderAttack}StatusReport
        ├── SpotReport
        └── InWeaponRangeReport
```

`ETR_Root`, `ETR_Task`, `ETR_SimCon` and `ETR_TaskManagement` are all
`sharing=Neither` — abstract. The RTI will not let any federate publish or send
them. **The subclass is what identifies the task**; there is no `TaskType`
parameter in any NETN FOM, in either version.

### v2 datatypes

- `WorldLocationStruct` — 3 × float64, geocentric ECEF metres.
- `GeodeticLocation` — 2 × float64, lat/lon **degrees**.
- `GeodeticQuadrangle` — two `GeodeticLocation` corners (a bounding box).
- `AreaVariantStruct` — discriminated on `GeoLocationTypeEnum32`; the bridge uses
  the Circle alternative (=2) {`CenterPoint`, `Radius` float32}.
- `Datetime18` — HLAfixedArray of 18 HLAunicodeChar (36 bytes UTF-16BE),
  `yyyyMMddHHmmss.SSS`. All zeroes (`00000000000000.000`) = start immediately.
- `AngleRadianFloat32` — radians.
- `Callsign` / `Text64` — byte-identical to `HLAunicodeString`.

---

## 7. REST endpoints

Same paths, bodies and vocabulary (degrees, seconds, lat/lon, readable enum
names) whichever dialect is live.

| Endpoint | v2-era | v4 |
|---|---|---|
| `POST /entities/{id}/move` | `ETR_Task.MoveToLocation` | `Task.MoveToLocation` |
| `POST /entities/{id}/patrol` | `Patrol` / `PatrolRepeating` | `Task.Patrol` |
| `POST /entities/{id}/magic-move` | `ETR_SimCon.MagicMove` | `Task.MagicMove` |
| `POST /entities/{id}/fire-at-location` | `FireAtLocation` | `Task.IndirectFire` |
| `POST /entities/{id}/fire-at-entity` | `FireAtEntity` | `Task.DirectFire` |
| `POST /entities/{id}/roe` | `SetRulesOfEngagement` | `Task.ChangeRulesOfEngagement` |
| `POST /entities/{id}/cancel-tasks` | `CancelAllTasks` | `CancelTasks` |
| `POST /entities/{id}/heading` | `TurnToHeading` (**radians**) | `Task.ChangeHeading` (**degrees**) |
| `POST /entities/{id}/speed` | `SetOrderedSpeed` | `Task.ChangeSpeed` |
| `POST /entities/{id}/altitude` | `SetOrderedAltitude` | `Task.ChangeAltitude` |
| `POST /entities/{id}/stop` | `StopAtSideOfRoad` | `Task.StopAtSideOfRoad` |
| `POST /entities/{id}/inject-supplies` | `ETR_SimCon.MagicResource` | `SetSuppliesStatus` [NETN-LOG] |
| `POST /entities/{id}/aggregate`, `/disaggregate` | `MRM_Interaction.Request.*` | `SMC_EntityControl.*` |
| `POST /map/obstacle` | `ETR_Task.CreateObstacle` | `Task.CreateObstacle` [NETN-SE] |
| `POST /map/disrupt-comms` | `ETR_Task.DisruptCommunication` | `Task.DisruptCommunication` [NETN-COM] |
| `POST /start`, `/pause`, `/stop` | `StartResume` / `StopFreeze` (RPR) | identical |

### Request fields that behave differently

These are the only places the HTTP contract is not fully dialect-neutral. Each is
logged when it applies, never silently dropped.

| Field | Behaviour |
|---|---|
| `speedMetersPerSecond` (move, patrol) | v4 only — `Speed` is a required field of the task struct there. v2 has no such parameter (it uses a separate `SetOrderedSpeed` task), so the value is ignored with a log line. |
| `network` (disrupt-comms) | v2: a network **name**. v4: the **UUID** of a NETN-COM `CommunicationNetwork` object. A non-UUID on v4 returns **400** rather than silently widening the request to all networks. Omit it to mean "all networks". |
| `federate` (aggregate/disaggregate) | v2 requires it (or `MRM_FEDERATE`). v4 addresses the entity and lets the RTI route to whichever federate owns it, so the value is ignored. |
| `removeSubunits` (aggregate) | v2 only. v4 aggregation always deletes the disaggregated entities. |
| `obstacleType` (map/obstacle) | v2 sends it as a DIS `EntityTypeStruct`. v4 lets the engineering federate choose the resulting `EnvironmentObject` type, so it is only logged. |

### Semantic change worth knowing

`inject-supplies` is **not** equivalent between dialects. v2's `MagicResource`
*adds* resources; v4's `SetSuppliesStatus` *sets* the new quantity of one supply
type, and NETN-LOG restricts it to `AggregateEntity` — so applying it to a
platform or lifeform may be refused. The endpoint logs this each time.

---

## 8. HTTP status codes

| Code | Meaning |
|---|---|
| 200 | The interaction was sent. **Not** an acknowledgement that anything acted on it — watch for `ETR_TaskStatus` / `SMC_Response` / `TaskStatusReport` in the logs for that. |
| 400 | Bad request, including a request the live dialect cannot express faithfully (e.g. a network *name* on v4). |
| 404 | The entity is not known to this bridge and the id is not a UUID. |
| 409 | This federation cannot do that: the class is absent from the loaded FOM, no NETN tasking dialect was detected, or the live dialect has no equivalent. The message says which. |
| 503 | RTI/FedPro problem. |

---

## 9. Open items

- **Untested against a live RTI.** The v4 encodings have never been sent to a
  real federation. `HlaEncoderTest` asserts the wire layout of every struct
  (offsets, widths, alignment padding, degrees vs radians, ms vs s) and the
  Docker build no longer skips tests, so a layout mistake fails the image build
  rather than becoming a task the simulator quietly ignores. That is a check on
  *our* encoding, not on the simulator's interpretation.
- **`Tasker` on v4** is omitted unless `TASKER_UUID` is set to the UniqueId of a
  real entity. The FOM default is "commander undefined", which is true; a
  fabricated UUID would claim a commanding entity that does not exist.
- **DIS enumerations are placeholders.** Supply types
  (`6.1.0.{1,2,3,4}.0.0.0`) and the generic obstacle type (`5.1.0.1.0.0.0`) are
  defaults, and using one logs a warning. Pass `supplyType`/`obstacleType`
  explicitly once the scenario's real SISO-REF-010 values are known. v4 fire
  tasks send an all-zero `RoundStruct` ("simulator decides") for the same reason.
- **`IndirectFire.Area` is sent as a single point.** The FOM wants an array of
  locations; the REST call supplies one target. If a simulator rejects a
  degenerate area, use `HlaEncoder.circleToPolygon` as the obstacle and comms
  endpoints already do.
- **Not sent by any endpoint**, though the classes are resolved and reported:
  `MoveByRoute`, `MoveInDirection`, `FollowEntity`, `Observe`,
  `ClearEngineering`, `RequestTaskStatus`, `Divide`, `Merge`. Heading, speed,
  altitude and stop now have endpoints.
- The v2-era `SetOrderedAltitude` also carries an `AltitudeType` enumeration
  selecting the reference datum. The bridge omits it rather than guess an
  enumerator whose values are not defined in the module we hold, so the
  receiver's default applies.
- **`ObservationReport`/`EntitySensorUpdate` are subscribed but only logged by
  name.** Decoding them would give perceived-truth tracks, which is a separate
  piece of work from tasking.

---

## 10. Verifying against a real FOM

`tools/fomdump.py` takes a mode and a FOM path (`int` interactions with
parameters, `rec` fixed records, `obj` object classes, anything else prints the
interaction tree), plus optional name filters:

```bash
# The interaction tree the FOM actually defines, with sharing= on each class:
python3 tools/fomdump.py tree NETN-FOM-master/modules/NETN-ETR/NETN-ETR.xml
python3 tools/fomdump.py tree cse-hla-bridge/foms/SWORD_FOM.xml

# Parameters of one class, and the fields of the struct it references:
python3 tools/fomdump.py int NETN-FOM-master/modules/NETN-ETR/NETN-ETR.xml MoveToLocation
python3 tools/fomdump.py rec NETN-FOM-master/modules/NETN-ETR/NETN-ETR.xml MoveToLocationTaskStruct
```

Two names in the v4 documentation disagree with the v4 XML, and the **XML wins**
because that is what the RTI loads:

- The NETN-ETR changelog says `TaskStatusReport` was renamed to
  `TaskStatusUpdate`; the XML defines `ETR_TaskStatus`. The bridge subscribes to
  `ETR_TaskStatus` and accepts either `Task` or `TaskId` as its task reference.
- The changelog says `MagicResource` became NETN-LOG `RequestTask.SetResourceStatus`;
  NETN-LOG.xml has no such class. The closest real equivalent is
  `SMC_EntityControl.SetSuppliesStatus`, which is what the bridge sends.
