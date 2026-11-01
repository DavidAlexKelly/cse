"""
Utility functions for ID generation and datetime normalisation.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Optional

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Datetime normalisation (shared by translator.py and sword_translator.py)
# ---------------------------------------------------------------------------


def normalise_datetime(value: Optional[str]) -> Optional[str]:
    """
    Ensure a date/datetime string is a valid ISO 8601 datetime with a T separator.

    Handles two problem cases that .NET's DateTimeOffset parser rejects:
      - Bare dates:            "2026-01-05"              → "2026-01-05T00:00:00Z"
      - Space-separated times: "2026-09-15 06:00:00+00:00" → "2026-09-15T06:00:00+00:00"

    Full T-separated datetimes are returned unchanged.
    """
    if value is None:
        return None
    if "T" in value:
        return value
    if " " in value:
        return value.replace(" ", "T", 1)
    return f"{value}T00:00:00Z"


# ---------------------------------------------------------------------------
# Stable integer ID generation.
#
# VBS4 requires integer IDs (validate.xsd: id is xs:integer). They are derived
# from the unit's primaryKey, so re-exporting the same phase gives the same IDs
# whatever order the units arrive in and however many times the process has
# translated before.
#
# This used to be a first-seen counter kept in module state: the ID a unit got
# depended on the traversal order and on whether reset_ids() had been called,
# so the "stable" ID changed whenever a sibling was added above it.
#
# Range: 1 .. 2**31 - 1. xs:integer is unbounded, but the consumers on the far
# side (VBS4, CSE) read the attribute as a signed 32-bit int, and preflight
# treats only a Python int as valid (ID_NOT_INTEGER), so stay well inside it.
# ---------------------------------------------------------------------------

#: Largest ID handed out (inclusive). IDs are 1-based; 0 is never used.
MAX_STABLE_ID = 2**31 - 1


def get_stable_id(primary_key: str) -> int:
    """
    The hashed integer ID for one primary key, with no collision handling.

    Pure: the same key always gives the same ID, in any process. Use
    assign_stable_ids() when the whole key set is known, which also resolves
    the (rare) case of two keys hashing to the same ID.

    Args:
        primary_key: The ontology object's primaryKey string

    Returns:
        Integer in 1 .. MAX_STABLE_ID
    """
    digest = hashlib.sha256(primary_key.encode()).hexdigest()
    return int(digest[:16], 16) % MAX_STABLE_ID + 1


def assign_stable_ids(primary_keys) -> dict[str, int]:
    """
    Map every primary key to a unique stable integer ID.

    Each key gets its hashed ID (get_stable_id). On a collision the keys are
    taken in sorted order and the later one probes upward (wrapping) to the
    next free ID, so the result depends only on the SET of keys, never on the
    order they were supplied in. Nothing is kept between calls.

    Args:
        primary_keys: Iterable of primaryKey strings (duplicates are ignored)

    Returns:
        primaryKey → ID, with no two keys sharing an ID
    """
    assigned: dict[str, int] = {}
    taken: set[int] = set()
    for key in sorted(set(primary_keys)):
        candidate = get_stable_id(key)
        while candidate in taken:
            log.warning("Stable ID %d collides for %s; probing to the next free ID", candidate, key)
            candidate = candidate % MAX_STABLE_ID + 1
        taken.add(candidate)
        assigned[key] = candidate
    return assigned


def reset_ids() -> None:
    """
    No-op, kept so existing callers keep working.

    IDs no longer depend on module state (see assign_stable_ids), so there is
    nothing to reset between translation runs.
    """


def stable_edge_key(hierarchy_key: str, parent_unit_key: str, child_unit_key: str) -> str:
    """
    Deterministic primary key for a NxgUnitHierachyEdge.

    An edge IS its (hierarchy, parent, child) triple, so its key is derived from
    that triple rather than allocated randomly. This is what makes an ORBAT
    import or reconcile idempotent: writing the same parentage twice updates one
    row instead of adding a second edge for the same relationship, and a
    reconciler can address an edge it wants to remove without having to look up
    whatever random key an earlier run gave it.

    SHA-256, for consistency with generate_scenario_id — MD5 is deliberately
    avoided so security scans stay clean.

    Args:
        hierarchy_key: NxgUnitHierarchy primaryKey the edge belongs to
        parent_unit_key: NxgUnit primaryKey of the parent
        child_unit_key: NxgUnit primaryKey of the child

    Returns:
        Key of the form EDGE-<20 upper-case hex chars>
    """
    digest = hashlib.sha256(
        f"{hierarchy_key}|{parent_unit_key}|{child_unit_key}".encode()
    ).hexdigest()
    return f"EDGE-{digest[:20].upper()}"


def generate_scenario_id(operation_key: str) -> str:
    """
    Generate a deterministic UUID-like scenario ID from an operation key.

    Uses SHA-256 (truncated to 32 hex chars) to produce a stable, non-cryptographic
    identifier. MD5 is intentionally avoided to satisfy security scan requirements.

    Args:
        operation_key: The operation's primaryKey string

    Returns:
        UUID-formatted string
    """
    digest = hashlib.sha256(operation_key.encode()).hexdigest()
    return f"{digest[:8]}-{digest[8:12]}-4{digest[13:16]}-8{digest[17:20]}-{digest[20:32]}"
