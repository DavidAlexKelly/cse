"""
Tests for src.representation — mirrored from the app.

The CASES table below must stay comparable with the TypeScript one:
  [NXG] Mapplications Repo -> src/shared/orbat/representation.test.ts
Same cases, same order, same names. If you add one here, add it there.
Every value is taken from the ontology as it stands, not invented.
"""

import pytest

from src.orbat_preflight import preflight_orbat
from src.representation import (
    AGGREGATE,
    AUTOMAT,
    ENTITY,
    REPRESENTATION_FIELD,
    SUBFORMATION,
    is_self_contained,
    node_representation,
    representation_of,
)

# ---------------------------------------------------------------------------
# SHARED CASE TABLE — (name, entity_type, code, expected)
# ---------------------------------------------------------------------------

CASES = [
    # -- physical things are entities, whatever else is true of them --------
    (
        "vehicle with a VBS4 model",
        "vehicle",
        "vbs_us_army_m163_vulcan_grn_x",
        ENTITY,
    ),
    (
        "aircraft with a SimWorks model",
        "aircraft",
        "GBR AH-64 (HELO)",
        ENTITY,
    ),
    (
        "human with no model chosen yet is an incomplete entity, not structure",
        "human",
        None,
        ENTITY,
    ),
    (
        "vehicle carrying a SWORD equipment code",
        "vehicle",
        "CP.Armored vehicle|AAA.Surface to air battery|1.1.225.2.5.33.0|equipment",
        ENTITY,
    ),
    # -- organisations: the SWORD row decides -------------------------------
    (
        "organisation with a SWORD automat row",
        "organisation",
        "AAA.Surface to air battery|automat",
        AUTOMAT,
    ),
    (
        "organisation with a SWORD automat row, whitespace padded",
        "organisation",
        "  INF.Mechanised company|automat  ",
        AUTOMAT,
    ),
    (
        "organisation with a SWORD unit row is one slice of an automat",
        "organisation",
        "INF.Rifle platoon|unit",
        SUBFORMATION,
    ),
    (
        "organisation with no asset is plain structure",
        "organisation",
        None,
        AGGREGATE,
    ),
    (
        "organisation with an empty asset code is plain structure",
        "organisation",
        "",
        AGGREGATE,
    ),
    (
        "organisation carrying a platform code is still structure: it cannot be emitted",
        "organisation",
        "GBR L118 (ARTILLERY)",
        AGGREGATE,
    ),
    (
        "organisation carrying a SWORD equipment code is not an automat",
        "organisation",
        "CP.Armored vehicle|INF.Mechanised company|1.1.225.2.1.10.0|equipment",
        AGGREGATE,
    ),
    # -- the suffix has to be the suffix, not merely present ----------------
    (
        "the word automat inside a name does not make an automat",
        "organisation",
        "INF.Automat support company",
        AGGREGATE,
    ),
]


@pytest.mark.parametrize(
    "entity_type,code,expected",
    [(c[1], c[2], c[3]) for c in CASES],
    ids=[c[0] for c in CASES],
)
def test_representation_of(entity_type, code, expected):
    assert representation_of(entity_type, code) == expected


def test_unknown_entity_type_is_structure_rather_than_a_guess():
    # Defensive: entityType is free text in the ontology, so a typo must not
    # silently become an entity and get a platform demanded of it.
    assert representation_of("vehicles", None) == AGGREGATE


def test_is_self_contained():
    assert is_self_contained(AUTOMAT) is True
    assert is_self_contained(SUBFORMATION) is True
    assert is_self_contained(AGGREGATE) is False
    assert is_self_contained(ENTITY) is False


# ---------------------------------------------------------------------------
# Unified-ORBAT nodes
# ---------------------------------------------------------------------------


def org(name, representation=AGGREGATE, children=None, node_id=1, **extra):
    node = {
        "$type": "organisation",
        "id": node_id,
        "name": name,
        "sidc": "SFGPU-------",
        "isExpanded": True,
        REPRESENTATION_FIELD: representation,
        "children": children or [],
    }
    node.update(extra)
    return node


def vehicle(name, node_id, class_name="vbs2_gb_army_challenger2_w_x"):
    return {
        "$type": "vehicle",
        "id": node_id,
        "name": name,
        "sidc": "SFGPUCA---E----",
        "location": {"latitude": 1.0, "longitude": 2.0},
        "owningSimulator": "vbs4",
        "dis": "1.1.224.1.1.0",
        "behavior": [],
        "canControlDrones": False,
        "controlledDroneIds": [],
        "isExpanded": True,
        "isDrone": False,
        "vbs4": {"className": class_name},
        "children": [],
    }


def test_node_representation_prefers_the_stamped_value():
    assert node_representation(org("Air Defence Battery", AUTOMAT)) == AUTOMAT


def test_node_representation_falls_back_to_type_when_nothing_was_stamped():
    # An imported ORBAT has no catalogue code to read, so an organisation is
    # structure as far as anything here can tell.
    assert node_representation({"$type": "organisation", "children": []}) == AGGREGATE
    assert node_representation({"$type": "vehicle"}) == ENTITY


# ---------------------------------------------------------------------------
# The preflight check. The first fixture is the live ontology, unmodified:
# "Air Defence Battery" is a SWORD automat with three VBS4 vehicles beneath it.
# ---------------------------------------------------------------------------


def air_defence_battery(representation=AUTOMAT):
    return org(
        "Air Defence Battery",
        representation,
        node_id=10,
        sword={"controllable": False, "class": "Surface to air battery"},
        children=[
            vehicle("AD Battery CP Vehicle", 11),
            vehicle("Anti-aircraft Tank Alpha", 12),
            vehicle("Target Detection Vehicle Alpha", 13),
        ],
    )


def double_counted(orbat):
    return [i for i in preflight_orbat(orbat) if i["code"] == "DOUBLE_COUNTED"]


def test_finds_every_vehicle_under_a_live_automat_not_just_the_first():
    orbat = {"entities": [org("1 Armoured Brigade", AGGREGATE, [air_defence_battery()], node_id=1)]}
    found = double_counted(orbat)
    assert [i["entityName"] for i in found] == [
        "AD Battery CP Vehicle",
        "Anti-aircraft Tank Alpha",
        "Target Detection Vehicle Alpha",
    ]
    assert all(i["severity"] == "ERROR" for i in found)


def test_names_both_units_and_says_what_to_do():
    orbat = {"entities": [org("1 Armoured Brigade", AGGREGATE, [air_defence_battery()], node_id=1)]}
    message = double_counted(orbat)[0]["message"]
    assert "AD Battery CP Vehicle" in message
    assert "Air Defence Battery" in message
    assert "twice" in message


def test_quiet_when_the_automat_is_a_leaf():
    battery = air_defence_battery()
    battery["children"] = []
    orbat = {"entities": [org("1 Armoured Brigade", AGGREGATE, [battery], node_id=1)]}
    assert double_counted(orbat) == []


def test_quiet_when_the_same_tree_hangs_off_a_structural_parent():
    # Clearing the automat's SWORD asset is one of the two fixes the message
    # offers; it must actually silence the finding.
    orbat = {
        "entities": [
            org("1 Armoured Brigade", AGGREGATE, [air_defence_battery(AGGREGATE)], node_id=1)
        ]
    }
    assert double_counted(orbat) == []


def test_reports_through_an_intervening_organisation():
    battery = air_defence_battery()
    battery["children"] = [
        org("1 Troop", AGGREGATE, [vehicle("Anti-aircraft Tank Alpha", 12)], node_id=20)
    ]
    orbat = {"entities": [org("1 Armoured Brigade", AGGREGATE, [battery], node_id=1)]}
    found = double_counted(orbat)
    assert len(found) == 1
    assert found[0]["entityName"] == "Anti-aircraft Tank Alpha"


def test_does_not_report_crew_inside_a_vehicle():
    warrior = vehicle("Warrior 1", 30)
    warrior["children"] = [
        {
            "$type": "human",
            "id": 31,
            "name": "Driver",
            "location": {"latitude": 1.0, "longitude": 2.0},
            "owningSimulator": "vbs4",
            "dis": "1.1.224.3.1.0",
            "behavior": [],
            "canControlDrones": False,
            "controlledDroneIds": [],
            "vbs4": {"className": "vbs2_ukf_soldier"},
        }
    ]
    orbat = {
        "entities": [
            org("A Company", AGGREGATE, [org("1 Platoon", AGGREGATE, [warrior], node_id=32)], node_id=1)
        ]
    }
    assert double_counted(orbat) == []


def test_reports_beneath_a_subformation_too():
    platoon = org(
        "1 Platoon",
        SUBFORMATION,
        [vehicle("Warrior 1", 41)],
        node_id=40,
        sword={"controllable": False, "class": "Rifle platoon"},
    )
    orbat = {"entities": [org("A Company", AGGREGATE, [platoon], node_id=1)]}
    assert len(double_counted(orbat)) == 1
