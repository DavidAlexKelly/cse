"""
Guard the property names reconcile_scenario_orbat writes through.

_upsert_units_batch builds a kwargs dict by hand and hands it to
NxgUnit.create(**props) / setattr(editable, ...). Nothing type-checks those
strings, and getting one wrong fails in two different and equally unhelpful
ways:

  create()  TypeError: unexpected keyword argument 'dis_6_code'
  setattr() lands on an attribute the object never persists — silent

"dis_6_code" was wrong for months for exactly that reason: the OSDK snake-cases
the apiName "dis6Code" to "dis6_code", keeping the digit attached to the word
before it. The result was that no reconcile could ever write a unit's canonical
asset link, which is why every ORBAT the generator produced came back with no
asset — see also the owningSimulator mapping in the same function.

These are cheap assertions against the generated SDK, so the next rename breaks
a test rather than a demo.
"""

import pytest

ontology_sdk = pytest.importorskip(
    "ontology_sdk",
    reason="generated Ontology SDK is only present in the build environment",
)

#: (json key, property name) pairs as _upsert_units_batch writes them.
UNIT_PROPERTY_NAMES = [
    "unit_identifier",
    "entity_type",
    "owning_simulator",
    "dis",
    "can_control_drones",
    "simulator_identifier_code",
    "latitude",
    "longitude",
    "military_service",
    "echelon",
    "sidc",
    "affiliation",
    "allegiance",
    "unit_type_key",
    "equipment_type_key",
    "dis6_code",
]


def _nxg_unit_properties() -> set[str]:
    """
    The property names NxgUnit accepts, snake-cased.

    Read off NxgUnit.object_type rather than NxgUnit: the generated object
    class exposes links and helpers, while the properties live on the object
    type as ClassVars (dis6_code = Properties.string("dis6Code")). Introspecting
    the wrong one returns False for every name and makes this test vacuous.
    """
    from ontology_sdk.ontology.objects import NxgUnit

    return {name for name in dir(NxgUnit.object_type) if not name.startswith("_")}


@pytest.mark.parametrize("prop", UNIT_PROPERTY_NAMES)
def test_every_property_reconcile_writes_exists_on_nxg_unit(prop):
    assert prop in _nxg_unit_properties(), (
        f'reconcile_scenario_orbat writes "{prop}", which NxgUnit does not have. '
        f"create() will raise and setattr() will drop it silently."
    )


def test_the_misspelling_that_caused_this_is_still_gone():
    assert "dis_6_code" not in _nxg_unit_properties()


def test_reconcile_can_stamp_the_phase_on_a_hierarchy():
    """reconcile_scenario_orbat writes phase_key for per-phase ORBATs."""
    from ontology_sdk.ontology.objects import NxgUnitHierarchy

    props = {name for name in dir(NxgUnitHierarchy.object_type) if not name.startswith("_")}
    for prop in ("name", "operation_key", "valid_from", "valid_to", "phase_key"):
        assert prop in props, f'_upsert_hierarchy writes "{prop}", which NxgUnitHierarchy does not have.'
