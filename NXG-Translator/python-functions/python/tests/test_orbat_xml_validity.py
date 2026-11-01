"""
Does the XML we produce actually validate, and is a valid ORBAT a useful one?

These run against the real XSDs in src/data, through the same validator the
translate functions use, so they fail if either the schema or the serialiser
moves. Run from python-functions/python:

    python -m pytest tests/test_orbat_xml_validity.py
    python tests/test_orbat_xml_validity.py      # no pytest needed
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.orbat_preflight import preflight_orbat  # noqa: E402
from src.simulator_targets import normalise_owning_simulator  # noqa: E402
from src.xml_translator import orbat_to_xml  # noqa: E402
from src.xml_validator import validate_orbat_xml  # noqa: E402


# ── Fixtures ────────────────────────────────────────────────────────────────


def unit(**overrides) -> dict:
    node = {
        "$type": "vehicle",
        "id": 2,
        "name": "Tank",
        "sidc": "SFGPUCA---E----",
        "isExpanded": True,
        "isDrone": False,
        "owningSimulator": "vbs4",
        "canControlDrones": False,
        "dis": "1.1.225.3.6.0",
        "location": {"latitude": 54.7, "longitude": 20.1},
        "behavior": [],
        "controlledDroneIds": [],
        "vbs4": {"className": "vbs2_gb_army_challenger2"},
        "children": [],
    }
    node.update(overrides)
    return node


def orbat(*units, sword: bool = True) -> dict:
    company = {
        "$type": "organisation",
        "id": 1,
        "name": "A Company",
        "sidc": "SFGPU-------",
        "isExpanded": True,
        "children": list(units),
    }
    root = {
        "$type": "organisation",
        "id": 0,
        "name": "Battlegroup",
        "sidc": "SFGPU-------",
        "isExpanded": True,
        "children": [company],
    }
    if sword:
        company["sword"] = {"controllable": True, "class": "Medium tank company"}
        root["sword"] = {"controllable": True, "class": "Armored squadron"}
    return {"entities": [root]}


# ── Schema validity ─────────────────────────────────────────────────────────


def test_a_complete_orbat_validates():
    assert validate_orbat_xml(orbat_to_xml(orbat(unit()))) == []


def test_childless_aircraft_still_emits_children():
    """
    validate.xsd declares VehicleType's Children with minOccurs="0" but
    AircraftType's without, so Children defaults to REQUIRED on an aircraft and
    a crew-less airframe used to serialise as:

        Element 'Aircraft': Missing child element(s). Expected is ( Children ).

    The element may be empty, since its Human children are minOccurs="0". The
    asymmetry looks like an oversight in the CSE schema, but an unmanned or
    crew-less airframe is perfectly ordinary and every ORBAT containing one
    exported a document that failed validation at the far end.
    """
    helicopter = unit(
        **{
            "$type": "aircraft",
            "id": 3,
            "name": "Wildcat AH.1",
            "sidc": "SFAPMHR--------",
            "dis": "1.2.224.21.20.1",
            "vbs4": {"className": "bisim_dt_gb_army_aw_aw159_ah1_gry_x"},
            "children": [],
        }
    )

    xml = orbat_to_xml(orbat(helicopter))
    assert "<Children/>" in xml or "<Children />" in xml or "<Children>" in xml, xml
    assert validate_orbat_xml(xml) == [], validate_orbat_xml(xml)


def test_childless_vehicle_does_not_emit_children():
    """
    The converse: Children is optional on a Vehicle, so a crew-less vehicle
    should stay terse rather than gain an empty element.
    """
    xml = orbat_to_xml(orbat(unit(children=[])))
    vehicle_fragment = xml.split("<Vehicle")[1].split("</Vehicle>")[0] if "<Vehicle" in xml else ""
    assert "<Children" not in vehicle_fragment, vehicle_fragment
    assert validate_orbat_xml(xml) == [], validate_orbat_xml(xml)


def test_simworks_unit_validates():
    node = unit(owningSimulator="simworks", vbs4=None, simworks={"className": "SW_T72"})
    del node["vbs4"]
    assert validate_orbat_xml(orbat_to_xml(orbat(node))) == []


def test_only_one_unit_extension_is_emitted():
    """
    A SimWorks unit that also carries a reference VBS4 block used to emit both,
    which the schema rejects: UnitType allows maxOccurs="1" of UnitExtension,
    and Vbs4 and Simworks are both in that substitution group.
    """
    node = unit(
        owningSimulator="simworks",
        simworks={"className": "SW_T72"},
        vbs4={"className": "vbs2_t72"},
    )
    xml = orbat_to_xml(orbat(node))

    assert validate_orbat_xml(xml) == []
    # The owning simulator's block is the one kept.
    assert "Simworks" in xml
    assert "Vbs4" not in xml


def test_owning_simulator_casing_is_normalised():
    """The ontology holds "Vbs4" and "Simworks"; the schema enumeration is lower case."""
    assert validate_orbat_xml(orbat_to_xml(orbat(unit(owningSimulator="Vbs4")))) == []


def test_unfederated_unit_is_rejected_by_the_schema():
    """
    "none" is not in the owningSimulator enumeration. The translator writes it
    through unchanged rather than guessing, so the failure names the real value.
    """
    errors = validate_orbat_xml(orbat_to_xml(orbat(unit(owningSimulator="none"))))
    assert len(errors) == 1
    assert "owningSimulator" in errors[0]


# ── What the schema cannot catch ────────────────────────────────────────────


def test_a_unit_with_no_asset_is_schema_valid_but_caught_by_preflight():
    """
    The whole reason preflight exists: UnitExtension is optional, so a unit with
    no simulator asset validates cleanly and then spawns nothing.
    """
    node = unit()
    del node["vbs4"]
    document = orbat(node)

    assert validate_orbat_xml(orbat_to_xml(document)) == []

    codes = [i["code"] for i in preflight_orbat(document)]
    assert "NO_SIMULATOR_ASSET" in codes


def test_empty_class_name_is_schema_valid_but_caught_by_preflight():
    document = orbat(unit(vbs4={"className": ""}))

    assert validate_orbat_xml(orbat_to_xml(document)) == []
    assert "EMPTY_CLASS_NAME" in [i["code"] for i in preflight_orbat(document)]


def test_preflight_flags_unfederated_units():
    codes = [i["code"] for i in preflight_orbat(orbat(unit(owningSimulator="none")))]
    assert "OWNING_SIMULATOR_INVALID" in codes


def test_preflight_flags_a_unit_directly_under_the_root():
    """RootOrganisationType only permits Organisation children."""
    document = {"entities": [{
        "$type": "organisation",
        "id": 0,
        "name": "Battlegroup",
        "sidc": "SFGPU-------",
        "children": [unit()],
    }]}

    assert "UNIT_UNDER_ROOT" in [i["code"] for i in preflight_orbat(document)]
    # And the schema agrees, which is what makes this worth checking early.
    assert validate_orbat_xml(orbat_to_xml(document)) != []


def test_preflight_flags_uuid_ids_and_placeholder_dis():
    document = orbat(unit(id="7a14d0bf-656b-4b9b-9ef0-dca8975ab690", dis="0.0.0.0.0.0.0"))
    codes = [i["code"] for i in preflight_orbat(document)]
    assert "ID_NOT_INTEGER" in codes
    assert "DIS_PLACEHOLDER" in codes


def test_preflight_warns_when_both_blocks_are_present():
    node = unit(owningSimulator="simworks", simworks={"className": "SW_T72"}, vbs4={"className": "vbs2_t72"})
    assert "EXTRA_SIMULATOR_BLOCK" in [i["code"] for i in preflight_orbat(orbat(node))]


def test_a_complete_orbat_has_no_preflight_findings():
    assert preflight_orbat(orbat(unit())) == []


# ── Vocabulary ──────────────────────────────────────────────────────────────


def test_normalise_owning_simulator():
    assert normalise_owning_simulator("Vbs4") == "vbs4"
    assert normalise_owning_simulator("Simworks") == "simworks"
    assert normalise_owning_simulator("masa/sword") == "sword"
    assert normalise_owning_simulator("none") is None
    assert normalise_owning_simulator("") is None
    assert normalise_owning_simulator(None) is None
    assert normalise_owning_simulator("arma") is None


# ── Runner for environments without pytest ──────────────────────────────────

if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
            print(f"PASS  {name}")
        except AssertionError as exc:
            failures += 1
            print(f"FAIL  {name}: {exc}")
    print(f"\n{failures} failure(s)")
    sys.exit(1 if failures else 0)
