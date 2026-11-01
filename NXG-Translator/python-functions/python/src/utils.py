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
# VBS4 requires integer IDs. We derive them deterministically from the
# unit's primaryKey so the same key always produces the same ID across
# multiple translation runs.
#
# NOTE: This module-level state is NOT thread-safe. Each Foundry Function
# invocation runs in its own process, so concurrent corruption is not a
# concern in practice. Call reset_ids() at the start of every translation
# to ensure a clean slate.
# ---------------------------------------------------------------------------

_id_registry: dict[str, int] = {}
_id_counter: list[int] = [1]  # mutable container so nested functions can increment


def get_stable_id(primary_key: str) -> int:
    """
    Return a stable integer ID for a given primary key string.

    IDs are assigned in first-seen order and cached for the lifetime
    of the process. Call reset_ids() between test runs.

    Args:
        primary_key: The ontology object's primaryKey string

    Returns:
        Integer ID, consistent across calls with the same primary_key
    """
    if primary_key not in _id_registry:
        _id_registry[primary_key] = _id_counter[0]
        _id_counter[0] += 1
    return _id_registry[primary_key]


def reset_ids() -> None:
    """Reset the ID registry — call between translation runs."""
    _id_registry.clear()
    _id_counter[0] = 1


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
