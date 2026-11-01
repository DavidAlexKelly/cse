"""
Parses VBS4 C# source files into a versioned JSON asset catalogue.
Run when VBS4 updates: python3 -m src.catalogue_parser --version 25.2
"""

from __future__ import annotations

import re
import json
import argparse
import logging
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Simulator and military domain mappings
# ---------------------------------------------------------------------------

DOMAIN_TO_SIMULATOR: dict[str, str] = {
    "ArmyTracked":    "vbs4",  "ARMYTracked":    "vbs4",
    "ArmyWheeled":    "vbs4",  "ARMYWheeled":    "vbs4",
    "armytracked":    "vbs4",  "armywheeled":    "vbs4",
    "Armytracked":    "vbs4",  "Armywheeled":    "vbs4",
    "ARMYTRACKED":    "vbs4",  "ARMYWHEELED":    "vbs4",
    "armytrackedgrn": "vbs4",  "armytrackedtan": "vbs4",
    "armywheeledgrn": "vbs4",  "armywheeledtan": "vbs4",
    "MCTracked":      "vbs4",  "USMCTracked":    "vbs4",
    "USMCWheeled":    "vbs4",  "usmcwheeled":    "vbs4",
    "RMTracked":      "vbs4",  "rnlmtracked":    "vbs4",
    "rnlmptrackedb":  "vbs4",  "Tracked":        "vbs4",
    "ArmyAir":        "vbs4",  "ARMYAir":        "vbs4",
    "armyair":        "vbs4",  "ARMYAIR":        "vbs4",
    "ARMYAV":         "vbs4",
    "USAFAir":        "mace",  "USAFAIR":        "mace",
    "RAFAir":         "mace",  "RAFAIR":         "mace",
    "NAVYAir":        "mace",  "FAFAir":         "mace",
    "RNAir":          "mace",  "RNLAFAir":       "mace",
    "RNZAFAir":       "mace",  "RNZAFAIR":       "mace",
    "RAAFAIR":        "mace",  "CAFAir":         "mace",
    "cafair":         "mace",  "CAFAIR":         "mace",
    "SOCAir":         "mace",  "USMCAir":        "mace",
    "AFAir":          "mace",  "AFAIR":          "mace",
    "afair":          "mace",
    "NAVYShips":      "vbs4",  "navyship":       "vbs4",
    "NavyShip":       "vbs4",  "NavyShips":      "vbs4",
    "RNShips":        "vbs4",  "navywater":      "vbs4",
    "ARMYShips":      "vbs4",  "ARMYBoats":      "vbs4",
    "NAVY":           "vbs4",  "NavyMarine":     "vbs4",
    "UAV":            "vbs4",
    "ArmyMen":        "vbs4",  "ARMYMen":        "vbs4",
    "armymen":        "vbs4",  "armyMen":        "vbs4",
    "NAVYMen":        "vbs4",  "navymen":        "vbs4",
    "USMCMen":        "vbs4",  "MCMen":          "vbs4",
    "RAAFMen":        "vbs4",  "RAFMen":         "vbs4",
    "AFMen":          "vbs4",
}

DOMAIN_TO_MILITARY: dict[str, str] = {
    "ArmyTracked":    "ground",    "ARMYTracked":    "ground",
    "ArmyWheeled":    "ground",    "ARMYWheeled":    "ground",
    "armytracked":    "ground",    "armywheeled":    "ground",
    "Armytracked":    "ground",    "Armywheeled":    "ground",
    "ARMYTRACKED":    "ground",    "ARMYWHEELED":    "ground",
    "armytrackedgrn": "ground",    "armytrackedtan": "ground",
    "armywheeledgrn": "ground",    "armywheeledtan": "ground",
    "MCTracked":      "ground",    "USMCTracked":    "ground",
    "USMCWheeled":    "ground",    "usmcwheeled":    "ground",
    "RMTracked":      "ground",    "rnlmtracked":    "ground",
    "rnlmptrackedb":  "ground",    "Tracked":        "ground",
    "ArmyAir":        "aviation",  "ARMYAir":        "aviation",
    "armyair":        "aviation",  "ARMYAIR":        "aviation",
    "ARMYAV":         "aviation",
    "USAFAir":        "aviation",  "USAFAIR":        "aviation",
    "RAFAir":         "aviation",  "RAFAIR":         "aviation",
    "NAVYAir":        "aviation",  "FAFAir":         "aviation",
    "RNAir":          "aviation",  "RNLAFAir":       "aviation",
    "RNZAFAir":       "aviation",  "RNZAFAIR":       "aviation",
    "RAAFAIR":        "aviation",  "CAFAir":         "aviation",
    "cafair":         "aviation",  "CAFAIR":         "aviation",
    "SOCAir":         "aviation",  "USMCAir":        "aviation",
    "AFAir":          "aviation",  "AFAIR":          "aviation",
    "afair":          "aviation",
    "NAVYShips":      "naval",     "navyship":       "naval",
    "NavyShip":       "naval",     "NavyShips":      "naval",
    "RNShips":        "naval",     "navywater":      "naval",
    "ARMYShips":      "naval",     "ARMYBoats":      "naval",
    "NAVY":           "naval",     "NavyMarine":     "naval",
    "UAV":            "uav",
    "ArmyMen":        "personnel", "ARMYMen":        "personnel",
    "armymen":        "personnel", "armyMen":        "personnel",
    "NAVYMen":        "personnel", "navymen":        "personnel",
    "USMCMen":        "personnel", "MCMen":          "personnel",
    "RAAFMen":        "personnel", "RAFMen":         "personnel",
    "AFMen":          "personnel",
}


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

def parse_vbs4_class(cs_content: str) -> list[dict]:
    """
    Parse Vbs4Class.All.cs and extract all asset definitions.

    Each asset block looks like:
        SomeVarName = new ()
        {
            Identifier = "...",
            Description = "...",
            ...
            IsDrone = false,
        };

    Args:
        cs_content: Full text content of Vbs4Class.All.cs

    Returns:
        List of asset dicts
    """
    assets = []

    block_pattern = re.compile(
        r'\w+\s*=\s*new\s*\(\)\s*\n\s*\{(.*?)\n\s*\};',
        re.DOTALL
    )

    field_patterns = {
        "identifier":   re.compile(r'Identifier\s*=\s*"([^"]+)"'),
        "description":  re.compile(r'Description\s*=\s*"([^"]+)"'),
        "nationality":  re.compile(r'Nationality\s*=\s*Vbs4Nationality\.(\w+)'),
        "domain":       re.compile(r'Domain\s*=\s*Vbs4Domain\.(\w+)'),
        "simClass":     re.compile(r'SimulationClass\s*=\s*"([^"]+)"'),
        "classType":    re.compile(r'ClassType\s*=\s*Vbs4ClassType\.(\w+)'),
        "variant":      re.compile(r'Variant\s*=\s*"([^"]*)"'),
        "disCode":      re.compile(r'DisCode\s*=\s*DisCode\.Parse\("([^"]+)"\)'),
        "numCargo":     re.compile(r'NumCargoSeats\s*=\s*(\d+)'),
        "hasCommander": re.compile(r'HasCommander\s*=\s*(true|false)'),
        "crewClass":    re.compile(r'CrewClass\s*=\s*"([^"]+)"'),
        "preview":      re.compile(r'PreviewImageFilename\s*=\s*"([^"]+)"'),
        "isDrone":      re.compile(r'IsDrone\s*=\s*(true|false)'),
    }

    gunner_pattern = re.compile(
        r'new\(\)\s*\{\s*Name\s*=\s*"([^"]+)",\s*TurretIdentifier\s*=\s*"([^"]*)"\s*\}'
    )

    gunner_seats_pattern = re.compile(
        r'GunnerSeats\s*=\s*\[([^\]]*)\]',
        re.DOTALL
    )

    for block_match in block_pattern.finditer(cs_content):
        block = block_match.group(1)

        if 'Identifier' not in block:
            continue

        def get(key: str, default: str = "") -> str:
            m = field_patterns[key].search(block)
            return m.group(1) if m else default

        gunner_seats = []
        gs_match = gunner_seats_pattern.search(block)
        if gs_match:
            gunner_seats = [
                {"name": m.group(1), "turretIdentifier": m.group(2)}
                for m in gunner_pattern.finditer(gs_match.group(1))
            ]

        domain = get("domain")

        asset = {
            "identifier":            get("identifier"),
            "description":           get("description"),
            "nationality":           get("nationality"),
            "domain":                domain,
            "simulationClass":       get("simClass"),
            "classType":             get("classType"),
            "variant":               get("variant"),
            "disCode":               get("disCode"),
            "isDrone":               get("isDrone") == "true",
            "crewClass":             get("crewClass"),
            "previewImage":          get("preview"),
            "seating": {
                "numCargoSeats":     int(get("numCargo", "0")),
                "hasCommander":      get("hasCommander") == "true",
                "gunnerSeats":       gunner_seats,
            },
            "derivedSimulator":      DOMAIN_TO_SIMULATOR.get(domain, "vbs4"),
            "derivedMilitaryDomain": DOMAIN_TO_MILITARY.get(domain, "ground"),
        }

        assets.append(asset)

    return assets


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    arg_parser = argparse.ArgumentParser(
        description="Parse VBS4 C# source files into a versioned JSON asset catalogue"
    )
    arg_parser.add_argument(
        "--version",
        default="25.2",
        help="VBS4 version string e.g. 25.2"
    )
    args = arg_parser.parse_args()

    base_dir   = Path(__file__).parent.parent
    raw_dir    = base_dir / "simulators" / "vbs4" / "raw"
    output_dir = base_dir / "simulators" / "vbs4" / "catalogue"

    log.info(f"VBS4 version   : {args.version}")
    log.info(f"Raw source dir : {raw_dir}")
    log.info(f"Output dir     : {output_dir}")

    class_cs_path = raw_dir / "Vbs4Class.All.cs"

    if not class_cs_path.exists():
        log.error(f"Required file not found: {class_cs_path}")
        return

    log.info("Reading source file...")
    class_cs = class_cs_path.read_text(encoding="utf-8")

    log.info("Parsing assets...")
    assets = parse_vbs4_class(class_cs)

    # Derive domains and nationalities from parsed assets
    domains = sorted(
        [{"value": d} for d in {a["domain"] for a in assets}],
        key=lambda x: x["value"]
    )
    nationalities = sorted(
        [{"value": n} for n in {a["nationality"] for a in assets}],
        key=lambda x: x["value"]
    )

    catalogue = {
        "version":       args.version,
        "generatedFrom": "Vbs4Class.All.cs",
        "generatedAt":   datetime.now(timezone.utc).isoformat(),
        "assetCount":    len(assets),
        "assets":        assets,
        "domains":       domains,
        "nationalities": nationalities,
    }

    output_dir.mkdir(parents=True, exist_ok=True)

    versioned_path = output_dir / f"vbs4-asset-catalogue-v{args.version}.json"
    latest_path    = output_dir / "vbs4-asset-catalogue-latest.json"

    with open(versioned_path, "w", encoding="utf-8") as f:
        json.dump(catalogue, f, indent=2)

    with open(latest_path, "w", encoding="utf-8") as f:
        json.dump(catalogue, f, indent=2)

    log.info(f"Versioned catalogue : {versioned_path}")
    log.info(f"Latest catalogue    : {latest_path}")
    log.info(f"Assets parsed       : {len(assets)}")
    log.info(f"Domains derived     : {len(domains)}")
    log.info(f"Nationalities derived: {len(nationalities)}")

    domain_counts = Counter(a["derivedMilitaryDomain"] for a in assets)
    print("\nAssets by military domain:")
    for domain, count in sorted(domain_counts.items()):
        print(f"  {domain:12} : {count}")

    nat_counts = Counter(a["nationality"] for a in assets)
    print("\nTop nationalities:")
    for nat, count in nat_counts.most_common(10):
        print(f"  {nat:8} : {count}")


if __name__ == "__main__":
    main()