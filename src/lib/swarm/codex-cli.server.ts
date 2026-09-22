import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { PRIVATE_OAUTH_EDITION } from "./edition";

const MAX_INPUT_BYTES = 128_000;
const MAX_OUTPUT_BYTES = 1_048_576;
const MAX_CONCURRENT = 2;
let active = 0;

export function usesCodexSubscription(): boolean {
  return PRIVATE_OAUTH_EDITION;
}

function executable(): string {
  const configured = process.env.SWARM_CODEX_CLI_BIN?.trim();
  if (configured && !isAbsolute(configured)) {
    throw new Error("SWARM_CODEX_CLI_BIN must be an absolute executable path.");
  }
  return configured || "codex";
}

/** The official client resolves its own login. Provider keys never enter this child. */
export function codexEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const names = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "CODEX_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "SSL_CERT_FILE",
    "NODE_EXTRA_CA_CERTS",
  ];
  return Object.fromEntries(names.flatMap((name) => (source[name] ? [[name, source[name]]] : [])));
}

export function codexArguments(model: string): string[] {
  if (!/^(?:gpt-|o[134](?:-|$))[a-zA-Z0-9._-]{0,90}$/u.test(model)) {
    throw new Error("Select a valid OpenAI model ID for Codex.");
  }
  return [
    "exec",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--json",
    "--color",
    "never",
    "--model",
    model,
    "-c",
    'approval_policy="never"',
    "-c",
    'model_provider="openai"',
    "-c",
    'model_reasoning_effort="low"',
    "-c",
    'web_search="disabled"',
    "-c",
    "mcp_servers={}",
    "--disable",
    "shell_tool",
    "--disable",
    "browser_use",
    "--disable",
    "browser_use_external",
    "--disable",
    "computer_use",
    "--disable",
    "image_generation",
    "--disable",
    "multi_agent",
    "--disable",
    "plugins",
    "--disable",
    "apps",
    "--disable",
    "view_image",
    "-",
  ];
}

function safeError(raw: string): { error: string; fallbackEligible: boolean } {
  if (/usage limit|quota|credits|rate.?limit/iu.test(raw)) {
    return {
      error:
        "Codex subscription usage is unavailable. Check https://chatgpt.com/codex/settings/usage.",
      fallbackEligible: true,
    };
  }
  if (/newer version|upgrade/iu.test(raw))
    return { error: "Update the host's Codex CLI to use this model.", fallbackEligible: true };
  if (/not supported|not available|model_not_found/iu.test(raw))
    return {
      error: "This model is unavailable to the signed-in Codex account.",
      fallbackEligible: true,
    };
  if (/log.?in|auth|401/iu.test(raw))
    return {
      error: "Sign into the host's official Codex CLI with ChatGPT.",
      fallbackEligible: true,
    };
  return {
    error:
      "The Codex subprocess failed. Check the host's Codex installation and subscription status.",
    fallbackEligible: false,
  };
}

export function runOfficialCli(
  command: string,
  args: string[],
  cwd: string,
  input: string,
  timeoutMs: number,
  extraEnvironmentNames: string[] = [],
) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...codexEnvironment(),
        ...Object.fromEntries(
          extraEnvironmentNames.flatMap((name) =>
            process.env[name] ? [[name, process.env[name]]] : [],
          ),
        ),
      },
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let bytes = 0;
    let failure: Error | undefined;
    function stop(message: string) {
      failure ??= new Error(message);
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else if (child.pid) {
        // Fixed argument array; no prompt or caller-supplied executable reaches a shell.
        spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          shell: false,
          windowsHide: true,
          stdio: "ignore",
        }).on("error", () => child.kill());
      }
    }
    const timer = setTimeout(
      () =>
        stop(
          "The provider CLI timed out; the subprocess tree was stopped. No API fallback was attempted.",
        ),
      timeoutMs,
    );
    function collect(chunk: Buffer, errorStream: boolean) {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        stop("The provider CLI exceeded the response limit.");
        return;
      }
      if (errorStream) stderr += stderrDecoder.write(chunk);
      else stdout += stdoutDecoder.write(chunk);
    }
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, false));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, true));
    child.stdin.on("error", () => {
      /* Close/error below owns the result. */
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("The host's provider CLI executable could not be started."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else
        resolve({
          code,
          stdout: stdout + stdoutDecoder.end(),
          stderr: stderr + stderrDecoder.end(),
        });
    });
    child.stdin.end(input);
  });
}

export async function codexSubscriptionStatus(): Promise<{ ready: boolean; route: string }> {
  if (!usesCodexSubscription()) return { ready: false, route: "api" };
  try {
    const result = await runOfficialCli(executable(), ["login", "status"], tmpdir(), "", 5_000);
    return {
      ready: result.code === 0 && /logged in using ChatGPT/iu.test(result.stdout + result.stderr),
      route: "codex-cli-subscription",
    };
  } catch {
    return { ready: false, route: "codex-cli-subscription" };
  }
}

export function parseCodexOutput(
  stdout: string,
  requestedModel: string,
  stderr = "",
  exitCode = 0,
) {
  let text = "";
  let completed = false;
  let failure: { error: string; fallbackEligible: boolean } | undefined;
  let usage: { prompt: number; completion: number } | undefined;
  for (const line of stdout.split(/\r?\n/u)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      text = typeof event.item.text === "string" ? event.item.text : text;
    }
    if (event.type === "turn.completed") {
      completed = true;
      if (event.usage)
        usage = {
          prompt: Number(event.usage.input_tokens) || 0,
          completion: Number(event.usage.output_tokens) || 0,
        };
    }
    if (event.type === "turn.failed" || event.type === "error") {
      failure = safeError(String(event.error?.message ?? event.message ?? ""));
    }
  }
  if (!failure && exitCode !== 0) failure = safeError(stderr);
  if (failure || !completed || !text.trim()) {
    return {
      ok: false as const,
      error: failure?.error || "Codex returned no completed answer.",
      fallbackEligible: !text.trim() && !completed && Boolean(failure?.fallbackEligible),
    };
  }
  return {
    ok: true as const,
    text,
    usage,
    model: requestedModel,
    route: "codex-cli-subscription" as const,
  };
}

export async function completeCodex(opts: {
  model: string;
  system: string;
  messages: { role: string; content: string }[];
}) {
  if (!usesCodexSubscription())
    return {
      ok: false as const,
      error: "The public edition requires its own API connection.",
      fallbackEligible: false,
    };
  if (active >= MAX_CONCURRENT)
    return {
      ok: false as const,
      error: "Codex is busy with two requests. Try again after one finishes.",
      fallbackEligible: false,
    };
  const prompt = [
    "Answer this Swarm council request using only the supplied text. Do not use tools or inspect the host. Return the answer directly.",
    opts.system,
    ...opts.messages.map((message) => `${message.role}:\n${message.content}`),
  ].join("\n\n");
  if (Buffer.byteLength(prompt, "utf8") > MAX_INPUT_BYTES)
    return {
      ok: false as const,
      error: "The Codex request exceeds the input limit.",
      fallbackEligible: false,
    };
  active += 1;
  let directory: string | undefined;
  try {
    const args = codexArguments(opts.model);
    const status = await codexSubscriptionStatus();
    if (!status.ready)
      return {
        ok: false as const,
        error:
          "Sign into the host's official Codex CLI with ChatGPT. API credentials are not used for this route.",
        fallbackEligible: true,
      };
    directory = await mkdtemp(join(tmpdir(), "echo-swarm-codex-"));
    const result = await runOfficialCli(executable(), args, directory, prompt, 120_000);
    return parseCodexOutput(result.stdout, opts.model, result.stderr, result.code ?? 1);
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Codex failed.",
      fallbackEligible: false,
    };
  } finally {
    active -= 1;
    if (directory && dirname(resolve(directory)) === resolve(tmpdir())) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
