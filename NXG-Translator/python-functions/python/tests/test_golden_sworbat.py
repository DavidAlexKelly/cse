"""
Diff our translator output against CSE's own SWORD ORBAT.

tests/golden/sworbat.xml is copied verbatim from the CSE-Prep Functions repo —
a document CSE wrote and accepts. We build the same force through our own
pipeline and compare, because "it validates against the XSD" has already been
shown three times to be a much weaker claim than "it looks like what CSE
actually sends".

Run from python-functions/python:

    python tests/test_golden_sworbat.py
    python -m pytest tests/test_golden_sworbat.py
"""

from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.xml_translator import orbat_to_xml  # noqa: E402
from src.xml_validator import validate_orbat_xml  # noqa: E402

ORBAT_NS = "https://accenture.com/2026-03/cse/orbat"
SWORD_NS = "https://accenture.com/2026-03/cse/orbat/sword"

GOLDEN_PATH = os.path.join(os.path.dirname(__file__), "golden", "sworbat.xml")


def golden_root() -> ET.Element:
    return ET.parse(GOLDEN_PATH).getroot()


def ours_root() -> ET.Element:
    """
    The same force, expressed the way our ontology holds it.

    Note the sword class values: our catalogue identifiers carry a "|automat"
    or "|unit" suffix, which is how isAutomat() works on the app side. CSE's
    document has no suffix, so the translator has to strip it — that is one of
    the differences this test exists to catch.
    """
    def org(node_id, name, sidc, lat, lon, sword_class, children=None):
        node = {
            "$type": "organisation",
            "id": node_id,
            "name": name,
            "sidc": sidc,
            "isExpanded": True,
            "children": children or [],
        }
        if lat is not None:
            node["location"] = {"latitude": lat, "longitude": lon}
        if sword_class is not None:
            node["sword"] = {"controllable": False, "class": sword_class}
        return node

    root = org(
        1, "Battle Group North", "SFGPU------J---", None, None,
        # An aggregate: CSE emits <sword:Sword controllable="false"/> with NO
        # class, which is how SWORD is told to compose this from the automats
        # beneath it.
        sword_class="",
        children=[
            org(2, "BG HQ", "SFGPUCA---AH---", 69.44950256828420, 30.22263830336032,
                "CP.Battle group CP|automat"),
            org(3, "A Company (Tanks)", "SFGPUCA--------", 69.46120000000000, 30.19850000000000,
                "ARMOR.Heavy tank company|automat"),
            org(4, "Recce Platoon", "SFGPUCA--------", 69.47480000000000, 30.15600000000000,
                "ARMOR.Scout platoon|automat"),
        ],
    )
    return ET.fromstring(orbat_to_xml({"entities": [root]}))


def organisations(root: ET.Element) -> dict:
    """Every Organisation keyed by id, with the facts we care about."""
    out = {}
    for org in root.iter(f"{{{ORBAT_NS}}}Organisation"):
        sword = org.find(f"{{{SWORD_NS}}}Sword")
        children = org.find(f"{{{ORBAT_NS}}}Children")
        out[org.get("id")] = {
            "name": org.get("name"),
            "has_sword": sword is not None,
            "sword_class": None if sword is None else sword.get("class"),
            "controllable": None if sword is None else sword.get("controllable"),
            "child_count": 0 if children is None else len(list(children)),
        }
    return out


# ── The golden file itself ──────────────────────────────────────────────────


def test_the_golden_file_is_stale_about_location_on_an_organisation():
    """
    The golden file is OUT OF DATE here — our schema is right.

    CSE's example puts <Location> on an Organisation:

        <Organisation id="3" name="A Company (Tanks)" …>
          <Location latitude="69.4612" longitude="30.1985"/>
          <sword:Sword … class="ARMOR.Heavy tank company"/>
        </Organisation>

    validate.xsd rejects that: OrganisationType expects Children there, and
    Location belongs to UnitType. CSE have confirmed our copy of validate.xsd
    is current, so the example predates a schema change rather than the other
    way round.

    The consequence for us is the useful part: DO NOT put a position on an
    organisation, however natural it seems for an automat that is a formation
    standing somewhere. If a SWORD automat needs a location, that is a
    question to put to CSE — not something to infer from this file.

    The test pins the failure to exactly these errors, so the golden file
    stays honest about the one respect in which it cannot be copied. If it
    ever validates cleanly, the schema has changed again and this should
    become the plain "the golden file validates" assertion.
    """
    errors = validate_orbat_xml(ET.tostring(golden_root(), encoding="unicode"))
    assert errors, "golden file now validates — the schema has changed, simplify this test"
    assert all("Location" in e for e in errors), (
        f"unexpected validation errors beyond the known Location staleness: {errors}"
    )


def test_automats_are_leaves_in_the_golden_file():
    """
    The reason generation must stop at an automat.

    "A Company (Tanks)" carries ARMOR.Heavy tank company and has no children:
    the automat already contains its platoons. Anything beneath it would be a
    second copy of the same force.
    """
    orgs = organisations(golden_root())
    assert orgs["3"]["sword_class"] == "ARMOR.Heavy tank company"
    assert orgs["3"]["child_count"] == 0
    assert orgs["4"]["child_count"] == 0


def test_the_aggregate_carries_a_classless_sword_block():
    """The root is composed by SWORD, not spawned — so a Sword block, no class."""
    root = organisations(golden_root())["1"]
    assert root["has_sword"] is True
    assert root["sword_class"] is None
    assert root["child_count"] == 3


# ── Our output, diffed against it ───────────────────────────────────────────


def test_our_output_validates():
    assert validate_orbat_xml(ET.tostring(ours_root(), encoding="unicode")) == []


def test_we_emit_the_same_organisations():
    assert set(organisations(ours_root())) == set(organisations(golden_root()))


def test_we_strip_the_catalogue_suffix_from_the_sword_class():
    """
    Our identifiers are "ARMOR.Heavy tank company|automat"; CSE writes
    "ARMOR.Heavy tank company". SWORD matches on its own catalogue name, so the
    suffix has to come off before it reaches the XML.
    """
    ours = organisations(ours_root())
    golden = organisations(golden_root())
    for node_id in ("2", "3", "4"):
        assert ours[node_id]["sword_class"] == golden[node_id]["sword_class"], (
            f"node {node_id}: emitted {ours[node_id]['sword_class']!r}, "
            f"CSE writes {golden[node_id]['sword_class']!r}"
        )


def test_we_emit_a_classless_sword_block_on_the_aggregate():
    ours = organisations(ours_root())["1"]
    assert ours["has_sword"] is True, (
        "the aggregate got no <sword:Sword> element; CSE emits a classless one "
        "so SWORD knows to compose the formation from the automats below it"
    )
    assert ours["sword_class"] in (None, "")


def test_we_keep_automats_childless():
    ours = organisations(ours_root())
    for node_id in ("2", "3", "4"):
        assert ours[node_id]["child_count"] == 0


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
            print(f"FAIL  {name}\n        {exc}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"ERROR {name}: {type(exc).__name__}: {exc}")
    print(f"\n{failures} failure(s)")
    sys.exit(1 if failures else 0)
