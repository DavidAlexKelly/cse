# functions/translate_functions.py

from functions.api import function, String, OntologyEdit
from ontology_sdk import FoundryClient
from ontology_sdk.ontology.objects import (
    NxgUnit,
    NxgUnitHierachyEdge,
    NxgOperation,
    NxgUnitHierarchy,
    NxgVbs4AssetCatalogue,
    NxgOSwordAssetCatalogue,
    NxgSimworksAssetCatalogue,
)
from src.ontology_store import OntologyStore
from src.config_store import SimulatorConfigStore
from src.translator import translate, reset_dropped, dropped_units
from src.sword_translator import translate_sword
from src.xml_translator import orbat_to_xml
from src.utils import stable_edge_key
from src.simulator_targets import normalise_owning_simulator
from src.hierarchy_merge import units_in_multiple_hierarchies
from src.payload_codec import decode_gzip_base64

import json
import logging
from datetime import date
from typing import Optional

log = logging.getLogger(__name__)

# Command relationship for a parent → child ORBAT edge. FK into
# NxgUnitHierarchyNodeRelationshipType; ORGANIC is permanent subordination,
# which is what a unit's own ORBAT is.
ORGANIC_RELATIONSHIP_KEY = "RELTYPE-ORGANIC"


# ---------------------------------------------------------------------------
# Shared data loader
# ---------------------------------------------------------------------------


def _phase_prefixed_units(client, phase_key: str) -> list:
    """
    Every NxgUnit whose primary key starts with f"{phase_key}--".

    Uses the OSDK's server-side starts-with filter on the primary key. That
    filter could not be exercised outside Foundry, so it is looked up
    defensively and any failure (method missing, property not searchable,
    query error) is logged and treated as "no prefix units": the export then
    falls back to the edge-only behaviour it had before, rather than failing.
    The results are re-checked here because some string filters match on
    tokens rather than a literal prefix.
    """
    prefix = f"{phase_key}--"
    try:
        pk_property = NxgUnit.object_type.primary_key_
        starts_with = getattr(pk_property, "starts_with", None) or getattr(pk_property, "prefix", None)
        if starts_with is None:
            raise AttributeError("primary key property has no starts_with/prefix filter")
        found = list(client.ontology.objects.NxgUnit.where(starts_with(prefix)).iterate())
    except Exception as exc:  # noqa: BLE001 — degrade to edges only, never fail the export
        log.warning(
            "Could not search NxgUnit by key prefix %r (%s); units are found through edges only.",
            prefix,
            exc,
        )
        return []
    return [u for u in found if (u.primary_key_ or "").startswith(prefix)]


def _load_stores(
    operation_key: str,
    target_simulator: str,
    phase_key: Optional[str] = None,
    client=None,
) -> tuple[OntologyStore, SimulatorConfigStore, dict[str, dict]]:
    """
    Load all ontology data for a given operation and build the OntologyStore
    and SimulatorConfigStore.

    Args:
        operation_key:    the NxgOperation to load.
        target_simulator: which simulator's assets to resolve.
        phase_key:        when given, only hierarchies whose phaseKey matches
                          are loaded. Each phase holds a FULL STANDING FORCE,
                          so this is a filter and not a difference against some
                          other phase.

                          When omitted, EVERY hierarchy for the operation is
                          loaded, phase-tagged or not. That is the historical
                          behaviour and it is what makes an untagged operation
                          such as OP-NORDIC-2026 keep working, but it is the
                          wrong thing to ask for once an operation has more
                          than one phase: the phases would be merged into a
                          single ORBAT containing every force from every phase.

                          With a phase_key, units are found two ways and
                          merged: through the selected hierarchies' edges, and
                          as every NxgUnit whose primary key starts with
                          f"{phase_key}--" — the convention the planner uses
                          for a phase's units (phaseKeys.ts), and the only way
                          to find a unit placed on its own with no edge yet.
                          Such a lone unit becomes a root of the export.

                          A phase_key that matches no hierarchy of the
                          operation is an error (ValueError naming both), not
                          an empty export.
        client:           FoundryClient to use; created when omitted. Tests
                          pass a fake here.

    Returns:
        (OntologyStore, SimulatorConfigStore, vbs4_by_dis)
    """
    client = client if client is not None else FoundryClient()

    operation = client.ontology.objects.NxgOperation.get(operation_key)
    if operation is None:
        raise ValueError(f"NxgOperation not found for key: {operation_key}")

    # EVERY hierarchy for the operation, not the first one.
    #
    # This used to be next(iter(...), None), which kept one hierarchy and
    # silently dropped the rest, with no ordering — so which one survived was
    # arbitrary. An operation is not limited to one ORBAT: OP-NEXGEN-2026
    # already carries a FRIENDLY hierarchy, an ENEMY hierarchy, and an empty
    # third, and whichever the query happened to yield first became the whole
    # export. If that was the empty one, the operation translated to an ORBAT
    # with no units and nothing failed.
    #
    # Loading them all is also what makes a combined friendly/enemy document
    # possible. OntologyStore is hierarchy-blind — its edge records carry no
    # hierarchy key — so concatenated edges simply produce one root per force,
    # and validate.xsd allows <Entities> to hold unbounded root Organisations.
    hierarchies = list(
        client.ontology.objects.NxgUnitHierarchy.where(
            NxgUnitHierarchy.object_type.operation_key == operation_key
        ).iterate()
    )
    if not hierarchies:
        raise ValueError(f"NxgUnitHierarchy not found for operation: {operation_key}")

    # Narrow to one phase when asked. Filtered here rather than in the query so
    # that "the operation has hierarchies, but none for this phase" can be told
    # apart from "the operation has no hierarchies at all" — the two need very
    # different messages, and the second is a much worse problem.
    if phase_key is not None:
        for_phase = [h for h in hierarchies if h.phase_key == phase_key]
        if not for_phase:
            tagged = sorted({h.phase_key for h in hierarchies if h.phase_key})
            raise ValueError(
                f"No NxgUnitHierarchy for phase {phase_key!r} on operation "
                f"{operation_key!r}. The operation has "
                f"{len(hierarchies)} hierarch"
                f"{'y' if len(hierarchies) == 1 else 'ies'}, "
                + (
                    f"tagged with phase(s): {', '.join(tagged)}."
                    if tagged
                    else "none of which carry a phaseKey."
                )
            )
        log.info(
            "Phase %s: %d of %d hierarch%s selected",
            phase_key,
            len(for_phase),
            len(hierarchies),
            "y" if len(hierarchies) == 1 else "ies",
        )
        hierarchies = for_phase

    edges = []
    empty_hierarchies: list[str] = []
    children_by_hierarchy: dict[str, set[str]] = {}
    for hierarchy in hierarchies:
        hierarchy_edges = list(
            client.ontology.objects.NxgUnitHierachyEdge.where(
                NxgUnitHierachyEdge.object_type.hierarchy_key == hierarchy.primary_key_
            ).iterate()
        )
        log.info(
            "Hierarchy %s (%s): %d edge(s)",
            hierarchy.primary_key_,
            hierarchy.name or "unnamed",
            len(hierarchy_edges),
        )
        if not hierarchy_edges:
            empty_hierarchies.append(hierarchy.primary_key_ or "?")
        children_by_hierarchy[hierarchy.primary_key_ or "?"] = {
            e.child_unit_key for e in hierarchy_edges if e.child_unit_key
        }
        edges.extend(hierarchy_edges)

    # A unit parented in two of the hierarchies being merged is double-counted.
    #
    # Concatenating edges is the whole point of loading them all, but it assumes
    # the hierarchies describe disjoint forces. When they don't, the shared unit
    # ends up with two parents, appears under both, and is built twice — a
    # document that validates cleanly while containing more force than anyone
    # asked for. Exactly the failure mode that is hardest to notice.
    #
    # This is not hypothetical: HIER-BALTIC-SHIELD-OPS shares all 117 of its
    # child units with OP-NORDIC-2026-HIERARCHY. Those sit on different
    # operations so they are never merged, but it shows the data can look like
    # this.
    for unit_key, owners in units_in_multiple_hierarchies(children_by_hierarchy).items():
        log.error(
            "Unit %s is parented in %d hierarchies being merged (%s) and will be "
            "built once per parent. Give it a single parent, or split the "
            "hierarchies across phases so they are not exported together.",
            unit_key,
            len(owners),
            ", ".join(owners),
        )

    log.info(
        "Loaded %d hierarch%s for %s, %d edge(s) total",
        len(hierarchies),
        "y" if len(hierarchies) == 1 else "ies",
        operation_key,
        len(edges),
    )
    if empty_hierarchies:
        # Not fatal — a hierarchy can legitimately be a placeholder — but it is
        # the shape of the bug above, so say so rather than leave it silent.
        log.warning(
            "Hierarch%s contributed no edges to %s: %s",
            "y" if len(empty_hierarchies) == 1 else "ies",
            operation_key,
            ", ".join(empty_hierarchies),
        )

    unit_keys: set[str] = set()
    for edge in edges:
        if edge.child_unit_key:
            unit_keys.add(edge.child_unit_key)
        if edge.parent_unit_key:
            unit_keys.add(edge.parent_unit_key)

    units = (
        list(client.ontology.objects.NxgUnit.where(NxgUnit.object_type.primary_key_.in_(list(unit_keys))).iterate())
        if unit_keys
        else []
    )

    # Units placed in the phase but not (yet) in any edge — see phase_key above.
    if phase_key is not None:
        known = {u.primary_key_ for u in units}
        lone = [u for u in _phase_prefixed_units(client, phase_key) if u.primary_key_ not in known]
        if lone:
            log.info(
                "Phase %s: %d unit(s) found by key prefix with no edge; exported as roots: %s",
                phase_key,
                len(lone),
                ", ".join(sorted(u.primary_key_ or "?" for u in lone)),
            )
        units.extend(lone)

    if not edges and not units:
        raise ValueError(
            f"No unit hierarchy edges found for operation {operation_key}"
            + (f" and no units keyed under phase {phase_key!r}" if phase_key is not None else "")
            + ". "
            f"Searched {len(hierarchies)} hierarch"
            f"{'y' if len(hierarchies) == 1 else 'ies'}: "
            f"{', '.join(h.primary_key_ or '?' for h in hierarchies)}. "
            "An ORBAT with no units would translate to an empty document."
        )

    simulator_identifier_codes = list({u.simulator_identifier_code for u in units if u.simulator_identifier_code})

    # VBS4 assets — keyed by simulatorIdentifierCode (the VBS4 class name)
    assets: dict[str, NxgVbs4AssetCatalogue] = {}
    if simulator_identifier_codes:
        for asset in client.ontology.objects.NxgVbs4AssetCatalogue.where(
            NxgVbs4AssetCatalogue.object_type.identifier.in_(simulator_identifier_codes)
        ).iterate():
            if asset.identifier:
                assets[asset.identifier] = asset

    # SWORD assets — bulk query by simulatorIdentifierCode (same pattern as VBS4).
    sword_assets: dict[str, NxgOSwordAssetCatalogue] = {}
    if simulator_identifier_codes:
        for asset in client.ontology.objects.NxgOSwordAssetCatalogue.where(
            NxgOSwordAssetCatalogue.object_type.identifier.in_(simulator_identifier_codes)
        ).iterate():
            if asset.identifier:
                sword_assets[asset.identifier] = asset

    # Map sword assets by unit primary key for OntologyStore.from_osdk
    sword_assets_by_unit: dict[str, NxgOSwordAssetCatalogue] = {
        u.primary_key_ or "": sword_assets[u.simulator_identifier_code]
        for u in units
        if u.simulator_identifier_code and u.simulator_identifier_code in sword_assets
    }

    # SimWorks assets — keyed by simulatorIdentifierCode (the SimWorks class name)
    simworks_assets: dict[str, NxgSimworksAssetCatalogue] = {}
    if simulator_identifier_codes:
        for asset in client.ontology.objects.NxgSimworksAssetCatalogue.where(
            NxgSimworksAssetCatalogue.object_type.identifier.in_(simulator_identifier_codes)
        ).iterate():
            if asset.identifier:
                simworks_assets[asset.identifier] = asset

    # Map simworks assets by unit primary key for OntologyStore.from_osdk
    simworks_assets_by_unit: dict[str, NxgSimworksAssetCatalogue] = {
        u.primary_key_ or "": simworks_assets[u.simulator_identifier_code]
        for u in units
        if u.simulator_identifier_code and u.simulator_identifier_code in simworks_assets
    }

    # Resolve canonical VBS4 assets for SimWorks units.
    # Traversal: NxgSimworksAssetCatalogue
    #               → NxgCanonicalAsset       (link apiName: nxgCanonicalAsset)
    #               → NxgVbs4AssetCatalogue   (link apiName: nxgVbs4assetCatalogues)
    # The first available VBS4 asset is used. The canonical VBS4 config is
    # emitted inline on the SimWorks node via config.canonical_vbs4 in
    # build_simworks_vehicle.
    canonical_vbs4_assets_by_unit: dict[str, NxgVbs4AssetCatalogue] = {}
    for u in units:
        unit_pk = u.primary_key_ or ""
        if unit_pk not in simworks_assets_by_unit:
            continue
        sw_asset = simworks_assets_by_unit[unit_pk]
        try:
            canonical = sw_asset.nxg_canonical_asset()
            if canonical is None:
                continue
            vbs4_linked = list(canonical.nxg_vbs4asset_catalogues().iterate())
            if vbs4_linked:
                canonical_vbs4_assets_by_unit[unit_pk] = vbs4_linked[0]
                log.info(f"Canonical VBS4 resolved for unit {unit_pk}: {getattr(vbs4_linked[0], 'identifier', '?')!r}")
        except Exception as exc:
            log.warning(f"Canonical VBS4 lookup failed for unit {unit_pk}: {exc}")

    ontology = OntologyStore.from_osdk(
        operation=operation,
        units=units,
        edges=edges,
        assets=assets,
        sword_assets_by_unit=sword_assets_by_unit,
        simworks_assets_by_unit=simworks_assets_by_unit,
        canonical_vbs4_assets_by_unit=canonical_vbs4_assets_by_unit,
    )

    config_store = SimulatorConfigStore(
        units=list(ontology._units.values()),
        target_simulator=target_simulator,
        terrain_name=operation.terrain_name or "",
    )

    # Build a DIS-code → VBS4 asset dict index for SWORD → VBS4 asset injection.
    # Only needed when there are SWORD units. We filter by the DIS codes
    # present on the loaded units rather than scanning the entire catalogue.
    vbs4_by_dis: dict[str, dict] = {}
    has_sword_units = any(u.sword_asset is not None for u in ontology._units.values())
    if has_sword_units:
        unit_dis_codes = list({u.dis for u in ontology._units.values() if u.dis and u.dis != "0.0.0.0.0.0.0"})
        if unit_dis_codes:
            for asset in client.ontology.objects.NxgVbs4AssetCatalogue.where(
                NxgVbs4AssetCatalogue.object_type.dis6_code.in_(unit_dis_codes)
            ).iterate():
                dis = asset.dis6_code or asset.dis_code
                if dis and asset.identifier:
                    vbs4_by_dis.setdefault(
                        dis,
                        {
                            "identifier": asset.identifier,
                            "isDrone": bool(asset.is_drone),
                            "hasCommander": bool(asset.has_commander),
                            "numCargoSeats": int(asset.num_cargo_seats or 0),
                            "gunnerSeatNames": asset.gunner_seat_names,
                            "gunnerSeatTurretIds": asset.gunner_seat_turret_ids,
                        },
                    )
        # Also include already-loaded VBS4 assets (from the identifier query)
        # so we don't miss assets that matched by identifier but not by DIS query.
        for asset in assets.values():
            dis = asset.dis6_code or asset.dis_code
            if dis and asset.identifier and dis not in vbs4_by_dis:
                vbs4_by_dis[dis] = {
                    "identifier": asset.identifier,
                    "isDrone": bool(asset.is_drone),
                    "hasCommander": bool(asset.has_commander),
                    "numCargoSeats": int(asset.num_cargo_seats or 0),
                    "gunnerSeatNames": asset.gunner_seat_names,
                    "gunnerSeatTurretIds": asset.gunner_seat_turret_ids,
                }

    return ontology, config_store, vbs4_by_dis


# ---------------------------------------------------------------------------
# Unified translation core
# ---------------------------------------------------------------------------


def _detect_simulators(ontology: OntologyStore) -> set[str]:
    """
    Detect which simulators are needed based on owningSimulator values
    in the ontology units.
    """
    simulators = set()
    for unit in ontology._units.values():
        sim = (getattr(unit, "owning_simulator", None) or "").lower()
        if sim == "vbs4":
            simulators.add("vbs4")
        elif sim == "simworks":
            simulators.add("simworks")
        # Sword runs if any unit has a sword asset
        if unit.sword_asset is not None:
            simulators.add("sword")
    return simulators


def _translate_all(
    ontology: OntologyStore,
    configs: SimulatorConfigStore,
    vbs4_by_dis: Optional[dict[str, dict]] = None,
) -> dict:
    """
    Run all required translators and merge into a single unified ORBAT dict.

    The unified output contains:
      - entities: merged tree with both vbs4 and sword blocks
      - metadata from the operation
      - simulators: list of detected simulators
      - droppedUnits: every unit that could not be built, with the reason —
        internal, read by orbat_preflight (UNIT_DROPPED); the XML serialiser
        ignores it. Accumulated across all passes of this one translation.
    """
    simulators = _detect_simulators(ontology)

    # One translation, several passes: the drop list is reset here, once, and
    # each pass adds to it rather than clearing what the previous pass found.
    reset_dropped()

    # VBS4 translation — produces the full entity tree with vbs4 blocks
    vbs4_orbat = translate(ontology, configs, reset_dropped=False) if "vbs4" in simulators else None

    # SimWorks translation — produces an entity tree with simworks blocks.
    # Runs through the same build_tree pipeline as VBS4; the simworks routing
    # in build_tree emits simworks blocks for units whose owningSimulator is "simworks".
    simworks_orbat = None
    if "simworks" in simulators:
        simworks_configs = SimulatorConfigStore(
            units=list(ontology._units.values()),
            target_simulator="simworks",
            terrain_name=configs.terrain_name,
        )
        simworks_orbat = translate(ontology, simworks_configs, reset_dropped=False)

    # Sword translation — produces org-only tree with sword blocks
    sword_orbat = None
    if "sword" in simulators:
        sword_configs = SimulatorConfigStore(
            units=list(ontology._units.values()),
            target_simulator="sword",
            terrain_name=configs.terrain_name,
        )
        sword_orbat = translate_sword(ontology, sword_configs)

    # Determine the primary entity tree (VBS4 takes precedence over SimWorks)
    primary_orbat = vbs4_orbat or simworks_orbat

    # Merge simworks blocks from simworks tree onto the VBS4 tree when both exist
    if vbs4_orbat and simworks_orbat:
        simworks_index = _index_by_id(simworks_orbat.get("entities", []))
        _merge_simworks_blocks(vbs4_orbat.get("entities", []), simworks_index)

    # Merge sword blocks onto the primary tree
    if primary_orbat and sword_orbat:
        sword_index = _index_by_id(sword_orbat.get("entities", []))
        _merge_sword_blocks(primary_orbat.get("entities", []), sword_index)
        merged_entities = primary_orbat["entities"]
    elif primary_orbat:
        merged_entities = primary_orbat["entities"]
    elif sword_orbat:
        merged_entities = sword_orbat["entities"]
    else:
        merged_entities = []

    # Attach VBS4 blocks to SWORD-section vehicles that have none, where a DIS
    # match exists (never adds a node — see _inject_sword_vbs4_assets).
    if vbs4_by_dis:
        _inject_sword_vbs4_assets(merged_entities, vbs4_by_dis)

    dropped = dropped_units()
    if sword_orbat and not primary_orbat:
        # SWORD-only export: the SWORD tree IS the document, so a SWORD node
        # that failed to build is missing force. (When a VBS4/SimWorks tree is
        # primary, a SWORD failure only loses a sword block, which preflight
        # already reports on the node itself.)
        known = {d["primaryKey"] for d in dropped}
        dropped.extend(d for d in sword_orbat.get("droppedUnits", []) if d["primaryKey"] not in known)

    meta_source = primary_orbat or sword_orbat or {}
    return {
        "id": meta_source.get("id", ""),
        "lastEdit": meta_source.get("lastEdit", ""),
        "started": meta_source.get("started", ""),
        "ended": meta_source.get("ended", ""),
        "title": meta_source.get("title", ""),
        "terrainName": configs.terrain_name,
        "simulators": list(simulators),
        "entities": merged_entities,
        "droppedUnits": dropped,
    }


def _index_by_id(entities: list[dict]) -> dict[str, dict]:
    """Build a flat id → node index from a nested entity tree."""
    index = {}

    def walk(node: dict) -> None:
        node_id = str(node.get("id", ""))
        if node_id:
            index[node_id] = node
        for child in node.get("children", []):
            walk(child)

    for entity in entities:
        walk(entity)
    return index


def _merge_sword_blocks(entities: list[dict], sword_index: dict[str, dict]) -> None:
    """
    Walk the primary entity tree and copy the ``sword`` block from matching
    nodes in *sword_index* onto the primary tree.
    """

    def walk(node: dict) -> None:
        node_id = str(node.get("id", ""))
        sword_node = sword_index.get(node_id)
        if sword_node and "sword" in sword_node:
            node["sword"] = sword_node["sword"]
        for child in node.get("children", []):
            walk(child)

    for entity in entities:
        walk(entity)


def _merge_simworks_blocks(entities: list[dict], simworks_index: dict[str, dict]) -> None:
    """
    Walk the primary entity tree and copy the ``simworks`` block from matching
    nodes in *simworks_index* onto the primary tree.
    """

    def walk(node: dict) -> None:
        node_id = str(node.get("id", ""))
        sw_node = simworks_index.get(node_id)
        if sw_node and "simworks" in sw_node:
            node["simworks"] = sw_node["simworks"]
        for child in node.get("children", []):
            walk(child)

    for entity in entities:
        walk(entity)


# ---------------------------------------------------------------------------
# SWORD → VBS4 asset injection
# ---------------------------------------------------------------------------


def _vbs4_block_from_asset(vbs4_asset: dict) -> dict:
    """
    The vbs4 block for a vehicle, from a VBS4 asset dict keyed by DIS
    (identifier, gunner seats, …). Same shape as VBS4Config.to_dict().
    """
    all_gunner_seats: list[dict] = []
    seat_names = vbs4_asset.get("gunnerSeatNames") or ""
    seat_turrets = vbs4_asset.get("gunnerSeatTurretIds") or ""
    if seat_names and seat_turrets:
        for name, turret in zip(seat_names.split("|"), seat_turrets.split("|")):
            all_gunner_seats.append({"turretIdentifier": turret, "name": name})

    primary_gunner_seat = all_gunner_seats[0] if all_gunner_seats else {"turretIdentifier": "", "name": "None"}

    return {
        "className": vbs4_asset["identifier"],
        "role": "None",
        "gunnerSeat": primary_gunner_seat,
        "sensorStreamingSettings": {
            "enabled": False,
            "host": "127.0.0.1",
            "port": 0,
        },
        "streamingSettings": {
            "host": "",
            "port": 0,
            "framerate": 0,
            "bitrate": 0,
            "width": 0,
            "height": 0,
            "fieldOfView": 0,
        },
    }


def _inject_sword_vbs4_assets(
    entities: list[dict],
    vbs4_by_dis: dict[str, dict],
) -> int:
    """
    Give VBS4 a model for vehicles in SWORD sections that have none — on the
    SAME vehicle, never as a second one.

    For every organisation with a sword block, each vehicle/aircraft child that
    carries NO unit extension at all (neither vbs4 nor simworks) and whose DIS
    code matches a known VBS4 asset gets that asset's vbs4 block attached.

    What this deliberately does not do any more:

      - Add a node. It used to append a second vehicle beside the first, with
        a new id, so the same platform was fielded twice — and preflight's
        DOUBLE_COUNTED / force counts were checking a document the translator
        itself had inflated. The tree now has exactly the nodes the ontology
        has.
      - Touch a vehicle that already has a simworks block. The schema allows
        one UnitExtension per unit and xml_translator keeps the owning
        simulator's, so a second block would be dropped at export and only
        surface as EXTRA_SIMULATOR_BLOCK.

    owningSimulator is left as the ontology has it; preflight reports it if it
    does not name a simulator, rather than this function choosing one.

    Args:
        entities:    Top-level entity list (mutated in place)
        vbs4_by_dis: DIS code → VBS4 asset dict

    Returns:
        Number of vehicles given a vbs4 block.
    """
    attached = 0

    def walk(node: dict) -> None:
        nonlocal attached
        if node.get("$type") == "organisation" and node.get("sword"):
            for child in node.get("children", []):
                if child.get("$type") not in ("vehicle", "aircraft"):
                    continue
                if child.get("vbs4") or child.get("simworks"):
                    continue
                match = vbs4_by_dis.get(child.get("dis", ""))
                if match:
                    child["vbs4"] = _vbs4_block_from_asset(match)
                    child["isDrone"] = bool(match.get("isDrone", child.get("isDrone", False)))
                    attached += 1
                    log.info(
                        "Attached VBS4 class %s to %s (DIS %s) in SWORD section %s",
                        match["identifier"],
                        child.get("name"),
                        child.get("dis"),
                        node.get("name"),
                    )

        for child in node.get("children", []):
            walk(child)

    for entity in entities:
        walk(entity)
    return attached


# ---------------------------------------------------------------------------
# JSON-input translation
# ---------------------------------------------------------------------------


def _vbs4_by_dis_from_json(ontology_data: dict) -> dict[str, dict]:
    """DIS → VBS4 asset index built from the VBS4 assets embedded in ontology JSON."""
    vbs4_by_dis: dict[str, dict] = {}
    for unit in ontology_data.get("units", []):
        asset = unit.get("vbs4Asset") or unit.get("vbs4")
        if asset:
            dis = asset.get("dis6Code") or unit.get("dis")
            identifier = asset.get("identifier") or asset.get("simulatorIdentifierCode")
            if dis and identifier:
                vbs4_by_dis.setdefault(
                    dis,
                    {
                        "identifier": identifier,
                        "isDrone": asset.get("isDrone", False),
                        "hasCommander": asset.get("hasCommander", False),
                        "numCargoSeats": asset.get("numCargoSeats", 0),
                        "gunnerSeatNames": asset.get("gunnerSeatNames"),
                        "gunnerSeatTurretIds": asset.get("gunnerSeatTurretIds"),
                    },
                )
    return vbs4_by_dis


def _translate_ontology_json(ontology_json: str) -> dict:
    """
    The unified ORBAT for an OntologyStore-compatible JSON string. Shared by
    translate_orbat_from_json and translate_orbat_to_xml_from_json so the two
    differ only in serialisation.
    """
    ontology_data = json.loads(ontology_json)
    ontology = OntologyStore(ontology_data)
    configs = SimulatorConfigStore(
        units=list(ontology._units.values()),
        target_simulator="vbs4",
        terrain_name=ontology.operation.terrain_name or "",
    )
    return _translate_all(ontology, configs, vbs4_by_dis=_vbs4_by_dis_from_json(ontology_data))


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------


def _parse_date(value: Optional[str]) -> Optional[date]:
    """
    Convert an ISO-8601 string (date or datetime) to a Python date object,
    which is what Foundry's Date property type requires.
    Returns None if value is None or unparseable.
    """
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Unified public functions
# ---------------------------------------------------------------------------


@function
def translate_orbat_from_operation(operation_key: String) -> String:
    """
    Generate a unified ORBAT JSON for a given NxgOperation.

    Automatically detects which simulators are required from the unit data
    (VBS4, Sword, SimWorks) and runs all relevant translators, merging the
    output into a single ORBAT JSON containing both vbs4 and sword blocks.

    Where a vehicle in a SWORD section has no VBS4 or SimWorks block but its
    DIS code matches a known VBS4 asset, that asset's VBS4 block is attached
    to the same vehicle. No second vehicle is ever added (see
    _inject_sword_vbs4_assets).

    For SimWorks units linked to a VBS4 asset via a canonical asset, the VBS4
    block is emitted inline on the same node (handled by build_simworks_vehicle
    via config.canonical_vbs4).

    Args:
        operation_key: e.g. "OP-NORDIC-2026"

    Returns:
        Unified ORBAT as JSON string
    """
    ontology, configs, vbs4_by_dis = _load_stores(operation_key, target_simulator="vbs4")
    orbat = _translate_all(ontology, configs, vbs4_by_dis=vbs4_by_dis)
    return json.dumps(orbat, indent=2)


@function
def translate_orbat_from_json(ontology_json: String) -> String:
    """
    Generate a unified ORBAT JSON from a pre-existing ontology JSON string,
    bypassing any live Ontology lookups.

    Automatically detects which simulators are required and merges all
    translator outputs into a single ORBAT JSON.

    Expected ontology_json shape:
      {
        "operation":          { ... },
        "units":              [ ... ],
        "unitHierarchyEdges": [ ... ]
      }

    Args:
        ontology_json: OntologyStore-compatible JSON string

    Returns:
        Unified ORBAT as JSON string
    """
    orbat = _translate_ontology_json(ontology_json)
    return json.dumps(orbat, indent=2)


@function
def validate_orbat_xml(xml_string: String) -> String:
    """
    Validate a ORBAT XML string against the CSE ORBAT schema
    (validate.xsd + vbs4.xsd + sword.xsd + simworks.xsd).

    Args:
        xml_string: Pretty-printed ORBAT XML string as returned by translate_orbat_to_xml_from_operation

    Returns:
        "VALID" if the document passes all schema checks, otherwise a newline-separated
        list of validation error messages.
    """
    from src.xml_validator import validate_orbat_xml as _validate

    errors = _validate(xml_string)
    if not errors:
        return "VALID"
    return "\n".join(errors)


@function
def preflight_orbat_from_operation(operation_key: String) -> String:
    """
    Report everything that would stop an operation's ORBAT working, before export.

    Schema validation alone is not enough to answer "will this ORBAT run?".
    UnitExtension is optional in validate.xsd, so a unit with no simulator asset
    produces a perfectly valid document that then spawns nothing; the same goes
    for an empty className. This runs the full translation pipeline and reports
    both classes of problem:

      ERROR    the ORBAT will be rejected by the validator, or accepted and then
               produce nothing (no asset, empty className, unfederated unit,
               non-integer id, a unit directly beneath the root organisation)
      WARNING  it will load, but something is missing (placeholder DIS code, no
               SWORD class on an organisation, a second simulator block that has
               to be dropped)

    Run this before translate_orbat_to_xml_from_operation to find out which
    units need attention, rather than discovering it in the simulator.

    Args:
        operation_key: e.g. "OP-NORDIC-2026"

    Returns:
        JSON: {"summary": str, "errors": int, "warnings": int, "issues": [...]}
    """
    from src.orbat_preflight import preflight_orbat, preflight_summary

    ontology, configs, vbs4_by_dis = _load_stores(operation_key, target_simulator="vbs4")
    orbat = _translate_all(ontology, configs, vbs4_by_dis=vbs4_by_dis)

    issues = preflight_orbat(orbat)
    return json.dumps(
        {
            "operationKey": operation_key,
            "summary": preflight_summary(issues),
            "errors": sum(1 for i in issues if i["severity"] == "ERROR"),
            "warnings": sum(1 for i in issues if i["severity"] == "WARNING"),
            "issues": issues,
        },
        indent=2,
    )


@function
def preflight_orbat_for_composition(operation_key: String, composition_xml: String) -> String:
    """
    Report everything that would stop an operation's ORBAT working IN A GIVEN
    COMPOSITION, before it is sent to CSE.

    preflight_orbat_from_operation asks "is this ORBAT complete?" — a question
    with one document in it. This asks the question that has two: the same
    ORBAT is fine for one federation and impossible in another, because the
    composition decides which simulators exist, how many units the exercise
    can carry, and what echelon span it is built for.

    cse_run_composition_simple posts exactly this pair — one composition.xml
    and one orbat.xml — so this is the check that matches what actually gets
    submitted. Both the general checks and the composition-specific ones are
    returned, so a caller only needs this one call.

      ERROR    a unit needs a simulator the composition does not run, or the
               force exceeds the composition's maximum, plus every ERROR
               preflight_orbat_from_operation reports.
      WARNING  a formation sits outside MinLevel..MaxLevel, or the force is
               under the composition's minimum.

    The composition document is parsed WITHOUT resolving its external
    entities — see src/composition.py. Nothing in it is dereferenced.

    Args:
        operation_key:   e.g. "OP-NORDIC-2026"
        composition_xml: the composition document, as posted to CSE.

    Returns:
        JSON: {"summary", "errors", "warnings", "composition": {...}, "issues": [...]}
    """
    ontology, configs, vbs4_by_dis = _load_stores(operation_key, target_simulator="vbs4")
    orbat = _translate_all(ontology, configs, vbs4_by_dis=vbs4_by_dis)
    return json.dumps(
        {"operationKey": operation_key, **_composition_preflight_report(orbat, composition_xml)},
        indent=2,
    )


@function(api_name="nxgPreflightOrbatFromPhaseForComposition")
def preflight_orbat_from_phase_for_composition(
    operation_key: String, phase_key: String, composition_xml: String
) -> String:
    """
    Report everything that would stop one phase's ORBAT working IN A GIVEN
    COMPOSITION, before it is sent to CSE.

    The phase twin of preflight_orbat_for_composition: identical checks and
    result shape, but the ORBAT is the one translate_orbat_to_xml_from_phase
    exports — only hierarchies carrying the phaseKey, plus the phase's
    key-prefixed units. Execute launches a phase, so this is the
    composition-aware check that matches what it actually submits.

      ERROR    a unit needs a simulator the composition does not run, or the
               force exceeds the composition's maximum, plus every ERROR
               preflight_orbat_from_phase reports.
      WARNING  a formation sits outside MinLevel..MaxLevel, or the force is
               under the composition's minimum.

    Args:
        operation_key:   e.g. "OPERATION-BALTIC-SHIELD"
        phase_key:       NxgPhase.phaseId, e.g. "obs_phase_01"
        composition_xml: the composition document, as posted to CSE.

    Returns:
        JSON: {"operationKey", "phaseKey", "composition": {...}, "simulatedUnits",
               "summary", "errors", "warnings", "issues": [...]}
    """
    ontology, configs, vbs4_by_dis = _load_stores(
        operation_key, target_simulator="vbs4", phase_key=phase_key
    )
    orbat = _translate_all(ontology, configs, vbs4_by_dis=vbs4_by_dis)
    return json.dumps(
        {
            "operationKey": operation_key,
            "phaseKey": phase_key,
            **_composition_preflight_report(orbat, composition_xml),
        },
        indent=2,
    )


def _composition_preflight_report(orbat: dict, composition_xml: str) -> dict:
    """
    General preflight plus the composition checks, for an already translated
    ORBAT. Shared by the operation and phase composition preflights so they
    cannot drift; the caller adds the keys that identify what was checked.
    """
    from src.composition import parse_composition, count_simulated_units
    from src.composition_checks import check_orbat_against_composition
    from src.orbat_preflight import preflight_orbat, preflight_summary

    spec = parse_composition(composition_xml)
    issues = [*preflight_orbat(orbat), *check_orbat_against_composition(orbat, spec)]
    issues.sort(key=lambda i: 0 if i["severity"] == "ERROR" else 1)

    return {
        "composition": {
            "name": spec.name,
            "simulators": sorted(spec.simulators),
            "services": sorted(spec.services),
            "minUnits": spec.min_units,
            "maxUnits": spec.max_units,
            "minLevel": spec.min_level,
            "maxLevel": spec.max_level,
        },
        "simulatedUnits": count_simulated_units(orbat),
        "summary": preflight_summary(issues),
        "errors": sum(1 for i in issues if i["severity"] == "ERROR"),
        "warnings": sum(1 for i in issues if i["severity"] == "WARNING"),
        "issues": issues,
    }


@function
def translate_orbat_to_xml_from_operation(operation_key: String) -> String:
    """
    Generate a unified ORBAT XML for a given NxgOperation.

    Runs the same full translation pipeline as translate_orbat_from_operation
    (VBS4 + SWORD + SimWorks detection and merging) and serialises the result
    to the namespaced XML format used by the CSE platform.

    Units carry exactly one simulator extension, chosen by owningSimulator: the
    schema allows one UnitExtension per unit, so a SimWorks unit that also
    resolved a canonical VBS4 asset has that second block dropped (logged). See
    EMIT_REFERENCE_VBS4 in src/xml_translator.py.

    Call preflight_orbat_from_operation first if you want to know what is
    missing — a document can validate and still be empty of anything spawnable.

    Args:
        operation_key: e.g. "OP-NORDIC-2026"

    Returns:
        Unified ORBAT as a pretty-printed XML string
    """
    ontology, configs, vbs4_by_dis = _load_stores(operation_key, target_simulator="vbs4")
    orbat = _translate_all(ontology, configs, vbs4_by_dis=vbs4_by_dis)
    return orbat_to_xml(orbat)


@function(api_name="nxgTranslateOrbatToXmlFromPhase")
def translate_orbat_to_xml_from_phase(operation_key: String, phase_key: String) -> String:
    """
    Generate one ORBAT XML for a single phase of an operation.

    This is the phase-scoped counterpart to translate_orbat_to_xml_from_operation.
    Only hierarchies whose phaseKey matches are loaded, and they are merged into
    one document: each force contributes a root, and validate.xsd allows
    <Entities> to hold unbounded root Organisations, so friendly and enemy come
    out as sibling root Organisations in a single ORBAT.

    Each phase holds a FULL STANDING FORCE, not a difference from the phase
    before it, so a phase can be simulated on its own and the next phase can be
    authored or amended from the result. Lineage between phases is recorded on
    NxgPhase.basedOnPhaseId, not by diffing ORBATs.

    A separate function rather than an optional argument on the existing one:
    these are @function entry points bound to action types by exact signature,
    and adding a parameter to translate_orbat_to_xml_from_operation would break
    every caller of it.

    Call preflight_orbat_from_phase first. A document can validate and still be
    empty of anything spawnable.

    Args:
        operation_key: e.g. "OPERATION-BALTIC-SHIELD"
        phase_key:     NxgPhase.phaseId, e.g. "obs_phase_01"

    Returns:
        Unified ORBAT for that phase, as a pretty-printed XML string
    """
    ontology, configs, vbs4_by_dis = _load_stores(
        operation_key, target_simulator="vbs4", phase_key=phase_key
    )
    orbat = _translate_all(ontology, configs, vbs4_by_dis=vbs4_by_dis)
    return orbat_to_xml(orbat)


@function(api_name="nxgPreflightOrbatFromPhase")
def preflight_orbat_from_phase(operation_key: String, phase_key: String) -> String:
    """
    Report everything that would stop one phase's ORBAT working, before export.

    Identical in behaviour to preflight_orbat_from_operation, but scoped to the
    hierarchies carrying the given phaseKey. Run this before
    translate_orbat_to_xml_from_phase.

    Args:
        operation_key: e.g. "OPERATION-BALTIC-SHIELD"
        phase_key:     NxgPhase.phaseId, e.g. "obs_phase_01"

    Returns:
        JSON: {"summary": str, "errors": int, "warnings": int, "issues": [...]}
    """
    from src.orbat_preflight import preflight_orbat, preflight_summary

    ontology, configs, vbs4_by_dis = _load_stores(
        operation_key, target_simulator="vbs4", phase_key=phase_key
    )
    orbat = _translate_all(ontology, configs, vbs4_by_dis=vbs4_by_dis)

    issues = preflight_orbat(orbat)
    return json.dumps(
        {
            "operationKey": operation_key,
            "phaseKey": phase_key,
            "summary": preflight_summary(issues),
            "errors": sum(1 for i in issues if i["severity"] == "ERROR"),
            "warnings": sum(1 for i in issues if i["severity"] == "WARNING"),
            "issues": issues,
        },
        indent=2,
    )


@function
def translate_orbat_to_xml_from_json(ontology_json: String) -> String:
    """
    Generate a unified ORBAT XML from a pre-existing ontology JSON string.

    Accepts the same ontology JSON shape as translate_orbat_from_json, runs
    the full multi-simulator translation pipeline, and returns the result as
    the namespaced XML format used by the CSE platform.

    Args:
        ontology_json: OntologyStore-compatible JSON string

    Returns:
        Unified ORBAT as a pretty-printed XML string
    """
    orbat = _translate_ontology_json(ontology_json)
    return orbat_to_xml(orbat)


# ---------------------------------------------------------------------------
# Upsert helpers for import_ontology_orbat_from_json
# ---------------------------------------------------------------------------


def _upsert_units_batch(ontology_edits, units_data: list[dict]) -> None:
    """Upsert all NxgUnit objects, using a single bulk lookup."""
    if not units_data:
        return

    client = FoundryClient()
    pks = [u["primaryKey"] for u in units_data]

    # Bulk-load existing units to avoid N individual .get() calls
    existing_units: dict[str, object] = {}
    for unit_obj in client.ontology.objects.NxgUnit.where(
        NxgUnit.object_type.primary_key_.in_(pks)
    ).iterate():
        if unit_obj.primary_key_:
            existing_units[unit_obj.primary_key_] = unit_obj

    for unit in units_data:
        pk: str = unit["primaryKey"]
        existing = existing_units.get(pk)
        props = _unit_props_from_payload(unit, existing)

        if existing is None:
            ontology_edits.objects.NxgUnit.create(pk, **props)
        else:
            editable = ontology_edits.objects.NxgUnit.edit(existing)
            for attr, value in props.items():
                setattr(editable, attr, value)


#: (payload key, NxgUnit property) for the plain fields an upsert writes.
#:
#: "dis6_code", not "dis_6_code" — the OSDK snake-cases the apiName dis6Code
#: and leaves the digit attached. Under the wrong name create() raises
#: "unexpected keyword argument 'dis_6_code'"; see
#: tests/test_reconcile_property_names.py.
_UNIT_PAYLOAD_FIELDS: tuple[tuple[str, str], ...] = (
    ("unitIdentifier", "unit_identifier"),
    ("entityType", "entity_type"),
    ("canControlDrones", "can_control_drones"),
    ("simulatorIdentifierCode", "simulator_identifier_code"),
    ("latitude", "latitude"),
    ("longitude", "longitude"),
    ("militaryService", "military_service"),
    ("echelon", "echelon"),
    ("sidc", "sidc"),
    ("affiliation", "affiliation"),
    ("allegiance", "allegiance"),
    ("unitTypeKey", "unit_type_key"),
    ("equipmentTypeKey", "equipment_type_key"),
    ("dis6Code", "dis6_code"),
)

#: What the planner writes for dis when it has no asset in hand.
_PLACEHOLDER_DIS = "0.0.0.0.0.0.0"


def _owning_simulator_for_ontology(raw) -> str:
    """
    owningSimulator as stored on NxgUnit: the schema vocabulary from
    simulator_targets (vbs4, simworks, ascot7, jtls-go, sword, mace — lower
    case), or "none" for a unit that is not federated or names a simulator
    nobody recognises.

    This replaces an ad-hoc map that wrote "Vbs4" / "Mace" / "Simworks" and
    turned ascot7 and jtls-go into "none", unfederating those units.
    """
    return normalise_owning_simulator(None if raw is None else str(raw)) or "none"


def _unit_props_from_payload(unit: dict, existing) -> dict:
    """
    The NxgUnit properties to write for one payload unit.

    Only fields the payload actually carries are written: a key that is absent,
    or present as null, leaves the stored value as it is. A reconcile is
    routinely sent for part of a force — the planner's serialiser sends null
    latitude/longitude for every unit it did not place — and writing None for
    those used to wipe positions, SIDCs and affiliations a previous call had
    set. A consequence is that a reconcile cannot clear a field to null.

    dis is also never downgraded: the placeholder "0.0.0.0.0.0.0" is not
    written over a real stored DIS code.

    A NEW unit (existing is None) still gets owningSimulator "none" and the
    placeholder dis when the payload has none, as before.
    """
    props: dict = {}
    for json_name, prop_name in _UNIT_PAYLOAD_FIELDS:
        if unit.get(json_name) is not None:
            props[prop_name] = unit[json_name]

    if unit.get("owningSimulator") is not None:
        props["owning_simulator"] = _owning_simulator_for_ontology(unit["owningSimulator"])
    elif existing is None:
        props["owning_simulator"] = "none"

    dis = unit.get("dis") or unit.get("dis6Code")
    if existing is None:
        props["dis"] = dis or _PLACEHOLDER_DIS
    elif dis:
        stored = getattr(existing, "dis", None)
        if dis != _PLACEHOLDER_DIS or not stored or stored == _PLACEHOLDER_DIS:
            props["dis"] = dis

    return props


def _upsert_edges_batch(ontology_edits, edges_data: list[dict], hierarchy_key: str) -> None:
    """Upsert all NxgUnitHierachyEdge objects, using a single bulk lookup."""
    if not edges_data:
        return

    client = FoundryClient()

    # Assign primary keys to edges that don't have one.
    #
    # Derived from (hierarchy, parent, child) rather than random: an edge is
    # that triple, so re-importing the same ORBAT now converges on one row per
    # relationship. With uuid4 every re-import added a duplicate edge for a
    # relationship that already existed, which is how the same parent/child
    # pair ended up in a hierarchy several times over.
    for edge in edges_data:
        if not edge.get("primaryKey"):
            edge["primaryKey"] = stable_edge_key(
                hierarchy_key,
                edge.get("parentUnitKey") or "",
                edge.get("childUnitKey") or "",
            )

    pks = [e["primaryKey"] for e in edges_data]

    # Bulk-load existing edges
    existing_edges: dict[str, object] = {}
    for edge_obj in client.ontology.objects.NxgUnitHierachyEdge.where(
        NxgUnitHierachyEdge.object_type.primary_key_.in_(pks)
    ).iterate():
        if edge_obj.primary_key_:
            existing_edges[edge_obj.primary_key_] = edge_obj

    for edge in edges_data:
        pk: str = edge["primaryKey"]
        props = dict(
            hierarchy_key=hierarchy_key,
            parent_unit_key=edge.get("parentUnitKey"),
            child_unit_key=edge.get("childUnitKey"),
            # FK into NxgUnitHierarchyNodeRelationshipType, whose keys are
            # RELTYPE-ORGANIC / -OPCON / -TACON / -ATTACHED / -ASSIGNED. The
            # previous default, "ORGANIC", matches no row — it wrote a dangling
            # reference on every edge that didn't state the key explicitly.
            relationship_type_key=edge.get("relationshipTypeKey")
            or ORGANIC_RELATIONSHIP_KEY,
            valid_from=_parse_date(edge.get("validFrom")),
            valid_to=_parse_date(edge.get("validTo")),
        )

        existing = existing_edges.get(pk)
        if existing is None:
            ontology_edits.objects.NxgUnitHierachyEdge.create(pk, **props)
        else:
            editable = ontology_edits.objects.NxgUnitHierachyEdge.edit(existing)
            for attr, value in props.items():
                setattr(editable, attr, value)


def _upsert_hierarchy(
    ontology_edits,
    hierarchy_key: str,
    operation_key: str,
    operation_data: dict,
    name_override: str | None = None,
    valid_from_override: str | None = None,
    valid_to_override: str | None = None,
    phase_key: str | None = None,
) -> None:
    """
    Create a NxgUnitHierarchy if it doesn't exist, otherwise update it.

    phase_key is only written when given. A per-phase ORBAT
    (hier-{scenario}--{phase}) must carry it — it is how the phase functions
    and CSE validation find the hierarchy — but a caller that does not know it
    must not clear one that is already set.
    """
    props = dict(
        name=name_override or f"{operation_key} Hierarchy",
        operation_key=operation_key,
        valid_from=_parse_date(valid_from_override) if valid_from_override else _parse_date(operation_data.get("startTime")),
        valid_to=_parse_date(valid_to_override) if valid_to_override else _parse_date(operation_data.get("endTime")),
    )
    if phase_key:
        props["phase_key"] = phase_key
    existing = FoundryClient().ontology.objects.NxgUnitHierarchy.get(hierarchy_key)
    if existing is None:
        ontology_edits.objects.NxgUnitHierarchy.create(hierarchy_key, **props)
    else:
        editable = ontology_edits.objects.NxgUnitHierarchy.edit(existing)
        for attr, value in props.items():
            setattr(editable, attr, value)


@function(edits=[NxgUnit, NxgUnitHierarchy, NxgUnitHierachyEdge])
def import_ontology_orbat_from_json(ontology_json: String) -> list[OntologyEdit]:
    """
    Parse an ontology JSON string and upsert the corresponding NxgUnit,
    NxgUnitHierarchy, and NxgUnitHierachyEdge objects in the Ontology.
    Existing objects with matching primary keys are updated in place.

    The hierarchy key is derived deterministically from the operation primary key
    so that re-importing the same operation always targets the same hierarchy object.

    Args:
        ontology_json: OntologyStore-compatible JSON string

    Returns:
        list of OntologyEdit objects (applied when triggered as a function-backed Action)
    """
    return _import_orbat_from_payload(json.loads(ontology_json))


@function(edits=[NxgUnit, NxgUnitHierarchy, NxgUnitHierachyEdge])
def import_ontology_orbat_from_gzip_base64(ontology_gzip_base64: String) -> list[OntologyEdit]:
    """
    Same import as import_ontology_orbat_from_json, but the payload arrives
    gzipped and base64-encoded.

    Why this exists: an ORBAT of any realistic size does not survive being
    passed as a raw JSON string in an Action parameter. A 59-unit battlegroup
    is already ~23KB of JSON, a 250-unit ORBAT is ~100KB, and callers hit both
    Action parameter size limits and, for tool/agent callers, escaping limits
    on the several hundred quote characters involved. Standard base64 is plain
    [A-Za-z0-9+/=] with no quotes, braces or hyphens, and gzip takes a highly
    repetitive ORBAT down by roughly an order of magnitude, so the same
    battlegroup arrives as a few KB of inert text.

    Standard base64 deliberately, NOT urlsafe: urlsafe swaps '+/' for '-_' and
    the hyphen is exactly the character that makes these payloads awkward to
    pass through intermediaries.

    Args:
        ontology_gzip_base64: base64(gzip(<the JSON accepted by
                              import_ontology_orbat_from_json>))

    Returns:
        list of OntologyEdit objects (applied when triggered as a function-backed Action)
    """
    decoded = decode_gzip_base64(ontology_gzip_base64)
    log.info(
        "Compressed ORBAT payload: %d base64 chars -> %d JSON chars",
        len(ontology_gzip_base64),
        len(decoded),
    )
    return _import_orbat_from_payload(json.loads(decoded))


def _import_orbat_from_payload(data: dict) -> list[OntologyEdit]:
    """
    Upsert the NxgUnitHierarchy, NxgUnit and NxgUnitHierachyEdge objects
    described by an already-parsed ORBAT payload.

    Shared by import_ontology_orbat_from_json and
    import_ontology_orbat_from_gzip_base64 so the two differ only in how the
    bytes arrive, never in what they do to the Ontology.
    """
    operation_data = data["operation"]
    units_data: list[dict] = data.get("units", [])
    edges_data: list[dict] = data.get("unitHierarchyEdges", [])

    operation_key: str = operation_data["primaryKey"]

    # Use hierarchy key/name from JSON if provided, otherwise fall back to
    # deterministic derivation from the operation key.
    hierarchy_data: dict = data.get("unitHierarchy", {})
    hierarchy_key = hierarchy_data.get("primaryKey") or f"{operation_key}-HIERARCHY"
    hierarchy_name = hierarchy_data.get("name") or f"{operation_key} Hierarchy"
    hierarchy_valid_from = hierarchy_data.get("validFrom")
    hierarchy_valid_to = hierarchy_data.get("validTo")

    ontology_edits = FoundryClient().ontology.edits()

    # 1. Upsert NxgUnitHierarchy (single object — no batching needed)
    _upsert_hierarchy(
        ontology_edits, hierarchy_key, operation_key, operation_data,
        name_override=hierarchy_name,
        valid_from_override=hierarchy_valid_from,
        valid_to_override=hierarchy_valid_to,
    )

    # 2. Upsert NxgUnit objects (batched)
    _upsert_units_batch(ontology_edits, units_data)

    # 3. Upsert NxgUnitHierachyEdge objects (batched)
    _upsert_edges_batch(ontology_edits, edges_data, hierarchy_key)

    return ontology_edits.get_edits()


# ---------------------------------------------------------------------------
# Scenario ORBAT reconciliation
# ---------------------------------------------------------------------------


def _desired_parentage(edges_data: list[dict]) -> dict[str, str]:
    """
    Collapse the requested edges into child → parent, rejecting contradictions.

    A unit has exactly one parent in a hierarchy. Two edges naming different
    parents for the same child is a caller bug, and silently keeping one of them
    would produce a graph nobody asked for.
    """
    desired: dict[str, str] = {}
    for edge in edges_data:
        child = edge.get("childUnitKey")
        parent = edge.get("parentUnitKey")
        if not child or not parent:
            raise ValueError(
                "Every edge needs both parentUnitKey and childUnitKey; got "
                f"parent={parent!r} child={child!r}"
            )
        if child == parent:
            raise ValueError(f"Unit {child} cannot be its own parent")
        previous = desired.get(child)
        if previous is not None and previous != parent:
            raise ValueError(
                f"Unit {child} is given two parents ({previous} and {parent}); "
                "a unit has one parent per hierarchy"
            )
        desired[child] = parent
    return desired


def _assert_acyclic(desired: dict[str, str]) -> None:
    """
    Reject parentage that would make a unit its own ancestor.

    Cheap insurance: with echelon-ranked parentage a cycle is impossible by
    construction, but a manual parent override can ask for one, and a cycle in
    the ontology means every subsequent tree walk either loops or truncates.
    """
    limit = len(desired) + 1
    for start in desired:
        seen = {start}
        node = start
        for _ in range(limit):
            parent = desired.get(node)
            if parent is None:
                break
            if parent in seen:
                raise ValueError(
                    f"Parentage is cyclic: {parent} is already an ancestor of itself "
                    f"via {start}"
                )
            seen.add(parent)
            node = parent


def _prune_stale_parent_edges(
    ontology_edits,
    hierarchy_key: str,
    desired: dict[str, str],
    managed_child_keys: set[str],
    desired_edge_keys: Optional[dict[str, str]] = None,
) -> list:
    """
    Delete edges that contradict the desired parentage.

    Scope is deliberately narrow: only edges whose CHILD is in
    `managed_child_keys` are candidates. Those are the units whose place in the
    wider graph this call owns — typically the ORBAT roots of the scenario's
    placed units. Everything below them (a unit's own sub-tree) has children
    outside the set and is left untouched, which is what makes it safe to
    re-run: reconciling parentage must never dismantle the ORBAT a planner
    built.

    For a managed child, every edge in the hierarchy is deleted unless it is
    THE edge for the requested parent — whatever its key format:

      - an edge to any other parent (or any edge at all, when the child is
        managed but given no parent) is stale parentage;
      - an edge to the requested parent under a key other than the one this
        call writes (`desired_edge_keys`, normally the deterministic
        stable_edge_key) is a duplicate — typically a legacy random-key row
        that used to survive beside the deterministic one.

    This is what turns an upsert into a reconcile. Without it, placing a
    division after three battalions leaves the battalions with both their old
    parent and the new one.

    Note that `.where()` sees the pre-edit state during function execution, so
    edges created earlier in this same call are not candidates for deletion.

    Returns:
        The deleted edge objects.
    """
    if not managed_child_keys:
        return []

    desired_edge_keys = desired_edge_keys or {}
    client = FoundryClient()
    deleted = []
    for edge_obj in client.ontology.objects.NxgUnitHierachyEdge.where(
        NxgUnitHierachyEdge.object_type.hierarchy_key == hierarchy_key
    ).iterate():
        child = edge_obj.child_unit_key
        if not child or child not in managed_child_keys:
            continue
        parent = desired.get(child)
        if parent is not None and parent == edge_obj.parent_unit_key:
            kept_key = desired_edge_keys.get(child) or stable_edge_key(hierarchy_key, parent, child)
            if edge_obj.primary_key_ == kept_key:
                continue  # the edge this call keeps
            reason = "duplicate edge to the same parent"
        else:
            reason = "stale parentage"
        ontology_edits.objects.NxgUnitHierachyEdge.delete(edge_obj)
        deleted.append(edge_obj)
        log.info(
            "Pruning %s in %s: %s under %s (edge %s)",
            reason,
            hierarchy_key,
            child,
            edge_obj.parent_unit_key,
            edge_obj.primary_key_,
        )
    return deleted


def _prune_orphan_units(
    ontology_edits,
    phase_key: str,
    units_data: list[dict],
    edges_data: list[dict],
    deleted_edges: list,
) -> int:
    """
    Delete the phase's units that are no longer in its tree.

    Candidates are NxgUnit rows whose primary key starts with
    f"{phase_key}--". One is kept if it is named in this payload's `units`, is
    an endpoint of an edge this call writes, or is an endpoint of any existing
    edge — in any hierarchy — that this call is not deleting. Only what is left
    is deleted: a phase unit nothing refers to any more.

    A phase unit deliberately placed on its own with no edge must therefore be
    listed in `units` to survive a pruning reconcile.

    Returns:
        Number of units deleted.
    """
    client = FoundryClient()
    candidates = {
        u.primary_key_: u for u in _phase_prefixed_units(client, phase_key) if u.primary_key_
    }
    keep: set[str] = {u.get("primaryKey") for u in units_data if u.get("primaryKey")}
    for edge in edges_data:
        keep.add(edge.get("parentUnitKey"))
        keep.add(edge.get("childUnitKey"))
    candidates = {k: u for k, u in candidates.items() if k not in keep}
    if not candidates:
        return 0

    deleted_keys = {e.primary_key_ for e in deleted_edges}
    keys = list(candidates)
    for prop in ("child_unit_key", "parent_unit_key"):
        for edge_obj in client.ontology.objects.NxgUnitHierachyEdge.where(
            getattr(NxgUnitHierachyEdge.object_type, prop).in_(keys)
        ).iterate():
            if edge_obj.primary_key_ in deleted_keys:
                continue
            candidates.pop(edge_obj.child_unit_key, None)
            candidates.pop(edge_obj.parent_unit_key, None)

    for key in sorted(candidates):
        ontology_edits.objects.NxgUnit.delete(candidates[key])
        log.info("Pruning orphan unit %s from phase %s", key, phase_key)
    return len(candidates)


@function(edits=[NxgUnit, NxgUnitHierarchy, NxgUnitHierachyEdge])
def reconcile_scenario_orbat(scenario_json: String) -> list[OntologyEdit]:
    """
    Bring a scenario's ORBAT hierarchy into the shape the caller describes, in
    a single Action.

    import_ontology_orbat_from_json only ever adds: it cannot express "this
    battalion moved under the division that was just placed", because that
    needs the old edge gone. This function is that function plus a scoped
    delete, so callers can hand over the intended parentage and let the
    ontology converge on it, rather than issuing hundreds of individual
    create/delete Action calls from the browser and hoping none of them fails
    halfway.

    All edits are returned as one list, so the whole reconcile applies as a
    single transaction when this is wired to a function-backed Action: it either
    lands completely or not at all.

    Expected JSON:

        {
          "operation":    {"primaryKey": "OPERATION-BALTIC-SHIELD"},
          "unitHierarchy": {
             "primaryKey": "hier-scenario_operation_baltic_shield",
             "name":       "Operation BALTIC SHIELD — Scenario ORBAT",
             "validFrom":  "2026-09-15",
             "validTo":    null,
             "phaseKey":   "obs_phase_01"
          },
          "units": [ {"primaryKey": "...", "unitIdentifier": "...", ...} ],
          "unitHierarchyEdges": [
             {"parentUnitKey": "...", "childUnitKey": "...",
              "relationshipTypeKey": "RELTYPE-ORGANIC", "validFrom": "2026-09-15"}
          ],
          "managedChildUnitKeys": ["..."],
          "pruneOrphanUnits": false
        }

    `unitHierarchy.phaseKey` is optional. Set it for a per-phase ORBAT
    (hier-{scenario}--{phase}) so the hierarchy is stamped with NxgPhase.phaseId
    in the same transaction as its units; omit it to leave the property as it is.

    `units` and `unitHierarchyEdges` take the same shape as
    import_ontology_orbat_from_json. Edge primary keys may be omitted; they are
    derived from (hierarchy, parent, child) so repeated calls converge.

    `units` is a partial update: only fields present (and not null) on a unit
    are written; everything else keeps its stored value. A placeholder dis
    ("0.0.0.0.0.0.0") never overwrites a real stored one. owningSimulator is
    normalised to the schema vocabulary (src/simulator_targets.py), lower case,
    with "none" for an unfederated or unrecognised value.

    `managedChildUnitKeys` bounds the delete sweep — the units whose parentage
    this call owns:
      - absent (or null): defaults to the children named in
        `unitHierarchyEdges`, which is right when every managed unit is being
        given a parent;
      - an explicit list: exactly those units. `[]` means manage NOTHING — no
        edge is deleted — rather than falling back to the default;
      - include a unit's key and omit any edge for it to clear the parentage of
        a unit that has been removed from the scenario.
    For each managed unit, every edge in the hierarchy other than the one to
    its requested parent is deleted, whatever its key format — including a
    duplicate edge to the same parent under a legacy (random) key.

    `pruneOrphanUnits` (optional, default false) additionally deletes NxgUnit
    rows whose primary key starts with `{unitHierarchy.phaseKey}--` and that
    are no longer in the phase: not in `units`, not on a requested edge, and
    not on any surviving edge. Ignored unless `unitHierarchy.phaseKey` is set.

    Args:
        scenario_json: Reconcile request, as above.

    Returns:
        list of OntologyEdit objects (applied when triggered as a
        function-backed Action).
    """
    data = json.loads(scenario_json)

    operation_data = data.get("operation") or {}
    operation_key = operation_data.get("primaryKey")
    if not operation_key:
        raise ValueError("scenario_json.operation.primaryKey is required")

    hierarchy_data: dict = data.get("unitHierarchy") or {}
    hierarchy_key = hierarchy_data.get("primaryKey") or f"{operation_key}-HIERARCHY"

    units_data: list[dict] = data.get("units", [])
    edges_data: list[dict] = data.get("unitHierarchyEdges", [])

    desired = _desired_parentage(edges_data)
    _assert_acyclic(desired)

    # Explicit [] means "manage nothing"; only an absent/null key falls back.
    managed_raw = data.get("managedChildUnitKeys")
    managed_child_keys = set(desired.keys()) if managed_raw is None else set(managed_raw)
    phase_key = hierarchy_data.get("phaseKey")
    prune_orphans = bool(data.get("pruneOrphanUnits")) and bool(phase_key)

    ontology_edits = FoundryClient().ontology.edits()

    _upsert_hierarchy(
        ontology_edits,
        hierarchy_key,
        operation_key,
        operation_data,
        name_override=hierarchy_data.get("name"),
        valid_from_override=hierarchy_data.get("validFrom"),
        valid_to_override=hierarchy_data.get("validTo"),
        phase_key=phase_key,
    )
    _upsert_units_batch(ontology_edits, units_data)
    _upsert_edges_batch(ontology_edits, edges_data, hierarchy_key)
    # _upsert_edges_batch has filled in every edge's primaryKey.
    desired_edge_keys = {
        e["childUnitKey"]: e["primaryKey"] for e in edges_data if e.get("primaryKey")
    }
    deleted_edges = _prune_stale_parent_edges(
        ontology_edits, hierarchy_key, desired, managed_child_keys, desired_edge_keys
    )
    pruned = len(deleted_edges)
    orphans = (
        _prune_orphan_units(ontology_edits, phase_key, units_data, edges_data, deleted_edges)
        if prune_orphans
        else 0
    )

    log.info(
        "Reconciled %s: %d units, %d edges requested, %d stale edges pruned, "
        "%d managed units, %d orphan units pruned",
        hierarchy_key,
        len(units_data),
        len(edges_data),
        pruned,
        len(managed_child_keys),
        orphans,
    )

    return ontology_edits.get_edits()
