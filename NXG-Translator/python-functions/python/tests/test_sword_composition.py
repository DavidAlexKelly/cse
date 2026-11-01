"""
Tests for src.sword_composition — mirrored from the app.

Keep comparable with the TypeScript case table:
  [NXG] Mapplications Repo -> src/shared/orbat/swordComposition.test.ts
Same cases, same order, same names.

Rows are real: identifiers, constituents, command posts, equipment types and
counts are all as the SWORD catalogue holds them. The "#min#max" annotations
are what the transform now writes.
"""

from src.sword_composition import (
    ConstituentSpec,
    SwordEquipment,
    automat_composition,
    constituent_quantity,
    describe_equipment,
    index_catalogue,
    parse_constituents,
)

ROWS = [
    {
        "identifier": "ART.Guns firing battery|automat",
        "displayName": "Guns firing battery",
        "disCode": "12.1.225.4.2.1",
        "echelonLevel": "ooo",
        "constituentUnits": "ART.Battery CP#1#1|ART.Guns firing platoon#3#3",
        "commandPostUnit": "ART.Battery CP",
    },
    {
        "identifier": "ART.Battery CP|unit",
        "displayName": "Battery CP",
        "disCode": "1.1.225.5.20.0.0",
        "echelonLevel": "ooo",
        "majorEquipmentType": "CP.Armored vehicle",
        "majorEquipmentCount": "1",
        "requiredCrew": "3",
    },
    {
        "identifier": "ART.Guns firing platoon|unit",
        "displayName": "Guns firing platoon",
        "disCode": "1.1.225.4.2.1.0",
        "echelonLevel": "ooo",
        "majorEquipmentType": "ART.Gun 155mm",
        "majorEquipmentCount": "4",
        "requiredCrew": "5",
    },
    {
        "identifier": "ARMOR.Heavy tank company|automat",
        "displayName": "Heavy tank company",
        "disCode": "12.1.225.3.2.0.1",
        "echelonLevel": "ooo",
        "constituentUnits": "ARMOR.Armored company CP#1#1|ARMOR.Heavy tank platoon#3#3",
        "commandPostUnit": "ARMOR.Armored company CP",
    },
    {
        "identifier": "ARMOR.Armored company CP|unit",
        "displayName": "Armored company CP",
        "disCode": "1.1.225.5.20.0.0",
        "echelonLevel": "ooo",
        "majorEquipmentType": "CP.Armored vehicle",
        "majorEquipmentCount": "2",
        "requiredCrew": "4",
    },
    {
        "identifier": "ARMOR.Heavy tank platoon|unit",
        "displayName": "Heavy tank platoon",
        "disCode": "1.1.225.3.4.0.1",
        "echelonLevel": "ooo",
        "majorEquipmentType": "ARMOR.Main Battle Tank",
        "majorEquipmentCount": "4",
        "requiredCrew": "3",
    },
    # A constituent that is not in the catalogue, so `unresolved` has something
    # to report. Not the case in the data today — all 81 automats resolve.
    {
        "identifier": "AAA.Surface to air battery|automat",
        "displayName": "Surface to air battery",
        "disCode": "12.1.225.7.1.0",
        "echelonLevel": "ooo",
        "constituentUnits": "AAA.Surface to air battery CP#1#1|AAA.Ghost platoon#2#2",
        "commandPostUnit": "AAA.Surface to air battery CP",
    },
    {
        "identifier": "AAA.Surface to air battery CP|unit",
        "displayName": "Surface to air battery CP",
        "disCode": "1.1.225.5.21.0.0",
        "echelonLevel": "ooo",
        "majorEquipmentType": "CP.Armored vehicle",
        "majorEquipmentCount": "2",
        "requiredCrew": "2",
    },
    # A single-platform unit: no equipment block at all, as 21 of the 163 rows
    # have none (a fighter jet is the platform, not a grouping of them).
    {
        "identifier": "AIR.Fighter jet|unit",
        "displayName": "Fighter jet",
        "disCode": "",
        "echelonLevel": "",
    },
]

CATALOGUE = index_catalogue(ROWS)


# ---------------------------------------------------------------------------
# parse_constituents
# ---------------------------------------------------------------------------


def test_reads_name_min_and_max():
    assert parse_constituents("ART.Battery CP#1#1|ART.Guns firing platoon#3#3") == [
        ConstituentSpec("ART.Battery CP", 1, 1),
        ConstituentSpec("ART.Guns firing platoon", 3, 3),
    ]


def test_accepts_bare_names_so_a_catalogue_built_before_the_counts_still_parses():
    assert parse_constituents("ART.Battery CP|ART.Guns firing platoon") == [
        ConstituentSpec("ART.Battery CP", 1, 1),
        ConstituentSpec("ART.Guns firing platoon", 1, 1),
    ]


def test_treats_a_missing_max_occurs_as_exactly_min_not_as_unbounded():
    # Automats.xml leaves max-occurs off for 43 of the 81 automats. Reading
    # that as "no limit" and generating without one is not a useful answer.
    assert parse_constituents("ART.Guns firing platoon#3#") == [
        ConstituentSpec("ART.Guns firing platoon", 3, 3)
    ]


def test_is_empty_for_an_empty_field_and_skips_empty_entries():
    assert parse_constituents("") == []
    assert parse_constituents(None) == []
    assert [c.name for c in parse_constituents("A#1#1||B#1#1")] == ["A", "B"]


# ---------------------------------------------------------------------------
# constituent_quantity
# ---------------------------------------------------------------------------


def test_generates_the_establishment_not_the_maximum():
    # "1..4 anti-tank sections" means one, reinforceable to four.
    assert constituent_quantity(ConstituentSpec("x", 1, 4)) == 1
    assert constituent_quantity(ConstituentSpec("x", 3, 3)) == 3


def test_never_generates_none():
    assert constituent_quantity(ConstituentSpec("x", 0, 0)) == 1


# ---------------------------------------------------------------------------
# automat_composition
# ---------------------------------------------------------------------------


def test_takes_a_battery_apart_the_way_the_catalogue_describes_it():
    composition = automat_composition(CATALOGUE, "ART.Guns firing battery|automat")
    assert composition is not None
    assert [(c.name, c.quantity, c.is_command_post) for c in composition.constituents] == [
        ("ART.Battery CP", 1, True),
        ("ART.Guns firing platoon", 3, False),
    ]
    assert composition.unresolved == []


def test_carries_the_equipment_off_the_unit_row():
    composition = automat_composition(CATALOGUE, "ART.Guns firing battery|automat")
    guns = composition.constituents[1]
    assert guns.equipment == SwordEquipment("ART.Gun 155mm", 4, 5)
    assert describe_equipment(guns.equipment) == "4 x ART.Gun 155mm, crew 5"


def test_reports_a_constituent_the_catalogue_does_not_have_and_keeps_the_rest():
    composition = automat_composition(CATALOGUE, "AAA.Surface to air battery|automat")
    assert composition.unresolved == ["AAA.Ghost platoon"]
    assert len(composition.constituents) == 2
    assert composition.constituents[1].formation is None


def test_is_none_for_a_unit_row_an_unknown_identifier_or_no_composition():
    assert automat_composition(CATALOGUE, "ARMOR.Heavy tank platoon|unit") is None
    assert automat_composition(CATALOGUE, "NOPE.Nothing|automat") is None
    assert automat_composition(CATALOGUE, "") is None


def test_single_platform_units_report_no_equipment():
    assert describe_equipment(None) == ""
