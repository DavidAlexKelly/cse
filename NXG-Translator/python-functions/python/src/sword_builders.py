"""
SWORD node builders.
"""

from __future__ import annotations
from typing import Optional

from src.ontology_store import Unit
from src.config_store import UnitSimulatorConfig
from src.builders import orbat_id_for


def build_sword_organisation(
    unit: Unit,
    config: UnitSimulatorConfig,
    children: list[dict],
) -> dict:
    """
    Build a SWORD organisation node.

    SWORD organisations carry:
    - Identity fields (id, name, sidc)
    - Location (for map placement) — read directly from NxgUnit
    - Sword control block (controllable, class)
    - Children (sub-organisations only — vehicles/humans excluded)

    Args:
        unit:     Unit ontology object
        config:   Simulator config providing sword block
        children: Already-built child organisation nodes

    Returns:
        SWORD-compatible organisation dict
    """
    # No POSITION_MISSING flag here, unlike builders.build_base_fields:
    # validate.xsd gives OrganisationType no Location, so an organisation's
    # 0,0 never reaches the document. Only units carry a position CSE uses.
    location = {
        "latitude": unit.latitude if unit.latitude is not None else 0.0,
        "longitude": unit.longitude if unit.longitude is not None else 0.0,
    }

    node: dict = {
        "$type": "organisation",
        "id": orbat_id_for(unit, config),
        "name": unit.unit_identifier,
        "sidc": unit.sidc,
        "location": location,
        "isExpanded": True,
        "children": children,
        "owningSimulator": unit.owning_simulator,
        "entityType": unit.entity_type,
        "dis": unit.dis,
        "affiliation": unit.affiliation,
        "allegiance": unit.allegiance,
        "echelon": unit.echelon,
        "militaryService": unit.military_service,
        "canControlDrones": unit.can_control_drones,
        "simulatorIdentifierCode": unit.simulator_identifier_code,
    }

    if not config.sword:
        # build_sword_tree only builds units that carry a SWORD asset; the
        # classless fallback that used to sit here could never be reached.
        raise ValueError(f"Unit {unit.primary_key} has no SWORD config block")
    node["sword"] = config.sword.to_dict()

    if unit.sword_asset is not None:
        node["swordAsset"] = unit.sword_asset.to_dict()

    return node
