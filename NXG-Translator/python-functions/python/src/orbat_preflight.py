"""
orbat_preflight.py
==================
Checks an ORBAT before it is turned into XML and sent to CSE.

This exists because schema validity and usefulness are different things, and
the XSD only knows about the first. A vehicle with no simulator asset at all
serialises to:

    <Vehicle id="2" name="Tank" owningSimulator="vbs4" …>
      <Location …/><Behavior/><ControlledDroneIds/>
    </Vehicle>

which passes validate.xsd cleanly — UnitExtension is minOccurs="0" — and then
spawns nothing, because no simulator was ever told what model to use. The same
is true of a <vbs4:Vbs4 className=""/>: className is a required attribute, but
an empty string satisfies xs:string.

So validation alone cannot answer "will this ORBAT actually run?". These checks
can. They are deliberately separate from xml_validator: that one answers "is
this document well-formed against the schema", this one answers "is this ORBAT
complete enough to be worth sending".

Severities
----------
ERROR    the ORBAT will be rejected by the validator, or will be accepted and
         then fail to produce anything in the simulator.
WARNING  it will load, but something is missing that someone probably meant to
         set.
"""

from __future__ import annotations

from typing import Any, Iterator, Optional

from src.representation import (
    ENTITY,
    double_counted_message,
    node_representation,
    walk_with_self_contained_ancestor,
)
from src.simulator_targets import (
    UNIT_EXTENSION_SIMULATORS,
    VALID_OWNING_SIMULATORS,
    normalise_owning_simulator,
)

UNIT_TYPES = ("human", "vehicle", "aircraft")

#: dis value planComposition writes when nothing better is known.
PLACEHOLDER_DIS = "0.0.0.0.0.0.0"


class Issue(dict):
    """A single finding. A dict subclass so it serialises straight to JSON."""

    def __init__(
        self,
        severity: str,
        code: str,
        message: str,
        entity_id: Any = None,
        entity_name: str = "",
    ) -> None:
        super().__init__(
            severity=severity,
            code=code,
            message=message,
            entityId=entity_id,
            entityName=entity_name,
        )


def _walk(node: dict, parent_type: Optional[str] = None) -> Iterator[tuple[dict, Optional[str]]]:
    yield node, parent_type
    for child in node.get("children", []) or []:
        yield from _walk(child, node.get("$type", "organisation"))


def _check_unit(node: dict) -> list[Issue]:
    issues: list[Issue] = []
    entity_id = node.get("id")
    name = node.get("name", "")

    # ── owningSimulator must be one the schema knows ───────────────────────
    raw_sim = node.get("owningSimulator", "")
    sim = normalise_owning_simulator(raw_sim)
    if sim is None:
        issues.append(
            Issue(
                "ERROR",
                "OWNING_SIMULATOR_INVALID",
                f'"{name}" has owningSimulator "{raw_sim or "(empty)"}", which the schema does not '
                f"accept. Allowed: {', '.join(VALID_OWNING_SIMULATORS)}. A unit that is not "
                f"federated to a simulator cannot be exported — either assign one or leave the "
                f"unit out of the ORBAT.",
                entity_id,
                name,
            )
        )

    # ── exactly one usable extension ───────────────────────────────────────
    present = [n for n in UNIT_EXTENSION_SIMULATORS if n in node]
    if not present:
        issues.append(
            Issue(
                "ERROR",
                "NO_SIMULATOR_ASSET",
                f'"{name}" has no VBS4 or SimWorks asset, so nothing will be spawned for it. '
                f"The XML is still schema-valid, which is why this check exists.",
                entity_id,
                name,
            )
        )
    else:
        chosen = sim if sim in present else present[0]
        class_name = (node.get(chosen) or {}).get("className", "")
        if not str(class_name).strip():
            issues.append(
                Issue(
                    "ERROR",
                    "EMPTY_CLASS_NAME",
                    f'"{name}" has a {chosen} block with an empty className. The simulator has '
                    f"nothing to instantiate; the schema accepts it because className is only "
                    f"required to be a string.",
                    entity_id,
                    name,
                )
            )
        if len(present) > 1:
            issues.append(
                Issue(
                    "WARNING",
                    "EXTRA_SIMULATOR_BLOCK",
                    f'"{name}" carries both {" and ".join(present)} blocks. The schema allows one '
                    f'extension per unit, so "{chosen}" will be emitted and the other dropped.',
                    entity_id,
                    name,
                )
            )
        if sim is not None and sim in UNIT_EXTENSION_SIMULATORS and sim not in present:
            issues.append(
                Issue(
                    "WARNING",
                    "ASSET_SIMULATOR_MISMATCH",
                    f'"{name}" is owned by {sim} but only has a {present[0]} asset, so it will be '
                    f"exported with {present[0]}'s model.",
                    entity_id,
                    name,
                )
            )

    # ── position ───────────────────────────────────────────────────────────
    # The XML still writes 0,0 for a unit with no position (Location is
    # required), so a missing position is invisible in the document. The
    # builders flag it explicitly; 0,0 itself is not taken as "missing".
    if node.get("positionMissing"):
        issues.append(
            Issue(
                "ERROR",
                "POSITION_MISSING",
                f'"{name}" has no latitude/longitude. It is exported at 0,0 because the schema '
                f"requires a Location, so it would spawn in the wrong place. Place the unit on the map.",
                entity_id,
                name,
            )
        )

    # ── dis ────────────────────────────────────────────────────────────────
    dis = str(node.get("dis", "") or "")
    if not dis:
        issues.append(
            Issue("ERROR", "DIS_MISSING", f'"{name}" has no dis value; the attribute is required.', entity_id, name)
        )
    elif dis == PLACEHOLDER_DIS:
        issues.append(
            Issue(
                "WARNING",
                "DIS_PLACEHOLDER",
                f'"{name}" still has the placeholder dis "{PLACEHOLDER_DIS}". The canonical asset '
                f"key IS the DIS code, so this can be filled in from the asset.",
                entity_id,
                name,
            )
        )

    return issues


def _check_organisation(node: dict, is_root: bool) -> list[Issue]:
    issues: list[Issue] = []
    entity_id = node.get("id")
    name = node.get("name", "")

    # RootOrganisationType permits only <Organisation> children — a placed unit
    # cannot hang directly off the root of the ORBAT.
    if is_root:
        for child in node.get("children", []) or []:
            if child.get("$type", "organisation") in UNIT_TYPES:
                issues.append(
                    Issue(
                        "ERROR",
                        "UNIT_UNDER_ROOT",
                        f'"{child.get("name", "")}" is a {child.get("$type")} directly beneath the root '
                        f'organisation "{name}". The schema only allows organisations there — wrap it '
                        f"in one.",
                        child.get("id"),
                        child.get("name", ""),
                    )
                )

    if "sword" not in node:
        issues.append(
            Issue(
                "WARNING",
                "NO_SWORD_CLASS",
                f'"{name}" has no SWORD block, so SWORD has no automat to instantiate for it. '
                f"Harmless for a VBS4- or SimWorks-only run.",
                entity_id,
                name,
            )
        )
    elif not str((node.get("sword") or {}).get("class", "") or "").strip():
        issues.append(
            Issue(
                "WARNING",
                "EMPTY_SWORD_CLASS",
                f'"{name}" has a SWORD block with no class, so SWORD will fall back to a default.',
                entity_id,
                name,
            )
        )

    return issues


def _check_double_counting(root: dict) -> list[Issue]:
    """
    Every entity that sits beneath a node SWORD spawns whole.

    This is the opposite complaint to everything else in this module. The other
    checks ask "will anything be spawned for this unit?". This one asks "will
    it be spawned twice?", and until now nothing asked it. Three organisations
    in the ontology carry a SWORD automat code and have vehicles beneath them,
    so SWORD instantiates the battery complete while VBS4 separately spawns the
    vehicles inside it — a schema-valid document that fields the same force
    twice.

    The app's generator cannot produce this any more (it stops descending at an
    automat), but two paths still can and both are in daily use: importing an
    ORBAT built elsewhere, and a planner hand-adding a child in the ORBAT
    Manager. So the check belongs on the tree, not in the generator.

    Mirrors findDoubleCountedDescendants in the app's representation.ts.
    """
    issues: list[Issue] = []
    for node, ancestor in walk_with_self_contained_ancestor(root):
        if ancestor is None:
            continue
        if node_representation(node) != ENTITY:
            continue
        issues.append(
            Issue(
                "ERROR",
                "DOUBLE_COUNTED",
                double_counted_message(node, ancestor),
                node.get("id"),
                node.get("name", ""),
            )
        )
    return issues


def preflight_orbat(orbat: dict) -> list[Issue]:
    """
    Check a unified ORBAT dict and return everything worth knowing before export.

    Args:
        orbat: the dict produced by translate_orbat_from_json /
               translate_orbat_from_operation (expects an "entities" list).

    Returns:
        Issues, ERRORs first. An empty list means the ORBAT should both validate
        and actually populate the simulator.
    """
    issues: list[Issue] = []
    entities = orbat.get("entities", []) or []

    # Units that never made it into the tree.
    #
    # Everything else in this module inspects what IS there, which means a
    # unit the translator could not build is invisible to it — the ORBAT comes
    # back well-formed, schema-valid and quietly short of force. Six aircraft
    # were leaving OP-NORDIC-2026 that way on every run, reported nowhere but
    # a log line. The translator now hands the drops over on the ORBAT.
    for dropped in orbat.get("droppedUnits", []) or []:
        name = dropped.get("name") or dropped.get("primaryKey", "")
        issues.append(
            Issue(
                "ERROR",
                "UNIT_DROPPED",
                f'"{name}" could not be built and is not in the ORBAT at all: '
                f'{dropped.get("reason", "no reason recorded")}. The document is still '
                f"valid — it just contains less force than the planner asked for.",
                dropped.get("primaryKey"),
                name,
            )
        )

    if not entities:
        issues.append(Issue("ERROR", "NO_ENTITIES", "The ORBAT has no root organisations."))
        return issues

    seen_ids: dict[Any, str] = {}

    for root in entities:
        if root.get("$type", "organisation") != "organisation":
            issues.append(
                Issue(
                    "ERROR",
                    "ROOT_NOT_ORGANISATION",
                    f'Root entity "{root.get("name", "")}" is a {root.get("$type")}. The ORBAT root '
                    f"must be an organisation.",
                    root.get("id"),
                    root.get("name", ""),
                )
            )

        for node, _parent_type in _walk(root):
            node_type = node.get("$type", "organisation")
            entity_id = node.get("id")
            name = node.get("name", "")

            # id is xs:integer in the schema, and must be unique to be useful.
            if not isinstance(entity_id, int) or isinstance(entity_id, bool):
                issues.append(
                    Issue(
                        "ERROR",
                        "ID_NOT_INTEGER",
                        f'"{name}" has id {entity_id!r}, which is not an integer. Unit primary keys '
                        f"are UUIDs, so they must be mapped through get_stable_id().",
                        entity_id,
                        name,
                    )
                )
            elif entity_id in seen_ids:
                issues.append(
                    Issue(
                        "ERROR",
                        "DUPLICATE_ID",
                        f'"{name}" reuses id {entity_id}, already used by "{seen_ids[entity_id]}".',
                        entity_id,
                        name,
                    )
                )
            else:
                seen_ids[entity_id] = name

            if node_type in UNIT_TYPES:
                issues.extend(_check_unit(node))
            else:
                issues.extend(_check_organisation(node, is_root=node is root))

        issues.extend(_check_double_counting(root))

    issues.sort(key=lambda i: 0 if i["severity"] == "ERROR" else 1)
    return issues


def preflight_summary(issues: list[Issue]) -> str:
    """One-line summary for logs and UI."""
    errors = sum(1 for i in issues if i["severity"] == "ERROR")
    warnings = len(issues) - errors
    if not issues:
        return "ORBAT is complete: no errors, no warnings."
    return f"ORBAT has {errors} error(s) and {warnings} warning(s)."
