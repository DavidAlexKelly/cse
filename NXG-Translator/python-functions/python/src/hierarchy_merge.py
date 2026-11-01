"""
Checks on a set of hierarchies that are about to be merged into one ORBAT.

An operation's ORBAT is not one hierarchy. A phase holds a full standing force
made of several — typically one per side — and they are concatenated before
translation, because OntologyStore is hierarchy-blind and simply produces one
root per disconnected tree. That is what lets friendly and enemy come out as
sibling root Organisations in a single document.

Concatenation assumes the hierarchies describe DISJOINT forces. This module
checks that assumption. It is pure, so it can be tested without an ontology.
"""

from __future__ import annotations


def units_in_multiple_hierarchies(
    children_by_hierarchy: dict[str, set[str]],
) -> dict[str, list[str]]:
    """
    Units that are a child in more than one of the given hierarchies.

    A unit with a parent in two merged hierarchies is double-counted: it gets
    two parents, appears beneath both, and is built twice. The result validates
    against the schema and contains more force than anyone asked for — the
    hardest kind of error to notice, and the kind this codebase has shipped
    before.

    Not hypothetical. HIER-BALTIC-SHIELD-OPS shares all 117 of its child units
    with OP-NORDIC-2026-HIERARCHY; it holds the vehicle-to-crew layer over the
    same unit objects while the structure above them lives in the other
    hierarchy, which is why it reports 48 roots, 47 of them vehicles. Those two
    sit on different operations so they are never merged, but the data can look
    like this.

    Args:
        children_by_hierarchy: hierarchy key -> the unit keys that are a CHILD
            in that hierarchy. Child rather than parent: being a child is what
            establishes parentage, and a unit legitimately parents things in
            one hierarchy while being parented in another.

    Returns:
        unit key -> the hierarchies claiming it, sorted for a stable message.
        Empty when the forces are disjoint, which is the expected case: a
        friendly ORBAT and an enemy ORBAT share no units.
    """
    owners: dict[str, list[str]] = {}
    for hierarchy_key, child_keys in children_by_hierarchy.items():
        for child_key in child_keys:
            owners.setdefault(child_key, []).append(hierarchy_key)

    return {
        unit_key: sorted(hierarchy_keys)
        for unit_key, hierarchy_keys in sorted(owners.items())
        if len(hierarchy_keys) > 1
    }
