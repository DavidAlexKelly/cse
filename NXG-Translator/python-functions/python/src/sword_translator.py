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
    dropped: Optional[list[dict]] = None,
    _seen: Optional[set[str]] = None,
) -> list[dict]:
    """
    Build the SWORD organisation nodes for *unit* and everything beneath it.

    A unit with a SWORD asset becomes one organisation node, with the SWORD
    nodes found beneath it as its children. A unit WITHOUT one (an aggregate
    root, a VBS4 vehicle, a unit with no config) contributes no node of its
    own, but its SWORD-bearing descendants are still built and lifted up to the
    nearest SWORD ancestor — or to the top level, where they become roots.

    This used to return None at the first node without a SWORD asset without
    looking at its children, so a SWORD force placed under a plain structural
    root (the usual shape of a phase ORBAT) vanished from a SWORD-only export.

    Args:
        unit:     The Unit to build from
        ontology: OntologyStore for link resolution
        configs:  SimulatorConfigStore for sword config lookup
        dropped:  When given, SWORD units that fail to build are appended here
                  as {"primaryKey", "name", "reason"}.

    Returns:
        Zero or more SWORD organisation dicts.
    """
    seen = _seen if _seen is not None else set()
    if unit.primary_key in seen:
        return []  # a cycle in the edges; already built higher up
    seen.add(unit.primary_key)

    children: list[dict] = []
    for child in ontology.get_children(unit.primary_key):
        children.extend(build_sword_tree(child, ontology, configs, dropped, seen))

    config = configs.get_config(unit.primary_key)
    if not config or not config.sword:
        # Not a SWORD unit: contribute nothing itself, pass its SWORD
        # descendants up.
        return children

    try:
        return [build_sword_organisation(unit, config, children)]
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        log.error(f"Failed to build SWORD node for {unit.primary_key}: {exc}")
        if dropped is not None:
            dropped.append(
                {
                    "primaryKey": unit.primary_key,
                    "name": unit.unit_identifier or "",
                    "reason": f"SWORD node could not be built: {exc}",
                }
            )
        # Keep the descendants rather than losing them with the parent.
        return children


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

    dropped: list[dict] = []
    seen: set[str] = set()
    entities: list[dict] = []
    for root in root_units:
        entities.extend(build_sword_tree(root, ontology, configs, dropped, seen))

    orbat = {
        "id": generate_scenario_id(ontology.operation.primary_key),
        "lastEdit": datetime.now(timezone.utc).isoformat(),
        "started": normalise_datetime(ontology.operation.start_time),
        "ended": normalise_datetime(ontology.operation.end_time or ontology.operation.start_time),
        "entities": entities,
        "title": ontology.operation.primary_key,
        "terrainName": configs.terrain_name,
        "targetSimulator": "sword",
        # Internal, as on translator.translate(): read by preflight only.
        "droppedUnits": dropped,
    }

    log.info("SWORD TRANSLATION COMPLETE")
    return orbat
