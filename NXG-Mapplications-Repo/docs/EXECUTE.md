# Execute — readiness, launch, live map

Route `/execute`. This is the act of the exercise that sits between building a phase's force (Scenario
Planner) and watching it fight (HLA Map) or reviewing it (Analysis).

| Step | What it checks or does | Calls |
|---|---|---|
| Phase ORBAT | Units per side in `hier-{scenario}--{phase}` | Ontology read (`loadPhaseForest`) |
| Preflight | Will every unit actually spawn — and, with a composition chosen, in that composition? This **must** have no errors before launch. | `nxgPreflightOrbatFromPhaseForComposition`, else `nxgPreflightOrbatFromPhase` |
| CSE validation | CSE's own server-side schema check. Advised, not required. | `nxgTranslateOrbatToXmlFromPhase` → `nxgCseAddProject` → `nxgCseValidateOrbat` |
| Launch: export | Phase ORBAT to CSE ORBAT XML | `nxgTranslateOrbatToXmlFromPhase` |
| Launch: project | Create the CSE project with the chosen composition. An existing project is reused. | `nxgCseAddProject` |
| Launch: load | Add the ORBAT to the project | `nxgCseAddOrbatToProject` |
| Launch: publish | Deploy the project; the simulators and the federation come up | `nxgCsePublishProject` |
| Launch: start | Start simulation time | `hlaSimStart` (via the HLA Map bridge client) |
| Live map | Opens `/hlamap`, in the same demo mode | — |

Preflight runs on its own as soon as the phase ORBAT is known to have units. Compositions are listed
from CSE (`nxgCseGetCompositions`). If that list fails, you can type a composition name instead.

## Demo mode

Execute uses the same switch as HLA Map and Analysis:
- **In Workshop:** the `mockDemo` field.
- **Standalone:** `?mock=1`, or the toggle in the header.

In demo mode every CSE and federation call is **simulated**, and the screen says so. The phase ORBAT
counts are still read from the ontology. **Open live map** then opens HLA Map with `?mock=1`, which
replays the demo federation.

## How functions are called (`src/shared/lib/platformFunctions.ts`)

Each function is called through the generated SDK when the SDK includes it. Otherwise it is called
through the Ontology Queries REST API (`/api/v2/ontologies/{rid}/queries/{name}/execute`). Both
api-name forms are tried, `nxgCseX` and `cseX`.

When a function is reachable by neither route, the error says so and names the function.

**To call everything through the SDK** (recommended before the demo), add these functions to the
Developer Console application's resources, then regenerate and install the SDK:

- `nxgPreflightOrbatFromPhase`, `nxgPreflightOrbatFromPhaseForComposition`,
  `nxgTranslateOrbatToXmlFromPhase` (Translator)
- `nxgCseGetCompositions`, `nxgCseAddProject`, `nxgCseValidateOrbat`, `nxgCseAddOrbatToProject`,
  `nxgCsePublishProject` (CSE-Prep)

`hlaSimStart` is already in the SDK. Add `nxgCseAddProject` and `nxgCseValidateOrbat` too.
The SDK's older `cseAddProject` / `cseValidateOrbat` are a different function set (camelCase
parameters, a JSON payload) and are deliberately not used here.

## Workshop wiring (Plan & Prepare)

1. **Point Iframe 6 (Execute tab) at the `/execute` route.**
2. **Map its fields:**

   | Execute field | Workshop variable | Direction |
   |---|---|---|
   | `scenario` | `[NXG-P] Selected Scenario` | in |
   | `selectedPhase` | `[NXG-P] Selected Phase` | in and out |
   | `mockDemo` | `[b] Mock Data?` (rename it "Demo mode") | in and out |
   | `onLaunched` (event) | Optional: switch the sidebar to the live-map tab | out |

   For `selectedPhase`, fix the Selected Phase binding described in `WORKSHOP.md` first.
3. **Wire `mockDemo` to the same variable on the HLA Map and Analysis iframes**, so demo mode switches
   across the whole flow at once.

## Preflight against the composition

When a composition is chosen, Execute fetches its files with `nxgCseGetCompositions` (unchanged
CSE-Prep function) and runs the Translator's `nxgPreflightOrbatFromPhaseForComposition` with the
composition XML. That adds the composition's own checks to the ORBAT ones: a unit needing a simulator
the composition doesn't run, force size outside its limits, formations outside its echelon span. It
re-runs when the composition changes.

If CSE returns no files for the composition, or the function isn't available to the app yet, Execute
runs the plain `nxgPreflightOrbatFromPhase` and says so under the Preflight check.

## Stored CSE verdict

If `nxgCseValidatePhaseOrbat` has checked the phase before, Execute shows that stored verdict
(`cseValidationStatus`, `cseValidationDetail`, `cseValidatedAt` on the phase hierarchy) on the CSE
validation row until you run a fresh check. A stored failure shows as a warning, because it may be
stale.

## Launch record: `NxgCseLaunch` (Ontology Manager)

Every launch writes a record: at the start, after the export, after publish, and when it completes or
fails. The writes are queued per launch and never hold the launch up. Analysis uses the records to know
which phase a run executed; Readiness shows each phase's last launch.

Until the object type exists, records are kept in the launching browser only, and the screen says so.
Demo launches are never written to the ontology.

**Object type `NxgCseLaunch`**, primary key `launchId`:

| Property | Type | Notes |
|---|---|---|
| `launchId` | String | Primary key (UUID) |
| `scenarioId`, `phaseId`, `phaseName`, `operationKey` | String | What was launched |
| `project`, `composition` | String | Where in CSE |
| `status` | String | `running`, `launched` or `failed` |
| `failedStep`, `error` | String | When it failed (`error` up to 4,000 characters) |
| `unitCount` | Integer | Units in the phase ORBAT |
| `orbatDigest` | String | Short hash of the exported ORBAT XML: which version of the force went in |
| `demo` | Boolean | Always false in the ontology |
| `startedAt`, `publishedAt`, `simStartedAt`, `endedAt`, `launchedAt` | Timestamp | ISO strings from the app |

**Actions** (API names matter: the app calls them by name):
- `createNxgCseLaunch`: creates the object, with every property above as a parameter of the same name.
- `modifyNxgCseLaunch`: object parameter `nxgCseLaunch`, plus the same properties except `launchId`.

Add the object type and both actions to the Developer Console application, alongside
`nxgPreflightOrbatFromPhaseForComposition`, `nxgCseAddProject` and `nxgCseValidateOrbat`. The
readiness screen checks all of them.

## Not yet done

- **Composition status isn't polled after publish.** `nxgCseCompositionStatus` exists, but the shape
  of its answer has not been confirmed (CSE-Prep is out of scope for now; see
  `ORBAT_PIPELINE_PLAN.md`).
- **CSE-Prep orchestrates nothing itself.** Execute runs the steps; the target is one idempotent
  "prepare launch" function in CSE-Prep that writes `NxgCseLaunch` itself.
