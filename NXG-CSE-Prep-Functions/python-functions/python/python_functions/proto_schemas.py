"""Proto field-name mappings for CSE-Prep gRPC messages.

Derived from the .proto files. Used to decode raw protobuf into
readable JSON with proper field names.
"""

# ── ManagementApi (Shared) ────────────────────────────────────────────────────

SCHEMA_ERROR_INFO = {1: "message", 2: "lineNumber", 3: "linePosition", 4: "path", 5: "value", 6: "errorType"}
LOGIC_ERROR_INFO = {1: "description", 2: "isWarning", 3: "source", 4: "category"}
SYSTEM_ERROR_INFO = {1: "message"}

# ValidationErrorInfo uses oneof: field 1=schema, 2=logic, 3=system
VALIDATION_ERROR_INFO = {1: ("schema", SCHEMA_ERROR_INFO), 2: ("logic", LOGIC_ERROR_INFO), 3: ("system", SYSTEM_ERROR_INFO)}

TOGGLE_STATE = {0: "Disable", 1: "Enable"}

# ── TypeManagementApi ─────────────────────────────────────────────────────────

APPLICATION_TYPE_INFO = {1: "symbol", 2: "vendor", 3: "displayName", 4: "category", 5: "dataTypes"}
COMPOSITION_TYPE_INFO = {1: "symbol", 2: "name", 3: "type"}
SYSTEM_TYPE_INFO = {1: "name", 2: "type", 3: "operatingSystem"}
APPLICATION_DATA_ENTRY = {1: "values"}  # map<string,string>

GET_APPLICATION_TYPES_RESPONSE = {1: ("applicationTypes", APPLICATION_TYPE_INFO)}
GET_COMPOSITION_TYPES_RESPONSE = {1: ("compositionTypes", COMPOSITION_TYPE_INFO)}
GET_SYSTEM_TYPES_RESPONSE = {1: ("systemTypes", SYSTEM_TYPE_INFO)}
GET_APPLICATION_DATA_RESPONSE = {1: "values", 2: ("data", APPLICATION_DATA_ENTRY)}

# ── ProjectManagementApi ──────────────────────────────────────────────────────

PROJECT_INFO = {1: "id", 2: "name", 3: "composition"}

GET_PROJECTS_RESPONSE = {1: ("projects", PROJECT_INFO)}
ADD_PROJECT_RESPONSE = {1: ("project", PROJECT_INFO)}
REMOVE_PROJECT_RESPONSE = {1: ("project", PROJECT_INFO)}
VALIDATE_PROJECT_RESPONSE = {1: "requiredSchemas", 2: ("errors", VALIDATION_ERROR_INFO)}
PUBLISH_PROJECT_RESPONSE = {1: ("project", PROJECT_INFO), 2: ("errors", VALIDATION_ERROR_INFO)}
TOGGLE_PROJECT_RESPONSE = {1: ("project", PROJECT_INFO)}

# ── CompositionApi ────────────────────────────────────────────────────────────

SYSTEM_INFO = {1: "id", 2: "name", 3: "hostName", 4: "type", 5: "platform"}
COMPOSITION_FILE = {1: "path", 2: "content"}
COMPOSITION_INFO = {1: "id", 2: "name", 3: ("files", COMPOSITION_FILE), 4: ("systems", SYSTEM_INFO)}

GET_COMPOSITIONS_RESPONSE = {1: ("compositions", COMPOSITION_INFO)}
VALIDATE_COMPOSITION_RESPONSE = {2: ("errors", VALIDATION_ERROR_INFO)}
RUN_COMPOSITION_RESPONSE = {1: "id", 2: ("errors", VALIDATION_ERROR_INFO)}
COMPOSITION_STATUS_RESPONSE = {1: "id", 2: "messages", 3: "finished", 4: "failed"}

# ── SchemaManagementApi ───────────────────────────────────────────────────────

GET_SCHEMAS_RESPONSE = {1: "schemas"}
GET_SCHEMA_RESPONSE = {1: "schemaContent"}

# ── ProjectOrbatManagementApi ─────────────────────────────────────────────────

ADD_ORBAT_RESPONSE = {1: ("errors", VALIDATION_ERROR_INFO)}
VALIDATE_ORBAT_RESPONSE = {1: "requiredSchemas", 2: ("errors", VALIDATION_ERROR_INFO)}


# ── Method → Response Schema mapping ─────────────────────────────────────────

RESPONSE_SCHEMAS = {
    "TypeManagementApi/GetApplicationTypes": GET_APPLICATION_TYPES_RESPONSE,
    "TypeManagementApi/GetCompositionTypes": GET_COMPOSITION_TYPES_RESPONSE,
    "TypeManagementApi/GetSystemTypes": GET_SYSTEM_TYPES_RESPONSE,
    "TypeManagementApi/GetApplicationData": GET_APPLICATION_DATA_RESPONSE,
    "ProjectManagementApi/GetProjects": GET_PROJECTS_RESPONSE,
    "ProjectManagementApi/AddNewProject": ADD_PROJECT_RESPONSE,
    "ProjectManagementApi/RemoveProject": REMOVE_PROJECT_RESPONSE,
    "ProjectManagementApi/ValidateProject": VALIDATE_PROJECT_RESPONSE,
    "ProjectManagementApi/PublishProject": PUBLISH_PROJECT_RESPONSE,
    "ProjectManagementApi/ToggleProjectApplication": TOGGLE_PROJECT_RESPONSE,
    "CompositionApi/Get": GET_COMPOSITIONS_RESPONSE,
    "CompositionApi/Validate": VALIDATE_COMPOSITION_RESPONSE,
    "CompositionApi/Run": RUN_COMPOSITION_RESPONSE,
    "CompositionApi/Status": COMPOSITION_STATUS_RESPONSE,
    "SchemaManagementApi/GetSchemas": GET_SCHEMAS_RESPONSE,
    "SchemaManagementApi/GetSchema": GET_SCHEMA_RESPONSE,
    "ProjectOrbatManagementApi/AddOrbatToProject": ADD_ORBAT_RESPONSE,
    "ProjectOrbatManagementApi/ValidateOrbat": VALIDATE_ORBAT_RESPONSE,
}
