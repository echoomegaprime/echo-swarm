export const MODEL_IDS = [
  "grok",
  "gpt",
  "claude",
  "gemini",
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
  "qwen",
  "qwenimg",
] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export const MODES = ["parallel", "roundtable", "debate", "conductor", "buildheavy"] as const;
export type SwarmMode = (typeof MODES)[number];

export const AUTH_MODES = ["oauth", "key"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export type SeatGroup = "cloud" | "router" | "speed" | "search" | "github" | "fleet";

export type KeyField =
  | "grok"
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "mistral"
  | "openrouter"
  | "groq"
  | "together"
  | "samba"
  | "cerebras"
  | "fireworks"
  | "perplexity"
  | "cohere"
  | "github"
  | "forge"
  | "temper";

export const KEY_FIELDS: KeyField[] = [
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
  "forge",
  "temper",
];

export type OAuthField = "grok" | "openai" | "anthropic" | "deepseek" | "github";

export interface ModelDef {
  id: ModelId;
  name: string;
  lab: string;
  model: string;
  monogram: string;
  voice: string;
  kind: "openai" | "anthropic" | "gemini" | "local";
  group: SeatGroup;
  url?: string;
  keyField: KeyField;
  oauth?: boolean;
  oauthLabel?: string;
  keyLabel?: string;
  urlField?: "forgeUrl" | "temperUrl";
  modelField?: "forgeModel" | "temperModel";
  defaultUrl?: string;
  node?: string;
  image?: boolean;
  extraHeaders?: Record<string, string>;
  envVars?: string[];
}

export interface ProviderKeys {
  grok?: string;
  openai?: string;
  anthropic?: string;
  google?: string;
  deepseek?: string;
  mistral?: string;
  openrouter?: string;
  groq?: string;
  together?: string;
  samba?: string;
  cerebras?: string;
  fireworks?: string;
  perplexity?: string;
  cohere?: string;
  github?: string;
  forge?: string;
  forgeUrl?: string;
  forgeModel?: string;
  temper?: string;
  temperUrl?: string;
  temperModel?: string;
}

export type AuthModes = Partial<Record<OAuthField, AuthMode>>;

export const DEFAULT_AUTH: Record<OAuthField, AuthMode> = {
  grok: "oauth",
  openai: "oauth",
  anthropic: "oauth",
  deepseek: "oauth",
  github: "oauth",
};

/** Local FORGE OpenAI-compatible base (loopback on the swarm host). */
export const FORGE_DEFAULT_URL = "http://127.0.0.1:11435/v1";
export const FORGE_DEFAULT_MODEL = "huihui_ai/qwen2.5-coder-abliterate:3b";
export const TEMPER_DEFAULT_MODEL = "qwen3-image";

export const GITHUB_MODELS_URL = "https://models.github.ai/inference/chat/completions";
export const GITHUB_FALLBACK: Partial<Record<ModelId, string>> = {
  gpt: "openai/gpt-5.6-sol",
  claude: "anthropic/claude-sonnet-5",
  github: "openai/gpt-5.6-sol",
};

export const GROUP_META: { id: SeatGroup; label: string }[] = [
  { id: "cloud", label: "Cloud" },
  { id: "router", label: "Routers" },
  { id: "speed", label: "Speed" },
  { id: "search", label: "Search" },
  { id: "github", label: "GitHub CLI" },
  { id: "fleet", label: "Fleet" },
];

export const MODELS: Record<ModelId, ModelDef> = {
  grok: {
    id: "grok",
    name: "Grok",
    lab: "xAI",
    model: "grok-4.6",
    monogram: "X",
    voice: "Irreverent synthesis. Cut through nonsense.",
    kind: "openai",
    group: "cloud",
    url: "https://api.x.ai/v1/chat/completions",
    keyField: "grok",
    oauth: true,
    oauthLabel: "Grok OAuth",
    keyLabel: "xAI API key",
    envVars: ["XAI_API_KEY"],
  },
  gpt: {
    id: "gpt",
    name: "GPT",
    lab: "OpenAI",
    model: "gpt-5.6-sol",
    monogram: "O",
    voice: "Structured plans. Precise coding.",
    kind: "openai",
    group: "cloud",
    url: "https://api.openai.com/v1/chat/completions",
    keyField: "openai",
    oauth: true,
    oauthLabel: "Codex / ChatGPT OAuth",
    keyLabel: "OpenAI API key",
    envVars: ["OPENAI_API_KEY"],
  },
  claude: {
    id: "claude",
    name: "Claude",
    lab: "Anthropic",
    model: "claude-sonnet-5",
    monogram: "C",
    voice: "Careful reasoning. Strong writing. Honest uncertainty.",
    kind: "anthropic",
    group: "cloud",
    keyField: "anthropic",
    oauth: true,
    oauthLabel: "Claude Code OAuth",
    keyLabel: "Anthropic API key",
    envVars: ["ANTHROPIC_API_KEY"],
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    lab: "Google",
    model: "gemini-3.7-flash",
    monogram: "G",
    voice: "Wide knowledge. Fast long-context synthesis.",
    kind: "gemini",
    group: "cloud",
    keyField: "google",
    keyLabel: "Google AI Studio key",
    envVars: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    lab: "DeepSeek",
    model: "deepseek-v4-flash",
    monogram: "D",
    voice: "Math, code, and terse chain-of-thought.",
    kind: "openai",
    group: "cloud",
    url: "https://api.deepseek.com/chat/completions",
    keyField: "deepseek",
    oauth: true,
    oauthLabel: "DeepSeek OAuth",
    keyLabel: "DeepSeek API key",
    envVars: ["DEEPSEEK_API_KEY"],
  },
  mistral: {
    id: "mistral",
    name: "Mistral",
    lab: "Mistral",
    model: "mistral-large-latest",
    monogram: "M",
    voice: "European precision. Strong multilingual code.",
    kind: "openai",
    group: "cloud",
    url: "https://api.mistral.ai/v1/chat/completions",
    keyField: "mistral",
    keyLabel: "Mistral API key",
    envVars: ["MISTRAL_API_KEY"],
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    lab: "OpenRouter",
    model: "openrouter/auto",
    monogram: "R",
    voice: "One key, many labs. Route to whoever is cheapest and up.",
    kind: "openai",
    group: "router",
    url: "https://openrouter.ai/api/v1/chat/completions",
    keyField: "openrouter",
    keyLabel: "OpenRouter key",
    extraHeaders: {
      "HTTP-Referer": "https://swarm.echo-op.com",
      "X-Title": "Swarm",
    },
    envVars: ["OPENROUTER_API_KEY"],
  },
  groq: {
    id: "groq",
    name: "Groq",
    lab: "Groq",
    model: "openai/gpt-oss-120b",
    monogram: "K",
    voice: "LPU speed. Instant 70B. No waiting.",
    kind: "openai",
    group: "speed",
    url: "https://api.groq.com/openai/v1/chat/completions",
    keyField: "groq",
    keyLabel: "Groq API key",
    envVars: ["GROQ_API_KEY"],
  },
  together: {
    id: "together",
    name: "Together",
    lab: "Together AI",
    model: "deepseek-ai/DeepSeek-V4-Flash",
    monogram: "W",
    voice: "Open-weight turbo. Cheap dense inference at scale.",
    kind: "openai",
    group: "speed",
    url: "https://api.together.xyz/v1/chat/completions",
    keyField: "together",
    keyLabel: "Together API key",
    envVars: ["TOGETHER_API_KEY"],
  },
  samba: {
    id: "samba",
    name: "SambaNova",
    lab: "SambaNova",
    model: "DeepSeek-V3.1",
    monogram: "S",
    voice: "RDU hardware. Big Llama, low latency.",
    kind: "openai",
    group: "speed",
    url: "https://api.sambanova.ai/v1/chat/completions",
    keyField: "samba",
    keyLabel: "SambaNova key",
    envVars: ["SAMBANOVA_API_KEY"],
  },
  cerebras: {
    id: "cerebras",
    name: "Cerebras",
    lab: "Cerebras",
    model: "gpt-oss-120b",
    monogram: "B",
    voice: "Wafer-scale. Tokens per second as a weapon.",
    kind: "openai",
    group: "speed",
    url: "https://api.cerebras.ai/v1/chat/completions",
    keyField: "cerebras",
    keyLabel: "Cerebras API key",
    envVars: ["CEREBRAS_API_KEY"],
  },
  fireworks: {
    id: "fireworks",
    name: "Fireworks",
    lab: "Fireworks",
    model: "accounts/fireworks/models/gpt-oss-120b",
    monogram: "I",
    voice: "Fast open-weight serving. Production firehose.",
    kind: "openai",
    group: "speed",
    url: "https://api.fireworks.ai/inference/v1/chat/completions",
    keyField: "fireworks",
    keyLabel: "Fireworks key",
    envVars: ["FIREWORKS_API_KEY"],
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity",
    lab: "Perplexity",
    model: "sonar-pro",
    monogram: "P",
    voice: "Live web. Cite sources. No vibes without a link.",
    kind: "openai",
    group: "search",
    url: "https://api.perplexity.ai/chat/completions",
    keyField: "perplexity",
    keyLabel: "Perplexity key",
    envVars: ["PERPLEXITY_API_KEY", "PPLX_API_KEY"],
  },
  cohere: {
    id: "cohere",
    name: "Cohere",
    lab: "Cohere",
    model: "command-a-plus-05-2026",
    monogram: "E",
    voice: "Enterprise RAG. Grounded, citation-first.",
    kind: "openai",
    group: "search",
    url: "https://api.cohere.ai/compatibility/v1/chat/completions",
    keyField: "cohere",
    keyLabel: "Cohere API key",
    envVars: ["COHERE_API_KEY"],
  },
  github: {
    id: "github",
    name: "Copilot",
    lab: "GitHub",
    model: "openai/gpt-5.6-sol",
    monogram: "H",
    voice: "GitHub Models. One gh token, many labs.",
    kind: "openai",
    group: "github",
    url: GITHUB_MODELS_URL,
    keyField: "github",
    oauth: true,
    oauthLabel: "GitHub CLI OAuth",
    keyLabel: "GitHub PAT",
    envVars: ["GITHUB_TOKEN", "GH_TOKEN"],
  },
  qwen: {
    id: "qwen",
    name: "Qwen 28B",
    lab: "FORGE",
    model: FORGE_DEFAULT_MODEL,
    monogram: "F",
    voice: "Local dense coder. Uncensored, long context, owns the metal.",
    kind: "local",
    group: "fleet",
    keyField: "forge",
    urlField: "forgeUrl",
    modelField: "forgeModel",
    defaultUrl: FORGE_DEFAULT_URL,
    node: "FORGE",
    envVars: ["FORGE_BASE_URL", "FORGE_QWEN_URL"],
  },
  qwenimg: {
    id: "qwenimg",
    name: "Qwen Image",
    lab: "TEMPER",
    model: TEMPER_DEFAULT_MODEL,
    monogram: "T",
    voice: "Local vision and image. Describe, critique, and render.",
    kind: "local",
    group: "fleet",
    keyField: "temper",
    urlField: "temperUrl",
    modelField: "temperModel",
    node: "TEMPER",
    image: true,
    envVars: ["TEMPER_BASE_URL", "TEMPER_QWEN_URL"],
  },
};

export function idsIn(group: SeatGroup): ModelId[] {
  return MODEL_IDS.filter((id) => MODELS[id].group === group);
}

export const CLOUD_IDS = idsIn("cloud");
export const FLEET_IDS = idsIn("fleet");
export const SPEED_IDS = idsIn("speed");
export const ROUTER_IDS = idsIn("router");
export const SEARCH_IDS = idsIn("search");
export const DEFAULT_SEATS: ModelId[] = ["grok", "gpt", "claude", "gemini", "deepseek"];

export interface ModelVariant {
  id: string;
  label: string;
}

export type Picks = Partial<Record<ModelId, string>>;

export const VARIANTS: Record<ModelId, ModelVariant[]> = {
  grok: [
    { id: "grok-4.6", label: "Grok 4.6" },
    { id: "grok-4.5", label: "Grok 4.5" },
    { id: "grok-4.3", label: "Grok 4.3" },
    { id: "grok-4-1-fast", label: "Grok 4.1 Fast" },
    { id: "grok-4", label: "Grok 4" },
    { id: "grok-3", label: "Grok 3" },
    { id: "grok-3-mini", label: "Grok 3 Mini" },
    { id: "grok-3-fast", label: "Grok 3 Fast" },
  ],
  gpt: [
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { id: "gpt-5.6", label: "GPT-5.6" },
    { id: "gpt-5.4", label: "GPT-5.4" },
    { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { id: "gpt-5.1", label: "GPT-5.1" },
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-5-mini", label: "GPT-5 Mini" },
    { id: "gpt-5-nano", label: "GPT-5 Nano" },
    { id: "o3", label: "o3" },
    { id: "o3-pro", label: "o3 Pro" },
    { id: "o4-mini", label: "o4-mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini" },
  ],
  claude: [
    { id: "claude-fable-5", label: "Fable 5" },
    { id: "claude-opus-5", label: "Opus 5" },
    { id: "claude-sonnet-5", label: "Sonnet 5" },
    { id: "claude-haiku-4-5", label: "Haiku 4.5" },
    { id: "claude-opus-4-8", label: "Opus 4.8" },
    { id: "claude-opus-4-7", label: "Opus 4.7" },
    { id: "claude-opus-4-6", label: "Opus 4.6" },
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
    { id: "claude-sonnet-4-5", label: "Sonnet 4.5" },
    { id: "claude-opus-4-5", label: "Opus 4.5" },
    { id: "claude-opus-4-1", label: "Opus 4.1" },
    { id: "claude-sonnet-4", label: "Sonnet 4" },
  ],
  gemini: [
    { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
    { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
    { id: "gemini-omni-flash", label: "Gemini Omni Flash" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
  ],
  deepseek: [
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    { id: "deepseek-chat", label: "deepseek-chat (legacy)" },
    { id: "deepseek-reasoner", label: "deepseek-reasoner (legacy)" },
  ],
  mistral: [
    { id: "mistral-large-latest", label: "Mistral Large 3" },
    { id: "mistral-medium-latest", label: "Mistral Medium 3.5" },
    { id: "mistral-small-latest", label: "Mistral Small 4" },
    { id: "magistral-medium-latest", label: "Magistral Medium" },
    { id: "codestral-latest", label: "Codestral" },
    { id: "devstral-medium-latest", label: "Devstral Medium 2" },
    { id: "ministral-14b-latest", label: "Ministral 3 14B" },
    { id: "ministral-8b-latest", label: "Ministral 3 8B" },
    { id: "pixtral-large-latest", label: "Pixtral Large" },
  ],
  openrouter: [
    { id: "openrouter/auto", label: "Auto" },
    { id: "x-ai/grok-4.6", label: "Grok 4.6" },
    { id: "x-ai/grok-4.5", label: "Grok 4.5" },
    { id: "anthropic/claude-fable-5", label: "Fable 5" },
    { id: "anthropic/claude-opus-5", label: "Opus 5" },
    { id: "anthropic/claude-sonnet-5", label: "Sonnet 5" },
    { id: "anthropic/claude-haiku-4.5", label: "Haiku 4.5" },
    { id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "openai/gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { id: "google/gemini-3.7-flash", label: "Gemini 3.7 Flash" },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    { id: "mistralai/mistral-large-2512", label: "Mistral Large 3" },
    { id: "qwen/qwen3-235b-a22b-2507", label: "Qwen3 235B" },
    { id: "moonshotai/kimi-k2", label: "Kimi K2" },
    { id: "minimax/minimax-m2.7", label: "MiniMax M2.7" },
  ],
  groq: [
    { id: "openai/gpt-oss-120b", label: "GPT OSS 120B" },
    { id: "openai/gpt-oss-20b", label: "GPT OSS 20B" },
    { id: "qwen/qwen3.6-27b", label: "Qwen3.6 27B" },
    { id: "minimaxai/minimax-m2.7", label: "MiniMax M2.7" },
    { id: "groq/compound", label: "Groq Compound" },
    { id: "groq/compound-mini", label: "Groq Compound Mini" },
    { id: "moonshotai/kimi-k2-instruct", label: "Kimi K2" },
    { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout" },
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B" },
  ],
  together: [
    { id: "deepseek-ai/DeepSeek-V4-Flash", label: "DeepSeek V4 Flash" },
    { id: "deepseek-ai/DeepSeek-V4-Pro", label: "DeepSeek V4 Pro" },
    { id: "deepseek-ai/DeepSeek-V3.1", label: "DeepSeek V3.1" },
    { id: "Qwen/Qwen3-235B-A22B-Instruct-2507-tput", label: "Qwen3 235B" },
    { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", label: "Qwen 2.5 72B" },
    { id: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8", label: "Llama 4 Maverick" },
    { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Llama 3.3 70B" },
    { id: "moonshotai/Kimi-K2-Instruct", label: "Kimi K2" },
  ],
  samba: [
    { id: "DeepSeek-V3.1", label: "DeepSeek V3.1" },
    { id: "DeepSeek-V3.2", label: "DeepSeek V3.2" },
    { id: "gpt-oss-120b", label: "GPT OSS 120B" },
    { id: "Meta-Llama-3.3-70B-Instruct", label: "Llama 3.3 70B" },
    { id: "gemma-4-31B-it", label: "Gemma 4 31B" },
    { id: "MiniMax-M2.7", label: "MiniMax M2.7" },
    { id: "Llama-4-Maverick-17B-128E-Instruct", label: "Llama 4 Maverick" },
  ],
  cerebras: [
    { id: "gpt-oss-120b", label: "GPT OSS 120B" },
    { id: "llama-3.1-8b", label: "Llama 3.1 8B" },
    { id: "qwen-3-32b", label: "Qwen3 32B" },
    { id: "qwen-3-235b-a22b-instruct-2507", label: "Qwen3 235B" },
    { id: "llama-3.3-70b", label: "Llama 3.3 70B" },
    { id: "zai-glm-4.7", label: "GLM 4.7" },
  ],
  fireworks: [
    { id: "accounts/fireworks/models/gpt-oss-120b", label: "GPT OSS 120B" },
    { id: "accounts/fireworks/models/deepseek-v3p1", label: "DeepSeek V3.1" },
    { id: "accounts/fireworks/models/deepseek-v3", label: "DeepSeek V3" },
    { id: "accounts/fireworks/models/qwen3-235b-a22b", label: "Qwen3 235B" },
    { id: "accounts/fireworks/models/llama4-maverick-instruct-basic", label: "Llama 4 Maverick" },
    { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", label: "Llama 3.3 70B" },
    { id: "accounts/fireworks/models/kimi-k2-instruct", label: "Kimi K2" },
  ],
  perplexity: [
    { id: "sonar-pro", label: "Sonar Pro" },
    { id: "sonar-reasoning-pro", label: "Sonar Reasoning Pro" },
    { id: "sonar", label: "Sonar" },
    { id: "sonar-deep-research", label: "Sonar Deep Research" },
  ],
  cohere: [
    { id: "command-a-plus-05-2026", label: "Command A+" },
    { id: "command-a-03-2025", label: "Command A" },
    { id: "command-a-reasoning-08-2025", label: "Command A Reasoning" },
    { id: "command-a-vision-07-2025", label: "Command A Vision" },
    { id: "command-a-translate-08-2025", label: "Command A Translate" },
    { id: "command-r-plus-08-2024", label: "Command R+" },
    { id: "command-r-08-2024", label: "Command R" },
    { id: "command-r7b-12-2024", label: "Command R7B" },
  ],
  github: [
    { id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "openai/gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { id: "openai/gpt-5", label: "GPT-5" },
    { id: "openai/gpt-5-mini", label: "GPT-5 Mini" },
    { id: "openai/gpt-4.1", label: "GPT-4.1" },
    { id: "openai/gpt-4o", label: "GPT-4o" },
    { id: "anthropic/claude-fable-5", label: "Fable 5" },
    { id: "anthropic/claude-opus-5", label: "Opus 5" },
    { id: "anthropic/claude-sonnet-5", label: "Sonnet 5" },
    { id: "anthropic/claude-haiku-4.5", label: "Haiku 4.5" },
    { id: "anthropic/claude-opus-4.8", label: "Opus 4.8" },
    { id: "xai/grok-4.6", label: "Grok 4.6" },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  ],
  qwen: [
    { id: FORGE_DEFAULT_MODEL, label: "FORGE local Qwen coder" },
    { id: "qwen3:28b", label: "Qwen 3 28B Dense" },
    { id: "qwen3:32b", label: "Qwen 3 32B" },
    { id: "qwen3-coder:latest", label: "Qwen 3 Coder" },
    { id: "qwen2.5-coder:32b", label: "Qwen 2.5 Coder 32B" },
    { id: "qwen2.5:72b", label: "Qwen 2.5 72B" },
    { id: "qwen3:8b", label: "Qwen 3 8B" },
  ],
  qwenimg: [
    { id: TEMPER_DEFAULT_MODEL, label: "Qwen 3 Image" },
    { id: "qwen3-vl:latest", label: "Qwen 3 VL" },
    { id: "qwen2.5-vl", label: "Qwen 2.5 VL" },
    { id: "qwen2.5vl:32b", label: "Qwen 2.5 VL 32B" },
  ],
};

export function chosenModel(
  id: ModelId,
  picks?: Picks,
  keys?: ProviderKeys,
  viaGithub = false,
): string {
  const raw =
    picks?.[id]?.trim() ||
    (id === "qwen" ? keys?.forgeModel?.trim() : undefined) ||
    (id === "qwenimg" ? keys?.temperModel?.trim() : undefined) ||
    MODELS[id].model;
  if (!viaGithub) return raw;
  if (raw.includes("/")) return raw;
  if (raw.startsWith("claude-")) return `anthropic/${raw}`;
  if (raw.startsWith("gpt-") || raw.startsWith("o1") || raw.startsWith("o3") || raw.startsWith("o4")) {
    return `openai/${raw}`;
  }
  return raw;
}

export function variantLabel(id: ModelId, model?: string): string {
  const m = model || MODELS[id].model;
  return VARIANTS[id]?.find((v) => v.id === m)?.label ?? m;
}

export const MODE_META: Record<SwarmMode, { label: string; hint: string }> = {
  parallel: {
    label: "Parallel",
    hint: "Every live seat answers the same brief at once.",
  },
  roundtable: {
    label: "Round table",
    hint: "Seats speak in order. Each hears who spoke before.",
  },
  debate: {
    label: "Debate",
    hint: "Split the table. Opening, then rebuttal.",
  },
  conductor: {
    label: "Conductor",
    hint: "The host holds the plugins and can summon peers.",
  },
  buildheavy: {
    label: "Build Heavy",
    hint: "Grok-Build pipeline on the swarm: spec → implement → review → merge. Not a solo Grok run.",
  },
};

export const PLUGINS = [
  {
    name: "call_peer",
    description: "Ask another live seat a focused question. Nested calls are blocked.",
  },
  {
    name: "pin_insight",
    description: "Save a finding onto the shared council board.",
  },
  {
    name: "recall_insights",
    description: "Read every pinned finding on the board.",
  },
  {
    name: "make_image",
    description: "Ask TEMPER Qwen Image to render a still from a prompt.",
  },
  {
    name: "now",
    description: "Return the current UTC timestamp.",
  },
  {
    name: "math",
    description: "Evaluate a simple arithmetic expression.",
  },
] as const;

export const STARTERS = [
  "Build Heavy: scaffold a land-title gap-closer with FORGE Qwen implementing and Claude reviewing.",
  "Race Groq, SambaNova, Together, and FORGE Qwen on the same architecture brief.",
  "Have Perplexity cite the web while OpenRouter and Grok argue the stack.",
];

export const KEY_DOCS: Record<
  KeyField,
  { label: string; href: string; placeholder: string; hint: string }
> = {
  grok: {
    label: "xAI",
    href: "https://console.x.ai",
    placeholder: "xai-… or OAuth token",
    hint: "Grok OAuth from your SuperGrok sub, or an xAI API key (billed extra). The app key is already live.",
  },
  openai: {
    label: "OpenAI",
    href: "https://platform.openai.com/api-keys",
    placeholder: "Codex OAuth or sk-…",
    hint: "Codex / ChatGPT OAuth from `codex login` — uses your ChatGPT sub, not API credits.",
  },
  anthropic: {
    label: "Anthropic",
    href: "https://console.anthropic.com/settings/keys",
    placeholder: "Claude Code OAuth or sk-ant-…",
    hint: "Paste `claude setup-token` — uses Claude Pro/Max, not Anthropic API credits.",
  },
  google: {
    label: "Google",
    href: "https://aistudio.google.com/apikey",
    placeholder: "AIza…",
    hint: "Gemini uses a Google AI Studio API key.",
  },
  deepseek: {
    label: "DeepSeek",
    href: "https://platform.deepseek.com/api_keys",
    placeholder: "OAuth token or sk-…",
    hint: "DeepSeek OAuth from your paid sub, or an API key (billed extra).",
  },
  mistral: {
    label: "Mistral",
    href: "https://console.mistral.ai/api-keys",
    placeholder: "mistral-…",
    hint: "Mistral Cloud key. Le Platforme free tier is enough to seat it.",
  },
  openrouter: {
    label: "OpenRouter",
    href: "https://openrouter.ai/keys",
    placeholder: "sk-or-…",
    hint: "One key, many labs. Auto-routes. Free-tier models available.",
  },
  groq: {
    label: "Groq",
    href: "https://console.groq.com/keys",
    placeholder: "gsk_…",
    hint: "Groq LPU. Free tier is fast 70B. Paste console key.",
  },
  together: {
    label: "Together",
    href: "https://api.together.xyz/settings/api-keys",
    placeholder: "together-… or tpk-…",
    hint: "Together AI turbo open-weights. Generous starter credits.",
  },
  samba: {
    label: "SambaNova",
    href: "https://cloud.sambanova.ai",
    placeholder: "samba-…",
    hint: "SambaNova Cloud. Llama on RDU. Cloud key from the console.",
  },
  cerebras: {
    label: "Cerebras",
    href: "https://cloud.cerebras.ai",
    placeholder: "csk-…",
    hint: "Cerebras inference. Wafer-scale Llama. Free tier is real.",
  },
  fireworks: {
    label: "Fireworks",
    href: "https://fireworks.ai/account/api-keys",
    placeholder: "fw_…",
    hint: "Fireworks serving. Fast open-weight production.",
  },
  perplexity: {
    label: "Perplexity",
    href: "https://www.perplexity.ai/settings/api",
    placeholder: "pplx-…",
    hint: "Sonar Pro. Live web with citations. Uses your Perplexity API plan.",
  },
  cohere: {
    label: "Cohere",
    href: "https://dashboard.cohere.com/api-keys",
    placeholder: "co-… or sk-…",
    hint: "Cohere Command. Trial key is enough to seat it.",
  },
  github: {
    label: "GitHub",
    href: "https://github.com/settings/tokens",
    placeholder: "gho_… from `gh auth token`",
    hint: "`gh auth token` from GitHub CLI. Rides Copilot / GitHub Models — GPT and Claude can borrow this seat.",
  },
  forge: {
    label: "FORGE",
    href: "https://github.com/echoomegaprime/echo-qcoder",
    placeholder: "local or node token",
    hint: "Qwen 3.6 27B dense on FORGE Ollama. Paste a public tunnel if this preview cannot see 192.168.1.220.",
  },
  temper: {
    label: "TEMPER",
    href: "https://github.com/echoomegaprime/echo-personality-family-server",
    placeholder: "local or node token",
    hint: "Qwen 3 Image on TEMPER. OpenAI-compatible /v1 URL. Token optional.",
  },
};

export function isModelId(v: unknown): v is ModelId {
  return typeof v === "string" && (MODEL_IDS as readonly string[]).includes(v);
}

export function chatCompletionsUrl(base: string): string {
  const u = base.trim().replace(/\/+$/, "");
  if (!u) return u;
  if (u.endsWith("/chat/completions")) return u;
  if (u.endsWith("/v1")) return `${u}/chat/completions`;
  return `${u}/chat/completions`;
}

export function imagesUrl(base: string): string {
  const chat = chatCompletionsUrl(base);
  return chat.replace(/\/chat\/completions$/, "/images/generations");
}
