# NEXGEN Common Simulation Platform (CSP) — Resource Reference

> **Purpose of this document.** A resource-by-resource catalogue of the CSP project: what each
> dataset, object type, link, action, function, application and connection *is*, *why it exists*
> and *how it is used*.
>
> For the narrative view of how it all fits together, read
> [`CSP_PLATFORM_OVERVIEW.md`](./CSP_PLATFORM_OVERVIEW.md) first.
>
> **Scope / exclusions.** Deprecated and throwaway assets are deliberately omitted: the
> `0. Prototyping` and `Experimentation` folders, `2. Ontology/PMESII (depr)`, scratch Workshop
> modules and test sources, and the unwired `[NXG] Phase Draft Generator` /
> `[NXG] Phase Map Generator` AIP Logic functions (superseded by the three live logics below).

**Project root:** `ri.compass.main.folder.3a79a425-13e7-4cc4-86d8-77d64b8c7d22`
**Ontology:** `ri.ontology.main.ontology.cc5e8302-efb1-44a0-b5ed-94c47bef6b9e`

---

## Table of contents

1. [Data — `1. Data`](#1-data)
2. [Ontology — `2. Ontology`](#2-ontology)
3. [Applications — `3. Applications`](#3-applications)
4. [Functions — `4. functions`](#4-functions)
5. [Connections — `5. Connections`](#5-connections)
6. [AI Agents — `6. AI Agents`](#6-ai-agents)
7. [PMESII sub-project](#7-pmesii-sub-project)
8. [Documentation](#8-documentation)

---

## 1. Data

`CSP/1. Data` — `ri.compass.main.folder.6414dabe-62f2-4a83-bdc9-57e472de88ed`

### 1.1 `raw/` — source drops

`ri.compass.main.folder.40c542ae-abe1-49d5-ac64-70230b0f4f18`

Unmodified vendor and protocol reference data, one area per source system. Nothing here is
consumed directly by the ontology — everything passes through the reconciliation transforms first.

| Resource | RID | What / why |
|---|---|---|
| `CSE PREP DATA/` | `ri.compass.main.folder.3dd9366c-ea41-47b9-9240-4f90246fd138` | CCLM, CSE and VBS4 preparation exports used to build the CSE composition path |
| `Dis Reference/` | `ri.compass.main.folder.01abcf93-09e5-425a-a68b-f6860a2e52f8` | DIS (IEEE 1278.1) entity-type XML and enumerations — the lingua franca used to match assets across simulators |
| `[NXG] DIS Code Reference` | `ri.foundry.main.dataset.98e89a42-3280-4ce7-9574-353c410be97c` | Flattened DIS entity-type table used by the matching transforms |
| `sword/` | `ri.compass.main.folder.bc135027-06fc-450c-a41a-cbd32588985d` | SWORD model library export |
| `vbs4 Reference` | `ri.foundry.main.dataset.bbe891a7-b9a1-460b-bb9a-88e4d526dd5c` | VBS4 asset library export (models, seats, turrets, classes) |
| `[NXG] SIMWORKS` | `ri.foundry.main.dataset.3fe97105-8470-4a9f-9f90-9a0e6faf6325` | SIMWORKS asset library export |
| `029 - SWORD model folder` | `ri.compass.main.folder.0e0d846f-4756-4e57-9e46-3abd8cd02ed7` | The SWORD "029" simulation model with its data and plugins |
| `reference/` | `ri.compass.main.folder.5f3430eb-6a1e-4880-b09d-269d9c8309bd` | Ontology schema definitions and the SIMWORKS classification reference |

### 1.2 `consolidated/` — the reconciled catalogues

`ri.compass.main.folder.7b3c608a-c8d1-4828-8465-403e2bf979c5`

The output of the canonical↔simulator matching pipeline. **This is the interoperability layer of
the platform** — every simulator catalogue row carries a `canonicalAssetKey` so one ORBAT can be
targeted at any simulator.

| Dataset | RID | What / why |
|---|---|---|
| `master_asset_catalogue` | `ri.foundry.main.dataset.d7913c5d-4071-40a0-a6be-56505caad2c0` | ~1,600 **canonical assets** — simulator-independent asset classes (Name, Category, Subcategory, Domain, Country, Type). Backs `[NXG-O] Canonical Asset` |
| `vbs4_asset_catalogue` | `ri.foundry.main.dataset.d4be37b6-2098-426a-9feb-c9fde8c6e3d3` | Cleaned VBS4 models with DIS codes, crew/gunner/cargo seat config, turret ids, drone flag, SIDC, nationality variants. Backs `[NXG-O] VBS4 Asset Catalogue` |
| `sword_asset_catalogue` | `ri.foundry.main.dataset.52980300-cd9d-4bf9-adb2-1b49463feadb` | Cleaned SWORD models. Backs `[NXG-O] Sword Asset Catalogue` |
| `simworks_asset_catalogue` | `ri.foundry.main.dataset.86d7104c-6ae9-4860-8cb3-46123afb6770` | Cleaned SIMWORKS models. Backs `[NXG-O] Simworks Asset Catalogue` |
| `consolidated_unique_dis_entities` | `ri.foundry.main.dataset.e3d48c65-c669-47b9-9ea5-a8d0f8e1b29a` | Deduplicated DIS entity records — the join key used when a vendor name match is ambiguous |

### 1.3 `Backing Datasets/` — ontology datasources

`ri.compass.main.folder.a927db7a-6f1a-4441-9d45-6138fa5397d3`

The tables the ontology object types are mapped onto. Produced by the `nxg-exercise-data`
transform repo (seed/demo content); live changes arrive as **Ontology edits layered on top**,
not by re-running the transform.

**Plan & Prepare datasources**

| Dataset | RID | Backs |
|---|---|---|
| `nxg_scenario` | `ri.foundry.main.dataset.d80d37fe-eed6-4bca-9e77-56a0b55996f1` | `NxgScenario` |
| `nxg_phase` | `ri.foundry.main.dataset.fd399a85-69dc-47f0-a91c-636630b3d6f5` | `NxgPhase` |
| `nxg_task` | `ri.foundry.main.dataset.d436b22b-ac65-49dc-a1d4-86b00693f671` | `NxgTask` |
| `nxg_inject` | `ri.foundry.main.dataset.d9c155c3-26a7-40f9-856b-2d2c8d658e23` | `NxgInject` |
| `nxg_phase_map_state` | `ri.foundry.main.dataset.289575e5-b934-4ae6-b393-f9bfc5de80a1` | `NxgPhaseMapState` |
| `nxg_pmesii_domain` | `ri.foundry.main.dataset.5f7d4f2a-0914-4d0c-8fde-57eacdc3da68` | `NxgPmesiiDomain` |
| `nxg_training_audience` | `ri.foundry.main.dataset.192048bb-9c02-48c9-9b75-926ceab6a148` | `NxgTrainingAudience` |
| `nxg_training_objective` | `ri.foundry.main.dataset.b57cc7eb-57c8-4f3e-9f67-d19c192e5a1c` | `NxgTrainingObjective` |
| `nxg_composition` | `ri.foundry.main.dataset.ffee806a-db13-48b3-acad-e0edfa4dd54b` | `NxgComposition` |
| `P&P Docs` (media set) | `ri.mio.main.media-set.12b8bf1b-6d19-4898-9daf-7ef1b156d4ec` | Uploaded planning documents consumed by *Generate Exercise Scenario from Documents* |

**ORBAT datasources — `mockontology/`** (`ri.compass.main.folder.5f153aa9-1efb-4399-bc28-ab114962aa7c`)

Despite the folder name these are the **live** datasources for the ORBAT object types.

| Dataset | RID | Backs |
|---|---|---|
| `Unit` | `ri.foundry.main.dataset.24299bdf-936b-4a43-8b8d-c22834983a49` | `NxgUnit` |
| `UnitHierarchy` | `ri.foundry.main.dataset.84414336-6811-4841-9295-0b71808c0d6d` | `NxgUnitHierarchy` |
| `UnitHierarchyEdge` | `ri.foundry.main.dataset.62bb8d1a-0dae-4817-a372-ebaa92621895` | `NxgUnitHierachyEdge` |
| `UnitHierarchyNodeRelationshipType` | `ri.foundry.main.dataset.ceb5c64a-2903-42d5-a856-d480e7d7609c` | `NxgUnitHierarchyNodeRelationshipType` — the ORGANIC/OPCON/TACON/ATTACHED/ASSIGNED vocabulary |
| `Operation` | `ri.foundry.main.dataset.8ba884d6-f018-40da-adda-acf9ce5eae59` | `NxgOperation` |
| `UnitType` | `ri.foundry.main.dataset.99318a80-55a2-4d78-9021-919813ad665d` | `NxgUnitType` |
| `EquipmentType` | `ri.foundry.main.dataset.20b2d9a8-9e17-4f5e-ab32-3dc826f1387e` | `NxgEquipmentType` |
| `TacticalGraphicSymbol` | `ri.foundry.main.dataset.26a07a8f-9118-4454-873b-33ebdfe37061` | `NxgTacticalGraphicSymbol` |
| `SimulatorConfig` | `ri.foundry.main.dataset.198f0c36-e4a9-4e50-ac2d-792d56153f6c` | Per-simulator configuration used at export/publish time |

**Supporting ORBAT data**

| Dataset | RID | What / why |
|---|---|---|
| `nexgen_units` / `nexgen_edges` / `nexgen_unit_hierarchy` / `nexgen_operation` | `e3c1b2ad-…`, `71f78a54-…`, `9bcf9714-…`, `97718765-…` | Seed ORBAT for the demo exercises, emitted by `nxg_nexgen_orbat.py` |
| `force_structure_snapshots` | `ri.foundry.main.dataset.5ca7e195-6973-44fb-bf32-8453849c2959` | Point-in-time captures of a force structure. Backs `[NXG] Force Structure Snapshot`; used to freeze an ORBAT against an operation |
| `nxg_orbat_templates` | `ri.foundry.main.dataset.ca97bf24-0b99-4a30-9e33-52d9a7911e44` | Reusable ORBAT skeletons offered in the ORBAT manager's Templates panel |
| `NXG Hierarchy Templates` | `ri.foundry.main.dataset.a9ef39bf-58ae-4a06-bf65-05baaffc6202` | Doctrinal hierarchy shapes used by automatic child generation |
| `tactical_graphic_symbols` | `ri.foundry.main.dataset.a368cf73-6839-40ad-978f-c0250fb41f61` | NATO tactical graphics (control measures, boundaries, task symbols) for map rendering |
| `simulator_config` | `ri.foundry.main.dataset.2717763a-271f-4d4f-85d9-78f1c61eaa6b` | Simulator endpoints/parameters used by export and publish |

### 1.4 `terrain/` — the geospatial substrate

`ri.compass.main.folder.4231dd92-ac46-420e-a25a-a5e2d1c39927`

| Dataset | RID | What / why |
|---|---|---|
| `Elevation Data` | `ri.foundry.main.dataset.7d1c190d-97ff-462c-a0e4-94946fe5e6c3` | Source DEM for slope/LOS and cost derivation |
| `generated-terrain-geojson` | `ri.foundry.main.dataset.37dc6937-4d92-42c2-b329-6637e44730c0` | Vectorised terrain features (used for inject terrain references and map overlays) |
| `Generated Shape Files` | `ri.foundry.main.dataset.be965e72-93fa-41e9-900b-5273cc313ef0` | Intermediate vector products |
| `northnordic2` | `ri.foundry.main.dataset.96a56cab-ef62-499c-81b8-1cb54883d131` | The **primary AOI basemap** (`northnordic2.pmtiles`) served straight from Foundry to MapLibre |
| `northnordic-pmtiles` / `pmtiles` / `pmtiles-segment` / `pmtilesconfig` | `c6ad107f-…`, `6d1c0a6e-…`, `f64f2b4b-…`, `fb368178-…` | Tile build pipeline stages and configuration |
| `Terrain Cost Raster` | `ri.foundry.main.dataset.594caffe-a93e-4226-901b-f6c0497842dd` | Per-cell movement cost — the basis of terrain-aware routing |
| `Terrain Cost Raster (Graph)` | `ri.foundry.main.dataset.412d1eb3-9ea3-43dc-b8a0-2316b9a69b5c` | Cost raster converted to a traversal graph |
| `Tiled Pathfinding` | `ri.foundry.main.dataset.cb7bebcf-a89b-4774-814b-97f8128d72a8` | **The graph the browser actually reads** — spatially tiled so only the tiles a route touches are fetched. Consumed by the tiled router web worker |
| `Pathfinding` | `ri.foundry.main.dataset.07230a70-a4bf-4cc9-b481-7abb37be7561` | Untiled precursor to the above |
| `Terrain Cost Raster Kaliningrad`, `Tiled Pathfinding_Kaliningrad` | `9d480ab9-…`, `d6e3fa39-…` | The same products for a second area of interest |

`tactical symbology/` (`ri.compass.main.folder.66f0db56-8527-4401-b9a0-b6ed3f8ea54`-prefixed folder
`66f0db56-8527-4401-b9a0-b6ed…`) holds the tactical symbol dataset and its image media set used to
render NATO symbols in the applications.

---

## 2. Ontology

`CSP/2. Ontology` — `ri.compass.main.folder.24789012-0b58-494f-84f3-dfe47128bf31`

### 2.1 ORBAT domain

**Object types** — `ri.compass.main.folder.65aa5584-f1a4-4b6e-96c6-9b26fa023e29`

| Object type | API name | RID | What / why |
|---|---|---|---|
| `[NXG-O] Unit` | `NxgUnit` | `ri.ontology.main.object-type.e6d24345-6ee1-4e5a-bba8-7b8c279ee1c0` | A person, vehicle or organisational grouping in an exercise. Carries lat/lng, `sidc`, `echelon`, `affiliation`, `allegiance`, `militaryService`, `entityType`, `canControlDrones`, plus simulator identity (`owningSimulator`, `simulatorIdentifierCode`, `dis6Code`). The central object the whole planning UI manipulates |
| `[NXG-O] Unit Hierarchy` | `NxgUnitHierarchy` | `ri.ontology.main.object-type.d2d1a007-c315-4a1d-be2e-62e4d59a9e14` | A **named ORBAT tree** for an operation, with `validFrom`/`validTo` so time-phased force changes can be modelled |
| `[NXG-O] Unit Hierachy Edge` | `NxgUnitHierachyEdge` | `ri.ontology.main.object-type.ba721810-9fc8-4f18-abd3-f277eddc74ba` | A directed parent→child command link with a `relationshipTypeKey` and temporal validity. Edges are objects (not pointers) precisely so command relationships can change mid-exercise |
| `[NXG-O] Unit Hierarchy Node Relationship Type` | `NxgUnitHierarchyNodeRelationshipType` | `ri.ontology.main.object-type.3b54c017-3d98-44ce-a915-2100db36dc59` | Controlled vocabulary: ORGANIC, OPCON, TACON, ATTACHED, ASSIGNED |
| `[NXG-O] Canonical Asset` | `NxgCanonicalAsset` | `ri.ontology.main.object-type.994dced7-d788-4950-82af-268786ee509f` | **The interoperability bridge.** A simulator-independent asset class (category, subcategory, military domain, nationality, simulation class). Read-only — sourced from `master_asset_catalogue` |
| `[NXG-O] VBS4 Asset Catalogue` | `NxgVbs4AssetCatalogue` | `ri.ontology.main.object-type.0a5b2b83-07d0-4cf2-a54a-574d16eae99a` | VBS4-specific model detail: DIS codes and provenance, `gunnerSeatCount`/names/turret ids, `numCargoSeats`, `hasCommander`, `isDrone`, `crewClass`, `simulationClass`, `variant`, preview image. Links to Canonical Asset |
| `[NXG-O] Sword Asset Catalogue` | `NxgSwordAssetCatalogue` | `ri.ontology.main.object-type.c86ababd-90e9-4b0e-bfbe-a6b7ea278f61` | SWORD-specific model detail; links to Canonical Asset |
| `[NXG-O] Simworks Asset Catalogue` | `NxgSimworksAssetCatalogue` | `ri.ontology.main.object-type.6148fe80-6c2b-437a-b526-c2f3c3fe811a` | SIMWORKS-specific model detail; links to Canonical Asset |
| `[NXG-O] Operation` | `NxgOperation` | `ri.ontology.main.object-type.97d9094c-203f-417f-82e1-d7935b594812` | A time-bounded exercise on a named terrain; owns unit hierarchies |
| `[NXG-O] Unit Type` | `NxgUnitType` | `ri.ontology.main.object-type.46e13967-ee74-471e-8933-ab83795f61be` | Classification template for units (drives defaults and doctrine rules) |
| `[NXG-O] Equipment Type` | `NxgEquipmentType` | `ri.ontology.main.object-type.5605a14f-9677-4fbd-b2ad-fb44191133a9` | Equipment classification attached to units |
| `[NXG-O] Tactical Graphic Symbol` | `NxgTacticalGraphicSymbol` | `ri.ontology.main.object-type.3c9d0baf-41fb-4b09-87b8-36180d73b526` | Placed NATO tactical graphics (boundaries, control measures) with positions |
| `[NXG] Force Structure Snapshot` | — | `ri.ontology.main.object-type.b1982589-d11b-4874-92e3-08f06c68a69a` | Frozen point-in-time force structure for an operation |
| `[NXG-O] Template Orbat Graph` | — | `ri.ontology.main.object-type.065e80d8-7dfb-48d1-8cca-29cab794c3fc` | Stored reusable ORBAT graph templates (has its own Create/Edit/Delete actions) |
| `[NXG-SC] Tactical Task Symbols` | — | `ri.ontology.main.object-type.bfbde3f3-9641-4751-8836-eb0c867cd8cb` | APP-6 tactical **task** symbol reference (Seize, Screen, Block, …) used when drawing orders |

**Link types** — `ri.compass.main.folder.dd205265-e5f2-41ab-9a07-aad95bab0e36` (15 links)

The important ones:

| Link | RID | Why it exists |
|---|---|---|
| `[NXG] Unit Hierarchy - [NXG] Unit Hierachy Edge` | `ri.ontology.main.relation.8ac98650-b156-42de-ba29-c3ea3e0e448c` | Edges belong to a hierarchy |
| `[NXG] Unit - [NXG] Unit Hierachy Edge` (×2) | `1a281dc3-…`, `45695f6c-…` | The parent side and the child side of each edge — this pair is what forms the tree |
| `[NXG] Unit Hierarchy Node Relationship Type - Edge` | `107096bc-0b0f-44bd-bd6a-ed82caa86b8b` | Types each edge (OPCON/TACON/…) |
| `[NXG] Canonical Asset - [NXG] Unit` | `0d36a0d9-0038-476a-a55d-779c69768eab` | What kind of thing a unit is |
| `[NXG] Canonical Asset - vbs4 / Sword / Simworks Asset Catalogue` | `d33fdb23-…`, `5000c61c-…`, `a76cc452-…` | **The cross-simulator resolution links** |
| `[NXG] vbs4 / Sword / Simworks Asset Catalogue - [NXG] Unit` | `6bf99737-…`, `0a983841-…`, `3fce3767-…` | Direct simulator-model binding for a placed unit |
| `[NXG] Operation - [NXG] Unit Hierarchy` | `6ff2d3c5-3a11-46f1-97fb-ed9e206d7fa9` | Which ORBATs belong to which exercise |
| `[NXG] Unit Type - [NXG] Unit`, `Equipment Type - [NXG] Unit` | `4b2eaa32-…`, `21f2884e-…` | Classification |
| `[NXG] Unit - [NXG] Tactical Graphic Symbol` | `2b22b24d-ff33-48d8-94b4-a62e1b17b3c9` | Symbols associated with a unit |

**Action types** — `ri.compass.main.folder.751fbdb8-b4c2-4853-8f5e-38bcd09bc0c6`

| Action | RID | What / why |
|---|---|---|
| `[NXG-O] Generate Orbat` | `ri.actions.main.action-type.040064b3-1656-4286-9cdf-913ab3c82350` | Function-backed (`import_ontology_orbat_from_json`). Bulk-creates a whole ORBAT from a JSON payload — used when importing a generated or templated structure |
| `[NXG-O] Reconcile Scenario Orbat` | `ri.actions.main.action-type.406fa6da-a2b5-4199-9466-8584e39b892e` | Function-backed (`reconcile_scenario_orbat`). **Idempotent, transactional** convergence of hierarchy + units + edges from a single payload; unlike Generate Orbat it can **re-parent** and deletes contradicting edges for the units the caller declares it manages. This is the primary write path from the graphical ORBAT editors |
| `createNxgUnit` / `updateNxgUnit` / `deleteNxgUnit` | `61171931-…`, `f20e3e4b-…`, `205ef795-…` | Single-unit CRUD, function-backed by the TS v2 Ontology Edit Functions repo |
| `createNxgUnitHierarchy` / `updateNxgUnitHierarchy` | `986ff928-…`, `ec5e600c-…` | Hierarchy CRUD |
| `createNxgUnitHierachyEdge` / `deleteNxgUnitHierachyEdge` | `a6666aa4-…`, `8e9583ee-…` | Edge CRUD — how a single re-parent is done interactively |
| `createNxgTacticalGraphicSymbol` / `updateNxgTacticalGraphicSymbolPosition` / `deleteNxgTacticalGraphicSymbol` | `ca816eff-…`, `22d9d1b3-…`, `a5aa4e29-…` | Placing and dragging tactical graphics on the map |
| `createNxgOperation` / `deleteNxgOperation` | `3d7d3015-…`, `106f586c-…` | Operation lifecycle |
| `Create / Edit / Delete [NXG-O] Template Orbat Graph` | `3c8b14f0-…`, `8d00fe72-…`, `e14ca084-…` | Managing reusable ORBAT templates |

> All ORBAT actions carry an organisation-marking validation rule
> (`ab33cdf6-c43e-4221-9d86-0c9e7c0ccdc7`), so submission requires the right org membership.

### 2.2 Plan & Prepare domain

**Object types** — `ri.compass.main.folder.e14a1b6b-9557-4321-99ce-d5c1cec1d951`

| Object type | API name | RID | What / why |
|---|---|---|---|
| `[NXG-P] Scenario` | `NxgScenario` | `ri.ontology.main.object-type.5081c7b5-798f-4a28-b0dc-6236793d736b` | The apex object. `scenarioType` (CAX/CPX/FTX), `classification`, `scenarioStatus`, `currentPhase`, `overallProgressPct`, `strategicContextTitle`/`Body`, `sourceDocuments`, `aiGenerated`. Everything else hangs off it |
| `[NXG-P] Phase` | `NxgPhase` | `ri.ontology.main.object-type.3833c4ca-aff8-4878-8120-c3b8b36ca257` | A time-bounded stage. `sequenceNumber`, `startOffset`/`endOffset` (D+/H+ relative time), `objectiveStatement`, `phaseStatus`, and **`basedOnPhaseId`** which implements branching COAs — two phases sharing a `basedOnPhaseId` are alternatives from the same decision point |
| `[NXG-P] Task` | `NxgTask` | `ri.ontology.main.object-type.88f1151f-f825-4783-bb86-5ec06bb8601e` | A planning/preparation work item. `taskSection`, `dueOffset`, `assignedToPersonId`, `approvedByPersonId`, `aiAssisted` — supports an assign→review→approve workflow |
| `[NXG-P] Inject` | `NxgInject` | `ri.ontology.main.object-type.3692ee06-2e3e-45dd-83ae-4e6039f88949` | A MEL/MIL scripted event. `injectCategory` (INTEL/CYBER/LOG/CIMIC), `dayOffset`, `injectBody`, **`expectedResponse`** (used for assessment/AAR), optional `referencesTerrainFeatureId` |
| `[NXG-P] Phase Map State` | `NxgPhaseMapState` | `ri.ontology.main.object-type.fba601eb-2427-4024-999b-b9fb2d915a3b` | **The hinge of the planning loop.** One per phase; stores `startStateMapJson` and `endStateMapJson` — units, objectives, orders, resolved positions, engagements. One phase's end state is the next phase's start state |
| `[NXG-P] Training Audience` | `NxgTrainingAudience` | `ri.ontology.main.object-type.815626fe-6a08-4e91-abb8-e77a73fdd402` | Who is being trained: name, primary/secondary, participant count, directorates. Attached at scenario level because an audience spans the whole exercise |
| `[NXG-P] Training Objective` | `NxgTrainingObjective` | `ri.ontology.main.object-type.b5dff895-464d-4ba0-9d54-94f1e561d055` | What the exercise should develop or assess: objective statement, doctrinal `ref`, priority, functional area. Links to both scenario and phase |
| `[NXG-P] PMESII Domain` | `NxgPmesiiDomain` | `ri.ontology.main.object-type.4e10c53b-af67-4c3b-9b28-f0f44ce2b921` | One PMESII-PT variable for a scenario: `domainKey`, `domainValue` narrative, `domainStatus`, `aiGenerated` |
| `[NXG-P] Composition` | `NxgComposition` | `ri.ontology.main.object-type.38069efa-c1b1-49ae-8316-14daef8e545b` | **The technical run configuration**: `federationProtocol` (e.g. IEEE 1516 HLA Evolved), `rtiHost`, `topologyType`, `networkBackbone`, `tacticalDataLink` (Link 16), `legacyProtocol` (DIS), `c2DataExchange` (NFFI/JC3IEDM). Bridges planning to the execution layer |

**Link types** — `ri.compass.main.folder.e9b2f8c6-e47f-45be-9cae-c5c68b23d60c`

| Link | RID | Why |
|---|---|---|
| `Scenario - Phase` | `f20a52c5-22c9-4d6e-96cb-1d43edc7ffd1` | The main spine (traversed by the Workshop `Selected Phase` variable) |
| `Phase - Task`, `Phase - Inject`, `Phase - Training Objective` | `cbfcd4e0-…`, `7fe627db-…`, `9231fd27-…` | Phase-scoped content |
| `Scenario - Task`, `Scenario - Inject`, `Scenario - Training Objective` | `a6624551-…`, `10b492d1-…`, `2d7138e3-…` | Scenario-wide rollups |
| `Scenario - Training Audience`, `Scenario - PMESII Domain`, `Scenario - Composition` | `cbbf803a-…`, `55a34f7a-…`, `f0cfae49-…` | Scenario-level context |
| `[NXG] Phase - Phase Map State` | `6677b072-eb14-4b21-9353-a914ec4d46f1` | 1:1 map state |
| `Based On Phase - Branch Phase` | `8852fdee-c23d-440d-86fa-4b8af3baa906` | **Branching / alternative COAs** |

**Action types**

Phase map state actions live in `ri.compass.main.folder.c84f1412-2602-46bf-a3f4-e31ef36822ed`:

| Action | RID | What / why |
|---|---|---|
| `Create [NXG-P] Phase Map State` | `ri.actions.main.action-type.edd7918b-8cf2-4c77-b81e-32d7e2e8b623` | Creates the map state for a new phase |
| `Update [NXG-P] Phase Map State` | `ri.actions.main.action-type.d01dc4e1-c46b-4caf-b51f-f113e4132992` | Writes `startStateMapJson` / `endStateMapJson` back after planning or AI resolution |

The remaining Plan & Prepare CRUD actions sit alongside the object types:
`Create/Delete [NXG-P] Scenario` (`fc578623-…`, `bbd0c3b5-…`),
`Create/Modify/Delete [NXG-P] Phase` (`dd8d2a0c-…`, `399190b6-…`, `c33a1fc4-…`),
`Create [NXG-P] Task` (`e6a5f980-…`),
`Create/Delete [NXG-P] Inject` (`1230fbdb-…`, `5fbd9883-…`),
`Create/Modify [NXG-P] PMESII Domain` (`b699bed2-…`, `255d7349-…`),
`Create/Delete [NXG-P] Training Audience` (`2f39a8dd-…`, `1371733b-…`),
`Create/Delete [NXG-P] Training Objective` (`aaa45923-…`, `097f1a9d-…`).

Also in the ontology root: `Create PMESII Media`
(`ri.actions.main.action-type.2bc40396-2642-436b-be95-b4c57449f251`) for attaching PMESII media.

---

## 3. Applications

`CSP/3. Applications` — `ri.compass.main.folder.3f956f2a-9879-4732-ab31-69637d21dfe8`

### 3.1 Plan & Prepare

`ri.compass.main.folder.d8d4d9af-891e-468b-85cf-643efe269fa6`

| Resource | RID | What / why |
|---|---|---|
| **Plan & Prepare Workshop** | `ri.workshop.main.module.8bfbb4f7-c40b-46c7-9bab-0def4c809f80` | The application shell. Provides routing (3 pages), shared state (`Selected Scenario` → `Selected Phase` object sets), the 13-tab layout, and embedding of both custom widgets and the Mapplications iframes. Workshop supplies almost no visual widgets itself |
| **Plan & Prepare Widgets** (widget set) | `ri.widgetregistry..widget-set.dcda86f7-09a6-4ca8-8d36-3f98e2dbe788` | The published custom widget set consumed by the Workshop module |
| **Plan & Prepare Widgets repository** | `ri.stemma.main.repository.f8d57d24-dd89-460c-9c6e-ff079b72e9bc` | The React/Vite source (below) |

**Workshop page structure**

| Page | Content |
|---|---|
| Page 1 (entry) | Full-bleed `planner` widget — scenario landing, creation and AI scenario generation. Emits `onOpenPreparePhase` and `onOpenPmesii` to navigate |
| Main page | 200 px `customSidebar` + 55 px `customHeader` + a 13-tab section whose active tab is driven by a Workshop string variable written by the sidebar |
| Page 2 | Full-screen iframe to the PMESII frontend |

**Tab → implementation map**

| Tab | Implementation |
|---|---|
| Dashboard | `scenarioDashboard` widget (bound to Selected Scenario) |
| Scenario | sub-tabs: **Map** = Mapplications iframe; **Overview** = `scenario` widget |
| Phases | `phasesWidget` |
| Task Management | `taskAssignment` |
| Training Audience | `trainingAudience` |
| Composition | `composition` |
| PMESII Variables | `pmesiiAnalysis` |
| MIL & MEL | `milMel` |
| ORBAT & Positions | Mapplications iframe → `/orbat` |
| Training Objectives | `trainingObjectives` |
| AI Assistant | AIP Agent chatbot widget (Operations Chatbot) |
| Execute | Mapplications iframe → `/hlamap` |
| Analyse | Mapplications iframe → `/analysis` |

**Widget repository structure** (`src/`)

| Area | What / why |
|---|---|
| `planner/` | The landing experience: scenario list/creation plus `useScenarioGeneration.ts`, which drives document-based scenario generation |
| `scenario-dashboard/`, `scenario/` | Exercise summary, strategic context, OPFOR cards, progress |
| `phases/` | Phase list, create/edit phase modals, `useRichPhases` |
| `task-manager/task-assignment/` | Workflow table, team sidebar, member/task detail modals — assignment and approval |
| `task-manager/task-graph/` | Dependency graph view of tasks and phases, with exercise-area map and ORBAT tree side panels |
| `training-audience/`, `training-objectives/` | Audience cards / nations table; objectives table with priority and functional area |
| `main-event-list/` | `MilMel.tsx` — the MEL/MIL inject list and timeline |
| `pmesii-analysis/` | PMESII-PT domain cards, edit modal, comments |
| `orbat-manager/` | Full ORBAT editor: `orbatRules.ts` (doctrine rules), `symbolBuilder`/`symbolSpec`/`NatoSymbol` (APP-6/SIDC rendering), `autoChildGeneration`, `autoRelationship`, `treeUtils`, `AiStructurePanel` + `orbatAiSchema` (AI structure generation), `cseValidateSerialise` + `CseValidationTab` (validate against CSE before publish), `TemplatesPanel`, `FoundryImportPanel` |
| `asset-manager/` | Catalogue browsers per simulator, a DIS entity-type explorer, `sidcDecode`, and canonical↔simulator **mismatch/audit** tooling (`MismatchReportView`, `OrbatAuditTab`, `UnitAuditPanel`) |
| `ppea/` | The Plan-Prepare-Execute-Analyse blueprint: roles, tasks and gating logic, with unit tests (`ppeaLogic.test.ts`) |
| `chatbot/`, `custom-header/`, `custom-sidebar/`, `data-visualiser/` | Application chrome and a generic data view |
| `shared/hooks/useNxg*.ts` | Thin OSDK read hooks — `client(NxgPhase).where({ scenarioId }).asyncIter()` with a **15 s poll**, which is how widgets stay in sync without Workshop events |
| `shared/components`, `shared/styling` | Shared UI kit and the dark military theme |
| `DISCodesInfo/` | Bundled DIS entity types, enumerations, bitfields and PDU definitions used by the asset manager's DIS explorer |

### 3.2 Mapplications

`ri.compass.main.folder.16ffc481-7960-4946-b0c7-efa05ce19ebf`

| Resource | RID | What / why |
|---|---|---|
| **[NXG] Mapplications** (deployed app) | `ri.third-party-applications.main.application.01d93c11-77d8-46c4-bca9-3158bd5ff581` | The deployed OSDK React application embedded by the Workshop iframes |
| **[NXG] Mapplications Repo** | `ri.stemma.main.repository.9a08332e-522d-460d-b0d6-14d3c2af70b6` | Source. All heavy geospatial and simulation logic lives here |

**Routes**

| Route | App | What / why |
|---|---|---|
| `/` and `/scenario-plan` | `scenarioPlanner` | The phase map planner — place units, draw APP-6 orders, preview routes, check reachability, step through phases and branches, run the AI phase loop |
| `/orbat` | `orbatManager` | Graphical hierarchy editor, composition builder, CSE validation, phase switcher |
| `/hlamap` | `hlamap` | Live execution — entity track stream, command panel, event log |
| `/analysis` | `analysisScreen` | Replay of recorded runs for AAR (timeline, side panel, SQL-backed track queries) |
| `/timeline` | `timelineView` | Exercise timeline view |
| `/globe` | `globeMap` | Test harness for the chunked planet basemap |

**Key modules**

| Module | What / why |
|---|---|
| `shared/routing/tiledRouter.ts` + `tiledRouterWorker.ts` | Terrain-aware A* over the `Tiled Pathfinding` graph, run in a web worker so the UI stays responsive |
| `shared/routing/terrainRaster.ts`, `envelopeGeometry.ts`, `waypointSimplify.ts` | Cost-raster access, movement envelopes, route simplification |
| `scenarioPlanner/lib/orderReachability.ts` | Answers "can this unit reach that objective within the phase's time budget?" — feeds both the UI and the LLM prompt |
| `scenarioPlanner/phaseCreator/resolveOrders.ts` | The **deterministic movement/attrition resolver** that produces authoritative end-of-phase positions |
| `scenarioPlanner/phaseCreator/logicClient.ts` | Hardened AIP Logic client — multi-strategy JSON extraction, control-character escaping, truncated-JSON repair, context truncation, retry with exponential backoff |
| `scenarioPlanner/phaseCreator/phaseMapStateService.ts` | Loads/saves `NxgPhaseMapState` and orchestrates the whole draft → orders → resolve → narrate → persist loop |
| `shared/hla/symbology/app6.ts`, `rollup.ts` | APP-6 symbol generation and echelon roll-up, unit-tested |
| `shared/orbat/*` | Hierarchy building, eligibility, reconciliation, serialisation and handoff — the client side of `reconcile_scenario_orbat` |
| `shared/map/dechoBasemapSetup.ts` | MapLibre + PMTiles wiring, sourcing basemap, glyphs and sprites **from Foundry datasets rather than a CDN** (required for disconnected/classified operation) |
| `apps/hlamap/bridgeClient.ts`, `hooks/useEntityTrackStream.ts` | Command issuing and 1 Hz track consumption against the HLA bridge |

Also present: `[NXG] Map test Workshop` (`ri.workshop.main.module.c8587b80-0304-413b-b1eb-0d5fad85c0ff`)
— a small harness for testing the map embed.

---

## 4. Functions

`CSP/4. functions` — `ri.compass.main.folder.de7e6688-19ec-46fd-9307-dfba6900f0e2`

### 4.1 AIP Logic (live)

`ri.compass.main.folder.533755b0-316c-475a-8c4a-865e63aad705`

| Logic | RID | What / why |
|---|---|---|
| `[NXG] Generate Phase Draft` (`nxgGeneratePhaseDraft`) | `ri.eddie.main.logic.5105c875-6859-4b81-8671-91fefd0902fa` | Given a phase seed, the previous phase's **inherited unit positions**, existing audiences/PMESII/objectives/MEL-MIL, the time scale and available unit templates, returns a single JSON object containing **both** the narrative draft (title, intent, offsets, key objectives, audiences, PMESII factors, training objectives, injects) **and** the start-state map (`selectedUnits`, `unitPlacements`, `objectives`, `movements` with APP-6 task names). Claude Opus, non-strict output |
| `[NXG] Generate Orders` (`nxgGenerateOrders`) | `ri.eddie.main.logic.25c820b2-9f5f-47b7-8632-1470ce452de4` | Turns free-text commander's intent plus current unit positions, objectives and terrain reachability context into one order per unit (APP-6 task name, destination, target objective, rationale) |
| `[NXG] Generate Phase Map` (`nxgGeneratePhaseMap`) | `ri.eddie.main.logic.479270bf-f816-40ad-b496-057a80f5cc52` | Narrates the end state. Receives **authoritative resolved positions** from the deterministic engine and is explicitly forbidden from changing coordinates; it assigns unit status from attrition bands (<5 % operational → >30 % destroyed), writes per-unit resolutions, detects engagements and produces a 2–3 paragraph phase summary |
| `Generate Exercise Scenario from Documents` | `ri.eddie.main.logic.c168cc2a-10be-4451-88c7-7e60adcba812` | Bootstraps an entire scenario (strategic context, phases, supporting content) from uploaded planning documents in the `P&P Docs` media set |

> The `[NXG] Phase Draft Generator` and `[NXG] Phase Map Generator` logics in the same folder are
> earlier iterations and are **not referenced by any application** — treat them as superseded.

### 4.2 Function repositories

`ri.compass.main.folder.3e6adfc3-6fb5-49a3-92ab-f53adab34133`

| Repository | RID | Type | What / why |
|---|---|---|---|
| `[NXG] Ontology Edit Functions` | `ri.stemma.main.repository.874e7971-cfc7-4a7e-833a-82bd4a6a6fd5` | TypeScript v2 Functions | Backs the interactive ORBAT CRUD actions. Publishes `createNxgUnit`, `updateNxgUnit`, `deleteNxgUnit`, `createNxgUnitHierarchy`, `updateNxgUnitHierarchy`, `createNxgUnitHierachyEdge`, `deleteNxgUnitHierachyEdge`, `createNxgTacticalGraphicSymbol`, `updateNxgTacticalGraphicSymbolPosition`, `deleteNxgTacticalGraphicSymbol`. Exists because unit/edge creation needs derived keys and referential clean-up that declarative actions can't express |
| `[NXG] Translator` | `ri.stemma.main.repository.e9b29f7a-7caa-4118-93d6-60234637ceb7` | Python Functions | **ORBAT ⇄ simulator XML.** Publishes `generate_vbs4_orbat`, `generate_sword_orbat`, `translate_orbat_to_xml_from_operation` / `_from_json`, `translate_orbat_from_operation` / `_from_json`, `validate_orbat_xml`, `import_ontology_orbat_from_json`, `reconcile_scenario_orbat`. Ships the target schemas (`vbs4.xsd`, `sword.xsd`, `simworks.xsd`, `validate.xsd`) so output is schema-validated before it reaches a simulator. Also hosts the two bulk ontology-write functions used by the ORBAT actions |
| `NXG CSE-Prep Functions` | `ri.stemma.main.repository.6d5479c9-798c-4a04-a51b-42a49bf19f25` | Python Functions | **This repository.** 24 gRPC functions driving the CSE preparation service: `cse_health_check`, `cse_discover_services`, `cse_probe_endpoints`, `cse_get_schemas`/`cse_get_schema`, `cse_get_projects`, `cse_add_project`, `cse_remove_project`, `cse_add_orbat_to_project`, `cse_validate_orbat`, `cse_validate_project`, `cse_toggle_project_application`, `cse_publish_project`, `cse_get_compositions`, `cse_get_composition_types`, `cse_validate_composition`(`_simple`), `cse_run_composition`(`_simple`), `cse_composition_status`, `cse_composition_stop`, `cse_get_application_data`/`_types`, `cse_get_system_types`. **Also contains the full HLA-Pal-Bridge source** under `python-functions/python/HLA-Pal-Bridge/` (see §5) |
| `Error Handling LLM-V2` | `ri.stemma.main.repository.4b86b1e2-f80c-4b78-9953-f8dc6d16fc52` | Functions | Retry, fallback and structured error handling for LLM calls |
| `LLM_structure` | `ri.stemma.main.repository.83e0a2a2-b5ab-4ffe-a4e1-34ff390f805c` | Functions | Structured-output schemas and prompt scaffolding shared by the generation functions |
| `mace mcp` | `ri.stemma.main.repository.523917c5-3e4b-400a-83ac-8eee5a65a18c` | Functions | MCP client functions for the MACE simulation integration |

### 4.3 Transform repositories

`ri.compass.main.folder.64dca4eb-2916-423e-949e-f8825a23f8ec`

| Repository | RID | What / why |
|---|---|---|
| `nxg-data-transforms` | `ri.stemma.main.repository.bb743c57-af8e-4658-8b5d-aca918fa707f` | Lightweight Python transforms cleaning unit and reference data (`unit_clean.py`) |
| `[NXG] Canon <-> Sim Matching` | `ri.stemma.main.repository.e1807183-f068-4128-95c2-8bcd440a80d6` | **Builds the canonical asset catalogue and matches every vendor model to it** — the transform that makes cross-simulator ORBATs possible |
| `terrain functions` | `ri.stemma.main.repository.5e4b8904-792c-4dd2-a31e-6126ac88bf9b` | Terrain processing: elevation → cost raster → graph → tiled pathfinding, plus PMTiles generation |
| `nxg-exercise-data` | `ri.stemma.main.repository.3db57dbc-dca1-4079-b6e9-231fee213cb1` (in `1. Data/Backing Datasets/`) | Emits the 11 Plan & Prepare / ORBAT backing datasets. `nxg_data.py` builds the exercise content, `nxg_nexgen_orbat.py` builds the seed ORBAT |

### 4.4 Supporting datasets in `4. functions`

| Dataset | RID | What / why |
|---|---|---|
| `Graph Analysis` | `ri.foundry.main.dataset.2aab01b8-9c62-4b3b-a614-b8b153267799` | Intermediate graph analytics for the pathfinding pipeline |
| `ASC Binary Grid` / `_Kaliningrad` | `a9283ff8-…` / `415fa587-…` | Binary elevation/cost grids per AOI |
| `pmtilestopathfinding` | `ri.foundry.main.dataset.0b183227-c284-479f-9898-b7aed62bf233` | Converts PMTiles vector features into the traversability graph |
| `Pathfinding_Kaliningrad` | `ri.foundry.main.dataset.740209c9-f3bf-4fe5-a9d9-411568103800` | Second-AOI pathfinding output |

---

## 5. Connections

`CSP/5. Connections` — `ri.compass.main.folder.bd58f2a7-1ff5-48d2-9a0b-00aeb4eb198c`

This folder is the execution boundary: everything that talks to a real simulator.

### 5.1 Streams — the command/telemetry loop

| Resource | RID | What / why |
|---|---|---|
| `[NXG] Command Stream Input` | `ri.foundry.main.dataset.e52ee845-7d12-45c7-844c-3795c1495e58` | Commands issued from the UI toward the federation. Schema: `command_id`, `correlation_id`, `issued_at`, `issued_by`, `operation`, `target_kind`, `entity_uuid`, `partition_key`, `params`, `ttl_seconds`, `not_before`. The TTL/not-before pair lets commands be scheduled and expired safely |
| `[NXG] Command Stream Output` | `ri.foundry.main.dataset.28808101-229f-4424-8769-35c7d5a6e908` | Per-command outcome: `stage`, `http_status`, `task_id`, `dialect`, `fom_class`, `detail`. Gives a full audit trail of what the federation actually accepted |
| `HLA Entity Tracks (1 Hz stream)` | `ri.foundry.main.dataset.6e22a37b-e083-4977-be80-f407c8bd952b` | The telemetry return path. Per-entity, once per second: position, altitude, heading, speed, `damage_state`, `aggregate_state`, `activity`, `posture`, `mission`, `echelon`, `combat_value`, `is_command_post`, `dis_type`, `symbol_id`, `federation`. Drives the live map and the `/analysis` replay |

**Stream semantics worth knowing before building on these:**

* **The command streams are the only durable record of what was commanded.** `BridgeDiagnostics` keeps
  just the last 50 tasks in memory and loses them on restart, so anything that needs to reconstruct a
  session must read `Command Stream Output`.
* **Three distinct facts, three stages.** A record in `Command Stream Input` means *queued*. A
  `stage: SENT` row in `Command Stream Output` means the interaction left the bridge. Neither means a
  federate acted on it — that requires an acknowledgement, which the consumer counts separately.
  Terminal stages are `SENT`, `REFUSED`, `FAILED`, `EXPIRED` and `DUPLICATE`; `DEFERRED` is
  deliberately non-terminal, because a deferred command is held in memory only and must be re-read and
  re-deferred after a restart.
* **`ttl_seconds` is the primary replay defence**, not the seen-id cache. The consumer re-reads the
  whole stream on each poll (the stream-proxy records endpoint honours no cursor), so a record older
  than its TTL is dropped. Connection-control commands carry a short TTL (15 s vs 120 s) specifically
  so a replayed `DISCONNECT` cannot resign the federate every time the container restarts.
* **`partition_key`** is the entity UUID (or the target kind for entity-less commands), so commands for
  a single entity stay ordered.
* **Three track-stream columns are permanently null** — `posture`, `mission` and `is_command_post` do
  not exist in the NETN v4 model. `speed_mps` is empty for a different reason: the bridge's spatial
  decoder reads position and heading only. Do not read these as a bug.
* **`track_point_id` is a usable primary key.** It is deterministic (`unique_id@epoch_millis`) and keyed
  on the NETN `UniqueId` rather than the HLA instance handle, so it survives a federation restart and a
  retried publish overwrites rather than duplicating. No object type is backed by this stream yet.
* **Nullability matters.** Only `track_point_id` and `observed_at` are always present; every other
  column must be nullable, because `publishRecords` validates each record and rejects the **whole
  batch** if one is invalid — so one entity with a missing field would cost every other entity in that
  tick.

### 5.2 Compute modules and container artifacts

The live HLA path is **two compute modules built from three container images**. Getting the roles
right matters, because the two modules are not interchangeable and only one of them speaks HLA.

| Resource | RID | What / why |
|---|---|---|
| `[NXG] HLA Bridge Compute Module` | `ri.foundry.main.deployed-app.214954cb-98ad-4488-ba18-d0a1f862de96` | The **streamer module** (Module B) — the pod that actually joins the federation. Runs `hla-bridge` (the Java federate) plus `hla-bridge-streamer` (the Python publisher/consumer). Publishes entity tracks and executes queued commands. Deployed with `FEDERATION_NAME=CSE-Prep` |
| `HLA Streamer` | `ri.foundry.main.deployed-app.b4c28899-7810-4925-9558-4182cb37fdae` | Streaming deployment of the same pairing, run in **Pipeline** execution mode with the track stream declared as a named output |
| `[NXG] Commander` | `ri.foundry.main.deployed-app.7a13ba1c-718b-4bfc-a039-acffdf870d21` | The **commander module** (Module A) — `hla-command-poster` alone. Backs the `hla_*` Foundry Functions that validate commands and publish them to the command stream. **Never joins the federation and never touches HLA** |
| `[NXG] HLA Bridge Containers` | `ri.artifacts.main.repository.2f6171d9-8722-4164-b73a-810a63fee59c` | Artifact repository holding the three images (`hla-bridge`, `hla-bridge-streamer`, `hla-command-poster`). Tags are pinned **per module**, so the streamer can move to a new tag without redeploying the commander |
| `[NXG] CSE Prep Test Compute Module` | `ri.foundry.main.deployed-app.a822ab43-6088-4cb8-a0f1-061a6da04a40` | Hosts the CSE-Prep gRPC service used by this repository's `cse_*` functions |
| `[NXG] cse-prep` | `ri.artifacts.main.repository.be038ec8-1502-4f3e-8239-aa7292d057a6` | Container images for CSE-Prep |
| `[NXG] Client` | `ri.third-party-applications.main.application.bc14d6a4-df03-47d5-8050-ba865557a6d4` | OAuth client registration used by the deployed apps |

**Module comparison**

| | Module A — commander | Module B — streamer |
|---|---|---|
| Containers | `hla-command-poster` | `hla-bridge` + `hla-bridge-streamer` |
| `FEDERATE_NAME` | n/a (not a federate) | e.g. `CSE-HLA-Bridge` / `CSE-HLA-Tracks` |
| `BRIDGE_MODE` | n/a | unset → `full`, or `monitor` |
| Execution mode | Functions | **Pipeline**, minimum replicas **≥ 1** |
| Foundry functions | ~24 registered | none |
| Diagnostics channel | function responses | container logs + the streams themselves |

**Why the split.** Redeploying the pod tears down a live federation join, and the RTI then holds the
unresigned federate name for `FED_TIMEOUT_RECONNECT` (ten minutes), blocking the next start. With the
publisher separated, the stream can be iterated on without disturbing the federate operators are
tasking through. Costs: a second federate in the federation (a second FedPro session, LRC port, and
possibly a Pitch licence slot), and mandatory distinct `FEDERATE_NAME` values — two instances joining
under the same name are refused, though a pod-derived suffix is appended automatically as a safety net.

**Why the bridge is a separate Java container rather than in-process.** Entity state comes from HLA,
and Pitch ships Java and C++ bindings, not Python. The reader has to be the Java bridge, so the Python
container reaches it over `localhost:8080`. Co-location in one pod also guarantees the read and write
paths hit the *same* federate — task history is per-process, so a command posted to a different pod
would task a different federate with its own view of the federation.

**Compute-module egress caveat.** Modules have no external network access by default, including to
other Foundry services. A **source with a network policy for the Foundry enrollment URL** must be
attached, in the same project, with compute-module import enabled and an API name. Until then DNS
resolution fails inside the container and publishes die with `ConnectError: [Errno -2] Name or service
not known` while fetching a token — which reads as an authentication failure and is not one. Sources
can only be attached while the module is **stopped**, and network-policy edits need a full restart.
Pipeline-mode modules also receive no queries, so **minimum replicas must be ≥ 1** or the autoscaler
takes them to zero and the stream simply stops.

### 5.3 Bridge source — `python-functions/python/HLA-Pal-Bridge/`

All three images are built from this directory in **this** repository.

| Path | What / why |
|---|---|
| `cse-hla-bridge/` | The Java/Spring Boot HLA federate. Serves REST on `:8080`, bound to localhost inside the pod |
| `hla-bridge-streamer/` | Module B's Python container — `streamer.py` (entry point), `tracks.py` (entity tracks out), `commands.py` (commands in), `local_test_tracks.py` (offline harness) |
| `hla-command-poster/` | Module A's Python container — `app.py` (the command gateway and Foundry functions), `check_group_tasking.py` |
| `cse-hla-bridge/foms/` | The FOM modules baked into the image |
| `appsettings.json` | Reference settings captured from the target environment |
| `FEDPRO_CONNECTION.md` | How the bridge connects to the RTI via Pitch FedPro, the three-address model, and the settings-precedence findings |
| `FOM_TASKING.md` | The two NETN tasking dialects, class-by-class mapping, datatype changes, REST endpoint table, HTTP status semantics |
| `WIRE_CONTRACT.md` | Byte-level encoding contract with golden hex vectors, written to be implemented against by a federate in any language |
| `STREAMING.md` | The two-module/three-image topology, pipeline mode, publish endpoint fallback, record shaping and nullability |
| `DIAGNOSTICS.md` | The diagnostic endpoints, the "0 entities" decision table, and a worked order for "the task returned 200 but nothing moved" |

> Note: `streamer.py` references an `ARCHITECTURE.md` that does not exist in the tree; these two
> documents are intended to fill that gap. `STREAMING.md` also still refers to the Python image as
> `hla-bridge-functions`, which has since been renamed `hla-command-poster` — the docstring in
> `streamer.py` is the newer, authoritative description.

#### 5.3.1 The Java federate — `cse-hla-bridge/`

| Class | What / why |
|---|---|
| `BridgeApplication.java` | Spring Boot entry point. Binds `bridge.*` configuration, builds the `BridgeFederate` bean and starts the connection on a background virtual thread |
| `BridgeFederate.java` | The federate itself (~73 KB): FedPro/RTI connection, federation create/join, FOM handle resolution, publish/subscribe, dialect selection, time management, `sendInteraction`, and the `connectionLost` recovery path. Implements **both overloads** of every FedPro callback |
| `BridgeServer.java` | The REST API (~44 KB) — `@RequestMapping("/api/v1/bridge")`. Entity queries, simulation control, all tasking endpoints, and the diagnostics surface |
| `FederationAmbassador.java` | The RTI callback implementation — object discovery, attribute reflection, interaction receipt, removal |
| `HlaEncoder.java` | Encodes every NETN task struct to the wire format, including geodetic→ECEF conversion and `circleToPolygon` for area fields |
| `EntityStateStore.java` | In-memory entity state (position, heading, identity, damage) built from attribute reflections; the read model `tracks.py` polls |
| `EtrTaskSender.java` | Assembles and sends task interactions, applying inherited parameters (`Entity`, `TaskId`, `UniqueId`, `SendTime`, `TaskMode`, `Annotation`, `Tasker`) |
| `TaskDialect.java`, `BaseDialect.java` | The dialect abstraction — one interface, two implementations, so a federation's tasking convention is a runtime choice rather than a fork |
| `EtrV2Dialect.java` | NETN-ETR 2.0 / v2-era tasking (`ETR_Root.ETR_Task.*`) |
| `SmcV4Dialect.java` | NETN v4 tasking (`SMC_EntityControl.Task.*`) — the current target |
| `TaskEnums.java` | Enumerations shared by both dialects (`MoveTypeEnum32`, `PatrolTypeEnum32`, `RulesOfEngagementEnum8`, `TaskModeEnum8`, `TaskStatusEnum32`) |
| `BridgeDiagnostics.java` | Bounded observational state (~27 KB): a 50-entry task ring buffer, per-interaction-class counters, per-federate and per-entity records, and the `HEALTHY`/`DEGRADED`/`BROKEN` verdict logic |
| `PortProbe.java` | One-off startup connectivity probe against the environment's known ports, from the pod's own network position. Purely diagnostic |
| `EnvironmentPorts.java` | Derives FedPro and CRC addresses from a single `CSE_ENVIRONMENT` digit, and builds the **ordered CRC candidate list** (default → booster → in-cluster service names) because the CRC's advertised address is not stable here |
| `model/Entity.java`, `model/request/*.java` | The REST request DTOs — `MoveRequest`, `PatrolRequest`, `MagicMoveRequest`, `FireAtLocationRequest`, `FireAtEntityRequest`, `RoeRequest`, `HeadingRequest`, `SpeedRequest`, `AltitudeRequest`, `MrmRequest`, `ObstacleRequest`, `DisruptCommsRequest`, `InjectSuppliesRequest` |
| `src/test/java/.../HlaEncoderTest.java` | Asserts the wire layout of every struct — offsets, widths, alignment padding, degrees vs radians, ms vs s — against the golden vectors. **Runs in the Docker build**, so a layout mistake fails the image rather than becoming a silently-ignored task |
| `src/test/java/.../AttributeRefreshTest.java` | Covers the periodic attribute re-request path for incompletely reported instances |

**FOM modules** (`cse-hla-bridge/foms/`) — loaded on join, and contributed on
`createFederationExecution` if the bridge creates one. FedPro automatically zips any `file:` FOM over
1 KB, so the 1.4 MB merged module is fine over the wire.

| File | Role |
|---|---|
| `NETN-Merged-With-RPR.xml` | **The current target model** — the whole NETN FOM merged with RPR-FOM v2.0, exported in HLA Evolved format, which is what CSE-Prep runs |
| `NETN-BASE.xml` | Base datatypes and inherited interaction parameters (`UniqueId`, `SendTime`, `GeodeticPoint`) |
| `NETN-ENTITY.xml` | Entity object classes |
| `NETN-MIM.xml` | The NETN MIM. **Significant**: `UniqueId` is declared only here, and 1516-2010 accepts a MIM *only* on `createFederationExecution` — so if the federation's creator omits it, this bridge can monitor but can never task |
| `NETN-MRM.xml` | Multi-resolution modelling (aggregate/disaggregate/divide/merge) |
| `NETN-CBRN.xml` | CBRN modelling |
| `SWORD_FOM.xml` | The v2-era MASA SWORD model. Retained for federations SWORD creates; **no longer the loaded/subscribed default** |

#### 5.3.2 Module B's Python container — `hla-bridge-streamer/`

| File | What / why |
|---|---|
| `streamer.py` | Entry point. Starts `tracks.py` and `commands.py` in **separate daemon threads**, so a slow bridge call on the command path never stalls situational-awareness publishing. Handles SIGTERM so an in-flight publish can finish (the image uses exec-form `CMD` so the signal reaches Python, not a shell). Logs a summary line every `TRACK_STATUS_LOG_SECONDS` (60 s) plus a full snapshot on shutdown — counters rather than per-publish lines, because at 1 Hz that would be 86,400 lines a day |
| `tracks.py` | Polls `GET /entities` at ~1 Hz and publishes one row per entity per tick to the track stream. Resolves the output stream from `RESOURCE_ALIAS_MAP` + `TRACK_STREAM_ALIAS`, authenticates with the mounted `BUILD2_TOKEN`, and loads `DEFAULT_CA_PATH` **in addition to** the system trust store. Tries three publish endpoints in order (API gateway `highScale` → gateway without `highScale` → stream-proxy) and switches the record envelope shape once if rejected, recording where it ended up. Coerces every value to the stream's column type, because `publishRecords` validates each record and rejects the **whole batch** if one is invalid |
| `commands.py` | Command stream consumer. Polls the command stream, executes each command against the local bridge REST API, and publishes the outcome to the command log stream. Enforces **TTL-based replay safety** as the primary defence with a bounded LRU of seen command ids as secondary, tracks terminal stages (`SENT`, `REFUSED`, `FAILED`, `EXPIRED`, `DUPLICATE`), primes itself from the outcome stream at startup, and polls the bridge for acknowledgements so `sent` / `acknowledged` / `unacknowledged` are counted separately |
| `local_test_tracks.py` | Offline harness — runs the publisher against a stub impersonating both the bridge and Foundry. Modes: `pipeline` (alias map + mounted token), `functions` (OAuth client credentials), `fallback` (endpoint 404 + envelope rejection). Not copied into the image |
| `Dockerfile`, `requirements.txt` | Image build |

**Track record design decisions worth knowing:**

* `track_point_id` is deterministic (`unique_id@epoch_millis`), so the stream can back an object type
  primary key directly and a retried publish **overwrites rather than duplicating** a track point.
* It is keyed on the NETN `UniqueId`, not the HLA instance handle — the handle only survives one
  federation execution, so a restart would otherwise begin a new track for the same aircraft.
* Two timestamps are kept: `observed_at` (when the publisher looked) and `bridge_last_updated` (when
  the value last actually changed), because a ~1 Hz publisher polling a ~1 Hz source will alias and
  read the same sample twice. Downstream deduplicates on the second.
* Absent values are published as **null, never zero** — an entity at latitude 0.0 and an entity with
  no position are different facts. Only `track_point_id` and `observed_at` are always present, so
  every other column should be nullable in the schema.

#### 5.3.3 Module A's Python container — `hla-command-poster/`

`app.py` is the **command gateway**. It validates each request, ensures a stream exists on the
configured branch, and publishes the command as a record. It never contacts the RTI.

Registered Foundry functions (24), each publishing one command record:

| Group | Functions |
|---|---|
| Movement | `hla_move_to_location`, `hla_patrol`, `hla_magic_move`, `hla_stop_entity` |
| Kinematics | `hla_set_heading`, `hla_set_speed`, `hla_set_altitude` |
| Fires & ROE | `hla_fire_at_location`, `hla_fire_at_entity`, `hla_set_roe` |
| Task management | `hla_cancel_tasks` |
| Logistics | `hla_inject_supplies` |
| Aggregation (MRM) | `hla_aggregate`, `hla_disaggregate` |
| Environment | `hla_create_obstacle`, `hla_disrupt_comms` |
| Simulation control | `hla_sim_start`, `hla_sim_pause`, `hla_sim_stop` |
| Connection control | `hla_connect`, `hla_disconnect`, `hla_reconnect` |
| Group tasking | `hla_plan_group_task`, `hla_execute_group_task` |

Design points:

* **Group tasking** reads current entity state from the **track stream** (not the bridge), so it works
  from Module A without an HLA connection. A selector matching more than `MAX_GROUP_SIZE` (50) entities
  is **refused rather than truncated** — silently tasking a subset is worse than refusing, because the
  caller believes the whole group was ordered. `plan` and `execute` are separate functions so a group
  order can be reviewed before it is issued.
* **Two TTLs**: `COMMAND_TTL_SECONDS` (120 s) for normal commands and `CONTROL_TTL_SECONDS` (15 s) for
  connection control, so a replayed `DISCONNECT` cannot resign the federate every time the consumer
  container restarts.
* The command stream schema is asserted in code and must match the streaming dataset's schema.
* `partition_key` is the entity UUID (or the target kind for entity-less commands), so commands for one
  entity stay ordered.

#### 5.3.4 Bridge configuration reference

Every `bridge.*` property in `application.properties` is overridable by environment variable.

| Env var | Default | What / why |
|---|---|---|
| `CSE_ENVIRONMENT` | `1` | Single digit identifying the CSE-Prep environment. FedPro and CRC addresses are derived from it via a fixed port pattern, so switching environments is a one-value change |
| `FEDPRO_ADDRESS` | derived | Explicit override; always wins. **This is the address that matters for connectivity** |
| `CRC_ADDRESS` | derived | Explicit CRC candidates, tried before the derived ones. Not a connection target — see the three-address model in the overview |
| `FEDPRO_PROTOCOL` | `tcp` | `tcp` or `tls` (changes the derived port) |
| `FEDPRO_SNI_HOSTNAME` | *(blank)* | SNI hostname for a TLS handshake; blank sends none |
| `LRC_ADVERTISED_ADDRESS` | *(blank)* | The address this LRC advertises for callbacks; set only when the derived one is unreachable from the CRC's side |
| `FEDPRO_CONNECT_TIMEOUT_SECONDS` | `10` | Transport establishment timeout |
| `FEDERATION_NAME` | `CSE-Prep` | Federation execution to create/join |
| `FEDERATE_NAME` | `CSE-HLA-Bridge` | Federate identity; a suffix is appended automatically on collision |
| `FOM_PATH` | `/app/foms` | Directory of FOM modules to load and contribute |
| `MIM_PATH` | *(blank)* | NETN MIM, used only if this bridge creates the federation. Blank means the RTI's standard MIM, which has **no `UniqueId`** — and therefore no tasking |
| `BRIDGE_CREATE_FEDERATION` | `false` | Deliberately off. Creating an execution when the simulators are absent yields `connected: true` with nothing discovered — indistinguishable from a subscription bug |
| `BRIDGE_AUTO_CONNECT` | `true` | Connect at startup, or idle until `/reconnect` |
| `BRIDGE_MODE` | `full` | `monitor` subscribes and reports only; it publishes and tasks nothing. **Note: it does not change object-class subscriptions**, so mode never explains a difference in entities discovered |
| `BRIDGE_RETRY_ATTEMPTS` / `BRIDGE_RETRY_DELAY_SECONDS` | `60` / `10` | ≈10 minutes of connect retries. Waiting for an **absent federation** does not consume this budget |
| `BRIDGE_SUBSCRIBE_BASE_ENTITY` | `false` | Leave off: on this RTI, subscribing the `BaseEntity` catch-all causes every object to be discovered at `BaseEntity` and limited to its eight attributes. A deliberate diagnostic switch only |
| `BRIDGE_ATTRIBUTE_REFRESH_SECONDS` | `5` | Periodic re-request of current values for incompletely reported instances; `0` disables |
| `BRIDGE_ATTRIBUTE_REFRESH_MAX_REQUESTS` | `20` | Cap per cycle, to avoid saturating the LRC's outbound queue |
| `BRIDGE_TIME_MANAGEMENT` | `false` | Off: the bridge is a passive observer plus an out-of-band tasking channel and never requests a time advance. Enabling it without a real advance loop would stall every time-constrained federate. (`simTime: 0.0` is therefore normal and means nothing) |
| `BRIDGE_TASK_DIALECT` | `auto` | `auto` or `v4`. A forced dialect the FOM does not define **disables tasking** rather than sending classes nothing can receive |
| `TASKER_UUID` | *(blank)* | v4 `Tasker`. Blank omits it, which the FOM defines as "commander undefined" — honest, unlike a fabricated UUID claiming an entity that does not exist |
| `TASKER_CALLSIGN` | `CSE-Bridge` | v2-era `Tasker` (a callsign string) |
| `MRM_FEDERATE` | *(blank)* | Default federate for v2 MRM aggregate/disaggregate |
| `BRIDGE_DIS_SITE_ID` / `BRIDGE_DIS_APPLICATION_ID` | `1` / `1` | DIS identity used for RPR simulation-management interactions |
| `PORT_PROBE_ENABLED` | `true` | Startup connectivity probe; never affects connection behaviour |

Streamer-side variables: `TRACK_STREAM_ALIAS`, `FOUNDRY_URL`, `TRACK_POLL_SECONDS`,
`COMMAND_STREAM_ALIAS`, `COMMAND_LOG_ALIAS`, `COMMAND_POLL_SECONDS`,
`COMMAND_BRIDGE_TIMEOUT_SECONDS`, `TRACK_STATUS_LOG_SECONDS`, plus escape hatches
(`TRACK_STREAM_DATASET_RID`, `TRACK_PUBLISH_URL`, `TRACK_STREAM_BRANCH`, …). `BUILD2_TOKEN`,
`RESOURCE_ALIAS_MAP` and `DEFAULT_CA_PATH` are set by the platform in pipeline mode.

> **`TRACK_STREAM_DATASET_RID` must not be set on Module A.** If it is, both modules publish the same
> tracks and every tick is duplicated.

#### 5.3.5 Bridge REST API — `/api/v1/bridge`

The Python containers are thin clients over this surface; it is bound to localhost and is not
reachable from Foundry directly.

| Group | Endpoints |
|---|---|
| Health & state | `GET /health`, `GET /status` |
| Entities | `GET /entities`, `GET /entities/{id}`, `GET /entities/simulator/{simulator}`, `GET /entities/area` |
| Simulation control | `POST /start`, `POST /pause`, `POST /stop` |
| Connection control | `POST /disconnect`, `POST /reconnect` |
| Tasking | `POST /entities/{id}/` + `move`, `patrol`, `magic-move`, `fire-at-location`, `fire-at-entity`, `roe`, `heading`, `speed`, `altitude`, `stop`, `cancel-tasks`, `inject-supplies`, `aggregate`, `disaggregate` |
| Environment | `POST /map/obstacle`, `POST /map/disrupt-comms` |
| Diagnostics | `GET /diagnostics`, `/diagnostics/fom`, `/diagnostics/objects`, `/diagnostics/federates`, `POST /diagnostics/refresh-federates`, `/diagnostics/tasks`, `/diagnostics/interactions`, `/diagnostics/dis-sources`, `/diagnostics/preview/move-task`, `GET /entities/{id}/diagnostics` |

**HTTP status semantics** (identical whichever dialect is live):

| Code | Meaning |
|---|---|
| `200` | The interaction was sent. **Not** an acknowledgement that anything acted on it |
| `400` | Bad request, including one the live dialect cannot express faithfully |
| `404` | Entity unknown to this bridge and the id is not a UUID |
| `409` | This federation cannot do that — the class is absent from the loaded FOM, no dialect was detected, or the live dialect has no equivalent. The message says which |
| `503` | RTI / FedPro problem |

#### 5.3.6 Diagnostics — the functions that make the bridge explain itself

Exposed both as REST endpoints and as Foundry functions. These exist because every hard problem on
this bridge was otherwise diagnosable only by reading pod logs and guessing.

| Function | Answers |
|---|---|
| `bridge_explain` | Plain-text findings ordered most-serious-first, with a `HEALTHY` / `DEGRADED` / `BROKEN` verdict. Suitable for a Workshop text widget or an AIP agent. **Start here** |
| `bridge_get_diagnostics` | The same assessment as JSON |
| `bridge_get_status` | Including `federateName` (the name actually joined under), `crcCandidate` (which CRC answered), `federateCount` (from the RTI's MOM), `federationCreatedByUs`, and `taskDialect` |
| `bridge_get_fom` | Which interaction classes this federation defines, by dialect and module, and which class each REST operation would send. Replaces guessing from a FOM file that may not be the one the RTI loaded |
| `bridge_get_federates` | Who else is joined, from the RTI's own MOM accounting: name, host, FOM modules, objects registered, updates sent. **This is the call that separates the three causes of "0 entities"** |
| `bridge_refresh_federates` | Re-asks the RTI — the automatic request happens only once at connect, so a simulator started later is otherwise invisible |
| `bridge_get_task_history` | The last 50 tasks sent, with the FOM class each went out as and any acknowledgement received |
| `bridge_get_interaction_traffic` | Which interaction classes have actually arrived, how many, and when |
| `bridge_diagnose_entity` | Whether one specific entity can be tasked and what is stopping it, using its own `SupportedActions` |
| `bridge_preview_move_task` | Exactly what a move would put on the wire — field values, datatypes and hex — **without sending it**. The artefact for settling an encoding disagreement with a peer federate |

**The "0 entities" decision table** (read `objectsRegistered` across *all* federates):

| What you see | What it means | Where next |
|---|---|---|
| Only this bridge is listed | Wrong federation, or one we created. Not a subscription problem | Compare `crcCandidate` and `FEDERATION_NAME` against a bridge that does see entities |
| A simulator with `objectsRegistered > 0`, us empty | A subscription gap **on our side** | `bridge_get_fom`, and the subscription block in the startup log |
| Every federate at `objectsRegistered: 0` | **Nothing is publishing.** Our zero is the correct answer | The simulator — is a scenario loaded and running? |
| No federate records at all | The RTI has not reported yet — not an empty federation | `bridge_refresh_federates`, then read again |

Two things that are **not** the cause, both of which have cost time: `BRIDGE_MODE` (monitor and full
subscribe to identical object classes) and `simTime: 0.0` (time management is off by design).

### 5.4 Sources

| Source | RID | What / why |
|---|---|---|
| `[NXG] HLA Pitch` | `ri.magritte..source.fdca4e4f-90b3-4a7e-ac0b-a327703f39a3` | REST source declaring the FedPro server host/port and carrying the **network egress policies** that let the compute module reach it. Currently `HTTPS 4.223.210.7:30121` with two egress policies. Note this is a *policy/egress* declaration — the bridge dials FedPro itself from `FEDPRO_ADDRESS`, which is derived from `CSE_ENVIRONMENT` on a firewall host; keep the two in step when changing environments |
| `gRPC` | `ri.magritte..source.674a5d62-8fbf-4e0e-b84f-cca46529f5f2` | gRPC source used by the `cse_*` CSE-Prep functions. Reaches the same firewall host as FedPro but on a different port and protocol — the gRPC management API and the FedPro RTI protocol are separate services |
| `[NXG] Foundry Connection` | `ri.magritte..source.ead4678d-e1c3-41e2-a60a-de53c1500765` | **The egress grant that makes the streams work.** Compute modules have no external network access by default, including to Foundry itself; this source's network policy for the Foundry enrollment URL (`:443`) is what allows `tracks.py` and `commands.py` to publish. Must be in the same project, have compute-module import enabled, and have an API name. Attach it only while the module is stopped — policy edits need a full restart |
| `[NXG] MACE MCP` / `[NXG] MACE MCP Server` | `3648bc06-…` / `e8997c8e-…` | MCP integration with the MACE simulation environment |

> **Common failure:** a compute module logging `ConnectError: [Errno -2] Name or service not known`
> while fetching a token is an **egress** problem, not an authentication one — the source is missing,
> not importable into compute modules, pointed at the wrong address, or was attached/edited without a
> full module restart. Note that a CSE-shaped policy (e.g. one naming the simulation firewall IP) does
> not grant access to the Foundry enrollment URL; that is an easy one to copy by mistake.

---

## 6. AI Agents

`CSP/6. AI Agents` — `ri.compass.main.folder.8e2bb16d-267b-459a-85fb-3549ead14fc4`

| Resource | RID | What / why |
|---|---|---|
| `[NXG] Operations Chatbot` | `ri.aip-agents..agent.2ec32cc8-58c9-46ab-88e3-a61f4830d778` | Conversational access to the exercise — surfaced as the "AI Assistant" tab in the Plan & Prepare Workshop |
| `Agents Repo` | `ri.stemma.main.repository.393ed61c-4094-4b93-8a96-d9284ec3b558` | Supporting agent tooling and functions |
| `[NXG] Operations Chatbot — Agent Configuration` | `ri.notepad.main.notepad.fedba06f-07a2-48cf-99a6-013ef4d3f91c` | Documented agent prompt, tools and retrieval configuration |

---

## 7. PMESII sub-project

`PMESII/` — `ri.compass.main.folder.67c0f709-e54e-4ebe-996b-ce410c91dc4d`

Models the **political and social operating environment** around the exercise, as opposed to the
exercise itself. Built around a Schelling-style bargaining model: actors positioned on a policy
spectrum with weighted influence and salience, from which coalition outcomes and blocking
coalitions can be predicted.

| Resource | RID | What / why |
|---|---|---|
| `[NXG-PM] PMESII Stakeholder` | `ri.ontology.main.object-type.50305ef9-c0ec-431c-98aa-a1c7da9d8454` | An actor (nation, organisation, individual) with `position` (0–100 policy spectrum), `salience`, `stakeholderInfluence`, `groupName`, `groupInfluence`, `vetoPlayer` and textual `evidence` |
| `pmesii_stakeholders` | `ri.foundry.main.dataset.0e3c035e-f374-4d6b-b7e3-17eee48d1f4d` | Backing dataset for the object type |
| `pmesii_stakeholders_clean` | `ri.foundry.main.dataset.891b65de-94dc-4a88-b3fc-3d14871ac019` | Cleaned/normalised variant |
| `[NXG] PMESII MCP Server` | `ri.magritte..source.51ab2714-3d21-4508-97b4-e4f5cb76691c` | Source for the external SchellingIQ MCP server that runs the bargaining model |
| `REST API - PMESII MCP` | `ri.magritte..source.7945c583-7dce-4f93-9103-8a5d87e868bb` | REST variant of the same integration |
| `NXG PMESII MCP Functions` | `ri.stemma.main.repository.513d5877-ef4c-4a97-8929-94de3e72363a` | Foundry functions wrapping the MCP tools |
| `TypeScript_SchellingIQ` | `ri.stemma.main.repository.ed3bc837-619c-4a37-8d07-e924f4a7a428` | TypeScript implementation/client for the SchellingIQ model |
| `PMESII Analysis Agent` | `ri.eddie.main.logic.64989165-aad7-4b99-a0c3-2cc020f45a21` | AIP Logic performing PMESII analysis |
| `PMESII Stakeholder Discovery Agent` | `ri.aip-agents..agent.15cab791-d6fc-4ce1-bb79-66b5942461e5` | Discovers and populates stakeholders from source material |
| `SchellingIQ_Agent` | `ri.aip-agents..agent.f07dfb82-5bcf-41ab-bd10-656be3cc45e7` | Conversational interface to the bargaining model |
| `[NXG] PMESII Workshop` | `ri.workshop.main.module.da53844d-a252-4736-8575-96c7a55fc647` | Standalone PMESII Workshop module |
| `[NXG} PMESII Frontend` | `ri.third-party-applications.main.application.99104577-3f15-4225-ab34-f226e0b842d1` | The deployed PMESII OSDK app — embedded as page 2 of the Plan & Prepare Workshop |
| `[NXG] PMESII Frontend Code Workspace` | `ri.stemma.main.repository.b311cad8-883a-4b52-9250-05e29873ef1f` | Source for the frontend |
| `Schelling_docs` | `ri.mio.main.media-set.2869e045-b235-42f9-ac36-5d6f52e185f9` | Reference material for the model |

> Note the distinction: `PmesiiStakeholder` (this sub-project) is a quantitative actor model,
> whereas `NxgPmesiiDomain` (Plan & Prepare) is a narrative PMESII-PT variable attached to a
> scenario. They are complementary, not duplicates.

---

## 8. Documentation

`CSP/Documentation` — `ri.compass.main.folder.34d61626-d2a2-4309-bcf3-ada7b217a148`

| Document | RID | What / why |
|---|---|---|
| CSP Documentation: Project Structure Guide | `ri.notepad.main.notepad.6dd6b316-4580-4cd8-8671-fb5899a3b469` | Folder-by-folder tour of the project |
| CSP Documentation: Plan & Prepare Flow | `ri.notepad.main.notepad.62de3ce0-5013-48a5-ac61-f5a6121c1924` | Deep dive on the Plan & Prepare data model and workflow |
| CSP Documentation: XML Schema & Ontology Translation | `ri.notepad.main.notepad.c632365d-7d12-4466-b941-2375ccec0f29` | How ontology ORBATs map to simulator XML |
| CSP Documentation: Defence Terminology & Reference Guide | `ri.notepad.main.notepad.10de80fa-752d-4149-aa51-8fd675f8e412` | Glossary (ORBAT, MEL/MIL, PMESII-PT, CAX/CPX/FTX, OPCON/TACON, …) |
| Demo Storyline v2 | `ri.notepad.main.notepad.47ba6191-65ac-4645-8af5-5840396c7b22` | The current demonstration narrative |
| Feature Design: Sub-Phases & Branching | `ri.notepad.main.notepad.aebe8e33-9af1-42f9-9e26-76f0679fb114` | Design of the `basedOnPhaseId` branching model |
| CSP Documentation: Improvement Roadmap | `ri.notepad.main.notepad.8e8f52c5-1a1c-4488-b788-e9752602b749` | Planned enhancements |
| `[NXG] Ontology Overview` | `ri.notepad.main.notepad.92e3d368-1059-4013-9622-bcc072127d51` | Ontology summary |
| Solution design: `Data OS in Detail` | `ri.solution-design.main.diagram.4ab9f506-b6a9-4e7c-9c7f-e4e74b4f1829` | **Target-state architecture** — Master / Metadata / V&V-Template / Run / Results ontologies fed by external sources (Janes, SIPRI, OneArc/MANTLE terrain, weather, GDELT, MoD, World Bank), with OSDK as the sole externalising contract and vendor sidecars handling simulator specifics |
| Solution design: `Simulation Management Flow` | `ri.solution-design.main.diagram.adc76f66-af2e-4a6b-94e4-5201cda97e6f` | Run-management flow |
| `Provided External Documentation` | `ri.mio.main.media-set.8817c414-8e84-4c20-a5c0-c6965bf6be9d` | Customer/vendor reference documents |
| `TNL documentation/` | `ri.compass.main.folder.d783d35d-ab7e-4de9-9855-8e7c20812870` | TNL-specific material |
| `Rolling Docs/` | `ri.compass.main.folder.12402daf-8025-4d6c-b73f-149058266eb0` | Live working notes and the internal task tracker |

> **Caveat on the older notepads.** Several of the earlier documentation notepads contain stale or
> placeholder RIDs and assumptions marked "needs verification" (particularly the resource tables in
> the Project Structure Guide and the module-mapping appendix of the Plan & Prepare Flow). The RIDs
> in *this* document were read directly from the platform.

---

## Appendix A — Seeded demonstration data

| Scenario | ID | Type | Status | Phases |
|---|---|---|---|---|
| Exercise IRON FORGE 26 | `scenario_iron_forge_26` | CAX | active / prepare | Advance to Contact → Deliberate Attack → Consolidation and Sustainment → Information Operations and Transition (D+0 … D+14) |
| Exercise NEXGEN 26 | `scenario_nexgen_2026` | CAX | active / prepare | Reception and Forward Deployment → Defensive Operations → Counter-Attack → Stabilisation and Transition (H+0 … H+42) |
| Operation BALTIC SHIELD | `scenario_operation_baltic_shield` | CAX | active / execute | Secure the Reinforcement Corridor → Protect Critical Infrastructure → Degrade Long-Range Strike → Sustain and Transition (D+0 … D+14) |

## Appendix B — Where to make common changes

| Task | Where |
|---|---|
| Add a new simulator | New catalogue in `consolidated/`, matched to `CanonicalAsset` by the Canon↔Sim repo; new object type + link; a Translator generator + XSD; a bridge dialect if it is HLA |
| Add a scenario/phase field | Backing dataset column → object type property → Action parameter → widget/OSDK hook |
| Change AI phase generation behaviour | The three AIP Logic functions in §4.1, and `logicClient.ts` / `phaseMapStateService.ts` in the Mapplications repo |
| Change movement or attrition rules | `resolveOrders.ts`, `orderReachability.ts`, `tiledRouter.ts` in the Mapplications repo (deterministic — not the LLM) |
| Add a UI tab | New widget in the Plan & Prepare widget repo → publish widget set → add tab + sidebar entry in the Workshop module |
| Add a live simulator command | A request DTO + endpoint in `BridgeServer`, an encoder in the live dialect (`SmcV4Dialect`) with a `HlaEncoderTest` vector, an `hla_*` function in `hla-command-poster/app.py`, a handler in `commands.py`, then the command panel in `/hlamap` |
| Move to a different CSE-Prep environment | Set `CSE_ENVIRONMENT` on the compute module (addresses derive from it); update the `[NXG] HLA Pitch` source host/port and egress policy to match |
| Debug "the task returned 200 but nothing moved" | `bridge_explain` → `bridge_get_task_history` → `bridge_diagnose_entity` → `bridge_get_federates`. If all clean, the owning federate does not subscribe to that task class — try MagicMove as the sharpest test |
| Debug "0 entities" | `bridge_get_federates` and the decision table in §5.3.6. Check the FOM generation before suspecting the publisher |
| Change the track stream schema | The stream dataset schema, the coercion map in `tracks.py`, then any downstream object type. Keep everything except `track_point_id` and `observed_at` nullable |
