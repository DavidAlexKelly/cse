// ============================================================
//  Asset Manager — OSDK Data Hook
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { client } from "../client.js";
import {
  NxgCanonicalAsset,
  NxgVbs4AssetCatalogue,
  NxgSimworksAssetCatalogue,
  NxgOSwordAssetCatalogue,
  NxgUnitType,
  NxgEquipmentType,
  NxgUnit,
} from "@custom-widget/sdk";
import type {
  CanonicalAsset,
  Vbs4Asset,
  SimworksAsset,
  SwordAsset,
  UnitType,
  EquipmentType,
  UnitRef,
  MismatchRecord,
  InventoryCounts,
  MismatchCategory,
  MismatchSeverity,
} from "./types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mm(
  id: string,
  category: MismatchCategory,
  severity: MismatchSeverity,
  title: string,
  detail: string,
  affectedKey: string,
  affectedType: MismatchRecord["affectedType"],
  simulator?: MismatchRecord["simulator"],
  auditId?: string
): MismatchRecord {
  return {
    id,
    category,
    severity,
    title,
    detail,
    affectedKey,
    affectedType,
    simulator,
    auditId: auditId ?? affectedKey,
  };
}

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Loose domain normaliser — maps variants to ground/air/maritime/space/cyber */
function normDomain(s: string | null | undefined): string {
  const t = (s ?? "").toLowerCase();
  if (/air|avia|helo|rotary|fixed.wing|uav|drone/.test(t)) return "air";
  if (/ground|land|armou?r|infantry|vehicle|wheeled|tracked/.test(t))
    return "ground";
  if (/mar|sea|naval|ship|vessel|coast/.test(t)) return "maritime";
  if (/space|orbital|satellite/.test(t)) return "space";
  if (/cyber|electronic|ew|sigint/.test(t)) return "cyber";
  return t.replace(/[^a-z]/g, "");
}

/** Detect branch/domain inconsistency */
function branchDomainClash(
  branch: string | null,
  domain: string | null,
  classType: string | null
): boolean {
  const b = (branch ?? "").toLowerCase();
  const d = (domain ?? "").toLowerCase();
  const ct = (classType ?? "").toLowerCase();
  if (b.includes("army") && (d.includes("avia") || ct.includes("naval")))
    return true;
  if (
    (b.includes("air") || b.includes("raf") || b.includes("usaf")) &&
    d.includes("ground")
  )
    return true;
  if (
    (b.includes("navy") || b.includes("naval") || b.includes("maritime")) &&
    d.includes("ground")
  )
    return true;
  return false;
}

/** Group entries by simulationClass (case-insensitive) and emit duplicate warnings. */
function findDuplicatesBy<T>(
  entries: T[],
  keyFn: (e: T) => string | null,
  idFn: (e: T) => string,
  simulator: "vbs4" | "simworks" | "sword"
): MismatchRecord[] {
  const issues: MismatchRecord[] = [];
  const byKey = new Map<string, T[]>();
  for (const e of entries) {
    const k = keyFn(e);
    if (!k) continue;
    const norm = k.trim().toLowerCase();
    if (!byKey.has(norm)) byKey.set(norm, []);
    byKey.get(norm)!.push(e);
  }
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    const ids = group.map(idFn);
    issues.push(
      mm(
        `dup_${simulator}_${key}`,
        "duplicate_sim_class",
        "warning",
        `Duplicate simulation class in ${simulator.toUpperCase()}: ${key}`,
        `${
          group.length
        } ${simulator.toUpperCase()} entries share simulationClass "${key}" — they may represent the same platform: ${ids.join(
          ", "
        )}.`,
        ids[0],
        simulator,
        simulator
      )
    );
  }
  return issues;
}

// ─── Full mismatch engine ─────────────────────────────────────────────────────
//
// Ontology mapping recap (verified against the current ontology):
//
//   NxgCanonicalAsset.primaryKey ─── FK ──▶ NxgVbs4AssetCatalogue.dis6Code
//                                ─── FK ──▶ NxgSimworksAssetCatalogue.dis6Code
//                                ─── FK ──▶ NxgOSwordAssetCatalogue.dis6Code
//                                ─── FK ──▶ NxgUnit.dis6Code
//
// So a "canonical link" from ANY simulator entry (or a unit) to a canonical
// asset flows via that entry's `dis6Code` matching a `NxgCanonicalAsset.primaryKey`.
// VBS4 additionally carries an editable `canonicalAssetKey` field (older model),
// which we treat as a secondary/back-up link but not the primary one.

function deriveMismatches(
  canonical: CanonicalAsset[],
  vbs4: Vbs4Asset[],
  simworks: SimworksAsset[],
  sword: SwordAsset[],
  units: UnitRef[]
): MismatchRecord[] {
  const issues: MismatchRecord[] = [];
  const canonByKey = new Map(canonical.map((c) => [c.primaryKey, c]));
  const vbs4ById = new Map(vbs4.map((v) => [v.identifier, v]));
  const simworksById = new Map(simworks.map((s) => [s.identifier, s]));
  const swordById = new Map(sword.map((s) => [s.identifier, s]));

  /** For each simulator entry, resolve the canonical it links to (or null). */
  const canonOfVbs4 = (v: Vbs4Asset): CanonicalAsset | null => {
    if (v.dis6Code) {
      const c = canonByKey.get(v.dis6Code);
      if (c) return c;
    }
    if (v.canonicalAssetKey) {
      const c = canonByKey.get(v.canonicalAssetKey);
      if (c) return c;
    }
    return null;
  };
  const canonOfSimworks = (s: SimworksAsset): CanonicalAsset | null =>
    s.dis6Code ? canonByKey.get(s.dis6Code) ?? null : null;
  const canonOfSword = (s: SwordAsset): CanonicalAsset | null =>
    s.dis6code ? canonByKey.get(s.dis6code) ?? null : null;

  // Which canonicals are covered by each simulator
  const vbs4CanonKeys = new Set<string>();
  for (const v of vbs4) {
    const c = canonOfVbs4(v);
    if (c) vbs4CanonKeys.add(c.primaryKey);
  }
  const simworksCanonKeys = new Set<string>();
  for (const s of simworks) {
    const c = canonOfSimworks(s);
    if (c) simworksCanonKeys.add(c.primaryKey);
  }
  const swordCanonKeys = new Set<string>();
  for (const s of sword) {
    const c = canonOfSword(s);
    if (c) swordCanonKeys.add(c.primaryKey);
  }

  // Which sim-identifiers are referenced by at least one unit
  const usedSimIds = new Set(
    units
      .filter((u) => u.simulatorIdentifierCode)
      .map((u) => u.simulatorIdentifierCode!)
  );

  // ── 1. Orphaned simulator entries (broken/missing canonical link) ───────
  //     Fires per-simulator with a `simulator` badge so the UI can group.
  for (const v of vbs4) {
    if (!v.dis6Code && !v.canonicalAssetKey) {
      issues.push(
        mm(
          `orphan_vbs4_nokey_${v.identifier}`,
          "orphan_vbs4",
          "error",
          `VBS4 · no canonical link: ${v.identifier}`,
          `VBS4 entry "${v.identifier}" has neither dis6Code nor canonicalAssetKey set — it cannot be classified against doctrine.`,
          v.identifier,
          "vbs4",
          "vbs4"
        )
      );
    } else if (!canonOfVbs4(v)) {
      const key = v.dis6Code ?? v.canonicalAssetKey ?? "";
      issues.push(
        mm(
          `orphan_vbs4_broken_${v.identifier}`,
          "orphan_vbs4",
          "error",
          `VBS4 · broken canonical link: ${v.identifier}`,
          `VBS4 entry "${v.identifier}" points to canonical key "${key}" but no NxgCanonicalAsset with that primaryKey exists.`,
          v.identifier,
          "vbs4",
          "vbs4"
        )
      );
    }
  }
  for (const s of simworks) {
    if (!s.dis6Code) {
      issues.push(
        mm(
          `orphan_simworks_nokey_${s.identifier}`,
          "orphan_simworks",
          "error",
          `Simworks · no canonical link: ${s.identifier}`,
          `Simworks entry "${s.identifier}" has no dis6Code set — it cannot be linked to a canonical asset.`,
          s.identifier,
          "simworks",
          "simworks"
        )
      );
    } else if (!canonOfSimworks(s)) {
      issues.push(
        mm(
          `orphan_simworks_broken_${s.identifier}`,
          "orphan_simworks",
          "error",
          `Simworks · broken canonical link: ${s.identifier}`,
          `Simworks entry "${s.identifier}" has dis6Code "${s.dis6Code}" but no matching canonical asset.`,
          s.identifier,
          "simworks",
          "simworks"
        )
      );
    }
  }
  for (const s of sword) {
    if (!s.dis6code) {
      issues.push(
        mm(
          `orphan_sword_nokey_${s.identifier}`,
          "orphan_sword",
          "error",
          `Sword · no canonical link: ${s.identifier}`,
          `Sword entry "${s.identifier}" has no dis6Code set — it cannot be linked to a canonical asset.`,
          s.identifier,
          "sword",
          "sword"
        )
      );
    } else if (!canonOfSword(s)) {
      issues.push(
        mm(
          `orphan_sword_broken_${s.identifier}`,
          "orphan_sword",
          "error",
          `Sword · broken canonical link: ${s.identifier}`,
          `Sword entry "${s.identifier}" has dis6Code "${s.dis6code}" but no matching canonical asset.`,
          s.identifier,
          "sword",
          "sword"
        )
      );
    }
  }

  // ── 2. Coverage across the 3 simulators ─────────────────────────────────
  for (const c of canonical) {
    const inVbs4 = vbs4CanonKeys.has(c.primaryKey);
    const inSimworks = simworksCanonKeys.has(c.primaryKey);
    const inSword = swordCanonKeys.has(c.primaryKey);
    const coverage = [inVbs4, inSimworks, inSword].filter(Boolean).length;

    if (coverage === 0) {
      issues.push(
        mm(
          `unmapped_${c.primaryKey}`,
          "unmapped_canonical",
          "error",
          `No simulator model: ${c.canonicalName ?? c.primaryKey}`,
          `"${c.canonicalName ?? c.primaryKey}" (${
            c.militaryDomain ?? "domain unknown"
          }, ${
            c.nationality ?? "nationality unknown"
          }) exists in the doctrine catalogue but is not modelled in VBS4, Simworks OR Sword. Exercise planners cannot spawn it in any simulator.`,
          c.primaryKey,
          "canonical",
          "cross"
        )
      );
    } else if (coverage === 1) {
      const only = inVbs4 ? "VBS4" : inSimworks ? "Simworks" : "Sword";
      issues.push(
        mm(
          `single_sim_${c.primaryKey}`,
          "single_simulator_only",
          "info",
          `Only ${only}: ${c.canonicalName ?? c.primaryKey}`,
          `"${
            c.canonicalName ?? c.primaryKey
          }" is only modelled in ${only}. Federated exercises using the other two simulators cannot spawn a matching entity.`,
          c.primaryKey,
          "canonical",
          "cross"
        )
      );
    }
  }

  // ── 3. Cross-simulator disagreement ─────────────────────────────────────
  //  For canonicals modelled in ≥2 simulators, check that key attributes
  //  (disCode / domain / nationality) agree across simulators.
  for (const c of canonical) {
    const vbs4Entries = vbs4.filter(
      (v) => canonOfVbs4(v)?.primaryKey === c.primaryKey
    );
    const simworksEntries = simworks.filter(
      (s) => canonOfSimworks(s)?.primaryKey === c.primaryKey
    );
    const swordEntries = sword.filter(
      (s) => canonOfSword(s)?.primaryKey === c.primaryKey
    );
    const total =
      vbs4Entries.length + simworksEntries.length + swordEntries.length;
    if (total < 2) continue;

    // DIS-code agreement
    const disCodes = new Set<string>();
    for (const v of vbs4Entries) if (v.disCode) disCodes.add(v.disCode.trim());
    for (const s of simworksEntries)
      if (s.disCode) disCodes.add(s.disCode.trim());
    for (const s of swordEntries) if (s.disCode) disCodes.add(s.disCode.trim());
    if (disCodes.size > 1) {
      issues.push(
        mm(
          `xdis_${c.primaryKey}`,
          "cross_sim_disagreement",
          "warning",
          `DIS code disagreement: ${c.canonicalName ?? c.primaryKey}`,
          `Simulators disagree on the DIS code for "${
            c.canonicalName ?? c.primaryKey
          }": [${[...disCodes].join(
            " | "
          )}]. All simulators should broadcast the same DIS entity type on the federation.`,
          c.primaryKey,
          "canonical",
          "cross"
        )
      );
    }

    // Nationality agreement
    const nats = new Set<string>();
    for (const v of vbs4Entries)
      if (v.nationality) nats.add(norm(v.nationality));
    for (const s of simworksEntries)
      if (s.nationality) nats.add(norm(s.nationality));
    for (const s of swordEntries) if (s.country) nats.add(norm(s.country));
    if (nats.size > 1) {
      issues.push(
        mm(
          `xnat_${c.primaryKey}`,
          "cross_sim_disagreement",
          "warning",
          `Nationality disagreement: ${c.canonicalName ?? c.primaryKey}`,
          `Simulators list different nationalities for "${
            c.canonicalName ?? c.primaryKey
          }": [${[...nats].join(
            " | "
          )}]. They should all match the canonical value "${
            c.nationality ?? "—"
          }".`,
          c.primaryKey,
          "canonical",
          "cross"
        )
      );
    }

    // Domain agreement
    const doms = new Set<string>();
    for (const v of vbs4Entries) {
      const d = normDomain(v.derivedMilitaryDomain ?? v.domain);
      if (d) doms.add(d);
    }
    for (const s of simworksEntries) {
      const d = normDomain(s.militaryDomain ?? s.disDomainLabel ?? s.disDomain);
      if (d) doms.add(d);
    }
    for (const s of swordEntries) {
      const d = normDomain(s.domain);
      if (d) doms.add(d);
    }
    if (doms.size > 1) {
      issues.push(
        mm(
          `xdom_${c.primaryKey}`,
          "cross_sim_disagreement",
          "warning",
          `Domain disagreement: ${c.canonicalName ?? c.primaryKey}`,
          `Simulators disagree on the military domain for "${
            c.canonicalName ?? c.primaryKey
          }": [${[...doms].join(" | ")}]. Canonical says "${
            c.militaryDomain ?? "—"
          }".`,
          c.primaryKey,
          "canonical",
          "cross"
        )
      );
    }
  }

  // ── 4. Simulator-vs-canonical domain mismatch (per-entry) ───────────────
  const checkDomain = (
    id: string,
    entryDomain: string | null,
    c: CanonicalAsset | null,
    sim: "vbs4" | "simworks" | "sword",
    at: MismatchRecord["affectedType"]
  ) => {
    if (!c) return;
    const eDom = normDomain(entryDomain);
    const cDom = normDomain(c.militaryDomain);
    if (eDom && cDom && eDom !== cDom) {
      issues.push(
        mm(
          `domain_${sim}_${id}`,
          "domain_mismatch",
          "warning",
          `${sim.toUpperCase()} domain mismatch: ${id}`,
          `${sim.toUpperCase()} entry says domain "${entryDomain}" but canonical asset "${
            c.canonicalName ?? c.primaryKey
          }" says militaryDomain "${c.militaryDomain}".`,
          id,
          at,
          sim
        )
      );
    }
  };
  for (const v of vbs4)
    checkDomain(
      v.identifier,
      v.derivedMilitaryDomain ?? v.domain,
      canonOfVbs4(v),
      "vbs4",
      "vbs4"
    );
  for (const s of simworks)
    checkDomain(
      s.identifier,
      s.militaryDomain ?? s.disDomainLabel ?? s.disDomain,
      canonOfSimworks(s),
      "simworks",
      "simworks"
    );
  for (const s of sword)
    checkDomain(s.identifier, s.domain, canonOfSword(s), "sword", "sword");

  // ── 5. Simulator-vs-canonical nationality mismatch (per-entry) ──────────
  const checkNat = (
    id: string,
    entryNat: string | null,
    c: CanonicalAsset | null,
    sim: "vbs4" | "simworks" | "sword",
    at: MismatchRecord["affectedType"]
  ) => {
    if (!c || !c.nationality || !entryNat) return;
    if (norm(entryNat) !== norm(c.nationality)) {
      issues.push(
        mm(
          `nat_${sim}_${id}`,
          "nationality_mismatch",
          "warning",
          `${sim.toUpperCase()} nationality mismatch: ${id}`,
          `${sim.toUpperCase()} entry nationality is "${entryNat}" but canonical asset "${
            c.canonicalName ?? c.primaryKey
          }" says "${c.nationality}".`,
          id,
          at,
          sim
        )
      );
    }
  };
  for (const v of vbs4)
    checkNat(v.identifier, v.nationality, canonOfVbs4(v), "vbs4", "vbs4");
  for (const s of simworks)
    checkNat(
      s.identifier,
      s.nationality,
      canonOfSimworks(s),
      "simworks",
      "simworks"
    );
  for (const s of sword)
    checkNat(s.identifier, s.country, canonOfSword(s), "sword", "sword");

  // ── 6. Missing crew config (VBS4 only) ──────────────────────────────────
  for (const v of vbs4) {
    const hasCrew =
      v.hasCommander === true ||
      (v.gunnerSeatCount !== null && v.gunnerSeatCount > 0) ||
      (v.numCargoSeats !== null && v.numCargoSeats > 0);
    if (!hasCrew) {
      issues.push(
        mm(
          `nocrew_${v.identifier}`,
          "missing_crew_config",
          "warning",
          `VBS4 · no crew config: ${v.identifier}`,
          `VBS4 entry "${v.identifier}" has no commander flag, zero gunner seats and zero cargo seats. Crew roles cannot be assigned.`,
          v.identifier,
          "vbs4",
          "vbs4"
        )
      );
    }
  }

  // ── 7. Missing DIS code (all simulators) ────────────────────────────────
  for (const v of vbs4)
    if (!v.disCode)
      issues.push(
        mm(
          `nodis_vbs4_${v.identifier}`,
          "missing_dis_code",
          "warning",
          `VBS4 · no DIS code: ${v.identifier}`,
          `VBS4 entry has no disCode — DIS federation cannot identify this entity.`,
          v.identifier,
          "vbs4",
          "vbs4"
        )
      );
  for (const s of simworks)
    if (!s.disCode)
      issues.push(
        mm(
          `nodis_sw_${s.identifier}`,
          "missing_dis_code",
          "warning",
          `Simworks · no DIS code: ${s.identifier}`,
          `Simworks entry has no disCode — DIS federation cannot identify this entity.`,
          s.identifier,
          "simworks",
          "simworks"
        )
      );
  for (const s of sword)
    if (!s.disCode)
      issues.push(
        mm(
          `nodis_sword_${s.identifier}`,
          "missing_dis_code",
          "warning",
          `Sword · no DIS code: ${s.identifier}`,
          `Sword entry has no disCode — DIS federation cannot identify this entity.`,
          s.identifier,
          "sword",
          "sword"
        )
      );

  // ── 8. Missing dis6Code (breaks the canonical link) ─────────────────────
  //     Kept SEPARATE from disCode because the canonical link relies on it.
  for (const v of vbs4)
    if (!v.dis6Code && v.canonicalAssetKey)
      issues.push(
        mm(
          `nodis6_vbs4_${v.identifier}`,
          "missing_dis6",
          "warning",
          `VBS4 · missing dis6Code: ${v.identifier}`,
          `VBS4 entry has canonicalAssetKey "${v.canonicalAssetKey}" but no dis6Code — the ontology link to NxgCanonicalAsset uses dis6Code and will not resolve.`,
          v.identifier,
          "vbs4",
          "vbs4"
        )
      );
  for (const s of simworks)
    if (!s.dis6Code)
      issues.push(
        mm(
          `nodis6_sw_${s.identifier}`,
          "missing_dis6",
          "warning",
          `Simworks · missing dis6Code: ${s.identifier}`,
          `Simworks entry has no dis6Code — the ontology link to NxgCanonicalAsset will not resolve.`,
          s.identifier,
          "simworks",
          "simworks"
        )
      );
  for (const s of sword)
    if (!s.dis6code)
      issues.push(
        mm(
          `nodis6_sword_${s.identifier}`,
          "missing_dis6",
          "warning",
          `Sword · missing dis6Code: ${s.identifier}`,
          `Sword entry has no dis6Code — the ontology link to NxgCanonicalAsset will not resolve.`,
          s.identifier,
          "sword",
          "sword"
        )
      );

  // ── 9. Duplicate simulation classes (per-simulator) ─────────────────────
  issues.push(
    ...findDuplicatesBy(
      vbs4,
      (v) => v.simulationClass,
      (v) => v.identifier,
      "vbs4"
    )
  );
  issues.push(
    ...findDuplicatesBy(
      simworks,
      (s) => s.simulationClass,
      (s) => s.identifier,
      "simworks"
    )
  );
  // (Sword catalogue has no simulationClass — skip)

  // ── 10. Unused simulator entries (never referenced by any unit) ─────────
  for (const v of vbs4)
    if (!usedSimIds.has(v.identifier))
      issues.push(
        mm(
          `unused_vbs4_${v.identifier}`,
          "unused_vbs4",
          "info",
          `VBS4 · unused: ${v.identifier}`,
          `VBS4 entry "${v.identifier}" is not referenced by any NxgUnit via simulatorIdentifierCode.`,
          v.identifier,
          "vbs4",
          "vbs4"
        )
      );
  for (const s of simworks)
    if (!usedSimIds.has(s.identifier))
      issues.push(
        mm(
          `unused_sw_${s.identifier}`,
          "unused_simworks",
          "info",
          `Simworks · unused: ${s.identifier}`,
          `Simworks entry "${s.identifier}" is not referenced by any NxgUnit via simulatorIdentifierCode.`,
          s.identifier,
          "simworks",
          "simworks"
        )
      );
  for (const s of sword)
    if (!usedSimIds.has(s.identifier))
      issues.push(
        mm(
          `unused_sword_${s.identifier}`,
          "unused_sword",
          "info",
          `Sword · unused: ${s.identifier}`,
          `Sword entry "${s.identifier}" is not referenced by any NxgUnit via simulatorIdentifierCode.`,
          s.identifier,
          "sword",
          "sword"
        )
      );

  // ── 11. Dead unit references (unit → non-existent sim entry) ────────────
  for (const u of units) {
    if (!u.simulatorIdentifierCode) continue;
    const foundIn =
      (vbs4ById.has(u.simulatorIdentifierCode) && "vbs4") ||
      (simworksById.has(u.simulatorIdentifierCode) && "simworks") ||
      (swordById.has(u.simulatorIdentifierCode) && "sword") ||
      null;
    if (!foundIn) {
      issues.push(
        mm(
          `dead_ref_${u.primaryKey}`,
          "dead_unit_reference",
          "error",
          `Unit · dead simulator reference: ${
            u.unitIdentifier ?? u.primaryKey
          }`,
          `Unit "${
            u.unitIdentifier ?? u.primaryKey
          }" has simulatorIdentifierCode "${
            u.simulatorIdentifierCode
          }" but NO catalogue entry (VBS4, Simworks or Sword) with that identifier exists.`,
          u.primaryKey,
          "unit",
          "cross",
          u.unitIdentifier ?? u.primaryKey
        )
      );
    } else if (u.owningSimulator) {
      // ── 12. Owning-simulator mismatch ────────────────────────────────────
      const owner = u.owningSimulator.toLowerCase();
      const foundInMatches =
        (foundIn === "vbs4" && /vbs/.test(owner)) ||
        (foundIn === "simworks" && /simworks|sim.works/.test(owner)) ||
        (foundIn === "sword" && /sword|masa/.test(owner));
      if (!foundInMatches) {
        issues.push(
          mm(
            `owner_${u.primaryKey}`,
            "unit_sim_owner_mismatch",
            "warning",
            `Unit · owner ≠ sim source: ${u.unitIdentifier ?? u.primaryKey}`,
            `Unit says owningSimulator "${
              u.owningSimulator
            }" but its simulatorIdentifierCode "${
              u.simulatorIdentifierCode
            }" was found in the ${foundIn.toUpperCase()} catalogue.`,
            u.primaryKey,
            "unit",
            "cross",
            u.unitIdentifier ?? u.primaryKey
          )
        );
      }
    }
  }

  // ── 13. Unit has owningSimulator but no simulatorIdentifierCode ─────────
  for (const u of units) {
    if (u.owningSimulator && !u.simulatorIdentifierCode) {
      issues.push(
        mm(
          `nosimcode_${u.primaryKey}`,
          "unit_missing_sim_code",
          "warning",
          `Unit · missing simulator code: ${u.unitIdentifier ?? u.primaryKey}`,
          `Unit is assigned to owningSimulator "${u.owningSimulator}" but has no simulatorIdentifierCode — cannot be spawned.`,
          u.primaryKey,
          "unit",
          "cross",
          u.unitIdentifier ?? u.primaryKey
        )
      );
    }
  }

  // ── 14. Unit dis6Code (FK to canonical) is broken ───────────────────────
  for (const u of units) {
    if (u.canonicalAssetKey && !canonByKey.has(u.canonicalAssetKey)) {
      issues.push(
        mm(
          `unitcanon_${u.primaryKey}`,
          "unit_broken_canonical",
          "error",
          `Unit · broken canonical FK: ${u.unitIdentifier ?? u.primaryKey}`,
          `Unit "${u.unitIdentifier ?? u.primaryKey}" has dis6Code "${
            u.canonicalAssetKey
          }" (FK to NxgCanonicalAsset) but no canonical asset with that primaryKey exists.`,
          u.primaryKey,
          "unit",
          "cross",
          u.unitIdentifier ?? u.primaryKey
        )
      );
    }
  }

  // ── 15. Branch inconsistency (VBS4 vs canonical) ────────────────────────
  for (const v of vbs4) {
    const c = canonOfVbs4(v);
    if (!c || !c.branch) continue;
    if (
      branchDomainClash(
        c.branch,
        v.derivedMilitaryDomain ?? v.domain,
        v.classType
      )
    ) {
      issues.push(
        mm(
          `branch_${v.identifier}`,
          "branch_inconsistency",
          "warning",
          `VBS4 · branch/domain conflict: ${v.identifier}`,
          `Canonical branch is "${c.branch}" but VBS4 domain is "${
            v.derivedMilitaryDomain ?? v.domain
          }" with classType "${
            v.classType ?? "—"
          }". This combination is unexpected.`,
          v.identifier,
          "vbs4",
          "vbs4"
        )
      );
    }
  }

  // ── 16. Drone flag mismatch (VBS4 vs canonical) ─────────────────────────
  for (const v of vbs4) {
    if (v.isDrone === null) continue;
    const c = canonOfVbs4(v);
    if (!c || !c.assetCategory) continue;
    const cat = c.assetCategory.toLowerCase();
    const isDroneCat = /drone|uav|uas|unmanned/.test(cat);
    const isAircraftCat =
      /aircraft|helo|helicopter|aviation|plane|fighter/.test(cat);
    const isVehicleCat = /vehicle|armou?r|tank|wheeled|tracked/.test(cat);
    if (v.isDrone && isVehicleCat && !isDroneCat) {
      issues.push(
        mm(
          `drone_true_${v.identifier}`,
          "drone_flag_mismatch",
          "warning",
          `VBS4 · drone flag mismatch: ${v.identifier}`,
          `VBS4 says isDrone: true but canonical assetCategory "${c.assetCategory}" is a vehicle, not a drone.`,
          v.identifier,
          "vbs4",
          "vbs4"
        )
      );
    } else if (!v.isDrone && isDroneCat && !isAircraftCat) {
      issues.push(
        mm(
          `drone_false_${v.identifier}`,
          "drone_flag_mismatch",
          "warning",
          `VBS4 · missing drone flag: ${v.identifier}`,
          `VBS4 says isDrone: false but canonical assetCategory "${c.assetCategory}" suggests it should be a drone.`,
          v.identifier,
          "vbs4",
          "vbs4"
        )
      );
    }
  }

  return issues;
}

// ─── Counts derivation ────────────────────────────────────────────────────────

function deriveCounts(
  canonical: CanonicalAsset[],
  vbs4: Vbs4Asset[],
  simworks: SimworksAsset[],
  sword: SwordAsset[],
  unitTypes: UnitType[],
  equipmentTypes: EquipmentType[],
  mismatches: MismatchRecord[]
): InventoryCounts {
  // Coverage: a canonical is "mapped" if ANY simulator (via dis6Code or the
  // legacy VBS4 canonicalAssetKey) points to it.
  const canonKeys = new Set(canonical.map((c) => c.primaryKey));
  const mappedCanonKeys = new Set<string>();
  for (const v of vbs4) {
    const k = v.dis6Code ?? v.canonicalAssetKey;
    if (k && canonKeys.has(k)) mappedCanonKeys.add(k);
  }
  for (const s of simworks)
    if (s.dis6Code && canonKeys.has(s.dis6Code))
      mappedCanonKeys.add(s.dis6Code);
  for (const s of sword)
    if (s.dis6code && canonKeys.has(s.dis6code))
      mappedCanonKeys.add(s.dis6code);

  const byDomain: Record<string, { mapped: number; unmapped: number }> = {};
  for (const c of canonical) {
    const d = c.militaryDomain ?? "Unknown";
    if (!byDomain[d]) byDomain[d] = { mapped: 0, unmapped: 0 };
    if (mappedCanonKeys.has(c.primaryKey)) byDomain[d].mapped++;
    else byDomain[d].unmapped++;
  }

  const byNationality: Record<
    string,
    { canonical: number; mapped: number; unmapped: number }
  > = {};
  for (const c of canonical) {
    const n = c.nationality ?? "Unknown";
    if (!byNationality[n])
      byNationality[n] = { canonical: 0, mapped: 0, unmapped: 0 };
    byNationality[n].canonical++;
    if (mappedCanonKeys.has(c.primaryKey)) byNationality[n].mapped++;
    else byNationality[n].unmapped++;
  }

  return {
    totalCanonical: canonical.length,
    totalVbs4: vbs4.length,
    totalSimworks: simworks.length,
    totalSword: sword.length,
    totalUnitTypes: unitTypes.length,
    totalEquipmentTypes: equipmentTypes.length,
    mappedCanonical: mappedCanonKeys.size,
    unmappedCanonical: canonical.length - mappedCanonKeys.size,
    orphanVbs4: vbs4.filter((v) => {
      const k = v.dis6Code ?? v.canonicalAssetKey;
      return !k || !canonKeys.has(k);
    }).length,
    byDomain,
    byNationality,
    droneCount: vbs4.filter((v) => v.isDrone).length,
    mismatchCount: mismatches.filter((m) => m.severity === "error").length,
  };
}

// ─── Hook state ───────────────────────────────────────────────────────────────

export interface AssetDataState {
  canonical: CanonicalAsset[];
  vbs4: Vbs4Asset[];
  simworks: SimworksAsset[];
  sword: SwordAsset[];
  unitTypes: UnitType[];
  equipmentTypes: EquipmentType[];
  units: UnitRef[];
  mismatches: MismatchRecord[];
  counts: InventoryCounts;
  loadingCanonical: boolean;
  loadingVbs4: boolean;
  loadingSimworks: boolean;
  loadingSword: boolean;
  loadingUnitTypes: boolean;
  loadingEquipmentTypes: boolean;
  loadingUnits: boolean;
  errorCanonical: string | null;
  errorVbs4: string | null;
  errorSimworks: string | null;
  errorSword: string | null;
  errorUnitTypes: string | null;
  errorEquipmentTypes: string | null;
  errorUnits: string | null;
  isLoading: boolean;
  hasError: boolean;
  refresh: () => void;
}

const EMPTY_COUNTS: InventoryCounts = {
  totalCanonical: 0,
  totalVbs4: 0,
  totalSimworks: 0,
  totalSword: 0,
  totalUnitTypes: 0,
  totalEquipmentTypes: 0,
  mappedCanonical: 0,
  unmappedCanonical: 0,
  orphanVbs4: 0,
  byDomain: {},
  byNationality: {},
  droneCount: 0,
  mismatchCount: 0,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAssetData(): AssetDataState {
  const [canonical, setCanonical] = useState<CanonicalAsset[]>([]);
  const [vbs4, setVbs4] = useState<Vbs4Asset[]>([]);
  const [simworks, setSimworks] = useState<SimworksAsset[]>([]);
  const [sword, setSword] = useState<SwordAsset[]>([]);
  const [unitTypes, setUnitTypes] = useState<UnitType[]>([]);
  const [equipmentTypes, setEquipmentTypes] = useState<EquipmentType[]>([]);
  const [units, setUnits] = useState<UnitRef[]>([]);
  const [mismatches, setMismatches] = useState<MismatchRecord[]>([]);
  const [counts, setCounts] = useState<InventoryCounts>(EMPTY_COUNTS);

  const [loadingCanonical, setLoadingCanonical] = useState(false);
  const [loadingVbs4, setLoadingVbs4] = useState(false);
  const [loadingSimworks, setLoadingSimworks] = useState(false);
  const [loadingSword, setLoadingSword] = useState(false);
  const [loadingUnitTypes, setLoadingUnitTypes] = useState(false);
  const [loadingEquipmentTypes, setLoadingEquipmentTypes] = useState(false);
  const [loadingUnits, setLoadingUnits] = useState(false);

  const [errorCanonical, setErrorCanonical] = useState<string | null>(null);
  const [errorVbs4, setErrorVbs4] = useState<string | null>(null);
  const [errorSimworks, setErrorSimworks] = useState<string | null>(null);
  const [errorSword, setErrorSword] = useState<string | null>(null);
  const [errorUnitTypes, setErrorUnitTypes] = useState<string | null>(null);
  const [errorEquipmentTypes, setErrorEquipmentTypes] = useState<string | null>(
    null
  );
  const [errorUnits, setErrorUnits] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    // ── Canonical Assets ────────────────────────────────────────────────────
    setLoadingCanonical(true);
    setErrorCanonical(null);
    const canonicalResult: CanonicalAsset[] = [];
    try {
      for await (const obj of client(NxgCanonicalAsset).asyncIter()) {
        canonicalResult.push({
          primaryKey: obj.primaryKey_,
          canonicalName: obj.canonicalName ?? null,
          militaryDomain: obj.militaryDomain ?? null,
          nationality: obj.nationality ?? null,
          assetCategory: obj.assetCategory ?? null,
          simulationClass: obj.simulationClass ?? null,
          branch: obj.branch ?? null,
          subcategory: obj.subcategory ?? null,
        });
      }
      setCanonical(canonicalResult);
    } catch (e) {
      setErrorCanonical(String(e));
    } finally {
      setLoadingCanonical(false);
    }

    // ── VBS4 Catalogue ──────────────────────────────────────────────────────
    setLoadingVbs4(true);
    setErrorVbs4(null);
    const vbs4Result: Vbs4Asset[] = [];
    try {
      for await (const obj of client(NxgVbs4AssetCatalogue).asyncIter()) {
        vbs4Result.push({
          identifier: obj.identifier ?? "",
          classType: obj.classType ?? null,
          domain: obj.domain ?? null,
          description: obj.description ?? null,
          nationality: obj.nationality ?? null,
          isDrone: obj.isDrone ?? null,
          derivedSimulator: obj.derivedSimulator ?? null,
          derivedMilitaryDomain: obj.derivedMilitaryDomain ?? null,
          canonicalAssetKey: obj.canonicalAssetKey ?? null,
          branch: obj.branch ?? null,
          variant: obj.variant ?? null,
          simulationClass: obj.simulationClass ?? null,
          disCode: obj.disCode ?? null,
          dis6Code: obj.dis6Code ?? null,
          hasCommander: obj.hasCommander ?? null,
          gunnerSeatCount: obj.gunnerSeatCount ?? null,
          gunnerSeatNames: obj.gunnerSeatNames ?? null,
          gunnerSeatTurretIds: obj.gunnerSeatTurretIds ?? null,
          numCargoSeats: obj.numCargoSeats ?? null,
          crewClass: obj.crewClass ?? null,
          previewImage: obj.previewImage ?? null,
          vbsCode: obj.vbsCode ?? null,
          simulator: obj.simulator ?? null,
          sidc: obj.sidc ?? null,
          disCodeSource: obj.disCodeSource ?? null,
          disCodeSynthesisNote: obj.disCodeSynthesisNote ?? null,
        });
      }
      setVbs4(vbs4Result);
    } catch (e) {
      setErrorVbs4(String(e));
    } finally {
      setLoadingVbs4(false);
    }

    // ── Simworks Catalogue ──────────────────────────────────────────────────
    setLoadingSimworks(true);
    setErrorSimworks(null);
    const simworksResult: SimworksAsset[] = [];
    try {
      for await (const obj of client(NxgSimworksAssetCatalogue).asyncIter()) {
        simworksResult.push({
          identifier: obj.identifier ?? "",
          simulator: obj.simulator ?? null,
          simulationClass: obj.simulationClass ?? null,
          simworksClass: obj.simworksClass ?? null,
          simworksClassLabel: obj.simworksClassLabel ?? null,
          assetCategory: obj.assetCategory ?? null,
          militaryDomain: obj.militaryDomain ?? null,
          nationality: obj.nationality ?? null,
          description: obj.description ?? null,
          disCode: obj.disCode ?? null,
          dis6Code: obj.dis6Code ?? null,
          disKind: obj.disKind ?? null,
          disKindLabel: obj.disKindLabel ?? null,
          disDomain: obj.disDomain ?? null,
          disDomainLabel: obj.disDomainLabel ?? null,
          disCategory: obj.disCategory ?? null,
          disCategoryLabel: obj.disCategoryLabel ?? null,
          disCountry: obj.disCountry ?? null,
          disCountryLabel: obj.disCountryLabel ?? null,
          hasWeapons: obj.hasWeapons ?? null,
          hasSensors: obj.hasSensors ?? null,
          hasIff: obj.hasIff ?? null,
          hasEmissions: obj.hasEmissions ?? null,
          hasCatapult: obj.hasCatapult ?? null,
          hasArrestingWires: obj.hasArrestingWires ?? null,
          isDeployable: obj.isDeployable ?? null,
          maxSpeedMs: obj.maxSpeedMs ?? null,
          maxHealthPoints: obj.maxHealthPoints ?? null,
          maxSensorRangeM: obj.maxSensorRangeM ?? null,
          sensorNames: obj.sensorNames ?? null,
          defaultSide: obj.defaultSide ?? null,
          recordTypes: obj.recordTypes ?? null,
          movementTypes: obj.movementTypes ?? null,
        });
      }
      setSimworks(simworksResult);
    } catch (e) {
      setErrorSimworks(String(e));
    } finally {
      setLoadingSimworks(false);
    }

    // ── Sword Catalogue (MASA SWORD) ────────────────────────────────────────
    setLoadingSword(true);
    setErrorSword(null);
    const swordResult: SwordAsset[] = [];
    try {
      for await (const obj of client(NxgOSwordAssetCatalogue).asyncIter()) {
        swordResult.push({
          identifier: obj.identifier ?? "",
          name: obj.name ?? null,
          displayName: obj.displayName ?? null,
          country: obj.country ?? null,
          domain: obj.domain ?? null,
          category: obj.category ?? null,
          kind: obj.kind ?? null,
          level: obj.level ?? null,
          echelonLevel: obj.echelonLevel ?? null,
          sidc: obj.sidc ?? null,
          natureApp6: obj.natureApp6 ?? null,
          disCode: obj.disCode ?? null,
          dis6code: obj.dis6code ?? null,
          entityType: obj.entityType ?? null,
          isGroup: obj.isGroup ?? null,
          combatEfficiency: obj.combatEfficiency ?? null,
          reconEfficiency: obj.reconEfficiency ?? null,
          requiredCrew: obj.requiredCrew ?? null,
          majorEquipmentType: obj.majorEquipmentType ?? null,
          majorEquipmentCount: obj.majorEquipmentCount ?? null,
          minUnits: obj.minUnits ?? null,
          maxUnits: obj.maxUnits ?? null,
          constituentUnits: obj.constituentUnits ?? null,
          commandPostUnit: obj.commandPostUnit ?? null,
          equipmentIndex: obj.equipmentIndex ?? null,
          automatType: obj.automatType ?? null,
          automatIdentity: obj.automatIdentity ?? null,
          dataSet: obj.dataSet ?? null,
          disSource: obj.disSource ?? null,
        });
      }
      setSword(swordResult);
    } catch (e) {
      setErrorSword(String(e));
    } finally {
      setLoadingSword(false);
    }

    // ── Unit Types ──────────────────────────────────────────────────────────
    setLoadingUnitTypes(true);
    setErrorUnitTypes(null);
    const unitTypeResult: UnitType[] = [];
    try {
      for await (const obj of client(NxgUnitType).asyncIter()) {
        unitTypeResult.push({
          primaryKey: obj.primaryKey_,
          unitType: obj.unitType ?? null,
          abbreviatedUnitType: obj.abbreviatedUnitType ?? null,
          definition: obj.definition ?? null,
        });
      }
      setUnitTypes(unitTypeResult);
    } catch (e) {
      setErrorUnitTypes(String(e));
    } finally {
      setLoadingUnitTypes(false);
    }

    // ── Equipment Types ─────────────────────────────────────────────────────
    setLoadingEquipmentTypes(true);
    setErrorEquipmentTypes(null);
    const equipResult: EquipmentType[] = [];
    try {
      for await (const obj of client(NxgEquipmentType).asyncIter()) {
        equipResult.push({
          primaryKey: obj.primaryKey_,
          nomenclature: obj.nomenclature ?? null,
          description: obj.description ?? null,
        });
      }
      setEquipmentTypes(equipResult);
    } catch (e) {
      setErrorEquipmentTypes(String(e));
    } finally {
      setLoadingEquipmentTypes(false);
    }

    // ── Units (for cross-reference checks) ──────────────────────────────────
    setLoadingUnits(true);
    setErrorUnits(null);
    const unitResult: UnitRef[] = [];
    try {
      for await (const obj of client(NxgUnit).asyncIter()) {
        unitResult.push({
          primaryKey: obj.primaryKey_,
          unitIdentifier: obj.unitIdentifier ?? null,
          simulatorIdentifierCode: obj.simulatorIdentifierCode ?? null,
          // dis6Code is the FK from NxgUnit → NxgCanonicalAsset
          // (NxgCanonicalAsset.primaryKey is mapped onto NxgUnit.dis6Code via the link).
          canonicalAssetKey: obj.dis6Code ?? null,
          owningSimulator: obj.owningSimulator ?? null,
          affiliation: obj.affiliation ?? null,
          allegiance: obj.allegiance ?? null,
          militaryService: obj.militaryService ?? null,
          echelon: obj.echelon ?? null,
        });
      }
      setUnits(unitResult);
    } catch (e) {
      setErrorUnits(String(e));
    } finally {
      setLoadingUnits(false);
    }

    // ── Derive mismatches + counts ──────────────────────────────────────────
    const derived = deriveMismatches(
      canonicalResult,
      vbs4Result,
      simworksResult,
      swordResult,
      unitResult
    );
    setMismatches(derived);
    setCounts(
      deriveCounts(
        canonicalResult,
        vbs4Result,
        simworksResult,
        swordResult,
        unitTypeResult,
        equipResult,
        derived
      )
    );
  }, []);

  const refresh = useCallback(() => {
    void fetchAll();
  }, [fetchAll]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const isLoading =
    loadingCanonical ||
    loadingVbs4 ||
    loadingSimworks ||
    loadingSword ||
    loadingUnitTypes ||
    loadingEquipmentTypes ||
    loadingUnits;
  const hasError =
    !!errorCanonical ||
    !!errorVbs4 ||
    !!errorSimworks ||
    !!errorSword ||
    !!errorUnitTypes ||
    !!errorEquipmentTypes ||
    !!errorUnits;

  return {
    canonical,
    vbs4,
    simworks,
    sword,
    unitTypes,
    equipmentTypes,
    units,
    mismatches,
    counts,
    loadingCanonical,
    loadingVbs4,
    loadingSimworks,
    loadingSword,
    loadingUnitTypes,
    loadingEquipmentTypes,
    loadingUnits,
    errorCanonical,
    errorVbs4,
    errorSimworks,
    errorSword,
    errorUnitTypes,
    errorEquipmentTypes,
    errorUnits,
    isLoading,
    hasError,
    refresh,
  };
}
