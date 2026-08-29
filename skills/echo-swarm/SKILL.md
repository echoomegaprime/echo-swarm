---
name: echo-swarm
description: Convene GPT, Claude, Gemini, Grok, free or local models, the recovered Echo Swarm Brain, and the Maximalist Echo Fusion Worker inside the current chat. Use for multi-model brainstorming, debate, building, review, validation, evidence-aware certification review, fused answers, and swarm status.
---

# Echo Swarm

Use the Echo Swarm MCP tools to make external model participation visible in the current chat.

1. Call `swarm_ping` before a provider-dependent run and report unavailable seats honestly.
2. Use `swarm_convene` for interactive collaboration. Select the smallest useful set of live seats and choose a purpose: `brainstorm`, `debate`, `build`, `review`, `validate`, `certify`, `plan`, or `report`.
3. Use `swarm_maximalist_start`, then poll `swarm_maximalist_result`, when the user requests fused output. Preserve dissent, uncertainty, provenance, and the returned run ID.
4. Use `swarm_brain_health`, `swarm_brain_think`, `swarm_brain_trinity_consult`, `swarm_brain_trinity_decide`, or `swarm_brain_hybrid` when the recovered Python brain contract is specifically useful.
5. Never claim an advisory `certify` council response is official certification. Official status requires an exact-SHA CertForge/GitHub App verdict and receipt.
6. Do not request, print, or echo provider credentials. Prefer existing OAuth/session-backed seats and degrade unavailable providers independently.

When returning results, identify contributing models, skipped seats, preserved dissent, unresolved uncertainty, and whether the answer came from the council, the recovered brain, or the Echo Fusion Worker.
