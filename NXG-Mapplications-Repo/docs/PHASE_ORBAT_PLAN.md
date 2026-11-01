# Per-phase ORBATs — design and status

The Scenario Planner used to keep **one ORBAT per scenario**. It now keeps **one ORBAT per phase**,
and that phase ORBAT is the source of truth for what the map draws.

**Why.** CSE reads each unit's position straight off its `NxgUnit`. A unit is somewhere different in
every phase, so one shared set of units could only ever describe one phase correctly. The
Translator's phase functions (`nxgTranslateOrbatToXmlFromPhase`, `nxgPreflightOrbatFromPhase`) and
CSE validation (`nxgCseValidatePhaseOrbat`) already expect one hierarchy per phase.

## Data model (`src/shared/orbat/phaseKeys.ts`)

| Thing | Key | Notes |
|---|---|---|
| Phase hierarchy | `hier-{scenarioId}--{phaseId}` | `NxgUnitHierarchy` with `operationKey` and `phaseKey = phaseId` |
| Hierarchy name | `{scenarioName} — {phaseName} ORBAT` | Always the phase *name*, never its id |
| Phase unit | `{phaseId}--{uuid}` | Units are **copied, not shared**, between phases; each has its own lat/lng |

A placement's ORBAT is **native** if its root key starts with `{phaseId}--`. It is **foreign** if it
lives in another phase or the legacy scenario-wide hierarchy, and **missing** if it has none.

## Rules

- **Levels are absolute per side.** Level 0 is each side's most senior real unit(s). There are no
  synthetic grouping nodes.
- **The level view shows the frontier.** At level N it shows every unit at depth N, plus any branch
  that ends before N. A unit with no position is drawn at its nearest positioned ancestor.
- **Auto level is the default.** It shows the deepest level whose units still sit at least 40 px
  from their parent at the current zoom. It uses the same ring radii as the generator
  (`ringLayout.ts`), so what Auto shows is always legible.
- **Placing a unit**:
  - Its parent is the next echelon up on the same side; the nearest one wins.
  - It adopts same-side **roots** it outranks within 25 km.
  - All of this is written in **one** reconcile call.
- **Orders follow the chain of command.**
  - A unit is blocked if a superior already has an order ("inherits the order on X").
  - A unit is blocked if any of its subordinates have orders ("remove theirs first").
- **Generation is breadth-first and capped by the root's echelon**: Div 3000, Bde 1000, Bn 150,
  Coy 40. A level is only added if all of it fits.
- **SWORD automats expand to their catalogue constituents and stop there.** No vehicles or crews
  are generated beneath a SWORD unit. SWORD spawns the unit's equipment itself, so adding vehicles
  would put the same force in the exercise twice (`DOUBLE_COUNTED` in `representation.ts`).
- **Land only** for now. Maritime, air and space are shown in the Place dialog but disabled.

## Where things live

| File | Role |
|---|---|
| `shared/orbat/phaseKeys.ts` | Key formats; native / foreign / missing partition |
| `shared/orbat/orbatLevels.ts` | `indexForest`, `frontierAt`, `descendantsOf`, `ancestorsOf`, `effectivePosition`, `translateSubtree`, `withPositionOverrides` |
| `shared/orbat/placeIntoOrbat.ts` | `chooseParent`, `adoptees` (25 km), `landingLevel`, `parentCandidates` |
| `shared/orbat/ringLayout.ts` | Ring radii by depth, `ringPositions`, `autoLevelForZoom` |
| `shared/orbat/skeleton.ts` | Breadth-first generator; `autoOrbatCapFor` |
| `shared/orbat/serialise.ts` | Ring layout, `keyFor`, `omitRootUnit`, `maxUnits` |
| `shared/orbat/phasePayload.ts` | Builds every reconcile payload (pure, tested) |
| `shared/orbat/phaseOrbat.ts` | OSDK reads/writes: resolve hierarchy, load forest, place, generate, re-parent, remove, move, save, Define flow, debounced reconcile |
| `apps/scenarioPlanner/hooks/usePhaseOrbat.ts` | Loads and indexes a phase forest; optimistic moves; drops stale loads |
| `apps/scenarioPlanner/map/orbatLevelLayer.ts` | One GeoJSON symbol layer for the frontier, with drag |
| `components/OrbatLevelControl`, `PlaceUnitDialog`, `OrbatNodeMenu` | UI |

## Writes

| Write | Action | Notes |
|---|---|---|
| Create the phase hierarchy | `createNxgUnitHierarchy` (with `phaseKey`) | Done once, on first use |
| Place, generate, re-parent, save, Define, parentage | `nxgOReconcileScenarioOrbat` | One transaction per call; the payload carries `unitHierarchy.phaseKey` |
| Move | `updateNxgUnit` batches of up to 500 | Writes `primaryKey`, `latitude` and `longitude` only |
| Remove a unit or subtree | `deleteNxgUnit` batches with `cascadeEdges` | Phase-native units only |

**Parentage never fights the tree.** The reconcile only manages units that are currently roots in the
phase tree, or whose planner override differs from their tree parent. Anything already parented keeps
its parent, and a derived parent from inside a unit's own subtree is refused.

## Plan progress

| Step | Description | Status |
|---|---|---|
| 1 | Generator: breadth-first, echelon-scaled caps | ✅ |
| 2 | `usePhaseOrbat`: load forest and positions, index by level | ✅ |
| 3 | `orbatLevels.ts`: index, frontier, subtree translate (+ tests) | ✅ |
| 4 | Place unit dialog on map right-click; parent and adopt in one write; switch to the landing level | ✅ |
| 5 | Level control and GeoJSON ORBAT layer; dragging moves the subtree | ✅ |
| 6 | Right-click a level unit: Generate beneath, Change parent, Open in ORBAT Manager, **Remove** | ✅ |
| 7 | Orders on tree nodes with inheritance guards; **a new phase inherits its parent phase's whole ORBAT** (cloned, each placed unit pinned to where it ended) | ✅ |
| 8 | Remove legacy scenario-wide paths and the palette drag-drop; delete `hier-scenario_operation_baltic_shield` | ⬜ **After the demo.** Legacy code is still present but no longer called by the planner. |

### Differences from the original `per-phase-orbat` branch notes

- **Remove unit/subtree is built.** The delete actions (`deleteNxgUnit` with `cascadeEdges`) already
  exist in `shared/lib/foundry.ts`.
- **Phase inheritance is automatic.** *Add phase → based on* copies the ORBATs in straight away. Each
  placed unit lands where it ended the previous phase, so "phase 2 from actuals" carries the force
  structure as well as positions.
- **Units are found by key prefix as well as by edges**, so a lone unit placed with nothing above or
  below it still loads.
- **The ORBAT Manager Define flow names the hierarchy after the phase name**, not its id (the
  `phaseName` bug).
- **The Translator's `reconcile_scenario_orbat` stamps `phaseKey`** when the payload carries one. It
  never clears an existing value.

## To deploy (Foundry)

1. **Translator.** Publish the new version and point `[NXG-O] Reconcile Scenario Orbat` at it, so
   reconciles stamp `phaseKey` themselves. Phase ORBATs work without this step, because the hierarchy
   is created with `phaseKey`, but the action should be current.
2. **Ontology SDK.** Make sure the Mapplications SDK version exposes `phaseKey` on
   `createNxgUnitHierarchy`. The edit function already accepts it. Regenerate the SDK if the action
   type was updated after the pinned SDK version.
3. **Tag a Mapplications release.**

## Test checklist

- [ ] `npm test` and `tsc --noEmit` pass on the full build (with the private SDK installed).
- [ ] Place a brigade with "Generate ORBAT beneath":
  - [ ] the 1,000-unit cap is respected;
  - [ ] subordinates are on rings around it;
  - [ ] the view switches to the level it landed on.
- [ ] Place a battalion near it: it lands under the brigade. Place a division nearby: it adopts the brigade.
- [ ] Drag a subtree at several levels:
  - [ ] change zoom and reload — positions stick;
  - [ ] the linked marker follows in the Units view.
- [ ] Change parent: the old edge is pruned. Try to move a unit under its own subordinate: refused.
- [ ] Give an order to a battalion, then try its company: blocked ("inherits the order on …"). Then
  try the brigade above: blocked ("remove theirs first").
- [ ] **Save phase ORBAT**, then run `nxgPreflightOrbatFromPhase` and
  `nxgTranslateOrbatToXmlFromPhase` for the phase. Run **Validate Phase ORBAT with CSE**.
- [ ] Add phase 2 *based on* phase 1 after Generate End State. The ORBAT is carried in, and each
  placed unit and its subtree sits where it ended phase 1.
- [ ] Remove a subtree: its units disappear from this phase only.
