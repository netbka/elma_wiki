# VK Teams request coordinator (issue #19)

A runnable, **disabled-by-default** internal service for requests, private conversation, version-bound approval, worker jobs and independently verified PR receipts. The separate [data-only agent and trusted publisher](WORKER.md) now implement the worker protocol for bounded file edits. This is not a complete autonomous request-to-Dev2 system.

## Run without accounts

Node.js 22.16+; no npm dependencies. Node 22 marks `node:sqlite` experimental. This separate service does not change the Wiki server runtime requirements.

```sh
npm --prefix services/request-bot test
npm --prefix services/request-bot run demo
```

The demo remains coordinator-only: synthetic participants, explicit stop at a missing executor, no invented PR or screenshot. `test/worker.test.mjs` exercises the new agent/artifact/publisher path through the real HTTP coordinator with fake model/GitHub responses. Worker setup and commands are in [WORKER.md](WORKER.md).

## Runtime and boundaries

The coordinator implements transactional SQLite requests/inbox/outbox/jobs, identity bindings, clarification/revisions/approval, independent worker/publisher roles, leases/deadlines/cancellation, safe GitHub issue/status projections, signed webhook replies, VK transport and dispatcher or dedicated polling, plus startup/15-minute recovery while the process is running.

The worker implements bounded model analysis/file changes, private SHA-256 artifacts, a durable attempt/call-budget journal and draft PR publication. It runs no model tools, shell, checkout or generated code. It refuses ELMA Target jobs. Its publisher may publish explicitly authorized code, but never private request text in PR titles/descriptions.

**Still not implemented:** general sandbox/build/test execution, CI repair, live Wiki preview/ELMA delivery integration, Dev2 approval/import/read-back, browser screenshots, user acceptance and merge. `PR_READY` means a matched PR receipt, not passing CI or a completed task. No coordinator route executes shell commands, starts an LLM, imports a package or merges a PR. Future delivery must reuse `lib/delivery.mjs` and its candidate/Target/confirmation/read-back contract.

## Configure an authorized coordinator pilot

Copy `config.example.json` into a private directory outside Git; replace the placeholder identities. Keep DB/WAL/SHM and backups out of web roots and network filesystems. Protect directories/NTFS ACLs, especially on Windows. The coordinator binds to **127.0.0.1**. Remote access requires a controlled TLS reverse proxy, firewall/allowlist and rate limits, not plaintext bearer tokens.

Provide the named secrets through your secret manager. Agent, publisher, ingress, operator and webhook keys must be independent random values of at least 32 characters. Configuration holds names, not secret values. Coordinator GitHub access requires its App/bot identity with issues read/write and pull requests read; no contents-write or administration. The publisher uses a separate key and GitHub credential. The new agent has a dedicated **read-only** GitHub credential; it never receives the publisher key, bot token, coordinator database, Docker socket or Target credentials.

```sh
REQUEST_BOT_ENABLED=1 \
REQUEST_BOT_CONFIG=/private/request-bot/config.json \
REQUEST_BOT_DATABASE=/private/request-bot/requests.sqlite \
node services/request-bot/server.mjs
```

Port defaults to 43174 (`REQUEST_BOT_PORT`). Merging code installs no daemon/schedule and connects no account. SQLite uses WAL, synchronous FULL and transactional migrations. Restart services after changing their environment-provided secrets. Before enabling the new narrow worker, restrict its coordinator bindings to `projects: ["wiki"]` as described in WORKER.md; the generic coordinator example also includes unimplemented ELMA jobs.

### Existing vs dedicated bot

Default `vk.mode=dispatcher`: the existing bot's **single** consumer POSTs `{"events":[...]}` with raw VK events to `/integrations/vk/events` using its ingress bearer key. Checkpoint only after a successful response; batches may be replayed. Inspect per-event rejections. The existing dispatcher acknowledges callback queries normally. No additional poller starts in this mode.

Only for a new dedicated bot, use `dedicated-polling` and `dedicatedBotConfirmed=true`. It calls `events/get` and persists outcomes/cursor atomically. Never enable a competing consumer for the shared bot. Callback identity/acknowledgement and retention behavior must be tested on the actual VK installation; gaps are not reconstructed automatically.

### User commands

`/task wiki <description>` creates a request in a bound project. `/reply REQ-... <answer>` or `/changes REQ-... <feedback>` revises the same request. `/approve REQ-... <revision>` or its one-time button approves that specification, **not deployment**. `/status REQ-...` and `/cancel REQ-...` require the matching owner/chat.

A first natural-language private message works with exactly one bound project; an unqualified reply works with exactly one waiting request. Otherwise use request ID or supported reply-to-message. Groups require commands. Cancellation stops new jobs, preserves existing PRs and does not imply rollback.

### GitHub replies

Configure `/integrations/github/webhook` and an independent HMAC secret. Map the human's numeric `githubUserId`. Only a new `/reply ...` or `/changes ...` on that user's linked issue is accepted. Repository, issue, sender and comment-author IDs are checked; deduplication uses repository/comment identity. Ordinary prose, edited comments and bot status projections cannot approve or launch jobs. Private user text/specifications remain in the authorized conversation/coordinator.

## Worker HTTP protocol

Each worker key is restricted to project IDs and job kinds. The publisher cannot share an agent role/key. Never construct a shell command from request JSON.

`POST /worker/claim` with `{}` returns `{job:null}` or `id`, `kind`, `revision`, `leaseToken`, `expires`, private request context and fixed routing. `triage` is read-only; `implement` requires current specification approval; `publish` is separately trusted.

`POST /worker/jobs/:id/heartbeat` with `{"leaseToken":"..."}` renews only within the run deadline. Workers must abort on lease loss. Publishers check immediately before each mutation. The coordinator cannot forcibly terminate a remote process or undo an already accepted remote request.

`POST /worker/jobs/:id/complete` accepts `leaseToken` and one appropriate `result`:

```json
{"type":"needs_input","questions":["Which form should change?"]}
```
```json
{"type":"specification","summary":"Expected behavior","criteria":["Observable test"],"scope":["Included change"]}
```
```json
{"type":"patch_ready","artifactId":"private_artifact_id","sha256":"<64 lowercase hex>","baseSha":"<40 lowercase hex>"}
```
```json
{"type":"pull_request","number":123,"headSha":"<40 lowercase hex>"}
```

The first two are triage-only; manifest is implement-only; PR is publisher-only. Extra fields, arbitrary states or targets are rejected. Artifact IDs are never treated as host paths/URLs. The trusted publisher validates bytes, identity, baseline and file policy; the new worker publishes a **draft with CI still required**, not a claim of tests having run.

The PR must be open in the configured repository/base ref, on same-repository branch `bot/<lowercase request ID>/v<revision>`, with `<!-- request-bot:REQ-...:vN -->`. The coordinator reads GitHub independently to match number/head/repositories/ref/marker. That receipt is not CI evidence.

`POST /worker/jobs/:id/fail` accepts `leaseToken` and `code`: `worker_failed`, `budget_exhausted`, `unsupported_capability`, `tests_failed`. No raw logs/secrets. Identical completed receipts are idempotently acknowledged.

## Recovery and operation

On startup/every 15 minutes, expired read-only triage can be retried up to three claims. Expired code/publication work becomes `BLOCKED/worker_outcome_unknown`, not an automatic retry. Stale configuration cannot silently retarget work. The new worker's separate attempt/artifact journal and in-flight cancellation limits are documented in WORKER.md.

An ambiguous send becomes `unknown`. Unknown issue creation is searched by bot author/unique marker, never re-POSTed blindly. Lookup covers 300 recent issues; absence is not proof of failure. Unknown VK sends/comments require inspection; `/status` creates a current card. Exactly-once delivery is not promised.

Operator-key `GET /ops/status` shows queue/outbox status without private conversation; `POST /ops/reconcile` runs recovery once. Public `/healthz` returns only health and `liveDelivery:false`. There is no public arbitrary request-reader.

For blocked code/publication, inspect the private worker journal and GitHub first. Do not edit SQLite to force re-execution. Cancel and create an authorized replacement only after accounting for prior effects. Configure backups/restore tests, retention, disk monitoring, host ACLs, secret rotation and supervision before a live pilot. No high availability, retention pruning or multi-host storage is provided. Ensure proxy logs redact VK URLs/query strings, which carry tokens.

## Evidence

Tests use real SQLite and HTTP authorization, with network providers replaced. They cover identity/revision/routing isolation, replay/cancellation/expiry, HMAC/cursors/outbox recovery and worker generation/artifact/publication boundaries. Live VK/model/GitHub transport, code quality on a real task, Dev2 and screenshots remain unverified. See the [coordination contract](../../docs/contracts/request-bot.md) and [worker runbook](WORKER.md).
