"""
reconcile_scenario_orbat against a fake ontology — workstream 2 of
ORBAT_PIPELINE_PLAN.md:

  2.1  a partial update leaves what it does not mention alone
  2.2  every other edge for a managed child goes, whatever its key
  2.3  explicit managedChildUnitKeys: [] manages nothing
  2.4  owningSimulator is written in simulator_targets' vocabulary
  2.5  pruneOrphanUnits removes phase units no longer in the tree
"""

from __future__ import annotations

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))

from fake_foundry import FakeClient, FakeObj, edge, hierarchy, load_translate_functions, unit  # noqa: E402
from src.utils import stable_edge_key  # noqa: E402

tf = load_translate_functions()

HIER = "hier-scn--P1"


@pytest.fixture
def ontology(monkeypatch):
    """Install a FakeClient built from the given objects; return it."""

    def install(units=(), edges=(), hierarchies=None) -> FakeClient:
        client = FakeClient(
            NxgUnit=list(units),
            NxgUnitHierachyEdge=list(edges),
            NxgUnitHierarchy=hierarchies if hierarchies is not None else [hierarchy(HIER, "P1")],
        )
        monkeypatch.setattr(tf, "FoundryClient", lambda: client)
        return client

    return install


def _reconcile(client, units=(), edges=(), **extra):
    payload = {
        "operation": {"primaryKey": "OP-TEST"},
        "unitHierarchy": {"primaryKey": HIER, "phaseKey": "P1"},
        "units": list(units),
        "unitHierarchyEdges": list(edges),
        **extra,
    }
    tf.reconcile_scenario_orbat(json.dumps(payload))
    return client.last_edits


def _req_edge(parent, child):
    return {"parentUnitKey": parent, "childUnitKey": child, "relationshipTypeKey": "RELTYPE-ORGANIC"}


# ── 2.1 partial update ───────────────────────────────────────────────────────


def test_fields_absent_or_null_in_the_payload_are_left_alone(ontology):
    stored = unit("P1--TANK", "vehicle", lat=59.1, lng=24.1, dis="1.1.826.1.1.1.0")
    client = ontology(units=[stored])

    edits = _reconcile(
        client,
        units=[
            {
                "primaryKey": "P1--TANK",
                "unitIdentifier": "Renamed tank",
                "latitude": None,
                "longitude": None,
                "dis": "0.0.0.0.0.0.0",
            }
        ],
    )

    assert edits.edited_props("NxgUnit", "P1--TANK") == {"unit_identifier": "Renamed tank"}


def test_a_real_dis_is_still_written_over_a_stored_one(ontology):
    client = ontology(units=[unit("P1--TANK", "vehicle", dis="0.0.0.0.0.0.0")])
    edits = _reconcile(client, units=[{"primaryKey": "P1--TANK", "dis": "1.1.826.1.1.1.0"}])
    assert edits.edited_props("NxgUnit", "P1--TANK") == {"dis": "1.1.826.1.1.1.0"}


def test_a_new_unit_still_gets_the_defaults(ontology):
    client = ontology()
    edits = _reconcile(client, units=[{"primaryKey": "P1--NEW", "unitIdentifier": "New"}])
    [(pk, props)] = edits.of("create", "NxgUnit")
    assert pk == "P1--NEW"
    assert props == {"unit_identifier": "New", "owning_simulator": "none", "dis": "0.0.0.0.0.0.0"}


# ── 2.4 simulator names ──────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "raw, stored",
    [
        ("Vbs4", "vbs4"),
        ("SIMWORKS", "simworks"),
        ("sword", "sword"),
        ("ascot7", "ascot7"),
        ("JTLS-GO", "jtls-go"),
        ("mace", "mace"),
        ("none", "none"),
        ("not-a-simulator", "none"),
    ],
)
def test_owning_simulator_is_normalised_through_simulator_targets(ontology, raw, stored):
    client = ontology()
    edits = _reconcile(client, units=[{"primaryKey": "P1--U", "owningSimulator": raw}])
    [(_, props)] = edits.of("create", "NxgUnit")
    assert props["owning_simulator"] == stored


# ── 2.2 leftover edges ───────────────────────────────────────────────────────


def test_legacy_and_stale_edges_for_a_managed_child_are_removed(ontology):
    deterministic = stable_edge_key(HIER, "P1--BG", "P1--COY")
    client = ontology(
        edges=[
            edge(HIER, "P1--BG", "P1--COY", key="5f1c2b9e-legacy-uuid"),  # same parent, old key
            edge(HIER, "P1--OLD-BG", "P1--COY", key="EDGE-OLDPARENT"),  # other parent
            edge(HIER, "P1--BG", "P1--COY", key=deterministic),  # the one to keep
            edge(HIER, "P1--COY", "P1--PL", key="EDGE-SUBTREE"),  # not managed: untouched
        ]
    )

    edits = _reconcile(client, edges=[_req_edge("P1--BG", "P1--COY")])

    deleted = {pk for pk, _ in edits.of("delete", "NxgUnitHierachyEdge")}
    assert deleted == {"5f1c2b9e-legacy-uuid", "EDGE-OLDPARENT"}


# ── 2.3 managedChildUnitKeys ─────────────────────────────────────────────────


def test_an_explicit_empty_managed_list_manages_nothing(ontology):
    client = ontology(edges=[edge(HIER, "P1--OLD-BG", "P1--COY", key="EDGE-OLDPARENT")])
    edits = _reconcile(client, edges=[_req_edge("P1--BG", "P1--COY")], managedChildUnitKeys=[])
    assert edits.of("delete", "NxgUnitHierachyEdge") == []


def test_an_absent_managed_list_still_defaults_to_the_requested_children(ontology):
    client = ontology(edges=[edge(HIER, "P1--OLD-BG", "P1--COY", key="EDGE-OLDPARENT")])
    edits = _reconcile(client, edges=[_req_edge("P1--BG", "P1--COY")])
    assert [pk for pk, _ in edits.of("delete", "NxgUnitHierachyEdge")] == ["EDGE-OLDPARENT"]


# ── 2.5 orphan prune ─────────────────────────────────────────────────────────


def _orphan_world(ontology):
    return ontology(
        units=[
            unit("P1--BG"),
            unit("P1--COY"),
            unit("P1--ENEMY"),  # parented in another hierarchy of the phase
            unit("P1--ENEMY-BN"),
            unit("P1--STRAY"),  # nothing refers to it
            unit("P1--REMOVED"),  # its only edge is removed by this call
            unit("P2--ELSEWHERE"),  # another phase
            FakeObj(primary_key_="UNPREFIXED"),
        ],
        edges=[
            edge("hier-scn--P1-enemy", "P1--ENEMY-BN", "P1--ENEMY", key="EDGE-ENEMY"),
            edge(HIER, "P1--BG", "P1--REMOVED", key="EDGE-REMOVED"),
        ],
    )


def test_prune_orphans_deletes_only_unreferenced_phase_units(ontology):
    client = _orphan_world(ontology)
    edits = _reconcile(
        client,
        units=[{"primaryKey": "P1--BG"}, {"primaryKey": "P1--COY"}],
        edges=[_req_edge("P1--BG", "P1--COY")],
        managedChildUnitKeys=["P1--COY", "P1--REMOVED"],
        pruneOrphanUnits=True,
    )

    assert {pk for pk, _ in edits.of("delete", "NxgUnitHierachyEdge")} == {"EDGE-REMOVED"}
    assert {pk for pk, _ in edits.of("delete", "NxgUnit")} == {"P1--STRAY", "P1--REMOVED"}


def test_prune_orphans_is_off_by_default(ontology):
    client = _orphan_world(ontology)
    edits = _reconcile(client, units=[{"primaryKey": "P1--BG"}], edges=[])
    assert edits.of("delete", "NxgUnit") == []


def test_prune_orphans_needs_a_phase_key(ontology):
    client = _orphan_world(ontology)
    payload = {
        "operation": {"primaryKey": "OP-TEST"},
        "unitHierarchy": {"primaryKey": HIER},
        "units": [],
        "unitHierarchyEdges": [],
        "pruneOrphanUnits": True,
    }
    tf.reconcile_scenario_orbat(json.dumps(payload))
    assert client.last_edits.of("delete", "NxgUnit") == []
