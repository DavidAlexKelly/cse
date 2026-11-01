// src/shared/orbat/assetEligibility.ts
//
// Which assets may be put into an ORBAT.
//
// A unit is only useful if a simulator can actually spawn it. The ontology
// models that as: NxgUnit —simulatorIdentifierCode→ a catalogue row (VBS4 /
// SWORD / SIMWORKS), and NxgUnit —dis6Code→ the canonical asset those rows
// share. Until this module existed the app let a planner pick any of the 1,602
// canonical assets, including the 74 that no simulator can represent, and the
// failure only surfaced at export time as an unresolvable ORBAT.
//
// The rule
// --------
// A node needs an asset when it is placeable (it IS a thing in the world —
// see isPlaceableUnit). For such a node, for every simulator the ORBAT is
// targeted at that can model that kind of thing, the canonical asset must have
// at least one catalogue entry, and a specific entry must have been chosen.
//
// Targets vs catalogues
// ---------------------
// The two catalogues carve the world up differently, and the split is real
// rather than a data gap:
//
//   organisation            → SWORD automats (SWORD models formations)
//   vehicle/human/aircraft  → VBS4 and SIMWORKS (they model platforms)
//
// Today NO canonical asset has both a SWORD entry and a VBS4/SIMWORKS one, so
// a rule of "must exist in every simulator" would make every asset ineligible.
// Instead we intersect the ORBAT's target simulators with the catalogues that
// can model the node's entity type. An empty intersection means the node is
// exempt — e.g. an HQ organisation inside a VBS4-only ORBAT needs no asset,
// because in VBS4 the structure is carried by the ORBAT tree itself, not by a
// spawned entity. That is deliberate: it keeps doctrine-generated skeletons
// legal while still blocking a vehicle with no model behind it.

import { isPlaceableUnit } from "../lib/compositionPlan";
import { findDoubleCountedDescendants } from "./representation";
import {
  NO_AVAILABILITY,
  SIM_TARGET_LABELS,
  type AssetAvailability,
  type CompositionNode,
  type OCanonicalAsset,
  type OSimAsset,
  type SimTarget,
  type ValidationIssue,
} from "../types/index";

/** Catalogue lookup: canonical asset primary key → asset. */
export type AssetIndex = ReadonlyMap<string, OCanonicalAsset>;

/**
 * Normalise an owningSimulator value to a SimTarget.
 *
 * The ontology holds "Vbs4", "simworks", "Simworks" and "none" today — 334
 * units across four spellings of three simulators — so every comparison has to
 * go through here rather than matching strings at the call site.
 * Returns null for "none"/empty: a unit that is not federated to any simulator.
 */
export function normaliseSimTarget(raw: string | null | undefined): SimTarget | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value || value === "none") return null;
  if (value === "vbs4" || value === "vbs" || value === "vbs3") return "vbs4";
  if (value === "sword") return "sword";
  if (value === "simworks" || value === "sim works") return "simworks";
  return null;
}

/** The catalogues that can model a given entity type. */
export function requiredCatalogues(entityType: CompositionNode["entityType"]): SimTarget[] {
  return entityType === "organisation" ? ["sword"] : ["vbs4", "simworks"];
}

/**
 * The simulators a planner may choose an asset from, given what the node IS.
 *
 * Same mapping as requiredCatalogues, named for the direction the UI works in:
 * what a unit is (an organisation, a vehicle) decides which catalogues can
 * model it, and therefore which simulator can spawn it. The planner picks the
 * thing; the simulator follows.
 *
 * This reads the opposite way round from how the pickers first worked — choose
 * a simulator, then see its assets — which asked a planner to know something
 * about the federation before they could say what they wanted, and allowed
 * combinations that cannot exist (a SWORD vehicle, a VBS4 rifle company).
 */
export function candidateSimulators(entityType: CompositionNode["entityType"]): SimTarget[] {
  return requiredCatalogues(entityType);
}

/**
 * True when at least ONE candidate simulator can instantiate this asset.
 *
 * Deliberately distinct from isAssetAvailableFor, which requires EVERY target.
 * Both are needed and they are not interchangeable:
 *
 *   selecting  — "can anything spawn this?"   (some)  → what to offer
 *   validating — "can this ORBAT run in X?"   (every) → what to block
 *
 * Using `every` while selecting would offer nothing at all for a vehicle: it
 * would demand an asset present in BOTH VBS4 and SIMWORKS, true of only 48 of
 * the 1,602 assets.
 */
export function isAssetAvailableForAny(
  asset: OCanonicalAsset | undefined,
  targets: readonly SimTarget[],
): boolean {
  if (!asset) return false;
  if (!targets.length) return true;
  const availability = availabilityOf(asset);
  return targets.some((t) => (availability[t] ?? 0) > 0);
}

/**
 * Which simulator owns a unit, given the catalogue entry chosen for it.
 *
 * owningSimulator is derived, not chosen: a model carries its own provenance,
 * so a planner who picked "VBS4 · M109A6" has already said everything needed.
 * This is what makes the 48 dual-catalogue assets unambiguous — the asset
 * alone does not say which federation will spawn it, the model always does.
 */
export function simulatorForModel(model: Pick<OSimAsset, "simulator">): SimTarget {
  return model.simulator;
}

/**
 * Must this node carry an asset before it can be added?
 *
 * Entity units must: a vehicle with no model is not in the exercise.
 *
 * Organisations must not be forced. Only 62 SWORD automat types exist against
 * 136 organisation asset types, and in a VBS4 or SIMWORKS ORBAT a formation is
 * carried by the tree itself rather than by a spawned entity. So SWORD automats
 * are offered for organisations and never required.
 */
export function assetRequiredForEntityType(entityType: CompositionNode["entityType"]): boolean {
  return entityType !== "organisation";
}

/**
 * Assets a planner may choose for a node, by what the node is.
 *
 * The property-led counterpart to filterSelectableAssets: no owningSimulator is
 * supplied because none has been chosen yet — that is the point. An asset
 * qualifies when any catalogue that can model this entity type carries it.
 */
export function selectableAssetsForEntityType(
  assets: Iterable<OCanonicalAsset>,
  entityType: CompositionNode["entityType"],
): OCanonicalAsset[] {
  const targets = candidateSimulators(entityType);
  const out: OCanonicalAsset[] = [];
  for (const asset of assets) {
    if (isAssetAvailableForAny(asset, targets)) out.push(asset);
  }
  return out.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
}

/**
 * The distinct values of one catalogue field across a set of assets.
 *
 * Feeds the cascading property filters (category, then subcategory, then
 * nationality). Derived from the assets actually on offer rather than from a
 * fixed list, so a filter never offers a value that would empty the list, and
 * new catalogue data shows up without a code change.
 */
export function facetValues(
  assets: readonly OCanonicalAsset[],
  field: "assetCategory" | "subcategory" | "nationality" | "militaryDomain",
): string[] {
  const values = new Set<string>();
  for (const asset of assets) {
    const value = (asset[field] ?? "").trim();
    if (value) values.add(value);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

/**
 * The simulators an ORBAT is being built for.
 *
 * `exerciseTargets` (from the Operation, once it carries them) wins when given;
 * otherwise the node's own owningSimulator is the target. An unfederated node
 * yields an empty list and is therefore exempt from the check.
 */
export function resolveTargets(
  node: Pick<CompositionNode, "owningSimulator">,
  exerciseTargets?: readonly SimTarget[],
): SimTarget[] {
  if (exerciseTargets && exerciseTargets.length) return [...exerciseTargets];
  const own = normaliseSimTarget(node.owningSimulator);
  return own ? [own] : [];
}

/**
 * The simulators that must be able to instantiate this node.
 *
 * Empty means "no asset needed" — either the node is structural, it is not
 * federated, or none of the target simulators models this kind of entity.
 */
export function effectiveTargets(
  node: Pick<CompositionNode, "owningSimulator" | "entityType">,
  exerciseTargets?: readonly SimTarget[],
): SimTarget[] {
  const wanted = resolveTargets(node, exerciseTargets);
  const catalogues = requiredCatalogues(node.entityType);
  return wanted.filter((t) => catalogues.includes(t));
}

/**
 * True when this node must carry a simulator asset before it can be added.
 *
 * Mirrors the placement rule: things that get a map symbol are things that
 * exist in the simulation and therefore need a model behind them. Crew inside
 * a vehicle move with the vehicle and are not spawned separately.
 */
export function needsSimulatorAsset(
  node: CompositionNode,
  parentEntityType?: CompositionNode["entityType"],
  exerciseTargets?: readonly SimTarget[],
): boolean {
  if (!isPlaceableUnit(node, parentEntityType)) return false;
  return effectiveTargets(node, exerciseTargets).length > 0;
}

export function availabilityOf(asset: OCanonicalAsset | undefined): AssetAvailability {
  return asset?.availability ?? NO_AVAILABILITY;
}

/** True when this canonical asset can be instantiated by every one of `targets`. */
export function isAssetAvailableFor(
  asset: OCanonicalAsset | undefined,
  targets: readonly SimTarget[],
): boolean {
  if (!asset) return false;
  if (!targets.length) return true;
  const availability = availabilityOf(asset);
  return targets.every((t) => (availability[t] ?? 0) > 0);
}

/**
 * The assets a planner may choose from, for a given entity type and target set.
 *
 * Note there is deliberately NO "if this is empty, show everything" fallback.
 * Both asset pickers used to have one, and it was the single line that let
 * unusable assets into ORBATs: any time the entity-type filter matched nothing
 * the user was quietly handed the unfiltered catalogue.
 */
export function filterSelectableAssets(
  assets: Iterable<OCanonicalAsset>,
  entityType: CompositionNode["entityType"],
  exerciseTargets?: readonly SimTarget[],
  owningSimulator?: string,
): OCanonicalAsset[] {
  const targets = effectiveTargets(
    { entityType, owningSimulator: owningSimulator ?? "" },
    exerciseTargets,
  );
  const out: OCanonicalAsset[] = [];
  for (const asset of assets) {
    if (isAssetAvailableFor(asset, targets)) out.push(asset);
  }
  return out.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
}

function labelFor(targets: readonly SimTarget[]): string {
  return targets.map((t) => SIM_TARGET_LABELS[t]).join(" and ");
}

/**
 * Why this node cannot be instantiated, or null when it is fine.
 *
 * Phrased for display next to the unit — it has to tell a planner what to do,
 * not just that something is wrong.
 */
export function assetIneligibleReason(
  node: CompositionNode,
  assets: AssetIndex,
  parentEntityType?: CompositionNode["entityType"],
  exerciseTargets?: readonly SimTarget[],
): string | null {
  if (!needsSimulatorAsset(node, parentEntityType, exerciseTargets)) return null;

  const targets = effectiveTargets(node, exerciseTargets);
  const who = node.unitIdentifier || "This unit";

  if (!node.canonicalAssetKey) {
    return `${who} has no catalogue asset, so ${labelFor(targets)} cannot spawn it. Pick an asset on the Catalogue tab.`;
  }

  const asset = assets.get(node.canonicalAssetKey);
  if (!asset) {
    return `${who} points at canonical asset "${node.canonicalAssetKey}", which is not in the catalogue. It was probably removed, or came from a template built against older data.`;
  }

  const missing = targets.filter((t) => (availabilityOf(asset)[t] ?? 0) === 0);
  if (missing.length) {
    return `${asset.canonicalName} has no ${labelFor(missing)} entry, so ${who} cannot be spawned there. Choose an asset that ${labelFor(missing)} carries, or retarget the unit.`;
  }

  if (!node.simulatorIdentifierCode) {
    return `${who} is mapped to ${asset.canonicalName} but no specific ${labelFor(targets)} model has been chosen, so the export cannot resolve it.`;
  }

  return null;
}

/** True when the node is complete enough to be written to the ontology. */
export function isNodeEligible(
  node: CompositionNode,
  assets: AssetIndex,
  parentEntityType?: CompositionNode["entityType"],
  exerciseTargets?: readonly SimTarget[],
): boolean {
  return assetIneligibleReason(node, assets, parentEntityType, exerciseTargets) === null;
}

/**
 * Validate a whole composition tree.
 *
 * ERROR   — nothing can spawn this unit (no asset, unknown asset, no entry),
 *           or the unit would be spawned twice (see representation.ts).
 * WARNING — the asset resolves but no specific catalogue row was chosen, so
 *           the export will fall back to whatever the simulator defaults to.
 *
 * Warnings rather than errors for the second case so that pre-existing ORBATs
 * (65 of the 334 units in the ontology today carry no simulatorIdentifierCode)
 * surface in the UI instead of becoming unopenable.
 *
 * Two different kinds of wrong are checked here, and they pull in opposite
 * directions, which is why both are needed:
 *
 *   SIM_ASSET_UNRESOLVABLE  nothing will be spawned for this unit
 *   DOUBLE_COUNTED          this unit will be spawned twice
 *
 * The second is the one nothing caught until now. It is an ERROR rather than
 * a warning because an exercise that silently fields two of every vehicle in
 * a battery is worse than one that fails to open.
 */
export function validateComposition(
  root: CompositionNode,
  assets: AssetIndex,
  exerciseTargets?: readonly SimTarget[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function walk(node: CompositionNode, parentEntityType?: CompositionNode["entityType"]): void {
    const reason = assetIneligibleReason(node, assets, parentEntityType, exerciseTargets);
    if (reason) {
      const unchosen =
        Boolean(node.canonicalAssetKey) &&
        assets.has(node.canonicalAssetKey ?? "") &&
        !node.simulatorIdentifierCode &&
        isAssetAvailableFor(
          assets.get(node.canonicalAssetKey ?? ""),
          effectiveTargets(node, exerciseTargets),
        );

      issues.push({
        unitKey: node.id,
        severity: unchosen ? "WARNING" : "ERROR",
        code: unchosen ? "SIM_ASSET_NOT_CHOSEN" : "SIM_ASSET_UNRESOLVABLE",
        message: reason,
      });
    }
    for (const child of node.children) walk(child, node.entityType);
  }

  walk(root, undefined);

  for (const found of findDoubleCountedDescendants(root)) {
    issues.push({
      unitKey: found.node.id ?? "",
      severity: "ERROR",
      code: "DOUBLE_COUNTED",
      message: found.message,
    });
  }

  return issues;
}

/**
 * Throw if any unit in the tree cannot be instantiated.
 *
 * Called from createCompositionInOntology before anything is written, so a
 * composition is never persisted in a state the simulator export cannot use.
 * Lives here rather than inside planComposition to keep that module free of
 * this one (planComposition supplies isPlaceableUnit to it).
 */
export function assertCompositionEligible(
  root: CompositionNode,
  assets: AssetIndex,
  exerciseTargets?: readonly SimTarget[],
): void {
  const errors = validateComposition(root, assets, exerciseTargets).filter(
    (i) => i.severity === "ERROR",
  );
  if (!errors.length) return;

  const shown = errors.slice(0, 5).map((e) => `  • ${e.message}`).join("\n");
  const more = errors.length > 5 ? `\n  …and ${errors.length - 5} more.` : "";
  // Deliberately not "have no simulator asset" any more: DOUBLE_COUNTED errors
  // are the opposite complaint, and naming only one of the two sends a planner
  // looking for a missing asset that is not missing.
  throw new Error(
    `Cannot write "${root.unitIdentifier || "composition"}": ${errors.length} unit(s) cannot be simulated as written.\n${shown}${more}`,
  );
}
