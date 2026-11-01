"""
Main translation service.

Reads from:
  - OntologyStore  (units, edges, operation)
  - SimulatorConfigStore (simulator representation — VBS4 classNames, roles, etc.)

Writes:
  - VBS4-compatible ORBAT JSON
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from src.ontology_store import Unit, OntologyStore
from src.config_store import SimulatorConfigStore, UnitSimulatorConfig
from src.builders import (
    build_organisation,
    build_vehicle,
    build_human,
    build_aircraft,
    build_simworks_vehicle,
    build_simworks_human,
    build_simworks_aircraft,
)
from src.utils import generate_scenario_id, reset_ids, normalise_datetime

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


class ValidationResult:
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


def validate_orbat(orbat: dict) -> ValidationResult:
    result = ValidationResult()

    if not orbat.get("entities"):
        result.error("No entities in output")
        return result

    def walk(node: dict, depth: int = 0, path: str = "root") -> None:
        node_path = f"{path} > {node.get('name', '?')}"

        if not node.get("id"):
            result.error(f"Missing id at: {node_path}")
        if not node.get("name"):
            result.error(f"Missing name at depth {depth}: {node_path}")
        if not node.get("sidc"):
            result.warn(f"Missing sidc at: {node_path}")

        entity_type = node.get("$type")
        if not entity_type:
            result.error(f"Missing $type at: {node_path}")

        if entity_type in ("vehicle", "aircraft"):
            if node.get("simworks"):
                if not node["simworks"].get("className"):
                    result.error(f"simworks block missing className on {entity_type}: {node_path}")
            elif not node.get("vbs4"):
                result.error(f"Missing vbs4/simworks block on {entity_type}: {node_path}")
            elif not node["vbs4"].get("className"):
                result.error(f"vbs4 block missing className: {node_path}")

        if entity_type == "human":
            if node.get("simworks"):
                if not node["simworks"].get("className"):
                    result.error(f"simworks block missing className on human: {node_path}")
            elif not node.get("vbs4"):
                result.error(f"Missing vbs4/simworks block on human: {node_path}")
            elif not node["vbs4"].get("role"):
                result.error(f"vbs4 block missing role on human: {node_path}")

        for child in node.get("children", []):
            walk(child, depth + 1, node_path)

    for entity in orbat["entities"]:
        walk(entity)

    return result


# ---------------------------------------------------------------------------
# Tree builder
# ---------------------------------------------------------------------------


def build_tree(
    unit: Unit,
    ontology: OntologyStore,
    configs: SimulatorConfigStore,
) -> Optional[dict]:
    """
    Recursively resolve the ontology graph into a nested VBS4 node tree.

    Args:
        unit:     The Unit to build a node for
        ontology: OntologyStore for link resolution
        configs:  SimulatorConfigStore for VBS4 config lookup

    Returns:
        VBS4-compatible node dict, or None if config is missing
    """
    # Every node that fails to build is recorded, not just logged — see
    # _DROPPED and the note on translate().
    config = configs.get_config(unit.primary_key)
    if not config:
        _record_dropped(unit, "no simulator config")
        return None

    child_units = ontology.get_children(unit.primary_key)
    children = [node for child in child_units if (node := build_tree(child, ontology, configs)) is not None]

    try:
        match config.entity_type:
            case "organisation":
                return build_organisation(unit, config, children)
            case "vehicle":
                if config.simworks:
                    return build_simworks_vehicle(unit, config, children)
                return build_vehicle(unit, config, children)
            case "human":
                if config.simworks:
                    return build_simworks_human(unit, config)
                return build_human(unit, config)
            case "aircraft":
                # The SimWorks branch was missing here, and only here. Every
                # SimWorks aircraft fell through to build_aircraft, which
                # raises without a vbs4 block, and the handler below turned
                # that into a log line — so the aircraft left the ORBAT and
                # nothing downstream could tell.
                if config.simworks:
                    return build_simworks_aircraft(unit, config, children)
                return build_aircraft(unit, config, children)
            case _:
                _record_dropped(
                    unit,
                    f"entityType '{config.entity_type}' is not one the translator builds",
                )
                return None

    except ValueError as exc:
        _record_dropped(unit, str(exc))
        return None


# ---------------------------------------------------------------------------
# Units that did not make it into the ORBAT
# ---------------------------------------------------------------------------
#
# A unit that fails to build is the worst kind of problem this pipeline has:
# the ORBAT is still well-formed, still passes the schema, still passes
# preflight — and quietly contains less force than the planner asked for.
# Preflight inspects the BUILT tree, so a node that never got built is exactly
# the thing it cannot see.
#
# Six aircraft were leaving OP-NORDIC-2026 this way on every run and the only
# trace was a log line. So the drops are collected and handed back on the
# ORBAT, where preflight can report them like any other finding.
#
# Module-level because build_tree recurses and threading an accumulator
# through it would touch every call site; translate() resets it at the start
# of each run, which is also what makes repeated runs independent.

_DROPPED: list[dict] = []


def _record_dropped(unit, reason: str) -> None:
    """Note a unit that will not appear in the ORBAT, and why."""
    log.error(
        f"Dropped {unit.primary_key} ({unit.unit_identifier}) from the ORBAT: {reason}"
    )
    _DROPPED.append(
        {
            "primaryKey": unit.primary_key,
            "name": unit.unit_identifier or "",
            "reason": reason,
        }
    )


def dropped_units() -> list[dict]:
    """Units the last translate() could not build. Copy, so callers cannot clear it."""
    return list(_DROPPED)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def translate(
    ontology: OntologyStore,
    configs: SimulatorConfigStore,
) -> dict:
    """
    Translate ontology objects + simulator configs into a VBS4 ORBAT.

    Args:
        ontology: Populated OntologyStore
        configs:  Populated SimulatorConfigStore

    Returns:
        VBS4-compatible ORBAT dict ready for JSON serialisation
    """
    _DROPPED.clear()

    log.info("=" * 60)
    log.info("TRANSLATION STARTED")
    log.info("=" * 60)
    log.info(f"Operation  : {ontology.operation.primary_key}")
    log.info(f"Simulator  : {configs.target_simulator}")
    log.info(f"Terrain    : {configs.terrain_name}")
    log.info(f"Units      : {ontology.unit_count()}")
    log.info(f"Edges      : {ontology.edge_count()}")
    log.info(f"Configs    : {configs.config_count()}")

    root_units = ontology.get_root_units()
    log.info(f"Root units : {len(root_units)} ({', '.join(u.primary_key for u in root_units)})")

    entities = [node for root in root_units if (node := build_tree(root, ontology, configs)) is not None]

    orbat = {
        "id": generate_scenario_id(ontology.operation.primary_key),
        "lastEdit": datetime.now(timezone.utc).isoformat(),
        "started": normalise_datetime(ontology.operation.start_time),
        "ended": normalise_datetime(ontology.operation.end_time or ontology.operation.start_time),
        "entities": entities,
        "title": ontology.operation.primary_key,
        "terrainName": configs.terrain_name,
        # Internal, like "representation": the XML serialiser reads only the
        # keys it knows about, so this never reaches the document. It exists
        # so preflight can report what is MISSING from the tree, which it
        # cannot otherwise see.
        "droppedUnits": dropped_units(),
    }

    if _DROPPED:
        log.error(
            f"{len(_DROPPED)} unit(s) did not make it into the ORBAT: "
            f"{', '.join(d['primaryKey'] for d in _DROPPED)}"
        )

    log.info("TRANSLATION COMPLETE")
    return orbat
