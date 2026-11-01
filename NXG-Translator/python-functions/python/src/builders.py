"""
Node builders — one function per entity type / simulator.

Each builder takes ontology objects + simulator config and returns
a dict matching the ORBAT JSON schema for the relevant simulator
(VBS4 or SimWorks).
"""

from __future__ import annotations
from typing import Optional

from src.ontology_store import Unit
from src.config_store import UnitSimulatorConfig
from src.representation import REPRESENTATION_FIELD, representation_of_unit
from src.utils import get_stable_id


def orbat_id_for(unit: Unit, config: UnitSimulatorConfig) -> int:
    """The unit's integer ORBAT id: the store-assigned one, else the plain hash."""
    orbat_id = getattr(config, "orbat_id", None)
    return orbat_id if orbat_id is not None else get_stable_id(unit.primary_key)


#: Internal flag set on a unit node whose NxgUnit has no latitude/longitude.
#: The XML still writes 0,0 (Location is required on units), so the flag is
#: what lets orbat_preflight report POSITION_MISSING instead of the unit
#: silently spawning at 0,0. xml_translator only reads keys it knows about, so
#: this never reaches the document.
POSITION_MISSING_FIELD = "positionMissing"


# ---------------------------------------------------------------------------
# Base node — fields common to all entity types
# ---------------------------------------------------------------------------


def build_base_fields(
    unit: Unit,
    config: UnitSimulatorConfig,
) -> dict:
    """
    Build the fields shared by all VBS4 entity types.

    Location is read directly from NxgUnit (latitude/longitude are
    first-class properties on the unit object type).

    Args:
        unit:   Unit ontology object
        config: Simulator-specific configuration

    Returns:
        Dict of base fields
    """
    position_missing = unit.latitude is None or unit.longitude is None
    location = {
        "latitude": unit.latitude if unit.latitude is not None else 0.0,
        "longitude": unit.longitude if unit.longitude is not None else 0.0,
    }

    base = {
        "id": orbat_id_for(unit, config),
        "name": unit.unit_identifier,
        "sidc": unit.sidc,
        "location": location,
        "owningSimulator": config.owning_simulator,
        "dis": config.dis,
        "behavior": [],
        "canControlDrones": config.can_control_drones,
        "controlledDroneIds": [],
    }
    if position_missing:
        base[POSITION_MISSING_FIELD] = True
    return base


# ---------------------------------------------------------------------------
# Organisation node
# ---------------------------------------------------------------------------


def build_organisation(
    unit: Unit,
    config: UnitSimulatorConfig,
    children: list[dict],
) -> dict:
    """
    Build a VBS4 organisation node.

    Organisations in VBS4 do not carry location/simulator fields —
    those live on the leaf vehicle/human nodes. The organisation is
    purely a structural grouping.

    Args:
        unit:     Unit ontology object
        config:   Simulator config (provides sword block)
        children: Already-built child nodes

    Returns:
        VBS4-compatible organisation dict
    """
    node: dict = {
        "$type": "organisation",
        "id": orbat_id_for(unit, config),
        "name": unit.unit_identifier,
        "sidc": unit.sidc,
        "isExpanded": True,
        # What this organisation becomes in the federation: an automat SWORD
        # spawns whole, one slice of such an automat, or plain structure.
        # Derived here because this is the last point at which the unit's
        # catalogue code is in hand — SwordConfig keeps the display name, since
        # that is what the XML needs, so the "|automat" suffix is gone by the
        # time orbat_preflight sees the node. Internal: xml_translator only
        # reads keys it knows about, so this never reaches the document.
        REPRESENTATION_FIELD: representation_of_unit(unit),
        "children": children,
    }

    if config.sword:
        node["sword"] = config.sword.to_dict()

    return node


# ---------------------------------------------------------------------------
# Vehicle node
# ---------------------------------------------------------------------------


def build_vehicle(
    unit: Unit,
    config: UnitSimulatorConfig,
    children: list[dict],
) -> dict:
    if not config.vbs4:
        raise ValueError(f"Vehicle unit {unit.primary_key} has no vbs4 config block")

    base = build_base_fields(unit, config)

    # Build role sequence from asset catalogue data
    role_sequence = ["Driver"]
    for seat in config.vbs4.all_gunner_seats:
        role_sequence.append(("Gunner", seat))
    if config.vbs4.has_commander:
        role_sequence.append(("Commander", None))
    for _ in range(config.vbs4.num_cargo_seats or 0):
        role_sequence.append(("Cargo", None))

    human_index = 0
    for child in children:
        if child.get("$type") == "human":
            # Crew with no VBS4 block (a SimWorks human with no canonical VBS4
            # asset) has no VBS4 seat to fill. Indexing child["vbs4"] used to
            # raise KeyError here and take the whole vehicle — and with it the
            # translation — down.
            if not isinstance(child.get("vbs4"), dict):
                continue
            if human_index == 0:
                child["vbs4"]["role"] = "Driver"
            elif human_index < len(role_sequence):
                entry = role_sequence[human_index]
                if isinstance(entry, tuple):
                    role, seat = entry
                    child["vbs4"]["role"] = role
                    if seat:
                        child["vbs4"]["gunnerSeat"] = seat
                else:
                    child["vbs4"]["role"] = entry
            else:
                child["vbs4"]["role"] = "Cargo"
            human_index += 1

    return {
        "$type": "vehicle",
        **base,
        "isExpanded": True,
        "isDrone": config.vbs4.is_drone,
        "vbs4": config.vbs4.to_dict(),
        "children": children,
    }


# ---------------------------------------------------------------------------
# Human node
# ---------------------------------------------------------------------------


def build_human(
    unit: Unit,
    config: UnitSimulatorConfig,
) -> dict:
    """
    Build a VBS4 human node.

    Humans are always leaf nodes — they have no children.
    Their location is inherited from their parent vehicle in VBS4
    but must still be present in the JSON.

    Args:
        unit:   Unit ontology object
        config: Simulator config providing vbs4 block

    Returns:
        VBS4-compatible human dict
    """
    if not config.vbs4:
        raise ValueError(f"Human unit {unit.primary_key} has no vbs4 config block")

    base = build_base_fields(unit, config)

    return {
        "$type": "human",
        **base,
        "vbs4": config.vbs4.to_dict(),
    }


# ---------------------------------------------------------------------------
# SimWorks vehicle node
# ---------------------------------------------------------------------------


def build_simworks_vehicle(
    unit: Unit,
    config: UnitSimulatorConfig,
    children: list[dict],
) -> dict:
    """
    Build a SimWorks vehicle node.

    Produces a ``"simworks"`` block. If the unit's SimWorks asset is linked
    to a VBS4 asset via a canonical asset (``config.canonical_vbs4``), a
    ``"vbs4"`` block is also emitted on the same node so VBS4 can receive
    position updates. ``owningSimulator`` remains ``"simworks"``.
    Args:
        unit:     Unit ontology object
        config:   Simulator config providing simworks block
        children: Already-built child nodes

    Returns:
        SimWorks-compatible vehicle dict, with optional vbs4 block
    """
    if not config.simworks:
        raise ValueError(f"Vehicle unit {unit.primary_key} has no simworks config block")

    base = build_base_fields(unit, config)

    node: dict = {
        "$type": "vehicle",
        **base,
        "isExpanded": True,
        "isDrone": False,
        "simworks": config.simworks.to_dict(),
        "children": children,
    }

    if config.canonical_vbs4:
        node["vbs4"] = config.canonical_vbs4.to_dict()

    return node


# ---------------------------------------------------------------------------
# SimWorks human node
# ---------------------------------------------------------------------------


def build_simworks_human(
    unit: Unit,
    config: UnitSimulatorConfig,
) -> dict:
    """
    Build a SimWorks human node.

    Humans are leaf nodes — no children. If the unit's SimWorks asset is
    linked to a VBS4 asset via a canonical asset (``config.canonical_vbs4``),
    a ``"vbs4"`` block is also emitted on the same node.

    Args:
        unit:   Unit ontology object
        config: Simulator config providing simworks block

    Returns:
        SimWorks-compatible human dict, with optional vbs4 block
    """
    if not config.simworks:
        raise ValueError(f"Human unit {unit.primary_key} has no simworks config block")

    base = build_base_fields(unit, config)

    node: dict = {
        "$type": "human",
        **base,
        "simworks": config.simworks.to_dict(),
    }

    if config.canonical_vbs4:
        node["vbs4"] = config.canonical_vbs4.to_dict()

    return node


# ---------------------------------------------------------------------------
# SimWorks aircraft node
# ---------------------------------------------------------------------------


def build_simworks_aircraft(
    unit: Unit,
    config: UnitSimulatorConfig,
    children: list[dict],
) -> dict:
    """
    Build a SimWorks aircraft node.

    This did not exist, and its absence was silent. build_tree branched to the
    SimWorks builder for "vehicle" and "human" but not for "aircraft", so every
    SimWorks aircraft fell through to build_aircraft, which raises because
    there is no vbs4 block — and the caller logged the ValueError and returned
    None. The aircraft simply left the ORBAT.

    Six units in OP-NORDIC-2026 were disappearing this way on every run: both
    Typhoons, both Apaches, the Wildcat and the T-650. The error read
    "Aircraft unit ... has no vbs4 config block" even on the SimWorks pass,
    which is what made it look like a data problem rather than a missing
    builder.

    Structurally identical to build_simworks_vehicle — including the optional
    VBS4 block for a canonical-asset-linked SimWorks unit, so VBS4 can receive
    position updates — but "$type": "aircraft", which is what makes the
    simulator treat it as one.
    """
    if not config.simworks:
        raise ValueError(f"Aircraft unit {unit.primary_key} has no simworks config block")

    base = build_base_fields(unit, config)

    node: dict = {
        "$type": "aircraft",
        **base,
        "isExpanded": True,
        "isDrone": False,
        "simworks": config.simworks.to_dict(),
        "children": children,
    }

    if config.canonical_vbs4:
        node["vbs4"] = config.canonical_vbs4.to_dict()

    return node


# ---------------------------------------------------------------------------
# Aircraft node
# ---------------------------------------------------------------------------


def build_aircraft(
    unit: Unit,
    config: UnitSimulatorConfig,
    children: list[dict],
) -> dict:
    """
    Build a VBS4 aircraft node.

    Structurally identical to vehicle but uses $type: 'aircraft'
    which triggers different behaviour in VBS4.

    Args:
        unit:     Unit ontology object
        config:   Simulator config providing vbs4 block
        children: Pilot/crew members as already-built nodes

    Returns:
        VBS4-compatible aircraft dict
    """
    if not config.vbs4:
        raise ValueError(f"Aircraft unit {unit.primary_key} has no vbs4 config block")

    base = build_base_fields(unit, config)

    return {
        "$type": "aircraft",
        **base,
        "isExpanded": True,
        "isDrone": config.vbs4.is_drone,
        "vbs4": config.vbs4.to_dict(),
        "children": children,
    }
