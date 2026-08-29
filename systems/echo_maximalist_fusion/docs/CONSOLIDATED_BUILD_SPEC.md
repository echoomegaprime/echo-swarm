# Echo Maximalist Fusion Brain — CONSOLIDATED BUILD SPEC
**Profile:** `MAXIMALIST_RECONSTRUCTED` — **NET-NEW design** (see Provenance). Date 2026-08-26.
**Authority:** Commander directive. Synthesizes 4 independent reviews (Fable-5, Grok-4.6, Opus-5, Gemini-3.1-Pro).

---
## 0. Provenance correction (Opus-5 finding, VERIFIED)
The "recovered historical 40-brain" `swarm_brain_maximalist_v13.1.593_CANONICAL.py` (SHA `760d2f48…`, verified
by direct read + hash recompute) is **5,420 bytes of `queue.Queue` + `threading.Thread` with `time.sleep()`
task bodies** — grep for `findings|dissent|trinity|arbitrat|model-call` returns **0**. The "40" = 40 LLM
submissions that *authored* the file, NOT 40 runtime seats.
**Consequences:** (a) **RETIRE the parity gate** — there are no fusion functions to reach parity with; declare
this net-new. (b) 40 was never a runtime constant → **tiered cascade roster is the default, not a deviation**.
(c) Amend the BUILD PROMPT framing: the 10 properties / Finding schema / dissent / Trinity are new invention.

## 0.1 RECOVERED PRIOR ART — seed the build from this, not a blank slate
The `BRAIN_LOGIC_CODE_REPORT.md` scan recovered **339 brain-named symbols** (158 classes, 181 funcs) verbatim
from 8 chat archives — the REAL prior implementation (the empty v13.1.593 threadpool was a red herring; the
real code is in `fbc90928…/scratchpad/brain_code.json`, 61 MB). Key seeds:
- **`SwarmBrainV20.model_config`** = the EXACT seat roster wired this session (chief_reasoner=Gemini,
  ethics_guardian=Claude, lead_generalist=GPT, tech_analyst=DeepSeek, archivist=Cohere, inquisitor=Grok,
  probe=Perplexity, reflex_engine=Groq, nexus=OpenRouter, sentinel=Ollama/local, open_coder=Qwen-Coder,
  open_engine=Gemma). Its `think()` is naive `asyncio.gather` fan-out — **precisely what the reviews say to
  evolve past.** Use its role→provider map; replace its merge with the blackboard/dissent layer.
- **`EchoSwarmBrain`** (12-model, confidence-weighted `_fuse_responses` + `_calculate_consensus`) — the fusion
  seed; named seats oracle/judge/striker/sage/wraith/probe/nexus/phantom/archivist/sentinel.
- **`ConsensusEngine`** (5-stage: DBSCAN-embedding cluster → quality score → weighted consensus → validation →
  confidence) — the real semantic-dissent + arbitration prior art (validates P0.3/P0.6; reuse it).
- **`HierarchicalSwarmConsensus.byzantine_consensus`** (divine/strategic/specialist/execution tiers, merkle
  consensus, tolerates 33% bad agents) — the cascade + tier-weighting seed.
- **`TrinityBrain.enhance_swarm_request`** (complexity → select → distribute memory → parallel → synthesize →
  **crystallize_learning**) + **`TrinityConsciousness`** (threshold **0.87**) + `TrinityCouncil` (SAGE/THORNE/NYX).
- **`FortyAgentSwarmConsensus`** (109K chars), `SwarmArbitrator` (logs minority opinions = dissent; commander
  override weight 100), `competitive_voting_consensus` (tournament brackets), `NinePillarMemorySystem`
  (incl. CRYSTAL_MEMORY). Extract any symbol from brain_code.json by symbol name.
**Directive:** the reshaped engine reuses `ConsensusEngine`'s clustering+weighting and `TrinityBrain`'s
crystallize step verbatim where sound, and wraps `SwarmBrainV20`'s roster in the blackboard/finding-bus.

## 1. Unanimous verdict: RESHAPE
All 4 reviews independently reached the same conclusion. The skeleton's control flow is sound; the middle is
stubbed to constants that keep every dynamic feature from ever firing. Proven by arithmetic (Fable): with the
shipped `_extract_findings` (flat 0.50, evidence=[]), broadcast signal = 0.425 < 0.60 (bus always empty),
retask needs ≥0.80 (never fires), arbitration < 0.475 < 0.88 (convergence unreachable → always burns 3 passes).
`asyncio.gather` is the forbidden fan-out/fan-in council, not mid-run streaming.

---
## 2. LIVE SEAT ROSTER (all model IDs verified LIVE 2026-08-26, not from cutoff)
Trinity = Claude + GPT + Gemini (configurable). **Historical Trinity naming to preserve** (per Knowledge Forge
`COMPREHENSIVE_BRAIN_FUNCTION_CATALOG.md` §18 + `TRINITY_X1200_CLOUD_SWARM.md`, and prior
`omega_trinity_orchestrator.py` on the unmounted X: drive): **SAGE = Gemini** (auth 11.0), **THORNE = Claude**
(auth 9.0), **NYX = GPT** (auth 10.5). Bind these persona names to the current flagship models
(SAGE→gemini-3.1-pro when quota returns else 2.5-flash; THORNE→claude-opus-5; NYX→gpt-5.6-sol). Maximalist = heterogeneous coverage. **Cascade 8 → escalate to
full roster only on dissent / low-confidence / high-importance.** Cost tiers gate the recursive loop.

| Seat family | Model (verified) | Source/lane | Cost tier | Role families |
|---|---|---|---|---|
| GPT flagship | **gpt-5.6-sol** | codex_cli (CLI 0.149.1) | $0 OAuth | planner, integrator, reasoner |
| GPT balanced | gpt-5.6-terra | codex_cli | $0 OAuth | general reasoner |
| Codex-spark | gpt-5.3-codex-spark | codex_cli | $0 OAuth | coder, quick |
| Claude apex | **claude-opus-5** | claude_cli | $0 Max | meta-cognition, recursive integrator, locked critic |
| Claude mid | claude-sonnet-5 | claude_cli | $0 Max | reasoner, verifier |
| Claude fast | claude-haiku-4-5 | claude_cli | $0 Max | coverage |
| Gemini Pro | **gemini-3.1-pro-preview** | vertex api | metered(free-tier) | cross-modal, hypothesis expansion |
| Gemini Flash | gemini-3.7-flash | vertex api | metered(free-tier) | coverage, fast |
| Grok apex | **grok-4.6** | grok_cli (OIDC) | $0 sub | locked critic, verifier, hard fusion |
| Grok agentic | grok-4.5 | grok_cli/api | $0 sub | systems, coding |
| Grok workhorse | grok-4.3 (reasoning_effort low/none) | api | metered | first-pass volume, 1M ctx |
| Grok researcher | grok-4.20-0309-reasoning | api | metered | long-horizon research |
| Grok decoder | grok-4.20-0309-non-reasoning | api | metered | decoder diversity |
| Grok planner | grok-4.20-multi-agent-0309 (1 seat) | api | metered | retask director only |
| Grok coder | grok-build-0.1 | grok_cli | $0 sub | code/debug |
| DeepSeek | deepseek-chat (v4 alias) | deepseek api | metered | reasoning, code, math |
| Local Qwen-27B | huihui_ai/Qwen3.6-abliterated:27b | raistlin_local :11438 | **$0 local** | reasoning, uncensored, coverage |
| Local Qwen-Coder | qwen2.5-coder / qwen3-coder | raistlin_local | **$0 local** | coder, systems |
| Local Gemma | gemma-4-31b-it (or gemma-4-26b) | vertex api / local | $0-metered | coverage, alt-decoder |
| Qwen reflex | qwen-2.5-7b | raistlin_local | $0 local | intent, routing |
| OpenRouter | (many) | openrouter | metered | overflow diversity |
| Groq | (llama/qwen LPU) | groq api | **free tier** | fast coverage — PENDING account |
| Perplexity | sonar-pro | perplexity api | metered $10 | research w/ citations — PENDING |
| Cohere | command-a / r-plus | cohere v2 | metered $10 | reasoner — PENDING |
| psql | — | psql_query | $0 | tool: data lookup |

**⚠ NEVER use retired grok slugs** (grok-3, grok-4-fast, grok-4-1-fast, grok-code-fast-1, grok-latest — all
redirect to 4.3 = zero diversity). **Metered seats (perplexity/cohere/openrouter/deepseek/grok-4.3/gemini) are
capped per run and NEVER eligible for the recursive fusion loop** (§BILLING SAFETY — this is the $1,000 Copilot
failure class).

---
## 3. P0 — the build that makes it actually Maximalist (all 4 reviews agree)

**P0.1 Structured finding extraction** (THE blocker — everything downstream is dead until this lands).
- `Finding` as a **pydantic v2** model (claim, evidence[], confidence, novelty, importance, subproblem,
  source_refs[], seat_id, model, role, claim_type∈{fact|procedure|prediction|value|definition}, verified,
  contradicted, verification_notes[]).
- **Two-tier extractor:** (1) native structured output where supported — codex `response_format:json_schema`,
  Gemini `responseSchema`, Claude tool-use; (2) else fenced-```json parse → pydantic validate → **one** re-prompt
  ("return ONLY valid JSON matching schema") → degrade to a single low-confidence finding (NEVER crash).
- Injectable extractor so deterministic tests drive scores.
- **Computed, not self-graded scores** (Grok/Gemini): novelty = embedding distance to memory + other claims;
  importance = objective-overlap + graph centrality; confidence = calibrated from verification outcomes, not the
  model's adjective; evidence weight = source reliability × retrieval status × independent replication count.

**P0.2 Streaming bus + mid-run dispatcher** (the reshape — the essence).
- `asyncio.as_completed` over a **mutable pending set**; extract → broadcast → dissent **incrementally** per
  completed seat; dispatcher injects retask/recruit coroutines into the **still-running** set, targeting seats
  whose subproblem matches the finding (affected-subproblem map, not first-8). Reserve a fraction of the roster
  as **idle specialists** to recruit. Route the **selected** findings, never the raw bus; hard char caps per
  finding in every packet.

**P0.3 Semantic dissent** (pgvector).
- Embed claims (FORGE embedding path / local MiniLM) → cluster (HDBSCAN or HAC) per subproblem → NLI/LLM
  contradiction check between minority and majority clusters → emit `Dissent{claim, dissenting_seats,
  majority_position, evidence, confidence, later_outcome, vindicated}`.
- **Load-bearing:** arbitration scores **claim clusters** — `cluster_score = max(member) + agreement_bonus(#
  distinct independent seats)` so 3 evidenced specialists beat 20 flat votes structurally; each unresolved
  Dissent auto-generates a verification retask; survivors land in `unresolved` verbatim (never erased).

**P0.4 Durable RunState + resume** (fixes volatile-state collapse).
- `RunState` dataclass mirroring spec §6 (all JSON-serializable). `StateStore` (save/load/list_incomplete) →
  **Postgres table on FORGE** `arcanum_sdk.maximalist_runs(run_id, phase, ts, state jsonb)`. Snapshot after each
  phase + each fusion pass (~6 writes/run). `resume(run_id)` skips completed phases. Idempotent run_id.

**P0.5 Budget + failure containment** (§BILLING SAFETY — not optional).
- Global + per-provider `asyncio.Semaphore`; `asyncio.timeout` per call + one retry then **fallback lane**;
  `Budget{max_calls, est_tokens, est_$, wall_clock}` checked **before every call** → **finalize-with-disclosure**
  on exhaustion (never force consensus). Real **planner seat** (not `model="planner"` which crashes). Per-provider
  circuit breaker: isolate a failed seat, keep the run + bus. Seat outputs are **untrusted data** — delimit them
  in later prompts (uncensored $0 lanes in roster = injection surface).

**P0.6 Arbitration + Trinity fixes.**
- All 10 ranking factors, chief among the missing: **independent cross-seat agreement** (strongest truth signal),
  verification results (wire verified/contradicted via `target_claim_id` linkage), provenance quality.
- Trinity members called with `gather` not sequentially; **parse** the fusion ANSWER/CONFIDENCE/SUPPORTED/WEAK/
  UNRESOLVED; recurse only on weak/unresolved claims. Fuse claim TYPES separately (never average a value with a
  fact). Cross-check model-stated confidence vs arbitration estimate; disclose divergence.

## 4. MEMORY — wired into ALL tiers (Commander directive)
`MemoryAdapter.retrieve(objective)` fans across: **brain** (`echo.brain.*`) · **context plane**
(`echo.context.*`) · **doctrine** (`echo.doctrine.*`) · **Knowledge Forge** (`echo.knowledge.*`) · **Cortex V2**
· **Memory Crystals** (`memory_spine.crystal` — 62K live crystals w/ `embedding` vector + episode/fact/entity
links + branching `parent_crystal`; retrieve by cosine on `embedding`, write a crystal per finalized run via
`echo-crystal-capture`) · **pgvector** (claim embeddings). `write_run(result)` (only after finalization) persists to: brain episode +
context remember + the RunState table + **performance stats** (per model:role:domain on a STABLE domain
taxonomy — free-text subproblems never accrue history). Write **failed hypotheses + vindicated dissent**, not
just the winner. Decay/contradict stale memory. **Anti-sycophancy: never retrieve a Commander-desired outcome
into the first pass.** Provenance hash-chain: run_id → findings → fusion → memory ids.

## 5. P1 — frontier hardening (after P0 green)
Sycophancy mitigation (raise temperature in critique/arbitration to break lock-in); consensus-gated **abstention**
(fail to threshold ⇒ output uncertainty as signal, don't hallucinate); cognitive factorization (planner =
decomposer); 3 independent decomposers merged; locked critics (2-4, never retasked to majority, publish before
seeing majority framing); canary false-claim herding test; ablation (drop a cluster, re-fuse); Thompson-sample
10-15% routing exploration; observability (herding score = embedding collapse, dissent survival rate,
calibration error, cost per 0.01 confidence, retask amplification).

## 6. ACCEPTANCE TESTS (deterministic fake-model harness — the gate; +2 beyond spec's 12)
1 first-pass isolation · 2 high-value findings propagate · 3 findings trigger mid-run retask · 4 dissent survives
arbitration · 5 strong evidence beats numerical majority · 6 provider failure → fallback, run+state survive ·
7 Trinity gets structured claims not transcript dump · 8 weak fusion triggers verification (AND strong fusion
does NOT — the control must be constructible) · 9 verified corrections enter next fusion · 10 writeback only
after finalization · 11 repeated runs improve routing · 12 restart/recovery preserves run state · **13 budget
exhaustion finalizes-with-disclosure (never unbounded spend)** · **14 abstention on sub-threshold consensus**.

## 7. Sequencing
P0.1 → P0.4 (state) → P0.3 (dissent) → tests 1-12 → P0.5 (budget) → adapters (Model→swarm lanes NATS/registry,
Memory→all tiers) → seat YAML → cascade → P1. **Do NOT call it MAXIMALIST_HISTORICAL.** Keep MAXIMALIST_RECONSTRUCTED.
