// ============================================================
// DataSource
//
// Every shared read hook reports where its data came from.
//
// The widgets intentionally keep a rich set of seed records so
// they stay demo-ready when a scenario has no ontology content
// yet. That is useful, but it must never be mistaken for live
// data — so hooks return this flag and the UI can badge it.
//
// "unbound" is distinct from "seed": it means no scenario was
// bound to the widget at all, so there is nothing to show and
// nothing to write to. Widgets render an explicit empty state
// for it rather than quietly loading a default scenario.
// ============================================================

export type DataSource = "ontology" | "seed" | "unbound";

/** True when the data shown is local seed data, not ontology data. */
export function isSeedData(source: DataSource): boolean {
  return source === "seed";
}

/** True when no scenario is bound, so the widget has nothing to show. */
export function isUnbound(source: DataSource): boolean {
  return source === "unbound";
}
