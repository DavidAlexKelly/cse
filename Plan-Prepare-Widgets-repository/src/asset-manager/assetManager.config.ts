import { defineConfig } from "@osdk/widget.client";

// Any updates to the widget configuration in this file such as new parameters
// and events will not be reflected in dev mode. Publish a new version of the
// widget set to start developing against configuration changes.

export default defineConfig({
  id: "assetManager",
  name: "Asset Manager",
  description:
    "Ontology inventory tool — browse canonical assets, VBS4 catalogue, unit types and equipment types; cross-reference mappings and surface data quality mismatches before exercise planning.",
  type: "workshop",
  parameters: {},
  events: {},
});
