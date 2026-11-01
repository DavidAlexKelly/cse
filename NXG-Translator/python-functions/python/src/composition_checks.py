"""
composition_checks.py
=====================
Will this ORBAT run in THIS composition?

orbat_preflight answers "is this ORBAT complete?" — every unit has a model, an
id, a DIS code. That question has no second document in it. This one does: the
same ORBAT is fine for one federation and impossible in another, because the
composition decides which simulators exist, how many units the exercise can
carry and what echelon span it is built for.

Three ways an ORBAT and a composition can disagree, all of them silent today:

  SERVICE_MISSING        a unit needs a simulator the composition does not run.
                         The unit simply never appears — no error anywhere,
                         because the XML is perfectly valid and the simulator
                         that would have spawned it is not there to complain.

  ECHELON_OUT_OF_RANGE   a formation sits outside MinLevel..MaxLevel. A
                         composition scoped Platoon..Battalion is not wired for
                         a division, and a brigade in it is a statement that
                         somebody has misjudged the exercise.

  UNIT_COUNT_OUT_OF_RANGE  the force is outside Scale MinUnits..MaxUnits.

Counting, and why representation matters here
---------------------------------------------
"Units" is not rows in the ontology. An automat is ONE thing to SWORD however
many platoons it contains, and an aggregate is nothing at all — no simulator
spawns a brigade. count_simulated_units uses the representation vocabulary to
count what is actually instantiated, which is the number Scale is about.
"""

from __future__ import annotations

from typing import Iterator, Optional

from src.composition import (
    CompositionSpec,
    count_simulated_units,
    echelon_glyph_of,
    simulator_needed_by,
)
from src.orbat_preflight import Issue

#: Glyph -> a name to put in a message. Only the ones a composition is likely
#: to mention; anything else is reported by its glyph, which is still useful.
_GLYPH_NAME = {
    "A": "team",
    "B": "squad",
    "C": "section",
    "D": "platoon",
    "E": "company",
    "F": "battalion",
    "G": "regiment",
    "H": "brigade",
    "I": "division",
    "J": "corps",
    "K": "army",
    "L": "army group",
    "M": "region",
}


def _walk(orbat: dict) -> Iterator[dict]:
    def descend(node: dict) -> Iterator[dict]:
        yield node
        for child in node.get("children", []) or []:
            yield from descend(child)

    for root in orbat.get("entities", []) or []:
        yield from descend(root)


def _glyph_name(glyph: Optional[str]) -> str:
    if glyph is None:
        return "unknown echelon"
    return _GLYPH_NAME.get(glyph, f"echelon {glyph}")


def check_services(orbat: dict, spec: CompositionSpec) -> list[Issue]:
    """
    Every unit needs a simulator the composition actually runs.

    Skipped entirely when the composition declares no simulators — that means
    we could not read them, not that the federation is empty, and inventing
    an error for every unit would be worse than saying nothing.
    """
    if not spec.simulators:
        return []

    issues: list[Issue] = []
    for node in _walk(orbat):
        needed = simulator_needed_by(node)
        if needed is None or needed in spec.simulators:
            continue
        name = node.get("name", "")
        issues.append(
            Issue(
                "ERROR",
                "SERVICE_MISSING",
                f'"{name}" needs {needed}, which this composition does not run '
                f"({', '.join(sorted(spec.simulators)) or 'no simulators'}). It will not "
                f"appear in the exercise, and nothing will say so — the document is valid "
                f"and the simulator that would have spawned it is not there to object.",
                node.get("id"),
                name,
            )
        )
    return issues


def check_echelon_span(orbat: dict, spec: CompositionSpec) -> list[Issue]:
    """
    Every formation should sit inside MinLevel..MaxLevel.

    WARNING rather than ERROR. The composition states what it is BUILT for,
    not what it refuses; a brigade headquarters in a battalion-scale exercise
    is usually a deliberate bit of higher control, and blocking it would be
    presumptuous. Out-of-range at the bottom is likewise common — crew inside
    a vehicle are below any stated level.
    """
    low, high = spec.level_range()
    if low is None and high is None:
        return []

    issues: list[Issue] = []
    for node in _walk(orbat):
        # Only things the exercise instantiates. A structural node's echelon
        # is bookkeeping; nothing is spawned for it.
        if simulator_needed_by(node) is None:
            continue
        glyph = echelon_glyph_of(node)
        if glyph is None:
            continue

        name = node.get("name", "")
        if high is not None and glyph > high:
            issues.append(
                Issue(
                    "WARNING",
                    "ECHELON_OUT_OF_RANGE",
                    f'"{name}" is a {_glyph_name(glyph)}, above the {spec.max_level.lower()} '
                    f"this composition is built for. It will run, but the federation is not "
                    f"scaled for a formation that size.",
                    node.get("id"),
                    name,
                )
            )
        elif low is not None and glyph < low:
            issues.append(
                Issue(
                    "WARNING",
                    "ECHELON_OUT_OF_RANGE",
                    f'"{name}" is a {_glyph_name(glyph)}, below the {spec.min_level.lower()} '
                    f"this composition is built for.",
                    node.get("id"),
                    name,
                )
            )
    return issues


def check_unit_count(orbat: dict, spec: CompositionSpec) -> list[Issue]:
    """
    The force has to fit inside Scale MinUnits..MaxUnits.

    Over the maximum is an ERROR: the composition is a statement about
    capacity, and exceeding it is how an exercise falls over mid-run rather
    than failing to start. Under the minimum is a WARNING — a small force in a
    large federation wastes resources but works.
    """
    if spec.min_units is None and spec.max_units is None:
        return []

    total = count_simulated_units(orbat)
    issues: list[Issue] = []

    if spec.max_units is not None and total > spec.max_units:
        issues.append(
            Issue(
                "ERROR",
                "UNIT_COUNT_OUT_OF_RANGE",
                f"This ORBAT puts {total} units in the exercise; the composition carries at "
                f"most {spec.max_units}. Counted as the simulators see it: an automat is one "
                f"unit however many platoons it holds, and structural formations are none.",
            )
        )
    elif spec.min_units is not None and total < spec.min_units:
        issues.append(
            Issue(
                "WARNING",
                "UNIT_COUNT_OUT_OF_RANGE",
                f"This ORBAT puts {total} units in the exercise; the composition is built for "
                f"at least {spec.min_units}. It will run, under-populated.",
            )
        )
    return issues


def check_orbat_against_composition(orbat: dict, spec: CompositionSpec) -> list[Issue]:
    """Every composition check, ERRORs first."""
    issues = [
        *check_services(orbat, spec),
        *check_echelon_span(orbat, spec),
        *check_unit_count(orbat, spec),
    ]
    issues.sort(key=lambda i: 0 if i["severity"] == "ERROR" else 1)
    return issues
