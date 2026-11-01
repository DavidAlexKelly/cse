// Offline check for the APP-6 mapping — not part of the app bundle.
//
//   npx esbuild src/apps/hlamap/symbology/app6.check.ts --bundle --platform=node \
//     --format=esm --outfile=/tmp/app6-check.mjs && node /tmp/app6-check.mjs
//
// Every nature path below is a real value from [NXG-O] Sword Asset Catalogue,
// and every entity name is a real value from the HLA Entity Tracks stream. The
// check asserts three things that matter and are easy to get wrong:
//
//   1. every SIDC milsymbol is handed actually renders,
//   2. the ones we claim to classify get a function ID rather than a bare frame,
//   3. SWORD entity names resolve to the catalogue key they should.

import ms from "milsymbol";
import { buildSidc, buildCatalogueIndex, catalogueKey, functionIdForNature, echelonCode, lookupCatalogue } from "./app6";

/** natureApp6 → whether we expect a specific icon (true) or accept a frame. */
const NATURES: ReadonlyArray<readonly [string, boolean]> = [
  ["air track/military/fixed wing/bomber", true],
  ["air track/military/fixed wing/reconnaissance", true],
  ["ground track/unit/combat service support", true],
  ["ground track/unit/combat service support/administrative/mortuary graves registry", true],
  ["ground track/unit/combat service support/maintenance", true],
  ["ground track/unit/combat service support/medical", true],
  ["ground track/unit/combat service support/supply", true],
  ["ground track/unit/combat service support/transportation", true],
  ["ground track/unit/combat service support/transportation/movement control center", true],
  ["ground track/unit/combat support", true],
  ["ground track/unit/combat support/military intelligence/signal intelligence/electronic warfare/direction finding", true],
  ["ground track/unit/combat support/military intelligence/signal intelligence/electronic warfare/intercept", true],
  ["ground track/unit/combat support/military intelligence/signal intelligence/electronic warfare/jamming", true],
  ["ground track/unit/combat support/military intelligence/surveillance/ground surveillance radar", true],
  ["ground track/unit/combat support/nbc", true],
  ["ground track/unit/combat support/nbc/decontamination", true],
  ["ground track/unit/combat support/signal unit/command operations", true],
  ["ground track/unit/combat/air defense/missile/light/motorized avenger", true],
  ["ground track/unit/combat/air defense/targeting unit", true],
  ["ground track/unit/combat/anti armor/dismounted", true],
  ["ground track/unit/combat/anti armor/motorized", true],
  ["ground track/unit/combat/armor/wheeled", true],
  ["ground track/unit/combat/aviation/rotary wing", true],
  ["ground track/unit/combat/aviation/rotary wing/utility", true],
  ["ground track/unit/combat/aviation/unmanned aerial vehicle/fixed_wing", true],
  ["ground track/unit/combat/aviation/unmanned aerial vehicle/launcher", true],
  ["ground track/unit/combat/engineer", true],
  ["ground track/unit/combat/engineer/combat/bridging", true],
  ["ground track/unit/combat/engineer/combat/mechanized", true],
  ["ground track/unit/combat/field artillery", true],
  ["ground track/unit/combat/field artillery/artillery survey/light", true],
  ["ground track/unit/combat/field artillery/mortar", true],
  ["ground track/unit/combat/field artillery/rocket/single rocket launcher", true],
  ["ground track/unit/combat/field artillery/target acquisition", true],
  ["ground track/unit/combat/field artillery/target acquisition/radar", true],
  ["ground track/unit/combat/infantry", true],
  ["ground track/unit/combat/infantry/sniper", true],
  ["ground track/unit/combat/internal security forces/ground/motorized", true],
  ["ground track/unit/combat/reconnaissance", true],
  ["ground track/unit/combat/reconnaissance/long range surveillance", true],
  ["sea surface track/combatant", true],
  ["sea surface track/combatant/amphibious warfare ship/assault vessel", true],
  ["sea surface track/combatant/amphibious warfare ship/landing craft", true],
  ["sea surface track/combatant/line/carrier", true],
  ["sea surface track/combatant/line/destroyer", true],
  ["sea surface track/combatant/line/frigate - corvette", true],
  ["sea surface track/non military/fishing/trawler", true],
  ["sea surface track/non military/merchant/cargo", true],
  // Civil responders: 2525C puts these in the Emergency Management scheme, so a
  // frame is the correct outcome here rather than a warfighting icon.
  ["ground track/unit/emergency", false],
  ["ground track/unit/emergency/firefighter", false],
  ["ground track/unit/emergency/firefighter/fire suppression", false],
  ["ground track/unit/emergency/medical/evacuation/ambulance", false],
  ["ground track/unit/emergency/medical/evacuation/helicopter", false],
  ["ground track/unit/emergency/medical/hospital", false],
  ["ground track/unit/emergency/nbc", false],
  ["ground track/unit/emergency/police/police", false],
  ["ground track/unit/emergency/public safety", false],
  ["ground track/unit/emergency/public safety/operation center", false],
  ["ground track/unit/emergency/refugees", false],
  ["ground track/unit/emergency/rescue boat", false],
  ["ground track/unit/emergency/terrorist", false],
  ["space track/satellite", false],
];

/** Real entity names from the stream → the catalogue key they must produce. */
const NAMES: ReadonlyArray<readonly [string, string]> = [
  ["SWORD_1683271227_ARMOR.Heavy tank platoon [265]_309", "heavy tank platoon"],
  ["SWORD_1683271227_INF.Company CP [419]_614", "company cp"],
  ["SWORD_1683271227_AAA.Surface to air defense platoon [241]_241", "surface to air defense platoon"],
  ["SWORD_1683271227_LOG.Combat train [288]_288", "combat train"],
  ["SWORD_1683271227_ART.Mortar firing platoon [287]_331", "mortar firing platoon"],
  ["SWORD_1683271227_Multi-mission frigate_97", "multi-mission frigate"],
  ["SWORD_1683271227_Bomber 1_115", "bomber 1"],
  // The family-prefix strip is generic, so "HLA." comes off as readily as
  // "ARMOR.". That is harmless: no catalogue row is named "aircraft1103", so
  // these still fall through to a DIS-derived frame, which is what the drone
  // mockups should get.
  ["HLA.Aircraft1103", "aircraft1103"],
];

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
}

console.log("── nature paths ──");
for (const [nature, expectIcon] of NATURES) {
  const sidc = buildSidc({
    name: "Test unit",
    affiliation: "FRIEND",
    catalogue: { natureApp6: nature, echelonLevel: "oo" },
  });
  const fn = functionIdForNature(nature);

  let renders = false;
  try {
    const svg = new ms.Symbol(sidc, { size: 24 }).asSVG();
    renders = svg.startsWith("<svg") && svg.length > 200;
  } catch {
    renders = false;
  }

  const classified = fn !== "------";
  const ok = sidc.length === 15 && renders && classified === expectIcon;
  check(`${sidc}  ${nature}`, ok,
    ok ? "" : `len=${sidc.length} renders=${renders} fn=${fn} expectedIcon=${expectIcon}`);
}

// Specific codes, not just "something was matched". Prefix shadowing is the
// failure mode here: "combat support/..." also starts with "combat", so a
// top-to-bottom table quietly classified every support unit as generic combat.
console.log("\n── exact function IDs (shadowing) ──");
const EXPECTED_FUNCTION_IDS: ReadonlyArray<readonly [string, string]> = [
  ["ground track/unit/combat/armor/wheeled", "UCA---"],
  ["ground track/unit/combat/anti armor/dismounted", "UCAA--"],
  ["ground track/unit/combat/infantry", "UCI---"],
  ["ground track/unit/combat/field artillery/mortar", "UCF---"],
  ["ground track/unit/combat/air defense/targeting unit", "UCD---"],
  ["ground track/unit/combat/aviation/rotary wing", "UCVR--"],
  ["ground track/unit/combat support/signal unit/command operations", "UUS---"],
  ["ground track/unit/combat support/military intelligence/surveillance/ground surveillance radar", "UUM---"],
  ["ground track/unit/combat support/nbc/decontamination", "UUA---"],
  ["ground track/unit/combat service support/maintenance", "USM---"],
  ["ground track/unit/combat service support/supply", "USS---"],
  ["ground track/unit/combat service support/transportation", "UST---"],
  ["ground track/unit/combat service support/medical", "US----"],
  ["sea surface track/combatant/line/frigate - corvette", "CLFF--"],
];
for (const [nature, expected] of EXPECTED_FUNCTION_IDS) {
  const actual = functionIdForNature(nature);
  check(`${expected}  ${nature}`, actual === expected, `got ${actual}`);
}

console.log("\n── entity name → catalogue key ──");
for (const [name, expected] of NAMES) {
  const key = catalogueKey(name);
  check(`${name}`, key === expected, `got "${key}", expected "${expected}"`);
}

console.log("\n── echelon and HQ ──");
check("ooo → company (E)", echelonCode("ooo") === "E", echelonCode("ooo"));
check("i → battalion (F)", echelonCode("i") === "F", echelonCode("i"));
check("none → no echelon", echelonCode("none") === "-", echelonCode("none"));
const hqSidc = buildSidc({
  name: "INF.Company CP [419]",
  affiliation: "FRIEND",
  catalogue: { natureApp6: "ground track/unit/combat support/signal unit/command operations", echelonLevel: "ii" },
});
check("a CP gets the HQ staff (position 11 = A)", hqSidc[10] === "A", hqSidc);

console.log("\n── no catalogue entry: dimension from DIS only ──");
for (const [dis, expectedDimension] of [["1.2.225.50.34.1.0", "A"], ["1.1.225.3.2.0.0", "G"], ["", "Z"]] as const) {
  const sidc = buildSidc({ name: "HLA.Aircraft1103", affiliation: "HOSTILE", disType: dis, catalogue: null });
  check(`dis "${dis}" → dimension ${expectedDimension}`, sidc[2] === expectedDimension, sidc);
}

// ── Real entity names against the real catalogue ────────────────────────────
//
// The regression this guards: the catalogue lists parent types only ("Rifle
// company", "Heavy tank company"), while the federation publishes subordinate
// echelons ("INF.Rifle platoon [382]", "ARMOR.Heavy tank platoon [265]"). Exact
// name matching missed those and drew a bare frame, which is what "why is this
// rifle platoon a blank rectangle" looked like on the map.
//
// Rows below are the catalogue entries these names must resolve through.
console.log("\n── real entity names resolve through the catalogue ──");

const CATALOGUE_ROWS = [
  { name: "Rifle company", natureApp6: "ground track/unit/combat/infantry", echelonLevel: "ooo" },
  { name: "Heavy tank company", natureApp6: "ground track/unit/combat/armor/wheeled", echelonLevel: "ooo" },
  { name: "Medium tank company", natureApp6: "ground track/unit/combat/armor/wheeled", echelonLevel: "ooo" },
  { name: "Mechanised company", natureApp6: "ground track/unit/combat/infantry", echelonLevel: "ooo" },
  { name: "Anti-tank section", natureApp6: "ground track/unit/combat/anti armor/dismounted", echelonLevel: "oo" },
  { name: "Scout platoon", natureApp6: "ground track/unit/combat/reconnaissance", echelonLevel: "oo" },
  { name: "Mortar firing battery", natureApp6: "ground track/unit/combat/field artillery", echelonLevel: "ooo" },
  { name: "Surface to air battery", natureApp6: "ground track/unit/combat/air defense/missile/light/motorized avenger", echelonLevel: "ooo" },
  { name: "Combat train", natureApp6: "ground track/unit/combat service support", echelonLevel: "i" },
  { name: "Battle group CP", natureApp6: "ground track/unit/combat support/signal unit/command operations", echelonLevel: "ii" },
  { name: "Support group", natureApp6: "sea surface track/combatant/line/frigate - corvette", echelonLevel: "none" },
  { name: "Bomber flight", natureApp6: "air track/military/fixed wing/bomber", echelonLevel: "none" },
];
const index = buildCatalogueIndex(CATALOGUE_ROWS);

/** name → [expected function ID, expected echelon, expected HQ flag] */
const REAL_NAMES: ReadonlyArray<readonly [string, string, string, string]> = [
  ["SWORD_1683271227_INF.Rifle platoon [382]_382", "UCI---", "D", "-"],
  ["SWORD_1683271227_INF.Rifle company [391]_391", "UCI---", "E", "-"],
  ["SWORD_1683271227_ARMOR.Heavy tank platoon [265]_309", "UCA---", "D", "-"],
  ["SWORD_1683271227_ARMOR.Heavy tank company [261]_305", "UCA---", "E", "-"],
  ["SWORD_1683271227_ARMOR.Medium tank platoon [299]_299", "UCA---", "D", "-"],
  ["SWORD_1683271227_ARMOR.Scout section [281]_281", "UCR---", "C", "-"],
  ["SWORD_1683271227_ARMOR.Antitank section [280]_280", "UCAA--", "C", "-"],
  ["SWORD_1683271227_INF.Mechanised platoon [422]_422", "UCI---", "D", "-"],
  ["SWORD_1683271227_INF.Mortar section [381]_381", "UCF---", "C", "-"],
  ["SWORD_1683271227_ART.Mortar firing platoon [287]_331", "UCF---", "D", "-"],
  ["SWORD_1683271227_AAA.Surface to air defense platoon [241]_241", "UCD---", "D", "-"],
  // "Combat train" is an exact catalogue hit and that row is echelon "i", so a
  // battalion bar is the catalogue's own answer rather than a fallback.
  ["SWORD_1683271227_LOG.Combat train [288]_288", "US----", "F", "-"],
  // Command posts: the family says what branch, the name says it is an HQ.
  ["SWORD_1683271227_INF.Company CP [419]_614", "UCI---", "E", "A"],
  ["SWORD_1683271227_ARMOR.Armored company CP [262]_262", "UCA---", "E", "A"],
  ["SWORD_1683271227_AAA.Surface to air battery CP [240]_240", "UCD---", "E", "A"],
];

for (const [name, expectedFn, expectedEchelon, expectedHq] of REAL_NAMES) {
  const entry = lookupCatalogue(index, name);
  const sidc = buildSidc({ name, affiliation: "FRIEND", disType: "1.1.225.3.3.0.0", catalogue: entry });
  const fn = sidc.slice(4, 10);
  const hq = sidc[10];
  const echelon = sidc[11];
  const ok = fn === expectedFn && echelon === expectedEchelon && hq === expectedHq;
  check(`${sidc}  ${name.replace(/^SWORD_\d+_/, "")}`, ok,
    ok ? "" : `fn=${fn} (want ${expectedFn}) echelon=${echelon} (want ${expectedEchelon}) hq=${hq} (want ${expectedHq})`);
}

// ── Ships and aircraft ──────────────────────────────────────────────────────
//
// The catalogue lists naval and air formations, not platforms, so these names
// resolve by keyword. The DIS codes are deliberately the wrong ones the
// federation actually publishes — "AEW&C aircraft" really does arrive as
// 1.1.225.3.2.0.0, domain 1 = land — to prove the classification beats DIS
// rather than falling back to it.
console.log("\n── ships and aircraft ──");

const PLATFORMS: ReadonlyArray<readonly [string, string, string, string]> = [
  // name, DIS as published, expected dimension, expected function ID
  ["SWORD_1683271227_Aircraft carrier_149", "1.1.225.3.2.0.0", "S", "CLCV--"],
  ["SWORD_1683271227_Multi-mission frigate_97", "1.1.225.3.2.0.0", "S", "CLFF--"],
  ["SWORD_1683271227_Surveillance frigate_100", "1.1.225.3.2.0.0", "S", "CLFF--"],
  ["SWORD_1683271227_General purpose frigate_96", "1.1.225.3.2.0.0", "S", "CLFF--"],
  ["SWORD_1683271227_Air defense destroyer_257", "1.1.225.3.2.0.0", "S", "CLDD--"],
  ["SWORD_1683271227_Amphibious assault ship_186", "1.1.225.3.2.0.0", "S", "C-----"],
  ["SWORD_1683271227_Bomber 1_115", "1.2.225.3.0.0.1", "A", "MFB---"],
  ["SWORD_1683271227_Fighter jet 2_140", "1.2.225.3.0.0.1", "A", "MFF---"],
  ["SWORD_1683271227_AEW&C aircraft_117", "1.1.225.3.2.0.0", "A", "MF----"],
];

for (const [name, dis, expectedDimension, expectedFn] of PLATFORMS) {
  const sidc = buildSidc({
    name,
    affiliation: "FRIEND",
    disType: dis,
    catalogue: lookupCatalogue(index, name),
  });
  const dimension = sidc[2];
  const fn = sidc.slice(4, 10);
  const ok = dimension === expectedDimension && fn === expectedFn;
  check(`${sidc}  ${name.replace(/^SWORD_\d+_/, "")}`, ok,
    ok ? "" : `dim=${dimension} (want ${expectedDimension}) fn=${fn} (want ${expectedFn})`);
}

// A ground air-defence unit must not be mistaken for an aircraft by the word "air".
const sam = buildSidc({
  name: "SWORD_1683271227_AAA.Surface to air defense platoon [241]_241",
  affiliation: "FRIEND",
  catalogue: lookupCatalogue(index, "SWORD_1683271227_AAA.Surface to air defense platoon [241]_241"),
});
check('"Surface to air" stays a ground unit', sam[2] === "G" && sam.slice(4, 10) === "UCD---", sam);

// Nothing should silently become a frame now except genuinely unknown entities.
const drone = buildSidc({
  name: "HLA.Aircraft1103",
  affiliation: "HOSTILE",
  disType: "1.2.225.50.34.1.0",
  catalogue: lookupCatalogue(index, "HLA.Aircraft1103"),
});
check("a non-SWORD name still falls back to an air frame", drone.startsWith("SHAP") && drone.slice(4, 10) === "------", drone);

console.log();
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
