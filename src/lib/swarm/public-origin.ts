function configuredPublicOrigin(): string | undefined {
  const configured = process.env.ECHO_PUBLIC_BASE_URL?.trim();
  if (!configured) return undefined;

  const url = new URL(configured);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("ECHO_PUBLIC_BASE_URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("ECHO_PUBLIC_BASE_URL must not contain credentials.");
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error("ECHO_PUBLIC_BASE_URL must be an origin without a path, query, or fragment.");
  }
  return url.origin;
}

/**
 * Return the externally reachable origin for generated manifests and artifact
 * links. Production pins this explicitly so reverse-proxy transport details or
 * attacker-controlled forwarded headers cannot downgrade an HTTPS URL.
 */
export function publicOriginForRequest(request: Pick<Request, "url">): string {
  return configuredPublicOrigin() ?? new URL(request.url).origin;
}
