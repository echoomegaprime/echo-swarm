#!/usr/bin/env node
/**
 * Live smoke against Swarm MCP. Usage:
 *   SWARM_ORIGIN=https://swarm-app.echo-op.com node scripts/swarm-mcp-smoke.mjs
 * Optional: SWARM_MCP_TOKEN, SWARM_AGENT (default claude)
 */
const origin = (process.env.SWARM_ORIGIN || "https://swarm-app.echo-op.com").replace(/\/+$/, "");
const agent = process.env.SWARM_AGENT || "claude";
const token = process.env.SWARM_MCP_TOKEN?.trim();

const headers = {
  "content-type": "application/json",
  "x-echo-agent": agent,
};
if (token) headers.authorization = `Bearer ${token}`;

async function rpc(method, params, id = 1) {
  const res = await fetch(`${origin}/api/plugin/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

const fails = [];
function check(name, ok, detail) {
  if (ok) console.log(`PASS ${name}`);
  else {
    console.error(`FAIL ${name}`, detail || "");
    fails.push(name);
  }
}

const unauth = await fetch(`${origin}/api/plugin/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list" }),
});
check("auth_required", unauth.status === 401 || unauth.status === 403, `status=${unauth.status}`);

const init = await rpc("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "swarm-mcp-smoke", version: "1" },
});
check("initialize", init.status === 200 && init.body?.result?.serverInfo?.name, init.body);

const list = await rpc("tools/list", {}, 2);
const names = (list.body?.result?.tools || []).map((t) => t.name);
check(
  "tools_list",
  [
    "swarm_ping",
    "swarm_brief",
    "swarm_convene",
    "swarm_brain_health",
    "swarm_brain_think",
    "swarm_brain_trinity_consult",
    "swarm_brain_trinity_decide",
    "swarm_brain_hybrid",
    "swarm_maximalist_health",
    "swarm_maximalist_start",
    "swarm_maximalist_result",
    "swarm_maximalist_resume",
  ].every((name) => names.includes(name)),
  names,
);

const ping = await rpc("tools/call", { name: "swarm_ping", arguments: {} }, 3);
const pingText = ping.body?.result?.content?.[0]?.text || "";
let pingJson = {};
try {
  pingJson = JSON.parse(pingText);
} catch {
  /* ignore */
}
check("swarm_ping", ping.status === 200 && typeof pingJson === "object", pingText.slice(0, 200));

const maximalistHealth = await rpc(
  "tools/call",
  { name: "swarm_maximalist_health", arguments: {} },
  4,
);
check(
  "swarm_maximalist_health",
  maximalistHealth.status === 200 &&
    maximalistHealth.body?.result?.structuredContent?.ok === true &&
    maximalistHealth.body?.result?.structuredContent?.profile === "live",
  maximalistHealth.body,
);

const icon = await fetch(`${origin}/__grok/icon-180.png`);
check("icon_180", icon.status === 200 && (icon.headers.get("content-type") || "").includes("png"));

if (fails.length) {
  console.error(`SMOKE FAILED ${fails.length}: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("SMOKE OK", { origin, agent, forge: pingJson.forge });
