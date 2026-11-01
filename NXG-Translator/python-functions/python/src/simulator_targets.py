"""
simulator_targets.py
====================
The owning-simulator vocabulary, and which extension slot each simulator fills.

Kept in one place because three things have to agree about it: the ontology
(NxgUnit.owningSimulator, free text), the XML (validate.xsd, a closed
enumeration) and the schema's extension model. They did not agree, and the
result was XML the CSE validator rejected:

    SCHEMAV_CVC_ENUMERATION_VALID: attribute 'owningSimulator': 'none' is not
    an element of the set {'vbs4','simworks','ascot7','jtls-go','sword','mace'}

The ontology holds "Vbs4", "simworks", "Simworks" and "none" today. Casing is
harmless — it normalises away. "none" is not: it means the unit is not
federated to anything, which the schema has no way to express.

Extension slots (validate.xsd):

    UnitType          → <xs:element ref="UnitExtension" minOccurs="0" maxOccurs="1"/>
    OrganisationType  → <xs:element ref="OrganisationExtension" minOccurs="0" maxOccurs="1"/>

<vbs4:Vbs4> and <simworks:Simworks> are both in the UnitExtension substitution
group; <sword:Sword> is in OrganisationExtension. So a unit may carry AT MOST
ONE of VBS4 or SimWorks, and an organisation carries SWORD. There is no
arrangement in which a single node is backed by all three.
"""

from __future__ import annotations

from typing import Optional

#: Values validate.xsd accepts for the owningSimulator attribute.
VALID_OWNING_SIMULATORS: tuple[str, ...] = (
    "vbs4",
    "simworks",
    "ascot7",
    "jtls-go",
    "sword",
    "mace",
)

#: Simulators whose block substitutes into orbat:UnitExtension.
UNIT_EXTENSION_SIMULATORS: tuple[str, ...] = ("vbs4", "simworks")

#: Simulators whose block substitutes into orbat:OrganisationExtension.
ORGANISATION_EXTENSION_SIMULATORS: tuple[str, ...] = ("sword",)

#: Spellings seen in the ontology and in hand-written JSON, mapped to the enum.
_ALIASES: dict[str, str] = {
    "vbs": "vbs4",
    "vbs3": "vbs4",
    "vbs4": "vbs4",
    "onearc/vbs4": "vbs4",
    "simworks": "simworks",
    "sim works": "simworks",
    "plexsys/simworks": "simworks",
    "ascot": "ascot7",
    "ascot7": "ascot7",
    "plexsys/ascot7": "ascot7",
    "jtls": "jtls-go",
    "jtls-go": "jtls-go",
    "valkyrie/jtls-go": "jtls-go",
    "sword": "sword",
    "masa/sword": "sword",
    "mace": "mace",
    "bsi/mace": "mace",
}


def normalise_owning_simulator(raw: Optional[str]) -> Optional[str]:
    """
    Map a raw owningSimulator value to the schema enumeration.

    Returns None when the unit is not federated ("none", empty) or the value is
    not recognised. None is deliberately distinct from a guess: the translator
    must not invent a simulator for a unit, because that would put the unit
    into a federation nobody asked for. Callers decide whether to exclude such
    units or have the planner assign one — see orbat_preflight.
    """
    value = (raw or "").strip().lower()
    if not value or value == "none":
        return None
    return _ALIASES.get(value)


def extension_slot(simulator: Optional[str]) -> Optional[str]:
    """Which extension slot a simulator fills: "unit", "organisation" or None."""
    if simulator in UNIT_EXTENSION_SIMULATORS:
        return "unit"
    if simulator in ORGANISATION_EXTENSION_SIMULATORS:
        return "organisation"
    return None
