"""
Merging hierarchies assumes they describe disjoint forces. Check that we notice
when they don't.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.hierarchy_merge import units_in_multiple_hierarchies  # noqa: E402


def test_disjoint_forces_report_nothing():
    """The expected case: a friendly ORBAT and an enemy ORBAT share no units."""
    assert (
        units_in_multiple_hierarchies(
            {
                "OP-NEXGEN-2026-FRIENDLY": {"UNIT-BG-A", "UNIT-BG-B"},
                "OP-NEXGEN-2026-ENEMY": {"UNIT-MR-A", "UNIT-MR-B"},
            }
        )
        == {}
    )


def test_a_shared_unit_is_reported_with_both_owners():
    """
    The double-counting case. Concatenated edges give this unit two parents, so
    it is built twice and the ORBAT silently contains more force than asked for.
    """
    assert units_in_multiple_hierarchies(
        {
            "HIER-PHASE-1-FRIENDLY": {"UNIT-A", "UNIT-SHARED"},
            "HIER-PHASE-1-ENEMY": {"UNIT-B", "UNIT-SHARED"},
        }
    ) == {"UNIT-SHARED": ["HIER-PHASE-1-ENEMY", "HIER-PHASE-1-FRIENDLY"]}


def test_owners_are_sorted_so_the_message_is_stable():
    """Dict iteration order must not leak into an operator-facing log line."""
    forwards = units_in_multiple_hierarchies(
        {"AAA": {"UNIT-SHARED"}, "ZZZ": {"UNIT-SHARED"}}
    )
    backwards = units_in_multiple_hierarchies(
        {"ZZZ": {"UNIT-SHARED"}, "AAA": {"UNIT-SHARED"}}
    )
    assert forwards == backwards == {"UNIT-SHARED": ["AAA", "ZZZ"]}


def test_three_way_sharing_reports_all_three():
    assert units_in_multiple_hierarchies(
        {"H1": {"U"}, "H2": {"U"}, "H3": {"U"}}
    ) == {"U": ["H1", "H2", "H3"]}


def test_single_hierarchy_can_never_double_count():
    """
    An operation with one ORBAT is the common case and must stay silent, however
    many units it holds.
    """
    assert units_in_multiple_hierarchies({"OP-NORDIC-2026-HIERARCHY": {f"U{i}" for i in range(500)}}) == {}


def test_no_hierarchies_is_not_an_error():
    assert units_in_multiple_hierarchies({}) == {}


def test_the_baltic_shape():
    """
    The real data that motivated this check: every child unit of one hierarchy
    also a child of another. All of them must be reported, not just the first.
    """
    shared = {f"UNIT-SEC{i}-VEH-A" for i in range(1, 13)}
    result = units_in_multiple_hierarchies(
        {
            "HIER-BALTIC-SHIELD-OPS": shared,
            "OP-NORDIC-2026-HIERARCHY": shared | {"UNIT-1PWRR-BTL"},
        }
    )
    assert set(result) == shared
    assert "UNIT-1PWRR-BTL" not in result
    for owners in result.values():
        assert owners == ["HIER-BALTIC-SHIELD-OPS", "OP-NORDIC-2026-HIERARCHY"]


if __name__ == "__main__":
    for name, fn in sorted(list(globals().items())):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
    print("\nAll hierarchy-merge tests passed.")
