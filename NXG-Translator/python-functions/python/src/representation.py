"""
representation.py
=================
What a node BECOMES in the federation.

-----------------------------------------------------------------------------
THIS RULE IS MIRRORED IN TYPESCRIPT.
Any change here must be made in the app too:
  [NXG] Mapplications Repo -> src/shared/orbat/representation.ts
The two test files carry the same case table, in the same order, under the
same names, so a diff between them is readable:
  python-functions/python/tests/test_representation.py
  src/shared/orbat/representation.test.ts
-----------------------------------------------------------------------------

Why this concept is needed
--------------------------
``entityType`` says what a node IS militarily — an organisation, a vehicle, a
person. It does not say what the federation will DO with it, and those two have
quietly diverged. Three organisations in the ontology today carry a SWORD
automat code AND have vehicle children::

    Air Defence Battery            AAA.Surface to air battery|automat
      +-- AD Battery CP Vehicle              (vehicle)
      +-- Anti-aircraft Tank Alpha           (vehicle)
      +-- Target Detection Vehicle Alpha     (vehicle)

SWORD spawns "AAA.Surface to air battery" whole — the automat already contains
its command post, its launchers and its radar, stated in Automats.xml as
min-occurs/max-occurs. VBS4 then separately spawns the three vehicles beneath
it. The same battery is in the exercise twice.

Nothing in the model could express that, because there was no word for the
difference between "this node is structure" and "this node is a thing SWORD
instantiates". ``representation`` is that word.

The rule
--------
1. vehicle / human / aircraft            -> entity
2. organisation + SWORD "...|automat"    -> automat
3. organisation + SWORD "...|unit"       -> subformation
4. organisation, anything else           -> aggregate

Rule 1 comes first deliberately: a vehicle with no model chosen yet is an
INCOMPLETE entity, not a structure. orbat_preflight already reports that
(NO_SIMULATOR_ASSET), and representation should not disagree with it.

Rule 4 absorbs two cases that look different and behave the same. An
organisation with no code is plain structure. An organisation carrying a
platform code — and three do, e.g. Light Gun Section -> "GBR L118 (ARTILLERY)"
— is ALSO plain structure, because an ``<Organisation>`` in the CSE schema may
only carry an OrganisationExtension, and the only one defined is
``<sword:Sword>``. builders.build_organisation emits nothing else, so a
SimWorks className on an organisation is silently dropped at export. Calling
that node an entity would claim a platform gets spawned for it, and none does.

Derived, not stored — for now
-----------------------------
This is a pure function of two properties that already exist on NxgUnit
(``entity_type`` and ``simulator_identifier_code``), so there is nothing to
migrate and nothing to keep in sync. When it becomes a stored ``representation``
property, this function supplies the default and the backfill.
"""

from __future__ import annotations

from typing import Any, Iterator, Optional

#: How a node is realised in the federation.
#:
#: Ordered coarse -> fine, which is also the order the export projection cares
#: about: an aggregate contributes nothing, an automat contributes one SWORD
#: unit, an entity contributes one platform.
AGGREGATE = "aggregate"
AUTOMAT = "automat"
SUBFORMATION = "subformation"
ENTITY = "entity"

REPRESENTATIONS = (AGGREGATE, AUTOMAT, SUBFORMATION, ENTITY)

#: Suffix on a SWORD catalogue identifier for an aggregate SWORD spawns whole.
AUTOMAT_SUFFIX = "|automat"

#: Suffix on a SWORD catalogue identifier for an automat's internal composition.
#:
#: "unit" is SWORD's Pion: the platoons, sections and command posts an automat
#: is made of. 163 of the 244 catalogue rows are these. They are offered in the
#: app's asset picker, so a planner can pick one, which is why `subformation`
#: is a real case and not a hypothetical one.
UNIT_SUFFIX = "|unit"

#: The entity types that are physical things rather than structure.
PHYSICAL_ENTITY_TYPES = frozenset({"vehicle", "human", "aircraft"})

#: Short label for messages.
REPRESENTATION_LABELS = {
    AGGREGATE: "Structure",
    AUTOMAT: "SWORD automat",
    SUBFORMATION: "SWORD sub-formation",
    ENTITY: "Simulated entity",
}


def representation_of(entity_type: Optional[str], simulator_identifier_code: Optional[str]) -> str:
    """What this node becomes in the federation. See the rule in the module docstring."""
    if (entity_type or "") in PHYSICAL_ENTITY_TYPES:
        return ENTITY

    code = (simulator_identifier_code or "").strip()
    if code.endswith(AUTOMAT_SUFFIX):
        return AUTOMAT
    if code.endswith(UNIT_SUFFIX):
        return SUBFORMATION
    return AGGREGATE


def is_self_contained(representation: str) -> bool:
    """
    True when nothing below this node should exist: the node already contains it.

    An automat is a single aggregate that SWORD instantiates complete with its
    own sub-units and their equipment. A sub-formation is one slice of such an
    aggregate — SWORD builds its equipment from the catalogue, not from our
    tree. In both cases anything we put underneath is a second copy of the same
    force.
    """
    return representation in (AUTOMAT, SUBFORMATION)


def representation_of_unit(unit: Any) -> str:
    """Representation of an ontology Unit dataclass (src.ontology_store.Unit)."""
    return representation_of(
        getattr(unit, "entity_type", None),
        getattr(unit, "simulator_identifier_code", None),
    )


# ---------------------------------------------------------------------------
# Unified-ORBAT nodes
# ---------------------------------------------------------------------------
#
# The dict the translator passes around is one step further on than the
# ontology: builders.py has already turned each Unit into a node keyed by
# "$type" with the simulator blocks attached. The raw
# simulator_identifier_code does not survive that step — SwordConfig keeps the
# display name, because that is what the XML needs — so build_organisation
# stamps the derived representation onto the node under REPRESENTATION_FIELD
# and this module reads it back.
#
# The field is internal: xml_translator only reads the keys it knows about, so
# an extra one never reaches the document.

#: Key under which builders.py records the derived representation on a node.
REPRESENTATION_FIELD = "representation"


def node_representation(node: dict) -> str:
    """
    Representation of a unified-ORBAT node.

    Prefers the value stamped on by the builders, which had the ontology Unit
    in hand. Falls back to deriving it from "$type" — correct for every
    physical node, and the honest answer for an organisation whose provenance
    has been lost (an imported ORBAT, say): with no catalogue code to read, it
    is structure as far as anything here can tell.
    """
    stamped = node.get(REPRESENTATION_FIELD)
    if stamped in REPRESENTATIONS:
        return stamped
    return representation_of(node.get("$type", "organisation"), None)


def walk_with_self_contained_ancestor(
    node: dict,
    ancestor: Optional[dict] = None,
) -> Iterator[tuple[dict, Optional[dict]]]:
    """
    Yield ``(node, nearest self-contained ancestor or None)`` over a subtree.

    Stops descending at an entity: an entity's children are its crew, and crew
    move with their platform rather than being spawned separately.
    """
    representation = node_representation(node)
    yield node, ancestor

    if representation == ENTITY:
        return

    next_ancestor = ancestor if ancestor is not None else (node if is_self_contained(representation) else None)
    for child in node.get("children", []) or []:
        yield from walk_with_self_contained_ancestor(child, next_ancestor)


def double_counted_message(node: dict, ancestor: dict) -> str:
    """Why this node is a problem, phrased so a planner can act on it."""
    name = node.get("name") or "(unnamed unit)"
    ancestor_name = ancestor.get("name") or "(unnamed unit)"
    kind = REPRESENTATION_LABELS[node_representation(ancestor)]
    return (
        f'"{name}" sits beneath "{ancestor_name}", which is a {kind} — SWORD spawns that whole, '
        f"already containing its sub-units and their equipment. Anything beneath it puts the same "
        f'force in the exercise twice. Either remove "{name}", or clear the SWORD asset on '
        f'"{ancestor_name}" so it becomes plain structure.'
    )
