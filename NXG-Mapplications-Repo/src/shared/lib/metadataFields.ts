// src/shared/lib/metadataFields.ts — pure reading of Ontology metadata answers.

export type ResourceKind = "objectType" | "action" | "query";

/**
 * The parameter names (actions, queries) or property names (object types) in
 * an Ontology v2 metadata answer. Both shapes Foundry has used are read: a map
 * keyed by API name, and a list of `{ apiName }`.
 */
export function fieldNames(kind: ResourceKind, body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  const nested = b.objectType as Record<string, unknown> | undefined;
  const bag = kind === "objectType" ? (b.properties ?? nested?.properties) : b.parameters;
  if (Array.isArray(bag)) {
    return bag
      .map((p) => {
        if (p && typeof p === "object") {
          const named = p as { apiName?: unknown; name?: unknown };
          return String(named.apiName ?? named.name ?? "");
        }
        return String(p);
      })
      .filter((n) => n.length > 0);
  }
  return bag && typeof bag === "object" ? Object.keys(bag) : [];
}
