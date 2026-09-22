# GPT connection and model selection

The private Swarm council invokes the official Codex CLI before the GPT API. The
selected model ID is preserved, including `gpt-6-astra`. Subscription credentials
are resolved by Codex itself and are never pulled into the browser or app server.
The public edition uses the caller's API connection and cannot invoke private
CLI sessions or borrow server credentials.

Set `SWARM_CODEX_CLI_BIN` to a trusted absolute executable path. The tested host
installation is Codex 0.155.1; 0.149.1 was rejected by Astra as too old. An updated
client and a valid login do not establish remaining usage or model entitlement.
The connection screen reports configuration; each response reports its actual
route and model.

The subprocess receives the prompt on stdin, an isolated temporary directory,
read-only sandbox, no approvals, and disabled built-in tools, web search, plugins,
apps, and subagents. Provider API keys are stripped from its environment. Calls
are bounded by 128 KB input, 1 MB combined output, two concurrent processes, and
a 120-second timeout that stops the subprocess tree. Only a completed final
answer counts as success.

An explicit OpenAI API key in Connect, or a managed `OPENAI_API_KEY` installed by
the deployment's authorized secret owner, enables paid fallback after a known
CLI quota, authentication, model, or client-version rejection. No key means no
API fallback. A partial answer, timeout, output overflow, concurrency rejection,
or unknown failure does not trigger fallback. This prevents replaying work whose
outcome is uncertain. The API route uses `/v1/responses`, preserves the selected
model, requests low reasoning for reasoning models, and does not send obsolete
`max_tokens` or unsupported temperature controls. Incomplete API responses are
errors and are not retried automatically.

Codex subscription allowance and OpenAI API credit are separate. Use
[Codex usage](https://chatgpt.com/codex/settings/usage) for the CLI account and
[API billing](https://platform.openai.com/settings/organization/billing/overview)
for the account/project owning the configured API key. Purchasing credits alone
does not install an API key on the Brain host.

The OpenRouter picker refreshes from the provider's public model catalog with
timeouts, size limits, and a one-hour cache. It includes text-capable models and
excludes batch-only routes. A model listing does not establish purchased access.

These routes serve the interactive council. The separate 40-seat
MAXIMALIST_RECONSTRUCTED worker retains its own provider bindings; updating this
picker does not turn its local ANVIL seats into cloud-model seats.

## Other official clients and managed keys

Private Grok and Claude seats invoke their own first-party CLIs. Configure trusted
absolute executable paths with `SWARM_GROK_CLI_BIN` and `SWARM_CLAUDE_CLI_BIN`.
Claude Fable 5.1 requires a newer Claude Code version than 2.1.150; version
2.1.278 completed a direct live check during this work. Grok 4.7 completed a direct
live check on QUENCH. The production app runs on FORGE, so the QUENCH session
still needs an approved connection to the app. It cannot be reused merely by
listing a Grok seat or by copying its authentication store.

The connection screen no longer pulls Codex, Claude, or Grok tokens. Each CLI
receives bounded requests, and its route is attached to the returned answer.
Grok and Claude calls do not automatically fall back to another provider.

For API providers, service-managed keys use the provider's declared environment
variable, for example `TOGETHER_API_KEY`. The authorized vault owner must supply
that binding to the service. The app has no secret-enumeration or export endpoint.
Together's current model IDs were checked against the
[official serverless catalog](https://docs.together.ai/docs/serverless/models).

## Release and rollback

Run the repository's required checks, the subprocess/fallback tests, a browser
smoke check, and exact-SHA release gates before replacing the production release.
Keep the existing app and CLI installations until the candidate is accepted.
Rollback restores the previous immutable app directory and its original service
configuration. Do not copy authentication stores between hosts.

The implementation includes no paid key, host login, automatic purchase, or
authorization grant. A managed credential or cross-host CLI route must be
installed through the deployment's approved credential and service ownership.
