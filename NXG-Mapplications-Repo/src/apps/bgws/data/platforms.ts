// ── bgws/data/platforms.ts ─────────────────────────────────────────────────
// The BGWS platform catalogue, as the scenario builder offers it.
//
// Generated from BGWS's own catalogue export (bgws-platforms.json: id, name,
// class, domain, echelon) and checked in as data rather than fetched, because
// BGWS is not reachable from Foundry: the only path to it is the command
// stream, which carries orders, not catalogue queries. If BGWS adds a platform
// the builder will not offer it until this file is regenerated — a scenario
// naming an unknown platform id is still sent, and BGWS is the judge of it.
//
// Two things here are ours, not BGWS's:
//
//   nature      an APP-6 nature path in the vocabulary shared/hla/symbology
//               already maps to 2525C function IDs ("ground track/unit/combat/
//               armor"), so a placed unit draws with the same symbology as the
//               live map. Where the exact leaf is uncertain the parent is used,
//               following app6.ts's "nearest ancestor beats a guess" rule.
//   functionId  an explicit 2525C function ID for the few kinds the nature table
//               has no row for (drones → MFQ, submarines → S).
//
// The vehicle models (tankmodels/*, var_*) and national sections (sec_*) arrive
// with no class or domain; they are classified by hand and marked `inferred`.

export type PlatformDomain = "land" | "air" | "surface" | "subsurface";

export type PlatformEchelon =
  | "team"
  | "section"
  | "platoon"
  | "company"
  | "battalion"
  | "brigade"
  | "division";

export interface BgwsPlatform {
  /** BGWS platform id, sent verbatim as `units[].platform`. */
  id: string;
  name: string;
  domain: PlatformDomain;
  /** BGWS platform class (mbt, ifv, dismounted, softVehicle, fighter, …). */
  class: string;
  echelon?: PlatformEchelon;
  /** Grouping that overrides the class grouping in the picker. */
  group?: "Command posts" | "Vehicle models" | "National sections";
  /** APP-6 nature path (see shared/hla/symbology/app6.ts). */
  nature: string;
  /** Explicit 2525C function ID when the nature table has no row for it. */
  functionId?: string;
  /** A command post: the first one per side becomes that side's HQ. */
  hq?: boolean;
  /** Class/domain assigned here, not by BGWS. */
  inferred?: boolean;
}

export const BGWS_PLATFORMS: readonly BgwsPlatform[] = [
  {id: "generic/atgmTeam", name: "Anti-tank guided missile team", domain: "land", class: "dismounted", echelon: "team", nature: "ground track/unit/combat/anti armor"},
  {id: "generic/bomberDroneTeam", name: "Bomber drone team", domain: "land", class: "dismounted", echelon: "team", nature: "ground track/unit/combat/aviation"},
  {id: "generic/cbRadar", name: "Counter-battery radar", domain: "land", class: "softVehicle", nature: "ground track/unit/combat/field artillery"},
  {id: "generic/coastalAsm", name: "Coastal anti-ship battery", domain: "land", class: "softVehicle", nature: "ground track/unit/combat/field artillery"},
  {id: "generic/convoyTruck", name: "Supply convoy (4 trucks)", domain: "land", class: "softVehicle", nature: "ground track/unit/combat service support/transportation"},
  {id: "generic/counterDrone", name: "Counter-drone vehicle", domain: "land", class: "lightArmoured", echelon: "section", nature: "ground track/unit/combat/air defense"},
  {id: "generic/droneIsrTeam", name: "ISR quadcopter team", domain: "land", class: "dismounted", echelon: "team", nature: "ground track/unit/combat/reconnaissance"},
  {id: "generic/engineerSection", name: "Combat engineer section", domain: "land", class: "lightArmoured", nature: "ground track/unit/combat/engineer"},
  {id: "generic/esmTeam", name: "Electronic support (SIGINT) team", domain: "land", class: "softVehicle", nature: "ground track/unit/combat support/military intelligence"},
  {id: "generic/ewJammer", name: "Electronic attack team", domain: "land", class: "softVehicle", nature: "ground track/unit/combat support/military intelligence"},
  {id: "generic/fixedWingIsrTeam", name: "Fixed-wing ISR drone team", domain: "land", class: "softVehicle", echelon: "team", nature: "ground track/unit/combat/reconnaissance"},
  {id: "generic/fpvTeamFibre", name: "FPV strike team (fibre)", domain: "land", class: "dismounted", echelon: "team", nature: "ground track/unit/combat/aviation"},
  {id: "generic/fpvTeamRf", name: "FPV strike team (radio)", domain: "land", class: "dismounted", echelon: "team", nature: "ground track/unit/combat/aviation"},
  {id: "generic/ifv", name: "Infantry fighting vehicle platoon", domain: "land", class: "ifv", echelon: "platoon", nature: "ground track/unit/combat/infantry"},
  {id: "generic/infantrySection", name: "Rifle section", domain: "land", class: "dismounted", echelon: "section", nature: "ground track/unit/combat/infantry"},
  {id: "generic/interceptorTeam", name: "Interceptor drone team", domain: "land", class: "dismounted", echelon: "team", nature: "ground track/unit/combat/air defense"},
  {id: "generic/loiterTeam", name: "Loitering munition team", domain: "land", class: "softVehicle", nature: "ground track/unit/combat/aviation"},
  {id: "generic/mbt", name: "Main battle tank troop", domain: "land", class: "mbt", echelon: "platoon", nature: "ground track/unit/combat/armor"},
  {id: "generic/medevac", name: "Ambulance section", domain: "land", class: "lightArmoured", nature: "ground track/unit/combat service support"},
  {id: "generic/mlrs", name: "Rocket launcher section", domain: "land", class: "softVehicle", nature: "ground track/unit/combat/field artillery"},
  {id: "generic/mortar120", name: "120 mm mortar section", domain: "land", class: "lightArmoured", echelon: "section", nature: "ground track/unit/combat/field artillery"},
  {id: "generic/recce", name: "Reconnaissance patrol", domain: "land", class: "lightArmoured", echelon: "section", nature: "ground track/unit/combat/reconnaissance"},
  {id: "generic/samLong", name: "Long-range SAM battery", domain: "land", class: "softVehicle", nature: "ground track/unit/combat/air defense"},
  {id: "generic/samMedium", name: "Medium-range SAM battery", domain: "land", class: "softVehicle", nature: "ground track/unit/combat/air defense"},
  {id: "generic/sensorNode", name: "Unattended ground sensor", domain: "land", class: "sensorNode", nature: "ground track/unit/combat support/military intelligence"},
  {id: "generic/shorad", name: "Short-range air defence section", domain: "land", class: "lightArmoured", nature: "ground track/unit/combat/air defense"},
  {id: "generic/sph155", name: "155 mm self-propelled battery (platoon)", domain: "land", class: "lightArmoured", nature: "ground track/unit/combat/field artillery"},
  {id: "generic/srbmBattery", name: "Short-range ballistic missile battery", domain: "land", class: "softVehicle", echelon: "battalion", nature: "ground track/unit/combat/field artillery"},
  {id: "generic/ugv", name: "Ground robot", domain: "land", class: "ugv", nature: "ground track/unit/combat"},
  {id: "generic/aew", name: "Airborne early warning aircraft", domain: "air", class: "largeAircraft", nature: "air track/military/fixed wing"},
  {id: "generic/attackHelo", name: "Attack helicopter pair", domain: "air", class: "helicopter", nature: "air track/military/rotary wing"},
  {id: "generic/bomber", name: "Heavy bomber", domain: "air", class: "bomber", echelon: "platoon", nature: "air track/military/fixed wing/bomber"},
  {id: "generic/fighter4", name: "4th-generation fighter flight", domain: "air", class: "fighter", nature: "air track/military/fixed wing/fighter"},
  {id: "generic/fighter5", name: "5th-generation fighter flight", domain: "air", class: "fighter", nature: "air track/military/fixed wing/fighter"},
  {id: "generic/mpa", name: "Maritime patrol aircraft", domain: "air", class: "largeAircraft", nature: "air track/military/fixed wing"},
  {id: "generic/strikeFighter", name: "Strike fighter flight", domain: "air", class: "fighter", nature: "air track/military/fixed wing/fighter"},
  {id: "generic/tanker", name: "Air-to-air tanker", domain: "air", class: "largeAircraft", nature: "air track/military/fixed wing"},
  {id: "generic/transportHelo", name: "Transport helicopter pair", domain: "air", class: "helicopter", nature: "air track/military/rotary wing"},
  {id: "generic/corvette", name: "Missile corvette", domain: "surface", class: "warship", nature: "sea surface track/combatant/line"},
  {id: "generic/destroyer", name: "Air-defence destroyer", domain: "surface", class: "warship", nature: "sea surface track/combatant/line/destroyer"},
  {id: "generic/frigate", name: "Frigate", domain: "surface", class: "warship", nature: "sea surface track/combatant/line/frigate"},
  {id: "generic/merchant", name: "Merchant ship", domain: "surface", class: "merchantShip", nature: "sea surface track/non military"},
  {id: "generic/ssk", name: "Diesel-electric submarine", domain: "subsurface", class: "submarine", nature: "subsurface track/submarine", functionId: "S-----"},
  {id: "generic/ssn", name: "Nuclear attack submarine", domain: "subsurface", class: "submarine", nature: "subsurface track/submarine", functionId: "S-----"},
  {id: "generic/usv", name: "Explosive uncrewed surface vessel", domain: "surface", class: "smallCraft", nature: "sea surface track/combatant"},
  {id: "generic/bomberDrone", name: "Heavy bomber drone (Baba Yaga class)", domain: "air", class: "smallDrone", nature: "air track/military/fixed wing", functionId: "MFQ---"},
  {id: "generic/fixedWingIsr", name: "Small fixed-wing ISR drone (Orlan class)", domain: "air", class: "fixedWingDrone", nature: "air track/military/fixed wing", functionId: "MFQ---"},
  {id: "generic/fpvFibre", name: "FPV drone (fibre)", domain: "air", class: "smallDrone", nature: "air track/military/fixed wing", functionId: "MFQ---"},
  {id: "generic/fpvRf", name: "FPV drone (radio)", domain: "air", class: "smallDrone", nature: "air track/military/fixed wing", functionId: "MFQ---"},
  {id: "generic/interceptorDrone", name: "Interceptor drone", domain: "air", class: "smallDrone", nature: "air track/military/fixed wing", functionId: "MFQ---"},
  {id: "generic/loiter", name: "Loitering munition", domain: "air", class: "fixedWingDrone", nature: "air track/military/fixed wing", functionId: "MFQ---"},
  {id: "generic/male", name: "MALE ISR/strike drone", domain: "air", class: "fixedWingDrone", nature: "air track/military/fixed wing", functionId: "MFQ---"},
  {id: "generic/owaDecoy", name: "Decoy drone", domain: "air", class: "owaDrone", nature: "air track/military/fixed wing", functionId: "MFQ---"},
  {id: "generic/owaDrone", name: "One-way attack drone", domain: "air", class: "owaDrone", nature: "air track/military/fixed wing", functionId: "MFQ---"},
  {id: "generic/quadIsr", name: "ISR quadcopter", domain: "air", class: "smallDrone", nature: "air track/military/fixed wing", functionId: "MFQ---"},
  {id: "generic/cp-battalion", name: "Battalion command post", domain: "land", class: "softVehicle", echelon: "battalion", group: "Command posts", nature: "ground track/unit/combat", hq: true},
  {id: "generic/cp-brigade", name: "Brigade command post", domain: "land", class: "softVehicle", echelon: "brigade", group: "Command posts", nature: "ground track/unit/combat", hq: true},
  {id: "generic/cp-company", name: "Company command post", domain: "land", class: "softVehicle", echelon: "company", group: "Command posts", nature: "ground track/unit/combat", hq: true},
  {id: "generic/cp-division", name: "Division main command post", domain: "land", class: "softVehicle", echelon: "division", group: "Command posts", nature: "ground track/unit/combat", hq: true},
  {id: "tankmodels/cn_m1a2t", name: "Cn M1a2t", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "tankmodels/cn_ztz_96", name: "Cn Ztz 96", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "tankmodels/fr_leopard_2a5nl", name: "Fr Leopard 2a5nl", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "tankmodels/fr_leopard_2a6nl", name: "Fr Leopard 2a6nl", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "tankmodels/germ_leopard_2a5", name: "Germ Leopard 2a5", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "tankmodels/germ_leopard_2a5_pso", name: "Germ Leopard 2a5 Pso", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "tankmodels/il_merkava_mk_3_raam_segol", name: "Il Merkava Mk 3 Raam Segol", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "tankmodels/il_merkava_mk_3b", name: "Il Merkava Mk 3b", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "tankmodels/it_leopard_2a4", name: "It Leopard 2a4", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "tankmodels/it_leopard_2a7_hungary", name: "It Leopard 2a7 Hungary", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "tankmodels/jp_leopard_2ri", name: "Jp Leopard 2ri", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "tankmodels/jp_tkx_prot", name: "Jp Tkx Prot", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "tankmodels/sw_leopard_2a6nl", name: "Sw Leopard 2a6nl", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "tankmodels/sw_pvrbv_551", name: "Sw Pvrbv 551", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "tankmodels/uk_m1a1_aim_abrams", name: "Uk M1a1 Aim Abrams", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "tankmodels/us_m1a1_abrams", name: "Us M1a1 Abrams", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "infantry/rifle_infantry", name: "Rifle Infantry", domain: "land", class: "dismounted", group: "National sections", nature: "ground track/unit/combat/infantry", inferred: true},
  {id: "declared/mortar_section", name: "Mortar Section", domain: "land", class: "dismounted", group: "National sections", nature: "ground track/unit/combat/field artillery", inferred: true},
  {id: "var_11_default", name: "Challenger 2", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "var_27_default", name: "FV510 Warrior", domain: "land", class: "ifv", group: "Vehicle models", nature: "ground track/unit/combat/infantry", inferred: true},
  {id: "var_1_default", name: "M1 Abrams", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "var_20_default", name: "T-55", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "var_22_1", name: "T-72B3 obr.2016", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "var_23_1", name: "T-80BVM", domain: "land", class: "mbt", group: "Vehicle models", nature: "ground track/unit/combat/armor", inferred: true},
  {id: "sec_uk_armd_inf", name: "UK Armoured Infantry Section", domain: "land", class: "dismounted", group: "National sections", nature: "ground track/unit/combat/infantry", inferred: true},
  {id: "sec_uk_javelin", name: "UK Javelin Detachment", domain: "land", class: "dismounted", group: "National sections", nature: "ground track/unit/combat/anti armor", inferred: true},
  {id: "sec_uk_gpmg_sf", name: "UK GPMG Sustained-Fire Team", domain: "land", class: "dismounted", group: "National sections", nature: "ground track/unit/combat/infantry", inferred: true},
  {id: "sec_uk_mortar", name: "UK 81mm Mortar Section", domain: "land", class: "dismounted", group: "National sections", nature: "ground track/unit/combat/field artillery", inferred: true},
  {id: "sec_ru_mr_bmp", name: "RU Motor-Rifle Squad (BMP)", domain: "land", class: "dismounted", group: "National sections", nature: "ground track/unit/combat/infantry", inferred: true},
  {id: "sec_ru_mr_btr", name: "RU Motor-Rifle Squad (BTR)", domain: "land", class: "dismounted", group: "National sections", nature: "ground track/unit/combat/infantry", inferred: true},
  {id: "sec_ru_at", name: "RU Anti-Tank Section (Kornet)", domain: "land", class: "dismounted", group: "National sections", nature: "ground track/unit/combat/anti armor", inferred: true},
  {id: "sec_ru_mortar", name: "RU 82mm Mortar Section", domain: "land", class: "dismounted", group: "National sections", nature: "ground track/unit/combat/field artillery", inferred: true},
  {id: "sec_us_mech_sqd", name: "US Mechanised Infantry Squad", domain: "land", class: "dismounted", group: "National sections", nature: "ground track/unit/combat/infantry", inferred: true},
  {id: "sec_us_stryker_sqd", name: "US Stryker Rifle Squad", domain: "land", class: "dismounted", group: "National sections", nature: "ground track/unit/combat/infantry", inferred: true},
  {id: "sec_generic_light", name: "Territorial / Light Infantry Section", domain: "land", class: "dismounted", group: "National sections", nature: "ground track/unit/combat/infantry", inferred: true},
];

const BY_ID = new Map(BGWS_PLATFORMS.map((p) => [p.id, p]));

/** The platform for an id, or undefined when the catalogue does not know it. */
export function platformById(id: string): BgwsPlatform | undefined {
  return BY_ID.get(id);
}

/** Whether a platform makes its unit the side's HQ (CONTRACT §2c). */
export function isCommandPost(id: string): boolean {
  return BY_ID.get(id)?.hq === true;
}

const DOMAIN_LABEL: Record<PlatformDomain, string> = {
  land: "Land",
  air: "Air",
  surface: "Surface",
  subsurface: "Subsurface",
};

const CLASS_LABEL: Record<string, string> = {
  mbt: "Armour",
  ifv: "Mechanised infantry",
  dismounted: "Dismounted",
  lightArmoured: "Light armoured",
  softVehicle: "Soft-skinned",
  sensorNode: "Sensors",
  ugv: "Uncrewed ground",
  largeAircraft: "Large aircraft",
  helicopter: "Helicopters",
  bomber: "Bombers",
  fighter: "Fighters",
  smallDrone: "Small drones",
  fixedWingDrone: "Fixed-wing drones",
  owaDrone: "One-way attack drones",
  warship: "Warships",
  merchantShip: "Merchant",
  smallCraft: "Small craft",
  submarine: "Submarines",
};

export interface PlatformGroup {
  /** "Land · Armour", "Command posts", … — an <optgroup> label. */
  label: string;
  platforms: BgwsPlatform[];
}

/**
 * The catalogue grouped for a picker: command posts first (every scenario
 * wants one per side), then domain → class in catalogue order, then the
 * vehicle models and national sections.
 */
export function groupedPlatforms(): PlatformGroup[] {
  const groups = new Map<string, BgwsPlatform[]>();
  const add = (label: string, platform: BgwsPlatform) => {
    const list = groups.get(label) ?? [];
    list.push(platform);
    groups.set(label, list);
  };
  for (const p of BGWS_PLATFORMS) if (p.group === "Command posts") add(p.group, p);
  for (const p of BGWS_PLATFORMS) {
    if (p.group) continue;
    add(`${DOMAIN_LABEL[p.domain]} · ${CLASS_LABEL[p.class] ?? p.class}`, p);
  }
  for (const p of BGWS_PLATFORMS) if (p.group && p.group !== "Command posts") add(p.group, p);
  return [...groups.entries()].map(([label, platforms]) => ({ label, platforms }));
}
