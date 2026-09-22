import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { PRIVATE_OAUTH_EDITION } from "./edition";
import { runOfficialCli } from "./codex-cli.server";

type Provider = "claude" | "grok";
const active: Record<Provider, number> = { claude: 0, grok: 0 };

function executable(provider: Provider) {
  const configured = process.env[`SWARM_${provider.toUpperCase()}_CLI_BIN`]?.trim();
  if (configured && !isAbsolute(configured))
    throw new Error("Provider CLI paths must be absolute.");
  return configured || (process.platform === "win32" ? `${provider}.exe` : provider);
}

export function subscriptionArguments(provider: Provider, model: string, promptFile: string) {
  if (!new RegExp(`^${provider}-[a-zA-Z0-9._-]{1,90}$`, "u").test(model))
    throw new Error("Select a valid provider model ID.");
  return provider === "claude"
    ? [
        "--print",
        "--model",
        model,
        "--output-format",
        "json",
        "--no-session-persistence",
        "--safe-mode",
        "--restricted",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--disable-slash-commands",
        "--permission-mode",
        "dontAsk",
        "--tools",
        "",
        "--effort",
        "low",
        "--max-budget-usd",
        "0.25",
      ]
    : [
        "--prompt-file",
        promptFile,
        "--model",
        model,
        "--reasoning-effort",
        "low",
        "--output-format",
        "json",
        "--disable-web-search",
        "--no-subagents",
        "--max-turns",
        "1",
        "--permission-mode",
        "dontAsk",
        "--tools",
        "",
        "--verbatim",
        "--system-prompt-override",
        "Answer the supplied Swarm council request. Do not use tools or inspect the host.",
      ];
}

function clientEnvironment(provider: Provider) {
  // The first-party Claude client supports its own subscription token. API keys and alternate-provider overrides remain excluded.
  return provider === "claude" ? ["CLAUDE_CODE_OAUTH_TOKEN"] : [];
}

export async function subscriptionStatus(provider: Provider): Promise<{ ready: boolean }> {
  if (!PRIVATE_OAUTH_EDITION) return { ready: false };
  try {
    const result = await runOfficialCli(
      executable(provider),
      provider === "claude" ? ["auth", "status"] : ["models"],
      tmpdir(),
      "",
      5_000,
      clientEnvironment(provider),
    );
    if (result.code !== 0) return { ready: false };
    if (provider === "grok")
      return { ready: /logged in with grok\.com/iu.test(result.stdout + result.stderr) };
    const status = JSON.parse(result.stdout);
    return {
      ready:
        status.loggedIn === true &&
        status.apiProvider === "firstParty" &&
        /oauth/iu.test(String(status.authMethod)),
    };
  } catch {
    return { ready: false };
  }
}

export function parseSubscriptionOutput(
  provider: Provider,
  requestedModel: string,
  stdout: string,
  exitCode: number,
) {
  const route =
    provider === "claude"
      ? ("claude-code-subscription" as const)
      : ("grok-build-subscription" as const);
  try {
    const payload = JSON.parse(stdout);
    const text: unknown = provider === "claude" ? payload.result : payload.text;
    const complete =
      provider === "claude"
        ? payload.subtype === "success"
        : ["end_turn", "endTurn"].includes(payload.stopReason);
    if (
      exitCode !== 0 ||
      payload.is_error ||
      !complete ||
      typeof text !== "string" ||
      !text.trim()
    ) {
      return {
        ok: false as const,
        error: `${provider} CLI did not return a completed answer. Check its subscription and model access.`,
        route,
      };
    }
    const reported = Object.keys(payload.modelUsage ?? {});
    const model =
      reported.length === 1 && reported[0]?.startsWith(`${provider}-`)
        ? reported[0]
        : requestedModel;
    return {
      ok: true as const,
      text,
      model,
      route,
      toolCalls: [],
      usage: payload.usage
        ? {
            prompt:
              Number(payload.usage.input_tokens ?? 0) +
              Number(payload.usage.cache_read_input_tokens ?? 0) +
              Number(payload.usage.cache_creation_input_tokens ?? 0),
            completion: Number(payload.usage.output_tokens ?? 0),
          }
        : undefined,
    };
  } catch {
    return {
      ok: false as const,
      error: `${provider} CLI returned no readable final response.`,
      route,
    };
  }
}

export async function completeSubscription(opts: {
  provider: Provider;
  model: string;
  system: string;
  messages: { role: string; content: string }[];
}) {
  const { provider } = opts;
  if (!PRIVATE_OAUTH_EDITION)
    return { ok: false as const, error: "The public edition cannot use private CLI sessions." };
  if (active[provider] >= 2)
    return {
      ok: false as const,
      error: `${provider} CLI is busy. Try again after a request finishes.`,
    };
  const prompt = [
    opts.system,
    ...opts.messages.map((message) => `${message.role}:\n${message.content}`),
  ].join("\n\n");
  if (Buffer.byteLength(prompt, "utf8") > 128_000)
    return { ok: false as const, error: "The provider request exceeds the input limit." };
  active[provider]++;
  let directory: string | undefined;
  try {
    if (!(await subscriptionStatus(provider)).ready)
      return {
        ok: false as const,
        error: `Sign into the official ${provider} CLI on the Brain host. A CLI session on another computer needs an approved connection to this service.`,
      };
    directory = await mkdtemp(join(tmpdir(), `echo-swarm-${provider}-`));
    const promptFile = join(directory, "prompt.txt");
    const args = subscriptionArguments(provider, opts.model, promptFile);
    if (provider === "grok") await writeFile(promptFile, prompt, { mode: 0o600, flag: "wx" });
    const result = await runOfficialCli(
      executable(provider),
      args,
      directory,
      provider === "claude" ? prompt : "",
      120_000,
      clientEnvironment(provider),
    );
    return parseSubscriptionOutput(provider, opts.model, result.stdout, result.code ?? 1);
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Provider CLI failed.",
    };
  } finally {
    active[provider]--;
    if (directory && dirname(resolve(directory)) === resolve(tmpdir()))
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
