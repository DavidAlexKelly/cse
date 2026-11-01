import { defineConfig } from "@osdk/widget.client";

// Any updates to the widget configuration in this file such as new parameters
// and events will not be reflected in dev mode. Publish a new version of the
// widget set to start developing against configuration changes.

export default defineConfig({
  id: "customHeader",
  name: "Custom Header",
  description: "A standalone, fully-customisable header widget matching the military dark theme",
  type: "workshop",
  parameters: {
    // ── Title / branding ────────────────────────────────────────────────────
    title: {
      displayName: "Title",
      type: "string",
    },
    subtitle: {
      displayName: "Subtitle",
      type: "string",
    },
    iconName: {
      displayName: "Icon Name (BlueprintJS icon, e.g. 'shield')",
      type: "string",
    },

    // ── Buttons ─────────────────────────────────────────────────────────────
    // Parallel arrays — index i of each corresponds to the same button.
    buttonLabels: {
      displayName: "Button Labels",
      type: "array",
      subType: "string",
    },
    buttonVariants: {
      displayName: "Button Variants (default | primary | danger | ghost — one per button)",
      type: "array",
      subType: "string",
    },
    buttonIcons: {
      displayName: "Button Icons (BlueprintJS icon name per button, empty string for none)",
      type: "array",
      subType: "string",
    },

    // ── Output ───────────────────────────────────────────────────────────────
    clickedButton: {
      displayName: "Clicked Button Label",
      type: "string",
    },

    // ── Styling ──────────────────────────────────────────────────────────────
    backgroundColor: {
      displayName: "Background Colour (hex, overrides default #0e1120)",
      type: "string",
    },
    accentColor: {
      displayName: "Accent / Icon Colour (hex, overrides default military green)",
      type: "string",
    },
    showBorderBottom: {
      displayName: "Show Border Bottom",
      type: "boolean",
    },
  },
  events: {
    buttonClicked: {
      displayName: "Button Clicked",
      parameterUpdateIds: ["clickedButton"],
    },
  },
});
