// scenarioPlanning/unitTemplates.ts — Map Items catalogue.
//
// Architecture
// ─────────────
// Instead of a flat list of individual entries (Infantry Brigade, Infantry
// Battalion, …) the catalogue is structured as:
//
//   UNIT_ARCHETYPES  — "what type of unit is it?"
//                      Carries the SIDC function-ID fragment, domain,
//                      category, canonical keywords and a representative
//                      base SIDC (no echelon) used for palette icon previews.
//
//   ALL_ECHELONS     — ordered list of echelons the UI offers.
//                      Each archetype declares which echelon labels it supports.
//
// At pick-time the UI builds a concrete UnitTemplate on the fly:
//   archetype SIDC + echelon glyph → final 15-char SIDC.

import type { UnitTemplate } from "./types";

// ── SIDC builder ───────────────────────────────────────────────────────────────

function buildTemplateSidc(
  functionId: string,   // up to 6 chars e.g. "UCI---" or "MHA"
  echelonGlyph: string, // single char A-M or ""
  dim: "G" | "A" | "S" | "U" | "P" = "G",
): string {
  const fn6 = (functionId + "------").slice(0, 6);
  const g = echelonGlyph || "-";
  return `SF${dim}P${fn6}-${g}---`;
}

// ── Echelon definitions ────────────────────────────────────────────────────────

export type EchelonGroupId =
  | "strategic"
  | "operational"
  | "tactical"
  | "subunit"
  | "platform";

export interface EchelonOption {
  label: string;
  echelonValue: string;
  glyph: string;
  group: EchelonGroupId;
}

export const ALL_ECHELONS: EchelonOption[] = [
  { label: "Army",                  echelonValue: "Army",        glyph: "K", group: "strategic" },
  { label: "Corps",                 echelonValue: "Corps",       glyph: "J", group: "strategic" },
  { label: "Division",              echelonValue: "Division",    glyph: "I", group: "strategic" },
  { label: "Brigade",               echelonValue: "Brigade",     glyph: "H", group: "operational" },
  { label: "Regiment",              echelonValue: "Regiment",    glyph: "G", group: "operational" },
  { label: "Wing",                  echelonValue: "Wing",        glyph: "H", group: "operational" },
  { label: "Battalion",             echelonValue: "Battalion",   glyph: "F", group: "tactical" },
  { label: "Squadron",              echelonValue: "Squadron",    glyph: "F", group: "tactical" },
  { label: "Company",               echelonValue: "Company",     glyph: "E", group: "tactical" },
  { label: "Battery",               echelonValue: "Battery",     glyph: "E", group: "tactical" },
  { label: "Troop",                 echelonValue: "Troop",       glyph: "E", group: "tactical" },
  { label: "Platoon",               echelonValue: "Platoon",     glyph: "D", group: "subunit" },
  { label: "Flight",                echelonValue: "Flight",      glyph: "D", group: "subunit" },
  { label: "Detachment",            echelonValue: "Detachment",  glyph: "D", group: "subunit" },
  { label: "Section",               echelonValue: "Section",     glyph: "C", group: "subunit" },
  { label: "Squad",                 echelonValue: "Squad",       glyph: "B", group: "subunit" },
  { label: "Team",                  echelonValue: "Team",        glyph: "A", group: "subunit" },
  { label: "Crew",                  echelonValue: "Crew",        glyph: "A", group: "subunit" },
  { label: "Platform / Individual", echelonValue: "",            glyph: "-", group: "platform" },
];

// ── Unit archetype ─────────────────────────────────────────────────────────────

export interface UnitArchetype {
  id: string;
  label: string;
  description: string;
  functionId: string;
  /** Battle dimension: Ground, Air, Sea surface, Subsurface, sPace. */
  dim: "G" | "A" | "S" | "U" | "P";
  category: UnitTemplate["category"];
  militaryService: UnitTemplate["militaryService"];
  entityType: UnitTemplate["entityType"];
  echelons: string[];
  keywords?: string[];
}

export function archetypeBaseSidc(a: UnitArchetype): string {
  return buildTemplateSidc(a.functionId, "-", a.dim);
}

export function archetypeSidcForEchelon(a: UnitArchetype, echelon: EchelonOption): string {
  return buildTemplateSidc(a.functionId, echelon.glyph, a.dim);
}

export function getEchelonsForArchetype(a: UnitArchetype): EchelonOption[] {
  if (a.echelons.length === 0) return ALL_ECHELONS;
  return ALL_ECHELONS.filter((e) => a.echelons.includes(e.label));
}

// ── Catalogue ──────────────────────────────────────────────────────────────────

export const UNIT_ARCHETYPES: UnitArchetype[] = [
  // HQ
  { id: "hq", label: "Headquarters", description: "Command element — any echelon",
    functionId: "UH----", dim: "G", category: "HQ", militaryService: "Army", entityType: "organisation",
    echelons: ["Army","Corps","Division","Brigade","Regiment","Battalion","Company","Platoon"],
    keywords: ["command","hq","cp","command post"] },

  // Infantry
  { id: "infantry", label: "Infantry", description: "Dismounted / light infantry",
    functionId: "UCI---", dim: "G", category: "Infantry", militaryService: "Army", entityType: "organisation",
    echelons: ["Division","Brigade","Regiment","Battalion","Company","Platoon","Section","Squad","Team","Platform / Individual"],
    keywords: ["rifle","foot","light","dismounted"] },
  { id: "mech-infantry", label: "Mechanised Infantry", description: "Armoured / mechanised infantry (IFV-borne)",
    functionId: "UCIZ--", dim: "G", category: "Infantry", militaryService: "Army", entityType: "organisation",
    echelons: ["Brigade","Battalion","Company","Platoon","Section","Platform / Individual"],
    keywords: ["ifv","apc","warrior","bradley","puma","cv90","mechanized"] },
  { id: "airborne", label: "Airborne Infantry", description: "Parachute / air assault infantry",
    functionId: "UCIA--", dim: "G", category: "Infantry", militaryService: "Army", entityType: "organisation",
    echelons: ["Division","Brigade","Battalion","Company","Platoon","Section","Team"],
    keywords: ["para","parachute","82nd","101st","airmobile","air assault"] },
  { id: "marine", label: "Marine Infantry", description: "Naval infantry / marines",
    functionId: "UCIM--", dim: "G", category: "Infantry", militaryService: "Marines", entityType: "organisation",
    echelons: ["Division","Brigade","Regiment","Battalion","Company","Platoon","Section","Team"],
    keywords: ["marines","naval infantry","amphibious","usmc","rm"] },
  { id: "sniper", label: "Sniper", description: "Sniper / sharpshooter element",
    functionId: "UUI---", dim: "G", category: "Infantry", militaryService: "Army", entityType: "organisation",
    echelons: ["Section","Squad","Team","Platform / Individual"],
    keywords: ["sniper","marksman","designated marksman"] },
  { id: "anti-tank", label: "Anti-Tank", description: "Anti-armour / ATGM element",
    functionId: "UCIAT-", dim: "G", category: "Infantry", militaryService: "Army", entityType: "organisation",
    echelons: ["Company","Platoon","Section","Team"],
    keywords: ["atgm","javelin","kornet","milan","anti-armor","anti armour"] },

  { id: "motor-rifle", label: "Motor Rifle", description: "Motorised rifle unit (OPFOR manoeuvre formation)",
    functionId: "UCIM--", dim: "G", category: "Infantry", militaryService: "Army", entityType: "organisation",
    echelons: ["Division","Brigade","Regiment","Battalion","Company","Platoon"],
    keywords: ["motor rifle","mrbde","mrb","bmp","btr","opfor","motorised"] },

  // Armour
  { id: "armour", label: "Armour", description: "Main battle tank (MBT) unit",
    functionId: "UCA---", dim: "G", category: "Armour", militaryService: "Army", entityType: "organisation",
    echelons: ["Brigade","Regiment","Battalion","Company","Troop","Platform / Individual"],
    keywords: ["tank","mbt","challenger","abrams","leopard","t-72","t-80","t-90","armored"] },
  { id: "cavalry", label: "Cavalry", description: "Armoured cavalry / dragoons",
    functionId: "UCAV--", dim: "G", category: "Armour", militaryService: "Army", entityType: "organisation",
    echelons: ["Regiment","Battalion","Squadron","Troop","Section"],
    keywords: ["cavalry","dragoon","hussar","lancer"] },

  // Recce
  { id: "recce", label: "Reconnaissance", description: "Armoured / light reconnaissance",
    functionId: "UCR---", dim: "G", category: "Recce", militaryService: "Army", entityType: "organisation",
    echelons: ["Regiment","Squadron","Platoon","Section","Platform / Individual"],
    keywords: ["recce","reconnaissance","scout","surveillance","fsr"] },
  { id: "recce-ground-sensor", label: "Ground Surveillance", description: "Ground surveillance / sensor team",
    functionId: "UUR---", dim: "G", category: "Recce", militaryService: "Army", entityType: "organisation",
    echelons: ["Platoon","Section","Team"],
    keywords: ["sensor","surveillance","isr","gsr","ground sensor"] },

  // Artillery
  { id: "artillery", label: "Artillery (Field)", description: "Field artillery — towed or SP howitzer",
    functionId: "UCF---", dim: "G", category: "Artillery", militaryService: "Army", entityType: "organisation",
    echelons: ["Brigade","Regiment","Battalion","Battery","Platoon","Platform / Individual"],
    keywords: ["artillery","howitzer","gun","sp","field","royal artillery"] },
  { id: "rocket-artillery", label: "Rocket Artillery", description: "Multiple-launch rocket system (MLRS / HIMARS)",
    functionId: "UCFR--", dim: "G", category: "Artillery", militaryService: "Army", entityType: "organisation",
    echelons: ["Battalion","Battery","Platoon","Platform / Individual"],
    keywords: ["mlrs","himars","rocket","bm-21","grad","smerch"] },
  { id: "mortar", label: "Mortar", description: "Mortar platoon / section",
    functionId: "UCFM--", dim: "G", category: "Artillery", militaryService: "Army", entityType: "organisation",
    echelons: ["Company","Platoon","Section","Team"],
    keywords: ["mortar","81mm","120mm"] },
  { id: "coastal-arty", label: "Coastal Artillery", description: "Coastal / shore-based fire support",
    functionId: "UCFC--", dim: "G", category: "Artillery", militaryService: "Navy", entityType: "organisation",
    echelons: ["Regiment","Battalion","Battery"],
    keywords: ["coastal","shore","littoral"] },

  { id: "srbm", label: "Surface-to-Surface Missile", description: "Short-range ballistic missile unit (Iskander-M class)",
    functionId: "UCFS--", dim: "G", category: "Artillery", militaryService: "Army", entityType: "organisation",
    echelons: ["Brigade","Regiment","Battalion","Battery"],
    keywords: ["srbm","ssm","iskander","ballistic","missile","long-range strike"] },
  { id: "coastal-defence-missile", label: "Coastal Defence Missile", description: "Anti-ship coastal defence missile battery (Bastion-P class)",
    functionId: "UCFC--", dim: "G", category: "Artillery", militaryService: "Navy", entityType: "organisation",
    echelons: ["Brigade","Regiment","Battalion","Battery"],
    keywords: ["coastal defence","bastion","anti-ship","asm","shore based"] },

  // Air Defence
  { id: "air-defence", label: "Air Defence", description: "Ground-based air defence (GBAD)",
    functionId: "UCD---", dim: "G", category: "Air Defence", militaryService: "Air Defense Force", entityType: "organisation",
    echelons: ["Brigade","Regiment","Battalion","Battery","Platoon","Section"],
    keywords: ["gbad","shorad","himad","patriot","iris-t","rapier","buk","s-300","s-400","sam"] },
  { id: "air-defence-manpads", label: "MANPADS", description: "Man-portable air-defence system team",
    functionId: "UCDM--", dim: "G", category: "Air Defence", militaryService: "Air Defense Force", entityType: "organisation",
    echelons: ["Section","Team","Platform / Individual"],
    keywords: ["manpads","stinger","starstreak","igla","mistral","portable","shoulder"] },

  { id: "air-defence-sam", label: "SAM (Long-Range)", description: "Strategic surface-to-air missile system (S-400 / Patriot class)",
    functionId: "UCDM--", dim: "G", category: "Air Defence", militaryService: "Air Defense Force", entityType: "organisation",
    echelons: ["Brigade","Regiment","Battalion","Battery"],
    keywords: ["sam","s-400","s400","patriot","iads","surface-to-air","long range"] },

  // Aviation
  { id: "helo-attack", label: "Attack Helicopter", description: "Armed attack rotorcraft (AH-64, Tiger, Ka-52…)",
    functionId: "MHA---", dim: "A", category: "Aviation", militaryService: "Army", entityType: "aircraft",
    echelons: ["Squadron","Battalion","Flight","Platform / Individual"],
    keywords: ["attack helo","apache","tiger","ka52","mi28","ah-64","armed rotary"] },
  { id: "helo-utility", label: "Utility Helicopter", description: "Utility / transport rotorcraft (UH-60, NH90, Chinook…)",
    functionId: "MHU---", dim: "A", category: "Aviation", militaryService: "Army", entityType: "aircraft",
    echelons: ["Squadron","Battalion","Flight","Platform / Individual"],
    keywords: ["uh-60","blackhawk","nh90","chinook","puma","merlin","transport helo"] },
  { id: "helo-scout", label: "Reconnaissance Helicopter", description: "Observation / scout rotorcraft",
    functionId: "MHS---", dim: "A", category: "Aviation", militaryService: "Army", entityType: "aircraft",
    echelons: ["Squadron","Flight","Platform / Individual"],
    keywords: ["scout helo","oh-58","gazelle","lynx","recce helo"] },
  { id: "fixed-wing-fighter", label: "Fighter Aircraft", description: "Fixed-wing fighter / air superiority",
    functionId: "MFF---", dim: "A", category: "Aviation", militaryService: "Air Force", entityType: "aircraft",
    echelons: ["Wing","Squadron","Flight","Platform / Individual"],
    keywords: ["f-16","f-35","eurofighter","rafale","su-27","mig-29","fighter","jet"] },
  { id: "fixed-wing-attack", label: "Attack Aircraft", description: "Fixed-wing strike / close air support",
    functionId: "MFA---", dim: "A", category: "Aviation", militaryService: "Air Force", entityType: "aircraft",
    echelons: ["Wing","Squadron","Flight","Platform / Individual"],
    keywords: ["a-10","su-25","harrier","strike","cas","close air support","ground attack"] },
  { id: "fixed-wing-bomber", label: "Bomber", description: "Strategic / tactical bomber",
    functionId: "MFB---", dim: "A", category: "Aviation", militaryService: "Air Force", entityType: "aircraft",
    echelons: ["Wing","Squadron","Flight","Platform / Individual"],
    keywords: ["b-52","b-2","tu-95","tupolev","bomber","strategic"] },

  // UAS
  { id: "uas-recce", label: "UAS — Reconnaissance", description: "Reconnaissance / ISR unmanned aerial system",
    functionId: "MFQ---", dim: "A", category: "UAS", militaryService: "Army", entityType: "aircraft",
    echelons: ["Company","Platoon","Section","Team","Platform / Individual"],
    keywords: ["uas","uav","drone","isr","predator","reaper","watchkeeper","heron"] },
  { id: "uas-strike", label: "UAS — Strike", description: "Armed / loitering munition UAS",
    functionId: "MFQA--", dim: "A", category: "UAS", militaryService: "Army", entityType: "aircraft",
    echelons: ["Company","Platoon","Platform / Individual"],
    keywords: ["armed uas","loitering munition","switchblade","harop","bayraktar","kamikaze drone","strike drone"] },
  { id: "uas-ew", label: "UAS — Electronic Warfare", description: "EW / jamming unmanned aerial system",
    functionId: "MFQE--", dim: "A", category: "UAS", militaryService: "Army", entityType: "aircraft",
    echelons: ["Platoon","Team","Platform / Individual"],
    keywords: ["ew uas","jammer","electronic warfare","jamming","ew drone"] },

  // Space
  { id: "satellite-isr", label: "ISR Satellite", description: "Space-based ISR platform (imagery / SIGINT)",
    functionId: "SS----", dim: "P", category: "UAS", militaryService: "Other", entityType: "vehicle",
    echelons: ["Platform / Individual"],
    keywords: ["satellite","space","isr","overhead","imint","sigint"] },

  // Engineer
  { id: "engineer", label: "Engineer", description: "Combat engineer / sapper",
    functionId: "UCE---", dim: "G", category: "Engineer", militaryService: "Army", entityType: "organisation",
    echelons: ["Brigade","Regiment","Battalion","Company","Platoon","Section"],
    keywords: ["engineer","sapper","combat engineer","pioneer","breaching","bridging"] },
  { id: "engineer-bridge", label: "Bridge Engineer", description: "Bridging / gap-crossing engineer unit",
    functionId: "UCEB--", dim: "G", category: "Engineer", militaryService: "Army", entityType: "organisation",
    echelons: ["Battalion","Company","Platoon"],
    keywords: ["bridge","bridging","gap crossing","float bridge","ribbon bridge"] },
  { id: "engineer-construction", label: "Construction Engineer", description: "Construction / route engineering",
    functionId: "UCEC--", dim: "G", category: "Engineer", militaryService: "Army", entityType: "organisation",
    echelons: ["Battalion","Company","Platoon","Section"],
    keywords: ["construction","field engineering","route clearance","clearance"] },

  // Signal
  { id: "signal", label: "Signal", description: "Communications / signal unit",
    functionId: "UCS---", dim: "G", category: "Signal", militaryService: "Army", entityType: "organisation",
    echelons: ["Brigade","Battalion","Company","Platoon"],
    keywords: ["signal","signals","comms","communications","radio","satcom"] },
  { id: "cyber-ew", label: "Cyber / EW", description: "Cyber and electronic warfare unit",
    functionId: "USC---", dim: "G", category: "Signal", militaryService: "Army", entityType: "organisation",
    echelons: ["Battalion","Company","Platoon","Team"],
    keywords: ["cyber","ew","electronic warfare","jammer","sigint","ew unit"] },

  // CBRN
  { id: "cbrn", label: "CBRN", description: "Chemical, Biological, Radiological, Nuclear defence",
    functionId: "UCL---", dim: "G", category: "CBRN", militaryService: "Army", entityType: "organisation",
    echelons: ["Battalion","Company","Platoon","Section"],
    keywords: ["cbrn","chemical","biological","radiological","nuclear","nbc","decontamination","decon"] },

  // Medical
  { id: "medical", label: "Medical", description: "Medical / health service support",
    functionId: "USM---", dim: "G", category: "Medical", militaryService: "Medical Service", entityType: "organisation",
    echelons: ["Brigade","Battalion","Company","Platoon","Team"],
    keywords: ["medical","medic","health","hospital","aid station","casevac","medevac","aeromedical"] },

  // Logistics
  { id: "logistics", label: "Logistics / Supply", description: "Sustainment, supply and transport",
    functionId: "USS---", dim: "G", category: "Logistics", militaryService: "Logistics Service", entityType: "organisation",
    echelons: ["Brigade","Battalion","Company","Platoon","Platform / Individual"],
    keywords: ["logistics","supply","transport","support","css","sustainment","fuel","ammunition","ammo"] },
  { id: "maintenance", label: "Maintenance", description: "Repair, recovery and maintenance unit",
    functionId: "USM---", dim: "G", category: "Logistics", militaryService: "Logistics Service", entityType: "organisation",
    echelons: ["Battalion","Company","Platoon"],
    keywords: ["maintenance","reme","repair","recovery","wrecker","fitters"] },

  // Special Forces
  { id: "special-forces", label: "Special Forces", description: "Special operations forces (SOF)",
    functionId: "USF---", dim: "G", category: "Special Forces", militaryService: "Special Operations Force", entityType: "organisation",
    echelons: ["Regiment","Squadron","Troop","Detachment","Team"],
    keywords: ["sof","sas","delta","seal","special forces","ranger","commando","sf"] },

  // Military Police
  { id: "mp", label: "Military Police", description: "Military police / provost",
    functionId: "UCM---", dim: "G", category: "Military Police", militaryService: "Military Police", entityType: "organisation",
    echelons: ["Battalion","Company","Platoon","Section"],
    keywords: ["mp","military police","provost","law enforcement"] },

  // Naval
  { id: "carrier", label: "Aircraft Carrier", description: "Aircraft carrier / strike group",
    functionId: "CLCV--", dim: "S", category: "Naval", militaryService: "Navy", entityType: "vehicle",
    echelons: ["Platform / Individual"],
    keywords: ["carrier","cvn","csg","aircraft carrier"] },
  { id: "destroyer", label: "Destroyer", description: "Surface combatant — destroyer / DDG",
    functionId: "CLDD--", dim: "S", category: "Naval", militaryService: "Navy", entityType: "vehicle",
    echelons: ["Platform / Individual"],
    keywords: ["destroyer","ddg","type 45","arleigh burke"] },
  { id: "frigate", label: "Frigate", description: "Surface combatant — frigate / FFG",
    functionId: "CLFF--", dim: "S", category: "Naval", militaryService: "Navy", entityType: "vehicle",
    echelons: ["Platform / Individual"],
    keywords: ["frigate","ffg","type 23","type 26"] },
  { id: "corvette", label: "Corvette / OPV", description: "Corvette, patrol vessel or OPV",
    functionId: "CLCG--", dim: "S", category: "Naval", militaryService: "Navy", entityType: "vehicle",
    echelons: ["Platform / Individual"],
    keywords: ["corvette","opv","patrol vessel","coastal"] },
  { id: "submarine", label: "Submarine", description: "Submarine (SSN / SSBN / SSK)",
    functionId: "CLSB--", dim: "U", category: "Naval", militaryService: "Navy", entityType: "vehicle",
    echelons: ["Platform / Individual"],
    keywords: ["submarine","ssn","ssbn","ssk","uboat","nuclear sub"] },
  { id: "naval-task-group", label: "Naval Task Group", description: "Naval task group / flotilla",
    functionId: "CNTG--", dim: "S", category: "Naval", militaryService: "Navy", entityType: "organisation",
    echelons: ["Division","Brigade","Battalion"],
    keywords: ["task group","flotilla","task force","naval group"] },
  { id: "amphibious", label: "Amphibious Group", description: "Amphibious assault / landing group",
    functionId: "CLAM--", dim: "S", category: "Naval", militaryService: "Navy", entityType: "organisation",
    echelons: ["Division","Brigade","Battalion","Company"],
    keywords: ["amphibious","landing","lhd","lsd","lha","assault ship"] },
];

// ── Categories (ordered for display) ──────────────────────────────────────────

export const CATEGORIES = [
  "HQ",
  "Infantry",
  "Armour",
  "Recce",
  "Artillery",
  "Air Defence",
  "Aviation",
  "UAS",
  "Engineer",
  "Signal",
  "CBRN",
  "Medical",
  "Logistics",
  "Special Forces",
  "Military Police",
  "Naval",
] as const;

export type CategoryName = (typeof CATEGORIES)[number];

// ── Legacy flat UNIT_TEMPLATES (for any code that still imports it) ────────────

export const UNIT_TEMPLATES: UnitTemplate[] = UNIT_ARCHETYPES.flatMap((a) => {
  const echelonOptions = getEchelonsForArchetype(a);
  return echelonOptions.map((e): UnitTemplate => ({
    id: `${a.id}__${e.echelonValue || "platform"}`,
    label: e.echelonValue ? `${a.label} — ${e.label}` : a.label,
    description: a.description,
    sidc: buildTemplateSidc(a.functionId, e.glyph, a.dim),
    entityType: a.entityType,
    echelon: e.echelonValue as UnitTemplate["echelon"],
    militaryService: a.militaryService,
    category: a.category,
  }));
});

// ── Backward-compat exports ────────────────────────────────────────────────────

export const HIERARCHY_LEVELS: string[] = ALL_ECHELONS.map((e) => e.label);

export type HierarchyLevel = string;

export function hierarchyOf(echelon: string): string {
  if (!echelon) return "Platform / Individual";
  return echelon;
}

/**
 * Rewrite position 2 (affiliation) of a 15-char APP-6D SIDC.
 * F = friend / blue, H = hostile / red.
 */
export function withAffiliation(
  sidc: string,
  affiliation: "friend" | "hostile",
): string {
  if (sidc.length < 2) return sidc;
  const glyph = affiliation === "hostile" ? "H" : "F";
  return sidc[0] + glyph + sidc.slice(2);
}
