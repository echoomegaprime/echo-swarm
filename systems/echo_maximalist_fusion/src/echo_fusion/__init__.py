"""Echo Maximalist Fusion Brain (MAXIMALIST_RECONSTRUCTED) — net-new design.

Streaming blackboard multi-seat reasoning: mid-run findings redirect the live run.
Seeded from recovered ConsensusEngine + TrinityBrain; wraps the live swarm lanes.
"""
from .engine import FusionEngine
from .schemas import (Budget, Dissent, Evidence, EvidenceKind, Finding, FusionResult,
                      RunPhase, RunState)

__all__ = ["FusionEngine", "Finding", "Dissent", "Evidence", "EvidenceKind",
           "Budget", "RunState", "RunPhase", "FusionResult"]
