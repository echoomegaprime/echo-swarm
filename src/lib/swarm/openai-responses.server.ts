interface FunctionCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: FunctionCall[];
}

export function responsesInput(messages: Message[]): Record<string, unknown>[] {
  return messages.flatMap((message) => {
    if (message.role === "tool") {
      return [
        { type: "function_call_output", call_id: message.toolCallId, output: message.content },
      ];
    }
    const items: Record<string, unknown>[] = [];
    if (message.content) items.push({ role: message.role, content: message.content });
    for (const call of message.toolCalls ?? []) {
      items.push({
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.args),
      });
    }
    return items;
  });
}

export async function completeOpenAIResponses(opts: {
  key: string;
  model: string;
  system: string;
  messages: Message[];
  tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
  maxTokens?: number;
  onDelta?: (text: string) => void;
}) {
  const route = "openai-api" as const;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.key}` },
      body: JSON.stringify({
        model: opts.model,
        instructions: opts.system,
        input: responsesInput(opts.messages),
        store: false,
        max_output_tokens: Math.min(8192, Math.max(2048, opts.maxTokens ?? 2048)),
        ...(/^(gpt-(?:5|6)|o[134])/u.test(opts.model) ? { reasoning: { effort: "low" } } : {}),
        ...(opts.tools?.length
          ? { tools: opts.tools.map((tool) => ({ type: "function", ...tool, strict: false })) }
          : {}),
      }),
    });
    if (!response.ok) {
      // Provider error bodies can contain credential fragments or private project details.
      await response.body?.cancel();
      const hint =
        response.status === 429
          ? "Check the API project's credits and rate limits at https://platform.openai.com/settings/organization/billing/overview."
          : response.status === 401 || response.status === 403
            ? "Check the API key and this project's access to the selected model."
            : "Check that the selected model supports the Responses API.";
      return {
        ok: false as const,
        error: `GPT API returned HTTP ${response.status}. ${hint}`,
        route,
      };
    }
    if (!response.body)
      return { ok: false as const, error: "GPT API returned no response body.", route };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) {
        await reader.cancel();
        return { ok: false as const, error: "GPT API exceeded the response limit.", route };
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      status?: string;
      model?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
      output?: {
        type?: string;
        call_id?: string;
        name?: string;
        arguments?: string;
        content?: { type?: string; text?: string }[];
      }[];
    };
    if (body.status !== "completed" || !Array.isArray(body.output)) {
      return {
        ok: false as const,
        error: "GPT API did not complete the response. No automatic retry was made.",
        route,
      };
    }
    const text = body.output
      .flatMap((item) =>
        item.type === "message"
          ? (item.content ?? [])
              .filter((part) => part.type === "output_text")
              .map((part) => part.text ?? "")
          : [],
      )
      .join("\n");
    const toolCalls: FunctionCall[] = [];
    for (const item of body.output) {
      if (item.type !== "function_call" || !item.call_id || !item.name) continue;
      const args: unknown = JSON.parse(item.arguments ?? "{}");
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        return { ok: false as const, error: "GPT API returned invalid tool arguments.", route };
      }
      toolCalls.push({ id: item.call_id, name: item.name, args: args as Record<string, unknown> });
    }
    if (!text.trim() && !toolCalls.length)
      return { ok: false as const, error: "GPT API returned no answer.", route };
    opts.onDelta?.(text);
    return {
      ok: true as const,
      text,
      toolCalls,
      route,
      model: body.model || opts.model,
      usage: body.usage
        ? { prompt: body.usage.input_tokens ?? 0, completion: body.usage.output_tokens ?? 0 }
        : undefined,
    };
  } catch {
    return {
      ok: false as const,
      error: "The GPT API request failed or timed out. No automatic retry was made.",
      route,
    };
  } finally {
    clearTimeout(timer);
  }
}
