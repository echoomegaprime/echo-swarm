"""echo-fusion-worker — async HTTP host for the echo_fusion engine behind echo.fusion.run.

Import-time side effects are avoided here: importing this package does NOT build the
service app from env (that lives in `.app`, built only when `.app` is imported or the
service boots). Config + factory symbols are safe to import anywhere.
"""
from .config import (VALID_PROVIDERS, SeatsConfigError, load_seats,
                     load_seats_dict, seats_fingerprint)
from .factory import (MAX_CALLS_CEILING, MAX_COST_CEILING, MAX_WALL_CEILING,
                      StubModelAdapter, build_engine, clamp_budget, register_profile)

__all__ = [
    "VALID_PROVIDERS", "SeatsConfigError", "load_seats", "load_seats_dict",
    "seats_fingerprint", "build_engine", "register_profile", "clamp_budget",
    "StubModelAdapter", "MAX_CALLS_CEILING", "MAX_COST_CEILING", "MAX_WALL_CEILING",
]
