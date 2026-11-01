"""
xml_translator.py
=================
Converts a unified ORBAT dict (as produced by translate_orbat_from_json /
translate_orbat_from_operation) into the namespaced XML format defined by
xmltranslated.xml.

Namespace declarations on the root <Orbat> element:
  xmlns="https://accenture.com/2026-03/cse/orbat"
  xmlns:vbs4="https://accenture.com/2026-03/cse/orbat/vbs4"
  xmlns:sword="https://accenture.com/2026-03/cse/orbat/sword"
  xmlns:simworks="https://accenture.com/2026-03/cse/orbat/simworks"

The tree mirrors the JSON structure:
  Organisation / Human / Vehicle / Aircraft  → XML element names (title-cased)
  Simulator-specific blocks                  → prefixed child elements

This module is intentionally free of Foundry/OSDK imports so it can be
tested locally without a Foundry environment.
"""

from __future__ import annotations

import logging
from xml.etree import ElementTree as ET
import defusedxml.minidom as minidom

from src.simulator_targets import normalise_owning_simulator

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Reference VBS4 blocks on SimWorks units
# ---------------------------------------------------------------------------
#
# builders.build_simworks_* attach a second, "reference" VBS4 block to a
# SimWorks-owned unit when the two simulators share a canonical asset, so that
# VBS4 can receive position updates for it. Emitting both produces invalid XML:
#
#   UnitType declares  <xs:element ref="UnitExtension" minOccurs="0" maxOccurs="1"/>
#
# and Vbs4 and Simworks are both in the UnitExtension substitution group, so the
# second one is rejected:
#
#   SCHEMAV_ELEMENT_CONTENT: Element '…vbs4}Vbs4': This element is not expected.
#
# The extension is therefore limited to one, chosen by owningSimulator, and the
# other block is dropped with a warning. Flip this to True only if CSE confirms
# a patch XSD that raises maxOccurs — the dual-block behaviour is otherwise
# unusable, since the ORBAT it produces cannot pass cse_validate_orbat.
EMIT_REFERENCE_VBS4 = False

# ---------------------------------------------------------------------------
# Namespace constants
# ---------------------------------------------------------------------------

NS_BASE = "https://accenture.com/2026-03/cse/orbat"
NS_VBS4 = "https://accenture.com/2026-03/cse/orbat/vbs4"
NS_SWORD = "https://accenture.com/2026-03/cse/orbat/sword"
NS_SIMWORKS = "https://accenture.com/2026-03/cse/orbat/simworks"

# Register prefixes so ElementTree uses them when serialising
ET.register_namespace("", NS_BASE)
ET.register_namespace("vbs4", NS_VBS4)
ET.register_namespace("sword", NS_SWORD)
ET.register_namespace("simworks", NS_SIMWORKS)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _str(value: object) -> str:
    """Convert any scalar to string, mapping Python booleans to lowercase."""
    if isinstance(value, bool):
        return str(value).lower()
    return "" if value is None else str(value)


def _prettify(element: ET.Element) -> str:
    """Return a pretty-printed XML string with an XML declaration."""
    raw = ET.tostring(element, encoding="unicode", xml_declaration=False)
    reparsed = minidom.parseString(raw)
    pretty = reparsed.toprettyxml(indent="    ", encoding=None)
    # Drop extra blank lines minidom inserts
    lines = [ln for ln in pretty.splitlines() if ln.strip()]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# VBS4 block builder
# ---------------------------------------------------------------------------


def _append_vbs4(parent: ET.Element, vbs4: dict) -> None:
    """Append a <vbs4:Vbs4> sub-element to *parent*."""
    el = ET.SubElement(parent, f"{{{NS_VBS4}}}Vbs4")
    el.set("className", _str(vbs4.get("className", "")))
    el.set("role", _str(vbs4.get("role", "None")))

    gs = vbs4.get("gunnerSeat", {})
    gs_el = ET.SubElement(el, f"{{{NS_VBS4}}}GunnerSeat")
    gs_el.set("turretIdentifier", _str(gs.get("turretIdentifier", "")))
    gs_el.set("name", _str(gs.get("name", "None")))

    ss = vbs4.get("sensorStreamingSettings", {})
    ss_el = ET.SubElement(el, f"{{{NS_VBS4}}}SensorStreamingSettings")
    ss_el.set("enabled", _str(ss.get("enabled", False)))
    ss_el.set("host", _str(ss.get("host", "127.0.0.1")))
    ss_el.set("port", _str(ss.get("port", 0)))

    st = vbs4.get("streamingSettings", {})
    st_el = ET.SubElement(el, f"{{{NS_VBS4}}}StreamingSettings")
    st_el.set("host", _str(st.get("host", "")))
    st_el.set("port", _str(st.get("port", 0)))
    st_el.set("framerate", _str(st.get("framerate", 0)))
    st_el.set("bitrate", _str(st.get("bitrate", 0)))
    st_el.set("width", _str(st.get("width", 0)))
    st_el.set("height", _str(st.get("height", 0)))
    st_el.set("fieldOfView", _str(st.get("fieldOfView", 0)))


# ---------------------------------------------------------------------------
# SWORD block builder
# ---------------------------------------------------------------------------


def _append_sword(parent: ET.Element, sword: dict) -> None:
    """
    Append a <sword:Sword> sub-element to *parent*.

    The class is omitted entirely when empty rather than written as class="".
    CSE's own SWORD ORBAT (tests/golden/sworbat.xml) does exactly this for the
    aggregate at the root:

        <sword:Sword controllable="false"/>

    A classless block is how SWORD is told to COMPOSE a formation from the
    automats beneath it, as opposed to spawning it. class="" is a different
    statement — an empty name — and is not what they send.
    """
    el = ET.SubElement(parent, f"{{{NS_SWORD}}}Sword")
    el.set("controllable", _str(sword.get("controllable", False)))

    # Strip our catalogue row-type suffix here as well as in config_store.
    # "ARMOR.Heavy tank company|automat" is our encoding, not SWORD's — and an
    # ORBAT can reach this emitter from a template or a JSON import that never
    # passed through config_store, so this is the last gate before the XML.
    sword_class = _str(sword.get("class", "")).split("|", 1)[0].strip()
    if sword_class:
        el.set("class", sword_class)


# ---------------------------------------------------------------------------
# SimWorks block builder
# ---------------------------------------------------------------------------


def _append_simworks(parent: ET.Element, simworks: dict) -> None:
    """Append a <simworks:Simworks> sub-element to *parent*."""
    el = ET.SubElement(parent, f"{{{NS_SIMWORKS}}}Simworks")
    el.set("className", _str(simworks.get("className", "")))


# ---------------------------------------------------------------------------
# Entity node builder (recursive)
# ---------------------------------------------------------------------------


def _build_entity(node: dict) -> ET.Element:
    """
    Recursively convert a single entity dict to an ET.Element.

    Rules (matching xmltranslated.xml):
    - $type → element tag (title-cased: "organisation" → "Organisation", etc.)
    - Common attributes: id, name, sidc, isExpanded (when present)
    - Unit attributes (human / vehicle / aircraft): owningSimulator,
      canControlDrones, dis, isDrone (vehicle / aircraft only)
    - Location, Behavior, ControlledDroneIds  → child elements (units only)
    - Children list → wrapped in <Children> element (if non-empty)
    - Simulator blocks: vbs4 → <vbs4:Vbs4>, sword → <sword:Sword>,
      simworks → <simworks:Simworks>

    Children of vehicle/aircraft nodes (crew) are placed BEFORE the vbs4
    block, matching the XML reference output.
    """
    entity_type = node.get("$type", "organisation")
    tag = entity_type.title()  # "organisation" → "Organisation"

    el = ET.Element(tag)

    # ── Common attributes ──────────────────────────────────────────────────
    el.set("id", _str(node.get("id", "")))
    el.set("name", _str(node.get("name", "")))
    el.set("sidc", _str(node.get("sidc", "")))

    if "isExpanded" in node:
        el.set("isExpanded", _str(node["isExpanded"]))

    # ── Unit-only attributes ───────────────────────────────────────────────
    is_unit = entity_type in ("human", "vehicle", "aircraft")
    if is_unit:
        # Normalise to the schema enumeration ("Vbs4" → "vbs4"). An
        # unrecognised or unfederated value ("none", empty) is written through
        # as-is rather than guessed at, so the validator names the real offender
        # instead of us quietly putting the unit into some other federation.
        # orbat_preflight reports these before they reach the validator.
        owning_raw = _str(node.get("owningSimulator", ""))
        el.set("owningSimulator", normalise_owning_simulator(owning_raw) or owning_raw.lower())
        el.set("canControlDrones", _str(node.get("canControlDrones", False)))
        el.set("dis", _str(node.get("dis", "")))
        if entity_type in ("vehicle", "aircraft"):
            el.set("isDrone", _str(node.get("isDrone", False)))

    # ── Location / Behavior / ControlledDroneIds (units only) ─────────────
    if is_unit:
        loc = node.get("location", {})
        if loc:
            loc_el = ET.SubElement(el, "Location")
            loc_el.set("latitude", _str(loc.get("latitude", 0.0)))
            loc_el.set("longitude", _str(loc.get("longitude", 0.0)))

        ET.SubElement(el, "Behavior")
        ET.SubElement(el, "ControlledDroneIds")

    # ── Simulator-specific blocks and Children ─────────────────────────────
    # The schema mandates strict element ordering per type:
    #
    # UnitType sequence (Location, Behavior, ControlledDroneIds already added above):
    #   → UnitExtension (vbs4 / simworks) comes NEXT
    #   → Children comes AFTER UnitExtension (Vehicle/Aircraft only, as a further extension)
    #
    # OrganisationType sequence:
    #   → Children comes FIRST (always emitted, even when empty)
    #   → OrganisationExtension (sword) comes AFTER Children
    #
    # Human never has children.

    children = node.get("children", [])

    if is_unit:
        # 1. UnitExtension slot — must come before Children, and there is room
        #    for exactly one (see EMIT_REFERENCE_VBS4 at the top of this file).
        owning_sim = normalise_owning_simulator(_str(node.get("owningSimulator", "")))
        present = [name for name in ("vbs4", "simworks") if name in node]

        # Prefer the owning simulator's own block; otherwise the only one there.
        # A unit owned by a simulator with no UnitExtension of its own (mace,
        # ascot7 …) still gets whichever block it carries, which is valid: the
        # slot takes any UnitExtension, not only the owner's.
        chosen = owning_sim if owning_sim in present else (present[0] if present else None)

        if chosen == "vbs4":
            _append_vbs4(el, node["vbs4"])
        elif chosen == "simworks":
            _append_simworks(el, node["simworks"])

        dropped = [name for name in present if name != chosen]
        if dropped and EMIT_REFERENCE_VBS4:
            # Opt-in, and invalid against the current schema — see the flag.
            for name in dropped:
                if name == "vbs4":
                    _append_vbs4(el, node["vbs4"])
                else:
                    _append_simworks(el, node["simworks"])
        elif dropped:
            logger.warning(
                "Unit %s (%s) carries %s blocks; kept %s and dropped %s — the schema "
                "allows one UnitExtension per unit.",
                node.get("id"),
                node.get("name"),
                "+".join(present),
                chosen,
                "+".join(dropped),
            )
        # 2. Children (vehicle/aircraft only).
        #
        # Optional on Vehicle, REQUIRED on Aircraft. validate.xsd declares
        # VehicleType's Children with minOccurs="0" but AircraftType's without,
        # so it defaults to minOccurs="1" and a childless <Aircraft> is invalid:
        #   Element 'Aircraft': Missing child element(s). Expected is ( Children ).
        # The element may be empty - its Human children are minOccurs="0" - so an
        # empty <Children/> satisfies it. This asymmetry looks like an oversight
        # in the CSE schema rather than intent, but an unmanned or crew-less
        # airframe is perfectly ordinary in an ORBAT and used to produce a
        # document that failed validation at the far end.
        if entity_type == "aircraft" or (entity_type == "vehicle" and children):
            children_el = ET.SubElement(el, "Children")
            for child in children:
                children_el.append(_build_entity(child))
    else:
        # 1. Children — required on organisations, always emit even when empty
        children_el = ET.SubElement(el, "Children")
        for child in children:
            children_el.append(_build_entity(child))
        # 2. OrganisationExtension slot — must come after Children
        if "sword" in node:
            _append_sword(el, node["sword"])

    return el


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def orbat_to_xml(orbat: dict) -> str:
    """
    Convert a unified ORBAT dict to a pretty-printed XML string.

    The ORBAT dict is the structure returned by translate_orbat_from_json /
    translate_orbat_from_operation – keys: id, title, simulators, entities, …

    Args:
        orbat: Unified ORBAT dict

    Returns:
        Pretty-printed XML string (UTF-8 declaration included)
    """
    # Build root with namespace declarations
    # Note: the schema does not allow any attributes on <Orbat>, so we do
    # not emit the simulators list as an attribute.
    root = ET.Element(f"{{{NS_BASE}}}Orbat")

    entities_el = ET.SubElement(root, "Entities")
    for entity in orbat.get("entities", []):
        entities_el.append(_build_entity(entity))

    return _prettify(root)
