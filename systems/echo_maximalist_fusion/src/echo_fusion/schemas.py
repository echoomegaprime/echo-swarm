"""Echo Maximalist Fusion Brain — data contracts (pydantic v2).

Every object that enters the finding bus is schema-validated here; this is the
fix for the #1 blocking issue all five reviews named (the static-0.50 extractor).
Scores are typed + bounded; claim_type is enumerated so fact/value/prediction are
fused separately, never averaged together.
"""
from __future__ import annotations

import time
import uuid
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


def _uid() -> str:
    return uuid.uuid4().hex[:12]


def _f(x: object, default: float = 0.0) -> float:
    try:
        return float(x)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


class ClaimType(str, Enum):
    FACT = "fact"
    PROCEDURE = "procedure"
    PREDICTION = "prediction"
    VALUE = "value"
    DEFINITION = "definition"


class EvidenceKind(str, Enum):
    CITATION = "citation"
    TOOL_RESULT = "tool_result"
    RETRIEVAL = "retrieval"
    REPLICATION = "replication"   # another seat independently agreed
    ASSERTION = "assertion"       # bare claim, lowest weight


class VerifyStatus(str, Enum):
    UNVERIFIED = "unverified"
    VERIFIED = "verified"
    CONTRADICTED = "contradicted"
    DISCLOSED = "disclosed"       # unresolved but surfaced, never hidden


class Evidence(BaseModel):
    kind: EvidenceKind = EvidenceKind.ASSERTION
    locator: str = ""             # url / tool name / crystal id
    snippet: str = ""
    retrieved_at: float = Field(default_factory=time.time)
    status: VerifyStatus = VerifyStatus.UNVERIFIED

    def reliability(self) -> float:
        base = {
            EvidenceKind.CITATION: 0.9, EvidenceKind.TOOL_RESULT: 0.85,
            EvidenceKind.RETRIEVAL: 0.7, EvidenceKind.REPLICATION: 0.8,
            EvidenceKind.ASSERTION: 0.3,
        }[self.kind]
        # Provider-supplied labels are claims about evidence, not verification.
        # Until a trusted verifier changes status, cap external-looking evidence so
        # a model cannot win arbitration merely by calling fabricated text a citation.
        if self.status != VerifyStatus.VERIFIED and self.kind in {
                EvidenceKind.CITATION, EvidenceKind.TOOL_RESULT, EvidenceKind.RETRIEVAL}:
            base = min(base, 0.45)
        if self.status == VerifyStatus.VERIFIED:
            base = min(1.0, base + 0.1)
        elif self.status == VerifyStatus.CONTRADICTED:
            base *= 0.3
        return base


class Finding(BaseModel):
    """One atomic claim emitted by one seat. The unit of the finding bus."""
    id: str = Field(default_factory=_uid)
    claim: str
    claim_type: ClaimType = ClaimType.FACT
    evidence: list[Evidence] = Field(default_factory=list)
    # Model-stated scores are advisory; the engine recomputes importance/novelty
    # (reviews: "the scores are lies" — self-graded scores get overwritten).
    confidence: float = 0.5
    novelty: float = 0.5
    importance: float = 0.5
    subproblem: str = ""
    source_refs: list[str] = Field(default_factory=list)
    seat_id: str = ""
    model: str = ""
    role: str = ""
    verified: bool = False
    contradicted: bool = False
    verification_notes: list[str] = Field(default_factory=list)
    # set by clustering; findings in the same cluster corroborate each other
    cluster_id: int | None = None

    @field_validator("confidence", "novelty", "importance")
    @classmethod
    def _bound(cls, v: float) -> float:
        return max(0.0, min(1.0, float(v)))

    @field_validator("claim")
    @classmethod
    def _cap_claim(cls, v: str) -> str:
        return (v or "")[:8000]   # truncate, never raise — bounds state + memory writes

    def evidence_weight(self) -> float:
        # REPLICATION is independent-agreement (credited via the arbitration agreement
        # bonus, not here). ASSERTION is a bare claim — it must carry ZERO weight, or
        # "list your assertion twice" reaches weight 0.30 and defeats the ev<0.15 gate
        # (measured). Only genuinely external evidence (citation/tool_result/retrieval)
        # counts toward grounding.
        ext = [e for e in self.evidence
               if e.kind not in (EvidenceKind.REPLICATION, EvidenceKind.ASSERTION)]
        if not ext:
            return 0.0
        return min(1.0, sum(e.reliability() for e in ext) / 2.0)


class Dissent(BaseModel):
    """First-class minority state. NEVER deleted because the majority disagrees."""
    id: str = Field(default_factory=_uid)
    claim: str
    dissenting_seats: list[str] = Field(default_factory=list)
    majority_position: str = ""
    reason_rejected: str | None = None
    evidence: list[Evidence] = Field(default_factory=list)
    confidence: float = 0.5
    subproblem: str = ""
    later_outcome: str | None = None
    vindicated: bool | None = None


class Retask(BaseModel):
    seat_id: str
    subproblem: str
    reason: str
    trigger_finding_ids: list[str] = Field(default_factory=list)
    recruited: bool = False       # True when a previously-idle specialist is pulled in


class SeatResult(BaseModel):
    seat_id: str
    model: str
    role: str
    subproblem: str
    raw_output: str = ""
    findings: list[Finding] = Field(default_factory=list)
    latency_ms: int = 0
    cost_usd: float = 0.0
    error: str | None = None


class FusionCandidate(BaseModel):
    answer: str = ""
    confidence: float = 0.0
    model_stated_confidence: float | None = None   # cross-checked vs arbitration
    supported_claims: list[str] = Field(default_factory=list)
    weak_claim_ids: list[str] = Field(default_factory=list)
    unresolved: list[str] = Field(default_factory=list)
    abstained: bool = False


class Budget(BaseModel):
    """Hard ceiling — the $1,000-Copilot failure class does not repeat here."""
    max_calls: int = 200
    max_cost_usd: float = 5.0
    max_wall_s: float = 600.0
    calls_spent: int = 0
    cost_spent: float = 0.0
    started_at: float = Field(default_factory=time.time)

    def remaining_calls(self) -> int:
        return max(0, self.max_calls - self.calls_spent)

    def exhausted(self) -> bool:
        return (self.calls_spent >= self.max_calls
                or self.cost_spent >= self.max_cost_usd
                or (time.time() - self.started_at) >= self.max_wall_s)

    def try_reserve(self) -> bool:
        """Atomically claim a call slot BEFORE dispatch. Returns False if the ceiling
        is reached. This closes the check-then-charge race: the count increments here,
        synchronously, so a fan-out of 200 against max_calls=3 blocks 197 immediately."""
        if self.exhausted():
            return False
        self.calls_spent += 1
        return True

    def settle(self, cost_usd: float = 0.0) -> None:
        self.cost_spent += max(0.0, _f(cost_usd))

    def charge(self, cost_usd: float = 0.0) -> None:  # back-compat
        self.calls_spent += 1
        self.cost_spent += max(0.0, _f(cost_usd))


class RunPhase(str, Enum):
    CREATED = "created"
    DECOMPOSED = "decomposed"
    FIRST_PASS = "first_pass"
    DISSENT = "dissent"
    RETASK = "retask"
    CRITIQUE = "critique"
    ARBITRATED = "arbitrated"
    FUSING = "fusing"
    FINALIZED = "finalized"


class RunState(BaseModel):
    """The durable scratch state (spec §6). Snapshotted after each phase so a
    crash mid-run resumes without re-paying the first pass (verification #12)."""
    run_id: str = Field(default_factory=lambda: "run_" + _uid())
    objective: str = ""
    phase: RunPhase = RunPhase.CREATED
    subproblems: list[str] = Field(default_factory=list)
    assignments: list[dict[str, Any]] = Field(default_factory=list)
    findings: list[Finding] = Field(default_factory=list)
    dissent: list[Dissent] = Field(default_factory=list)
    retasks: list[Retask] = Field(default_factory=list)
    fusion_pass: int = 0
    candidate: FusionCandidate | None = None
    budget: Budget = Field(default_factory=Budget)
    memory_reads: list[str] = Field(default_factory=list)
    completed_seat_ids: list[str] = Field(default_factory=list)
    updated_at: float = Field(default_factory=time.time)

    def touch(self, phase: RunPhase | None = None) -> None:
        if phase is not None:
            self.phase = phase
        self.updated_at = time.time()


class FusionResult(BaseModel):
    run_id: str
    answer: str
    confidence: float
    abstained: bool = False
    major_findings: list[Finding] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    dissent: list[Dissent] = Field(default_factory=list)
    unresolved: list[str] = Field(default_factory=list)
    models_used: list[str] = Field(default_factory=list)
    retasks: list[Retask] = Field(default_factory=list)
    fusion_passes: int = 0
    memory_reads: list[str] = Field(default_factory=list)
    memory_writes: list[str] = Field(default_factory=list)
    performance_updates: list[dict[str, Any]] = Field(default_factory=list)
    provenance: dict[str, Any] = Field(default_factory=dict)
