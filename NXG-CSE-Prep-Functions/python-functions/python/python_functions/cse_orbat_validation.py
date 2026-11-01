"""
Validate a phase's ORBAT against CSE and record the verdict on the hierarchy.

Why this exists as an ontology-edit function rather than a plain query:

Validating against CSE is the only check that uses CSE's OWN server-side
schema. Preflight and the shipped XSDs can both pass on an ORBAT that CSE
rejects - this workstream has produced several documents that were locally
valid and still wrong, including one that validated cleanly while containing
no spawnable units at all. So the verdict is worth keeping.

Recording it on the hierarchy makes it durable and visible instead of a
transient result in somebody's browser, which matters for the phase workflow
specifically: phases are simulated one at a time and the next phase is authored
from the result, so before simulating phase N you want to see that phase N's
ORBAT passed, and cseValidatedAt tells you whether that verdict predates the
last edit to the ORBAT.

It also makes the check runnable as an Action. CSE functions reach the server
through an external source, which means they cannot run in a function preview
at all ("no known environment detected"), so an Action is the only way to
invoke one outside the app.
"""

import json
import logging
from datetime import datetime, timezone

import requests
from functions.api import (
    OntologyEdit,
    String,
    UserFacingError,
    function,
    get_api_gateway_base_url,
    get_foundry_token,
)
from ontology_sdk import FoundryClient
from ontology_sdk.ontology.objects import NxgUnitHierarchy

from python_functions.cse_prep_functions import (
    _SOURCE,
    _call_rpc,
    _encode_string_field,
)

logger = logging.getLogger(__name__)

# cseValidationDetail is a string property, and CSE can return a long list of
# errors. Truncate rather than risk the edit failing, and say so explicitly so
# a truncated record is never mistaken for a complete one.
_MAX_DETAIL = 4000

STATUS_PASSED = "PASSED"
STATUS_FAILED = "FAILED"
STATUS_ERROR = "ERROR"

# resources.json pins this repository to a single ontology, so the RID is fixed
# rather than discovered. The alternative is reaching into
# client.ontology.queries._ontology_rid, which is private and no more robust.
_ONTOLOGY_RID = "ri.ontology.main.ontology.cc5e8302-efb1-44a0-b5ed-94c47bef6b9e"

# The phase ORBAT translator lives in the translator repository.
_TRANSLATE_PHASE_QUERY = "nxgTranslateOrbatToXmlFromPhase"

_TRANSLATE_TIMEOUT_SECONDS = 180


def _translate_phase_orbat(operation_key: str, phase_key: str) -> str:
    """
    Get one phase's ORBAT as XML from the translator repository.

    Called over the platform Queries API rather than through the generated SDK.
    Importing the function put it in resources.json under "queries", but SDK
    generation produced no callable for it at all - the generated
    Ontology...QueryTypes class contains only __init__ - so the obvious
    client.ontology.queries.<name>(...) fails at runtime with AttributeError.
    A cross-repository Python @function is not exposed as an OSDK query stub.

    The runtime already provides a token and a gateway, so the HTTP route is
    both available and authenticated as the executing user.
    """
    base = get_api_gateway_base_url().rstrip("/")
    # get_api_gateway_base_url() returns a bare host/path with NO scheme, and
    # requests rejects that with "No connection adapters were found".
    if "://" not in base:
        base = f"https://{base}"

    url = f"{base}/api/v2/ontologies/{_ONTOLOGY_RID}/queries/{_TRANSLATE_PHASE_QUERY}/execute"
    response = requests.post(
        url,
        headers={
            "Authorization": f"Bearer {get_foundry_token()}",
            "Content-Type": "application/json",
        },
        json={"parameters": {"operation_key": operation_key, "phase_key": phase_key}},
        timeout=_TRANSLATE_TIMEOUT_SECONDS,
    )
    if response.status_code != 200:
        raise RuntimeError(
            f"{_TRANSLATE_PHASE_QUERY} returned HTTP {response.status_code}: "
            f"{response.text[:600]}"
        )

    value = response.json().get("value")
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError(
            f"{_TRANSLATE_PHASE_QUERY} returned no XML. Body was: "
            f"{json.dumps(response.json(), default=str)[:600]}"
        )
    return value


def _truncate(text: str) -> str:
    if len(text) <= _MAX_DETAIL:
        return text
    return text[: _MAX_DETAIL - 80] + f"\n... truncated, {len(text)} characters in full"


def _rpc_json(service: str, method: str, body: bytes = b"") -> dict:
    """Call an RPC and parse the {"success":..., "data":...} envelope."""
    return json.loads(_call_rpc(service, method, body))


def _composition_names() -> list[str]:
    parsed = _rpc_json("CompositionApi", "Get")
    if not parsed.get("success"):
        return []
    compositions = (parsed.get("data") or {}).get("compositions") or []
    if isinstance(compositions, dict):
        compositions = [compositions]
    return [c.get("name") for c in compositions if isinstance(c, dict) and c.get("name")]


def _project_names() -> list[str]:
    parsed = _rpc_json("ProjectManagementApi", "GetProjects")
    if not parsed.get("success"):
        raise UserFacingError(
            f"Could not list CSE projects: {parsed.get('error')} ({parsed.get('code')})"
        )
    projects = (parsed.get("data") or {}).get("projects") or []
    # A single repeated entry decodes to a dict rather than a one-item list.
    if isinstance(projects, dict):
        projects = [projects]
    return [p.get("name") for p in projects if isinstance(p, dict) and p.get("name")]


def _ensure_project(project_name: str, composition: str) -> str:
    """
    Make sure the CSE project exists, creating it if not.

    ValidateOrbat validates against a project, and a project cannot be created
    without naming a composition, so a missing composition has to be reported
    as the actionable thing it is rather than as a bare RPC failure.
    """
    existing = _project_names()
    if project_name in existing:
        return f"project '{project_name}' already existed"

    available = _composition_names()
    if available and composition not in available:
        raise UserFacingError(
            f"CSE has no composition named '{composition}', so project "
            f"'{project_name}' cannot be created. Available compositions: "
            f"{', '.join(sorted(available))}"
        )

    parsed = _rpc_json(
        "ProjectManagementApi",
        "AddNewProject",
        _encode_string_field(1, project_name) + _encode_string_field(2, composition),
    )
    if not parsed.get("success"):
        hint = f" Available compositions: {', '.join(sorted(available))}." if available else ""
        raise UserFacingError(
            f"Could not create CSE project '{project_name}' with composition "
            f"'{composition}': {parsed.get('error')} ({parsed.get('code')}).{hint}"
        )
    return f"project '{project_name}' created with composition '{composition}'"


def _describe_errors(errors: object) -> str:
    """
    Render CSE's errors list.

    VALIDATE_ORBAT_RESPONSE is {1: requiredSchemas, 2: (errors,
    VALIDATION_ERROR_INFO)} and VALIDATION_ERROR_INFO is
    {schema, logic, system}, but the decoder collapses a single repeated entry
    to a dict, and the server's shape is not guaranteed stable across versions,
    so this keeps whatever came back rather than insisting on a structure.
    """
    if isinstance(errors, dict):
        errors = [errors]
    if not isinstance(errors, list):
        return str(errors)
    return "\n".join(f"  - {json.dumps(e, default=str)}" for e in errors)


@function(
    sources=[_SOURCE],
    edits=[NxgUnitHierarchy],
    api_name="nxgCseValidatePhaseOrbat",
)
def cse_validate_phase_orbat(
    operation_key: String,
    phase_key: String,
    project_name: String,
    composition: String,
) -> list[OntologyEdit]:
    """
    Translate one phase's ORBAT, validate it against CSE, and record the result.

    The verdict is written to every NxgUnitHierarchy carrying this phaseKey on
    this operation, because the phase exports as ONE document: if several
    hierarchies carry the phase they are merged into a single ORBAT, so the
    verdict applies to all of them equally.

    A failed validation is recorded rather than raised. The point of the
    exercise is to find out whether the ORBAT passes, and "it failed, here is
    what CSE said" is an answer worth keeping. Only being unable to record an
    answer at all is raised.

    Args:
        operation_key: e.g. "OPERATION-BALTIC-SHIELD"
        phase_key:     NxgPhase.phaseId, e.g. "obs_phase_01"
        project_name:  CSE project to validate against, created if absent
        composition:   CSE composition to create the project with, if needed

    Returns:
        edits to NxgUnitHierarchy recording status, detail and timestamp
    """
    client = FoundryClient()

    targets = [
        h
        for h in client.ontology.objects.NxgUnitHierarchy.where(
            NxgUnitHierarchy.object_type.phase_key == phase_key
        )
        if h.operation_key == operation_key
    ]
    if not targets:
        raise UserFacingError(
            f"No NxgUnitHierarchy carries phaseKey '{phase_key}' on operation "
            f"'{operation_key}', so there is nothing to validate and nowhere to "
            f"record a result."
        )

    status = STATUS_ERROR
    detail = ""

    try:
        xml = _translate_phase_orbat(operation_key, phase_key)
    except Exception as exc:  # noqa: BLE001 - recorded, not swallowed
        logger.warning("Phase ORBAT translation failed: %s", exc)
        detail = f"Translation failed before CSE was called: {exc}"
    else:
        logger.info("Translated phase ORBAT: %d characters of XML", len(xml))
        project_note = _ensure_project(project_name, composition)

        parsed = _rpc_json(
            "ProjectOrbatManagementApi",
            "ValidateOrbat",
            _encode_string_field(1, project_name) + _encode_string_field(2, xml),
        )
        if not parsed.get("success"):
            detail = (
                f"{project_note}. CSE ValidateOrbat call failed: "
                f"{parsed.get('error')} ({parsed.get('code')})"
            )
        else:
            data = parsed.get("data") or {}
            errors = data.get("errors")
            if errors:
                status = STATUS_FAILED
                detail = (
                    f"{project_note}. CSE rejected the ORBAT:\n"
                    f"{_describe_errors(errors)}"
                )
            else:
                status = STATUS_PASSED
                required = data.get("requiredSchemas")
                detail = (
                    f"{project_note}. CSE accepted the ORBAT "
                    f"({len(xml)} characters of XML, {len(targets)} "
                    f"hierarch{'y' if len(targets) == 1 else 'ies'})."
                )
                if required:
                    detail += f" Required schemas: {json.dumps(required, default=str)}"

    logger.info("CSE validation of phase %s: %s", phase_key, status)

    edits = client.ontology.edits()
    validated_at = datetime.now(timezone.utc)
    for hierarchy in targets:
        editable = edits.objects.NxgUnitHierarchy.edit(hierarchy)
        editable.cse_validation_status = status
        editable.cse_validation_detail = _truncate(detail)
        editable.cse_validated_at = validated_at

    return edits.get_edits()
