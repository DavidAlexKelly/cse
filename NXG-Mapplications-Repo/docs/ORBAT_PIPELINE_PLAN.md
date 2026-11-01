# ORBAT pipeline — plan

How ORBATs get from the Scenario Planner and ORBAT Manager into CSE, and the plan to make that one
path that is correct end to end. This covers Mapplications, the Translator and the ontology.

**Out of scope for now: NXG-CSE-Prep-Functions.** Nothing in this plan changes that repo. Its known
problems are listed at the end so they are not lost. Where the plan needs something from CSE, it
uses the CSE-Prep functions as they are today.

## Status

**Implemented** on `claude/cool-fermat-7pvzpd`: every item in workstreams 1–6. CSE-Prep is unchanged.
Verified by tests only: Translator 184 passed (a fake Foundry client drives the entry points);
Mapplications 534 passed, plus lint and a type check against stubbed SDK types. Nothing has run
against Foundry yet.

**To switch it on in Foundry:**
1. Publish the Translator and point the reconcile action, both phase preflights and the phase export
   at it. ORBAT Manager's save depends on the new partial-update reconcile (2.1).
2. Create `NxgCseLaunch` and its two actions (`EXECUTE.md`), and add them to the Developer
   Console app with `nxgPreflightOrbatFromPhaseForComposition`, `nxgCseAddProject` and
   `nxgCseValidateOrbat`.
3. Workshop: wire ORBAT Manager's `phase`; unwire `orbatJson` / `translatedInputOrbat` and remove
   their translation function (`DEMO_RUNBOOK.md`).
4. Run `/readiness`: it checks every new function, parameter, object type and action.

**Not verified without Foundry:**
- the Translator's primary-key prefix search (1.3), which falls back to edges if the filter is
  rejected;
- `NxgUnit` delete edits in the orphan prune (2.5, off by default);
- that CSE returns composition files intact (4.2), which falls back to the plain preflight.

**Behaviour changes to expect:**
- Exported ORBAT IDs change once (1.8).
- Stored `owningSimulator` casing is normalised on the next reconcile (2.4).
- A reconcile can no longer clear a field to null (2.1).
- SWORD vehicles get a VBS4 block attached instead of a duplicate vehicle, and only when they have
  no simulator block (1.4).

## Where we are

- **Three routes to CSE, with different inputs:**
  - **Execute:** phase ORBAT in the ontology → Translator XML → `nxgCse*` functions. This is
    the route that launches.
  - **ORBAT Manager:** in-memory map layout → Workshop `orbatJson` → `translate_orbat_from_json`
    → `translatedInputOrbat` → the older `cseValidateOrbat` (camelCase, JSON payload). It runs in
    its own project, `orbat-manager-project`. What it validates is not what Execute launches.
  - **`nxgCseValidatePhaseOrbat`** (CSE-Prep): calls the Translator over REST, then validates.
- **Opening ORBAT Manager writes to CSE.** On mount it creates the composition `orbat-manager-env`
  and the project `orbat-manager-project`.
- **ORBAT Manager keeps a second copy of the force** in sessionStorage (`orbat_hierarchies_v1`,
  `orbat_phase_groups_v1`, `orbat_builder_store_v1`). It is lost when the tab closes and the
  planner never sees it.
- **Several write paths to the ontology:**
  - `nxgOReconcileScenarioOrbat`, for phase ORBATs and generation;
  - `createCompositionInOntology`, used by scenario-wide Define with no phase;
  - individual create actions;
  - `reconcileScenarioHierarchy`, which nothing calls.
- **The Translator has correctness gaps** (see workstream 2). It finds units only through edges,
  dropped units never reach preflight, missing positions become 0,0, and it adds duplicate VBS4
  vehicles.
- **Nothing records what was launched.** There is no project, composition, publish or run record
  in the ontology. Analysis guesses which run belongs to which phase from a browser-local record.
- **The composition is never checked against the ORBAT.** `preflight_orbat_for_composition`
  exists but works per operation and nothing calls it.
- **The same rules live in TypeScript and Python**, kept in step only by comments. They include
  representation, automat detection, constituent parsing, double-counting, the placeholder DIS
  and the simulator names. Some have already drifted, for example `"3x"`.

## Where we want to be

```
Scenario Planner ─┐
                  ├─▶ phase ORBAT in the ontology (hier-{scenario}--{phase})   ◀── the only copy
ORBAT Manager  ───┘        │  written only through nxgOReconcileScenarioOrbat (one transaction)
                           ▼
                Translator: phase export + preflight (+ composition-aware preflight)
                           ▼
                Execute ──▶ nxgCse* (unchanged) ──▶ CSE
                   │
                   └─▶ NxgCseLaunch in the ontology: what was launched, where, when, how it went
                                     ▼
                              Analysis / Readiness read it
```

**Principles:**
- **One source of truth.** The phase ORBAT in the ontology is the only copy.
- **One write path.** Every ORBAT write goes through the reconcile action.
- **One route to CSE**, through Execute.
- **Validate what you launch.** Every check runs on the same export Execute sends.
- **Record what happened** in the ontology, not in a browser.

## Workstreams

Sizes: S is under a day, M is 1–3 days, L is 3+ days. **Before demo** means it is safe and
worth doing in the next few weeks. **After demo** means it is structural and needs a quiet
period.

### 1. Translator correctness (NXG-Translator) — before demo

The fixes behind "the check said green, but the launch was wrong". Each one ships with a test.

| # | Change | Where | Size |
|---|---|---|---|
| 1.1 | **Dropped units reach preflight.** `_translate_all` returns `droppedUnits`. The SimWorks pass stops clearing the list. When a parent fails, every descendant is recorded as dropped, not only the parent. | `translate_functions.py` (`_translate_all`), `src/translator.py` (`_record_dropped`, the parent/child build) | S |
| 1.2 | **Missing position is an error.** Preflight raises `POSITION_MISSING` for any unit with no lat/lng. The XML still writes 0,0 (CSE needs a value), but it never passes silently. | `src/builders.py`, `src/sword_builders.py`, `src/orbat_preflight.py` | S |
| 1.3 | **Find units by phase key as well as edges.** When `phase_key` is set, also load `NxgUnit` whose primary key starts with `{phase_key}--`. That matches how the planner finds lone units (`phaseKeys.ts`). "No edges" is an error only if no units are found at all. | `_load_stores` in `translate_functions.py` | S |
| 1.4 | **No duplicate platforms.** The SWORD→VBS4 injection (`_inject_sword_vbs4_assets`) stops adding a second vehicle. It is either removed, or replaced by attaching the VBS4 block to the existing vehicle, which needs a decision with whoever owns the federation setup. Preflight's `DOUBLE_COUNTED` then holds for the exported document. | `translate_functions.py` | S |
| 1.5 | **One bad unit doesn't sink the translation.** Guard the crew-role lookup (`child["vbs4"]["role"]` raises `KeyError` on SimWorks crew). Catch per-unit exceptions and record them as drops. | `src/builders.py`, `src/translator.py` | S |
| 1.6 | **SWORD tree under a non-SWORD root.** `build_sword_tree` descends through nodes without a SWORD asset instead of returning `None`. Remove the dead fallback and narrow the broad `except`. | `src/sword_translator.py`, `src/sword_builders.py` | M |
| 1.7 | **Phase belongs to the operation.** If `phase_key` matches no hierarchy of `operation_key`, return a clear error instead of an empty export. | `_load_stores` | S |
| 1.8 | **Stable IDs are actually stable.** Derive ORBAT integer IDs from the unit's primary key (a hash into the allowed range, with collision check) instead of first-seen order kept in module state. Re-exporting the same phase then gives the same IDs. | `src/utils.py` | M |
| 1.9 | **Check the SWORD DIS property name.** `dis6code` vs `dis6_code` (`ontology_store.py:80` vs `:182`). Confirm against the object type and fix. | `src/ontology_store.py` | S |
| 1.10 | **Tests for the Foundry entry points.** Add a fake ontology store so `_load_stores`/`_translate_all` run in tests. Cover: lone units, phase filtering, dropped subtree, missing position, no duplicate injection, SWORD under an aggregate root. | `tests/` | M |

**Release:** publish a new Translator version. Point `nxgTranslateOrbatToXmlFromPhase` and
`nxgPreflightOrbatFromPhase` at it.

### 2. Reconcile safety (NXG-Translator) — before demo

| # | Change | Size |
|---|---|---|
| 2.1 | **Partial update keeps what it doesn't mention.** Write only the fields present in the payload. Today missing lat/lng, SIDC and affiliation are written as `None`. Stop overwriting `dis` with the placeholder when a real one is stored. | S |
| 2.2 | **No leftover parent edges.** For a managed child, delete every edge in the hierarchy whose parent is not the requested one, whatever its key format. Old random-key edges currently survive beside the new deterministic edge. | S |
| 2.3 | **Explicit `managedChildUnitKeys: []` means "manage nothing"**, not "fall back to the requested children". Document the field. | S |
| 2.4 | **Simulator names in one vocabulary.** Normalise `owningSimulator` through `simulator_targets.py`, so ascot7 and jtls-go are kept and the casing is consistent, instead of the ad-hoc `sim_map`. | S |
| 2.5 | **Optional orphan prune.** Add a flag (off by default) that deletes phase-prefixed units no longer in the phase tree. The planner's "Remove subtree" already deletes explicitly, so this is clean-up, not correctness. | M |

### 3. One source of truth in ORBAT Manager (Mapplications)

| # | Change | When | Size |
|---|---|---|---|
| 3.1 | **Opening the screen changes nothing in CSE.** Remove the on-mount `cseAddComposition` / `cseAddProject` calls. | Before demo | S |
| 3.2 | **Retire ORBAT Manager's own CSE route.** Remove the `orbatJson` → `translatedInputOrbat` → `cseValidateOrbat` path and its CSE error panel. In its place, show the phase's **Translator preflight** (`nxgPreflightOrbatFromPhase`, the same check Execute uses) read-only, with a "Launch in Execute →" link. Deprecate the `orbatJson` / `translatedInputOrbat` Workshop fields; keep them declared but unused for one release, so existing Workshop wiring doesn't break. | Before demo | M |
| 3.3 | **ORBAT Manager opens on a phase.** Read `?phase=` (and Workshop `phase`) and show that phase's hierarchy from the ontology. The planner's "Open in ORBAT Manager" passes it. Default operation is already `DEFAULT_OPERATION_KEY`. | Before demo | S |
| 3.4 | **Hierarchy tab reads the ontology.** Replace `hierarchyStore` / `phaseGroupStore` (sessionStorage) with the operation's `NxgUnitHierarchy` rows (`loadHierarchiesForOperation`), grouped by `phaseKey`. Edits go through `shared/orbat/phaseOrbat` (`changeParentInPhase`, `removeSubtreeInPhase`, `savePhaseOrbat`). | After demo | L |
| 3.5 | **Map Placement writes positions to `NxgUnit`** (`moveOrbatUnits`) instead of the in-memory `mapPositions`, so the planner, the export and CSE all see the same positions. | After demo | M |
| 3.6 | **Group Builder templates live in `NxgOTemplateOrbatGraph` only.** `orbat_builder_store_v1` (sessionStorage) is removed. Built-in default templates move to a checked-in seed, loaded if the ontology has none. | After demo | M |
| 3.7 | **One write path.** Define with no phase (`commitOrbatForPlacement` → `createCompositionInOntology`) is retired: every placement belongs to a phase now, so Define always uses `commitDefinedOrbatToPhase`. Delete unused `reconcileScenarioHierarchy` / `createDebouncedReconciler`. Every ORBAT write then goes through `nxgOReconcileScenarioOrbat` (plus `createNxgUnitHierarchy` for a new phase). | After demo | M |

**Data note for 3.4–3.6:** anything only in ORBAT Manager's sessionStorage today was already lost
whenever the tab closed. There is nothing durable to migrate.

### 4. Execute: check against the composition, record the launch (Mapplications + ontology)

| # | Change | When | Size |
|---|---|---|---|
| 4.1 | **Composition-aware preflight per phase.** New Translator function `nxgPreflightOrbatFromPhaseForComposition(operation_key, phase_key, composition_xml)`, the phase twin of `preflight_orbat_for_composition`. It reports a unit needing a simulator the composition doesn't run, force size outside its limits, and echelon span. | Before demo | S |
| 4.2 | **Execute runs it.** Get the chosen composition's files from `nxgCseGetCompositions` (existing CSE-Prep function, unchanged; it returns `files[{path, content}]`) and pass the composition XML to 4.1. If the files aren't there or don't parse (CSE-Prep decodes responses heuristically), fall back to the plain preflight and say so on screen. | Before demo | M |
| 4.3 | **Launch record in the ontology.** Create object type `NxgCseLaunch` and actions `create…` / `modify…` in Ontology Manager, with no function code (the same approach as `NxgObjectiveAssessment`). Properties: `launchId`, `scenarioId`, `phaseId`, `operationKey`, `project`, `composition`, `status` (`running`/`launched`/`failed`), `failedStep`, `error`, `unitCount`, `orbatDigest` (hash of the exported XML), `demo`, `startedAt`, `publishedAt`, `simStartedAt`, `endedAt`, `launchedBy`. Execute writes it at each step through `applyActionByName`, falling back to the existing localStorage record until the type exists. | After demo | M |
| 4.4 | **Analysis and Readiness read it.** Analysis takes the phase and time window from `NxgCseLaunch` (replacing `shared/lib/launchRecords.ts`). Readiness shows the last launch per phase. | After demo | M |
| 4.5 | **Execute shows the stored CSE verdict.** It reads `cseValidationStatus` / `cseValidationDetail` / `cseValidatedAt` on the phase hierarchy (written by `nxgCseValidatePhaseOrbat`) when present, instead of always re-checking. | After demo | S |

### 5. One home for the shared rules — after demo

| # | Change | Size |
|---|---|---|
| 5.1 | **A shared rules table.** `rules_fixture.json` in the Translator lists inputs and expected outputs for: representation, automat detection, constituent parsing, double-counting, placeholder DIS and simulator names. Both test suites run it. Mapplications keeps a vendored copy (`src/shared/orbat/__fixtures__/rules.json`); a test fails if its hash differs from the Translator's published copy. | M |
| 5.2 | **Fix the known drift** (`"3x"`: TS `parseInt` accepts it, Python falls back). Decide one behaviour, put it in the table, and make both sides match. | S |
| 5.3 | **Stop copying checks into the front end** where a server answer is fast enough. The planner and ORBAT Manager call `nxgPreflightOrbatFromPhase` for double-counting and spawnability instead of keeping their own versions. Keep TS copies only for instant feedback while editing, and cover them with 5.1. | M |

### 6. Readiness, docs and Workshop

These go along with each change, not as a separate phase.
- **Readiness:** add the new Translator function (4.1) and `NxgCseLaunch` (4.3) to the readiness
  requirements. Remove `cseValidateOrbat` / `cseAddComposition` once 3.2 lands.
- **Workshop:** ORBAT Manager's `orbatJson` / `translatedInputOrbat` become unused (3.2), and
  the translation function wired to them can be removed after one release. ORBAT Manager gains a
  `phase` input (3.3).
- **Docs:** update `PHASE_ORBAT_PLAN.md`, `EXECUTE.md`, `ANALYSE.md` and `DEMO_RUNBOOK.md` as
  each item lands.

## Order of work

1. **Before the demo:** 1.1–1.5, 1.7, 1.9 and 2.1–2.4 in the Translator, released together
   with 1.10's tests. Then 3.1–3.3, 4.1–4.2, and a readiness update.
2. **Rehearse** on the new Translator version. Readiness shows the new function; Execute shows
   composition issues; ORBAT Manager shows the same preflight as Execute.
3. **After the demo:** 4.3–4.5 (launch record), 3.4–3.7 (ORBAT Manager on the ontology), then 1.6,
   1.8, 2.5 and workstream 5.

Each step is a separate commit or release, so any one can be rolled back without the others.

## Risks

- **Composition files from CSE (4.2).** CSE-Prep decodes responses by guesswork and may turn
  nested content into garbled strings. The fallback keeps Execute working, but composition checks
  may be unavailable until CSE-Prep is fixed.
- **Removing the VBS4 injection (1.4)** changes what the federation sees for SWORD-owned
  formations. Confirm with whoever set it up whether VBS4 needs those vehicles. If it does, the
  fix is to attach the VBS4 block to the same vehicle, not to drop it.
- **Stable IDs (1.8)** change the IDs in exported XML once. Anything in CSE that keys on the old
  IDs needs a fresh load. That is why it comes after the demo.
- **Workshop changes (3.2, 3.3)** need someone with edit rights on the Plan & Prepare module.

## Parked: CSE-Prep problems, not in this plan

Recorded so they are picked up when CSE-Prep can be changed:

- **CSE host:** hard-coded `4.165.4.53`, which the Java bridge calls the pre-migration address
  (default `4.223.210.7`). The SNI and CA are embedded in code; the CA expires 2027-08-07.
- **Network access:** borrows the `NxgPmesiiMcpServer` source.
- **Timeouts:** one 15 s deadline for every RPC, including Publish and Run. No retries, and a new
  channel per call.
- **Protobuf:** hand-encoded requests and guessed decoding of responses (UTF-8/latin-1), with no
  `.proto` files.
- **Errors:** returned as JSON strings, but some failures raise instead. Nothing is idempotent
  (AddProject, AddOrbat), and `_ensure_project` checks then creates, so two runs can race.
- **`nxgCseValidatePhaseOrbat`:** counts warnings as failures, and raises where its docstring
  says it records. It ignores a different composition on an existing project.
- **Project vs run:** the project path (AddProject → AddOrbat → Publish) and the run path
  (CompositionApi/Run) are not connected.
- **No tests.**
- **Target:** generated gRPC stubs, config from the Foundry source, per-method deadlines with
  retries, structured errors, and one idempotent "prepare launch" function that writes
  `NxgCseLaunch` itself. Execute would then call that instead of orchestrating the steps.
