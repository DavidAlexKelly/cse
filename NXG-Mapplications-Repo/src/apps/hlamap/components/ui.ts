// ── hlamap/components/ui.ts ────────────────────────────────────────────────
// Re-export of the shared HLA console palette. Kept as a module so the rest of
// hlamap can go on importing `{ UI } from "./ui"`, but the tokens themselves
// live in shared/hla/ui so the live map and the analysis replay cannot drift.

export { MAP, UI, forceColor, tint } from "@/shared/hla/ui";
