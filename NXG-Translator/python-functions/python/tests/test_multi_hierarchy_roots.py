"""
An operation with several ORBATs must export all of them, in one document.

_load_stores used to pick the operation's hierarchy with next(iter(...), None):
one kept, the rest silently dropped, and no ordering on the query so which one
survived was arbitrary. OP-NEXGEN-2026 has three hierarchies - FRIENDLY (25
edges), ENEMY (19) and an empty third - so the export was one force, or none at
all, with no error either way.

These tests cover the two claims the fix rests on. Neither needs a live
ontology, which is the point: the live query is one line, the behaviour that
makes it correct is here.

    python -m pytest tests/test_multi_hierarchy_roots.py
    python tests/test_multi_hierarchy_roots.py      # no pytest needed
"""

from __future__ import annotations

import os
import sys
from xml.etree import ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.ontology_store import OntologyStore  # noqa: E402
from src.xml_translator import orbat_to_xml  # noqa: E402
from src.xml_validator import validate_orbat_xml  # noqa: E402

NS_BASE = "https://accenture.com/2026-03/cse/orbat"


# ── Fixtures ────────────────────────────────────────────────────────────────


def _edge(parent: str, child: str) -> dict:
    return {
        "primaryKey": f"EDGE-{parent}-{child}",
        "parentUnitKey": parent,
        "childUnitKey": child,
        "relationshipTypeKey": "RELTYPE-ORGANIC",
        "validFrom": "2026-09-15",
        "validTo": None,
    }


def _two_hierarchy_store() -> OntologyStore:
    """
    What the loader now hands over: the units and edges of TWO hierarchies,
    concatenated. A friendly battlegroup and an enemy battalion, each a tree,
    with no edge between them.
    """
    friendly_edges = [_edge("BG-FRIENDLY", "COY-A"), _edge("COY-A", "PL-1")]
    enemy_edges = [_edge("BN-ENEMY", "COY-RED"), _edge("COY-RED", "PL-RED-1")]

    keys = ["BG-FRIENDLY", "COY-A", "PL-1", "BN-ENEMY", "COY-RED", "PL-RED-1"]

    return OntologyStore(
        {
            "operation": {
                "primaryKey": "OPERATION-BALTIC-SHIELD",
                "startTime": "2026-09-15",
                "endTime": "2026-09-30",
                "terrainName": "kaliningrad",
            },
            "units": [
                {"primaryKey": k, "unitIdentifier": k, "entityType": "organisation"}
                for k in keys
            ],
            # Deliberately interleaved rather than grouped: the store must not
            # depend on one hierarchy's edges arriving contiguously.
            "unitHierarchyEdges": [
                friendly_edges[0],
                enemy_edges[0],
                friendly_edges[1],
                enemy_edges[1],
            ],
        }
    )


def _organisation(node_id: int, name: str, sidc: str, children: list) -> dict:
    return {
        "$type": "organisation",
        "id": node_id,
        "name": name,
        "sidc": sidc,
        "isExpanded": True,
        "sword": {"controllable": True, "class": "Armored squadron"},
        "children": children,
    }


# ── The store yields one root per force ─────────────────────────────────────


def test_two_hierarchies_give_two_roots():
    """
    The whole merge rests on this. OntologyStore is hierarchy-blind - its edge
    records carry no hierarchy key - so two concatenated trees are simply two
    sets of parentage, and a root is any unit that is nobody's child.
    """
    store = _two_hierarchy_store()
    roots = sorted(u.primary_key for u in store.get_root_units())

    assert roots == ["BG-FRIENDLY", "BN-ENEMY"], roots
    assert store.unit_count() == 6
    assert store.edge_count() == 4


def test_each_force_keeps_its_own_subtree():
    """
    Merging must not entangle the forces. Each root's descendants are its own.
    """
    store = _two_hierarchy_store()

    friendly_children = [u.primary_key for u in store.get_children("BG-FRIENDLY")]
    enemy_children = [u.primary_key for u in store.get_children("BN-ENEMY")]

    assert friendly_children == ["COY-A"], friendly_children
    assert enemy_children == ["COY-RED"], enemy_children
    assert [u.primary_key for u in store.get_children("COY-A")] == ["PL-1"]
    assert [u.primary_key for u in store.get_children("COY-RED")] == ["PL-RED-1"]


def test_single_hierarchy_still_gives_one_root():
    """
    The common case must not regress. OP-NORDIC-2026 has one hierarchy and one
    root, and should stay that way.
    """
    store = OntologyStore(
        {
            "operation": {"primaryKey": "OP-NORDIC-2026", "startTime": "2026-09-15"},
            "units": [
                {"primaryKey": k, "unitIdentifier": k, "entityType": "organisation"}
                for k in ["BTL", "COY"]
            ],
            "unitHierarchyEdges": [_edge("BTL", "COY")],
        }
    )
    assert [u.primary_key for u in store.get_root_units()] == ["BTL"]


# ── A two-force document is valid CSE XML ───────────────────────────────────


def test_combined_force_document_has_two_root_organisations():
    """
    validate.xsd declares <Entities> as Organisation minOccurs=1
    maxOccurs="unbounded", so friendly and enemy belong in ONE document as
    sibling roots. This asserts the serialiser actually emits that shape.
    """
    merged = {
        "entities": [
            _organisation(0, "Battlegroup NEXGEN", "SFGPU-------", []),
            _organisation(10, "1st MR Battalion", "SHGPU-------", []),
        ]
    }

    xml = orbat_to_xml(merged)
    root = ET.fromstring(xml)

    entities = root.find(f"{{{NS_BASE}}}Entities")
    if entities is None:
        entities = root.find("Entities")
    assert entities is not None, xml

    organisations = list(entities)
    assert len(organisations) == 2, ET.tostring(entities, encoding="unicode")

    assert all(
        o.tag in (f"{{{NS_BASE}}}Organisation", "Organisation") for o in organisations
    ), [o.tag for o in organisations]

    names = [o.get("name") for o in organisations]
    assert names == ["Battlegroup NEXGEN", "1st MR Battalion"], names

    # Order is the order the roots were loaded in, which is what lets a caller
    # put friendly first and enemy second and have it come out that way.
    sidcs = [o.get("sidc") for o in organisations]
    assert sidcs[0].startswith("SF"), sidcs  # friend
    assert sidcs[1].startswith("SH"), sidcs  # hostile


def test_combined_force_document_validates_against_the_real_xsd():
    """
    The claim that matters, checked against the shipped schemas rather than
    asserted: a single ORBAT carrying both forces is valid. If CSE ever tightens
    <Entities> to a single root, this is what will tell us.
    """
    merged = {
        "entities": [
            _organisation(0, "Battlegroup NEXGEN", "SFGPU-------", []),
            _organisation(10, "1st MR Battalion", "SHGPU-------", []),
        ]
    }

    errors = validate_orbat_xml(orbat_to_xml(merged))
    assert errors == [], errors


if __name__ == "__main__":
    for name, fn in sorted(list(globals().items())):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
    print("all passed")
