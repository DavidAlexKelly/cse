# Analyse — real runs measured against the phase plan

Before this change, plan-vs-execution only worked in mock mode, against a plan exported once and
saved in the code (`shared/hla/balticShieldPlan.ts`). Real runs had a map and a timeline but no plan,
no compliance and no debrief. Now a real run is measured against the plan **saved for a phase**.

## How it works (`hooks/useLivePhaseAnalysis.ts`)

1. **Load the plan.** `data/phasePlanSource.ts` reads `NxgPhaseMapState` for the phase, using the
   row with the most content.
   - The start state supplies the units, orders and control measures. Terrain-routed orders keep
     their real route and travel time.
   - The end state supplies the predicted end positions.
   - `lib/phasePlan.ts` shapes it into the same `PhasePlan` the mock uses, so the compliance engine,
     the plan overlay and the debrief work unchanged.
2. **Sample the whole run.** `data/runTrack.ts` reads the run's tracks at a coarse cadence: about
   400 frame buckets, never finer than 30 s, in reads of 100 buckets. Playback is unaffected and stays
   windowed.
3. **Match planned units to simulated entities** (`lib/entityMatch.ts`). Each entity is used once,
   and every match records how it was made:
   - **manual:** the analyst's corrections (**REVIEW MATCHES** on the plan status line). They always
     win. A correction names what the simulator calls the unit (callsign, else unit name), not an
     HLA handle, because handles change every run; so corrections made in rehearsal carry to later
     runs of the same phase. A unit can also be marked **Not in this run**, which stops a guess by
     position. Corrections are kept per phase in the browser
     (`lib/matchOverrides.ts`, `hooks/useMatchOverrides.ts`).
   - **name:** the entity's callsign or unit name is the planned unit's name, ignoring case and
     punctuation. Callsigns derive from ORBAT names, so a name match is evidence.
   - **position:** otherwise, the nearest entity on the same side within 10 km of the planned start,
     closest pairs first. This is an inference, and the screen says so.
4. **Measure and debrief.**
   - `assessPlanCompliance` runs on the matched plan and the sampled track.
   - `computeRunStatistics` and `generateDebrief` run on top of that.
   - The event log is empty: the tracks feed publishes no engagements or losses, so the debrief
     covers movement and plan compliance only and doesn't invent the rest.

A status line under the top bar shows which phase is being used and how many planned units were found
in the run, for example: "14 of 19 planned units found in the run (9 by name, 5 by nearest
position)".

## Training objectives (debrief, first section)

The debrief opens with the phase's training objectives
(`lib/objectiveAssessment.ts`, `components/TrainingObjectivesSection.tsx`).

- **Which objectives:** those tied to the phase (`NxgTrainingObjective.phaseId`). If none are tied to
  the phase, the scenario-wide ones are used. They are listed high priority first.
- **Evidence:** nothing in the ontology links an objective to orders, so the links are **inferred**,
  and each one says why it was made:
  - **The objective's functional area:** Manoeuvre, Fires, Intelligence, Sustainment, Protection,
    C2 or Information. Free-text areas are understood ("J3 Joint Fires & Targeting" counts as Fires).
  - **The tasked unit's type.** For example, an air defence battery counts for Protection.
  - **Task wording,** but only for a unit no other area claims. A logistics convoy's "Move" is
    sustainment, not manoeuvre.
  - **Shared wording, only when the objective's area isn't recognised.** Otherwise a place name such
    as "corridor" would tie every unit near it to the objective.
  - **MEL/MIL injects for the phase,** linked by category (INTEL → Intelligence, LOG → Sustainment,
    CYBER and CIMIC → Information…).
- **Only the training audience's orders count** (Blue by default). An enemy battery interdicting on
  time says nothing about whether the audience demonstrated fires.
- **Suggested rating, from the measured orders:**

  | Rating | When |
  |---|---|
  | **Demonstrated** | Every measured order was on time |
  | **Not demonstrated** | Most measured orders were not achieved |
  | **Partially demonstrated** | Anything in between. *Late is not failed:* in practice every arriving order is "late" against the planner's rate-table estimate, which is a finding about the plan, not the audience. |
  | **Not observed** | Orders exercise the objective, but none could be measured |
  | **Needs observer judgement** | No order exercises it. Staff work, C2 processes and information activities are invisible to the track feed. |

- **The analyst's call:**
  - Each objective has a rating override and an observer note.
  - Where made, the analyst's rating replaces the suggestion everywhere and is marked "analyst".
  - Calls are saved to the ontology as **`NxgObjectiveAssessment`** objects once that type exists
    (setup below), so a debrief is shared across browsers.
  - Every call is also kept in the browser. That keeps the screen working before the type exists,
    when Foundry can't be reached, and in mock mode, where a synthetic run's calls must not reach the
    real record.
  - A badge shows which is in effect: **SAVED TO FOUNDRY** or **SAVED ON THIS DEVICE ONLY**, with
    the reason.
- **Copy summary** puts plain text on the clipboard for a debrief slide or an email.
- **Mock mode** uses the scenario's objectives from the ontology. If there are none, it uses four
  demo objectives written against the Blue Phase 1 plan, badged "DEMO OBJECTIVES". On the mock run
  they read: 0 of 4 demonstrated, 3 partially, 1 needs observer judgement.

## Next phase from actuals (debrief, closing card)

**Plan next phase from actuals** creates the next phase starting where the force **actually** ended
the run, rather than where the plan predicted it would (`lib/nextPhase.ts`, `data/nextPhase.ts`):

1. **Start state.**
   - Every matched unit starts at its last observed position.
   - A unit not seen in the run starts at its predicted end position, or else its start position.
   - Those units are listed afterwards, so a prediction is never mistaken for an observation.
   - Placements get fresh ids. ORBAT links are kept, objectives carry over and orders are cleared.
2. **Phase.** It is created based on the measured phase, using the planner's own write path
   (`createPhaseInOntology`), with the same duration and starting where the source phase ended.
3. **Force structure.** Every placement's ORBAT is copied into the new phase's own hierarchy, each
   subtree re-laid around where its unit actually ended (`savePhaseOrbat`, the same call as the
   planner's Add phase).
4. **Map state.** It is written once, with the copied ORBAT links already on it.
5. **Open in Scenario Planner.** The planner opens on the furthest branch, which is the new phase.
   The Workshop event `onNextPhaseCreated` fires as well.

In mock mode this works too, using the demo run's synthetic positions. The card says so before
anything is written. It needs the Baltic Shield Phase 1 phase (`obs_phase_01`) to exist in the
ontology.

## Setting up `NxgObjectiveAssessment` (Ontology Manager)

The app writes and reads this type by API name (`src/shared/lib/platformObjects.ts`). It switches
from device-only to Foundry as soon as the type and its actions exist and the app can see them. No
SDK release is needed, though regenerating the SDK later works too.

**Object type `NxgObjectiveAssessment`**
- **Folder:** `2. Ontology/Plan And Prepare`, alongside the other `[NXG-P]` types. Back it with a new
  dataset.
- **Display name:** `[NXG-P] Objective Assessment`.
- **Primary key:** `assessmentId`. **Title:** `objectiveId`.

| Property (API name) | Type | Notes |
|---|---|---|
| `assessmentId` | String | **Primary key**, `{runId}\|{phaseId}\|{objectiveId}`. Deterministic, so repeated saves converge on one object. |
| `objectiveId` | String | Links to `NxgTrainingObjective.objectiveId` |
| `phaseId` | String | Links to `NxgPhase.phaseId` |
| `scenarioId` | String | |
| `runId` | String | Run as Analysis detects it, e.g. `run-1789300000` |
| `runStartTime` | Timestamp | |
| `runEndTime` | Timestamp | |
| `rating` | String | The analyst's rating, or null. One of `DEMONSTRATED`, `PARTIALLY_DEMONSTRATED`, `NOT_DEMONSTRATED`, `NOT_OBSERVED`, `NEEDS_JUDGEMENT`. |
| `note` | String | Observer note, or null |
| `suggestedRating` | String | What the screen suggested at the time, for audit |
| `suggestionBasis` | String | Why the screen suggested it |
| `assessedAt` | Timestamp | When the call was last saved |

Who made each call comes from the action log (edit history), so there is no user property.

**Links (optional, recommended):**
- `NxgTrainingObjective` 1 → many `NxgObjectiveAssessment`, on `objectiveId`.
- `NxgPhase` 1 → many `NxgObjectiveAssessment`, on `phaseId`.

These let Workshop and Quiver show "this objective, across every run".

**Actions** (the standard generated ones; the API names must match):

| Action API name | Kind | Parameters |
|---|---|---|
| `createNxgObjectiveAssessment` | Create object | Every property above, with the same API names |
| `modifyNxgObjectiveAssessment` | Modify object | `nxgObjectiveAssessment` (the object), plus every property except the primary key |
| `deleteNxgObjectiveAssessment` | Delete object | `nxgObjectiveAssessment` |

**Developer Console:** add the object type and the three actions to the Mapplications application's
resources. The app already requests `api:use-ontologies-write`.

## Which phase a run is measured against

Highest priority first:

1. The phase picked in the **PLAN** selector in the top bar.
2. **The phase the run was launched for.** Execute records every launch as an `NxgCseLaunch`
   (see `EXECUTE.md`). A run whose first track follows a successful, non-demo launch by up to 15
   minutes opens on that phase (`shared/lib/launchRecords.ts`, `launchStore.ts`).
   - Records from the ontology are merged over this browser's own; until the object type exists,
     only launches made from this browser are known.
3. **Workshop's `selectedPhase`.**
4. The scenario's first phase.

Mock mode is unchanged: it uses the saved Baltic Shield plan and its synthetic run.

## Workshop wiring

On the Analyse iframe (Iframe 7), map:

| Analysis field | Workshop variable |
|---|---|
| `scenario` | `[NXG-P] Selected Scenario` |
| `selectedPhase` | `[NXG-P] Selected Phase` |
| `mockDemo` | The same variable as HLA Map and Execute |

## Limits worth knowing for the demo

- **Aggregate units stand in for platforms.** Where a planned unit is a formation and the federation
  publishes its vehicles (VBS4), the matched vehicle stands in for the whole unit. Movement is
  measured correctly; a spread-out formation is not averaged.
- **No engagements or losses.** These need an event source the tracks feed doesn't provide.
- **Read cost.** Reading a long run takes several SQL queries. The map is usable while that happens;
  the plan overlay, compliance panel and debrief appear once it finishes.
