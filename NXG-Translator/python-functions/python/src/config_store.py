"""
SimulatorConfigStore — holds simulator-specific configuration for each unit.

This is intentionally separate from the ontology. The ontology describes
military reality; this store describes how to represent that reality in
a specific simulator.

Can be constructed from Unit objects (local dev / CLI / Foundry):
  SimulatorConfigStore(units, target_simulator, terrain_name)

Ontology change (2026-06):
  NxgSimulatorConfig has been removed. Simulator fields
  (entityType, owningSimulator, dis, canControlDrones, simulatorIdentifierCode)
  now live directly on NxgUnit, and are carried through on the Unit dataclass.
  VBS4 asset data (class name, gunner seats, etc.) is now embedded on Unit.vbs4_asset,
  resolved from NxgVbs4AssetCatalogue via NxgUnit.simulatorIdentifierCode.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Optional, TYPE_CHECKING

from src.simulator_targets import normalise_owning_simulator

if TYPE_CHECKING:
    from src.ontology_store import Unit

#: What the composition planner writes when it has no asset to derive one from.
_PLACEHOLDER_DIS = "0.0.0.0.0.0.0"


def _sword_class_from_identifier(identifier: Optional[str]) -> Optional[str]:
    """
    The class name SWORD expects, taken from our catalogue identifier.

    CSE's own ORBAT (tests/golden/sworbat.xml) writes:

        <sword:Sword controllable="false" class="ARMOR.Heavy tank company"/>

    Our catalogue identifiers carry a row-type suffix — "ARMOR.Heavy tank
    company|automat" — which is how the app distinguishes an automat (an
    aggregate SWORD spawns whole) from a unit (its internal composition). That
    suffix is ours, not SWORD's, and must come off before it reaches the XML.

    display_name is NOT the right source: for our rows it holds SWORD's
    decisional-model ("Artillery firefinder radar battery"), which is a
    behaviour model rather than the catalogue name SWORD matches on.
    """
    if not identifier:
        return None
    return identifier.split("|", 1)[0].strip() or None


def _dis_from_assets(unit: "Unit") -> Optional[str]:
    """
    Recover a unit's DIS code from whichever catalogue asset it resolved to.

    Every catalogue row carries the DIS code it was matched on — that is how the
    Master Asset Catalogue keys canonical assets in the first place — so an
    asset-backed unit always has one available even when the ontology row does
    not.
    """
    for asset in (unit.vbs4_asset, unit.simworks_asset, unit.canonical_vbs4_asset, unit.sword_asset):
        if asset is None:
            continue
        for attribute in ("dis_6_code", "dis6_code", "dis_code", "dis"):
            value = getattr(asset, attribute, None)
            if value and str(value).strip() and str(value) != _PLACEHOLDER_DIS:
                return str(value).strip()
    return None


@dataclass
class VBS4Config:
    class_name: str
    role: str
    is_drone: bool
    gunner_seat: dict
    all_gunner_seats: list
    has_commander: bool
    num_cargo_seats: int
    sensor_streaming_settings: dict
    streaming_settings: dict

    def to_dict(self) -> dict:
        return {
            "className": self.class_name,
            "role": self.role,
            "gunnerSeat": self.gunner_seat,
            "sensorStreamingSettings": self.sensor_streaming_settings,
            "streamingSettings": self.streaming_settings,
        }


@dataclass
class SwordConfig:
    controllable: bool
    sword_class: Optional[str]

    def to_dict(self) -> dict:
        return {
            "controllable": self.controllable,
            "class": self.sword_class,
        }


@dataclass
class SimworksConfig:
    class_name: str

    def to_dict(self) -> dict:
        return {"className": self.class_name}


@dataclass
class UnitSimulatorConfig:
    unit_key: str
    entity_type: str
    owning_simulator: str
    dis: str = "0.0.0.0.0.0.0"
    can_control_drones: bool = False
    vbs4: Optional[VBS4Config] = None
    sword: Optional[SwordConfig] = None
    simworks: Optional[SimworksConfig] = None
    # VBS4 config resolved via the canonical asset link for SimWorks units.
    # When present, the XML serialiser emits both <simworks:Simworks> and <vbs4:Vbs4>
    # on the same node so that VBS4 can receive position updates for the asset.
    canonical_vbs4: Optional[VBS4Config] = None

    @classmethod
    def from_unit(cls, unit: "Unit") -> "UnitSimulatorConfig":
        """Build a UnitSimulatorConfig directly from a Unit dataclass."""
        entity_type = unit.entity_type or ""

        vbs4: Optional[VBS4Config] = None
        asset = unit.vbs4_asset
        if asset:
            all_gunner_seats: list[dict] = []
            if asset.gunner_seat_names and asset.gunner_seat_turret_ids:
                # Canonical store format: pipe-delimited seat names + turret IDs
                names = asset.gunner_seat_names.split("|")
                turrets = asset.gunner_seat_turret_ids.split("|")
                for name, turret in zip(names, turrets):
                    all_gunner_seats.append({"turretIdentifier": turret, "name": name})
            # orbat.json inline format has no seat strings — all_gunner_seats stays empty
            # and primary_seat defaults to the "None" sentinel below.
            primary_seat = all_gunner_seats[0] if all_gunner_seats else {"turretIdentifier": "", "name": "None"}

            vbs4 = VBS4Config(
                class_name=asset.identifier,
                role="None",
                is_drone=asset.is_drone,
                gunner_seat=primary_seat,
                all_gunner_seats=all_gunner_seats,
                has_commander=asset.has_commander,
                num_cargo_seats=asset.num_cargo_seats,
                sensor_streaming_settings={
                    "enabled": False,
                    "host": "127.0.0.1",
                    "port": 0,
                },
                streaming_settings={
                    "host": "",
                    "port": 0,
                    "framerate": 0,
                    "bitrate": 0,
                    "width": 0,
                    "height": 0,
                    "fieldOfView": 0,
                },
            )

        sword: Optional[SwordConfig] = None
        if unit.sword_asset:
            sword = SwordConfig(
                controllable=False,
                sword_class=_sword_class_from_identifier(unit.sword_asset.identifier)
                or unit.sword_asset.display_name,
            )

        simworks: Optional[SimworksConfig] = None
        if unit.simworks_asset:
            simworks = SimworksConfig(class_name=unit.simworks_asset.identifier)

        # Build a VBS4 config from the canonical asset for SimWorks units.
        # This allows the node to carry both a simworks and vbs4 block.
        canonical_vbs4: Optional[VBS4Config] = None
        c_asset = unit.canonical_vbs4_asset
        if c_asset:
            c_all_gunner_seats: list[dict] = []
            if c_asset.gunner_seat_names and c_asset.gunner_seat_turret_ids:
                for name, turret in zip(c_asset.gunner_seat_names.split("|"), c_asset.gunner_seat_turret_ids.split("|")):
                    c_all_gunner_seats.append({"turretIdentifier": turret, "name": name})
            c_primary_seat = c_all_gunner_seats[0] if c_all_gunner_seats else {"turretIdentifier": "", "name": "None"}
            canonical_vbs4 = VBS4Config(
                class_name=c_asset.identifier,
                role="None",
                is_drone=c_asset.is_drone,
                gunner_seat=c_primary_seat,
                all_gunner_seats=c_all_gunner_seats,
                has_commander=c_asset.has_commander,
                num_cargo_seats=c_asset.num_cargo_seats,
                sensor_streaming_settings={
                    "enabled": False,
                    "host": "127.0.0.1",
                    "port": 0,
                },
                streaming_settings={
                    "host": "",
                    "port": 0,
                    "framerate": 0,
                    "bitrate": 0,
                    "width": 0,
                    "height": 0,
                    "fieldOfView": 0,
                },
            )

        # The DIS code is the canonical asset's primary key, so a unit with an
        # asset never needs the placeholder. Ontology units are written with
        # "0.0.0.0.0.0.0" because the composition planner has no asset in hand
        # at the time; fill it in here, where the asset is resolved.
        dis = unit.dis
        if not dis or dis == _PLACEHOLDER_DIS:
            asset_dis = _dis_from_assets(unit)
            if asset_dis:
                dis = asset_dis

        return cls(
            unit_key=unit.primary_key,
            entity_type=entity_type,
            # Normalised to the schema enumeration; see simulator_targets. Kept
            # as "" when the unit is not federated, which orbat_preflight
            # reports rather than the translator quietly inventing a simulator.
            owning_simulator=normalise_owning_simulator(unit.owning_simulator) or "",
            dis=dis,
            can_control_drones=unit.can_control_drones,
            vbs4=vbs4,
            sword=sword,
            simworks=simworks,
            canonical_vbs4=canonical_vbs4,
        )


class SimulatorConfigStore:
    """
    Lookup table of per-unit simulator configuration.

    Builds a UnitSimulatorConfig for every Unit at construction time,
    keyed by unit primary key.  Callers use get_config(unit_key) to
    retrieve the config during tree-building.
    """

    def __init__(
        self,
        units: "list[Unit]",
        target_simulator: str,
        terrain_name: str,
    ) -> None:
        self._configs: dict[str, UnitSimulatorConfig] = {u.primary_key: UnitSimulatorConfig.from_unit(u) for u in units}
        self.target_simulator = target_simulator
        self.terrain_name = terrain_name

    def get_config(self, unit_key: str) -> Optional[UnitSimulatorConfig]:
        return self._configs.get(unit_key)

    def config_count(self) -> int:
        return len(self._configs)

