import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const helper = fileURLToPath(new URL("./oauth-consent-bridge.py", import.meta.url));
const unavailable = () => ({ ok: false, status: 503, error: "commander_consent_unavailable" });
export const telegramConsentEnabled = () => process.env.SWARM_TELEGRAM_CONSENT === "1";
export const publicOrigin = () =>
  (process.env.SWARM_OAUTH_PUBLIC_ORIGIN || "https://swarm-app.echo-op.com").replace(/\/$/, "");

export function commanderConsent(data) {
  return new Promise((resolve) => {
    const child = spawn(process.env.SWARM_CONSENT_PYTHON || "/usr/bin/python3", [helper], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    let output = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(unavailable());
    }, 20_000);
    const fail = () => {
      child.kill();
      finish(unavailable());
    };
    child.on("error", fail);
    child.stdin.on("error", fail);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 64 * 1024) {
        child.kill();
        finish(unavailable());
      }
    });
    child.on("close", (code) => {
      try {
        finish(code === 0 ? JSON.parse(output) : unavailable());
      } catch {
        finish(unavailable());
      }
    });
    // Secrets travel over a private pipe, never in process arguments or logs.
    child.stdin.end(JSON.stringify(data));
  });
}

function send(res, status, body, type = "text/html; charset=utf-8", headers = {}) {
  res.statusCode = status;
  for (const [name, value] of Object.entries({
    "content-type": type,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    ...headers,
  }))
    res.setHeader(name, value);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

export function consentRedirect(res, location, status = 302) {
  send(res, status, "", "text/plain; charset=utf-8", { location });
}

async function complete(request, res, store, status) {
  const row = await commanderConsent({ action: "complete", request });
  if (!row.ok)
    return send(
      res,
      410,
      "This approval is unavailable or already used. Start the connection again.",
    );
  const client = store.getClient(row.client_id);
  if (
    !client ||
    !client.redirect_uris.includes(row.redirect_uri) ||
    !store.redirectAllowed(row.redirect_uri) ||
    row.resource !== publicOrigin() + "/api/plugin/mcp"
  ) {
    return send(res, 410, "The client registration expired. Start the connection again.");
  }
  const callback = new URL(row.redirect_uri);
  if (row.decision === "denied") callback.searchParams.set("error", "access_denied");
  else if (row.decision === "approved") {
    callback.searchParams.set(
      "code",
      store.issueCode(row.client_id, row.redirect_uri, row.code_challenge, row.scope),
    );
  } else return send(res, 410, "This request has not been approved.");
  if (row.state) callback.searchParams.set("state", row.state);
  consentRedirect(res, callback.toString(), status);
}

export async function handleConsentRoute(req, res, store, readBody) {
  const url = new URL(req.url || "/", publicOrigin());
  const method = req.method || "GET";
  const assets = {
    "/oauth/approval.css": ["css", "text/css"],
    "/oauth/approval-poll.js": ["poll_js", "application/javascript"],
    "/oauth/consent.js": ["consent_js", "application/javascript"],
    "/oauth/consent": ["shell", "text/html"],
  };
  const route =
    assets[url.pathname] || ["/oauth/approve", "/oauth/approval-status"].includes(url.pathname);
  if (!route) return false;
  if (!telegramConsentEnabled()) {
    send(res, 404, "Approval route unavailable.");
    return true;
  }
  if (method === "POST") {
    const origin = req.headers.origin;
    if (origin && origin !== publicOrigin()) {
      send(res, 403, "Invalid approval origin.");
      return true;
    }
  }
  if (method === "GET" && assets[url.pathname]) {
    const result = await commanderConsent({ action: "assets" });
    if (!result.ok) send(res, 503, "Commander approval service unavailable. Retry shortly.");
    else {
      const [key, type] = assets[url.pathname];
      send(res, 200, result[key], type + "; charset=utf-8", result.headers);
    }
    return true;
  }
  const request = url.searchParams.get("request") || "";
  if (method === "GET" && url.pathname === "/oauth/approval-status") {
    const result = await commanderConsent({ action: "status", request });
    send(
      res,
      result.ok ? 200 : result.status || 503,
      { status: result.ok ? result.status : "unavailable" },
      "application/json",
    );
    return true;
  }
  if (method === "POST" && url.pathname === "/oauth/consent") {
    let data;
    try {
      data = JSON.parse(await readBody(req));
    } catch (error) {
      if (error?.code === "BODY_LIMIT") throw error;
      data = {};
    }
    const result = await commanderConsent({
      action: "link",
      token: data?.t,
      decision: data?.action,
    });
    send(
      res,
      result.ok || result.fingerprint ? 200 : result.status || 400,
      result,
      "application/json",
    );
    return true;
  }
  if (url.pathname === "/oauth/approve" && ["GET", "POST"].includes(method)) {
    let rid = request;
    let message = "";
    if (method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      rid = form.get("request") || "";
      const result = await commanderConsent({
        action: "otp",
        request: rid,
        code: form.get("code"),
        source: req.socket?.remoteAddress || "",
      });
      if (result.ok) {
        await complete(rid, res, store, 303);
        return true;
      }
      if (result.status === 503) {
        send(res, 503, "Commander approval service unavailable. Retry shortly.");
        return true;
      }
      message = result.message || "This approval request is unavailable.";
    }
    const page = await commanderConsent({ action: "page", request: rid, message });
    if (page.ok && ["approved", "denied"].includes(page.status))
      await complete(rid, res, store, 302);
    else if (page.ok && page.status === "pending")
      send(res, message ? 401 : 200, page.html, undefined, page.headers);
    else
      send(
        res,
        page.status === 503 ? 503 : 410,
        "This approval request is unavailable or expired. Start the connection again.",
      );
    return true;
  }
  send(res, 405, "Method not allowed.");
  return true;
}
