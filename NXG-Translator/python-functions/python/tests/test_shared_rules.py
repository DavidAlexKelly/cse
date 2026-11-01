"""
Shared rule cases (tests/shared/rules_fixture.json), run against the Python
implementations. The same file is run by the TypeScript suite in
NXG-Mapplications (src/shared/orbat/sharedRules.test.ts), so the two cannot
drift without a test failing on one side.
"""

import json
from pathlib import Path

import pytest

from src import config_store, orbat_preflight
from src.simulator_targets import normalise_owning_simulator
from src.sword_composition import parse_constituents

FIXTURE_PATH = Path(__file__).parent / "shared" / "rules_fixture.json"
FIXTURE = json.loads(FIXTURE_PATH.read_text())
VENDORED = (
    Path(__file__).resolve().parents[4]
    / "NXG-Mapplications-Repo" / "src" / "shared" / "orbat" / "__fixtures__" / "rules.json"
)


def test_placeholder_dis_is_the_one_value_everywhere():
    assert orbat_preflight.PLACEHOLDER_DIS == FIXTURE["placeholderDis"]
    assert config_store._PLACEHOLDER_DIS == FIXTURE["placeholderDis"]


@pytest.mark.parametrize("case", FIXTURE["constituents"], ids=lambda c: c["name"])
def test_constituent_parsing(case):
    got = [
        {"name": s.name, "min": s.min_occurs, "max": s.max_occurs}
        for s in parse_constituents(case["raw"])
    ]
    assert got == case["expected"]


@pytest.mark.parametrize("case", FIXTURE["simulatorNames"], ids=lambda c: repr(c["raw"]))
def test_simulator_names(case):
    assert normalise_owning_simulator(case["raw"]) == case["expected"]


@pytest.mark.skipif(not VENDORED.exists(), reason="Mapplications not checked out alongside")
def test_mapplications_vendors_the_same_table():
    assert json.loads(VENDORED.read_text()) == FIXTURE, (
        "Mapplications' copy of rules_fixture.json differs — copy this file to "
        f"{VENDORED}"
    )
