/**
 * Shared LIVE-PREVIEW OAuth metadata.
 *
 * The sandbox serves each live preview on a dynamic `https://*.grok-sandbox.com`
 * URL, which can't be pre-registered per app. The broker instead exposes ONE
 * shared "preview" client that accepts any
 * `https://*.grok-sandbox.com/api/auth/oauth2/callback/*`
 * (broker: `app-builder-deployer/auth/src/preview-oauth.ts`). The public client
 * id and callback allowlist are safe to version here. The corresponding secret
 * must be injected server-side as `GROK_PREVIEW_CLIENT_SECRET`; it must never be
 * committed or bundled. When deployed the deployer injects a per-app
 * `GROK_AUTH_*` pair instead (see `server.ts`).
 *
 * This id must equal the broker's `GROK_PREVIEW_CLIENT_ID`. The dedicated,
 * low-privilege secret is resolved only from the server runtime environment.
 */
export const PREVIEW_CLIENT_ID = "grok_preview";

/** The shared auth broker issuer (OIDC discovery lives under it). */
export const GROK_ISSUER_DEFAULT = "https://auth.grok.me";

/**
 * Host patterns whose callbacks the preview client accepts. Better Auth derives
 * the live preview's real origin from the request host and validates it against
 * this list (wildcard-matched), so the OAuth `redirect_uri` becomes the concrete
 * `https://<preview-host>/api/auth/oauth2/callback/...` the broker allows.
 */
export const PREVIEW_ALLOWED_HOSTS = ["*.grok-sandbox.com"] as const;
