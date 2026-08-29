# Recovered Echo Swarm Brain

This directory contains the brain recovered from `HAMMER:C:\wt-pay\systems\echo_swarm_brain` on 2026-08-29. `SOURCE_PROVENANCE.json` records the SHA-256 of every original source file and the canonical runtime comparison. Deployment helpers and one runtime default were security-sanitized after independent PR review; their separate QUENCH hashes and exact transformation reasons are recorded in that manifest.

The service provides:

- `GET /health`
- `POST /trinity/consult`
- `POST /trinity/decide`
- `POST /swarm/think`
- `POST /llm/hybrids/run` for ensemble, debate, and chain workflows
- artifact upload/readback routes
- optimized grade parsing, weighted consensus, transcript construction, health caching, and connection pooling

Run locally from this directory:

```text
python -m pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8260
python -m pytest tests -q
```

The Echo Swarm plugin reaches this service only through the fixed loopback `SWARM_BRAIN_BASE` setting. Callers cannot provide another origin. The Maximalist fused-output runtime is a separate service, `echo-fusion-worker`, reached through `FUSION_WORKER_BASE`.

The systemd template binds to `127.0.0.1` and reads runtime secrets from `/etc/echo/echo-swarm-brain.env` or the existing protected Echo environment files. The Cloudflare registration helpers fail closed unless their `CF_*` account, identity, hostname, and service variables are explicitly injected; no production account IDs, tunnel IDs, email addresses, passwords, or internal service addresses are embedded in the repository copy.

The recovered prompts include their original comic-grading specialization. They are preserved as authoritative source, not silently generalized. Use the TypeScript council for general multi-model tasks and the recovered brain when its Trinity, ensemble, debate, consensus, or artifact contract is specifically desired.
