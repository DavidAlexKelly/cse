"""
composition.py
==============
What a CSE composition can run, read off the composition document.

A composition is the other half of what gets posted to
cse_run_composition_simple: one composition.xml and one orbat.xml. The
composition says what the federation IS — which simulators are wired up, how
big a force it can carry, what echelon span it is built for::

    <Capabilities>
        <Scale MinUnits="100" MaxUnits="1000" />
        <Level MinLevel="Platoon" MaxLevel="Battalion" />
    </Capabilities>
    <Services>
        &simulation-os; &sword; &simworks; &vbs4; &mediation;
    </Services>

Until now nothing read it, so an ORBAT could be sent to a composition with no
SWORD in it and the first sign of trouble would be an empty battlefield.

Parsing this safely
-------------------
The services are XML ENTITY REFERENCES, declared in an internal DOCTYPE subset
that points at files on the CSE host::

    <!ENTITY sword SYSTEM "_Content/.ntfa/service/masa/service-sword-simple.xml">

Two consequences, and both matter.

  1. We must not resolve them. Following a SYSTEM identifier out of a document
     someone handed us is the XXE pattern — it reads local files, and with a
     URL it reaches the network. There is nothing in those files we need.

  2. A parser that does not resolve them still has to cope. ElementTree does
     not resolve external entities (good), and then fails the whole document
     with "undefined entity" the moment it reaches &sword; (inconvenient).

So the DOCTYPE is read as TEXT, for the entity NAMES only — which is exactly
the list of services, since each service is declared as one entity — and then
the DOCTYPE and every entity reference are stripped before the remainder goes
anywhere near an XML parser. No SYSTEM identifier is ever dereferenced.

Parsing itself goes through defusedxml rather than xml.etree. Stripping the
DOCTYPE already removes the entity-expansion attacks the standard library is
vulnerable to — billion laughs needs a DTD — but the composition is a document
we are handed, the stripping is regex-based, and a second line of defence that
costs one import is worth having. defusedxml is already a declared dependency.

The <Systems> block names some simulators a second time, as Applications with
Symbol="SWORD" / "VBS4". That is corroboration, not the source: SimWorks
appears in Services but has no System entry in the composition this was built
against, so reading Systems alone would have dropped it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from defusedxml.ElementTree import ParseError, fromstring as parse_xml
from defusedxml.common import DefusedXmlException

from src.representation import AUTOMAT, ENTITY, SUBFORMATION, node_representation
from src.simulator_targets import normalise_owning_simulator

#: <!ENTITY name SYSTEM "..."> inside the internal DOCTYPE subset.
_ENTITY_DECL = re.compile(r"<!ENTITY\s+([A-Za-z0-9_.:-]+)\s+SYSTEM\s", re.IGNORECASE)

#: The whole DOCTYPE, internal subset included. Non-greedy to the closing "]>".
_DOCTYPE_WITH_SUBSET = re.compile(r"<!DOCTYPE\b.*?\]\s*>", re.DOTALL | re.IGNORECASE)

#: A DOCTYPE with no internal subset.
_DOCTYPE_PLAIN = re.compile(r"<!DOCTYPE\b[^>\[]*>", re.IGNORECASE)

#: Any entity reference that is not one of XML's five built-ins.
_ENTITY_REF = re.compile(r"&(?!amp;|lt;|gt;|quot;|apos;|#)[A-Za-z0-9_.:-]+;")

#: Service names that are simulators a unit can be federated to. The rest —
#: "simulation-os", "mediation" — are infrastructure, not places a unit lives.
_SIMULATOR_SERVICES = {"sword", "vbs4", "simworks", "mace", "ascot7", "jtls-go"}

#: APP-6 echelon glyph (SIDC index 11) for each echelon name a composition may
#: use in MinLevel / MaxLevel. The glyph is already ordered A..M smallest to
#: largest, so it doubles as the rank and there is no second ladder to keep in
#: step. Mirrors ECHELON_GLYPH in the app's skeleton.ts.
ECHELON_GLYPH = {
    "team": "A",
    "crew": "A",
    "squad": "B",
    "section": "C",
    "platoon": "D",
    "detachment": "D",
    "company": "E",
    "battery": "E",
    "troop": "E",
    "battalion": "F",
    "squadron": "F",
    "regiment": "G",
    "group": "G",
    "wing": "G",
    "brigade": "H",
    "division": "I",
    "corps": "J",
    "army": "K",
    "army group": "L",
    "region": "M",
}

#: Position of the echelon glyph in a 15-character APP-6D SIDC.
_SIDC_ECHELON_INDEX = 11

_GLYPH_ORDER = "ABCDEFGHIJKLM"


@dataclass
class CompositionSpec:
    """What a composition says it can run."""

    name: str = ""
    #: Every service declared, lower-cased — infrastructure included.
    services: set[str] = field(default_factory=set)
    #: Just the services a unit can be federated to.
    simulators: set[str] = field(default_factory=set)
    min_units: Optional[int] = None
    max_units: Optional[int] = None
    #: Echelon names as written, e.g. "Platoon" / "Battalion".
    min_level: str = ""
    max_level: str = ""

    def level_range(self) -> tuple[Optional[str], Optional[str]]:
        """(min glyph, max glyph); either is None when absent or unrecognised."""
        return (
            ECHELON_GLYPH.get(self.min_level.strip().lower()),
            ECHELON_GLYPH.get(self.max_level.strip().lower()),
        )


def strip_doctype_and_entities(xml_text: str) -> str:
    """
    Remove the DOCTYPE and every non-built-in entity reference.

    Leaves a document ElementTree can parse without ever being asked to
    resolve a SYSTEM identifier. Exported because the stripping is the
    security-relevant part and is worth testing on its own.
    """
    without_doctype = _DOCTYPE_WITH_SUBSET.sub("", xml_text, count=1)
    if without_doctype == xml_text:
        without_doctype = _DOCTYPE_PLAIN.sub("", xml_text, count=1)
    return _ENTITY_REF.sub("", without_doctype)


def declared_service_names(xml_text: str) -> list[str]:
    """
    The entity names declared in the DOCTYPE, in order.

    One entity per service is how the composition lists what it runs, so the
    declarations are the service list. Read as text, deliberately: see the
    module docstring.
    """
    return [match.group(1).strip().lower() for match in _ENTITY_DECL.finditer(xml_text)]


def parse_composition(xml_text: str) -> CompositionSpec:
    """
    Read a composition document into the facts an ORBAT has to satisfy.

    Everything is optional. A composition stating no Scale, no Level and no
    Services yields a spec that constrains nothing, and the checks then have
    nothing to say — the right behaviour for a document we do not own and
    whose shape may grow.
    """
    services = declared_service_names(xml_text)
    spec = CompositionSpec(
        services=set(services),
        simulators={s for s in services if s in _SIMULATOR_SERVICES},
    )

    try:
        root = parse_xml(strip_doctype_and_entities(xml_text))
    except (ParseError, DefusedXmlException):
        # The entity names are still worth having: a malformed Capabilities
        # block should not cost us the service list. DefusedXmlException is
        # caught alongside ParseError so a document that trips one of
        # defusedxml's own guards degrades the same way rather than raising
        # out of a preflight check.
        return spec

    spec.name = (root.get("Name") or "").strip()

    for element in root.iter():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag == "Scale":
            spec.min_units = _optional_int(element.get("MinUnits"))
            spec.max_units = _optional_int(element.get("MaxUnits"))
        elif tag == "Level":
            spec.min_level = (element.get("MinLevel") or "").strip()
            spec.max_level = (element.get("MaxLevel") or "").strip()

    return spec


def _optional_int(raw: Optional[str]) -> Optional[int]:
    try:
        return int(str(raw).strip())
    except (TypeError, ValueError):
        return None


def echelon_glyph_of(node: dict) -> Optional[str]:
    """
    The APP-6 echelon glyph on a node's SIDC, or None.

    The glyph is used rather than an echelon property because the unified
    ORBAT node does not carry one — and because the glyph is already the
    ordering, so there is nothing to convert.
    """
    sidc = str(node.get("sidc") or "")
    if len(sidc) <= _SIDC_ECHELON_INDEX:
        return None
    glyph = sidc[_SIDC_ECHELON_INDEX].upper()
    return glyph if glyph in _GLYPH_ORDER else None


def simulator_needed_by(node: dict) -> Optional[str]:
    """
    The service that must be present for this node to appear in the exercise.

    The projection rule from the representation vocabulary, asked the other
    way round::

        entity                   the simulator that owns it — VBS4, SimWorks
        automat / subformation   sword; only SWORD has automats
        aggregate                none, it is structure

    Returns None when the node needs nothing, or when what it needs cannot be
    determined — an unfederated entity is already reported by orbat_preflight
    as OWNING_SIMULATOR_INVALID and does not need saying twice.
    """
    representation = node_representation(node)
    if representation in (AUTOMAT, SUBFORMATION):
        return "sword"
    if representation == ENTITY:
        return normalise_owning_simulator(node.get("owningSimulator", ""))
    return None


def count_simulated_units(orbat: dict) -> int:
    """
    How many things this ORBAT actually puts in the exercise.

    Aggregates are not counted: nothing is spawned for them. An automat counts
    once — SWORD instantiates it whole — which is the difference between this
    number and a count of rows in the ontology, and the whole reason
    representation exists.
    """
    total = 0

    def walk(node: dict) -> None:
        nonlocal total
        if node_representation(node) in (ENTITY, AUTOMAT, SUBFORMATION):
            total += 1
        for child in node.get("children", []) or []:
            walk(child)

    for root in orbat.get("entities", []) or []:
        walk(root)
    return total
