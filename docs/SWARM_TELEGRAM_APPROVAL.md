# Swarm OAuth approval through Commander Telegram

Swarm's existing OAuth middleware only presents an owner-key form. It does not
create a Commander request or notify Telegram. The optional Telegram mode uses
the installed Commander consent implementation and its existing protected
notification outbox. It does not copy bot credentials or change the recipient.

After a new validated authorization request, the browser shows the request
fingerprint and waits. The Commander receives the existing expiring review link
and one-time code. Approving on the phone resumes the original browser and its
PKCE-bound OAuth callback. Denial, expiry, used requests, unavailable dependencies,
and notification enqueue failures cannot issue a code. Previously approved
client/redirect/scope combinations reconnect without another notification.

## Deployment dependencies and gates

This is a source change, not a deployment receipt. The current running source is
under `/home/forge/echo-swarm-releases/53fe74b4e8ea6d3a39b127a3e6f0d1fbb8456a7b`,
including subsequent OAuth security edits from the unmerged PR #9 stack. Do not
overwrite that directory or infer that its directory name identifies its entire
current contents. The repair branch is based on PR #9's exact head
`a79c9bfba3f9330c6dd2fe586ff09eb0266a5874`.

The running owner service must retain its existing admitted user, protected
database, `echo-oauth-consent-page.path` watcher and Telegram sender. The adapter
only accepts the reviewed `/home/forge/echo-unified-mcp-bridge/oauth_consent.py`
with SHA-256
`c7d218137f56628cfec97b2d41355a6c4d55b70318fe074176c72fd9f56d2fe2`.
A changed or missing dependency fails closed and requires fresh review. Swarm
client IDs are namespaced with `echo-swarm::`; all reads, decisions and completion
also require the pinned Swarm MCP resource. Other services' requests cannot be
viewed or approved through these routes.

Only an exact-SHA reviewed and certified deployment may enable
`SWARM_TELEGRAM_CONSENT=1` for `echo-swarm.service`. The default remains the existing
owner-key gate. `/usr/bin/python3` and the installed consent module are the
defaults; `SWARM_CONSENT_PYTHON` and `SWARM_CONSENT_MODULE_PATH` are administrator
configuration, never request parameters. The public origin defaults to
`https://swarm-app.echo-op.com`; an explicit `SWARM_OAUTH_PUBLIC_ORIGIN` must be the
verified HTTPS origin. Notification links never derive from caller Host headers.

Retain `SWARM_MCP_TOKEN` in its existing protected injection path. Do not put its
value, approval codes or approval links in an issue, PR, report, command line or
chat. Approval inputs travel to the helper over stdin, and dependency failures
produce bounded public errors without raw subprocess output.

## Verification

Use Node 24 or a compatible TypeScript loader, Python 3.10+, and an exact copy of
the reviewed owner module outside the repository. Set
`SWARM_TEST_CONSENT_MODULE` to that copy and `SWARM_TEST_PYTHON` if Python is not
named `python`. These suites explicitly use temporary databases and outboxes;
they send no messages and change no real consent records.

```text
node --test scripts/oauth-telegram-consent.test.mjs
python scripts/test_oauth_consent_bridge.py -v
npm run typecheck
npm run lint
npm test
npm run build:private
python -m pytest systems/echo_swarm_brain/tests -q
```

Without the reviewed module, dependency integration cases are explicitly skipped;
that is not full-flow validation. Separately verify the real deployment after
certification: start one fresh owner-requested Swarm connection, read the pager's
safe delivery receipt, have the owner approve the matching request on Telegram,
then read back `swarm_ping` through the reconnected client. HTTP metadata, service
liveness and a queued file alone do not establish phone delivery or connection.

## Rollback

Before release, preserve the active service unit, drop-ins, source hashes and
prior artifact. Disable `SWARM_TELEGRAM_CONSENT` through that same managed service
configuration and return to the previous exact artifact within the authorized
window. The existing owner-key flow remains available. Revert the repair commit
for source rollback. Never delete the shared consent store or rotate credentials
as part of rollback.
