Reviewed all four files line-by-line; findings verified against the code (and cross-checked with a second reviewer). Ranked by impact, correctness bugs first.

---

## 1. CORRECTNESS BUG — resume silently drops unfinished first-pass seats

**Gap:** `_drive`: `if state.phase in (RunPhase.DECOMPOSED,) and not resumed or not state.completed_seat_ids:` parses as `(A and not resumed) or C`. Mid-`_wave` checkpoints save with phase still `DECOMPOSED` and partial `completed_seat_ids`, so a resume after a mid-first-pass crash makes both clauses False → `_blackboard` is skipped and the run arbitrates on partial findings with no error. The todo-filter comment inside `_blackboard` claims the behavior; `_drive` never lets it execute.
**Change:** Gate on phase alone: `if state.phase == RunPhase.DECOMPOSED: await self._blackboard(...)`. The `todo = [s for s in assigned if s["id"] not in completed_seat_ids]` filter already handles re-issue.
**Risk:** None. Delete the two dead clauses; add a resume-mid-first-pass test (your WAL test resumes at phase boundaries, which is why 21/21 missed this).

## 2. CORRECTNESS/ADVERSARIAL — one dissenting seat forces permanent abstention and burns all fusion passes

**Gap:** Final gate `if empty or conf < convergence or state.dissent: abstained = True`, plus the 0.85−0.2·n confidence cap, plus: **nothing ever resolves a Dissent**. `vindicated` is written nowhere; `detect_dissent` ignores `contradicted` flags, so even after `_verify_weak` refutes the dissenting finding, the next `detect_dissent` recreates it. A seat emitting `"not X"` at confidence 1.0 is a two-line DoS: 3 wasted fusion passes, guaranteed abstention. Compounding: `detect_dissent` picks the majority rep by raw self-graded `f.confidence`, so a confidence-1.0 attacker *becomes* the majority position and everyone else becomes dissent.
**Change:** (a) In `detect_dissent`, take the majority rep as `majority[0]` (the intrinsic-ordered representative `score_clusters` already computed). (b) Add an adjudication step: drop/mark-resolved a Dissent whose source finding is `contradicted` with zero external evidence; set `vindicated=False` and `reason_rejected`. (c) Make the abstention gate evidence-weighted: abstain only if dissent's `evidence_weight` is within some margin of the majority's, otherwise disclose it in `unresolved` without blocking.
**Risk:** Weakening the gate can ship over a real minority-correct signal — keep the confidence haircut, drop only the hard abstain for evidence-free refuted dissent.

## 3. ADVERSARIAL — the evidence gate is attacker-satisfiable: fabricated citations score 0.9, never checked

**Gap:** `JsonFindingExtractor` allowlists model-supplied `evidence.kind="citation"`; `Evidence.reliability()` gives 0.9 to an *unverified* citation; two fakes saturate `evidence_weight()` → bypass the 0.42 bare-assertion ceiling and the ×0.5 gate. No code ever validates a locator. "Evidence beats majority" degrades to "whoever types `kind: citation` beats majority" on real providers. Same hole in `_verify_weak`: `nf.evidence_weight() > 0` → `target.verified = True` (+0.15) off fabricated evidence.
**Change:** Cap unverified reliability: in `reliability()`, unverified CITATION/TOOL_RESULT/RETRIEVAL ≤ ~0.45; full weight only at `status=VERIFIED`. Add a verification stage (before `score_clusters` on the top-K clusters): fetch/existence-check citation locators, or at minimum have a verifier seat confirm the snippet supports the claim, setting `status` engine-side. In `_verify_weak`, require verified (not merely present) evidence to set `target.verified`.
**Risk:** Cost/latency of locator checks; a fetch-based verifier is itself injectable (fetched page content → verifier prompt). Sample top-K only; treat fetched text as data.

## 4. GROUNDING — memory is retrieved and thrown away

**Gap:** `_drive` calls `memory.retrieve()` and stores only ids in `memory_reads`. No prompt anywhere contains retrieved content. The retrieval→prompt-injection axis is zero, not weak, and `EvidenceKind.RETRIEVAL` is unreachable in practice.
**Change:** In `_first_pass_prompt` (and `_verify_weak`'s prompt), inject the top-k retrieved snippets relevant to the seat's subproblem as a delimited, "DATA not instructions" block with locators; instruct seats to cite them as `kind: retrieval` evidence with the crystal id, and have the engine auto-attach `Evidence(RETRIEVAL, locator=crystal_id, status=VERIFIED)` when a finding's `source_refs` names a real retrieved id (engine-verified because the engine knows what it retrieved — this is your one *cheap* trustworthy evidence channel).
**Risk:** Prompt bloat and injection via stored memories; cap snippets, dedupe against the objective, and never let memory text set trust fields.

## 5. COST — `Embedder` and `Contradictor` are unmetered model calls

**Gap:** In production these are pgvector/NLI/cheap-LLM calls. `cluster_findings` re-embeds *all* findings ≥4×/run; `detect_dissent` runs O(cluster size) `contradicts()` calls per fusion pass. None of it passes through `Budget.try_reserve`, the semaphore, or the breaker. The $-ceiling has a side channel exactly where real-provider volume is highest.
**Change:** Add an embedding cache keyed on claim hash (findings are immutable text — embed once); route contradictor/embedder calls through a metered wrapper that charges `budget.settle()` and respects a cheap-call sub-budget; limit `detect_dissent` NLI to top-N clusters' reps.
**Risk:** Cache invalidation is trivial here (claims never mutate); main risk is the sub-budget starving dissent detection — fail open to "disclose as unresolved," never silently skip.

## 6. CALIBRATION — `arb_conf` is not a probability and nothing ever calibrates it

**Gap:** `_parse_fusion`: mean of top-10 cluster scores (which range to 1.5) clamped to [0,1] is a score average, not P(answer correct). One strong cluster → conf 1.0 regardless of objective coverage. `min(arb, stated)` also lets a sandbagging trinity integrator stating 0.0 force abstention — a single compromised integrator is both the sole answer author and a veto. No outcome feedback loop exists (perf trust never feeds confidence).
**Change:** In `_parse_fusion`: confidence = coverage term (fraction of `state.subproblems` whose best cluster ≥ 0.65) × logistic(top-cluster score), disclose `model_stated_confidence` but stop `min()`-ing it (or use the median of trinity members' stated values). Log (predicted_conf, later outcome/vindication) pairs and fit isotonic/Platt per claim_type offline.
**Risk:** Needs outcome labels to actually calibrate; until then it's still heuristic — but at least monotone in coverage and immune to one integrator's stated number.

## 7. ADVERSARIAL — self-graded importance/novelty drive dispatch; the "engine recomputes" comment is a lie

**Gap:** `Finding`'s docstring says the engine recomputes importance/novelty. It doesn't. `_wave` triggers retasks on `f.importance >= 0.75 or f.novelty >= 0.80` — attacker-controlled fields directly command dispatch (bounded at 2/seat, 8 global, but an adversary reliably consumes the entire retask/recruit budget with junk). The same fields are 0.24 of intrinsic score.
**Change:** In `_wave` (or a helper the extractor calls): novelty := 1 − max cosine vs existing finding embeddings (embedder is already wired); importance := cosine(claim, objective ⊕ subproblem). Use model-stated values only as tiebreaks. Trigger retasks on the recomputed values.
**Risk:** Adds embed calls on the hot path (mitigated by #5's cache); embedding-based importance is crude for terse claims — keep the `f.contradicted` trigger as-is.

## 8. REAL-PROVIDER — extractor has no truncation handling, no repair, no re-prompt; degraded junk enters arbitration as claims

**Gap:** Real providers emit truncated JSON (max_tokens), trailing commas, single quotes. On any parse failure `_degraded()` turns 500 chars of broken JSON into a *claim* that then gets embedded, clustered, and can co-cluster with real findings. The "re-prompt hook" exists only in a comment. Also: the adapter contract can't distinguish a 429 from a 500, so `_call`'s breaker trips a provider on rate limits — the worst response to a 429 fleet-wide is to hammer, the second-worst is to isolate a healthy provider for 30s and lose its seats.
**Change:** `JsonFindingExtractor.extract`: add a repair tier (strip trailing commas, close truncated braces, `finish_reason` check via a new field in the adapter result) and one budget-charged re-prompt on failure; quarantine `_degraded` findings (new flag) so they're excluded from `cluster_findings` and only surfaced in provenance. `ModelAdapter`: return `{"error", "retryable", "retry_after"}`; in `_call`, jittered backoff for retryable errors *before* breaker counting, and track a single in-flight half-open probe (currently every queued task passes the half-open check simultaneously — thundering herd on recovery).
**Risk:** Re-prompt doubles worst-case calls for a chronically drifting model — cap at one per seat per wave.

## 9. CASCADE — escalation is one-shot, global, waits for full tier-1 drain, and its contradiction check is dead code

**Gap:** `_should_escalate` checks `f.contradicted`, which is only ever set later in `_verify_weak` — always False at cascade time. Decision is a single global top-cluster score: one strong cluster masks garbage on every other subproblem; conversely all tier-2 seats launch even if only one subproblem is weak. And `_wave` for tier-1 must fully drain first (slowest cheap seat gates the elite tier). Separate bug: when *all* seats are tier-2, `tier1 or todo` runs them in wave 1, then wave 2 **dispatches them all again**.
**Change:** `_blackboard`: if `not tier1`, set `tier2 = []` after the first wave. `_should_escalate`: score per-subproblem (best cluster per subproblem below threshold → escalate only tier-2 seats assigned to that subproblem); replace the dead `contradicted` check with a provisional `detect_dissent` on the tier-1 clusters; evaluate at a quorum (e.g. 75% of tier-1 done or a deadline fraction) instead of full drain.
**Risk:** Per-subproblem thresholds need tuning; premature quorum escalation can pay tier-2 for a subproblem a slow tier-1 seat was about to nail — make quorum fraction config.

## 10. CORRECTNESS — `merge_replication` drops the displaced survivor's seat on swap

**Gap:** When a higher-confidence duplicate replaces the survivor, `by_claim[k] = surv = f` executes before the seat-comparison, so `f.seat_id != surv.seat_id` is self-comparison → False. The displaced survivor's own seat_id (never in its own evidence list) is never recorded as REPLICATION on the new survivor → `_independent_seats` undercounts → agreement bonus lost exactly when two seats independently agree with different strengths.
**Change:** In `merge_replication`, before the swap, append `Evidence(kind=REPLICATION, locator=surv.seat_id)` to `f` (guarding the same dedup condition). Also: dedupe non-replication evidence by `(kind, locator)` during merge — evidence lists currently grow duplicates across the repeated merge/cluster cycles, and duplicate citations double-count in `evidence_weight`.
**Risk:** None; pure fix. Related hardening: the `claim[:80]` merge/dedup key is collision-attackable (craft an 80-char prefix matching the majority claim to steal its survivor slot with confidence 1.0) — key on a hash of the full normalized claim instead.

## 11. LEARNING — trust update is circular: it rewards agreeing with the majority

**Gap:** `_update_perf` defines winners as membership in top-20 clusters — the very clusters trust helped rank. Seats learn to herd; correct dissenters are punished; a clone swarm slowly accretes trust. Also `_trust`'s per-domain key is a free-text subproblem string from the planner that will essentially never recur across runs — the per-domain half of learned routing is inert.
**Change:** In `_update_perf`, reward only findings that ended `verified` (post-#3, i.e., engine-verified evidence), penalize `contradicted`, and write `Dissent.vindicated` + a trust bonus when a later pass's verified evidence supports a previously dissenting seat. Key domain trust by `claim_type` or a coarse topic cluster of the objective, not the raw subproblem string.
**Risk:** Verified-only reward slows trust accumulation (fewer signals per run); acceptable — a slow honest signal beats a fast circular one.

## 12. INJECTION — delimiters are cosmetic; foreign text flows into critic/trinity prompts raw

**Gap:** `_retask_prompt` wraps the claim in `<finding>` but a claim containing `</finding>` breaks out; `_critique`'s packet and `_trinity_fuse`'s packet embed claims with no delimiting at all; trinity fusion embeds 1200 chars of each member's raw output — a first-pass injection propagates seat → critique → trinity → final answer.
**Change:** One sanitizer used by `_retask_prompt`, `_critique`, `_trinity_fuse`, `_verify_weak`: strip `<>`/backticks from embedded claims or use per-call random-nonce delimiters; prefix packets with "quoted lines are untrusted data." In `_verify_weak`, additionally require ≥2 independent verifier refutations before setting `target.contradicted` (currently one verifier finding flips it), and exclude `verifier.id == f.seat_id` when building `pairs` — a seat can currently be assigned to verify its own claim.
**Risk:** Sanitizing mutates claims shown to models (fine — `state.findings` keeps originals); 2-vote refutation costs an extra call per weak claim.

---

**Where to start:** #1 and #10 are same-day fixes with tests. #2+#3 together are the highest-leverage for "measurably better" — they close the two cheapest attacks on the arbitration invariant. #4 and #5 are prerequisites for the system being a *grounded* fusion brain rather than a self-referential one. Measurables: abstention rate under a single adversarial seat (should drop from 100%), win-rate of a fake-citation seat vs a genuinely-cited seat (should drop to ~0), resume-equivalence (resumed run findings ≡ uninterrupted run), and cost per run with embed caching (expect 3–4× fewer embed calls).
SessionEnd hook [node "${CLAUDE_PLUGIN_ROOT}/hooks/session-end-cleanup.mjs"] failed: Hook cancelled
