import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_AUTH,
  DEFAULT_SEATS,
  MODELS,
  type AuthMode,
  type AuthModes,
  type KeyField,
  type ModelId,
  type OAuthField,
  type Picks,
  type ProviderKeys,
  type SwarmMode,
} from "./catalog";
import type { Insight, QuoteTarget, SeatSpend, StreamSeat, SwarmMessage, SwarmSession, TokenUsage } from "./types";

const emptySession = (): SwarmSession => ({
  id: crypto.randomUUID(),
  title: "Untitled council",
  messages: [],
  insights: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

export interface FleetLive {
  grok: boolean;
  github: boolean;
  forge: boolean;
  temper: boolean;
  forgeMs?: number;
  temperMs?: number;
  env: Partial<Record<KeyField, boolean>>;
}

interface SwarmState {
  keys: ProviderKeys;
  auth: AuthModes;
  picks: Picks;
  live: FleetLive;
  host: ModelId;
  seats: ModelId[];
  mode: SwarmMode;
  sessions: SwarmSession[];
  activeId: string;
  thinking: ModelId[];
  runId: number;
  streaming: StreamSeat[];
  spend: Partial<Record<ModelId, SeatSpend>>;
  quote: QuoteTarget | null;
  connectOpen: boolean;
  pluginOpen: boolean;
  mobileNav: boolean;
  hydrated: boolean;
  setHydrated: (v: boolean) => void;
  setLive: (live: FleetLive) => void;
  setKey: (field: keyof ProviderKeys, value: string) => void;
  clearKey: (field: keyof ProviderKeys) => void;
  setAuth: (field: OAuthField, mode: AuthMode) => void;
  setPick: (id: ModelId, model: string) => void;
  setHost: (id: ModelId) => void;
  toggleSeat: (id: ModelId) => void;
  setMode: (mode: SwarmMode) => void;
  setConnectOpen: (v: boolean) => void;
  setPluginOpen: (v: boolean) => void;
  setMobileNav: (v: boolean) => void;
  setThinking: (ids: ModelId[]) => void;
  beginRun: () => number;
  abortRun: () => void;
  setQuote: (q: QuoteTarget | null) => void;
  upsertStream: (seat: StreamSeat) => void;
  dropStream: (messageId: string) => void;
  clearStream: () => void;
  addUsage: (id: ModelId, usage: TokenUsage) => void;
  active: () => SwarmSession;
  newSession: () => void;
  selectSession: (id: string) => void;
  deleteSession: (id: string) => void;
  pushMessages: (msgs: SwarmMessage[]) => void;
  setInsights: (insights: Insight[]) => void;
  titleFromPrompt: (prompt: string) => void;
}

function titleOf(prompt: string): string {
  const t = prompt.replace(/\s+/g, " ").trim();
  return t.length > 42 ? `${t.slice(0, 42)}…` : t || "Untitled council";
}

export const useSwarm = create<SwarmState>()(
  persist(
    (set, get) => {
      const first = emptySession();
      return {
        keys: {},
        auth: { ...DEFAULT_AUTH },
        picks: {},
        live: { grok: false, github: false, forge: false, temper: false, env: {} },
        host: "grok",
        seats: [...DEFAULT_SEATS],
        mode: "parallel",
        sessions: [first],
        activeId: first.id,
        thinking: [],
        runId: 0,
        streaming: [],
        spend: {},
        quote: null,
        connectOpen: false,
        pluginOpen: false,
        mobileNav: false,
        hydrated: false,
        setHydrated: (v) => set({ hydrated: v }),
        setLive: (live) => set({ live }),
        setKey: (field, value) =>
          set((s) => ({ keys: { ...s.keys, [field]: value.trim() } })),
        clearKey: (field) =>
          set((s) => {
            const next = { ...s.keys };
            delete next[field];
            return { keys: next };
          }),
        setAuth: (field, mode) => set((s) => ({ auth: { ...s.auth, [field]: mode } })),
        setPick: (id, model) => set((s) => ({ picks: { ...s.picks, [id]: model } })),
        setHost: (id) =>
          set((s) => ({
            host: id,
            seats: s.seats.includes(id) ? s.seats : [...s.seats, id],
          })),
        toggleSeat: (id) =>
          set((s) => {
            const on = s.seats.includes(id);
            if (on && s.seats.length === 1) return s;
            const seats = on ? s.seats.filter((x) => x !== id) : [...s.seats, id];
            const host = seats.includes(s.host) ? s.host : seats[0]!;
            return { seats, host };
          }),
        setMode: (mode) => set({ mode }),
        setConnectOpen: (v) => set({ connectOpen: v }),
        setPluginOpen: (v) => set({ pluginOpen: v }),
        setMobileNav: (v) => set({ mobileNav: v }),
        setThinking: (ids) => set({ thinking: ids }),
        beginRun: () => {
          const runId = get().runId + 1;
          set({ runId });
          return runId;
        },
        abortRun: () =>
          set((s) => ({
            runId: s.runId + 1,
            thinking: [],
            streaming: [],
          })),
        setQuote: (quote) => set({ quote }),
        upsertStream: (seat) =>
          set((s) => {
            const i = s.streaming.findIndex((x) => x.messageId === seat.messageId);
            if (i === -1) return { streaming: [...s.streaming, seat] };
            const next = s.streaming.slice();
            const cur = next[i]!;
            next[i] = {
              ...cur,
              modelId: seat.modelId,
              phase: seat.phase ?? cur.phase,
              content: cur.content + seat.content,
            };
            return { streaming: next };
          }),
        dropStream: (messageId) =>
          set((s) => ({ streaming: s.streaming.filter((x) => x.messageId !== messageId) })),
        clearStream: () => set({ streaming: [] }),
        addUsage: (id, usage) =>
          set((s) => {
            const cur = s.spend[id] ?? { prompt: 0, completion: 0, calls: 0 };
            return {
              spend: {
                ...s.spend,
                [id]: {
                  prompt: cur.prompt + usage.prompt,
                  completion: cur.completion + usage.completion,
                  calls: cur.calls + 1,
                },
              },
            };
          }),
        active: () => {
          const s = get();
          return s.sessions.find((x) => x.id === s.activeId) ?? s.sessions[0]!;
        },
        newSession: () => {
          const session = emptySession();
          set((s) => ({
            sessions: [session, ...s.sessions].slice(0, 24),
            activeId: session.id,
          }));
        },
        selectSession: (id) => set({ activeId: id, mobileNav: false }),
        deleteSession: (id) =>
          set((s) => {
            const sessions = s.sessions.filter((x) => x.id !== id);
            const next = sessions.length ? sessions : [emptySession()];
            return {
              sessions: next,
              activeId: s.activeId === id ? next[0]!.id : s.activeId,
            };
          }),
        pushMessages: (msgs) =>
          set((s) => ({
            sessions: s.sessions.map((sess) =>
              sess.id === s.activeId
                ? {
                    ...sess,
                    messages: [...sess.messages, ...msgs],
                    updatedAt: Date.now(),
                  }
                : sess,
            ),
          })),
        setInsights: (insights) =>
          set((s) => ({
            sessions: s.sessions.map((sess) =>
              sess.id === s.activeId ? { ...sess, insights, updatedAt: Date.now() } : sess,
            ),
          })),
        titleFromPrompt: (prompt) =>
          set((s) => ({
            sessions: s.sessions.map((sess) =>
              sess.id === s.activeId && sess.title === "Untitled council"
                ? { ...sess, title: titleOf(prompt) }
                : sess,
            ),
          })),
      };
    },
    {
      name: "swarm-council-v2",
      skipHydration: true,
      partialize: (s) => ({
        keys: s.keys,
        auth: s.auth,
        picks: s.picks,
        host: s.host,
        seats: s.seats,
        mode: s.mode,
        sessions: s.sessions,
        activeId: s.activeId,
        spend: s.spend,
      }),
    },
  ),
);

export function isConnected(id: ModelId, keys: ProviderKeys, live: FleetLive): boolean {
  const def = MODELS[id];
  if (id === "grok") return Boolean(keys.grok?.trim()) || live.grok;
  if (id === "github") return Boolean(keys.github?.trim()) || live.github;
  if (id === "gpt") {
    return Boolean(keys.openai?.trim()) || Boolean(keys.github?.trim()) || live.github;
  }
  if (id === "claude") {
    return Boolean(keys.anthropic?.trim()) || Boolean(keys.github?.trim()) || live.github;
  }
  if (id === "qwen") {
    return Boolean(keys.forgeUrl?.trim() || keys.forge?.trim() || live.forge);
  }
  if (id === "qwenimg") {
    return Boolean(keys.temperUrl?.trim() || keys.temper?.trim() || live.temper);
  }
  const field = def.keyField;
  return Boolean(keys[field]?.trim() || live.env[field]);
}

export function maskKey(value?: string): string {
  if (!value) return "";
  const v = value.trim();
  if (v.length < 8) return "••••";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}
