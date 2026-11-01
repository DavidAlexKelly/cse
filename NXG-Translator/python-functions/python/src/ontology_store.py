"""
OntologyStore — builds from either local mock JSON (dev/CLI) or live OSDK objects (Foundry).

Local JSON path:
    OntologyStore(data)            — parses raw dict, used by CLI and unit tests

Live OSDK path:
    OntologyStore.from_osdk(...)   — builds directly from OSDK objects returned by FoundryClient,
                                     no serialisation round-trip

JSON store format (matches live Ontology object types directly):
  {
    "operation":           { "primaryKey": "...", "startTime": "...", "endTime": "...", "terrainName": "..." },
    "units":               [ {
                               "primaryKey": "...", "unitIdentifier": "...", "latitude": ..., "longitude": ...,
                               "entityType": "...", "owningSimulator": "...", "dis": "...",
                               "canControlDrones": false, "simulatorIdentifierCode": "...",
                               "vbs4Asset": {
                                 "identifier": "...", "isDrone": false, "hasCommander": false,
                                 "numCargoSeats": 0,
                                 "gunnerSeatNames": "...", "gunnerSeatTurretIds": "..."
                               }
                             } ],
    "unitHierarchyEdges":  [ { "primaryKey": "...", "parentUnitKey": "...", "childUnitKey": "...", "relationshipTypeKey": "...", ... } ],
  }

  tacticalGraphicSymbols are no longer required — location now lives directly on NxgUnit (latitude/longitude).
  vbs4Asset is optional and only present when simulatorIdentifierCode resolves to a NxgVbs4AssetCatalogue entry.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    # Only imported for type hints — not required at runtime in local dev
    from ontology_sdk.ontology.objects import (
        NxgUnit as OsdkUnit,
        NxgUnitHierachyEdge as OsdkUnitHierarchyEdge,
        NxgOperation as OsdkOperation,
        NxgVbs4AssetCatalogue as OsdkVbs4Asset,
        NxgOSwordAssetCatalogue as OsdkSwordAsset,
        NxgSimworksAssetCatalogue as OsdkSimworksAsset,
    )


@dataclass
class SwordAsset:
    """Snapshot of NxgOSwordAssetCatalogue fields needed for translation."""

    identifier: str
    entity_type: Optional[str] = None
    dis6_code: Optional[str] = None
    display_name: Optional[str] = None
    sidc: Optional[str] = None
    is_group: Optional[bool] = None
    level: Optional[str] = None
    echelon_level: Optional[str] = None
    kind: Optional[str] = None
    domain: Optional[str] = None
    category: Optional[str] = None
    combat_efficiency: Optional[str] = None
    recon_efficiency: Optional[str] = None
    constituent_units: Optional[str] = None
    required_crew: Optional[str] = None
    min_units: Optional[str] = None
    max_units: Optional[str] = None
    automat_identity: Optional[str] = None
    automat_type: Optional[str] = None
    equipment_index: Optional[str] = None
    major_equipment_type: Optional[str] = None
    major_equipment_count: Optional[str] = None
    command_post_unit: Optional[str] = None

    @classmethod
    def from_osdk(cls, obj: "OsdkSwordAsset") -> "SwordAsset":
        return cls(
            identifier=obj.identifier or "",
            entity_type=obj.entity_type,
            dis6_code=obj.dis6code or obj.dis_code,
            display_name=obj.display_name,
            sidc=obj.sidc,
            is_group=obj.is_group,
            level=obj.level,
            echelon_level=obj.echelon_level,
            kind=obj.kind,
            domain=obj.domain,
            category=obj.category,
            combat_efficiency=obj.combat_efficiency,
            constituent_units=obj.constituent_units,
            required_crew=obj.required_crew,
            min_units=obj.min_units,
            max_units=obj.max_units,
            automat_identity=obj.automat_identity,
            automat_type=obj.automat_type,
            equipment_index=obj.equipment_index,
            major_equipment_type=obj.major_equipment_type,
            major_equipment_count=obj.major_equipment_count,
            command_post_unit=obj.command_post_unit,
            recon_efficiency=obj.recon_efficiency,
        )

    def to_dict(self) -> dict:
        return {
            "identifier": self.identifier,
            "entityType": self.entity_type,
            "dis6Code": self.dis6_code,
            "displayName": self.display_name,
            "sidc": self.sidc,
            "isGroup": self.is_group,
            "level": self.level,
            "echelonLevel": self.echelon_level,
            "kind": self.kind,
            "domain": self.domain,
            "category": self.category,
            "combatEfficiency": self.combat_efficiency,
            "constituentUnits": self.constituent_units,
            "requiredCrew": self.required_crew,
            "minUnits": self.min_units,
            "maxUnits": self.max_units,
            "automatIdentity": self.automat_identity,
            "automatType": self.automat_type,
            "equipmentIndex": self.equipment_index,
            "majorEquipmentType": self.major_equipment_type,
            "majorEquipmentCount": self.major_equipment_count,
            "commandPostUnit": self.command_post_unit,
            "reconEfficiency": self.recon_efficiency,
        }


@dataclass
class SimworksAsset:
    """Snapshot of NxgSimworksAssetCatalogue fields needed for translation."""

    identifier: str  # the SimWorks className, e.g. "simworks_fr_apc_vbci_woodland"

    @classmethod
    def from_dict(cls, data: dict) -> "SimworksAsset":
        return cls(
            identifier=data.get("identifier") or data.get("className", ""),
        )

    @classmethod
    def from_osdk(cls, obj: "OsdkSimworksAsset") -> "SimworksAsset":
        return cls(
            identifier=obj.identifier or "",
        )

    def to_dict(self) -> dict:
        return {"className": self.identifier}


@dataclass
class Vbs4Asset:
    """Snapshot of NxgVbs4AssetCatalogue fields needed for translation."""

    identifier: str
    dis6_code: Optional[str] = None
    is_drone: bool = False
    has_commander: bool = False
    num_cargo_seats: int = 0
    gunner_seat_names: Optional[str] = None
    gunner_seat_turret_ids: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict) -> "Vbs4Asset":
        return cls(
            # "identifier" is the canonical key; fall back to "simulatorIdentifierCode" for orbat.json inline blocks
            identifier=data.get("identifier") or data.get("simulatorIdentifierCode", ""),
            dis6_code=data.get("dis6Code"),
            is_drone=data.get("isDrone", False),
            has_commander=data.get("hasCommander", False),
            num_cargo_seats=data.get("numCargoSeats", 0),
            gunner_seat_names=data.get("gunnerSeatNames"),
            gunner_seat_turret_ids=data.get("gunnerSeatTurretIds"),
        )

    @classmethod
    def from_osdk(cls, obj: "OsdkVbs4Asset") -> "Vbs4Asset":
        return cls(
            identifier=obj.identifier or "",
            dis6_code=obj.dis6_code or None,
            is_drone=obj.is_drone or False,
            has_commander=bool(obj.has_commander),
            num_cargo_seats=int(obj.num_cargo_seats or 0),
            gunner_seat_names=obj.gunner_seat_names,
            gunner_seat_turret_ids=obj.gunner_seat_turret_ids,
        )


@dataclass
class Unit:
    primary_key: str
    unit_identifier: str
    military_service: str
    echelon: str
    sidc: str
    affiliation: str
    allegiance: str
    latitude: Optional[float]
    longitude: Optional[float]
    entity_type: Optional[str] = None
    owning_simulator: Optional[str] = None
    dis: str = "0.0.0.0.0.0.0"
    can_control_drones: bool = False
    simulator_identifier_code: Optional[str] = None
    vbs4_asset: Optional[Vbs4Asset] = None
    sword_asset: Optional[SwordAsset] = None
    simworks_asset: Optional[SimworksAsset] = None
    # VBS4 asset resolved via the canonical asset link for SimWorks units.
    # When a SimWorks asset shares a canonical asset with one or more VBS4 assets,
    # the first available VBS4 asset is stored here so the XML output can emit
    # both a <simworks:Simworks> block and a <vbs4:Vbs4> block on the same node.
    canonical_vbs4_asset: Optional[Vbs4Asset] = None

    @classmethod
    def from_dict(cls, data: dict) -> "Unit":
        # Support both "vbs4Asset" (canonical store format) and "vbs4" (orbat.json / legacy format)
        vbs4_asset_data = data.get("vbs4Asset") or data.get("vbs4")
        vbs4_asset = Vbs4Asset.from_dict(vbs4_asset_data) if vbs4_asset_data else None

        simworks_asset_data = data.get("simworksAsset") or data.get("simworks")
        simworks_asset = SimworksAsset.from_dict(simworks_asset_data) if simworks_asset_data else None

        canonical_vbs4_asset_data = data.get("canonicalVbs4Asset")
        canonical_vbs4_asset = Vbs4Asset.from_dict(canonical_vbs4_asset_data) if canonical_vbs4_asset_data else None

        return cls(
            primary_key=data["primaryKey"],
            unit_identifier=data.get("unitIdentifier", ""),
            military_service=data.get("militaryService", ""),
            echelon=data.get("echelon", ""),
            sidc=data.get("sidc", ""),
            affiliation=data.get("affiliation", ""),
            allegiance=data.get("allegiance", ""),
            latitude=data.get("latitude"),
            longitude=data.get("longitude"),
            entity_type=data.get("entityType"),
            owning_simulator=data.get("owningSimulator"),
            # Prefer the unit's own dis/dis6Code, then fall back to the asset catalogue's dis6Code
            dis=(
                data.get("dis")
                or data.get("dis6Code")
                or (vbs4_asset.dis6_code if vbs4_asset else None)
                or "0.0.0.0.0.0.0"
            ),
            can_control_drones=data.get("canControlDrones", False),
            simulator_identifier_code=data.get("simulatorIdentifierCode"),
            vbs4_asset=vbs4_asset,
            # swordAsset is not used in the JSON path (live OSDK only)
            sword_asset=None,
            simworks_asset=simworks_asset,
            canonical_vbs4_asset=canonical_vbs4_asset,
        )

    @classmethod
    def from_osdk(
        cls,
        obj: "OsdkUnit",
        vbs4_asset: Optional["OsdkVbs4Asset"] = None,
        sword_asset: Optional["OsdkSwordAsset"] = None,
        simworks_asset: Optional["OsdkSimworksAsset"] = None,
        canonical_vbs4_asset: Optional["OsdkVbs4Asset"] = None,
    ) -> "Unit":
        asset = Vbs4Asset.from_osdk(vbs4_asset) if vbs4_asset else None
        s_asset = SwordAsset.from_osdk(sword_asset) if sword_asset else None
        sw_asset = SimworksAsset.from_osdk(simworks_asset) if simworks_asset else None
        c_asset = Vbs4Asset.from_osdk(canonical_vbs4_asset) if canonical_vbs4_asset else None
        return cls(
            primary_key=obj.primary_key_ or "",
            unit_identifier=obj.unit_identifier or "",
            military_service=obj.military_service or "",
            echelon=obj.echelon or "",
            sidc=obj.sidc or "",
            affiliation=obj.affiliation or "",
            allegiance=obj.allegiance or "",
            latitude=obj.latitude,
            longitude=obj.longitude,
            entity_type=obj.entity_type,
            owning_simulator=obj.owning_simulator,
            # Prefer the unit's own dis field, then fall back to the asset catalogue's dis6Code
            dis=obj.dis or (asset.dis6_code if asset else None) or "0.0.0.0.0.0.0",
            can_control_drones=obj.can_control_drones or False,
            simulator_identifier_code=obj.simulator_identifier_code,
            vbs4_asset=asset,
            sword_asset=s_asset,
            simworks_asset=sw_asset,
            canonical_vbs4_asset=c_asset,
        )


@dataclass
class UnitHierarchyEdge:
    primary_key: str
    valid_from: str
    valid_to: Optional[str]
    child_unit_key: str
    parent_unit_key: str
    relationship_type: str

    @classmethod
    def from_dict(cls, data: dict) -> "UnitHierarchyEdge":
        return cls(
            primary_key=data["primaryKey"],
            valid_from=str(data.get("validFrom", "")),
            valid_to=str(data["validTo"]) if data.get("validTo") else None,
            child_unit_key=data["childUnitKey"],
            parent_unit_key=data["parentUnitKey"],
            relationship_type=data["relationshipTypeKey"],
        )

    @classmethod
    def from_osdk(cls, obj: "OsdkUnitHierarchyEdge") -> "UnitHierarchyEdge":
        return cls(
            primary_key=obj.primary_key_ or "",
            valid_from=str(obj.valid_from),
            valid_to=str(obj.valid_to) if obj.valid_to else None,
            child_unit_key=obj.child_unit_key or "",
            parent_unit_key=obj.parent_unit_key or "",
            # property was renamed from relationshipType to relationshipTypeKey
            relationship_type=obj.relationship_type_key or "",
        )


@dataclass
class Operation:
    primary_key: str
    start_time: str
    end_time: Optional[str]
    terrain_name: Optional[str] = None

    @classmethod
    def from_dict(cls, data: dict) -> "Operation":
        return cls(
            primary_key=data["primaryKey"],
            start_time=data.get("startTime", ""),
            end_time=data.get("endTime"),
            terrain_name=data.get("terrainName"),
        )

    @classmethod
    def from_osdk(cls, obj: "OsdkOperation") -> "Operation":
        return cls(
            primary_key=obj.primary_key_ or "",
            start_time=str(obj.start_time),
            end_time=str(obj.end_time) if obj.end_time else None,
            terrain_name=obj.terrain_name,
        )


class OntologyStore:
    """
    Holds all unit objects for one translation run.

    Can be constructed from:
      - Raw JSON dict (local dev / CLI):  OntologyStore(data)
      - Live OSDK objects (Foundry):      OntologyStore.from_osdk(...)

    JSON keys match the live Ontology object type names directly:
      - "units"              → NxgUnit
      - "unitHierarchyEdges" → NxgUnitHierachyEdge
      - "operation"          → NxgOperation
    """

    def __init__(self, data: dict) -> None:
        # Index units by primary key for O(1) lookup
        self._units: dict[str, Unit] = {u["primaryKey"]: Unit.from_dict(u) for u in data["units"]}

        self._edges: list[UnitHierarchyEdge] = [UnitHierarchyEdge.from_dict(e) for e in data["unitHierarchyEdges"]]

        self.operation = Operation.from_dict(data["operation"])
        self._build_indexes()

    @classmethod
    def from_osdk(
        cls,
        operation: "OsdkOperation",
        units: list["OsdkUnit"],
        edges: list["OsdkUnitHierarchyEdge"],
        assets: "dict[str, OsdkVbs4Asset] | None" = None,
        sword_assets_by_unit: "dict[str, OsdkSwordAsset] | None" = None,
        simworks_assets_by_unit: "dict[str, OsdkSimworksAsset] | None" = None,
        canonical_vbs4_assets_by_unit: "dict[str, OsdkVbs4Asset] | None" = None,
    ) -> "OntologyStore":
        """
        Build an OntologyStore directly from live OSDK objects.
        No dict serialisation — objects are mapped straight to internal dataclasses.

        Args:
            operation:                        The NxgOperation OSDK object for this run
            units:                            All NxgUnit OSDK objects in scope
            edges:                            All NxgUnitHierachyEdge OSDK objects in scope
            assets:                           NxgVbs4AssetCatalogue objects keyed by simulatorIdentifierCode
            sword_assets_by_unit:             NxgOSwordAssetCatalogue objects keyed by NxgUnit primary key
            simworks_assets_by_unit:          NxgSimworksAssetCatalogue objects keyed by NxgUnit primary key
            canonical_vbs4_assets_by_unit:    NxgVbs4AssetCatalogue objects resolved via the canonical asset
                                              link for SimWorks units, keyed by NxgUnit primary key.
                                              The first available VBS4 asset linked to the same canonical
                                              asset as the unit's SimWorks asset is stored here.

        Returns:
            Populated OntologyStore ready for translation
        """
        assets = assets or {}
        sword_assets_by_unit = sword_assets_by_unit or {}
        simworks_assets_by_unit = simworks_assets_by_unit or {}
        canonical_vbs4_assets_by_unit = canonical_vbs4_assets_by_unit or {}
        # Use object.__setattr__ to set private attrs on an uninitialised instance
        store: "OntologyStore" = cls.__new__(cls)
        object.__setattr__(
            store,
            "_units",
            {
                u.primary_key_ or "": Unit.from_osdk(
                    u,
                    vbs4_asset=assets.get(u.simulator_identifier_code or ""),
                    sword_asset=sword_assets_by_unit.get(u.primary_key_ or ""),
                    simworks_asset=simworks_assets_by_unit.get(u.primary_key_ or ""),
                    canonical_vbs4_asset=canonical_vbs4_assets_by_unit.get(u.primary_key_ or ""),
                )
                for u in units
            },
        )
        object.__setattr__(store, "_edges", [UnitHierarchyEdge.from_osdk(e) for e in edges])
        store.operation = Operation.from_osdk(operation)
        store._build_indexes()
        return store

    def _build_indexes(self) -> None:
        """Pre-compute child lookup and root detection indexes."""
        self._children_index: dict[str, list[str]] = {}
        for edge in self._edges:
            self._children_index.setdefault(edge.parent_unit_key, []).append(edge.child_unit_key)

        self._all_child_keys: set[str] = {e.child_unit_key for e in self._edges}

    def get_unit(self, primary_key: str) -> Optional[Unit]:
        return self._units.get(primary_key)

    def get_children(self, parent_key: str) -> list[Unit]:
        child_keys = self._children_index.get(parent_key, [])
        return [self._units[key] for key in child_keys if key in self._units]

    # ------------------------------------------------------------------
    # Finds root units — those with no parent in any hierarchy edge.
    # ------------------------------------------------------------------

    def get_root_units(self) -> list[Unit]:
        return [unit for key, unit in self._units.items() if key not in self._all_child_keys]

    def unit_count(self) -> int:
        return len(self._units)

    def edge_count(self) -> int:
        return len(self._edges)
