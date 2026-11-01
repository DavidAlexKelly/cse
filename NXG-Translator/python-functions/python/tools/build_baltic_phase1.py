"""
Build the OPERATION-BALTIC-SHIELD / obs_phase_01 ORBAT payload for
import_ontology_orbat_from_json (the "[NXG-O] Generate ORBAT" action).

Phase 1 - "Enemy Advance to Contact". Each phase holds a FULL STANDING FORCE,
not a delta, so this payload is the complete two-sided laydown for phase 1.

Friendly and enemy are authored as two sibling ROOT organisations inside the
SINGLE hierarchy HIER-BALTIC-PHASE-01. validate.xsd allows <Entities> to hold
unbounded root Organisations, which is what lets one phase export as one
document containing both forces.

The script validates before printing, because the failure modes here are all
silent: a duplicate primary key overwrites a unit, a vehicle left at the root
produces INVALID XML (RootOrganisationType children may only be Organisation),
and a stray second parent double-counts a subtree into the force.

Run:
    cd python-functions/python && python3 tools/build_baltic_phase1.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.payload_codec import encode_gzip_base64  # noqa: E402

OPERATION_KEY = "OPERATION-BALTIC-SHIELD"
HIERARCHY_KEY = "HIER-BALTIC-PHASE-01"
HIERARCHY_NAME = "Baltic Shield \u2014 Phase 1 ORBAT"
VALID_FROM = "2026-09-15"
VALID_TO = "2026-09-30"

ORG_DIS = "0.0.0.0.0.0.0"

# DIS-6 code -> NxgVbs4AssetCatalogue.identifier (the VBS4 class name).
#
# This mapping is the difference between an ORBAT and an empty one. A unit is
# linked to its VBS4 asset by simulatorIdentifierCode, NOT by its DIS code:
# _load_stores queries NxgVbs4AssetCatalogue.identifier.in_(simulator_identifier_codes),
# and translator.build_tree drops any vehicle or aircraft that ends up without a
# vbs4 config block. A payload carrying correct DIS codes and no
# simulatorIdentifierCode therefore exports an ORBAT of empty organisations that
# still validates against the schema.
#
# Woodland/green liveries throughout: this is Kaliningrad in September, and the
# catalogue's desert variants would be visibly wrong in the simulation. The one
# exception is the Boxer, which exists as command-in-desert or engineer-in-green
# but not command-in-green; the command role matters more than the paint.
VBS4_CLASS_BY_DIS = {
    # GBR
    "1.1.224.2.8.0": "vbs2_gb_fv510_w_wrap2_x",            # Warrior IFV, woodland, WRAP2
    "1.1.224.2.0.0": "vbs_gb_army_ajax_grn_pss_x",         # Ajax
    "1.1.224.2.4.0": "vbs_gb_army_fv107mk2_grn_x",         # Scimitar Mk2
    "1.1.224.4.7.0": "vbs2_gb_army_as90_w_x",              # AS90 155mm SPG
    "1.1.224.28.2.0": "vbs_gb_army_stormer_grn_x",         # Stormer HVM
    "1.1.224.3.17.0": "vbs_gb_army_trojan_grn_bema_fascine_x",  # Trojan AVRE
    "1.1.224.3.10.0": "vbs_gb_army_boxer_command_des_gmg_x",    # Boxer command (see note)
    "1.1.224.29.2.0": "vbs_gb_army_sx45_rv_grn_x",         # Support Vehicle, Recovery
    "1.2.224.21.20.1": "bisim_dt_gb_army_aw_aw159_ah1_gry_x",   # Wildcat AH.1
    # RUS
    "1.1.222.1.2.17": "bisim_dt_ru_army_uvz_t72b3_grn_x",  # T-72B3M
    "1.1.222.2.2.1": "vbs2_opfor_army_bmp2_w_x",           # BMP-2, woodland
    "1.1.222.2.13.1": "vbs_opfor_army_btr80_grn_x",        # BTR-80 (opfor, not the DPRK variant)
    "1.1.222.2.4.0": "vbs2_opfor_army_brdm_w_x",           # BRDM-2
    "1.1.222.4.26.0": "vbs_ru_army_2s19_grn_x",            # 2S19 Msta-S
    "1.1.222.4.13.1": "vbs2_opfor_ural_4320_bm21_w_x",     # BM-21 Grad
    "1.1.222.28.22.2": "vbs_dvs_op_army_sa22_grn_x",       # Pantsir-S1 / SA-22
    "1.1.222.6.0.0": "vbs_ru_army_233114_wdl_x",           # Tigr-M
    "1.2.222.20.3.3": "vbs_ru_af_ka52_gry_x",              # Ka-52
}

units: list[dict] = []
edges: list[dict] = []


def org(pk: str, name: str, echelon: str, sidc: str, allegiance: str, affiliation: str) -> str:
    # Stated rather than left to _upsert_units_batch's defaults, so that the
    # payload describes exactly what will exist in the Ontology and can be fed
    # straight into OntologyStore by the tests.
    units.append(
        dict(
            primaryKey=pk,
            unitIdentifier=name,
            entityType="organisation",
            owningSimulator="none",
            dis=ORG_DIS,
            echelon=echelon,
            sidc=sidc,
            affiliation=affiliation,
            allegiance=allegiance,
            militaryService="Army",
        )
    )
    return pk


def platform(
    pk: str,
    name: str,
    dis: str,
    sidc: str,
    allegiance: str,
    affiliation: str,
    entity_type: str = "vehicle",
    service: str = "Army",
) -> str:
    # KeyError rather than a default: an unmapped DIS code means this platform
    # would be silently dropped from the exported ORBAT, so it must stop the
    # build rather than quietly shrink the force.
    simulator_identifier_code = VBS4_CLASS_BY_DIS[dis]
    units.append(
        dict(
            primaryKey=pk,
            unitIdentifier=name,
            entityType=entity_type,
            owningSimulator="vbs4",
            dis=dis,
            simulatorIdentifierCode=simulator_identifier_code,
            sidc=sidc,
            affiliation=affiliation,
            allegiance=allegiance,
            militaryService=service,
        )
    )
    return pk


def edge(parent: str, child: str) -> None:
    # relationshipTypeKey is stated explicitly even though _upsert_edges_batch
    # would default it to ORGANIC_RELATIONSHIP_KEY. Leaving it out made the
    # payload un-loadable by OntologyStore, which reads edge["relationshipTypeKey"]
    # directly, so the thing we could test locally was no longer the thing we
    # were about to import. Since the payload now travels gzipped, a field
    # repeated identically on every edge costs practically nothing.
    edges.append(
        dict(
            primaryKey=f"EDGE-{child.replace('UNIT-', '')}",
            parentUnitKey=parent,
            childUnitKey=child,
            relationshipTypeKey="RELTYPE-ORGANIC",
            validFrom=VALID_FROM,
            validTo=VALID_TO,
        )
    )


# ---------------------------------------------------------------------------
# FRIENDLY - 1 YORKS Battlegroup (GBR)
#
# Warrior/Ajax based. There is no Challenger in the VBS4 catalogue for GBR
# (the Tank category holds only BARV and "Mark II"), so this is an armoured
# INFANTRY battlegroup rather than an armoured regiment - every DIS code below
# was confirmed present in the canonical asset catalogue with vbs4AssetCount>0.
# ---------------------------------------------------------------------------
F_ALLEG, F_AFF = "GBR", "Friend"

bg = org("UNIT-BSP1-BG-1YORKS", "1 YORKS Battlegroup", "Battalion", "SFGPUCI--------", F_ALLEG, F_AFF)

bghq = org("UNIT-BSP1-BG-HQ", "Battlegroup HQ", "Company", "SFGPUH---------", F_ALLEG, F_AFF)
a_coy = org("UNIT-BSP1-A-COY", "A Company (Armoured Infantry)", "Company", "SFGPUCIZ-------", F_ALLEG, F_AFF)
b_coy = org("UNIT-BSP1-B-COY", "B Company (Armoured Infantry)", "Company", "SFGPUCIZ-------", F_ALLEG, F_AFF)
c_sqn = org("UNIT-BSP1-C-SQN", "C Squadron (Armoured Cavalry)", "Company", "SFGPUCRVA------", F_ALLEG, F_AFF)
fs_bty = org("UNIT-BSP1-FS-BTY", "Fire Support Battery", "Battery", "SFGPUCF--------", F_ALLEG, F_AFF)
ad_tp = org("UNIT-BSP1-AD-TP", "Air Defence Troop", "Platoon", "SFGPUCD--------", F_ALLEG, F_AFF)
engr_tp = org("UNIT-BSP1-ENGR-TP", "Engineer Troop", "Platoon", "SFGPUCE--------", F_ALLEG, F_AFF)
css_pl = org("UNIT-BSP1-CSS-PL", "Combat Service Support Platoon", "Platoon", "SFGPUSS--------", F_ALLEG, F_AFF)

for child in (bghq, a_coy, b_coy, c_sqn, fs_bty, ad_tp, engr_tp, css_pl):
    edge(bg, child)

# Manoeuvre platoons
a1 = org("UNIT-BSP1-A-1PL", "A Coy 1 Platoon", "Platoon", "SFGPUCIZ-------", F_ALLEG, F_AFF)
a2 = org("UNIT-BSP1-A-2PL", "A Coy 2 Platoon", "Platoon", "SFGPUCIZ-------", F_ALLEG, F_AFF)
b1 = org("UNIT-BSP1-B-1PL", "B Coy 1 Platoon", "Platoon", "SFGPUCIZ-------", F_ALLEG, F_AFF)
b2 = org("UNIT-BSP1-B-2PL", "B Coy 2 Platoon", "Platoon", "SFGPUCIZ-------", F_ALLEG, F_AFF)
c1 = org("UNIT-BSP1-C-1TP", "C Sqn 1 Troop", "Platoon", "SFGPUCRVA------", F_ALLEG, F_AFF)
c2 = org("UNIT-BSP1-C-2TP", "C Sqn 2 Troop", "Platoon", "SFGPUCRVA------", F_ALLEG, F_AFF)

edge(a_coy, a1)
edge(a_coy, a2)
edge(b_coy, b1)
edge(b_coy, b2)
edge(c_sqn, c1)
edge(c_sqn, c2)

WARRIOR = "1.1.224.2.8.0"
AJAX = "1.1.224.2.0.0"
SCIMITAR = "1.1.224.2.4.0"
AS90 = "1.1.224.4.7.0"
STORMER = "1.1.224.28.2.0"
TROJAN = "1.1.224.3.17.0"
BOXER_CMD = "1.1.224.3.10.0"
SV_RECOVERY = "1.1.224.29.2.0"
WILDCAT = "1.2.224.21.20.1"

F_VEH_SIDC = "SFGPEVA--------"
F_AIR_SIDC = "SFAPMHR--------"

edge(bghq, platform("UNIT-BSP1-BGHQ-BOXER", "BG HQ Boxer Command", BOXER_CMD, F_VEH_SIDC, F_ALLEG, F_AFF))
edge(bghq, platform("UNIT-BSP1-BGHQ-WILDCAT", "BG Wildcat AH.1", WILDCAT, F_AIR_SIDC, F_ALLEG, F_AFF, entity_type="aircraft"))

for parent, tag in ((a1, "A-1PL"), (a2, "A-2PL"), (b1, "B-1PL"), (b2, "B-2PL")):
    for call in ("ALPHA", "BRAVO"):
        edge(parent, platform(f"UNIT-BSP1-{tag}-WR-{call}", f"{tag} Warrior {call.title()}", WARRIOR, F_VEH_SIDC, F_ALLEG, F_AFF))

for call in ("ALPHA", "BRAVO"):
    edge(c1, platform(f"UNIT-BSP1-C-1TP-AJAX-{call}", f"C/1 Ajax {call.title()}", AJAX, F_VEH_SIDC, F_ALLEG, F_AFF))
    edge(c2, platform(f"UNIT-BSP1-C-2TP-SCIMITAR-{call}", f"C/2 Scimitar {call.title()}", SCIMITAR, F_VEH_SIDC, F_ALLEG, F_AFF))

for call in ("ALPHA", "BRAVO"):
    edge(fs_bty, platform(f"UNIT-BSP1-FS-AS90-{call}", f"AS90 {call.title()}", AS90, "SFGPEVF--------", F_ALLEG, F_AFF))

edge(ad_tp, platform("UNIT-BSP1-AD-STORMER", "Stormer HVM", STORMER, "SFGPEVAD-------", F_ALLEG, F_AFF))
edge(engr_tp, platform("UNIT-BSP1-ENGR-TROJAN", "Trojan AVRE", TROJAN, "SFGPEVE--------", F_ALLEG, F_AFF))
edge(css_pl, platform("UNIT-BSP1-CSS-RECOVERY", "Support Vehicle Recovery", SV_RECOVERY, "SFGPEVU--------", F_ALLEG, F_AFF))

# ---------------------------------------------------------------------------
# ENEMY - 200th Motor Rifle Battalion Tactical Group (RUS)
#
# Phase 1 is the enemy advance to contact, so the OPFOR is the formation doing
# the advancing: recce forward, two motor rifle companies, a tank company,
# with fires and air defence under BTG control.
# ---------------------------------------------------------------------------
E_ALLEG, E_AFF = "RUS", "Hostile"

btg = org("UNIT-BSP1-OPFOR-BTG", "200th Motor Rifle Battalion Tactical Group", "Battalion", "SHGPUCI--------", E_ALLEG, E_AFF)

ohq = org("UNIT-BSP1-OPFOR-HQ", "BTG Command Group", "Company", "SHGPUH---------", E_ALLEG, E_AFF)
mr1 = org("UNIT-BSP1-OPFOR-MR1", "1st Motor Rifle Company", "Company", "SHGPUCIZ-------", E_ALLEG, E_AFF)
mr2 = org("UNIT-BSP1-OPFOR-MR2", "2nd Motor Rifle Company", "Company", "SHGPUCIZ-------", E_ALLEG, E_AFF)
tk = org("UNIT-BSP1-OPFOR-TK", "Tank Company", "Company", "SHGPUCA--------", E_ALLEG, E_AFF)
recce = org("UNIT-BSP1-OPFOR-RECCE", "Reconnaissance Platoon", "Platoon", "SHGPUCRVA------", E_ALLEG, E_AFF)
arty = org("UNIT-BSP1-OPFOR-ARTY", "Artillery Battery", "Battery", "SHGPUCF--------", E_ALLEG, E_AFF)
oad = org("UNIT-BSP1-OPFOR-AD", "Air Defence Platoon", "Platoon", "SHGPUCD--------", E_ALLEG, E_AFF)

for child in (ohq, mr1, mr2, tk, recce, arty, oad):
    edge(btg, child)

mr1_1 = org("UNIT-BSP1-OPFOR-MR1-1PL", "1 MR Coy 1 Platoon", "Platoon", "SHGPUCIZ-------", E_ALLEG, E_AFF)
mr1_2 = org("UNIT-BSP1-OPFOR-MR1-2PL", "1 MR Coy 2 Platoon", "Platoon", "SHGPUCIZ-------", E_ALLEG, E_AFF)
mr2_1 = org("UNIT-BSP1-OPFOR-MR2-1PL", "2 MR Coy 1 Platoon", "Platoon", "SHGPUCIZ-------", E_ALLEG, E_AFF)
tk_1 = org("UNIT-BSP1-OPFOR-TK-1PL", "Tank Coy 1 Platoon", "Platoon", "SHGPUCA--------", E_ALLEG, E_AFF)

edge(mr1, mr1_1)
edge(mr1, mr1_2)
edge(mr2, mr2_1)
edge(tk, tk_1)

BMP2 = "1.1.222.2.2.1"
BTR80 = "1.1.222.2.13.1"
T72B3M = "1.1.222.1.2.17"
BRDM2 = "1.1.222.2.4.0"
S2S19 = "1.1.222.4.26.0"
BM21 = "1.1.222.4.13.1"
PANTSIR = "1.1.222.28.22.2"
TIGR = "1.1.222.6.0.0"
KA52 = "1.2.222.20.3.3"

E_VEH_SIDC = "SHGPEVA--------"

edge(ohq, platform("UNIT-BSP1-OPFOR-HQ-TIGR", "BTG Command Tigr-M", TIGR, "SHGPEVU--------", E_ALLEG, E_AFF))
edge(ohq, platform("UNIT-BSP1-OPFOR-KA52", "Ka-52 Alligator", KA52, "SHAPMHA--------", E_ALLEG, E_AFF, entity_type="aircraft"))

for call in ("ALPHA", "BRAVO"):
    edge(mr1_1, platform(f"UNIT-BSP1-OPFOR-MR1-1PL-BMP-{call}", f"1/1 BMP-2 {call.title()}", BMP2, E_VEH_SIDC, E_ALLEG, E_AFF))
edge(mr1_2, platform("UNIT-BSP1-OPFOR-MR1-2PL-BMP-ALPHA", "1/2 BMP-2 Alpha", BMP2, E_VEH_SIDC, E_ALLEG, E_AFF))

for call in ("ALPHA", "BRAVO"):
    edge(mr2_1, platform(f"UNIT-BSP1-OPFOR-MR2-1PL-BTR-{call}", f"2/1 BTR-80 {call.title()}", BTR80, E_VEH_SIDC, E_ALLEG, E_AFF))

for call in ("ALPHA", "BRAVO"):
    edge(tk_1, platform(f"UNIT-BSP1-OPFOR-TK-1PL-T72-{call}", f"Tank 1 T-72B3M {call.title()}", T72B3M, E_VEH_SIDC, E_ALLEG, E_AFF))

edge(recce, platform("UNIT-BSP1-OPFOR-RECCE-BRDM", "Recce BRDM-2", BRDM2, "SHGPEVAR-------", E_ALLEG, E_AFF))
edge(arty, platform("UNIT-BSP1-OPFOR-ARTY-2S19", "2S19 Msta-S", S2S19, "SHGPEVF--------", E_ALLEG, E_AFF))
edge(arty, platform("UNIT-BSP1-OPFOR-ARTY-BM21", "BM-21 Grad", BM21, "SHGPEVF--------", E_ALLEG, E_AFF))
edge(oad, platform("UNIT-BSP1-OPFOR-AD-PANTSIR", "Pantsir-S1", PANTSIR, "SHGPEVAD-------", E_ALLEG, E_AFF))

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate() -> list[str]:
    by_pk = {u["primaryKey"]: u for u in units}
    problems: list[str] = []

    if len(by_pk) != len(units):
        seen: set[str] = set()
        dupes = {u["primaryKey"] for u in units if u["primaryKey"] in seen or seen.add(u["primaryKey"])}
        problems.append(f"duplicate unit primary keys: {sorted(dupes)}")

    edge_pks = [e["primaryKey"] for e in edges]
    if len(set(edge_pks)) != len(edge_pks):
        problems.append("duplicate edge primary keys")

    parents: dict[str, str] = {}
    children_by_parent: dict[str, list[str]] = {}
    for e in edges:
        child, parent = e["childUnitKey"], e["parentUnitKey"]
        if child not in by_pk:
            problems.append(f"edge references unknown child {child}")
        if parent not in by_pk:
            problems.append(f"edge references unknown parent {parent}")
        if child in parents:
            problems.append(f"{child} has two parents: {parents[child]} and {parent}")
        parents[child] = parent
        children_by_parent.setdefault(parent, []).append(child)

    # Roots = units that are never a child.
    roots = [pk for pk in by_pk if pk not in parents]
    for r in sorted(roots):
        if by_pk[r]["entityType"] != "organisation":
            problems.append(f"root {r} is {by_pk[r]['entityType']}, must be organisation")
        # RootOrganisationType Children may contain ONLY Organisation.
        for c in children_by_parent.get(r, []):
            if by_pk[c]["entityType"] != "organisation":
                problems.append(f"root {r} has non-organisation child {c} ({by_pk[c]['entityType']}) - invalid XML")

    # Every non-root must reach a root (no cycles, no orphan islands).
    for pk in by_pk:
        seen_chain: set[str] = {pk}
        node = pk
        for _ in range(len(by_pk) + 1):
            nxt = parents.get(node)
            if nxt is None:
                break
            if nxt in seen_chain:
                problems.append(f"cycle involving {pk}")
                break
            seen_chain.add(nxt)
            node = nxt

    # Anything that is not an organisation must be a leaf.
    for pk, kids in children_by_parent.items():
        if by_pk[pk]["entityType"] != "organisation" and kids:
            problems.append(f"{pk} is a {by_pk[pk]['entityType']} but has children {kids}")

    # Every fighting platform must carry a VBS4 class, or it is dropped during
    # translation and the ORBAT exports as empty organisations - a document that
    # passes XSD validation while containing nothing that can be spawned.
    for pk, unit in by_pk.items():
        if unit["entityType"] == "organisation":
            continue
        if not unit.get("simulatorIdentifierCode"):
            problems.append(f"{pk} ({unit['entityType']}) has no simulatorIdentifierCode")

    print(f"units={len(units)} edges={len(edges)} roots={sorted(roots)}")
    orgs = sum(1 for u in units if u["entityType"] == "organisation")
    print(f"  organisations={orgs} platforms={len(units) - orgs}")
    for r in sorted(roots):
        subtree = 0
        stack = [r]
        while stack:
            n = stack.pop()
            subtree += 1
            stack.extend(children_by_parent.get(n, []))
        print(f"  root {r}: {subtree} units in subtree")
    return problems


payload = {
    "operation": {"primaryKey": OPERATION_KEY, "startTime": VALID_FROM, "endTime": VALID_TO},
    "unitHierarchy": {
        "primaryKey": HIERARCHY_KEY,
        "name": HIERARCHY_NAME,
        "validFrom": VALID_FROM,
        "validTo": VALID_TO,
    },
    "units": units,
    "unitHierarchyEdges": edges,
}

if __name__ == "__main__":
    issues = validate()
    if issues:
        print("\nPROBLEMS:")
        for i in issues:
            print(f"  - {i}")
        raise SystemExit(1)
    print("\nvalidation OK\n")
    text = json.dumps(payload, separators=(",", ":"))
    encoded = encode_gzip_base64(text)
    print(f"json    : {len(text)} chars")
    print(f"encoded : {len(encoded)} chars")

    # Printed rather than written to a file: this is the value to paste into the
    # import_ontology_orbat_from_gzip_base64 Action parameter, and writing it to
    # a predictable path in a shared temp directory is both unnecessary and a
    # code-scan finding. Redirect stdout if you want it on disk.
    if "--json" in sys.argv:
        print("\n--- json ---")
        print(text)
    print("\n--- base64(gzip(json)) for import_ontology_orbat_from_gzip_base64 ---")
    print(encoded)
