"""
sword_composition.py
====================
What is actually inside a SWORD automat.

-----------------------------------------------------------------------------
MIRRORED IN TYPESCRIPT.
Any change to how constituents are read or counted must be made in:
  [NXG] Mapplications Repo -> src/shared/orbat/swordComposition.ts
The two test files carry the same case table, in the same order, under the
same names:
  python-functions/python/tests/test_sword_composition.py
  src/shared/orbat/swordComposition.test.ts
-----------------------------------------------------------------------------

The catalogue states the composition
------------------------------------
An automat row carries what it is made of, and each unit row carries what
SWORD fills it with::

    ART.Guns firing battery|automat
      constituentUnits  ART.Battery CP#1#1 | ART.Guns firing platoon#3#3
      commandPostUnit   ART.Battery CP

    ART.Guns firing platoon|unit
      majorEquipmentType   ART.Gun 155mm
      majorEquipmentCount  4
      requiredCrew         5

A battery is one CP and three gun platoons of four guns each. The app used to
guess "three of the next echelon down" and produce three empty platoons.

Why the translator needs this too
---------------------------------
Two reasons, and the second is the one that will matter soon.

1. Preflight. Once an ORBAT expands an automat, the sub-formations must line
   up with the catalogue — an imported tree claiming a gun battery has six
   platoons is describing a force SWORD will not build.
2. The export projection (Phase 3). A VBS4-only run has no automats and no
   Pions; the same force has to be projected down to platforms, and this is
   the composition that projection walks.

Where it stops
--------------
At the sub-formation. Expanding a tank platoon into four tanks would
double-count — SWORD builds a Pion's equipment from its own catalogue — and
there is nowhere to point them anyway: majorEquipmentType is a SWORD type
("ARMOR.Main Battle Tank"), not a DIS code, and nothing in the ontology maps
the two. That mapping lives in component.xml, which is not ingested.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Optional

#: Separator between a constituent's name and its occurrence counts.
#:
#: The catalogue transform writes "<name>#<min>#<max>". A bare "<name>" is
#: accepted too: the column held names alone until the transform was taught to
#: keep the counts, and the dataset is rebuilt on its own schedule — so both
#: have to parse or this breaks for however long the two are out of step.
OCCURRENCE_SEPARATOR = "#"

#: Separator between constituents. Also the separator inside an identifier
#: ("<NATURE>.<name>|<level>"), which is safe: constituent entries are names
#: without a level suffix.
CONSTITUENT_SEPARATOR = "|"

UNIT_SUFFIX = "|unit"
AUTOMAT_SUFFIX = "|automat"


@dataclass(frozen=True)
class ConstituentSpec:
    """One entry in an automat's composition, before the name is resolved."""

    name: str
    min_occurs: int = 1
    max_occurs: int = 1


@dataclass(frozen=True)
class SwordEquipment:
    """What SWORD puts inside one of its units."""

    type: str
    count: int
    crew_per_item: int


@dataclass
class AutomatConstituent:
    """One constituent of an automat, resolved against the catalogue."""

    name: str
    #: The "|unit" catalogue row, when there is one.
    formation: Optional[dict] = None
    is_command_post: bool = False
    quantity: int = 1
    equipment: Optional[SwordEquipment] = None


@dataclass
class AutomatComposition:
    """An automat, taken apart."""

    identifier: str
    constituents: list[AutomatConstituent] = field(default_factory=list)
    #: Constituent names with no "|unit" row. Empty across all 81 automats.
    unresolved: list[str] = field(default_factory=list)


def _positive_int(raw: Any, fallback: int) -> int:
    """
    A positive integer from a catalogue string, or the fallback.

    Every numeric field on NxgOSwordAssetCatalogue is typed `string`, so "",
    None, "0" and "3" all arrive the same way and all have to be handled here
    rather than at each call site.
    """
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        return fallback
    return value if value > 0 else fallback


def parse_constituents(raw: Optional[str]) -> list[ConstituentSpec]:
    """
    Split an automat's constituentUnits field.

    A missing count means one. A missing max means "exactly min": Automats.xml
    leaves max-occurs off for an unbounded constituent, and generating an
    unbounded number of platoons is not a useful reading of that.
    """
    text = (raw or "").strip()
    if not text:
        return []

    specs: list[ConstituentSpec] = []
    for entry in text.split(CONSTITUENT_SEPARATOR):
        parts = entry.split(OCCURRENCE_SEPARATOR)
        name = parts[0].strip()
        if not name:
            continue
        lo = _positive_int(parts[1] if len(parts) > 1 else "", 1)
        hi = _positive_int(parts[2] if len(parts) > 2 else "", lo)
        specs.append(ConstituentSpec(name=name, min_occurs=lo, max_occurs=hi))
    return specs


def parse_equipment(row: dict) -> Optional[SwordEquipment]:
    """The equipment block on a unit row, or None when it carries none."""
    equipment_type = str(row.get("majorEquipmentType") or "").strip()
    if not equipment_type:
        return None
    return SwordEquipment(
        type=equipment_type,
        count=_positive_int(row.get("majorEquipmentCount"), 1),
        crew_per_item=_positive_int(row.get("requiredCrew"), 1),
    )


def constituent_quantity(spec: ConstituentSpec) -> int:
    """
    How many of a constituent to expect, given its min-occurs and max-occurs.

    The minimum, deliberately. Automats.xml gives a permitted range and the
    bottom of it is the establishment — "1..4 anti-tank sections" means a
    battery has one and may be reinforced to four.
    """
    return max(1, min(spec.min_occurs, spec.max_occurs))


def index_catalogue(rows: Iterable[dict]) -> dict[str, dict]:
    """Catalogue rows keyed by identifier, for resolving constituents by name."""
    return {str(row.get("identifier") or ""): row for row in rows}


def automat_composition(
    catalogue: dict[str, dict],
    automat_identifier: str,
) -> Optional[AutomatComposition]:
    """
    Take an automat apart, or return None when it is not an automat we know.

    None is a normal answer: a partial catalogue, or a "|unit" identifier
    passed in by mistake, should leave the caller's tree alone rather than
    produce an empty expansion.
    """
    row = catalogue.get(automat_identifier)
    if not row or not automat_identifier.endswith(AUTOMAT_SUFFIX):
        return None

    specs = parse_constituents(row.get("constituentUnits"))
    if not specs:
        return None

    command_post = str(row.get("commandPostUnit") or "").strip()
    constituents: list[AutomatConstituent] = []
    unresolved: list[str] = []

    for spec in specs:
        formation = catalogue.get(f"{spec.name}{UNIT_SUFFIX}")
        if formation is None:
            unresolved.append(spec.name)
        constituents.append(
            AutomatConstituent(
                name=spec.name,
                formation=formation,
                is_command_post=spec.name == command_post,
                quantity=constituent_quantity(spec),
                equipment=parse_equipment(formation) if formation else None,
            )
        )

    return AutomatComposition(
        identifier=automat_identifier,
        constituents=constituents,
        unresolved=unresolved,
    )


def describe_equipment(equipment: Optional[SwordEquipment]) -> str:
    """
    A one-line description of what is inside a sub-formation.

    Empty when the unit carries no equipment block — true of 21 of the 163
    unit rows, which are single platforms (a fighter jet, a Zodiac) rather
    than groupings.
    """
    if equipment is None:
        return ""
    crew = f", crew {equipment.crew_per_item}" if equipment.crew_per_item > 1 else ""
    return f"{equipment.count} x {equipment.type}{crew}"
