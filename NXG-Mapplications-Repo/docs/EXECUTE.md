# Execute — readiness, launch, live map

Route `/execute`. This is the act of the exercise that sits between building a phase's force (Scenario
Planner) and watching it fight (HLA Map) or reviewing it (Analysis).

| Step | What it checks or does | Calls |
|---|---|---|
| Phase ORBAT | Units per side in `hier-{scenario}--{phase}` | Ontology read (`loadPhaseForest`) |
| Preflight | Will every unit actually spawn? This **must** have no errors before launch. | `nxgPreflightOrbatFromPhase` |
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

- `nxgPreflightOrbatFromPhase`, `nxgTranslateOrbatToXmlFromPhase` (Translator)
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

## Not yet done

- **A launch is not recorded against the phase.** No run ID or time window is saved, so Analysis still
  finds runs by gaps in the track stream. Recording it needs either new `NxgPhase` properties or a run
  object type.
- **The stored CSE verdict is not read back.** `nxgCseValidatePhaseOrbat` writes
  `cseValidationStatus`, `cseValidationDetail` and `cseValidatedAt` on the hierarchy. Execute runs a
  fresh check instead of reading them, because the SDK may not expose those properties yet.
- **Composition status isn't polled after publish.** `nxgCseCompositionStatus` exists, but the shape
  of its answer has not been confirmed.
