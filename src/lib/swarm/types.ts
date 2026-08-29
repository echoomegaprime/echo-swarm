import type { AuthModes, ModelId, Picks, ProviderKeys, SwarmMode } from "./catalog";

export interface Insight {
  id: string;
  title: string;
  body: string;
  from: ModelId;
}

export interface ToolTrace {
  name: string;
  args: string;
  result: string;
}

export type BuildPhase = "spec" | "implement" | "review" | "merge" | "fusion" | "brain";

export type SwarmMessageSource = "council" | "fusion" | "brain";

export interface TokenUsage {
  prompt: number;
  completion: number;
}

export interface SwarmFile {
  path: string;
  content: string;
  lang?: string;
  from?: ModelId;
}

export interface SwarmMessage {
  id: string;
  role: "user" | "assistant" | "notice";
  modelId?: ModelId;
  model?: string;
  source?: SwarmMessageSource;
  runId?: string;
  content: string;
  traces?: ToolTrace[];
  phase?: BuildPhase;
  replyTo?: string;
  usage?: TokenUsage;
  createdAt: number;
}

export interface SwarmSession {
  id: string;
  title: string;
  messages: SwarmMessage[];
  insights: Insight[];
  createdAt: number;
  updatedAt: number;
}

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
  modelId?: ModelId;
}

export interface SwarmTurnInput {
  prompt: string;
  mode: SwarmMode;
  host: ModelId;
  seats: ModelId[];
  keys: ProviderKeys;
  auth: AuthModes;
  picks?: Picks;
  history: HistoryTurn[];
  insights: Insight[];
}

export interface SeatTurn {
  modelId: ModelId;
  model?: string;
  content: string;
  traces: ToolTrace[];
  error?: string;
  phase?: BuildPhase;
  usage?: TokenUsage;
  messageId?: string;
}

export type SwarmTurnResult =
  | {
      ok: true;
      turns: SeatTurn[];
      insights: Insight[];
      skipped: { modelId: ModelId; reason: string }[];
    }
  | {
      ok: false;
      error: string;
    };

export type SwarmEvent =
  | { type: "phase"; phase: string; seats: ModelId[] }
  | { type: "delta"; modelId: ModelId; phase?: BuildPhase; text: string; messageId: string }
  | { type: "turn"; turn: SeatTurn }
  | { type: "usage"; modelId: ModelId; prompt: number; completion: number }
  | { type: "notice"; content: string }
  | { type: "insights"; insights: Insight[] }
  | { type: "done"; result: SwarmTurnResult };

export interface SeatSpend {
  prompt: number;
  completion: number;
  calls: number;
}

export interface QuoteTarget {
  messageId: string;
  modelId: ModelId;
  content: string;
  only: boolean;
}

export interface StreamSeat {
  messageId: string;
  modelId: ModelId;
  phase?: BuildPhase;
  content: string;
}
