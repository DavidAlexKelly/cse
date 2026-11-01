"""
The Foundry entry points, end to end, against a fake ontology.

_load_stores → _translate_all → preflight / XML, which until now only ran in
Foundry. Each test pins one item of workstream 1 of ORBAT_PIPELINE_PLAN.md:

  1.1  dropped units (and their sub-trees) reach preflight
  1.2  a unit with no position is a POSITION_MISSING error
  1.3  phase units are found by key prefix as well as through edges
  1.4  the SWORD → VBS4 injection never adds a vehicle
  1.5  one bad unit does not sink the translation
  1.6  SWORD formations under a non-SWORD root are still exported
  1.7  a phase that is not the operation's is an error
  1.8  ORBAT ids are stable across runs and input order
"""

from __future__ import annotations

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))

from fake_foundry import (  # noqa: E402
    FakeClient,
    edge,
    hierarchy,
    load_translate_functions,
    operation,
    simworks_asset,
    sword_asset,
    unit,
    vbs4_asset,
    walk,
)
from src.orbat_preflight import preflight_orbat  # noqa: E402
from src.utils import assign_stable_ids, get_stable_id  # noqa: E402

tf = load_translate_functions()

TANK = "vbs_gb_challenger"
CREW = "vbs_gb_crewman"


def _client(units, edges, hierarchies=None, **assets):
    return FakeClient(
        NxgOperation=[operation()],
        NxgUnitHierarchy=hierarchies or [hierarchy("H1", phase_key="P1")],
        NxgUnit=units,
        NxgUnitHierachyEdge=edges,
        NxgVbs4AssetCatalogue=assets.get("vbs4", [vbs4_asset(TANK), vbs4_asset(CREW, dis="1.1.826.3.0.0.0")]),
        NxgOSwordAssetCatalogue=assets.get("sword", []),
        NxgSimworksAssetCatalogue=assets.get("simworks", []),
    )


def _translate(client, phase_key="P1"):
    ontology, configs, vbs4_by_dis = tf._load_stores("OP-TEST", "vbs4", phase_key=phase_key, client=client)
    return tf._translate_all(ontology, configs, vbs4_by_dis=vbs4_by_dis)


def _names(orbat) -> set[str]:
    return {n["name"] for n in walk(orbat["entities"])}


def _codes(orbat) -> list[str]:
    return [i["code"] for i in preflight_orbat(orbat)]


def _basic_force(prefix="P1"):
    """BG → COY → tank, all phase-keyed."""
    units = [
        unit(f"{prefix}--BG"),
        unit(f"{prefix}--COY"),
        unit(f"{prefix}--TANK", "vehicle", code=TANK),
    ]
    edges = [
        edge("H1", f"{prefix}--BG", f"{prefix}--COY"),
        edge("H1", f"{prefix}--COY", f"{prefix}--TANK"),
    ]
    return units, edges


# ── 1.3 lone units ───────────────────────────────────────────────────────────


def test_a_lone_phase_unit_is_found_by_key_prefix_and_becomes_a_root():
    units, edges = _basic_force()
    units += [unit("P1--LONE-HQ"), unit("P2--OTHER-PHASE")]
    orbat = _translate(_client(units, edges))

    roots = {e["name"] for e in orbat["entities"]}
    assert roots == {"P1--BG", "P1--LONE-HQ"}
    assert "P2--OTHER-PHASE" not in _names(orbat)


def test_a_phase_with_only_lone_units_translates_instead_of_raising():
    orbat = _translate(_client([unit("P1--ONLY")], []))
    assert [e["name"] for e in orbat["entities"]] == ["P1--ONLY"]


def test_no_edges_and_no_prefix_units_is_still_an_error():
    with pytest.raises(ValueError, match="No unit hierarchy edges"):
        _translate(_client([unit("P2--ELSEWHERE")], []))


def test_a_failing_prefix_search_falls_back_to_edges(caplog):
    units, edges = _basic_force()
    units.append(unit("P1--LONE-HQ"))
    client = _client(units, edges)
    client.fail_prefix_search = True

    orbat = _translate(client)

    assert "P1--LONE-HQ" not in _names(orbat)
    assert "P1--TANK" in _names(orbat)
    assert "edges only" in caplog.text


# ── phase filtering, 1.7 ─────────────────────────────────────────────────────


def test_only_the_requested_phase_is_exported():
    p1_units, p1_edges = _basic_force("P1")
    p2_units = [unit("P2--BG"), unit("P2--COY")]
    p2_edges = [edge("H2", "P2--BG", "P2--COY")]
    client = _client(
        p1_units + p2_units,
        p1_edges + p2_edges,
        hierarchies=[hierarchy("H1", "P1"), hierarchy("H2", "P2")],
    )

    assert _names(_translate(client, "P2")) == {"P2--BG", "P2--COY"}
    assert "P2--BG" not in _names(_translate(client, "P1"))


def test_a_phase_that_is_not_the_operations_names_both():
    units, edges = _basic_force()
    with pytest.raises(ValueError) as err:
        _translate(_client(units, edges), phase_key="P9")
    assert "'P9'" in str(err.value) and "'OP-TEST'" in str(err.value)


# ── 1.1 dropped sub-trees ────────────────────────────────────────────────────


def test_a_dropped_parent_reports_its_whole_subtree_to_preflight():
    units, edges = _basic_force()
    # A coy whose entityType the translator does not build, with a platoon and
    # a tank beneath it: all three are missing from the ORBAT.
    units += [
        unit("P1--BAD-COY", entity_type="formation"),
        unit("P1--BAD-PL"),
        unit("P1--BAD-TANK", "vehicle", code=TANK),
    ]
    edges += [
        edge("H1", "P1--BG", "P1--BAD-COY"),
        edge("H1", "P1--BAD-COY", "P1--BAD-PL"),
        edge("H1", "P1--BAD-PL", "P1--BAD-TANK"),
    ]
    orbat = _translate(_client(units, edges))

    dropped = {d["primaryKey"]: d["reason"] for d in orbat["droppedUnits"]}
    assert set(dropped) == {"P1--BAD-COY", "P1--BAD-PL", "P1--BAD-TANK"}
    assert "formation" in dropped["P1--BAD-COY"]
    assert dropped["P1--BAD-PL"] == "parent P1--BAD-COY dropped"
    assert dropped["P1--BAD-TANK"] == "parent P1--BAD-COY dropped"

    issues = [i for i in preflight_orbat(orbat) if i["code"] == "UNIT_DROPPED"]
    assert {i["entityId"] for i in issues} == set(dropped)


def test_the_simworks_pass_does_not_wipe_drops_from_the_vbs4_pass():
    units, edges = _basic_force()
    units += [
        unit("P1--SW-TRUCK", "vehicle", owning_simulator="simworks", code="sw_truck"),
        unit("P1--BAD", entity_type="formation"),
    ]
    edges += [edge("H1", "P1--COY", "P1--SW-TRUCK"), edge("H1", "P1--BG", "P1--BAD")]
    orbat = _translate(_client(units, edges, simworks=[simworks_asset("sw_truck")]))

    assert "simworks" in orbat["simulators"]
    assert [d["primaryKey"] for d in orbat["droppedUnits"]] == ["P1--BAD"]  # once, not wiped


# ── 1.2 positions ────────────────────────────────────────────────────────────


def test_a_unit_with_no_position_is_a_preflight_error_but_still_exports_0_0():
    units, edges = _basic_force()
    units[2] = unit("P1--TANK", "vehicle", code=TANK, lat=None, lng=None)
    orbat = _translate(_client(units, edges))

    issues = [i for i in preflight_orbat(orbat) if i["code"] == "POSITION_MISSING"]
    assert [(i["severity"], i["entityName"]) for i in issues] == [("ERROR", "P1--TANK")]

    xml = tf.orbat_to_xml(orbat)
    assert 'latitude="0.0"' in xml and 'longitude="0.0"' in xml


def test_a_unit_genuinely_at_0_0_is_not_reported_missing():
    units, edges = _basic_force()
    units[2] = unit("P1--TANK", "vehicle", code=TANK, lat=0.0, lng=0.0)
    assert "POSITION_MISSING" not in _codes(_translate(_client(units, edges)))


# ── 1.4 no duplicate vehicles ────────────────────────────────────────────────


def test_injection_attaches_vbs4_to_the_same_vehicle_and_adds_none():
    bare = {"$type": "vehicle", "id": 2, "name": "SWORD tank", "dis": "1.1.826.1.1.1.0", "children": []}
    simworks = {
        "$type": "vehicle",
        "id": 3,
        "name": "SimWorks tank",
        "dis": "1.1.826.1.1.1.0",
        "simworks": {"className": "sw_tank"},
        "children": [],
    }
    org = {"$type": "organisation", "id": 1, "name": "Sqn", "sword": {"class": "ARMOR"}, "children": [bare, simworks]}
    vbs4_by_dis = {"1.1.826.1.1.1.0": {"identifier": TANK, "gunnerSeatNames": "G", "gunnerSeatTurretIds": "0"}}

    attached = tf._inject_sword_vbs4_assets([org], vbs4_by_dis)

    assert attached == 1
    assert len(org["children"]) == 2
    assert bare["vbs4"]["className"] == TANK and bare["id"] == 2
    assert "vbs4" not in simworks  # would only be dropped at export


def test_a_sword_section_exports_one_node_per_unit_and_no_double_count():
    units = [
        unit("P1--BG"),
        unit("P1--SQN", code="ARMOR.Tank squadron"),  # SWORD aggregate, not an automat
        unit("P1--TANK", "vehicle", code=TANK),
    ]
    edges = [edge("H1", "P1--BG", "P1--SQN"), edge("H1", "P1--SQN", "P1--TANK")]
    orbat = _translate(_client(units, edges, sword=[sword_asset("ARMOR.Tank squadron")]))

    nodes = list(walk(orbat["entities"]))
    assert len(nodes) == 3
    assert [n["name"] for n in nodes if n["$type"] == "vehicle"] == ["P1--TANK"]
    assert len({n["id"] for n in nodes}) == 3
    codes = _codes(orbat)
    assert "DOUBLE_COUNTED" not in codes and "DUPLICATE_ID" not in codes


# ── 1.6 SWORD under an aggregate root ────────────────────────────────────────


def test_sword_formations_under_a_non_sword_root_are_exported():
    automat = "ARMOR.Heavy tank company|automat"
    units = [
        unit("P1--DIV", owning_simulator="sword"),  # structure: no SWORD asset
        unit("P1--BDE", owning_simulator="sword"),  # structure
        unit("P1--COY-A", owning_simulator="sword", code=automat),
        unit("P1--COY-B", owning_simulator="sword", code=automat),
    ]
    edges = [
        edge("H1", "P1--DIV", "P1--BDE"),
        edge("H1", "P1--BDE", "P1--COY-A"),
        edge("H1", "P1--BDE", "P1--COY-B"),
    ]
    orbat = _translate(_client(units, edges, vbs4=[], sword=[sword_asset(automat)]))

    assert orbat["simulators"] == ["sword"]
    assert sorted(e["name"] for e in orbat["entities"]) == ["P1--COY-A", "P1--COY-B"]
    assert all(e["sword"]["class"] == "ARMOR.Heavy tank company" for e in orbat["entities"])
    assert orbat["droppedUnits"] == []


# ── 1.5 one bad unit ─────────────────────────────────────────────────────────


def test_simworks_crew_in_a_vbs4_vehicle_no_longer_aborts_the_build():
    units, edges = _basic_force()
    units += [
        unit("P1--DRIVER", "human", code=CREW),
        unit("P1--SW-CREW", "human", owning_simulator="simworks", code="sw_crewman"),
    ]
    edges += [edge("H1", "P1--TANK", "P1--SW-CREW"), edge("H1", "P1--TANK", "P1--DRIVER")]
    orbat = _translate(_client(units, edges, simworks=[simworks_asset("sw_crewman")]))

    tank = next(n for n in walk(orbat["entities"]) if n["name"] == "P1--TANK")
    crew = {c["name"]: c for c in tank["children"]}
    assert set(crew) == {"P1--DRIVER", "P1--SW-CREW"}
    assert crew["P1--DRIVER"]["vbs4"]["role"] == "Driver"
    assert "vbs4" not in crew["P1--SW-CREW"]
    assert orbat["droppedUnits"] == []


def test_an_unexpected_builder_error_drops_that_unit_and_carries_on(monkeypatch):
    import src.translator as translator

    real = translator.build_organisation

    def flaky(unit_, config, children):
        if unit_.primary_key == "P1--COY":
            raise RuntimeError("boom")
        return real(unit_, config, children)

    monkeypatch.setattr(translator, "build_organisation", flaky)
    units, edges = _basic_force()
    units.append(unit("P1--HQ"))
    edges.append(edge("H1", "P1--BG", "P1--HQ"))
    orbat = _translate(_client(units, edges))

    dropped = {d["primaryKey"]: d["reason"] for d in orbat["droppedUnits"]}
    assert "RuntimeError" in dropped["P1--COY"]
    assert dropped["P1--TANK"] == "parent P1--COY dropped"
    assert {"P1--BG", "P1--HQ"} <= _names(orbat)


# ── 1.8 stable ids ───────────────────────────────────────────────────────────


def _ids(orbat) -> dict[str, int]:
    return {n["name"]: n["id"] for n in walk(orbat["entities"])}


def test_ids_are_identical_across_runs_and_independent_of_input_order():
    units, edges = _basic_force()
    units += [unit("P1--HQ"), unit("P1--RECCE")]
    edges += [edge("H1", "P1--BG", "P1--HQ"), edge("H1", "P1--BG", "P1--RECCE")]

    first = _ids(_translate(_client(units, edges)))
    second = _ids(_translate(_client(units, edges)))
    reordered = _ids(_translate(_client(list(reversed(units)), list(reversed(edges)))))

    assert first == second == reordered
    assert first["P1--TANK"] == get_stable_id("P1--TANK")
    assert all(isinstance(i, int) and 1 <= i < 2**31 for i in first.values())


def test_colliding_ids_resolve_uniquely_and_by_sorted_key(monkeypatch):
    import src.utils as utils

    monkeypatch.setattr(utils, "get_stable_id", lambda key: 42)
    forward = utils.assign_stable_ids(["b", "a", "c"])
    backward = utils.assign_stable_ids(["c", "b", "a"])

    assert forward == backward == {"a": 42, "b": 43, "c": 44}


def test_assign_stable_ids_keeps_no_state_between_calls():
    assign_stable_ids([f"OTHER-{i}" for i in range(100)])
    assert assign_stable_ids(["x"]) == {"x": get_stable_id("x")}


# ── 4.1 composition preflight per phase ──────────────────────────────────────


VBS4_ONLY_COMPOSITION = """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE Composition [
    <!ENTITY vbs4 SYSTEM "_Content/.ntfa/service/onearc/service-vbs4.xml">
    ]>
<Composition xmlns="https://accenture.com/2026-03/cse/composition" Name="VBS4 only">
    <Capabilities><Scale MinUnits="1" MaxUnits="50" /></Capabilities>
    <Services>&vbs4;</Services>
</Composition>
"""


def test_phase_composition_preflight_matches_the_operation_shape(monkeypatch):
    units, edges = _basic_force()
    client = _client(units, edges)
    monkeypatch.setattr(tf, "FoundryClient", lambda: client)

    by_phase = json.loads(tf.preflight_orbat_from_phase_for_composition("OP-TEST", "P1", VBS4_ONLY_COMPOSITION))
    by_operation = json.loads(tf.preflight_orbat_for_composition("OP-TEST", VBS4_ONLY_COMPOSITION))

    assert by_phase["operationKey"] == "OP-TEST" and by_phase["phaseKey"] == "P1"
    assert by_phase["composition"]["name"] == "VBS4 only"
    assert set(by_phase) == set(by_operation) | {"phaseKey"}
    assert by_phase["simulatedUnits"] == by_operation["simulatedUnits"]
