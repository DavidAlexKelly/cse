import { defineConfig } from "@osdk/widget.client";

// Any updates to the widget configuration in this file such as new parameters
// and events will not be reflected in dev mode. Publish a new version of the
// widget set to start developing against configuration changes.

export default defineConfig({
  id: "customSidebar",
  name: "Custom Sidebar",
  description: "A fully-customisable navigation sidebar matching the military dark theme",
  type: "workshop",
  parameters: {
    // ── Nav items ────────────────────────────────────────────────────────────
    // Parallel arrays — index i of each array describes the same nav item.
    itemLabels: {
      displayName: "Item Labels",
      type: "array",
      subType: "string",
    },
    itemIcons: {
      displayName: "Item Icons (BlueprintJS icon name per item, e.g. 'shield')",
      type: "array",
      subType: "string",
    },
    itemBadges: {
      displayName: "Item Badges (short text per item, empty string for none)",
      type: "array",
      subType: "string",
    },
    itemBadgeIntents: {
      displayName: "Item Badge Intents (green | amber | red | blue | grey per item)",
      type: "array",
      subType: "string",
    },
    // Set to true at index i to render a divider AFTER that item
    sectionAfterItems: {
      displayName: "Section Divider After Item (true/false per item)",
      type: "array",
      subType: "boolean",
    },

    // ── Selection state ──────────────────────────────────────────────────────
    // Two-way: Workshop can pre-select an item; widget updates it on click.
    selectedItem: {
      displayName: "Selected Item Label",
      type: "string",
    },

    // ── Header branding ──────────────────────────────────────────────────────
    sidebarTitle: {
      displayName: "Sidebar Title",
      type: "string",
    },
    sidebarIcon: {
      displayName: "Sidebar Icon (BlueprintJS icon name)",
      type: "string",
    },

    // ── Collapse state ───────────────────────────────────────────────────────
    // Two-way: Workshop can collapse/expand; widget toggle updates it.
    collapsed: {
      displayName: "Collapsed (icon-only rail)",
      type: "boolean",
    },
    showCollapseToggle: {
      displayName: "Show Collapse Toggle",
      type: "boolean",
    },

    // ── Styling ──────────────────────────────────────────────────────────────
    backgroundColor: {
      displayName: "Background Colour (hex, overrides default)",
      type: "string",
    },
    accentColor: {
      displayName: "Accent / Active Colour (hex, overrides military green)",
      type: "string",
    },
    showBorderRight: {
      displayName: "Show Right Border",
      type: "boolean",
    },
    expandedWidth: {
      displayName: "Expanded Width (px, default 200)",
      type: "number",
    },
    collapsedWidth: {
      displayName: "Collapsed Width (px, default 48)",
      type: "number",
    },
  },
  events: {
    itemSelected: {
      displayName: "Item Selected",
      parameterUpdateIds: ["selectedItem"],
    },
    collapseToggled: {
      displayName: "Collapse Toggled",
      parameterUpdateIds: ["collapsed"],
    },
  },
});
