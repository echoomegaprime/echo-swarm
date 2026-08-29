"""14 deterministic fake-model invariants — the acceptance gate (spec §6).

No live providers: ScriptedModelAdapter + JsonFindingExtractor + HashEmbedder +
KeywordContradictor + InMemoryStateStore + FakeMemory. Run: `python test_invariants.py`.
"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))

from echo_fusion.adapters import (FakeMemory, HashEmbedder, InMemoryStateStore,  # noqa: E402
                                  JsonFindingExtractor, KeywordContradictor,
                                  ScriptedModelAdapter)
from echo_fusion.engine import FusionEngine  # noqa: E402
from echo_fusion.schemas import Budget  # noqa: E402


def jf(claim, importance=0.5, novelty=0.5, confidence=0.6, evidence=None, ctype="fact"):
    ev = evidence or []
    return json.dumps({"findings": [{"claim": claim, "claim_type": ctype,
                                     "confidence": confidence, "importance": importance,
                                     "novelty": novelty, "evidence": ev}]})


def seats(n=6, roles=None):
    roles = roles or ["reasoner", "researcher", "critic", "verifier", "skeptic", "reasoner"]
    return [{"id": f"seat_{i}", "model": f"m{i%3}", "provider": f"p{i%3}",
             "role": roles[i % len(roles)]} for i in range(n)]


TRINITY = [{"name": "THORNE", "model": "claude", "role": "integrator"},
           {"name": "NYX", "model": "gpt", "role": "reasoner"},
           {"name": "SAGE", "model": "gemini", "role": "expander"}]
PLANNER = {"id": "planner", "model": "gpt", "provider": "p0", "role": "planner"}


def mk(script, s=None, **kw):
    model = ScriptedModelAdapter(script, fail_seats=kw.pop("fail_seats", None),
                                 hang_seats=kw.pop("hang_seats", None), cost=kw.pop("cost", 0.0))
    store = InMemoryStateStore()
    mem = FakeMemory(kw.pop("memories", None))
    eng = FusionEngine(model=model, extractor=JsonFindingExtractor(), embedder=HashEmbedder(),
                       contradictor=KeywordContradictor(), memory=mem, store=store,
                       seats=s or seats(), trinity=TRINITY, planner_seat=PLANNER,
                       reserve_specialists=kw.pop("reserve", 2),
                       max_fusion_passes=kw.pop("passes", 2),
                       convergence=kw.pop("convergence", 0.87), concurrency=8)
    return eng, model, store, mem


# ---- 1. first-pass isolation ------------------------------------------------
async def t01_first_pass_isolation():
    script = {"planner": '["sub_a","sub_b"]', "__default__": jf("independent claim UNIQUE42")}
    eng, model, *_ = mk(script)
    await eng.run("obj")
    # first-pass prompts are the ONLY ones marked "INDEPENDENT first pass"; critique
    # and retask prompts legitimately carry findings and are excluded by construction.
    first = [p for p in model.prompts if "INDEPENDENT first pass" in p["prompt"]]
    assert first, "no first-pass prompts captured"
    assert all("UNIQUE42" not in p["prompt"] for p in first), "first-pass leakage"


# ---- 2. high-value findings propagate to the bus ----------------------------
async def t02_highvalue_propagate():
    script = {"planner": '["s"]', "seat_0": jf("BIG finding alpha", importance=0.95),
              "__default__": jf("minor", importance=0.3)}
    eng, *_ = mk(script)
    r = await eng.run("obj")
    claims = " ".join(f.claim for f in r.major_findings)
    assert "BIG finding alpha" in claims, "high-value finding did not surface"


# ---- 3. a high-value finding triggers a mid-run retask ----------------------
async def t03_retask_fires():
    script = {"planner": '["s"]', "seat_0": jf("critical X", importance=0.97),
              "__default__": jf("noise", importance=0.2)}
    eng, *_ = mk(script)
    r = await eng.run("obj")
    assert len(r.retasks) >= 1, "no retask fired on a high-importance finding"
    assert any(rt.recruited for rt in r.retasks), "no idle specialist recruited"


# ---- 4. dissent survives arbitration ----------------------------------------
async def t04_dissent_survives():
    # "blue" is the well-evidenced majority; one seat dissents "not blue" (minority conf)
    script = {"planner": '["s"]',
              "seat_0": jf("the sky is blue", confidence=0.85),
              "seat_1": jf("the sky is blue", confidence=0.85),
              "seat_2": jf("the sky is not blue", confidence=0.45),
              "__default__": jf("the sky is blue", confidence=0.8)}
    eng, *_ = mk(script)
    r = await eng.run("obj")
    assert r.dissent, "dissent was erased entirely"
    assert any("not blue" in d.claim for d in r.dissent), "minority dissent not preserved"


# ---- 5. strong evidence beats numerical majority ----------------------------
async def t05_evidence_beats_majority():
    cited = [{"kind": "citation", "locator": "doi:1", "snippet": "proof"},
             {"kind": "tool_result", "locator": "calc", "snippet": "42"}]
    # 4 flat uncited clones vs 1 strongly-cited specialist claim
    script = {"planner": '["s"]',
              "seat_2": jf("MINORITY cited truth", confidence=0.7, evidence=cited),
              "__default__": jf("majority uncited opinion", confidence=0.6)}
    eng, *_ = mk(script, s=seats(6))
    r = await eng.run("obj")
    top = r.major_findings[0].claim if r.major_findings else ""
    assert "MINORITY cited truth" in top, f"majority beat evidence (top={top!r})"


# ---- 6. provider failure -> fallback, run + state survive -------------------
async def t06_failure_survives():
    script = {"planner": '["s"]', "__default__": jf("ok claim", confidence=0.6)}
    eng, model, store, _ = mk(script, fail_seats={"seat_1", "seat_3"})
    r = await eng.run("obj")
    assert r.answer, "run died on a provider failure"
    assert store.saves > 0, "no state persisted despite failures"


# ---- 7. trinity gets structured claims, not a transcript dump ---------------
async def t07_trinity_structured():
    huge = "Z" * 5000
    script = {"planner": '["s"]', "seat_0": jf("claimZ", importance=0.6),
              "__default__": jf("c " + huge, importance=0.4)}  # seats emit huge raw bodies
    eng, model, *_ = mk(script)
    await eng.run("obj")
    # trinity MEMBERS receive the ranked claim packet (CLAIM=...), bounded per claim.
    member = [p["prompt"] for p in model.prompts
              if p["seat_id"].startswith("trinity:") and p["seat_id"] != "trinity:fusion"]
    assert member and any("CLAIM=" in m for m in member), "trinity members got no ranked packet"
    # and no prompt anywhere dumps a 5000-char raw transcript
    assert all(huge not in p["prompt"] for p in model.prompts), "unbounded transcript dump reached a prompt"


# ---- 8. weak fusion triggers verification; strong does NOT ------------------
async def t08_weak_triggers_verify():
    # low-scoring findings -> weak fusion -> verify pass runs
    weak_script = {"planner": '["s"]', "trinity:fusion": jf("ans", confidence=0.1),
                   "__default__": jf("thin", confidence=0.2)}
    eng, model, *_ = mk(weak_script, passes=2)
    r = await eng.run("obj")
    verifier_prompts = [p for p in model.prompts if "Verify or refute ONLY" in p["prompt"]]
    assert verifier_prompts, "weak fusion did not trigger verification"
    # strong control: high-conf, evidence-rich -> converge, no verify needed
    cited = [{"kind": "citation", "locator": "d", "snippet": "s"},
             {"kind": "citation", "locator": "d2", "snippet": "s2"}]
    strong = {"planner": '["s"]',
              "trinity:fusion": '{"answer":"A","confidence":0.95,"weak":[],"unresolved":[]}',
              "__default__": jf("solid", confidence=0.95, importance=0.9, evidence=cited)}
    eng2, model2, *_ = mk(strong, convergence=0.6, passes=3)
    await eng2.run("obj")
    v2 = [p for p in model2.prompts if "Verify or refute ONLY" in p["prompt"]]
    assert not v2, "strong fusion wrongly triggered verification (control failed)"


# ---- 9. verified corrections enter subsequent fusion ------------------------
async def t09_verified_reenters():
    calls = {"n": 0}
    def integ(prompt, ctx):
        calls["n"] += 1
        # first fusion weak, second sees VERIFIED_FIX in packet
        if calls["n"] >= 2 and "VERIFIED_FIX" in prompt:
            return '{"answer":"final","confidence":0.95,"weak":[],"unresolved":[]}'
        return '{"answer":"draft","confidence":0.2,"weak":["x"],"unresolved":[]}'
    script = {"planner": '["s"]', "trinity:fusion": integ,
              "verifier": jf("VERIFIED_FIX correction", confidence=0.9,
                             evidence=[{"kind": "tool_result", "locator": "t", "snippet": "s"}]),
              "__default__": jf("weakish", confidence=0.3)}
    eng, *_ = mk(script, passes=3, convergence=0.9)
    r = await eng.run("obj")
    assert "final" in r.answer or calls["n"] >= 2, "verified correction never re-entered fusion"


# ---- 10. writeback only after finalization ----------------------------------
async def t10_writeback_after_finalize():
    script = {"planner": '["s"]', "__default__": jf("c", confidence=0.6)}
    eng, _, store, mem = mk(script)
    r = await eng.run("obj")
    assert mem.writes == 1, f"expected exactly one writeback, got {mem.writes}"
    assert r.memory_writes, "no memory write recorded"


# ---- 11. repeated runs improve routing (trust accrues on STABLE keys) --------
async def t11_routing_learns():
    script = {"planner": '["fixed_domain"]',
              "seat_0": jf("winner", importance=0.9, confidence=0.9),
              "__default__": jf("meh", importance=0.3)}
    import copy
    eng, *_ = mk(script)
    await eng.run("obj")
    before = copy.deepcopy(eng.perf)
    key = "m0:reasoner:fixed_domain"
    runs_before = before.get(key, {}).get("runs", 0)
    await eng.run("obj")
    assert key in eng.perf and eng.perf[key]["runs"] >= 2, "trust did not accrue on a stable key"
    assert eng.perf[key]["runs"] > runs_before, "routing stats did not update across runs"


# ---- 12. restart/recovery preserves run state -------------------------------
async def t12_resume_preserves_state():
    script = {"planner": '["s"]',
              "__default__": jf("c", confidence=0.9, importance=0.9,
                                evidence=[{"kind": "citation", "locator": "d", "snippet": "s"}])}
    eng, _, store, mem = mk(script)
    r1 = await eng.run("obj")
    # a fresh engine sharing BOTH the store and memory must not re-run or re-write
    eng2, _, _, _ = mk(script)
    eng2.store = store
    eng2.memory = mem
    r2 = await eng2.resume(r1.run_id)
    assert r2.run_id == r1.run_id, "resume lost the run id"
    assert r2.answer == r1.answer, "resume changed the finalized answer"
    assert mem.writes == 1, f"resume double-wrote memory: {mem.writes}"


# ---- 13. budget exhaustion finalizes with disclosure ------------------------
async def t13_budget_stop():
    script = {"planner": '["s"]', "__default__": jf("c", importance=0.9, confidence=0.4)}
    # STRICT ceiling: reserve-before-dispatch must block the fan-out, no tolerance.
    eng, _, _, _ = mk(script, s=seats(12))   # 12 seats vs a 3-call budget
    r = await eng.run("obj", budget=Budget(max_calls=3, max_cost_usd=999, max_wall_s=999))
    assert r.provenance["budget_spent"] <= 3, f"budget ceiling breached: {r.provenance['budget_spent']}"
    assert r.answer, "budget stop did not finalize with a disclosure answer"


# ---- 14. abstention on sub-threshold consensus ------------------------------
async def t14_abstention():
    # conflicting, evidence-poor, low-conf -> cannot reach convergence -> abstain
    script = {"planner": '["s"]',
              "seat_0": jf("A is right", confidence=0.3),
              "seat_1": jf("A is not right", confidence=0.3),
              "trinity:fusion": '{"answer":"forced","confidence":0.2,"weak":["x"],"unresolved":[]}',
              "__default__": jf("unsure", confidence=0.25)}
    eng, *_ = mk(script, convergence=0.87, passes=2)
    r = await eng.run("obj")
    assert r.abstained, "did not abstain on sub-threshold consensus"
    assert r.unresolved, "abstention disclosed no unresolved uncertainty"


# ---- 15. THE defining property: a mid-run finding redirects the STILL-RUNNING set ----
async def t15_midrun_before_slow_seat():
    # seat_0 emits a high-value finding fast; seat_5 hangs past the wall deadline. The
    # retask (triggered by seat_0) must be ISSUED while seat_5 is still running — proof
    # of streaming, not a post-hoc batch retask after every first-pass seat returns.
    script = {"planner": '["s"]', "seat_0": jf("critical alpha", importance=0.97),
              "__default__": jf("x", importance=0.2)}
    eng, model, *_ = mk(script, s=seats(6), hang_seats={"seat_5"})
    r = await eng.run("obj", budget=Budget(max_calls=200, max_cost_usd=999, max_wall_s=3))
    retask_prompts = [p for p in model.prompts if "verify/refute/extend" in p["prompt"]]
    assert r.retasks, "no retask fired mid-run"
    assert retask_prompts, "retask never issued while a seat was still hanging (batch, not streaming)"


# ---- 18. replication survives dedup and is counted ----
async def t18_replication_counted():
    from echo_fusion.schemas import EvidenceKind
    script = {"planner": '["s"]', "seat_0": jf("shared truth"), "seat_1": jf("shared truth"),
              "seat_2": jf("shared truth"), "__default__": jf("other", importance=0.2)}
    eng, *_ = mk(script, s=seats(6))
    r = await eng.run("obj")
    reps = sum(1 for f in r.major_findings for e in f.evidence
               if e.kind == EvidenceKind.REPLICATION and "shared truth" in f.claim)
    assert reps >= 2, f"replication not recorded across identical claims (reps={reps})"


# ---- 20. a contradicted finding is penalized (the -0.20 is now reachable) ----
async def t20_contradicted_penalized():
    from echo_fusion import arbitration
    from echo_fusion.schemas import Finding
    a = Finding(claim="X holds", confidence=0.8, seat_id="s1")
    b = Finding(claim="X holds", confidence=0.8, seat_id="s2", contradicted=True)
    sa = arbitration.score_clusters([[a]], {})[0][1]
    sb = arbitration.score_clusters([[b]], {})[0][1]
    assert sb < sa, f"contradicted finding not penalized ({sb} !< {sa})"


# ---- 30. tiered cascade: a weak tier-1 result escalates to the elite tier ----
async def t30_cascade_escalates_on_weak():
    # 2 cheap tier-1 seats emit weak, uncited, low-confidence findings; the elite
    # tier-2 seat must be recruited because the cheap tier can't converge.
    s = [{"id": "t1a", "model": "m0", "provider": "p0", "role": "reasoner", "tier": 1},
         {"id": "t1b", "model": "m1", "provider": "p1", "role": "researcher", "tier": 1},
         {"id": "elite", "model": "m2", "provider": "p2", "role": "reasoner", "tier": 2}]
    script = {"planner": '["s"]', "__default__": jf("weak vague guess", confidence=0.2)}
    eng, model, *_ = mk(script, s=s, reserve=0)
    await eng.run("obj")
    elite_first = [p for p in model.prompts
                   if p["seat_id"] == "elite" and "INDEPENDENT first pass" in p["prompt"]]
    assert elite_first, "weak tier-1 result did not escalate to the elite tier"


# ---- 31. tiered cascade: a strong tier-1 result does NOT escalate (cost saved) ----
async def t31_cascade_skips_on_strong():
    from echo_fusion.adapters import JsonFindingExtractor
    from echo_fusion.schemas import VerifyStatus

    class TrustedEvidenceExtractor(JsonFindingExtractor):
        def extract(self, raw, seat):
            findings = super().extract(raw, seat)
            for finding in findings:
                for evidence in finding.evidence:
                    evidence.status = VerifyStatus.VERIFIED
            return findings

    cited = [{"kind": "citation", "locator": "d", "snippet": "s"},
             {"kind": "citation", "locator": "d2", "snippet": "s2"}]
    s = [{"id": "t1a", "model": "m0", "provider": "p0", "role": "reasoner", "tier": 1},
         {"id": "t1b", "model": "m1", "provider": "p1", "role": "researcher", "tier": 1},
         {"id": "elite", "model": "m2", "provider": "p2", "role": "reasoner", "tier": 2}]
    script = {"planner": '["s"]',
              "__default__": jf("solid grounded result", confidence=0.95,
                                importance=0.6, evidence=cited)}
    eng, model, *_ = mk(script, s=s, reserve=0)
    eng.extractor = TrustedEvidenceExtractor()
    await eng.run("obj")
    elite_first = [p for p in model.prompts
                   if p["seat_id"] == "elite" and "INDEPENDENT first pass" in p["prompt"]]
    assert not elite_first, "strong tier-1 result wrongly escalated (control failed)"


# ---- 32. no-tier backcompat: every seat runs in the first wave ----
async def t32_untiered_runs_all_first_wave():
    script = {"planner": '["s"]', "__default__": jf("c", confidence=0.6)}
    eng, model, *_ = mk(script, s=seats(6), reserve=0)
    await eng.run("obj")
    first_seats = {p["seat_id"] for p in model.prompts if "INDEPENDENT first pass" in p["prompt"]}
    assert {f"seat_{i}" for i in range(6)} <= first_seats, "untiered seats did not all run in wave 1"


# ---- 33. extractor parses JSON with a natural-language PREAMBLE (no fence) ----
async def t33_extractor_parses_preamble_json():
    # real providers routinely prefix JSON with prose and NO code fence; tier-1
    # json.loads(raw) fails on the leading text, so the body must be located.
    from echo_fusion.adapters import JsonFindingExtractor
    raw = 'Sure — here is the result: {"findings":[{"claim":"preamble works","confidence":0.7}]}'
    fs = JsonFindingExtractor().extract(raw, {"id": "s", "model": "m", "role": "r", "subproblem": "d"})
    assert len(fs) == 1 and fs[0].claim == "preamble works", \
        f"preamble JSON not parsed (degraded to prose): {[f.claim for f in fs]}"
    assert abs(fs[0].confidence - 0.7) < 1e-9, "confidence lost in preamble parse"


# ---- 34. a model cannot self-grant REPLICATION (fake independent agreement) ----
async def t34_extractor_blocks_self_granted_replication():
    from echo_fusion.adapters import JsonFindingExtractor
    from echo_fusion.schemas import EvidenceKind
    raw = json.dumps({"findings": [{"claim": "i am widely agreed with", "evidence": [
        {"kind": "replication", "locator": "seat_ghost_1"},
        {"kind": "replication", "locator": "seat_ghost_2"}]}]})
    fs = JsonFindingExtractor().extract(raw, {"id": "s", "model": "m", "role": "r", "subproblem": "d"})
    assert fs, "extractor dropped the finding entirely"
    assert all(e.kind != EvidenceKind.REPLICATION for e in fs[0].evidence), \
        "model self-granted REPLICATION (fake independent agreement)"
    # an unknown/garbage evidence kind must degrade to assertion, not drop the finding
    raw2 = json.dumps({"findings": [{"claim": "keep me", "evidence": [{"kind": "bogus", "locator": "z"}]}]})
    fs2 = JsonFindingExtractor().extract(raw2, {"id": "s", "model": "m", "role": "r", "subproblem": "d"})
    assert fs2 and fs2[0].claim == "keep me", "an unknown evidence kind dropped the whole finding"


# ---- 35. merge_replication records the DISPLACED survivor's seat on a confidence swap ----
async def t35_merge_records_loser_seat_on_swap():
    from echo_fusion import arbitration
    from echo_fusion.schemas import EvidenceKind, Finding
    lo = Finding(claim="same claim here", confidence=0.5, seat_id="seat_lo")
    hi = Finding(claim="same claim here", confidence=0.9, seat_id="seat_hi")  # arrives later, stronger
    merged = arbitration.merge_replication([lo, hi])
    assert len(merged) == 1 and merged[0].seat_id == "seat_hi", "survivor wrong after swap"
    reps = {e.locator for e in merged[0].evidence if e.kind == EvidenceKind.REPLICATION}
    assert "seat_lo" in reps, f"displaced survivor's seat not recorded as replication: {reps}"


# ---- 36. cascade: uncited clones do NOT clear the escalate bar ----
async def t36_cascade_escalates_on_uncited_clones():
    # many tier-1 seats emit the SAME uncited high-self-score claim; the agreement bonus
    # must not let evidence-free assertions clear escalation. Elite tier recruited.
    s = [{"id": f"t1_{i}", "model": f"m{i}", "provider": f"p{i}", "role": "reasoner", "tier": 1}
         for i in range(7)] + [{"id": "elite", "model": "mx", "provider": "px",
                                "role": "reasoner", "tier": 2}]
    script = {"planner": '["s"]', "__default__": jf("plausible but uncited", confidence=1.0,
                                                     importance=0.6, novelty=0.5)}
    eng, model, *_ = mk(script, s=s, reserve=0)
    await eng.run("obj")
    elite_first = [p for p in model.prompts
                   if p["seat_id"] == "elite" and "INDEPENDENT first pass" in p["prompt"]]
    assert elite_first, "uncited clones cleared the escalate bar (bare assertions must escalate)"


# ---- 37. cascade: an all-tier-2 roster is NOT dispatched twice ----
async def t37_all_tier2_no_double_dispatch():
    from collections import Counter
    s = [{"id": f"e{i}", "model": f"m{i}", "provider": f"p{i}", "role": "reasoner", "tier": 2}
         for i in range(3)]
    script = {"planner": '["s"]', "__default__": jf("c", confidence=0.6)}
    eng, model, *_ = mk(script, s=s, reserve=0)
    await eng.run("obj")
    fp = Counter(p["seat_id"] for p in model.prompts if "INDEPENDENT first pass" in p["prompt"])
    assert all(fp[f"e{i}"] == 1 for i in range(3)), f"all-tier-2 roster double-dispatched: {dict(fp)}"


# ---- 38. resume mid-first-pass runs the REMAINING seats (not a partial arbitration) ----
async def t38_resume_midfirstpass_runs_remaining():
    from echo_fusion.schemas import Budget, RunPhase, RunState
    script = {"planner": '["s"]', "__default__": jf("c", confidence=0.7, importance=0.4)}
    eng, model, store, _ = mk(script, s=seats(4), reserve=0)
    st = RunState(objective="obj", phase=RunPhase.DECOMPOSED, subproblems=["s"], budget=Budget())
    assigned, _ = eng._assign(st.subproblems)
    st.assignments = assigned
    st.completed_seat_ids = [assigned[0]["id"]]      # seat_0 finished before the "crash"
    await store.save(st)
    model.prompts.clear()
    await eng.resume(st.run_id)
    fp = {p["seat_id"] for p in model.prompts if "INDEPENDENT first pass" in p["prompt"]}
    remaining = {a["id"] for a in assigned[1:]}
    assert remaining <= fp, f"resume skipped remaining first-pass seats: ran {fp}, needed {remaining}"
    assert assigned[0]["id"] not in fp, "resume re-ran an already-completed seat"


# ---- 39. bare assertions carry NO evidence weight (can't buy grounding by repetition) ----
async def t39_bare_assertions_have_no_evidence_weight():
    from echo_fusion.schemas import Evidence, EvidenceKind, Finding
    f = Finding(claim="x", evidence=[Evidence(kind=EvidenceKind.ASSERTION, locator="a"),
                                     Evidence(kind=EvidenceKind.ASSERTION, locator="b")])
    assert f.evidence_weight() == 0.0, "listing an assertion twice bought evidence weight"
    g = Finding(claim="y", evidence=[Evidence(kind=EvidenceKind.CITATION, locator="doi:1")])
    assert g.evidence_weight() > 0.0, "a real citation must still count as evidence"


# ---- 40. clustering/ranking is reproducible across runs (no uuid-order dependence) ----
async def t40_clustering_deterministic_across_runs():
    cited = lambda n: [{"kind": "citation", "locator": f"doi:{n}"}]  # noqa: E731
    script = {"planner": '["s"]',
              "seat_0": jf("alpha claim", confidence=0.8, evidence=cited(1)),
              "seat_1": jf("beta claim", confidence=0.8, evidence=cited(2)),
              "seat_2": jf("gamma claim", confidence=0.8, evidence=cited(3)),
              "__default__": jf("delta claim", confidence=0.7)}
    eng1, *_ = mk(script, s=seats(6))
    r1 = await eng1.run("obj")
    eng2, *_ = mk(script, s=seats(6))
    r2 = await eng2.run("obj")
    c1 = [f.claim for f in r1.major_findings]
    c2 = [f.claim for f in r2.major_findings]
    assert c1 == c2, f"nondeterministic major_findings across runs:\n{c1}\n{c2}"


# ---- 25. a model cannot self-grant verified / evidence.status ----
async def t25_no_self_grant():
    from echo_fusion.adapters import JsonFindingExtractor
    raw = json.dumps({"findings": [{"claim": "trust me", "verified": True, "contradicted": True,
                     "evidence": [{"kind": "citation", "status": "verified", "locator": "x"}]}]})
    fs = JsonFindingExtractor().extract(raw, {"id": "s", "model": "m", "role": "r", "subproblem": "d"})
    assert fs and fs[0].verified is False and fs[0].contradicted is False, "model self-granted verified"
    assert all(e.status.value == "unverified" for e in fs[0].evidence), "model self-granted evidence status"


TESTS = [t01_first_pass_isolation, t02_highvalue_propagate, t03_retask_fires,
         t04_dissent_survives, t05_evidence_beats_majority, t06_failure_survives,
         t07_trinity_structured, t08_weak_triggers_verify, t09_verified_reenters,
         t10_writeback_after_finalize, t11_routing_learns, t12_resume_preserves_state,
         t13_budget_stop, t14_abstention, t15_midrun_before_slow_seat,
         t18_replication_counted, t20_contradicted_penalized, t25_no_self_grant,
         t30_cascade_escalates_on_weak, t31_cascade_skips_on_strong,
         t32_untiered_runs_all_first_wave, t33_extractor_parses_preamble_json,
         t34_extractor_blocks_self_granted_replication, t35_merge_records_loser_seat_on_swap,
         t36_cascade_escalates_on_uncited_clones, t37_all_tier2_no_double_dispatch,
         t38_resume_midfirstpass_runs_remaining, t39_bare_assertions_have_no_evidence_weight,
         t40_clustering_deterministic_across_runs]


async def main():
    fails = 0
    for t in TESTS:
        try:
            await t()
            print("PASS", t.__name__)
        except Exception as e:  # noqa: BLE001
            fails += 1
            import traceback
            print("FAIL", t.__name__, "::", repr(e))
            traceback.print_exc()
    print("")
    print("ALL GREEN" if not fails else f"{fails}/{len(TESTS)} FAILING")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
