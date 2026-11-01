// src/shared/lib/platformFunctions.ts
//
// Call a published Foundry function (query) by name — through the generated
// SDK when the app's SDK includes it, otherwise through the Ontology Queries
// REST API.
//
// Why the fallback exists: a function only appears in the generated SDK once
// it has been added to the Developer Console application and a new SDK version
// generated and installed. The Execute screen needs the Translator's phase
// functions (nxgTranslateOrbatToXmlFromPhase, nxgPreflightOrbatFromPhase) and
// several CSE-Prep functions, and at the time of writing only cseValidateOrbat
// and cseAddProject were in the SDK. Rather than block the screen on an SDK
// release, both routes are tried. The CSE-Prep functions use the same REST
// route server-side for the same reason (cse_orbat_validation.py).
//
// Names: published functions are registered under their api_name
// (nxgCseRunCompositionSimple) but some SDK versions expose the Python name
// camel-cased (cseRunCompositionSimple). Callers pass every name a function
// may go by; the first that resolves wins.
import { $ontologyRid } from "@nxg-simulation-execution-testing/sdk";
import * as sdk from "@nxg-simulation-execution-testing/sdk";
import { auth, client, foundryUrl } from "@/client";

export class FunctionUnavailableError extends Error {
  constructor(names: string[], detail: string) {
    super(
      `${names[0]} is not available to this app (${detail}). Add it to the Developer Console ` +
        "application's resources, or regenerate the SDK.",
    );
    this.name = "FunctionUnavailableError";
  }
}

/** Run a query function by any of its names. Resolves with its return value. */
export async function executeQuery<T = unknown>(
  names: string[],
  parameters: Record<string, unknown>,
): Promise<T> {
  // 1. Generated SDK.
  for (const name of names) {
    const fn = (sdk as Record<string, unknown>)[name];
    if (fn) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await (client(fn as any) as any).executeFunction(parameters)) as T;
    }
  }

  // 2. Ontology Queries REST API.
  const token = await auth();
  let lastDetail = "not in the SDK";
  for (const name of names) {
    const response = await fetch(
      `${foundryUrl.replace(/\/$/, "")}/api/v2/ontologies/${$ontologyRid}/queries/${encodeURIComponent(name)}/execute`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ parameters }),
      },
    );
    if (response.ok) {
      const body = (await response.json()) as { value?: T };
      return body.value as T;
    }
    const text = await response.text().catch(() => "");
    // 404 / not-found → try the next name. Anything else is a real failure.
    if (response.status === 404 || /QueryNotFound|not.?found/i.test(text)) {
      lastDetail = `HTTP ${response.status}`;
      continue;
    }
    if (response.status === 403) throw new FunctionUnavailableError(names, "permission denied");
    throw new Error(`${name} failed (HTTP ${response.status}): ${text.slice(0, 400)}`);
  }
  throw new FunctionUnavailableError(names, lastDetail);
}
