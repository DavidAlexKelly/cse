import {
  createClient,
  type Client,
  createPlatformClient,
  type PlatformClient,
} from "@osdk/client";
import { createPublicOauthClient, type PublicOauthClient } from "@osdk/oauth";
import { $ontologyRid } from "@nxg-simulation-execution-testing/sdk";

function getMetaTagContent(tagName: string): string {
  const elements = document.querySelectorAll(`meta[name="${tagName}"]`);
  const element = elements.item(elements.length - 1);
  const value = element ? element.getAttribute("content") : null;
  if (value == null || value === "") {
    throw new Error(`Meta tag ${tagName} not found or empty`);
  }
  if (value.match(/%.+%/)) {
    throw new Error(
      `Meta tag ${tagName} contains placeholder value. Please add ${value.replace(
        /%/g,
        ""
      )} to your .env files`
    );
  }
  return value;
}

// Exported so the raw-fetch byte layer (@acc/decho-basemap) can
// build Foundry REST URLs from the same origin the OSDK clients use. The OSDK
// Files API returns a Blob and gives no way to set a Range header, so ranged
// reads have to go through fetch() directly — but they must never hardcode a
// host.
export const foundryUrl = getMetaTagContent("osdk-foundryUrl");
const clientId = getMetaTagContent("osdk-clientId");
const redirectUrl = getMetaTagContent("osdk-redirectUrl");

// ─── Scopes ────────────────────────────────────────────────────────────────
// api:use-datasets-read covers dataset branches/rows but NOT the Files API.
// The Files API (/v1/datasets/{rid}/files/…) requires the OAuth application
// to be granted explicit resource-level access to the dataset RID inside
// Foundry's Developer Console (Developer Console → your app → Resources).
// The scopes below are necessary but not sufficient — you must also add the
// dataset as a permitted resource in the app registration.
const scopes = [
  "api:use-ontologies-read",
  "api:use-ontologies-write",
  "api:use-datasets-read",   
  "api:use-mediasets-read",
  "api:use-mediasets-write",
  "api:mediasets-read",
  "api:third-party-applications",
  "api:sql-queries-execute",
  "api:sql-queries-read",
  "api:streams-read",
  "api:streams-write",
];

// createPublicOauthClient returns a function (getToken) with .signIn / .signOut
// attached as properties. Calling auth() returns Promise<string> (the access token).
// Calling auth.signIn() triggers the PKCE redirect flow explicitly.
export const auth: PublicOauthClient = createPublicOauthClient(
  clientId,
  foundryUrl,
  redirectUrl,
  { scopes }
);

// Used by object/action/query loaders in foundry.ts
export const client: Client = createClient(foundryUrl, $ontologyRid, auth);

// Used by platform-level APIs (datasets, mediasets, etc.)
export const platformClient: PlatformClient = createPlatformClient(
  foundryUrl,
  auth
);
