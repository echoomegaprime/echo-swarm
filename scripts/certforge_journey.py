"""Dependency-free critical journey for ECHO Certification Forge.

Certification Forge executes this script with no network and no project
dependencies inside an isolated Python sandbox against the exact acquired
commit. The full JavaScript and Python behavioral suites run separately; this
journey proves that the acquired artifact contains the intact plugin, brain,
Fusion worker, and twelve-tool MCP contract required for release.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path
import sys
from typing import NoReturn


CRITICAL_SURFACES = (
    ".codex-plugin/plugin.json",
    ".echo/apps.json",
    ".echo/certification.json",
    ".mcp.json",
    "package.json",
    "package-lock.json",
    "src/components/swarm/composer.tsx",
    "src/components/swarm/thread.tsx",
    "src/lib/swarm/engine.server.ts",
    "src/lib/swarm/mcp-brain.server.ts",
    "src/lib/swarm/mcp-maximalist.server.ts",
    "src/lib/swarm/voice.ts",
    "src/routes/api/plugin/mcp.ts",
    "systems/echo_swarm_brain/SOURCE_PROVENANCE.json",
    "systems/echo_swarm_brain/app.py",
    "systems/echo_maximalist_fusion/SOURCE_PROVENANCE.json",
    "systems/echo_maximalist_fusion/src/echo_fusion/engine.py",
    "systems/echo_maximalist_fusion/src/echo_fusion_worker/app.py",
)

JSON_SURFACES = (
    ".codex-plugin/plugin.json",
    ".echo/apps.json",
    ".echo/certification.json",
    ".mcp.json",
    "package.json",
    "systems/echo_swarm_brain/SOURCE_PROVENANCE.json",
    "systems/echo_maximalist_fusion/SOURCE_PROVENANCE.json",
)

EXPECTED_MCP_TOOLS = (
    "swarm_convene",
    "swarm_brief",
    "swarm_ping",
    "swarm_brain_health",
    "swarm_brain_think",
    "swarm_brain_trinity_consult",
    "swarm_brain_trinity_decide",
    "swarm_brain_hybrid",
    "swarm_maximalist_health",
    "swarm_maximalist_start",
    "swarm_maximalist_result",
    "swarm_maximalist_resume",
)

REQUIRED_NPM_SCRIPTS = (
    "build",
    "typecheck",
    "lint",
    "test",
    "test:mcp",
    "check:auth",
)

INSTALL_LIFECYCLE_HOOKS = ("preinstall", "install", "postinstall", "prepare")


def fail(message: str) -> NoReturn:
    print(f"ECHO_SWARM_CRITICAL_JOURNEY_FAILED: {message}", file=sys.stderr)
    raise SystemExit(1)


def require_surfaces() -> None:
    missing = [path for path in CRITICAL_SURFACES if not Path(path).is_file()]
    if missing:
        fail("missing critical surface(s): " + ", ".join(missing))


def parse_json_surfaces() -> dict[str, object]:
    parsed: dict[str, object] = {}
    for path in JSON_SURFACES:
        try:
            parsed[path] = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            fail(f"{path} is not valid UTF-8 JSON: {exc}")
    return parsed


def parse_python_sources() -> int:
    roots = (
        Path("systems/echo_swarm_brain"),
        Path("systems/echo_maximalist_fusion/src"),
        Path("systems/echo_maximalist_fusion/tests"),
    )
    modules = sorted(
        path
        for root in roots
        for path in root.rglob("*.py")
        if "__pycache__" not in path.parts
    )
    if not modules:
        fail("no recovered brain or Fusion Python modules found")
    for module in modules:
        try:
            ast.parse(module.read_text(encoding="utf-8"), filename=str(module))
        except (OSError, SyntaxError, UnicodeDecodeError) as exc:
            fail(f"{module} does not parse: {exc}")
    return len(modules)


def validate_package(package: object) -> None:
    if not isinstance(package, dict):
        fail("package.json must contain an object")
    scripts = package.get("scripts")
    if not isinstance(scripts, dict):
        fail("package.json has no scripts object")
    missing = [name for name in REQUIRED_NPM_SCRIPTS if name not in scripts]
    if missing:
        fail("package.json missing verifier script(s): " + ", ".join(missing))
    forbidden = [name for name in INSTALL_LIFECYCLE_HOOKS if name in scripts]
    if forbidden:
        fail("package.json contains install lifecycle hook(s): " + ", ".join(forbidden))


def validate_app_opt_in(apps: object) -> None:
    if not isinstance(apps, dict) or apps.get("version") != 1:
        fail(".echo/apps.json must use version 1")
    app_map = apps.get("apps")
    if not isinstance(app_map, dict):
        fail(".echo/apps.json has no apps object")
    for app_name in ("certification-forge", "release-sentinel"):
        if app_map.get(app_name) != {"enabled": True}:
            fail(f"{app_name} is not explicitly enabled")


def validate_journey_manifest(manifest: object) -> None:
    expected = ["python3", "-B", "scripts/certforge_journey.py"]
    if not isinstance(manifest, dict) or manifest.get("version") != 1:
        fail(".echo/certification.json must use version 1")
    if manifest.get("journey") != expected:
        fail("certification journey argv drifted from the bounded contract")


def validate_tool_contract() -> None:
    paths = (
        Path("src/routes/api/plugin/mcp.ts"),
        Path("src/lib/swarm/mcp-brain.server.ts"),
        Path("src/lib/swarm/mcp-maximalist.server.ts"),
    )
    corpus = "\n".join(path.read_text(encoding="utf-8") for path in paths)
    missing = [tool for tool in EXPECTED_MCP_TOOLS if f'"{tool}"' not in corpus]
    if missing:
        fail("missing MCP tool declaration(s): " + ", ".join(missing))


def main() -> None:
    require_surfaces()
    parsed = parse_json_surfaces()
    module_count = parse_python_sources()
    validate_package(parsed["package.json"])
    validate_app_opt_in(parsed[".echo/apps.json"])
    validate_journey_manifest(parsed[".echo/certification.json"])
    validate_tool_contract()
    print(
        "ECHO_SWARM_CRITICAL_JOURNEY_OK "
        f"python_modules={module_count} "
        f"critical_surfaces={len(CRITICAL_SURFACES)} "
        f"mcp_tools={len(EXPECTED_MCP_TOOLS)} "
        "install_hooks=0"
    )


if __name__ == "__main__":
    main()
