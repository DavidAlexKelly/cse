"""CSE-Prep Functions — native gRPC bridge to the CSE-Prep server.

Connects via gRPC over TLS through the Azure Firewall (4.165.4.53:443)
with SNI override to route to the CSE-Prep OpenShift Route.
Uses raw gRPC calls (no proto stubs required).
"""

import os
os.environ["GRPC_ENFORCE_ALPN_ENABLED"] = "false"  # safety net

import grpc
import json
import struct
import logging

from functions.api import function
from functions.sources import get_source
from python_functions.proto_schemas import RESPONSE_SCHEMAS

logger = logging.getLogger(__name__)
logger.info("grpc version: %s", grpc.__version__)

# ── Connection config ─────────────────────────────────────────────────────────
_SOURCE = "NxgPmesiiMcpServer"
_CSE_HOST = "4.165.4.53"
_CSE_PORT = "443"
_CSE_SNI = "cse-prep.apps.cse-cluster.cse.local"

# New self-signed cert (passthrough route, CN=cse-prep.apps.cse-cluster.cse.local)
_CSE_CA_CERT = b"""-----BEGIN CERTIFICATE-----
MIIDZzCCAk+gAwIBAgIQFKuZ/fAZ/YFBJy6iir7iYTANBgkqhkiG9w0BAQsFADAu
MSwwKgYDVQQDDCNjc2UtcHJlcC5hcHBzLmNzZS1jbHVzdGVyLmNzZS5sb2NhbDAe
Fw0yNjA4MDcwOTEzMzBaFw0yNzA4MDcwOTMzMzBaMC4xLDAqBgNVBAMMI2NzZS1w
cmVwLmFwcHMuY3NlLWNsdXN0ZXIuY3NlLmxvY2FsMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAt9qQOElOUUSvajFeK5WKWzR2PV54uEmFzzyKYXV+Brbc
tZYe84g6SIrjEFPus6clZHNy04VqehCEvpugKGMRrWPCwxohNBN8ANY8pUzafL0U
77Xfy9Wd0M+jYiK7hVHwIQdG2+eldu5T386727Hv1Pu78KavuQecMrlS3/f41g/B
wwYn+oQ5ZCbvB25zDde5R38K5GY5S1DRoDcjFTey6tcHLCP5J5ICt+HgPdADTJMl
GLLbWOIFC6k+MVteZXEu6mHuBUrUMsUpNivLDYh4dwiTsbRjuxEo5zLCRUSOusjE
3ivJ+T3VY2/upmVq3PR5QJCzOdwCu9kEjBnbZfcjJQIDAQABo4GAMH4wDgYDVR0P
AQH/BAQDAgWgMB0GA1UdJQQWMBQGCCsGAQUFBwMCBggrBgEFBQcDATAuBgNVHREE
JzAlgiNjc2UtcHJlcC5hcHBzLmNzZS1jbHVzdGVyLmNzZS5sb2NhbDAdBgNVHQ4E
FgQUHnbjvgNlq+0q/OLNLfwqVtLE7EswDQYJKoZIhvcNAQELBQADggEBAFf0Ff6O
1+KVOUJoAmT/8pVVmc7iEQZOJNjQqnT79P0R4LmYrHpI0Fy1L04QZ0uAyt+psOpY
583G7pNqlpdB1nPfA3HkDm0EwSf2Le2/i7qzmbFEsXJtTUtWSnqdhffduayrP5w4
MHHkd14Hcv6I0oWKZZL/WupOA6fR7uY6y2Ia+a121tybNQR6eyVOk5KD0m5YN14p
YdHss9zV7rkWHvFMrMUQ8B6LWsZEiqADcO0hMMl+3/7ouQ3xaP2fsU8gTpnEwxMD
Yu4vm3i55n086Aw8ZCmoV3T+hkiAk5xmhfrYWhwEnPApSAiGSCGctDU5Di0KLvM1
aaJxLOzMAfm0qIE=
-----END CERTIFICATE-----
"""

_RPC_TIMEOUT = 15.0


# ── gRPC Reflection ──────────────────────────────────────────────────────────

def _list_services_via_reflection(channel) -> list:
    """Use gRPC reflection to discover all services on the server."""
    # Try both v1 and v1alpha reflection endpoints
    for reflection_service in [
        "grpc.reflection.v1.ServerReflection",
        "grpc.reflection.v1alpha.ServerReflection",
    ]:
        try:
            method = f"/{reflection_service}/ServerReflectionInfo"
            stub = channel.stream_stream(
                method,
                request_serializer=_identity_serialize,
                response_deserializer=_identity_deserialize,
            )
            # Send ListServices request: field 7 (list_services) = ""
            request = _encode_string_field(7, "")
            responses = stub(iter([request]), timeout=_RPC_TIMEOUT)
            result = []
            for resp_bytes in responses:
                decoded = _decode_raw_protobuf(resp_bytes)
                result.append(decoded)
            return result
        except grpc.RpcError as e:
            logger.info("Reflection via %s failed: %s", reflection_service, e)
            continue
    return []


def _get_file_descriptor(channel, symbol: str, reflection_service: str) -> dict:
    """Get the file descriptor for a symbol via reflection."""
    method = f"/{reflection_service}/ServerReflectionInfo"
    stub = channel.stream_stream(
        method,
        request_serializer=_identity_serialize,
        response_deserializer=_identity_deserialize,
    )
    # field 4 = file_containing_symbol
    request = _encode_string_field(4, symbol)
    responses = stub(iter([request]), timeout=_RPC_TIMEOUT)
    for resp_bytes in responses:
        return _decode_raw_protobuf(resp_bytes)
    return {}


# ── Raw protobuf encoder/decoder ─────────────────────────────────────────────

def _encode_string_field(field_number: int, value: str) -> bytes:
    """Encode a protobuf string field."""
    tag = (field_number << 3) | 2  # wire type 2 = length-delimited
    encoded = value.encode("utf-8")
    return _encode_varint(tag) + _encode_varint(len(encoded)) + encoded


def _encode_bytes_field(field_number: int, value: bytes) -> bytes:
    """Encode a length-delimited (bytes/nested message) protobuf field."""
    tag = (field_number << 3) | 2
    return _encode_varint(tag) + _encode_varint(len(value)) + value


def _encode_int_field(field_number: int, value: int) -> bytes:
    """Encode a protobuf varint field."""
    tag = (field_number << 3) | 0  # wire type 0 = varint
    return _encode_varint(tag) + _encode_varint(value)


def _encode_varint(value: int) -> bytes:
    result = []
    while value > 127:
        result.append((value & 0x7F) | 0x80)
        value >>= 7
    result.append(value & 0x7F)
    return bytes(result)


def _decode_raw_protobuf(data: bytes) -> dict:
    """Decode raw protobuf bytes into a dict of {field_number: value}."""
    result = {}
    pos = 0
    while pos < len(data):
        tag_byte, pos = _read_varint(data, pos)
        field_number = tag_byte >> 3
        wire_type = tag_byte & 0x07

        if wire_type == 0:  # varint
            value, pos = _read_varint(data, pos)
            result.setdefault(field_number, []).append(value)
        elif wire_type == 2:  # length-delimited (string, bytes, nested)
            length, pos = _read_varint(data, pos)
            chunk = data[pos:pos + length]
            pos += length
            try:
                text = chunk.decode("utf-8")
                result.setdefault(field_number, []).append(text)
            except UnicodeDecodeError:
                # Nested message — try to decode recursively
                try:
                    nested = _decode_raw_protobuf(chunk)
                    result.setdefault(field_number, []).append(nested)
                except Exception:
                    result.setdefault(field_number, []).append(chunk.hex())
        elif wire_type == 5:  # 32-bit
            value = struct.unpack("<I", data[pos:pos + 4])[0]
            pos += 4
            result.setdefault(field_number, []).append(value)
        elif wire_type == 1:  # 64-bit
            value = struct.unpack("<Q", data[pos:pos + 8])[0]
            pos += 8
            result.setdefault(field_number, []).append(value)
        else:
            break  # unknown wire type
    return result


def _read_varint(data: bytes, pos: int):
    result = 0
    shift = 0
    while pos < len(data):
        byte = data[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if (byte & 0x80) == 0:
            return result, pos
        shift += 7
    return result, pos


# ── gRPC channel ─────────────────────────────────────────────────────────────

def _get_channel():
    """Create a secure gRPC channel to CSE-Prep via Azure Firewall."""
    # Touch the source so Foundry grants egress
    get_source(_SOURCE)

    target = f"{_CSE_HOST}:{_CSE_PORT}"
    creds = grpc.ssl_channel_credentials(root_certificates=_CSE_CA_CERT)
    options = [
        ("grpc.ssl_target_name_override", _CSE_SNI),
    ]
    logger.info("Opening gRPC channel to %s (SNI=%s)", target, _CSE_SNI)
    return grpc.secure_channel(target, creds, options=options)


def _identity_serialize(x):
    return x


def _identity_deserialize(x):
    return x


def _decode_typed(data, schema: dict) -> dict:
    """Decode protobuf bytes using a schema with proper field names."""
    if isinstance(data, dict):
        # Already decoded — just map field numbers to names
        raw = data
    elif isinstance(data, bytes):
        raw = _decode_raw_protobuf(data)
    else:
        return {"_raw": str(data)}
    result = {}
    for field_num, values in raw.items():
        if field_num not in schema:
            result[f"field_{field_num}"] = values
            continue
        field_def = schema[field_num]
        if isinstance(field_def, tuple):
            # Nested message: (name, sub_schema)
            name, sub_schema = field_def
            decoded_items = []
            for v in values:
                if isinstance(v, dict):
                    # Already decoded as dict of field_numbers
                    sub_raw = v
                    sub_result = {}
                    for sf, sv in sub_raw.items():
                        if sf in sub_schema:
                            sf_def = sub_schema[sf]
                            if isinstance(sf_def, tuple):
                                sf_name, sf_sub = sf_def
                                decoded_sv = []
                                for x in sv:
                                    try:
                                        if isinstance(x, dict):
                                            decoded_sv.append(_decode_typed(x, sf_sub))
                                        elif isinstance(x, (str, bytes)):
                                            raw_x = x.encode("latin-1") if isinstance(x, str) else x
                                            decoded_sv.append(_decode_typed(raw_x, sf_sub))
                                        else:
                                            decoded_sv.append(x)
                                    except Exception:
                                        decoded_sv.append(x)
                                sub_result[sf_name] = decoded_sv
                            else:
                                sub_result[sf_def] = sv[0] if len(sv) == 1 else sv
                        else:
                            sub_result[f"field_{sf}"] = sv
                    decoded_items.append(sub_result)
                elif isinstance(v, str):
                    # String that's actually a nested message — try to decode
                    try:
                        raw_bytes = v.encode("latin-1")
                        if len(raw_bytes) > 0:
                            sub_decoded = _decode_typed(raw_bytes, sub_schema)
                            decoded_items.append(sub_decoded)
                        else:
                            decoded_items.append(v)
                    except Exception:
                        decoded_items.append(v)
                else:
                    decoded_items.append(v)
            result[name] = decoded_items
        else:
            # Scalar field
            name = field_def
            result[name] = values[0] if len(values) == 1 else values
    return result


def _call_rpc(service: str, method: str, body: bytes = b"") -> str:
    """Make a raw gRPC unary-unary call and return decoded protobuf as JSON."""
    rpc_key = f"{service}/{method}"
    full_method = f"/{rpc_key}"
    schema = RESPONSE_SCHEMAS.get(rpc_key)
    channel = _get_channel()
    try:
        call = channel.unary_unary(
            full_method,
            request_serializer=_identity_serialize,
            response_deserializer=_identity_deserialize,
        )
        response_bytes = call(body, timeout=_RPC_TIMEOUT)
        logger.info("gRPC %s succeeded, %d bytes", full_method, len(response_bytes))

        if not response_bytes:
            return json.dumps({"success": True, "data": {}})

        if schema:
            decoded = _decode_typed(response_bytes, schema)
        else:
            decoded = _decode_raw_protobuf(response_bytes)
        return json.dumps({"success": True, "data": decoded}, indent=2, default=str)
    except grpc.RpcError as e:
        logger.warning("gRPC %s failed: %s", full_method, e)
        return json.dumps({
            "success": False,
            "error": str(e.details()) if hasattr(e, "details") else str(e),
            "code": str(e.code()) if hasattr(e, "code") else "UNKNOWN",
        })
    finally:
        channel.close()


# ── Health check ─────────────────────────────────────────────────────────────

@function(sources=[_SOURCE], api_name="nxgCseHealthCheck")
def cse_health_check() -> str:
    """Check gRPC connectivity to CSE-Prep by calling GetSystemTypes."""
    return _call_rpc("TypeManagementApi", "GetSystemTypes")


@function(sources=[_SOURCE], api_name="nxgCseDiscoverServices")
def cse_discover_services() -> str:
    """Discover all gRPC services and methods via gRPC Reflection.

    Returns a list of all available services and their file descriptors.
    Requires the server to have gRPC reflection enabled.
    """
    get_source(_SOURCE)
    channel = _get_channel()
    try:
        services_result = _list_services_via_reflection(channel)
        if not services_result:
            return json.dumps({
                "success": False,
                "error": "gRPC reflection not available on this server",
            })

        # Parse service names from the reflection response
        all_services = []
        for resp in services_result:
            # Field 6 = list_services_response, which contains field 1 = repeated Service
            if 6 in resp:
                for svc_data in resp[6]:
                    if isinstance(svc_data, dict) and 1 in svc_data:
                        for svc_name in svc_data[1]:
                            all_services.append(svc_name)

        # For each service, try to get its file descriptor
        service_details = []
        for svc_name in all_services:
            detail = {"service": svc_name}
            for reflection_service in [
                "grpc.reflection.v1.ServerReflection",
                "grpc.reflection.v1alpha.ServerReflection",
            ]:
                try:
                    fd_resp = _get_file_descriptor(channel, svc_name, reflection_service)
                    if fd_resp:
                        detail["file_descriptor_raw"] = str(fd_resp)
                    break
                except Exception:
                    continue
            service_details.append(detail)

        return json.dumps({
            "success": True,
            "services": all_services,
            "details": service_details,
        }, indent=2)

    except Exception as e:
        return json.dumps({"success": False, "error": str(e)})
    finally:
        channel.close()


# ── Composition API ──────────────────────────────────────────────────────────

@function(sources=[_SOURCE], api_name="nxgCseGetCompositions")
def cse_get_compositions() -> str:
    """Get all compositions."""
    return _call_rpc("CompositionApi", "Get")


@function(sources=[_SOURCE], api_name="nxgCseValidateCompositionSimple")
def cse_validate_composition_simple(composition_xml: str) -> str:
    """Validate a composition from a single XML string."""
    file_msg = _encode_string_field(1, "composition/composition.xml") + _encode_string_field(2, composition_xml)
    body = _encode_bytes_field(1, file_msg)
    return _call_rpc("CompositionApi", "Validate", body)


@function(sources=[_SOURCE], api_name="nxgCseValidateComposition")
def cse_validate_composition(files_json: str) -> str:
    """Validate composition files. files_json: JSON array of {path, content}."""
    files = json.loads(files_json)
    body = b""
    for f in files:
        file_msg = _encode_string_field(1, f["path"]) + _encode_string_field(2, f["content"])
        # Wrap as repeated field 1 (files) in the request
        body += _encode_varint((1 << 3) | 2) + _encode_varint(len(file_msg)) + file_msg
    return _call_rpc("CompositionApi", "Validate", body)


@function(sources=[_SOURCE], api_name="nxgCseRunCompositionSimple")
def cse_run_composition_simple(
    composition_xml: str,
    orbat_content: str | None = None,
    composition_path: str | None = None,
    orbat_path: str | None = None,
) -> str:
    """Run a composition from XML, optionally with an ORBAT file.

    Args:
        composition_xml: The full composition XML including <Systems>.
        orbat_content: Optional ORBAT XML content.
        composition_path: File path for the composition (default: "composition/composition.xml").
        orbat_path: File path for the ORBAT (default: "orbat/orbat.xml").
    """
    import re
    match = re.search(r'<Composition[^>]+Name="([^"]+)"', composition_xml)
    name = match.group(1) if match else "unnamed"

    comp_path = composition_path or "composition/composition.xml"
    orb_path = orbat_path or "orbat/orbat.xml"

    files = [{"path": comp_path, "content": composition_xml}]
    if orbat_content:
        files.append({"path": orb_path, "content": orbat_content})

    files_bytes = b""
    for f in files:
        file_msg = _encode_string_field(1, f["path"]) + _encode_string_field(2, f["content"])
        files_bytes += _encode_bytes_field(2, file_msg)

    body = _encode_string_field(1, name) + files_bytes
    return _call_rpc("CompositionApi", "Run", body)


@function(sources=[_SOURCE], api_name="nxgCseRunComposition")
def cse_run_composition(composition_name: str, files_json: str) -> str:
    """Run a composition."""
    files = json.loads(files_json)
    body = _encode_string_field(1, composition_name)
    for f in files:
        file_msg = _encode_string_field(1, f["path"]) + _encode_string_field(2, f["content"])
        body += _encode_varint((2 << 3) | 2) + _encode_varint(len(file_msg)) + file_msg
    return _call_rpc("CompositionApi", "Run", body)


@function(sources=[_SOURCE], api_name="nxgCseCompositionStatus")
def cse_composition_status(composition_id: str) -> str:
    """Get status of a running composition."""
    return _call_rpc("CompositionApi", "Status", _encode_string_field(1, composition_id))


@function(sources=[_SOURCE], api_name="nxgCseCompositionStop")
def cse_composition_stop(composition_id: str) -> str:
    """Stop a running composition."""
    return _call_rpc("CompositionApi", "Stop", _encode_string_field(1, composition_id))


# ── Project API ──────────────────────────────────────────────────────────────

@function(sources=[_SOURCE], api_name="nxgCseGetProjects")
def cse_get_projects() -> str:
    """Get all projects."""
    return _call_rpc("ProjectManagementApi", "GetProjects")


@function(sources=[_SOURCE], api_name="nxgCseAddProject")
def cse_add_project(project_name: str, composition: str) -> str:
    """Add a new project."""
    body = _encode_string_field(1, project_name) + _encode_string_field(2, composition)
    return _call_rpc("ProjectManagementApi", "AddNewProject", body)


@function(sources=[_SOURCE], api_name="nxgCseRemoveProject")
def cse_remove_project(project_name: str) -> str:
    """Remove a project."""
    return _call_rpc("ProjectManagementApi", "RemoveProject",
                     _encode_string_field(1, project_name))


@function(sources=[_SOURCE], api_name="nxgCseValidateProject")
def cse_validate_project(project_name: str) -> str:
    """Validate a project."""
    return _call_rpc("ProjectManagementApi", "ValidateProject",
                     _encode_string_field(1, project_name))


@function(sources=[_SOURCE], api_name="nxgCseToggleProjectApplication")
def cse_toggle_project_application(
    project_name: str, application_type: str, state: int
) -> str:
    """Toggle a project application on or off."""
    body = (_encode_string_field(1, project_name)
            + _encode_string_field(2, application_type)
            + _encode_int_field(3, state))
    return _call_rpc("ProjectManagementApi", "ToggleProjectApplication", body)


@function(sources=[_SOURCE], api_name="nxgCsePublishProject")
def cse_publish_project(project_name: str) -> str:
    """Publish a project. WARNING: may impact VMs and containers."""
    return _call_rpc("ProjectManagementApi", "PublishProject",
                     _encode_string_field(1, project_name))


# ── ORBAT API ────────────────────────────────────────────────────────────────

@function(sources=[_SOURCE], api_name="nxgCseAddOrbatToProject")
def cse_add_orbat_to_project(project: str, orbat_content: str) -> str:
    """Add an ORBAT to a project."""
    body = _encode_string_field(1, project) + _encode_string_field(2, orbat_content)
    return _call_rpc("ProjectOrbatManagementApi", "AddOrbatToProject", body)


@function(sources=[_SOURCE], api_name="nxgCseValidateOrbat")
def cse_validate_orbat(project_name: str, orbat_content: str) -> str:
    """Validate an ORBAT for a project."""
    body = _encode_string_field(1, project_name) + _encode_string_field(2, orbat_content)
    return _call_rpc("ProjectOrbatManagementApi", "ValidateOrbat", body)


# ── Schema API ───────────────────────────────────────────────────────────────

@function(sources=[_SOURCE], api_name="nxgCseGetSchemas")
def cse_get_schemas() -> str:
    """Get all available schemas."""
    return _call_rpc("SchemaManagementApi", "GetSchemas")


@function(sources=[_SOURCE], api_name="nxgCseGetSchema")
def cse_get_schema(schema_name: str) -> str:
    """Get a specific schema by name."""
    return _call_rpc("SchemaManagementApi", "GetSchema",
                     _encode_string_field(1, schema_name))


# ── Type API ─────────────────────────────────────────────────────────────────

@function(sources=[_SOURCE], api_name="nxgCseGetApplicationTypes")
def cse_get_application_types() -> str:
    """Get all application types."""
    return _call_rpc("TypeManagementApi", "GetApplicationTypes")


@function(sources=[_SOURCE], api_name="nxgCseGetCompositionTypes")
def cse_get_composition_types() -> str:
    """Get all composition types."""
    return _call_rpc("TypeManagementApi", "GetCompositionTypes")


@function(sources=[_SOURCE], api_name="nxgCseGetSystemTypes")
def cse_get_system_types() -> str:
    """Get all system types."""
    return _call_rpc("TypeManagementApi", "GetSystemTypes")


@function(sources=[_SOURCE], api_name="nxgCseGetApplicationData")
def cse_get_application_data(application_name: str, data_type: str) -> str:
    """Get application data."""
    body = _encode_string_field(1, application_name) + _encode_string_field(2, data_type)
    return _call_rpc("TypeManagementApi", "GetApplicationData", body)
