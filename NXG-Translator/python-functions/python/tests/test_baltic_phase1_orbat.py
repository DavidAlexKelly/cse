"""
The BALTIC SHIELD phase 1 ORBAT translates to a valid two-force document.

This runs the real pipeline - OntologyStore -> translate -> orbat_to_xml ->
validate_orbat_xml against the shipped XSDs - over the exact payload that
tools/build_baltic_phase1.py sends to the Ontology. It is checked here rather
than only after import because every bug in this workstream so far produced XML
that was locally plausible and still wrong: an empty document with no error, a
force with 47 vehicle roots, a subtree counted twice. Importing 59 units and
57 edges into the Ontology and finding out afterwards is the expensive order to
do this in.

    cd python-functions/python && PYTHONPATH=. python3 tests/test_baltic_phase1_orbat.py
"""

from __future__ import annotations

import importlib.util
import os
import sys
from xml.etree import ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.config_store import SimulatorConfigStore  # noqa: E402
from src.ontology_store import OntologyStore  # noqa: E402
from src.translator import dropped_units, translate  # noqa: E402
from src.utils import reset_ids  # noqa: E402
from src.xml_translator import orbat_to_xml  # noqa: E402
from src.xml_validator import validate_orbat_xml  # noqa: E402

NS_BASE = "https://accenture.com/2026-03/cse/orbat"
TERRAIN = "kaliningrad"

FRIENDLY_ROOT = "UNIT-BSP1-BG-1YORKS"
ENEMY_ROOT = "UNIT-BSP1-OPFOR-BTG"


def _load_payload() -> dict:
    """
    Import the generator by path: tools/ is a scripts directory, not a package,
    and the test must read the SAME payload that gets imported rather than a
    copy that can drift away from it.
    """
    path = os.path.join(os.path.dirname(__file__), "..", "tools", "build_baltic_phase1.py")
    spec = importlib.util.spec_from_file_location("build_baltic_phase1", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.payload


def _store(payload: dict, resolve_assets: bool = True) -> OntologyStore:
    """
    Build the store the way the live loader would.

    _load_stores resolves each unit's VBS4 asset by querying
    NxgVbs4AssetCatalogue.identifier.in_(simulator_identifier_codes) and hands
    the result to OntologyStore. Offline there is no catalogue, so the lookup is
    stubbed from each unit's own simulatorIdentifierCode. That models the live
    behaviour exactly as long as every class name really exists in the
    catalogue, which is checked separately against the live ontology.

    resolve_assets=False reproduces the unresolved case, which is what makes
    test_platforms_are_dropped_without_a_resolved_asset meaningful.
    """
    operation = dict(payload["operation"])
    operation["terrainName"] = TERRAIN

    units = []
    for unit in payload["units"]:
        unit = dict(unit)
        code = unit.get("simulatorIdentifierCode")
        if resolve_assets and code:
            unit["vbs4Asset"] = {"identifier": code, "dis6Code": unit.get("dis")}
        units.append(unit)

    return OntologyStore(
        {
            "operation": operation,
            "units": units,
            "unitHierarchyEdges": payload["unitHierarchyEdges"],
        }
    )


def _translated_xml(payload: dict, resolve_assets: bool = True) -> str:
    reset_ids()
    ontology = _store(payload, resolve_assets=resolve_assets)
    configs = SimulatorConfigStore(
        units=list(ontology._units.values()),
        target_simulator="vbs4",
        terrain_name=TERRAIN,
    )
    return orbat_to_xml(translate(ontology, configs))


# ── Structure ───────────────────────────────────────────────────────────────


def test_payload_has_exactly_two_roots_one_per_force():
    store = _store(_load_payload())
    roots = sorted(u.primary_key for u in store.get_root_units())
    assert roots == sorted([FRIENDLY_ROOT, ENEMY_ROOT]), roots


def test_every_root_is_an_organisation():
    """
    RootOrganisationType exists separately from OrganisationType precisely
    because a root may not be a vehicle. HIER-BALTIC-SHIELD-OPS is the cautionary
    case: 48 roots, 47 of them vehicles, which would serialise to <Vehicle> at
    the top of <Entities> and fail the schema.
    """
    store = _store(_load_payload())
    for unit in store.get_root_units():
        assert unit.entity_type == "organisation", (unit.primary_key, unit.entity_type)


def test_root_children_are_all_organisations():
    """
    RootOrganisationType Children may contain ONLY Organisation - no raw units -
    so a platform hung directly off a force root is invalid even though the same
    platform is fine one level lower.
    """
    store = _store(_load_payload())
    for root in store.get_root_units():
        for child in store.get_children(root.primary_key):
            assert child.entity_type == "organisation", (
                root.primary_key,
                child.primary_key,
                child.entity_type,
            )


def test_forces_share_no_units():
    """
    A unit reachable from both roots would be built twice and the exported force
    would be larger than the one anyone authored.
    """
    store = _store(_load_payload())

    def descendants(key: str) -> set[str]:
        seen: set[str] = set()
        stack = [key]
        while stack:
            node = stack.pop()
            for child in store.get_children(node):
                if child.primary_key not in seen:
                    seen.add(child.primary_key)
                    stack.append(child.primary_key)
        return seen

    friendly = descendants(FRIENDLY_ROOT) | {FRIENDLY_ROOT}
    enemy = descendants(ENEMY_ROOT) | {ENEMY_ROOT}
    assert friendly & enemy == set(), friendly & enemy
    assert len(friendly) + len(enemy) == store.unit_count(), (
        len(friendly),
        len(enemy),
        store.unit_count(),
    )


# ── The exported document ───────────────────────────────────────────────────


def test_exports_two_sibling_root_organisations():
    xml = _translated_xml(_load_payload())
    root = ET.fromstring(xml)

    entities = root.find(f"{{{NS_BASE}}}Entities") or root.find("Entities")
    assert entities is not None, xml[:500]

    organisations = list(entities)
    assert len(organisations) == 2, [o.tag for o in organisations]
    assert all(
        o.tag in (f"{{{NS_BASE}}}Organisation", "Organisation") for o in organisations
    ), [o.tag for o in organisations]

    sidcs = [o.get("sidc") or "" for o in organisations]
    affiliations = sorted(s[1] for s in sidcs if len(s) > 1)
    assert affiliations == ["F", "H"], sidcs


def test_document_validates_against_the_real_xsd():
    """
    The one that matters. If this fails, nothing should be imported.
    """
    errors = validate_orbat_xml(_translated_xml(_load_payload()))
    assert errors == [], errors


def test_document_is_not_vacuously_small():
    """
    A document can validate and still be empty of anything spawnable, which is
    exactly how the NEXGEN export failed silently. Assert the force is actually
    in there.
    """
    payload = _load_payload()
    xml = _translated_xml(payload)

    for expected in ("1 YORKS Battlegroup", "200th Motor Rifle Battalion Tactical Group"):
        assert expected in xml, expected

    # Every organisation in the payload should appear as an element; platforms
    # may legitimately be dropped if unmapped, so they are not asserted here.
    organisations = [u for u in payload["units"] if u["entityType"] == "organisation"]
    root = ET.fromstring(xml)
    emitted = sum(1 for _ in root.iter(f"{{{NS_BASE}}}Organisation")) or sum(
        1 for _ in root.iter("Organisation")
    )
    assert emitted == len(organisations), (emitted, len(organisations))


def test_no_unit_is_dropped_during_translation():
    """
    The failure this is here for: every platform carried a correct DIS code but
    no simulatorIdentifierCode, so build_tree dropped all 32 of them and the
    export was 27 empty organisations that still passed the XSD. Units are
    linked to their VBS4 asset by simulatorIdentifierCode, not by DIS code.
    """
    payload = _load_payload()
    reset_ids()
    ontology = _store(payload)
    configs = SimulatorConfigStore(
        units=list(ontology._units.values()),
        target_simulator="vbs4",
        terrain_name=TERRAIN,
    )
    translate(ontology, configs)

    dropped = [d.get("primaryKey") or d.get("primary_key") for d in dropped_units()]
    assert dropped == [], dropped


def test_every_fighting_platform_reaches_the_document():
    payload = _load_payload()
    xml = _translated_xml(payload)
    platforms = [u for u in payload["units"] if u["entityType"] != "organisation"]
    assert platforms, "fixture has no platforms"
    missing = [p["primaryKey"] for p in platforms if p["unitIdentifier"] not in xml]
    assert missing == [], missing


def test_platforms_are_dropped_without_a_resolved_asset():
    """
    Guards the guard. If translation stopped dropping asset-less platforms, the
    two tests above would pass for the wrong reason and stop protecting anything.
    """
    payload = _load_payload()
    reset_ids()
    ontology = _store(payload, resolve_assets=False)
    configs = SimulatorConfigStore(
        units=list(ontology._units.values()),
        target_simulator="vbs4",
        terrain_name=TERRAIN,
    )
    translate(ontology, configs)
    assert len(dropped_units()) == len(
        [u for u in payload["units"] if u["entityType"] != "organisation"]
    )


def test_every_platform_has_a_vbs4_class():
    payload = _load_payload()
    for unit in payload["units"]:
        if unit["entityType"] == "organisation":
            continue
        assert unit.get("simulatorIdentifierCode"), unit["primaryKey"]


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"FAIL {name}: {type(exc).__name__}: {exc}")
    print("\nall passed" if not failures else f"\n{failures} failure(s)")
    sys.exit(1 if failures else 0)
