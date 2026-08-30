import type { AuthModes, ProviderKeys } from "./catalog";

export const SWARM_EDITIONS = ["private-oauth", "public-api"] as const;
export type SwarmEdition = (typeof SWARM_EDITIONS)[number];

export function parseSwarmEdition(value: unknown): SwarmEdition {
  return value === "public-api" ? "public-api" : "private-oauth";
}

function runtimeEdition(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env.ECHO_SWARM_EDITION?.trim();
}

/**
 * The deployment may select an edition at process start. Browser bundles use
 * the VITE-prefixed value baked by scripts/build-edition.mjs.
 */
export const SWARM_EDITION = parseSwarmEdition(
  runtimeEdition() ?? import.meta.env.VITE_ECHO_SWARM_EDITION,
);

export const PRIVATE_OAUTH_EDITION = SWARM_EDITION === "private-oauth";
export const PUBLIC_API_EDITION = SWARM_EDITION === "public-api";

export const EDITION_LABEL = PRIVATE_OAUTH_EDITION
  ? "Private · OAuth"
  : "Public · Bring your API keys";

const REMOTE_SECRET_FIELDS = [
  "grok",
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "mistral",
  "openrouter",
  "groq",
  "together",
  "samba",
  "cerebras",
  "fireworks",
  "perplexity",
  "cohere",
  "github",
] as const satisfies readonly (keyof ProviderKeys)[];

export const REMOTE_PROVIDER_SECRET_FIELDS: readonly (keyof ProviderKeys)[] =
  REMOTE_SECRET_FIELDS;

/** Public builds must never borrow private server-side remote credentials. */
export function allowsServerRemoteCredentials(): boolean {
  return PRIVATE_OAUTH_EDITION;
}

/** Private MCP calls do not accept caller-supplied provider API-key headers. */
export function providerKeysForEdition(keys: ProviderKeys): ProviderKeys {
  if (PUBLIC_API_EDITION) return keys;
  // Private MCP/HTTP callers cannot inject provider secrets, local node URLs,
  // model ids, or routing hints. The authoritative service resolves all of
  // those from its approved runtime; the visible same-origin UI has a separate
  // typed server-function path for its ephemeral OAuth/session credentials.
  return {};
}

export function authModesForEdition(auth: AuthModes): AuthModes {
  if (PRIVATE_OAUTH_EDITION) {
    return {
      grok: "oauth",
      openai: "oauth",
      anthropic: "oauth",
      deepseek: "oauth",
      github: "oauth",
    };
  }
  return {
    grok: "key",
    openai: "key",
    anthropic: "key",
    deepseek: "key",
    github: "key",
    ...auth,
  };
}
