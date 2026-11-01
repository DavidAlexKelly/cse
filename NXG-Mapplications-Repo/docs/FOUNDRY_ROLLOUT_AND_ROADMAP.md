# Foundry rollout, next steps and roadmap

This covers getting everything on branch `claude/cool-fermat-7pvzpd` running in Foundry, what to do
before the NATO demo, and what to improve after it.

**What's on the branch** (all repos in this monorepo):
- per-phase ORBATs;
- Execute (readiness → launch → live map);
- phase-aware Analyse, with a debrief organised by training objective;
- Plan next phase from actual results;
- shared analyst ratings;
- the Demo readiness screen;
- the ORBAT pipeline rework (`ORBAT_PIPELINE_PLAN.md`);
- the HLA Map and Analysis restyle.

None of it has run against Foundry yet. It has been checked by unit tests (Translator 184,
Mapplications 534), lint, a type check against stubbed SDK types, and a local preview with stand-in
data. Part 1 is therefore also the first real test.

Detail lives in the other docs; this one gives the order and the checks:

| Doc | Covers |
|---|---|
| `PHASE_ORBAT_PLAN.md` | Per-phase ORBAT model, writes, Translator deploy |
| `EXECUTE.md` | Execute, functions it calls, `NxgCseLaunch` |
| `ANALYSE.md` | Analyse, matching, `NxgObjectiveAssessment` |
| `ORBAT_PIPELINE_PLAN.md` | The ORBAT pipeline rework and its status |
| `DEMO_RUNBOOK.md` | The demo story, rehearsal and day-of |
| `../../WORKSHOP.md` | The Workshop modules and their known wiring issues |

---

## Part 1 — Implementing in Foundry

Do the steps in order. Each step ends with a check. Steps 1–4 are needed before anything else works;
5–7 make it demo-ready.

### Step 0 — Security clean-up (outstanding from the start of this work)

Real-looking credentials were committed to `NXG-CSE-Prep-Functions/.../HLA-Pal-Bridge/appsettings.json`.
They are redacted on the branch, **but they are still in git history**.
- [ ] **Rotate the Cesium access token.**
- [ ] **Change the default passwords** on the rigs at `172.25.125.89` and `172.28.39.175`.
- [ ] **Decide whether to rewrite git history** (needs everyone to re-clone) or to treat the old
  values as burned once rotated.

Check: the old token no longer works.

### Step 1 — Merge the branch

- [ ] Open a pull request from `claude/cool-fermat-7pvzpd` into `main` in `davidalexkelly/cse` and
  review it.
- [ ] Copy each repo folder into its Foundry code repository:
  - `NXG-Translator`
  - `NXG-Mapplications-Repo`
  - `NXG-CSE-Prep-Functions` (only the credential redaction changed)

  The GitHub copy is fed by manual uploads, so watch for drift against what is already in Foundry,
  especially the `per-phase-orbat` Foundry branch.
- [ ] **Don't merge both versions of the per-phase ORBAT work.** The Foundry branch
  (`mapplicationupdates.md`) touches the same files and will conflict. Use this one.

### Step 2 — Publish the Translator (NXG-Translator)

ORBAT Manager's save depends on this release. Older versions overwrite fields that a save leaves
out, which moves units back to 0,0.
- [ ] Let Foundry CI run the Python tests (`python -m pytest` should give 184 passed, 1 skipped).
- [ ] Publish the new function versions:
  - `nxgTranslateOrbatToXmlFromPhase`
  - `nxgPreflightOrbatFromPhase`
  - **new:** `nxgPreflightOrbatFromPhaseForComposition`
  - `reconcile_scenario_orbat`
- [ ] Point the **`[NXG-O] Reconcile Scenario Orbat`** action (API name `nxgOReconcileScenarioOrbat`)
  at the new `reconcile_scenario_orbat` version.
- [ ] Check that the function's Foundry runtime limit is enough for the largest phase (up to about
  6,000 units).

Checks:
- Run `nxgPreflightOrbatFromPhase` in Foundry on the hero phase. It returns JSON with `summary`,
  `errors` and `issues`.
- Search the function logs for `Could not search NxgUnit by key prefix`. If it appears, the
  server-side starts-with filter was rejected. Exports still work, but units placed with no parent
  or children are missed; see Part 2.

### Step 3 — Ontology changes (Ontology Manager)

**3a. Check what should already exist**
- [ ] `NxgUnitHierarchy` has a **`phaseKey`** property.
- [ ] `createNxgUnitHierarchy` accepts a **`phaseKey`** parameter.
- [ ] `NxgUnitHierarchy` has `cseValidationStatus`, `cseValidationDetail` and `cseValidatedAt`.
  `nxgCseValidatePhaseOrbat` writes them, and Execute shows them.

**3b. Create `NxgCseLaunch`**, the launch record (recommended). Full spec in `EXECUTE.md`.

| Property | Type |
|---|---|
| `launchId` (primary key) | String |
| `scenarioId`, `phaseId`, `phaseName`, `operationKey`, `project`, `composition`, `status`, `failedStep`, `error`, `orbatDigest` | String |
| `unitCount` | Integer |
| `demo` | Boolean |
| `startedAt`, `publishedAt`, `simStartedAt`, `endedAt`, `launchedAt` | Timestamp |

Actions (the API names must match exactly):
- `createNxgCseLaunch`: every property as a parameter.
- `modifyNxgCseLaunch`: object parameter `nxgCseLaunch`, plus every property except `launchId`.

Without it, launches are recorded in the launching browser only, and Analysis can only match runs
launched from that machine.

**3c. Create `NxgObjectiveAssessment`**, the shared analyst ratings (optional). Full spec in
`ANALYSE.md`.

| Property | Type |
|---|---|
| `assessmentId` (primary key, `{runId}\|{phaseId}\|{objectiveId}`) | String |
| `objectiveId`, `phaseId`, `scenarioId`, `runId`, `rating`, `note`, `suggestedRating`, `suggestionBasis` | String |
| `runStartTime`, `runEndTime`, `assessedAt` | Timestamp |

Actions:
- `createNxgObjectiveAssessment`
- `modifyNxgObjectiveAssessment` (object parameter `nxgObjectiveAssessment`)
- `deleteNxgObjectiveAssessment` (object parameter `nxgObjectiveAssessment`)

Without it, ratings stay on the analyst's device and the debrief says so.

Optional links: objective → assessments on `objectiveId`, and phase → assessments on `phaseId`.

### Step 4 — Developer Console application (Mapplications)

- [ ] **Translator functions:**
  - `nxgPreflightOrbatFromPhase`
  - `nxgPreflightOrbatFromPhaseForComposition`
  - `nxgTranslateOrbatToXmlFromPhase`
- [ ] **CSE-Prep functions:**
  - `nxgCseGetCompositions`
  - `nxgCseAddProject`
  - `nxgCseValidateOrbat`
  - `nxgCseAddOrbatToProject`
  - `nxgCsePublishProject`

  Execute deliberately calls these, **not** the SDK's older `cseAddProject` / `cseValidateOrbat`,
  which take different parameters and a JSON payload.
- [ ] **Object types and actions:**
  - `NxgCseLaunch` + `createNxgCseLaunch` / `modifyNxgCseLaunch`
  - `NxgObjectiveAssessment` + its three actions
- [ ] **The HLA tracks dataset** (Analysis reads it through SQL).
- [ ] **Scopes:** the app already requests `api:use-ontologies-read/write`,
  `api:sql-queries-execute/read` and `api:use-datasets-read`. Make sure the application is granted
  them.
- [ ] **Regenerate and install the SDK.**

  Optional: everything above is called by name with a REST fallback, so the app works without a new
  SDK. But the fallback hasn't been tested on your stack, and the readiness screen marks each one
  "REST fallback".

### Step 5 — Release Mapplications

- [ ] Build (`npm run build`), deploy, and tag a release.

  This is the first build with the real private packages (`@nxg-simulation-execution-testing/sdk`,
  `@acc/*`). Type errors that the stubbed check couldn't see may appear here, most likely around
  `applyAction` / `batchApplyAction` typings in `shared/orbat/phaseOrbat.ts` and
  `analysisScreen/data/nextPhase.ts`.

### Step 6 — Workshop: Plan & Prepare module

- [ ] **Fix the Selected Phase binding.** `[NXG-P] Selected Phase` must derive from
  `[NXG-P] Selected Scenario` (`WORKSHOP.md` §1.5 item 1).
- [ ] **One demo-mode switch.** Rename `[b] Mock Data?` to **Demo mode**, and wire it to `mockDemo`
  on Execute, HLA Map and Analysis.
- [ ] **Iframe 6 (Execute)** → route `/execute`, with fields:
  - `scenario` ← Selected Scenario
  - `selectedPhase` ↔ Selected Phase
  - `mockDemo` ↔ Demo mode
  - `onLaunched` → optional: switch to the live-map tab.
- [ ] **Iframe 7 (Analyse)** → route `/analysis`, with fields `scenario`, `selectedPhase` and
  `mockDemo`.
- [ ] **HLA Map iframe** → `mockDemo`.
- [ ] **Iframe 2 (ORBAT Manager):**
  - wire **`phase` ← Selected Phase**, so it opens on that phase's ORBAT;
  - **unwire `orbatJson` and `translatedInputOrbat`**, which are deprecated and no longer read or
    written;
  - **delete their translation function** (`Iframe 2 undefined2` → `translate_orbat_from_json`).
- [ ] **Optional: add a Readiness tab** pointing at `/readiness`, or bookmark the standalone URL.

### Step 7 — Data for the demo

- [ ] **Hero phase**, chosen with `/readiness` (it marks one **BEST FOR DEMO**). It needs:
  - a saved map;
  - orders;
  - a phase ORBAT with **both** sides;
  - training objectives whose functional areas are filled in ("Fires", "J3 Manoeuvre"…).
- [ ] In the planner, press **Save phase ORBAT** on the hero phase. That clones inherited ORBATs in
  and stamps the hierarchy.
- [ ] Check that **`obs_phase_01`** (Baltic Shield Phase 1) and its map exist. Demo mode's "Plan
  next phase from actuals" needs them.
- [ ] Delete the **old `hier-scenario_operation_baltic_shield`** hierarchy, a leftover of the
  scenario-wide model.
- [ ] Remove duplicate draft scenarios (`IRON FORGE 26`, `NORTHERN SENTINEL`) with the
  `hygiene/` tools, so the demo's scenario list is clean.

### Step 8 — Verify

- [ ] **Open `/readiness`.** Fix every ✕, read every !, and press **Copy report** to keep a record.
- [ ] **Live dry run of the hero phase:**
  - Execute shows preflight against the composition. If it says the composition files weren't
    returned, see Part 2.
  - Launch, then check that an `NxgCseLaunch` object appears with status `launched`.
  - The live map shows entities.
  - Analysis opens the run on the right phase. Use **REVIEW MATCHES** to fix any wrong matches.
  - The debrief shows **SAVED TO FOUNDRY** for ratings.
  - **Plan next phase from actuals** creates a phase.
- [ ] **Run the same path in demo mode.**
- [ ] **ORBAT Manager on the hero phase:**
  - it opens on the phase ORBAT;
  - edit → **Save to ontology** → reload, and the edit is there;
  - dragging a unit on the map tab moves it in the planner too.
- [ ] **Tidy up:** delete rehearsal phases and test launches.

**What will look different** after the rollout (expected, not bugs):
- **Exported unit IDs change once:** they are now a hash of the unit key. Load the ORBAT into CSE
  fresh.
- **`owningSimulator` casing is standardised** on the next save (`Vbs4` → `vbs4`).
- **A save can no longer clear a field to empty.**
- **SWORD vehicles get a VBS4 block attached** instead of a duplicate VBS4 vehicle.
- **Define needs a phase:** Define ORBAT in the planner refuses a placement that has no phase.
- **ORBAT Manager keeps nothing in browser session storage.** Unsaved drafts are gone when the tab
  closes.

---

## Part 2 — Next steps (before the demo)

In priority order.

1. **Do Part 1 and one full rehearsal.** That is the single biggest risk: nothing has run end to end
   on the real stack.
2. **Confirm the CSE host address.** CSE-Prep hard-codes `4.165.4.53`, which the Java bridge calls
   the *pre-migration* firewall address (default `4.223.210.7`). It's out of scope for code changes,
   but if it's wrong, every live launch fails. Raise it with whoever owns CSE-Prep.
3. **Check the three unverified behaviours on the real stack:**
   - **Translator search by key prefix:** look for the log line from Step 2. If the filter is
     rejected, units placed with no parent or children are missing from the export. Workaround:
     give every placed unit a parent, or have Save phase ORBAT add a root edge.
   - **Composition files from CSE:** if Execute says the files weren't returned, the composition
     check falls back to the ORBAT alone. It works, but with less.
   - **Unit deletes in the optional orphan clean-up:** it is off by default. Leave it off until the
     delete is confirmed in a sandbox.
4. **Agree the VBS4 block behaviour** with whoever set up the federation. SWORD-owned vehicles now
   get a VBS4 block on the same vehicle, not a second vehicle. Confirm that's what VBS4 needs.
5. **Rehearse on the demo machine.** Match corrections are stored in that browser, and so are
   launch records until `NxgCseLaunch` exists.
6. **Brief the presenter** with `DEMO_RUNBOOK.md`: the story, live vs demo mode, and honest
   answers to likely questions (no engagements or losses in real runs; objective evidence is
   inferred).

---

## Part 3 — Roadmap (after the demo)

Sizes: **S** is under a day, **M** is 1–3 days, **L** is 3+ days.

### 3.1 CSE-Prep: make the CSE connection robust (parked, highest value)

| Item | Size |
|---|---|
| **Config, not code.** Read the host, port, SNI and CA from the Foundry source config. Give CSE its own source instead of borrowing `NxgPmesiiMcpServer`. Replace the embedded CA before it expires (2027-08-07). | S |
| **Deadlines and retries.** Set a deadline per method (long for Publish and Run), retry `UNAVAILABLE` with backoff, and reuse channels. | S |
| **Generated gRPC code.** Vendor CSE's `.proto` files and generate stubs. Remove the hand-encoded requests and guessed response decoding. | M |
| **Structured errors.** Raise `UserFacingError` or return typed results everywhere, instead of JSON strings with `success: false`. | M |
| **One idempotent "prepare launch" function.** Translate → composition-aware preflight → ensure project (checking its composition) → add ORBAT → validate → publish, writing `NxgCseLaunch` itself. Execute then makes one call and polls. | L |
| **Poll composition status** after publish, and connect the project route to the run route. | M |
| **`nxgCseValidatePhaseOrbat`:** treat warnings separately from errors, record failures instead of raising, and check the project's composition. | S |
| **Tests** with a mocked gRPC connection. | M |

### 3.2 ORBAT and data model

| Item | Size |
|---|---|
| **Launch ↔ run link.** Carry a run or launch ID into the HLA tracks feed, so Analysis knows each run exactly instead of matching on time. | M |
| **Match corrections in the ontology**, so they're shared and survive a new machine. Today they live in the browser. | S |
| **Explicit objective ↔ evidence links.** Let planners link training objectives to orders or units, so the debrief's evidence is recorded rather than inferred. | M |
| **Save AI generation all at once.** `useScenarioGeneration` writes scenario, phases, objectives and so on as separate actions, with no rollback. Generate everything first, then save it in one write, or give each run an ID so it can resume. | L |
| **Turn on orphan clean-up** in Save phase ORBAT once deletes are verified. | S |
| **Remove the planner's legacy palette drag-drop path.** | S |
| **One design system and one ORBAT tool.** Retire the forked theme in `Plan-Prepare-Widgets-repository` in favour of the shared tokens. | M |

### 3.3 Analysis and debrief

| Item | Size |
|---|---|
| **Engagements and losses for real runs.** Needs an event source: the bridge publishing damage or fire events, or the CSE logs. | L |
| **Formation-level measurement.** Use the average or centroid of a formation's vehicles, not one stand-in vehicle. | M |
| **Observer input** for staff-process objectives (C2, information activities) that the map can't evidence. | M |
| **Exportable debrief** (PDF or slides) from Copy summary plus key charts. | M |

### 3.4 Product and UX

| Item | Size |
|---|---|
| **Next-step links inside Workshop.** Iframes can't switch Workshop tabs, so add events (`onOpenExecute`, `onOpenAnalysis`) and wire them to tab changes. | S |
| **Restyle the Scenario Planner and ORBAT Manager internals** to the shared tokens, as done for HLA Map and Analysis. | M |
| **Performance** on large ORBATs (up to the 6,000-unit cap): load trees lazily, render the map on canvas. | M |
| **Accessibility pass:** contrast, keyboard navigation, focus order. | M |

### 3.5 Engineering

| Item | Size |
|---|---|
| **Keep GitHub and Foundry in sync** with one mirror per repo, not manual uploads. | M |
| **CI everywhere.** Run tests on every repo, add tests to Ontology Edit Functions (about 1,400 lines, no tests) and to the HLA command poster. | M |
| **Bring the preview harness into the repo** (the stand-in SDK, `@acc` and client modules plus fixtures from this work), so the UI can be developed and screenshotted without Foundry. | S |
| **Write down the SDK release process:** when to regenerate, and how to retire the by-name fallbacks once the SDK has everything. | S |
| **Remove the deprecated `orbatJson` / `translatedInputOrbat` fields** one release after Workshop is rewired. | S |
