"""
A unit that fails to build must not leave the ORBAT silently.

This is the failure mode the rest of preflight structurally cannot catch: it
inspects the tree that was built, so a node that never got built is invisible
to it. The ORBAT comes back well-formed, schema-valid, preflight-clean — and
containing less force than the planner asked for.

Six aircraft were leaving OP-NORDIC-2026 this way on every run because
build_tree had no SimWorks branch for "aircraft". Both halves are covered
here: the branch that was missing, and the reporting that would have made its
absence obvious years sooner.
"""

from src.builders import build_simworks_aircraft
from src.config_store import SimworksConfig, UnitSimulatorConfig, VBS4Config
from src.orbat_preflight import preflight_orbat


class FakeUnit:
    """Only the fields the builders touch."""

    def __init__(self, primary_key="UNIT-CAS-TYPHOON-1", name="Typhoon Alpha"):
        self.primary_key = primary_key
        self.unit_identifier = name
        self.sidc = "SFAPMFF----D---"
        self.latitude = 59.4
        self.longitude = 24.7


def simworks_aircraft_config(with_canonical_vbs4=False):
    vbs4 = None
    if with_canonical_vbs4:
        vbs4 = VBS4Config(
            class_name="vbs2_gb_typhoon",
            role="None",
            is_drone=False,
            gunner_seat={"turretIdentifier": "", "name": "None"},
            all_gunner_seats=[],
            has_commander=False,
            num_cargo_seats=0,
            sensor_streaming_settings={},
            streaming_settings={},
        )
    return UnitSimulatorConfig(
        unit_key="UNIT-CAS-TYPHOON-1",
        entity_type="aircraft",
        owning_simulator="Simworks",
        dis="1.2.225.1.1.1.0",
        simworks=SimworksConfig(class_name="GBR EUROFIGHTER TYPHOON (FIGHTER)"),
        canonical_vbs4=vbs4,
    )


def test_a_simworks_aircraft_builds_without_a_vbs4_block():
    # The whole bug: this used to go through build_aircraft, which raises
    # "has no vbs4 config block", and the aircraft vanished.
    node = build_simworks_aircraft(FakeUnit(), simworks_aircraft_config(), [])
    assert node["$type"] == "aircraft"
    assert node["simworks"]["className"] == "GBR EUROFIGHTER TYPHOON (FIGHTER)"
    assert "vbs4" not in node
    assert node["owningSimulator"] == "Simworks"


def test_it_still_carries_vbs4_when_the_canonical_asset_links_one():
    # Same as build_simworks_vehicle: VBS4 gets position updates for the asset.
    node = build_simworks_aircraft(FakeUnit(), simworks_aircraft_config(True), [])
    assert node["vbs4"]["className"] == "vbs2_gb_typhoon"
    assert node["$type"] == "aircraft"


def test_it_refuses_an_aircraft_with_no_simworks_block():
    config = simworks_aircraft_config()
    config.simworks = None
    try:
        build_simworks_aircraft(FakeUnit(), config, [])
    except ValueError as exc:
        assert "simworks" in str(exc)
    else:
        raise AssertionError("expected a ValueError")


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def _orbat_with(dropped):
    return {
        "entities": [
            {
                "$type": "organisation",
                "id": 1,
                "name": "1 Bde",
                "sword": {"controllable": False, "class": "x"},
                "children": [],
            }
        ],
        "droppedUnits": dropped,
    }


def test_a_dropped_unit_is_an_error_naming_the_unit_and_the_reason():
    issues = preflight_orbat(
        _orbat_with(
            [{"primaryKey": "UNIT-CAS-TYPHOON-1", "name": "Typhoon Alpha", "reason": "no simulator config"}]
        )
    )
    dropped = [i for i in issues if i["code"] == "UNIT_DROPPED"]
    assert len(dropped) == 1
    assert dropped[0]["severity"] == "ERROR"
    assert dropped[0]["entityName"] == "Typhoon Alpha"
    assert "no simulator config" in dropped[0]["message"]


def test_no_drops_means_nothing_said():
    assert [i for i in preflight_orbat(_orbat_with([])) if i["code"] == "UNIT_DROPPED"] == []


def test_drops_are_reported_even_when_the_orbat_is_otherwise_empty():
    # The empty-ORBAT early return used to discard everything found before it,
    # which is precisely the case where knowing what was dropped matters most.
    issues = preflight_orbat(
        {"entities": [], "droppedUnits": [{"primaryKey": "U1", "name": "Only unit", "reason": "boom"}]}
    )
    codes = {i["code"] for i in issues}
    assert "UNIT_DROPPED" in codes
    assert "NO_ENTITIES" in codes
