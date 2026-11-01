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
   - **manual:** an explicit table, for a rehearsed demo. It always wins.
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

## Which phase a run is measured against

Highest priority first:

1. The phase picked in the **PLAN** selector in the top bar.
2. **The phase the run was launched for.** Execute records each launch (scenario, phase, time) in the
   browser, and a run whose first track follows a launch by up to 15 minutes opens on that phase
   (`shared/lib/launchRecords.ts`).
   - The record is per browser. Recording runs in the ontology needs a run object or run fields on
     `NxgPhase`, which don't exist yet.
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
