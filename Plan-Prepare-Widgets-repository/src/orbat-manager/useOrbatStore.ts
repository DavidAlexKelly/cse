// ============================================================
//  Central State Hook — sessionStorage persistence + query bridge
// ============================================================

import { useState, useCallback, useRef } from "react";
import type {
  StoreState,
  UnitNode,
  UnitTemplate,
  GroupTemplate,
} from "./types.js";
import { executeQuery, type GqlResult } from "./graphqlSchema.js";

const STORAGE_KEY = "orbat_store_v6";

// ---- Default Templates ----
function buildDefaultTemplates(): UnitTemplate[] {
  const defs: Array<{
    id: string;
    name: string;
    echelon: UnitTemplate["echelon"];
    pax: number;
    desc: string;
    tags: string[];
  }> = [
    {
      id: "tpl-section",
      name: "Rifle Section",
      echelon: "section",
      pax: 9,
      desc: "9 pax. Basic infantry building block.",
      tags: ["infantry", "section", "british"],
    },
    {
      id: "tpl-platoon-hq",
      name: "Platoon HQ",
      echelon: "section",
      pax: 9,
      desc: "Platoon commander, sergeant, signaller etc.",
      tags: ["headquarters", "platoon", "british"],
    },
    {
      id: "tpl-platoon-rifle",
      name: "Rifle Platoon",
      echelon: "platoon",
      pax: 36,
      desc: "Platoon HQ + 3 rifle sections.",
      tags: ["infantry", "platoon", "british"],
    },
    {
      id: "tpl-company-hq",
      name: "Company HQ",
      echelon: "section",
      pax: 16,
      desc: "Company commander, 2IC, CSM, admin cell.",
      tags: ["headquarters", "company", "british"],
    },
    {
      id: "tpl-company-rifle",
      name: "Rifle Company",
      echelon: "company",
      pax: 124,
      desc: "Coy HQ + 3 rifle platoons.",
      tags: ["infantry", "company", "british"],
    },
    {
      id: "tpl-support-coy",
      name: "Support Company",
      echelon: "company",
      pax: 152,
      desc: "Coy HQ + Recce Pl + Mortar Pl + AT Pl + Sniper Pl + Pnr Pl.",
      tags: ["support", "company", "british"],
    },
    {
      id: "tpl-hq-coy",
      name: "HQ Company",
      echelon: "company",
      pax: 149,
      desc: "Coy HQ + Sigs Pl + RAP + Log Pl + QM Pl + REME Det.",
      tags: ["headquarters", "company", "british"],
    },
    {
      id: "tpl-bn-inf",
      name: "Infantry Battalion",
      echelon: "battalion",
      pax: 700,
      desc: "Bn HQ + 3 Rifle Coy + Sp Coy + HQ Coy.",
      tags: ["infantry", "battalion", "british"],
    },
    {
      id: "tpl-recce-pl",
      name: "Reconnaissance Platoon",
      echelon: "platoon",
      pax: 24,
      desc: "24 pax. Mounted or dismounted recce.",
      tags: ["reconnaissance", "platoon", "british"],
    },
    {
      id: "tpl-mortar-pl",
      name: "Mortar Platoon",
      echelon: "platoon",
      pax: 45,
      desc: "45 pax. 81mm or 120mm mortar fire support.",
      tags: ["mortar", "platoon", "british"],
    },
    {
      id: "tpl-at-pl",
      name: "Anti-Tank Platoon",
      echelon: "platoon",
      pax: 33,
      desc: "33 pax. ATGM / NLAW equipped.",
      tags: ["antiTank", "platoon", "british"],
    },
    {
      id: "tpl-sniper-pl",
      name: "Sniper Platoon",
      echelon: "platoon",
      pax: 16,
      desc: "16 pax. Long-range precision fire.",
      tags: ["sniper", "platoon", "british"],
    },
    {
      id: "tpl-pioneer-pl",
      name: "Assault Pioneer Platoon",
      echelon: "platoon",
      pax: 19,
      desc: "19 pax. Combat engineering, breaching, obstacles.",
      tags: ["pioneer", "platoon", "british"],
    },
    {
      id: "tpl-sigs-pl",
      name: "Signals Platoon",
      echelon: "platoon",
      pax: 28,
      desc: "28 pax. Communications and electronic warfare support.",
      tags: ["signals", "platoon", "british"],
    },
    {
      id: "tpl-rap",
      name: "Regimental Aid Post",
      echelon: "platoon",
      pax: 20,
      desc: "20 pax. Forward medical care and casualty evacuation.",
      tags: ["medical", "platoon", "british"],
    },
    {
      id: "tpl-log-pl",
      name: "Logistics Platoon",
      echelon: "platoon",
      pax: 20,
      desc: "20 pax. Forward supply and resupply operations.",
      tags: ["logistics", "platoon", "british"],
    },
    {
      id: "tpl-qm-pl",
      name: "QM Platoon",
      echelon: "platoon",
      pax: 36,
      desc: "36 pax. Quartermaster stores and equipment.",
      tags: ["logistics", "platoon", "british"],
    },
    {
      id: "tpl-reme-det",
      name: "REME Detachment",
      echelon: "section",
      pax: 38,
      desc: "38 pax. Forward repair and recovery.",
      tags: ["maintenance", "section", "british"],
    },
    {
      id: "tpl-bn-armoured",
      name: "Armoured Infantry Bn",
      echelon: "battalion",
      pax: 732,
      desc: "Warrior IFV-equipped armoured infantry battalion.",
      tags: ["armoured", "battalion", "british"],
    },
    {
      id: "tpl-bn-mech",
      name: "Mechanised Infantry Bn",
      echelon: "battalion",
      pax: 709,
      desc: "Boxer MIV-equipped mechanised infantry battalion.",
      tags: ["mechanised", "battalion", "british"],
    },
    {
      id: "tpl-brigade",
      name: "Armoured Brigade",
      echelon: "brigade",
      pax: 4000,
      desc: "Armoured Brigade Combat Team.",
      tags: ["armoured", "brigade", "british"],
    },
  ];

  return defs.map((d) => ({
    id: d.id,
    name: d.name,
    echelon: d.echelon,
    defaultPersonnelCount: d.pax,
    description: d.desc,
    tags: d.tags,
    defaultChildren: [],
    symbol: {},
    defaultEquipment: [],
  }));
}

// ---- Universal Infantry Battalion GroupTemplate ----
function buildUIBTemplate(): GroupTemplate {
  type N = GroupTemplate["rootNodes"][0];

  const mk = (
    name: string,
    echelon: UnitNode["echelon"],
    pax: number,
    icon: string,
    children: N[] = []
  ): N => ({ name, echelon, personnelCount: pax, notes: "", icon, children });

  const section = (n: string, pax = 9) => mk(n, "section", pax, "infantry");
  const plHQ = (pfx: string) => mk(`${pfx} HQ`, "section", 9, "headquarters");

  const platoon = (pfx: string) =>
    mk(pfx, "platoon", 36, "infantry", [
      plHQ(pfx),
      section(`${pfx} Section 1`),
      section(`${pfx} Section 2`),
      section(`${pfx} Section 3`),
    ]);

  const rifleCoy = (letter: string) =>
    mk(`Rifle Company ${letter}`, "company", 124, "infantry", [
      mk(`Company HQ`, "section", 16, "headquarters"),
      platoon(`1st Platoon`),
      platoon(`2nd Platoon`),
      platoon(`3rd Platoon`),
    ]);

  return {
    id: "gt-uib-v2",
    name: "Infantry Battalion (UIB) — Full",
    description:
      "Complete 1,696-pax infantry battalion: Bn HQ + 3× Rifle Coy + Support Coy + HQ Coy. Accurate section/platoon/company structure.",
    tags: ["infantry", "battalion", "british", "uib"],
    branch: "army",
    createdAt: new Date().toISOString(),
    rootNodes: [
      mk("Battalion HQ", "battalion", 16, "headquarters"),
      rifleCoy("A"),
      rifleCoy("B"),
      rifleCoy("C"),
      mk("Support Company", "company", 152, "logistics", [
        mk("Company HQ", "section", 16, "headquarters"),
        mk("Reconnaissance Platoon", "platoon", 24, "reconnaissance"),
        mk("Mortar Platoon", "platoon", 45, "mortar"),
        mk("Anti-Tank Platoon", "platoon", 33, "antiTank"),
        mk("Sniper Platoon", "platoon", 16, "sniper"),
        mk("Assault Pioneer Platoon", "platoon", 19, "pioneer"),
      ]),
      mk("HQ Company", "company", 149, "headquarters", [
        mk("Company HQ", "section", 16, "headquarters"),
        mk("Signals Platoon", "platoon", 28, "signals"),
        mk("Regimental Aid Post", "platoon", 20, "medical"),
        mk("Logistics Platoon", "platoon", 20, "logistics"),
        mk("QM Platoon", "platoon", 36, "logistics"),
        mk("REME Detachment", "section", 38, "maintenance"),
      ]),
    ],
  };
}

// ---- Initial State ----
function buildInitialState(): StoreState {
  return {
    sides: [],
    templates: buildDefaultTemplates(),
    groupTemplates: [buildUIBTemplate()],
  };
}

function loadFromStorage(): StoreState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoreState;
  } catch {
    // ignore
  }
  return buildInitialState();
}

function saveToStorage(state: StoreState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // quota exceeded etc.
  }
}

// ---- Deep clone for immutability ----
function deepClone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val));
}

// ---- Hook ----
export interface OrbatStore {
  state: StoreState;
  runQuery: (
    query: string,
    variables?: Record<string, unknown>
  ) => Promise<GqlResult>;
  resetStore: () => void;
}

export function useOrbatStore(): OrbatStore {
  const [state, setState] = useState<StoreState>(() => loadFromStorage());

  // Keep a ref so executeQuery always reads the latest state without
  // being included in useCallback dependency arrays — eliminates the
  // cascade of handler re-creations on every mutation.
  const stateRef = useRef<StoreState>(state);
  stateRef.current = state;

  const setStateAndPersist = useCallback((newState: StoreState) => {
    const cloned = deepClone(newState);
    saveToStorage(cloned);
    setState(cloned);
  }, []);

  const runQuery = useCallback(
    async (query: string, variables: Record<string, unknown> = {}) => {
      return executeQuery(
        query,
        variables,
        () => stateRef.current,
        (ns) => setStateAndPersist(ns)
      );
    },
    // stateRef is stable (same object reference), so runQuery never
    // needs to be recreated — only setStateAndPersist matters here.
    [setStateAndPersist]
  );

  const resetStore = useCallback(() => {
    const fresh = buildInitialState();
    saveToStorage(fresh);
    setState(fresh);
  }, []);

  return { state, runQuery, resetStore };
}
