"""Clustering, dissent, and evidence-weighted arbitration.

Seeded from the recovered `ConsensusEngine` (5-stage: embed-cluster -> quality ->
weighted consensus -> validate -> confidence) and `SwarmArbitrator` (logs minority
opinions). Two review-mandated properties live here:
  * arbitration scores CLAIM CLUSTERS, not raw findings, so N flat votes cannot beat
    a few strongly-evidenced specialists (independent-agreement bonus + evidence).
  * dissent is detected and PRESERVED, never averaged away.
"""
from __future__ import annotations

import logging
import math

from .adapters import Contradictor, Embedder
from .schemas import Dissent, Evidence, EvidenceKind, Finding


def merge_replication(findings: list[Finding]) -> list[Finding]:
    """Collapse identical claims (from any phase — first pass, critique, verify) into one
    survivor, recording each distinct other seat as REPLICATION evidence. Keeps the
    highest-confidence instance so the representative is never a weak duplicate."""
    by_claim: dict[tuple[str, str], Finding] = {}
    order: list[tuple[str, str]] = []
    for f in findings:
        k = (f.subproblem, f.claim)
        if k not in by_claim:
            by_claim[k] = f
            order.append(k)
            continue
        surv = by_claim[k]
        if f.confidence > surv.confidence:          # keep the stronger instance as survivor
            f.evidence = list(f.evidence) + [e for e in surv.evidence]
            loser_seat = surv.seat_id               # the DISPLACED survivor is now the loser
            by_claim[k] = surv = f
        else:
            loser_seat = f.seat_id                  # f loses; surv stays
        # record the loser (whichever it was) as independent agreement on the survivor.
        # BUG FIXED: the swap used to set surv=f BEFORE this check, so f.seat_id==surv.seat_id
        # and the displaced survivor's own seat was silently dropped (agreement undercounted).
        if loser_seat and loser_seat != surv.seat_id and not any(
                e.kind == EvidenceKind.REPLICATION and e.locator == loser_seat for e in surv.evidence):
            surv.evidence.append(Evidence(kind=EvidenceKind.REPLICATION, locator=loser_seat))
    return [by_claim[k] for k in order]

log = logging.getLogger("echo_fusion.arbitration")


def _cos(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(x * x for x in b)) or 1.0
    return dot / (na * nb)


async def cluster_findings(findings: list[Finding], embedder: Embedder,
                           threshold: float = 0.72) -> list[list[Finding]]:
    """Single-link agglomerative clustering on claim embeddings (deterministic;
    stands in for HDBSCAN without the dep). Mutates each finding's cluster_id."""
    if not findings:
        return []
    # single-link is order-dependent and finding order is completion order (nondet
    # under real concurrency) -> sort deterministically so cluster membership, majority,
    # dissent, and the answer are reproducible run to run. Key on CONTENT, not f.id:
    # f.id is a uuid4, so an id sort was still nondeterministic across runs (measured:
    # 60 identical runs -> 7 distinct partitions).
    findings = sorted(findings, key=lambda f: (f.subproblem, f.claim, f.seat_id))
    vecs = await embedder.embed([f.claim for f in findings])
    clusters: list[list[int]] = []
    centroids: list[list[float]] = []
    for i, v in enumerate(vecs):
        best, best_sim = -1, threshold
        for ci, c in enumerate(centroids):
            s = _cos(v, c)
            if s >= best_sim:
                best, best_sim = ci, s
        if best == -1:
            clusters.append([i])
            centroids.append(list(v))
        else:
            clusters[best].append(i)
            n = len(clusters[best])
            centroids[best] = [(c * (n - 1) + x) / n for c, x in zip(centroids[best], v)]
    out: list[list[Finding]] = []
    for cid, idxs in enumerate(clusters):
        group = [findings[i] for i in idxs]
        for f in group:
            f.cluster_id = cid
        out.append(group)
    log.debug("clustered %d findings -> %d clusters", len(findings), len(out))
    return out


def _independent_seats(group: list[Finding]) -> int:
    """Distinct independent seats — including seats recorded as REPLICATION evidence
    on a survivor (dedup merges identical claims but keeps corroboration as evidence)."""
    seats = {f.seat_id for f in group if f.seat_id}
    for f in group:
        for e in f.evidence:
            if e.kind == EvidenceKind.REPLICATION and e.locator:
                seats.add(e.locator)
    return len(seats)


def _trust(perf: dict[str, dict[str, float]], model: str, role: str, domain: str) -> float:
    return perf.get(f"{model}:{role}:{domain}", {}).get("trust", 0.5)


def score_clusters(clusters: list[list[Finding]],
                   perf: dict[str, dict[str, float]]) -> list[tuple[list[Finding], float]]:
    """Evidence-weighted cluster score with independent-agreement bonus.

    cluster_score = max(member intrinsic) + agreement_bonus(#distinct independent
    seats). Intrinsic folds confidence, evidence weight, historical trust,
    importance, novelty, and verification. This is why 3 cited specialists beat 20
    uncited clones: the clones share ~1 evidence-poor cluster with a small bonus,
    the specialists form an evidence-rich cluster.
    """
    def _intrinsic(f: Finding) -> float:
        ev = f.evidence_weight()   # EXTERNAL evidence only (replication excluded)
        # self-report factors: confidence/importance/novelty are model-graded, ~0.76 max
        base = (0.34 * f.confidence + 0.18 * _trust(perf, f.model, f.role, f.subproblem)
                + 0.16 * f.importance + 0.08 * f.novelty)
        # evidence GATES, it does not merely add: no external evidence halves the score AND
        # caps it, so a confident uncited claim can't outrank a cited one on self-report.
        s = base * (0.5 + 0.5 * ev)
        if ev < 0.15:
            s = min(s, 0.42)       # hard ceiling on bare assertion
        if f.verified:
            s += 0.15
        if f.contradicted:
            s -= 0.20
        return s

    ranked: list[tuple[list[Finding], float]] = []
    for group in clusters:
        # Reorder so group[0] is the strongest representative: every consumer reads
        # g[0] (trinity packet, supported_claims, major_findings, perf winners). When
        # intrinsic strength ties, prefer the member with more independent replication;
        # otherwise async completion order can hide the cluster's best-corroborated
        # finding. The remaining content keys keep the choice deterministic.
        ordered = sorted(
            group,
            key=lambda f: (
                -_intrinsic(f),
                -_independent_seats([f]),
                f.subproblem,
                f.claim,
                f.seat_id,
            ),
        )
        group[:] = ordered
        intrinsic = _intrinsic(ordered[0]) if ordered else 0.0
        agree = _independent_seats(group)
        agreement_bonus = min(0.25, 0.08 * math.log2(agree + 1))
        ranked.append((group, min(1.5, intrinsic + agreement_bonus)))
    # tie-break on CONTENT, never on the uuid f.id (reproducibility across runs)
    ranked.sort(key=lambda p: (-p[1], p[0][0].claim if p[0] else "", p[0][0].seat_id if p[0] else ""))
    return ranked


async def detect_dissent(clusters: list[tuple[list[Finding], float]],
                         contradictor: Contradictor) -> list[Dissent]:
    """Dissent = any claim that CONTRADICTS the majority position, whether it landed
    in a separate cluster OR inside the top cluster (embedding-similar `X` / `not X`
    co-cluster — pure geometry misses logical contradiction, so NLI runs within the
    majority cluster too). First-class, preserved verbatim, never hidden."""
    if not clusters:
        return []
    majority = clusters[0][0]
    # the majority POSITION is the cluster's argmax-intrinsic representative (group[0],
    # already ordered by score_clusters) — NOT max self-reported confidence, which the
    # rest of the engine treats as a lie. Otherwise `confidence:1.0` self-promotes a
    # claim to the run's stated majority.
    maj = majority[0]
    maj_claim = maj.claim
    out: list[Dissent] = []
    seen: set[str] = set()

    def _add(claim, seats, evidence, conf, sub):
        k = claim[:60].lower()
        if k in seen:
            return
        seen.add(k)
        out.append(Dissent(claim=claim, dissenting_seats=sorted(s for s in seats if s),
                           majority_position=maj_claim, evidence=evidence,
                           confidence=conf, subproblem=sub))

    # within the majority cluster: members that contradict the dominant claim
    for f in majority:
        if f.id == maj.id:
            continue
        if await contradictor.contradicts(f.claim, maj_claim):
            _add(f.claim, [f.seat_id], list(f.evidence), f.confidence, f.subproblem)
    # across clusters: a minority cluster contradicting the majority. Its rep is the
    # argmax-intrinsic member (group[0]), consistent with the majority above.
    for group, _score in clusters[1:]:
        rep = group[0]
        if await contradictor.contradicts(rep.claim, maj_claim):
            _add(rep.claim, {f.seat_id for f in group}, [e for f in group for e in f.evidence],
                 max(f.confidence for f in group), rep.subproblem)
    if out:
        log.info("detected %d dissenting position(s)", len(out))
    return out
