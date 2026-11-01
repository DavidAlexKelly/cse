// src/shared/lib/platformMetadata.ts
//
// Read-only questions about the ontology: does this object type, action or
// function exist, can this app see it, and what parameters / properties does
// it have? Uses the Ontology metadata REST API (v2), which changes nothing.
//
// This is what the Demo readiness screen probes with. Everything the app calls
// by name (platformFunctions, platformObjects) can be missing at runtime even
// though the build succeeded, and everything it imports from the SDK can still
// be refused if the app's token was not granted it — so both are worth asking
// about before a rehearsal rather than during one.
import * as sdk from "@nxg-simulation-execution-testing/sdk";
import { $ontologyRid } from "@nxg-simulation-execution-testing/sdk";
import { auth, foundryUrl } from "@/client";
import { type ResourceKind, fieldNames } from "./metadataFields";

export type { ResourceKind };

export type ProbeStatus = "present" | "missing" | "forbidden" | "error";

export interface ResourceProbe {
  kind: ResourceKind;
  /** The name that answered, or the first name asked about. */
  apiName: string;
  status: ProbeStatus;
  /** The generated SDK has an export under this name. */
  inSdk: boolean;
  /** Parameter names (actions, queries) or property names (object types). */
  fields: string[];
  detail: string;
}

const PATH: Record<ResourceKind, string> = {
  objectType: "objectTypes",
  action: "actionTypes",
  query: "queryTypes",
};

function inSdk(name: string): boolean {
  return (sdk as Record<string, unknown>)[name] !== undefined;
}

async function probeOne(
  kind: ResourceKind,
  apiName: string,
  token: string,
): Promise<ResourceProbe> {
  const base = `${foundryUrl.replace(/\/$/, "")}/api/v2/ontologies/${$ontologyRid}`;
  const sdkHas = inSdk(apiName);
  try {
    const response = await fetch(`${base}/${PATH[kind]}/${encodeURIComponent(apiName)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const body = await response.json().catch(() => ({}));
      return {
        kind,
        apiName,
        status: "present",
        inSdk: sdkHas,
        fields: fieldNames(kind, body),
        detail: "",
      };
    }
    const text = await response.text().catch(() => "");
    const status: ProbeStatus =
      response.status === 404 || /NotFound/i.test(text)
        ? "missing"
        : response.status === 403
          ? "forbidden"
          : "error";
    return { kind, apiName, status, inSdk: sdkHas, fields: [], detail: `HTTP ${response.status}` };
  } catch (err) {
    return {
      kind,
      apiName,
      status: "error",
      inSdk: sdkHas,
      fields: [],
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Probe a resource that may go by several names (see platformFunctions):
 * the first name that is present wins; otherwise the most telling failure
 * (forbidden over error over missing) is reported against the first name.
 */
export async function probeResource(kind: ResourceKind, names: string[]): Promise<ResourceProbe> {
  const token = await auth();
  const results: ResourceProbe[] = [];
  for (const name of names) {
    const result = await probeOne(kind, name, token);
    if (result.status === "present") return result;
    results.push(result);
  }
  const rank: Record<ProbeStatus, number> = { forbidden: 3, error: 2, missing: 1, present: 0 };
  const worst = [...results].sort((a, b) => rank[b.status] - rank[a.status])[0];
  return { ...worst, apiName: names[0], inSdk: names.some(inSdk) };
}
