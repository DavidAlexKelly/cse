/**
 * useOrbatStore.ts — central state for the ORBAT Group Builder.
 *
 * Manages:
 *   - groups         : UnitGroup[] — named collections of UnitNodes per affiliation
 *   - templates      : UnitTemplate[] — reusable single-unit configurations
 *   - groupTemplates : GroupTemplate[] — reusable full hierarchy structures
 *
 * Persisted to sessionStorage so state survives tab switches within the session.
 */

import { useState, useCallback, useRef } from "react";
import type {
  OrbatStoreState,
  UnitGroup,
  UnitNode,
  UnitTemplate,
  GroupTemplate,
  GroupTemplateNode,
  HierarchyTemplate,
  Force,
  CompositionNode,
  EchelonLevel,
  UnitIconType,
} from "../../../types";
import { flattenTree, removeNode, upsertNode, findParentId } from "../lib/treeUtils";

const STORAGE_KEY = "orbat_builder_store_v1";

function uid(): string { return crypto.randomUUID(); }
function now(): string { return new Date().toISOString(); }
function deepClone<T>(val: T): T { return JSON.parse(JSON.stringify(val)); }

// ── Default Unit Templates ─────────────────────────────────────────────────

function buildDefaultTemplates(): UnitTemplate[] {
  const defs: Array<{ id: string; name: string; echelon: EchelonLevel; pax: number; desc: string; tags: string[]; icon?: UnitIconType }> = [
    { id: "tpl-section",       name: "Rifle Section",           echelon: "section",   pax: 9,    desc: "9 pax. Basic infantry building block.",                        tags: ["infantry", "section", "british"] },
    { id: "tpl-platoon-hq",    name: "Platoon HQ",              echelon: "section",   pax: 9,    desc: "Platoon commander, sergeant, signaller etc.",                  tags: ["headquarters", "platoon", "british"] },
    { id: "tpl-platoon-rifle", name: "Rifle Platoon",           echelon: "platoon",   pax: 36,   desc: "Platoon HQ + 3 rifle sections.",                               tags: ["infantry", "platoon", "british"] },
    { id: "tpl-company-hq",    name: "Company HQ",              echelon: "section",   pax: 16,   desc: "Company commander, 2IC, CSM, admin cell.",                    tags: ["headquarters", "company", "british"] },
    { id: "tpl-company-rifle", name: "Rifle Company",           echelon: "company",   pax: 124,  desc: "Coy HQ + 3 rifle platoons.",                                   tags: ["infantry", "company", "british"] },
    { id: "tpl-support-coy",   name: "Support Company",         echelon: "company",   pax: 152,  desc: "Coy HQ + Recce Pl + Mortar Pl + AT Pl + Sniper Pl + Pnr Pl.", tags: ["support", "company", "british"] },
    { id: "tpl-hq-coy",        name: "HQ Company",              echelon: "company",   pax: 149,  desc: "Coy HQ + Sigs Pl + RAP + Log Pl + QM Pl + REME Det.",          tags: ["headquarters", "company", "british"] },
    { id: "tpl-bn-inf",        name: "Infantry Battalion",      echelon: "battalion", pax: 700,  desc: "Bn HQ + 3 Rifle Coy + Sp Coy + HQ Coy.",                      tags: ["infantry", "battalion", "british"] },
    { id: "tpl-recce-pl",      name: "Reconnaissance Platoon",  echelon: "platoon",   pax: 24,   desc: "24 pax. Mounted or dismounted recce.",          tags: ["reconnaissance", "platoon", "british"], icon: "reconnaissance" },
    { id: "tpl-mortar-pl",     name: "Mortar Platoon",          echelon: "platoon",   pax: 45,   desc: "45 pax. 81mm or 120mm mortar fire support.",   tags: ["mortar", "platoon", "british"],          icon: "mortar" },
    { id: "tpl-at-pl",         name: "Anti-Tank Platoon",       echelon: "platoon",   pax: 33,   desc: "33 pax. ATGM / NLAW equipped.",                tags: ["antiTank", "platoon", "british"],        icon: "antiTank" },
    { id: "tpl-sniper-pl",     name: "Sniper Platoon",          echelon: "platoon",   pax: 16,   desc: "16 pax. Long-range precision fire.",            tags: ["sniper", "platoon", "british"],          icon: "sniper" },
    { id: "tpl-pioneer-pl",    name: "Assault Pioneer Platoon", echelon: "platoon",   pax: 19,   desc: "19 pax. Combat engineering, breaching.",        tags: ["pioneer", "platoon", "british"],         icon: "pioneer" },
    { id: "tpl-sigs-pl",       name: "Signals Platoon",         echelon: "platoon",   pax: 28,   desc: "28 pax. Comms and electronic warfare.",         tags: ["signals", "platoon", "british"],         icon: "signals" },
    { id: "tpl-rap",           name: "Regimental Aid Post",     echelon: "platoon",   pax: 20,   desc: "20 pax. Forward medical care and casevac.",     tags: ["medical", "platoon", "british"],         icon: "medical" },
    { id: "tpl-log-pl",        name: "Logistics Platoon",       echelon: "platoon",   pax: 20,   desc: "20 pax. Forward supply and resupply.",          tags: ["logistics", "platoon", "british"],       icon: "logistics" },
    { id: "tpl-qm-pl",         name: "QM Platoon",              echelon: "platoon",   pax: 36,   desc: "36 pax. Quartermaster stores and equipment.",   tags: ["logistics", "platoon", "british"],       icon: "logistics" },
    { id: "tpl-reme-det",      name: "REME Detachment",         echelon: "section",   pax: 38,   desc: "38 pax. Forward repair and recovery.",          tags: ["maintenance", "section", "british"],     icon: "maintenance" },
    { id: "tpl-bn-armoured",   name: "Armoured Infantry Bn",    echelon: "battalion", pax: 732,  desc: "Warrior IFV-equipped armoured infantry bn.",   tags: ["armoured", "battalion", "british"],      icon: "mechanisedInfantry" },
    { id: "tpl-bn-mech",       name: "Mechanised Infantry Bn",  echelon: "battalion", pax: 709,  desc: "Boxer MIV-equipped mechanised infantry bn.",   tags: ["mechanised", "battalion", "british"],    icon: "mechanisedInfantry" },
    { id: "tpl-brigade",       name: "Armoured Brigade",        echelon: "brigade",   pax: 4000, desc: "Armoured Brigade Combat Team.",                 tags: ["armoured", "brigade", "british"],        icon: "armour" },
  ];
  return defs.map((d) => ({
    id: d.id, name: d.name, echelon: d.echelon,
    defaultPersonnelCount: d.pax, description: d.desc, tags: d.tags,
    defaultChildren: [], symbol: { icon: (d.icon ?? "infantry") as UnitIconType },
  }));
}

// ── Default Hierarchy Templates (full CompositionNode trees) ─────────────
// These are the "real" templates shown in the Build Hierarchy tab.
// Each is a complete CompositionNode tree with SIDC codes, echelons, and
// entity types set so they render correctly in the React Flow graph.

function node(
  id: string,
  name: string,
  echelon: string,
  sidc: string,
  children: CompositionNode[] = [],
): CompositionNode {
  return {
    id,
    unitIdentifier: name,
    echelon,
    sidc,
    entityType: "organisation",
    militaryService: "Army",
    affiliation: "Friend",
    allegiance: "GBR",
    owningSimulator: "vbs4",
    canonicalAssetKey: null,
    simulatorIdentifierCode: null,
    unitTypeKey: null,
    equipmentTypeKey: null,
    quantity: 1,
    children,
  };
}

// SIDC helpers — 15-char APP-6D/MIL-STD-2525C letter format
// Structure: S [aff=F] GP [funcId=3chars] [--------=8dashes_echelon_embedded]
// Matching real ontology data format e.g. "SFGPUCA--------"
// Position 1:   S  = coding scheme (warfighting)
// Position 2:   F  = affiliation (F=friend, H=hostile, N=neutral, U=unknown)
// Position 3-4: GP = battle dimension (Ground, Present)
// Position 5-7: 3-char function ID (e.g. UCI=infantry, UCA=armour)
// Position 8:   echelon modifier (-, A-Z: team=A, squad=B, platoon=D, coy=E, bn=F...)
// Position 9-15: ------- (filler dashes)
// Total: 15 chars
//
// Echelon is encoded at position 8 (milsymbol reads this for the size indicator)
const S = {
  inf:   (ech: string) => `SFGPUCI-${ech}------`,   // infantry
  hq:    (ech: string) => `SFGPUH--${ech}------`,    // headquarters
  armd:  (ech: string) => `SFGPUCA-${ech}------`,    // armour
  mech:  (ech: string) => `SFGPUCIZ${ech}------`,    // mechanised infantry
  recce: (ech: string) => `SFGPUCR-${ech}------`,    // reconnaissance
  mortar:(ech: string) => `SFGPUCFM${ech}------`,    // mortar
  at:    (ech: string) => `SFGPUCAT${ech}------`,    // anti-tank
  snip:  (ech: string) => `SFGPUUIS${ech}------`,    // sniper
  pio:   (ech: string) => `SFGPUCE-${ech}------`,    // pioneer/engineer
  sig:   (ech: string) => `SFGPUSS-${ech}------`,    // signals
  med:   (ech: string) => `SFGPUMC-${ech}------`,    // medical
  log:   (ech: string) => `SFGPUSM-${ech}------`,    // logistics
  arty:  (ech: string) => `SFGPUCF-${ech}------`,    // artillery
  engr:  (ech: string) => `SFGPUCE-${ech}------`,    // engineer
  aad:   (ech: string) => `SFGPUCAA${ech}------`,    // air defence
  avn:   (ech: string) => `SFGPUCA-${ech}------`,    // aviation
};
// Echelon position-8 codes (1 char each — milsymbol reads position 8 for echelon)
// APP-6D: -, A=Team, B=Squad, C=Section, D=Platoon, E=Company, F=Battalion,
//         G=Regiment, H=Brigade, I=Division, J=Corps, K=Army
const E = { team: "A", squad: "B", section: "C", platoon: "D", company: "E", battalion: "F", regiment: "G", brigade: "H", division: "I" };

function buildDefaultHierarchyTemplates(): HierarchyTemplate[] {
  // ── Helper: rifle section ─────────────────────────────────────────────────
  const section = (pfx: string, idx: number) =>
    node(`${pfx}-sec${idx}`, `${idx} Section`, "section", S.inf(E.section));

  // ── Helper: rifle platoon (HQ + 3 sections) ──────────────────────────────
  const platoon = (pfx: string, idx: number) =>
    node(`${pfx}-pl${idx}`, `${idx} Platoon`, "platoon", S.inf(E.platoon), [
      node(`${pfx}-pl${idx}-hq`, `${idx} Platoon HQ`, "section", S.hq(E.section)),
      section(`${pfx}-pl${idx}`, 1),
      section(`${pfx}-pl${idx}`, 2),
      section(`${pfx}-pl${idx}`, 3),
    ]);

  // ── Helper: rifle company (HQ + 3 platoons) ──────────────────────────────
  const rifleCoy = (pfx: string, letter: string) =>
    node(`${pfx}-${letter}coy`, `${letter} Company`, "company", S.inf(E.company), [
      node(`${pfx}-${letter}coy-hq`, `${letter} Company HQ`, "section", S.hq(E.section)),
      platoon(`${pfx}-${letter}coy`, 1),
      platoon(`${pfx}-${letter}coy`, 2),
      platoon(`${pfx}-${letter}coy`, 3),
    ]);

  // ────────────────────────────────────────────────────────────────────────
  // 1. Rifle Platoon
  // ────────────────────────────────────────────────────────────────────────
  const riflePlatoon: HierarchyTemplate = {
    id: "htpl-rifle-platoon",
    name: "Rifle Platoon",
    description: "Platoon HQ + 3 rifle sections. 36 pax.",
    tags: ["infantry", "platoon", "british"],
    createdAt: "2024-01-01T00:00:00.000Z",
    root: node("rpl-root", "Rifle Platoon", "platoon", S.inf(E.platoon), [
      node("rpl-hq", "Platoon HQ", "section", S.hq(E.section)),
      section("rpl", 1),
      section("rpl", 2),
      section("rpl", 3),
    ]),
  };

  // ────────────────────────────────────────────────────────────────────────
  // 2. Rifle Company
  // ────────────────────────────────────────────────────────────────────────
  const rifleCoyTpl: HierarchyTemplate = {
    id: "htpl-rifle-company",
    name: "Rifle Company",
    description: "Company HQ + 3 rifle platoons. ~124 pax.",
    tags: ["infantry", "company", "british"],
    createdAt: "2024-01-01T00:00:00.000Z",
    root: node("rcoy-root", "Rifle Company", "company", S.inf(E.company), [
      node("rcoy-hq", "Company HQ", "section", S.hq(E.section)),
      platoon("rcoy", 1),
      platoon("rcoy", 2),
      platoon("rcoy", 3),
    ]),
  };

  // ────────────────────────────────────────────────────────────────────────
  // 3. Support Company
  // ────────────────────────────────────────────────────────────────────────
  const supportCoy: HierarchyTemplate = {
    id: "htpl-support-company",
    name: "Support Company",
    description: "Coy HQ + Recce, Mortar, Anti-Tank, Sniper, Pioneer platoons. ~152 pax.",
    tags: ["support", "company", "british"],
    createdAt: "2024-01-01T00:00:00.000Z",
    root: node("scoy-root", "Support Company", "company", S.inf(E.company), [
      node("scoy-hq",    "Company HQ",              "section", S.hq(E.section)),
      node("scoy-recce", "Reconnaissance Platoon",  "platoon", S.recce(E.platoon), [
        node("scoy-recce-hq", "Recce Pl HQ", "section", S.hq(E.section)),
        node("scoy-recce-1",  "Recce Tp 1",  "section", S.recce(E.section)),
        node("scoy-recce-2",  "Recce Tp 2",  "section", S.recce(E.section)),
      ]),
      node("scoy-mor",   "Mortar Platoon",           "platoon", S.mortar(E.platoon), [
        node("scoy-mor-hq", "Mortar Pl HQ",   "section", S.hq(E.section)),
        node("scoy-mor-1",  "Mortar Section 1","section", S.mortar(E.section)),
        node("scoy-mor-2",  "Mortar Section 2","section", S.mortar(E.section)),
      ]),
      node("scoy-at",    "Anti-Tank Platoon",        "platoon", S.at(E.platoon), [
        node("scoy-at-hq", "AT Pl HQ",   "section", S.hq(E.section)),
        node("scoy-at-1",  "AT Section 1","section", S.at(E.section)),
        node("scoy-at-2",  "AT Section 2","section", S.at(E.section)),
      ]),
      node("scoy-snip",  "Sniper Platoon",            "platoon", S.snip(E.platoon), [
        node("scoy-snip-hq","Sniper Pl HQ", "section", S.hq(E.section)),
        node("scoy-snip-1", "Sniper Sec 1", "section", S.snip(E.section)),
      ]),
      node("scoy-pio",   "Assault Pioneer Platoon",  "platoon", S.pio(E.platoon), [
        node("scoy-pio-hq","Pioneer Pl HQ", "section", S.hq(E.section)),
        node("scoy-pio-1", "Pioneer Sec 1", "section", S.pio(E.section)),
        node("scoy-pio-2", "Pioneer Sec 2", "section", S.pio(E.section)),
      ]),
    ]),
  };

  // ────────────────────────────────────────────────────────────────────────
  // 4. HQ Company
  // ────────────────────────────────────────────────────────────────────────
  const hqCoy: HierarchyTemplate = {
    id: "htpl-hq-company",
    name: "HQ Company",
    description: "Coy HQ + Signals, RAP, Logistics, QM, REME. ~149 pax.",
    tags: ["headquarters", "company", "british"],
    createdAt: "2024-01-01T00:00:00.000Z",
    root: node("hqcoy-root", "HQ Company", "company", S.hq(E.company), [
      node("hqcoy-hq",   "Company HQ",         "section", S.hq(E.section)),
      node("hqcoy-sig",  "Signals Platoon",     "platoon", S.sig(E.platoon), [
        node("hqcoy-sig-hq","Sigs Pl HQ",   "section", S.hq(E.section)),
        node("hqcoy-sig-1", "Sigs Section 1","section", S.sig(E.section)),
        node("hqcoy-sig-2", "Sigs Section 2","section", S.sig(E.section)),
      ]),
      node("hqcoy-rap",  "Regimental Aid Post","platoon", S.med(E.platoon), [
        node("hqcoy-rap-hq","RAP HQ",      "section", S.hq(E.section)),
        node("hqcoy-rap-1", "Medical Sec", "section", S.med(E.section)),
      ]),
      node("hqcoy-log",  "Logistics Platoon",  "platoon", S.log(E.platoon), [
        node("hqcoy-log-hq","Log Pl HQ",   "section", S.hq(E.section)),
        node("hqcoy-log-1", "Log Section 1","section", S.log(E.section)),
        node("hqcoy-log-2", "Log Section 2","section", S.log(E.section)),
      ]),
      node("hqcoy-qm",   "QM Platoon",         "platoon", S.log(E.platoon), [
        node("hqcoy-qm-hq","QM Pl HQ",    "section", S.hq(E.section)),
        node("hqcoy-qm-1", "QM Section",  "section", S.log(E.section)),
      ]),
      node("hqcoy-reme", "REME Detachment",    "section", S.log(E.section)),
    ]),
  };

  // ────────────────────────────────────────────────────────────────────────
  // 5. Infantry Battalion (UIB) — full, accurate CompositionNode tree
  // ────────────────────────────────────────────────────────────────────────
  const uib: HierarchyTemplate = {
    id: "htpl-uib-full",
    name: "Infantry Battalion (UIB)",
    description: "Bn HQ + A, B, C Coy + Support Coy + HQ Coy. Full British UIB structure.",
    tags: ["infantry", "battalion", "british", "uib"],
    createdAt: "2024-01-01T00:00:00.000Z",
    root: node("uib-root", "1st Battalion", "battalion", S.inf(E.battalion), [
      node("uib-bn-hq", "Battalion HQ", "section", S.hq(E.section)),
      rifleCoy("uib", "A"),
      rifleCoy("uib", "B"),
      rifleCoy("uib", "C"),
      node("uib-scoy", "Support Company", "company", S.inf(E.company), [
        node("uib-scoy-hq",    "Company HQ",              "section", S.hq(E.section)),
        node("uib-recce",      "Reconnaissance Platoon",  "platoon", S.recce(E.platoon)),
        node("uib-mor",        "Mortar Platoon",           "platoon", S.mortar(E.platoon)),
        node("uib-at",         "Anti-Tank Platoon",        "platoon", S.at(E.platoon)),
        node("uib-snip",       "Sniper Platoon",            "platoon", S.snip(E.platoon)),
        node("uib-pio",        "Assault Pioneer Platoon",  "platoon", S.pio(E.platoon)),
      ]),
      node("uib-hqcoy", "HQ Company", "company", S.hq(E.company), [
        node("uib-hqcoy-hq",   "Company HQ",         "section", S.hq(E.section)),
        node("uib-sig",        "Signals Platoon",     "platoon", S.sig(E.platoon)),
        node("uib-rap",        "Regimental Aid Post","platoon", S.med(E.platoon)),
        node("uib-log",        "Logistics Platoon",  "platoon", S.log(E.platoon)),
        node("uib-qm",         "QM Platoon",         "platoon", S.log(E.platoon)),
        node("uib-reme",       "REME Detachment",    "section", S.log(E.section)),
      ]),
    ]),
  };

  // ────────────────────────────────────────────────────────────────────────
  // 6. Armoured Infantry Battalion (Warrior / Boxer)
  // ────────────────────────────────────────────────────────────────────────
  const armdInfBn: HierarchyTemplate = {
    id: "htpl-armd-inf-bn",
    name: "Armoured Infantry Battalion",
    description: "Mech infantry battalion with armoured coys. Boxer/Warrior equipped.",
    tags: ["mechanised", "battalion", "british", "armoured"],
    createdAt: "2024-01-01T00:00:00.000Z",
    root: node("aib-root", "Armoured Infantry Battalion", "battalion", S.mech(E.battalion), [
      node("aib-bn-hq", "Battalion HQ", "section", S.hq(E.section)),
      node("aib-acoy", "A Squadron", "company", S.mech(E.company), [
        node("aib-acoy-hq","Squadron HQ","section",S.hq(E.section)),
        node("aib-acoy-1", "1 Troop",   "platoon",S.mech(E.platoon)),
        node("aib-acoy-2", "2 Troop",   "platoon",S.mech(E.platoon)),
        node("aib-acoy-3", "3 Troop",   "platoon",S.mech(E.platoon)),
      ]),
      node("aib-bcoy", "B Squadron", "company", S.mech(E.company), [
        node("aib-bcoy-hq","Squadron HQ","section",S.hq(E.section)),
        node("aib-bcoy-1", "1 Troop",   "platoon",S.mech(E.platoon)),
        node("aib-bcoy-2", "2 Troop",   "platoon",S.mech(E.platoon)),
        node("aib-bcoy-3", "3 Troop",   "platoon",S.mech(E.platoon)),
      ]),
      node("aib-ccoy", "C Squadron", "company", S.mech(E.company), [
        node("aib-ccoy-hq","Squadron HQ","section",S.hq(E.section)),
        node("aib-ccoy-1", "1 Troop",   "platoon",S.mech(E.platoon)),
        node("aib-ccoy-2", "2 Troop",   "platoon",S.mech(E.platoon)),
        node("aib-ccoy-3", "3 Troop",   "platoon",S.mech(E.platoon)),
      ]),
      node("aib-hqsqn", "HQ Squadron", "company", S.hq(E.company), [
        node("aib-hqsqn-hq","Squadron HQ","section",S.hq(E.section)),
        node("aib-sig",     "Signals Tp", "platoon",S.sig(E.platoon)),
        node("aib-log",     "Log Tp",     "platoon",S.log(E.platoon)),
        node("aib-reme",    "REME Fitter Sect","section",S.log(E.section)),
      ]),
    ]),
  };

  // ────────────────────────────────────────────────────────────────────────
  // 7. Royal Artillery Battery
  // ────────────────────────────────────────────────────────────────────────
  const artBattery: HierarchyTemplate = {
    id: "htpl-arty-battery",
    name: "Artillery Battery",
    description: "Battery HQ + 2 firing troops + Command Post. AS90 / ARCHER equipped.",
    tags: ["artillery", "company", "british"],
    createdAt: "2024-01-01T00:00:00.000Z",
    root: node("arty-root", "Artillery Battery", "company", S.arty(E.company), [
      node("arty-hq",  "Battery HQ",        "section", S.hq(E.section)),
      node("arty-cp",  "Command Post",       "section", S.hq(E.section)),
      node("arty-tp1", "1 Firing Troop",     "platoon", S.arty(E.platoon), [
        node("arty-tp1-gun1","Gun 1","section",S.arty(E.section)),
        node("arty-tp1-gun2","Gun 2","section",S.arty(E.section)),
        node("arty-tp1-gun3","Gun 3","section",S.arty(E.section)),
      ]),
      node("arty-tp2", "2 Firing Troop",     "platoon", S.arty(E.platoon), [
        node("arty-tp2-gun1","Gun 4","section",S.arty(E.section)),
        node("arty-tp2-gun2","Gun 5","section",S.arty(E.section)),
        node("arty-tp2-gun3","Gun 6","section",S.arty(E.section)),
      ]),
      node("arty-ammo","Ammunition Section", "section", S.log(E.section)),
    ]),
  };

  // ────────────────────────────────────────────────────────────────────────
  // 8. Combat Engineer Squadron
  // ────────────────────────────────────────────────────────────────────────
  const engSquadron: HierarchyTemplate = {
    id: "htpl-engr-sqn",
    name: "Combat Engineer Squadron",
    description: "Sqn HQ + 2 field troops + support elements. Breaching and obstacle tasks.",
    tags: ["engineer", "company", "british"],
    createdAt: "2024-01-01T00:00:00.000Z",
    root: node("engr-root", "Combat Engineer Squadron", "company", S.engr(E.company), [
      node("engr-hq",  "Squadron HQ",       "section", S.hq(E.section)),
      node("engr-tp1", "1 Field Troop",     "platoon", S.engr(E.platoon), [
        node("engr-tp1-1","Breaching Section","section",S.engr(E.section)),
        node("engr-tp1-2","Plant Section",    "section",S.engr(E.section)),
      ]),
      node("engr-tp2", "2 Field Troop",     "platoon", S.engr(E.platoon), [
        node("engr-tp2-1","Breaching Section","section",S.engr(E.section)),
        node("engr-tp2-2","Plant Section",    "section",S.engr(E.section)),
      ]),
      node("engr-stores","Stores Section",  "section", S.log(E.section)),
    ]),
  };

  // ────────────────────────────────────────────────────────────────────────
  // 9. Armoured Brigade Combat Team
  // ────────────────────────────────────────────────────────────────────────
  const abct: HierarchyTemplate = {
    id: "htpl-abct",
    name: "Armoured Brigade Combat Team",
    description: "Brigade HQ + Armd Inf Bn + Armd Regt + Arty Regt + Engr Sqn + Sigs Sqn + Log Regt.",
    tags: ["armoured", "brigade", "british"],
    createdAt: "2024-01-01T00:00:00.000Z",
    root: node("bde-root", "Armoured Brigade", "brigade", S.armd(E.brigade), [
      node("bde-hq",      "Brigade HQ",                    "section",   S.hq(E.section)),
      node("bde-inf",     "Armoured Infantry Battalion",   "battalion", S.mech(E.battalion)),
      node("bde-armd",    "Armoured Regiment",             "battalion", S.armd(E.battalion)),
      node("bde-arty",    "Royal Artillery Regiment",      "battalion", S.arty(E.battalion), [
        node("bde-arty-hq","Regimental HQ","section",S.hq(E.section)),
        node("bde-arty-a", "A Battery",    "company",S.arty(E.company)),
        node("bde-arty-b", "B Battery",    "company",S.arty(E.company)),
        node("bde-arty-c", "C Battery",    "company",S.arty(E.company)),
      ]),
      node("bde-engr",    "Combat Engineer Regiment",      "battalion", S.engr(E.battalion)),
      node("bde-sig",     "Signals Squadron",              "company",   S.sig(E.company)),
      node("bde-log",     "Close Support Logistic Regt",  "battalion", S.log(E.battalion)),
    ]),
  };

  return [
    riflePlatoon,
    rifleCoyTpl,
    supportCoy,
    hqCoy,
    uib,
    armdInfBn,
    artBattery,
    engSquadron,
    abct,
  ];
}

// ── Default Group Template (UIB) ───────────────────────────────────────────

function buildUIBTemplate(): GroupTemplate {
  type N = GroupTemplateNode;
  const mk = (name: string, echelon: EchelonLevel, pax: number, icon: string, children: N[] = []): N =>
    ({ name, echelon, personnelCount: pax, notes: "", icon, children });
  const section  = (n: string, pax = 9): N  => mk(n, "section",  pax, "infantry");
  const plHQ     = (pfx: string): N         => mk(`${pfx} HQ`, "section", 9, "headquarters");
  const platoon  = (pfx: string): N         => mk(pfx, "platoon", 36, "infantry", [
    plHQ(pfx), section(`${pfx} Section 1`), section(`${pfx} Section 2`), section(`${pfx} Section 3`),
  ]);
  const rifleCoy = (letter: string): N      => mk(`Rifle Company ${letter}`, "company", 124, "infantry", [
    mk("Company HQ", "section", 16, "headquarters"),
    platoon("1st Platoon"), platoon("2nd Platoon"), platoon("3rd Platoon"),
  ]);
  return {
    id: "gt-uib-v1", name: "Infantry Battalion (UIB) — Full",
    description: "Complete infantry battalion: Bn HQ + 3× Rifle Coy + Support Coy + HQ Coy.",
    tags: ["infantry", "battalion", "british", "uib"], branch: "army", createdAt: now(),
    rootNodes: [
      mk("Battalion HQ", "battalion", 16, "headquarters"),
      rifleCoy("A"), rifleCoy("B"), rifleCoy("C"),
      mk("Support Company", "company", 152, "logistics", [
        mk("Company HQ", "section", 16, "headquarters"),
        mk("Reconnaissance Platoon",  "platoon", 24, "reconnaissance"),
        mk("Mortar Platoon",          "platoon", 45, "mortar"),
        mk("Anti-Tank Platoon",       "platoon", 33, "antiTank"),
        mk("Sniper Platoon",          "platoon", 16, "sniper"),
        mk("Assault Pioneer Platoon", "platoon", 19, "pioneer"),
      ]),
      mk("HQ Company", "company", 149, "headquarters", [
        mk("Company HQ",         "section", 16, "headquarters"),
        mk("Signals Platoon",    "platoon", 28, "signals"),
        mk("Regimental Aid Post","platoon", 20, "medical"),
        mk("Logistics Platoon",  "platoon", 20, "logistics"),
        mk("QM Platoon",         "platoon", 36, "logistics"),
        mk("REME Detachment",    "section", 38, "maintenance"),
      ]),
    ],
  };
}

// ── Persistence ────────────────────────────────────────────────────────────

function buildInitialState(): OrbatStoreState {
  return {
    groups: [],
    templates: buildDefaultTemplates(),
    groupTemplates: [buildUIBTemplate()],
    hierarchyTemplates: buildDefaultHierarchyTemplates(),
    forces: [],
  };
}

function loadFromStorage(): OrbatStoreState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as OrbatStoreState;
      // Migrate: ensure built-in hierarchy templates always present
      const defaults = buildDefaultHierarchyTemplates();
      const defaultIds = new Set(defaults.map((d) => d.id));
      const userTemplates = (parsed.hierarchyTemplates ?? []).filter((t) => !defaultIds.has(t.id));
      parsed.hierarchyTemplates = [...defaults, ...userTemplates];
      // Migrate: forces may not exist in older stored state
      if (!parsed.forces) parsed.forces = [];
      return parsed;
    }
  } catch { /* ignore */ }
  return buildInitialState();
}

function saveToStorage(state: OrbatStoreState): void {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }
}

// ── inputToNode ────────────────────────────────────────────────────────────

function inputToNode(input: Record<string, unknown>, affiliation: string, existingNode?: UnitNode): UnitNode {
  const capabilities = { ...(existingNode?.capabilities ?? {}), ...((input.capabilities as Record<string, unknown>) ?? {}) };
  return {
    id: existingNode?.id ?? uid(),
    name: (input.name as string) ?? existingNode?.name ?? "Unit",
    echelon: (input.echelon as EchelonLevel) ?? existingNode?.echelon ?? "section",
    personnelCount: (input.personnelCount as number) ?? existingNode?.personnelCount ?? 0,
    notes: (input.notes as string) ?? existingNode?.notes ?? "",
    symbol: {
      standardIdentity: affiliation,
      echelon: (input.echelon as EchelonLevel) ?? existingNode?.echelon ?? "section",
      icon: ((input.symbolIcon as UnitIconType) ?? existingNode?.symbol.icon ?? "infantry"),
      sector1:     (input.sector1     as string | undefined) ?? existingNode?.symbol.sector1,
      sector2:     (input.sector2     as string | undefined) ?? existingNode?.symbol.sector2,
      hqIndicator: (input.hqIndicator as string | undefined) ?? existingNode?.symbol.hqIndicator,
      reinforced:  (input.reinforced  as "+" | "-" | "±" | undefined) ?? existingNode?.symbol.reinforced,
      status:      (input.symbolStatus as string | undefined) ?? existingNode?.symbol.status,
    },
    capabilities,
    state: existingNode?.state ?? { status: "active", lastUpdated: now() },
    children: existingNode?.children ?? [],
    canonicalAssetKey: (input.canonicalAssetKey as string | null | undefined) ?? existingNode?.canonicalAssetKey  ?? null,
    unitTypeKey:       (input.unitTypeKey        as string | null | undefined) ?? existingNode?.unitTypeKey        ?? null,
    equipmentTypeKey:  (input.equipmentTypeKey   as string | null | undefined) ?? existingNode?.equipmentTypeKey   ?? null,
  };
}

function templateNodeToUnit(tn: GroupTemplateNode, affiliation: string): UnitNode {
  return {
    id: uid(), name: tn.name, echelon: tn.echelon, personnelCount: tn.personnelCount, notes: tn.notes,
    symbol: { standardIdentity: affiliation, echelon: tn.echelon, icon: (tn.icon as UnitIconType) ?? "infantry" },
    capabilities: {}, state: { status: "active", lastUpdated: now() },
    children: tn.children.map((c) => templateNodeToUnit(c, affiliation)),
  };
}

// ── Resolvers ──────────────────────────────────────────────────────────────

type Resolver = (args: Record<string, unknown>, state: OrbatStoreState, setState: (s: OrbatStoreState) => void) => unknown;

const RESOLVERS: Record<string, Resolver> = {
  createGroup: ({ input }, state, setState) => {
    const i = input as Record<string, string>;
    const g: UnitGroup = { id: uid(), name: i.name, affiliation: i.affiliation ?? "Friend", description: i.description ?? "", units: [] };
    setState({ ...state, groups: [...state.groups, g] });
    return g;
  },
  updateGroup: ({ groupId, input }, state, setState) => {
    const i = input as Record<string, string>;
    const updated = state.groups.map((g) => g.id === groupId ? { ...g, ...i } : g);
    setState({ ...state, groups: updated });
    return updated.find((g) => g.id === groupId) ?? null;
  },
  deleteGroup: ({ groupId }, state, setState) => {
    setState({ ...state, groups: state.groups.filter((g) => g.id !== groupId) });
    return true;
  },
  addUnit: ({ groupId, parentUnitId, input }, state, setState) => {
    const group = state.groups.find((g) => g.id === groupId)!;
    const newNode = inputToNode(input as Record<string, unknown>, group.affiliation);
    setState({ ...state, groups: state.groups.map((g) =>
      g.id !== groupId ? g : { ...g, units: upsertNode(g.units, newNode, (parentUnitId as string | null) ?? null) },
    )});
    return newNode;
  },
  wrapUnit: ({ groupId, targetUnitId, input }, state, setState) => {
    const group = state.groups.find((g) => g.id === groupId)!;
    const target = flattenTree(group.units).find((u) => u.id === targetUnitId);
    if (!target) return false;
    const wrapper: UnitNode = { ...inputToNode(input as Record<string, unknown>, group.affiliation), children: [target] };
    const replace = (nodes: UnitNode[]): UnitNode[] =>
      nodes.map((n) => n.id === targetUnitId ? wrapper : { ...n, children: replace(n.children) });
    setState({ ...state, groups: state.groups.map((g) => g.id !== groupId ? g : { ...g, units: replace(g.units) }) });
    return wrapper;
  },
  updateUnit: ({ groupId, unitId, input }, state, setState) => {
    const group    = state.groups.find((g) => g.id === groupId)!;
    const existing = flattenTree(group.units).find((u) => u.id === unitId);
    const updated  = { ...inputToNode(input as Record<string, unknown>, group.affiliation, existing), id: unitId as string };
    const parentId = findParentId(group.units, unitId as string);
    setState({ ...state, groups: state.groups.map((g) =>
      g.id !== groupId ? g : { ...g, units: upsertNode(g.units, updated, parentId) },
    )});
    return updated;
  },
  removeUnit: ({ groupId, unitId }, state, setState) => {
    setState({ ...state, groups: state.groups.map((g) =>
      g.id !== groupId ? g : { ...g, units: removeNode(g.units, unitId as string) },
    )});
    return true;
  },
  reorderUnit: ({ groupId, unitId, newParentId, position }, state, setState) => {
    const group = state.groups.find((g) => g.id === groupId)!;
    const node  = flattenTree(group.units).find((u) => u.id === unitId);
    if (!node) return false;
    const pos = position as number;
    let units = removeNode(group.units, unitId as string);
    if (!newParentId) {
      units = [...units.slice(0, pos), node, ...units.slice(pos)];
    } else {
      const ins = (nodes: UnitNode[]): UnitNode[] => nodes.map((n) => {
        if (n.id === newParentId) {
          const ch = removeNode(n.children, unitId as string);
          return { ...n, children: [...ch.slice(0, pos), node, ...ch.slice(pos)] };
        }
        return { ...n, children: ins(n.children) };
      });
      units = ins(units);
    }
    setState({ ...state, groups: state.groups.map((g) => g.id !== groupId ? g : { ...g, units }) });
    return true;
  },
  createTemplate: ({ input }, state, setState) => {
    const i = input as Record<string, unknown>;
    const t: UnitTemplate = {
      id: uid(), name: i.name as string, echelon: i.echelon as EchelonLevel,
      defaultPersonnelCount: (i.defaultPersonnelCount as number) ?? 0,
      description: (i.description as string) ?? "", tags: (i.tags as string[]) ?? [],
      defaultChildren: [], symbol: (i.symbol as UnitTemplate["symbol"]) ?? {},
    };
    setState({ ...state, templates: [...state.templates, t] });
    return t;
  },
  updateTemplate: ({ id, input }, state, setState) => {
    const i = input as Record<string, unknown>;
    const updated = state.templates.map((t) => t.id !== id ? t : {
      ...t,
      name:                  (i.name as string)                    ?? t.name,
      echelon:               (i.echelon as EchelonLevel)            ?? t.echelon,
      defaultPersonnelCount: (i.defaultPersonnelCount as number)   ?? t.defaultPersonnelCount,
      description:           (i.description as string)             ?? t.description,
      tags:                  (i.tags as string[])                   ?? t.tags,
      symbol:                (i.symbol as UnitTemplate["symbol"]) ?? t.symbol,
    });
    setState({ ...state, templates: updated });
    return updated.find((t) => t.id === id)!;
  },
  deleteTemplate: ({ id }, state, setState) => {
    setState({ ...state, templates: state.templates.filter((t) => t.id !== id) });
    return true;
  },
  saveGroupTemplate: ({ input }, state, setState) => {
    const i = input as Record<string, unknown>;
    const gt: GroupTemplate = {
      id: uid(), name: i.name as string, description: (i.description as string) ?? "",
      tags: (i.tags as string[]) ?? [], branch: i.branch as GroupTemplate["branch"],
      rootNodes: (i.rootNodes as GroupTemplateNode[]) ?? [], createdAt: now(),
    };
    setState({ ...state, groupTemplates: [...state.groupTemplates, gt] });
    return gt;
  },
  deleteGroupTemplate: ({ id }, state, setState) => {
    setState({ ...state, groupTemplates: state.groupTemplates.filter((t) => t.id !== id) });
    return true;
  },

  // ── Hierarchy template mutations (Build Hierarchy tab) ──────────────────
  saveHierarchyTemplate: ({ input }, state, setState) => {
    const i = input as Record<string, unknown>;
    const existingId = i.id as string | undefined;
    const existing = existingId
      ? (state.hierarchyTemplates ?? []).find((t) => t.id === existingId)
      : undefined;

    if (existing) {
      // Update existing template — preserve its id and createdAt, update root + metadata
      const updated = (state.hierarchyTemplates ?? []).map((t) =>
        t.id === existingId
          ? {
              ...t,
              name:        (i.name        as string)   ?? t.name,
              description: (i.description as string)   ?? t.description,
              tags:        (i.tags        as string[])  ?? t.tags,
              root:        (i.root        as CompositionNode) ?? t.root,
            }
          : t,
      );
      setState({ ...state, hierarchyTemplates: updated });
      return updated.find((t) => t.id === existingId);
    }

    // Create new template — assign fresh IDs to all nodes
    function reId(n: CompositionNode): CompositionNode {
      return { ...n, id: uid(), children: n.children.map(reId) };
    }
    const ht: HierarchyTemplate = {
      id: existingId ?? uid(),
      name:        (i.name        as string)   ?? "Unnamed",
      description: (i.description as string)   ?? "",
      tags:        (i.tags        as string[])  ?? [],
      createdAt:   now(),
      root:        reId(i.root as CompositionNode),
    };
    setState({ ...state, hierarchyTemplates: [...(state.hierarchyTemplates ?? []), ht] });
    return ht;
  },
  deleteHierarchyTemplate: ({ id }, state, setState) => {
    setState({ ...state, hierarchyTemplates: (state.hierarchyTemplates ?? []).filter((t) => t.id !== id) });
    return true;
  },

  // ── Force mutations ─────────────────────────────────────────────────────
  saveForce: ({ input }, state, setState) => {
    const i = input as Record<string, unknown>;
    const existing = (state.forces ?? []).find((f) => f.id === (i.id as string | undefined));
    if (existing) {
      // Update existing force (root changed)
      const updated = (state.forces ?? []).map((f) =>
        f.id === existing.id
          ? { ...f, root: i.root as CompositionNode, updatedAt: now(), name: (i.name as string) ?? f.name, affiliation: (i.affiliation as string) ?? f.affiliation }
          : f,
      );
      setState({ ...state, forces: updated });
      return existing;
    }
    // Create new force
    const force: Force = {
      id: (i.id as string) ?? uid(),
      name: (i.name as string) ?? "Unnamed Force",
      affiliation: (i.affiliation as string) ?? "Friend",
      description: (i.description as string) ?? "",
      createdAt: now(),
      updatedAt: now(),
      root: i.root as CompositionNode,
    };
    setState({ ...state, forces: [...(state.forces ?? []), force] });
    return force;
  },
  deleteForce: ({ id }, state, setState) => {
    setState({ ...state, forces: (state.forces ?? []).filter((f) => f.id !== id) });
    return true;
  },
  applyGroupTemplate: ({ groupId, templateId }, state, setState) => {
    const group = state.groups.find((g) => g.id === groupId);
    const gt    = state.groupTemplates.find((t) => t.id === templateId);
    if (!group || !gt) return false;
    const newUnits = gt.rootNodes.map((tn) => templateNodeToUnit(tn, group.affiliation));
    setState({ ...state, groups: state.groups.map((g) =>
      g.id !== groupId ? g : { ...g, units: [...g.units, ...newUnits] },
    )});
    return true;
  },
};

// ── Query runner ───────────────────────────────────────────────────────────

function parseOperationName(source: string): string | null {
  const src = source.replace(/#[^\n]*/g, "").trim();
  const m = src.match(/(?:query|mutation|subscription)?\s*(?:[a-zA-Z_]\w*)?\s*(?:\([^)]*\))?\s*\{\s*([a-zA-Z_]\w*)/);
  return m?.[1] ?? null;
}

async function executeQuery(
  query: string, variables: Record<string, unknown>,
  getState: () => OrbatStoreState, setState: (s: OrbatStoreState) => void,
): Promise<unknown> {
  const opName = parseOperationName(query);
  if (!opName) throw new Error("Could not parse operation name");
  const resolver = RESOLVERS[opName];
  if (!resolver) throw new Error(`Unknown operation: ${opName}`);
  return resolver(variables, getState(), setState);
}

// ── Hook ───────────────────────────────────────────────────────────────────

export interface OrbatStore {
  state: OrbatStoreState;
  runQuery: (query: string, variables?: Record<string, unknown>) => Promise<unknown>;
  resetStore: () => void;
}

export function useOrbatStore(): OrbatStore {
  const [state, setState] = useState<OrbatStoreState>(() => loadFromStorage());
  const stateRef = useRef<OrbatStoreState>(state);
  stateRef.current = state;

  const setStateAndPersist = useCallback((newState: OrbatStoreState) => {
    const cloned = deepClone(newState);
    saveToStorage(cloned);
    setState(cloned);
  }, []);

  const runQuery = useCallback(
    async (query: string, variables: Record<string, unknown> = {}) =>
      executeQuery(query, variables, () => stateRef.current, setStateAndPersist),
    [setStateAndPersist],
  );

  const resetStore = useCallback(() => {
    const fresh = buildInitialState();
    saveToStorage(fresh);
    setState(fresh);
  }, []);

  return { state, runQuery, resetStore };
}

