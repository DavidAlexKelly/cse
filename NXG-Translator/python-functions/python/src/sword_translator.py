"""
SWORD translation service.

Reads from:
  - OntologyStore  (units, edges, operation)
  - SimulatorConfigStore (sword controllable/class config)

Writes:
  - SWORD-compatible ORBAT JSON

Key difference from VBS4 translator:
  - Only organisations are included
  - Vehicles and humans are excluded
  - No vbs4 blocks
  - Sword block on every organisation
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from src.ontology_store import Unit, OntologyStore
from src.config_store import SimulatorConfigStore
from src.sword_builders import build_sword_organisation
from src.utils import generate_scenario_id, normalise_datetime

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


class SwordValidationResult:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    @property
    def is_valid(self) -> bool:
        return len(self.errors) == 0

    def error(self, msg: str) -> None:
        self.errors.append(msg)
        log.error(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)
        log.warning(msg)


def validate_sword_orbat(orbat: dict) -> SwordValidationResult:
    result = SwordValidationResult()

    if not orbat.get("entities"):
        result.error("No entities in output")
        return result

    def walk(node: dict, depth: int = 0, path: str = "root") -> None:
        node_path = f"{path} > {node.get('name', '?')}"

        if not node.get("id"):
            result.error(f"Missing id at: {node_path}")
        if not node.get("name"):
            result.error(f"Missing name at: {node_path}")
        if not node.get("sidc"):
            result.warn(f"Missing sidc at: {node_path}")

        if node.get("$type") != "organisation":
            result.error(f"Non-organisation node found in SWORD output: {node.get('$type')} at {node_path}")

        sword = node.get("sword")
        if not sword:
            result.error(f"Missing sword block at: {node_path}")
        else:
            if "controllable" not in sword:
                result.error(f"sword.controllable missing at: {node_path}")

        if "vbs4" in node:
            result.error(f"vbs4 block found in SWORD output at: {node_path}")

        for child in node.get("children", []):
            walk(child, depth + 1, node_path)

    for entity in orbat["entities"]:
        walk(entity)

    return result


# ---------------------------------------------------------------------------
# Tree builder
# ---------------------------------------------------------------------------


def build_sword_tree(
    unit: Unit,
    ontology: OntologyStore,
    configs: SimulatorConfigStore,
) -> Optional[dict]:
    """
    Recursively build a SWORD organisation tree.

    Only organisation nodes are included. Vehicles and humans are skipped.

    Args:
        unit:     The Unit to build a node for
        ontology: OntologyStore for link resolution
        configs:  SimulatorConfigStore for sword config lookup

    Returns:
        SWORD-compatible organisation dict, or None if not an organisation
    """
    config = configs.get_config(unit.primary_key)
    if not config:
        log.warning(f"No simulator config for unit: {unit.primary_key} ({unit.unit_identifier}) — skipping")
        return None

    if not config.sword:
        return None

    child_units = ontology.get_children(unit.primary_key)
    children = [node for child in child_units if (node := build_sword_tree(child, ontology, configs)) is not None]

    try:
        return build_sword_organisation(unit, config, children)
    except Exception as exc:
        log.error(f"Failed to build SWORD node for {unit.primary_key}: {exc}")
        return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def translate_sword(
    ontology: OntologyStore,
    configs: SimulatorConfigStore,
) -> dict:
    """
    Translate ontology objects into a SWORD-compatible ORBAT.

    Args:
        ontology: Populated OntologyStore
        configs:  Populated SimulatorConfigStore

    Returns:
        SWORD-compatible ORBAT dict ready for JSON serialisation
    """
    log.info("=" * 60)
    log.info("SWORD TRANSLATION STARTED")
    log.info("=" * 60)
    log.info(f"Operation  : {ontology.operation.primary_key}")
    log.info(f"Terrain    : {configs.terrain_name}")
    log.info(f"Units      : {ontology.unit_count()}")

    root_units = ontology.get_root_units()
    log.info(f"Root units : {len(root_units)} ({', '.join(u.primary_key for u in root_units)})")

    entities = [node for root in root_units if (node := build_sword_tree(root, ontology, configs)) is not None]

    orbat = {
        "id": generate_scenario_id(ontology.operation.primary_key),
        "lastEdit": datetime.now(timezone.utc).isoformat(),
        "started": normalise_datetime(ontology.operation.start_time),
        "ended": normalise_datetime(ontology.operation.end_time or ontology.operation.start_time),
        "entities": entities,
        "title": ontology.operation.primary_key,
        "terrainName": configs.terrain_name,
        "targetSimulator": "sword",
    }

    log.info("SWORD TRANSLATION COMPLETE")
    return orbat
