# Demo runbook — Plan → Execute → Analyse

One page for getting the demo ready and running it. Detail lives in the other docs; this page says
what to do, in what order.

## 1. The story (about 20 minutes)

The thread for an audience of exercise planners: **a plan made in Foundry is executed in the
simulation, measured against itself, and the next phase is planned from what actually happened.**

| # | Act | Screen | What to show | What to say |
|---|---|---|---|---|
| 1 | Plan | Scenario Planner | The scenario, its phases on the timeline, one phase's map with units, orders and objectives | "Every phase is a plan on a map, tied to the training objectives." |
| 2 | Build the force | Scenario Planner (zoom), right-click **Place unit…** | Zoom in and the force breaks down by echelon; place a unit and generate its ORBAT beneath | "Each phase has its own ORBAT — the force as it stands in that phase." |
| 3 | Execute | Execute | Readiness: phase ORBAT, preflight, CSE check; then **Launch** step by step | "Before anything reaches the simulators, we check every unit will actually spawn." |
| 4 | Fight | HLA Map | Live entities; task one unit | "The simulation is live, and commandable from the same place." |
| 5 | Analyse | Analysis | Replay with the plan overlaid; order compliance (on time / late / off route / never moved) | "We measure the run against the plan the staff wrote, order by order." |
| 6 | Debrief | Analysis → debrief | Training objectives with evidence, suggested ratings, the analyst's call; **Copy summary** | "The debrief is organised around the training objectives — the analyst has the final say." |
| 7 | Next phase | Debrief → **Plan next phase from actuals** | The new phase opens in the planner, starting where the force actually ended | "Phase 2 starts from what happened, not from what we predicted." |

**Choose the hero phase with the readiness screen** (it marks one **BEST FOR DEMO**). Rehearse on
that phase only.

## 2. One-off setup in Foundry

Do these in order. Each item names the doc with the details.

1. **Deploy the Translator** and point `[NXG-O] Reconcile Scenario Orbat` at the new version
   (`docs/PHASE_ORBAT_PLAN.md`, "To deploy").
2. **Developer Console application** — add every function and action the readiness screen reports
   as "not found" or "REST fallback", then regenerate and install the SDK (`docs/EXECUTE.md`).
3. **Optional: `NxgObjectiveAssessment`** — create the object type and its three actions so analyst
   ratings are shared (`docs/ANALYSE.md`). Without it, ratings stay on the analyst's device.
4. **Release Mapplications** from this branch.
5. **Workshop, Plan & Prepare module:**
   - Fix the Selected Phase binding (`WORKSHOP.md` §1.5, item 1).
   - Iframe 6 (Execute) → `/execute`; Iframe 7 (Analyse) → `/analysis`. Map `scenario`,
     `selectedPhase` and `mockDemo` on both (`docs/EXECUTE.md`, `docs/ANALYSE.md`).
   - Wire `mockDemo` on Execute, HLA Map and Analysis to **one** boolean (rename `[b] Mock Data?` to
     "Demo mode"), so demo mode switches the whole flow at once.

## 3. Rehearsal

1. **Open `/readiness`** (App switcher → Demo readiness, or the route directly). It is read-only.
   - Fix every **✕**. A ✕ means a step of the demo will fail.
   - Read every **!**. Most are "works, but with less" (no AI drafting, REST fallback, no shared
     ratings).
   - Press **Check CSE connection** once the simulation stack is up.
   - **Copy report** gives the whole result as text, to keep with the rehearsal notes or send on.
2. **Dry-run the hero phase live, end to end**, at least once:
   - Execute: preflight clean → Validate with CSE → Launch. Publishing really deploys the project.
   - Let it run long enough for units to move; stop it.
   - Analysis: the run appears; check the status line (*N of M planned units found in the run*).
     Press **REVIEW MATCHES** and correct any unit that wasn't found or was matched by position
     to the wrong entity. Corrections are kept by simulator name, so they hold for the run on the
     day. Do this on the machine you will demo from, because corrections are stored in that browser.
   - Debrief: rate one objective; **Plan next phase from actuals**; check the new phase in the planner.
3. **Dry-run the same path in demo mode** (`mockDemo` on). This is the fallback.
4. **Tidy up**: delete rehearsal phases created by "Plan next phase from actuals", so the timeline
   in the demo is clean.

## 4. On the day

- **Live or demo mode?** Decide before the audience arrives, from the readiness screen and one
  launch. If CSE or the federation is unreliable, run Execute → HLA Map in demo mode, and Analyse
  on the rehearsal run recorded earlier (it is real data) or in demo mode.
- **Switching mid-demo is safe.** Demo mode is one Workshop toggle; every simulated answer is
  labelled as simulated on screen.
- **Outside Workshop** (the app opened directly, e.g. full-screen on the projector), each screen
  links to the next: **Execute phase ▶** in the planner's map toolbar, **Open live map** after a
  launch, **Analyse run →** on the live map. `?mock=1`, or the **Demo mode** tick-box, carries
  through every link. Inside Workshop, use the module's tabs instead.
- **Leave a recorded run in place.** Analysis lists runs from the track dataset; a good rehearsal run
  is the best insurance for acts 5–7.

## 5. Questions to expect, and honest answers

| Question | Answer |
|---|---|
| "Does it assess engagements and losses?" | Not yet. The track feed carries movement only; the debrief measures movement and plan compliance, and says so. |
| "How are objectives linked to evidence?" | Inferred: functional area to unit type and task, MEL/MIL injects by category. Each link says why it was made; the analyst decides. |
| "What if a unit is late?" | Late is not failure — travel times are planning estimates. It counts as partial, not as not demonstrated. |
| "Whose orders count?" | The training audience's only (Blue by default). The opposing force demonstrating fires says nothing about the audience. |
| "Is this one formation or every vehicle?" | Where the simulator publishes vehicles, the matched vehicle stands in for the planned unit. |
