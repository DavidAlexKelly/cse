"""
Tests for src.composition and src.composition_checks.

COMPOSITION_XML below is the real document from the CSE-Prep repo
(python_functions/comp.xml), trimmed of the Systems block but keeping the part
that makes parsing awkward: an internal DOCTYPE subset declaring the services
as external entities, and a Services block that references them.
"""

from src.composition import (
    count_simulated_units,
    declared_service_names,
    echelon_glyph_of,
    parse_composition,
    simulator_needed_by,
    strip_doctype_and_entities,
)
from src.composition_checks import (
    check_echelon_span,
    check_orbat_against_composition,
    check_services,
    check_unit_count,
)
from src.representation import AGGREGATE, AUTOMAT, ENTITY, REPRESENTATION_FIELD, SUBFORMATION

COMPOSITION_XML = """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE Composition [

    <!ENTITY simulation-os SYSTEM "_Content/.ntfa/service/onearc/service-simulation-os.xml" >
    <!ENTITY sword SYSTEM "_Content/.ntfa/service/masa/service-sword-simple.xml">
    <!ENTITY simworks SYSTEM "_Content/.ntfa/service/plexsys/service-simworks.xml">
    <!ENTITY vbs4 SYSTEM "_Content/.ntfa/service/onearc/service-vbs4.xml">
    <!ENTITY mediation SYSTEM "_Content/.ntfa/service/accenture/service-mediation.xml">
    ]>
<Composition
    xmlns="https://accenture.com/2026-03/cse/composition"
    Name="Mission-level Physical Computer Assisted Wargaming (CAW) - OpenShift+Proxmox in FI">
    <Description>TODO</Description>
    <Capabilities>
        <Type>Wargaming</Type>
        <Scale MinUnits="100" MaxUnits="1000" />
        <Level MinLevel="Platoon" MaxLevel="Battalion" />
        <Resolution Time="Seconds|Minutes" Space="Meters" />
    </Capabilities>
    <Services>
        &simulation-os;
        &sword;
        &simworks;
        &vbs4;
        &mediation;
    </Services>
</Composition>
"""

#: A composition with no SWORD — the case that makes a SWORD force vanish.
VBS4_ONLY_XML = """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE Composition [
    <!ENTITY vbs4 SYSTEM "_Content/.ntfa/service/onearc/service-vbs4.xml">
    ]>
<Composition xmlns="https://accenture.com/2026-03/cse/composition" Name="VBS4 only">
    <Capabilities>
        <Scale MinUnits="2" MaxUnits="4" />
        <Level MinLevel="Section" MaxLevel="Company" />
    </Capabilities>
    <Services>&vbs4;</Services>
</Composition>
"""


# ---------------------------------------------------------------------------
# Parsing, and not resolving anything
# ---------------------------------------------------------------------------


def test_reads_the_services_from_the_entity_declarations():
    assert declared_service_names(COMPOSITION_XML) == [
        "simulation-os",
        "sword",
        "simworks",
        "vbs4",
        "mediation",
    ]


def test_separates_simulators_from_infrastructure():
    spec = parse_composition(COMPOSITION_XML)
    assert spec.simulators == {"sword", "simworks", "vbs4"}
    assert "mediation" in spec.services and "mediation" not in spec.simulators
    assert "simulation-os" in spec.services and "simulation-os" not in spec.simulators


def test_strips_the_doctype_and_every_entity_reference():
    stripped = strip_doctype_and_entities(COMPOSITION_XML)
    assert "<!DOCTYPE" not in stripped
    assert "<!ENTITY" not in stripped
    assert "&sword;" not in stripped
    # No SYSTEM identifier survives to be dereferenced by anything downstream.
    assert "SYSTEM" not in stripped
    assert "_Content/.ntfa" not in stripped


def test_leaves_the_builtin_entities_alone():
    # Stripping must not eat legitimate content.
    assert strip_doctype_and_entities("<a>Fix &amp; Hold</a>") == "<a>Fix &amp; Hold</a>"


def test_reads_scale_and_level_through_the_namespace():
    spec = parse_composition(COMPOSITION_XML)
    assert (spec.min_units, spec.max_units) == (100, 1000)
    assert (spec.min_level, spec.max_level) == ("Platoon", "Battalion")
    assert spec.level_range() == ("D", "F")
    assert spec.name.startswith("Mission-level Physical")


def test_a_composition_that_states_nothing_constrains_nothing():
    spec = parse_composition("<Composition/>")
    assert spec.simulators == set()
    assert spec.min_units is None and spec.max_units is None
    assert spec.level_range() == (None, None)


def test_keeps_the_service_list_even_when_the_body_will_not_parse():
    broken = COMPOSITION_XML.replace("</Composition>", "")
    spec = parse_composition(broken)
    assert spec.simulators == {"sword", "simworks", "vbs4"}


# ---------------------------------------------------------------------------
# Reading a node
# ---------------------------------------------------------------------------


def org(name, representation, node_id, sidc="SFGPUCII---E---", children=None, **extra):
    node = {
        "$type": "organisation",
        "id": node_id,
        "name": name,
        "sidc": sidc,
        REPRESENTATION_FIELD: representation,
        "children": children or [],
    }
    node.update(extra)
    return node


#: Note the glyph position: a 15-character APP-6D SIDC carries the echelon at
#: index 11, so "SFGPUCAI---E---" is a company. Getting this wrong is easy —
#: "SFGPUCA---E----" is also 15 characters but puts E at index 10, and reads
#: as no echelon at all.
def veh(name, node_id, simulator="vbs4", sidc="SFGPUCAI---E---"):
    return {
        "$type": "vehicle",
        "id": node_id,
        "name": name,
        "sidc": sidc,
        "owningSimulator": simulator,
        "dis": "1.1.224.1.1.0",
        "vbs4": {"className": "x"},
        "children": [],
    }


def test_echelon_glyph_comes_off_the_sidc():
    assert echelon_glyph_of({"sidc": "SFGPUCII---E---"}) == "E"
    assert echelon_glyph_of({"sidc": "SFGPUCII---H---"}) == "H"
    assert echelon_glyph_of({"sidc": "short"}) is None
    assert echelon_glyph_of({"sidc": "SFGPUCII---?---"}) is None


def test_which_simulator_each_representation_needs():
    assert simulator_needed_by(org("Bde", AGGREGATE, 1)) is None
    assert simulator_needed_by(org("Bty", AUTOMAT, 2)) == "sword"
    assert simulator_needed_by(org("Pl", SUBFORMATION, 3)) == "sword"
    assert simulator_needed_by(veh("Tank", 4)) == "vbs4"
    assert simulator_needed_by(veh("Tank", 5, simulator="Simworks")) == "simworks"
    assert simulator_needed_by(veh("Tank", 6, simulator="none")) is None


def test_counting_is_what_the_simulators_see_not_rows():
    # A brigade holding an automat and two vehicles is 3 simulated units: the
    # brigade is structure and the automat is one thing to SWORD however many
    # platoons it contains.
    orbat = {
        "entities": [
            org("1 Bde", AGGREGATE, 1, children=[
                org("A Bty", AUTOMAT, 2),
                veh("Tank 1", 3),
                veh("Tank 2", 4),
            ])
        ]
    }
    assert count_simulated_units(orbat) == 3


# ---------------------------------------------------------------------------
# The checks
# ---------------------------------------------------------------------------


SWORD_FORCE = {
    "entities": [
        org("1 Bde", AGGREGATE, 1, sidc="SFGPUCII---H---", children=[
            org("A Bty", AUTOMAT, 2, sidc="SFGPUCII---E---"),
            veh("Tank 1", 3),
        ])
    ]
}


def test_a_sword_force_in_a_vbs4_only_composition_is_reported():
    spec = parse_composition(VBS4_ONLY_XML)
    issues = check_services(SWORD_FORCE, spec)
    assert [i["entityName"] for i in issues] == ["A Bty"]
    assert issues[0]["code"] == "SERVICE_MISSING"
    assert issues[0]["severity"] == "ERROR"
    assert "sword" in issues[0]["message"]


def test_nothing_is_reported_when_every_simulator_is_present():
    spec = parse_composition(COMPOSITION_XML)
    assert check_services(SWORD_FORCE, spec) == []


def test_services_are_not_checked_when_none_could_be_read():
    # Could not read them is not the same as the federation being empty.
    assert check_services(SWORD_FORCE, parse_composition("<Composition/>")) == []


def test_a_formation_above_the_composition_level_warns():
    spec = parse_composition(VBS4_ONLY_XML)  # Section..Company
    battalion = {"entities": [org("1 Bn", AGGREGATE, 1, children=[veh("Tank", 2, sidc="SFGPUCAI---F---")])]}
    issues = check_echelon_span(battalion, spec)
    assert len(issues) == 1
    assert issues[0]["code"] == "ECHELON_OUT_OF_RANGE"
    assert issues[0]["severity"] == "WARNING"
    assert "battalion" in issues[0]["message"]


def test_structural_nodes_are_not_echelon_checked():
    # The brigade is above Company but nothing is spawned for it.
    spec = parse_composition(VBS4_ONLY_XML)
    brigade_only = {"entities": [org("1 Bde", AGGREGATE, 1, sidc="SFGPUCII---H---")]}
    assert check_echelon_span(brigade_only, spec) == []


def test_over_the_maximum_is_an_error_and_under_the_minimum_a_warning():
    spec = parse_composition(VBS4_ONLY_XML)  # 2..4
    too_many = {"entities": [org("1 Bde", AGGREGATE, 1, children=[veh(f"T{i}", i + 10) for i in range(5)])]}
    over = check_unit_count(too_many, spec)
    assert over[0]["code"] == "UNIT_COUNT_OUT_OF_RANGE" and over[0]["severity"] == "ERROR"
    assert "5 units" in over[0]["message"]

    too_few = {"entities": [org("1 Bde", AGGREGATE, 1, children=[veh("T1", 10)])]}
    under = check_unit_count(too_few, spec)
    assert under[0]["severity"] == "WARNING"


def test_a_force_inside_the_scale_says_nothing():
    spec = parse_composition(VBS4_ONLY_XML)
    assert check_unit_count(SWORD_FORCE, spec) == []


def test_everything_together_puts_errors_first():
    spec = parse_composition(VBS4_ONLY_XML)
    issues = check_orbat_against_composition(SWORD_FORCE, spec)
    severities = [i["severity"] for i in issues]
    assert severities == sorted(severities, key=lambda s: 0 if s == "ERROR" else 1)
    assert any(i["code"] == "SERVICE_MISSING" for i in issues)
