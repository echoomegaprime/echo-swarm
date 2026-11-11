/**
 * Vite dev plugin: serves the MCP OAuth discovery + a minimal self-contained
 * OAuth2/PKCE + RFC 7591 DCR server for swarm-app, so remote MCP clients (Grok,
 * ChatGPT, Claude) AUTO-REGISTER instead of being asked for manual OAuth creds.
 *
 * Runs before TanStack Start / the SPA fallback (registered in configureServer),
 * mirroring scripts/app-env-plugin.mjs + the vite.config authPopupPlugin. The
 * token store is loaded via ssrLoadModule so it shares the app's module realm.
 */
import nodeCrypto from "node:crypto";

export function oauthAutoRegisterPlugin() {
  return {
    name: "swarm:oauth-autoregister",
    apply: "serve",
    configureServer(server) {
      const originOf = (req) => {
        const host = String(
          req.headers["x-forwarded-host"] ?? req.headers.host ?? "swarm-app.echo-op.com",
        );
        const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0].trim();
        return `${proto}://${host}`;
      };
      const cors = (res) => {
        res.setHeader("access-control-allow-origin", "*");
        res.setHeader("access-control-allow-headers", "*");
        res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      };
      const sendJson = (res, code, obj) => {
        res.statusCode = code;
        res.setHeader("content-type", "application/json");
        cors(res);
        res.end(JSON.stringify(obj));
      };
      const readBody = (req) =>
        new Promise((resolve) => {
          let d = "";
          req.on("data", (c) => (d += c));
          req.on("end", () => resolve(d));
          req.on("error", () => resolve(""));
        });

      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          const isOurs =
            pathOnly.startsWith("/.well-known/oauth") ||
            pathOnly === "/.well-known/openid-configuration" ||
            pathOnly.startsWith("/oauth/");
          if (!isOurs) {
            next();
            return;
          }
          const method = (req.method ?? "GET").toUpperCase();
          if (method === "OPTIONS") {
            res.statusCode = 204;
            cors(res);
            res.end();
            return;
          }
          const origin = originOf(req);
          const store = await server.ssrLoadModule("/src/lib/swarm/oauth-store.ts");

          if (
            method === "GET" &&
            (pathOnly === "/.well-known/oauth-protected-resource" ||
              pathOnly.startsWith("/.well-known/oauth-protected-resource/"))
          ) {
            sendJson(res, 200, {
              resource: origin + "/api/plugin/mcp",
              authorization_servers: [origin],
              scopes_supported: store.OAUTH_SCOPES,
            });
            return;
          }
          if (
            method === "GET" &&
            (pathOnly === "/.well-known/oauth-authorization-server" ||
              pathOnly.startsWith("/.well-known/oauth-authorization-server/") ||
              pathOnly === "/.well-known/openid-configuration" ||
              pathOnly.startsWith("/.well-known/openid-configuration/"))
          ) {
            sendJson(res, 200, {
              issuer: origin,
              authorization_endpoint: origin + "/oauth/authorize",
              token_endpoint: origin + "/oauth/token",
              registration_endpoint: origin + "/oauth/register",
              scopes_supported: store.OAUTH_SCOPES,
              response_types_supported: ["code"],
              grant_types_supported: ["authorization_code", "refresh_token"],
              code_challenge_methods_supported: ["S256"],
              token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
            });
            return;
          }
          if (method === "POST" && pathOnly === "/oauth/register") {
            let b = {};
            try {
              b = JSON.parse((await readBody(req)) || "{}");
            } catch {
              b = {};
            }
            try {
              const c = store.registerClient(b.redirect_uris || []);
              sendJson(res, 201, {
                client_id: c.client_id,
                redirect_uris: c.redirect_uris,
                token_endpoint_auth_method: "none",
                grant_types: ["authorization_code", "refresh_token"],
                response_types: ["code"],
              });
            } catch {
              sendJson(res, 400, { error: "invalid_redirect_uri" });
            }
            return;
          }
          if ((method === "GET" || method === "POST") && pathOnly === "/oauth/authorize") {
            // Owner consent gate: a code is only issued after the operator proves
            // possession of SWARM_MCP_TOKEN. Fails closed when it is unset.
            let q = new URL(rawUrl, origin).searchParams;
            let ownerKey = "";
            if (method === "POST") {
              q = new URLSearchParams(await readBody(req));
              ownerKey = (q.get("owner_key") || "").trim();
            }
            const client_id = q.get("client_id");
            const redirect_uri = q.get("redirect_uri");
            const challenge = q.get("code_challenge");
            const state = q.get("state") || "";
            const scope = q.get("scope") || "";
            const client = store.getClient(client_id);
            if (
              !client ||
              !redirect_uri ||
              !client.redirect_uris.includes(redirect_uri) ||
              !store.redirectAllowed(redirect_uri) ||
              !challenge
            ) {
              sendJson(res, 400, { error: "invalid_request" });
              return;
            }
            const expected = String(process.env.SWARM_MCP_TOKEN || "").trim();
            if (expected.length < 16) {
              sendJson(res, 503, { error: "owner_consent_unconfigured" });
              return;
            }
            const a = Buffer.from(ownerKey, "utf8");
            const b = Buffer.from(expected, "utf8");
            const consented =
              method === "POST" && a.length === b.length && nodeCrypto.timingSafeEqual(a, b);
            if (!consented) {
              const esc = (v) =>
                String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
              const hidden = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"]
                .map((k) => `<input type="hidden" name="${k}" value="${esc(q.get(k))}">`)
                .join("");
              const bad = method === "POST";
              res.statusCode = bad ? 401 : 200;
              res.setHeader("content-type", "text/html; charset=utf-8");
              res.setHeader("cache-control", "no-store");
              res.setHeader("x-frame-options", "DENY");
              res.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
              res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize Echo Swarm</title>
<style>body{font-family:system-ui,sans-serif;max-width:440px;margin:10vh auto;padding:0 16px;color:#111}input[type=password]{width:100%;padding:10px;font-size:15px;box-sizing:border-box}button{margin-top:12px;padding:10px 18px;font-size:15px}.e{color:#b00020}code{word-break:break-all}</style></head>
<body><h2>Authorize Echo Swarm</h2><p>Client <code>${esc(client_id)}</code> requests <code>${esc(scope || "swarm.read swarm.write")}</code>.</p>
<p>Redirect: <code>${esc(redirect_uri)}</code></p>${bad ? '<p class="e">Owner key rejected.</p>' : ""}
<form method="post" action="/oauth/authorize">${hidden}<label>Owner key<br><input type="password" name="owner_key" autocomplete="current-password" autofocus required></label><br><button type="submit">Approve</button></form></body></html>`);
              return;
            }
            const code = store.issueCode(client_id, redirect_uri, challenge, scope);
            const loc = new URL(redirect_uri);
            loc.searchParams.set("code", code);
            if (state) loc.searchParams.set("state", state);
            res.statusCode = 302;
            res.setHeader("location", loc.toString());
            res.setHeader("cache-control", "no-store");
            cors(res);
            res.end();
            return;
          }
          if (method === "POST" && pathOnly === "/oauth/token") {
            const form = new URLSearchParams(await readBody(req));
            const gt = form.get("grant_type");
            if (gt === "authorization_code") {
              const r = store.exchangeCode(
                form.get("code") || "",
                form.get("code_verifier") || "",
                form.get("redirect_uri") || "",
                form.get("client_id") || "",
              );
              if (r.error) {
                sendJson(res, 400, { error: r.error });
                return;
              }
              sendJson(res, 200, {
                access_token: r.access,
                token_type: "Bearer",
                expires_in: 3600,
                refresh_token: r.refresh,
                scope: r.scope,
              });
              return;
            }
            if (gt === "refresh_token") {
              const r = store.refreshToken(form.get("refresh_token") || "", form.get("client_id") || "");
              if (r.error) {
                sendJson(res, 400, { error: r.error });
                return;
              }
              sendJson(res, 200, {
                access_token: r.access,
                token_type: "Bearer",
                expires_in: 3600,
                scope: r.scope,
              });
              return;
            }
            sendJson(res, 400, { error: "unsupported_grant_type" });
            return;
          }
          next();
        } catch (err) {
          console.error("[swarm:oauth] handler failed:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "server_error" }));
          }
        }
      });
      server.config.logger.info("[swarm:oauth] auto-register middleware active");
    },
  };
}
