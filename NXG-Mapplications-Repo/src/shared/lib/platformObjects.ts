// src/shared/lib/platformObjects.ts
//
// Apply an Action and search an object type BY NAME — through the generated
// SDK when it has them, otherwise through the Ontology REST API (v2).
//
// The same reasoning as platformFunctions.ts: a newly created object type or
// action only reaches the generated SDK after the Developer Console app is
// updated and a new SDK version is installed. Going by name lets a feature
// switch on the moment the type exists in the ontology, and fall back cleanly
// (OntologyResourceMissing) until it does.
import * as sdk from "@nxg-simulation-execution-testing/sdk";
import { $ontologyRid } from "@nxg-simulation-execution-testing/sdk";
import { auth, client, foundryUrl } from "@/client";

/** The action or object type does not exist (yet), or this app may not see it. */
export class OntologyResourceMissing extends Error {
  constructor(name: string, detail: string) {
    super(`${name} is not available (${detail}).`);
    this.name = "OntologyResourceMissing";
  }
}

function base(): string {
  return `${foundryUrl.replace(/\/$/, "")}/api/v2/ontologies/${$ontologyRid}`;
}

async function post(path: string, body: unknown, name: string): Promise<unknown> {
  const token = await auth();
  const response = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok) return response.json().catch(() => ({}));
  const text = await response.text().catch(() => "");
  if (response.status === 404 || /NotFound/i.test(text)) {
    throw new OntologyResourceMissing(name, `HTTP ${response.status}`);
  }
  if (response.status === 403) throw new OntologyResourceMissing(name, "permission denied");
  throw new Error(`${name} failed (HTTP ${response.status}): ${text.slice(0, 400)}`);
}

/** Apply an action by API name. */
export async function applyActionByName(
  apiName: string,
  parameters: Record<string, unknown>,
): Promise<void> {
  const fromSdk = (sdk as Record<string, unknown>)[apiName];
  if (fromSdk) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client(fromSdk as any) as any).applyAction(parameters);
    return;
  }
  await post(`/actions/${encodeURIComponent(apiName)}/apply`, { parameters }, apiName);
}

/** Equality filters, AND-ed — all the search callers here need. */
export type EqualityFilter = Record<string, string>;

/** Search an object type by API name; returns plain property bags. */
export async function searchObjectsByName(
  objectType: string,
  where: EqualityFilter,
  pageSize = 200,
): Promise<Record<string, unknown>[]> {
  const fromSdk = (sdk as Record<string, unknown>)[objectType];
  if (fromSdk) {
    const filter = Object.fromEntries(Object.entries(where).map(([k, v]) => [k, { $eq: v }]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = await (client(fromSdk as any) as any)
      .where(filter)
      .fetchPage({ $pageSize: pageSize });
    return page.data as Record<string, unknown>[];
  }
  const clauses = Object.entries(where).map(([field, value]) => ({ type: "eq", field, value }));
  const body = {
    where: clauses.length === 1 ? clauses[0] : { type: "and", value: clauses },
    pageSize,
  };
  const result = (await post(
    `/objects/${encodeURIComponent(objectType)}/search`,
    body,
    objectType,
  )) as {
    data?: Record<string, unknown>[];
  };
  return result.data ?? [];
}
