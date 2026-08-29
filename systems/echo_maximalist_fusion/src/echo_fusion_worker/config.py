"""echo-fusion-worker · config — fail-closed seats loader.

The seats config is the clone-swarm defense: 60 lanes are NOT 60 independents,
so `provider` MUST be the backend FAMILY (openai|anthropic|google|local|xai), not
a model string. If provider is wrong, the arbitration agreement-bonus rewards
correlated (clone) answers — the exact failure the scorer exists to prevent. This
loader therefore ENUMERATES what is allowed and rejects everything else; it never
warns-and-continues.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

# The only valid `provider` values — a backend family, never a model string.
VALID_PROVIDERS: frozenset[str] = frozenset({"openai", "anthropic", "google", "local", "xai"})

VALID_TIERS: frozenset[int] = frozenset({1, 2})
_REQUIRED_SEAT_FIELDS = ("id", "model", "provider", "role")


class SeatsConfigError(ValueError):
    """Raised when a seats config would open the clone-swarm gate or is malformed.

    Fail-closed: an invalid config is refused, never silently repaired.
    """


def _validate_seat(seat: Any, where: str) -> dict[str, Any]:
    if not isinstance(seat, dict):
        raise SeatsConfigError(f"{where}: seat must be a mapping, got {type(seat).__name__}")
    for field in _REQUIRED_SEAT_FIELDS:
        if not seat.get(field):
            raise SeatsConfigError(f"{where}: seat {seat.get('id', '<no-id>')!r} missing required field {field!r}")
    provider = seat["provider"]
    if provider not in VALID_PROVIDERS:
        raise SeatsConfigError(
            f"{where}: seat {seat['id']!r} has provider {provider!r}, which is not a backend "
            f"family. Allowed: {sorted(VALID_PROVIDERS)}. (Using a model string here recreates "
            f"the clone-swarm failure.)"
        )
    tier = seat.get("tier", 1)
    if tier not in VALID_TIERS:
        raise SeatsConfigError(f"{where}: seat {seat['id']!r} has tier {tier!r}, must be one of {sorted(VALID_TIERS)}")
    return seat


# Trinity members are shaped {name, model, role} (the integrator/reasoner/expander
# triad the engine reads directly). `provider` is OPTIONAL here — but when present it
# is still validated to a backend family, so the "trinity on distinct providers"
# independence intent can be enforced without breaking the engine's contract.
_REQUIRED_TRINITY_FIELDS = ("name", "model", "role")


def _validate_trinity_member(member: Any, where: str) -> dict[str, Any]:
    if not isinstance(member, dict):
        raise SeatsConfigError(f"{where}: trinity member must be a mapping, got {type(member).__name__}")
    for field in _REQUIRED_TRINITY_FIELDS:
        if not member.get(field):
            raise SeatsConfigError(f"{where}: trinity member {member.get('name', '<no-name>')!r} missing {field!r}")
    provider = member.get("provider")
    if provider is not None and provider not in VALID_PROVIDERS:
        raise SeatsConfigError(
            f"{where}: trinity member {member['name']!r} has provider {provider!r}, not a backend "
            f"family. Allowed: {sorted(VALID_PROVIDERS)}."
        )
    return member


def load_seats_dict(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate a raw config mapping (fail-closed) and return the normalized config.

    Required keys: seats (>=1), trinity (exactly 3), planner_seat. Optional:
    verifier_seats, reserve_specialists, profile_default.
    """
    if not isinstance(raw, dict):
        raise SeatsConfigError(f"config root must be a mapping, got {type(raw).__name__}")

    seats = raw.get("seats")
    if not isinstance(seats, list) or not seats:
        raise SeatsConfigError("config must define a non-empty 'seats' list")
    seats = [_validate_seat(s, f"seats[{i}]") for i, s in enumerate(seats)]

    trinity = raw.get("trinity")
    if not isinstance(trinity, list) or len(trinity) != 3:
        raise SeatsConfigError(
            f"'trinity' must be a list of exactly 3 members (got "
            f"{len(trinity) if isinstance(trinity, list) else raw.get('trinity')!r})"
        )
    trinity = [_validate_trinity_member(t, f"trinity[{i}]") for i, t in enumerate(trinity)]

    planner = raw.get("planner_seat")
    if not planner:
        raise SeatsConfigError("config must define 'planner_seat'")
    planner = _validate_seat(planner, "planner_seat")

    verifiers = raw.get("verifier_seats", [])
    if not isinstance(verifiers, list):
        raise SeatsConfigError("'verifier_seats' must be a list when present")
    verifiers = [_validate_seat(v, f"verifier_seats[{i}]") for i, v in enumerate(verifiers)]

    reserve = raw.get("reserve_specialists", 4)
    if not isinstance(reserve, int) or reserve < 0:
        raise SeatsConfigError(f"'reserve_specialists' must be a non-negative int, got {reserve!r}")

    return {
        "seats": seats,
        "trinity": trinity,
        "planner_seat": planner,
        "verifier_seats": verifiers,
        "reserve_specialists": reserve,
        "profile_default": raw.get("profile_default", "stub"),
    }


def load_seats(path: str | Path) -> dict[str, Any]:
    """Load and validate a seats.yaml file. Fail-closed on a missing/invalid file."""
    p = Path(path)
    if not p.is_file():
        raise SeatsConfigError(f"seats config not found at {p}")
    import yaml  # local import so importing this module never requires PyYAML

    with p.open("r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)
    return load_seats_dict(raw)


def seats_fingerprint(cfg: dict[str, Any]) -> str:
    """Stable short hash over the routing-relevant surface (seat id+provider+tier,
    trinity, planner, verifiers). Reported by /health so a config drift is visible.
    """
    def _sig(seat: dict[str, Any]) -> list[Any]:
        return [seat.get("id") or seat.get("name"), seat.get("provider"),
                seat.get("model"), seat.get("tier", 1), seat.get("role")]

    payload = {
        "seats": sorted(_sig(s) for s in cfg["seats"]),
        "trinity": sorted(_sig(t) for t in cfg["trinity"]),
        "planner": _sig(cfg["planner_seat"]),
        "verifiers": sorted(_sig(v) for v in cfg["verifier_seats"]),
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:16]
