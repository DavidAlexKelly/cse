"""
xml_validator.py
================
Validates a unified ORBAT XML string against the CSE ORBAT schema family:

  validate.xsd   — base ORBAT structure
  vbs4.xsd       — VBS4 unit extension  (<vbs4:Vbs4>)
  sword.xsd      — SWORD organisation extension  (<sword:Sword>)
  simworks.xsd   — SimWorks unit extension  (<simworks:Simworks>)

validate.xsd imports the three simulator XSDs so a single XMLSchema object
covers all namespaces.

This module is intentionally free of Foundry/OSDK imports so it can be
tested locally without a Foundry environment.

Security note:
  lxml is required for XML Schema validation (defusedxml does not support
  XMLSchema). The input to this module is always XML produced by our own
  translation pipeline (not arbitrary untrusted input). Safe parser settings
  (resolve_entities=False, no_network=True) are applied as defence-in-depth.
"""

from __future__ import annotations

from pathlib import Path
import lxml.etree as ET  # nosemgrep: python_xml_rule-etree


# Path to the data directory that holds all XSDs, relative to this file
_DATA_DIR = Path(__file__).parent / "data"
_ROOT_XSD = _DATA_DIR / "validate.xsd"

# Safe parser: disables entity resolution and network access to mitigate
# XXE and billion-laughs attacks (defence-in-depth).
_SAFE_PARSER = ET.XMLParser(resolve_entities=False, no_network=True)


def _load_schema() -> ET.XMLSchema:
    """Parse and return the compiled XMLSchema from validate.xsd."""
    schema_doc = ET.parse(str(_ROOT_XSD), parser=_SAFE_PARSER)  # nosemgrep: python_xml_rule-etree
    return ET.XMLSchema(schema_doc)


def validate_orbat_xml(xml_string: str) -> list[str]:
    """
    Validate a ORBAT XML string against the CSE schema.

    Args:
        xml_string: Pretty-printed XML string as returned by orbat_to_xml()

    Returns:
        Empty list if the document is valid; otherwise a list of human-readable
        error strings (one per schema violation).
    """
    schema = _load_schema()
    try:
        doc = ET.fromstring(xml_string.encode("utf-8"), parser=_SAFE_PARSER)  # nosemgrep: python_xml_rule-etree
    except ET.XMLSyntaxError as exc:
        return [f"XML parse error: {exc}"]

    schema.validate(doc)
    return [str(err) for err in schema.error_log]
