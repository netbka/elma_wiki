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

The Wiki portal can submit to this same coordinator without VK Teams. See
[portal API and private configuration](../../docs/contracts/portal-requests.md)
and `portal.example.json`. Portal-only mode omits `vk`; its authenticated
session identity uses an explicit project allowlist and a separate ingress key.
The secondary internal `/requests` panel uses this API. It does not start
workers or add a competing primary navigation destination.

The coordinator implements transactional SQLite requests/inbox/outbox/jobs, identity bindings, clarification/revisions/approval, independent worker/publisher roles, leases/deadlines/cancellation, safe GitHub issue/status projections, signed webhook replies, VK transport and dispatcher or dedicated polling, plus startup/15-minute recovery while the process is running.

The worker implements bounded model analysis/file changes, private SHA-256 artifacts, a durable attempt/call-budget journal and draft PR publication. It runs no model tools, shell, checkout or generated code. It refuses ELMA Target jobs. Its publisher may publish explicitly authorized code, but never private request text in PR titles/descriptions.

**Still not implemented:** general sandbox/local build/test execution, live Wiki preview/ELMA delivery integration, Dev2 approval/import/read-back, browser screenshots, user acceptance and merge. `PR_READY` means a matched PR receipt, not passing CI or a completed task. No coordinator route executes shell commands, starts an LLM, imports a package or merges a PR. Future delivery must reuse `lib/delivery.mjs` and its candidate/Target/confirmation/read-back contract.

## Configure an authorized coordinator pilot

For the bounded #19 preparation package, use [PILOT.md](PILOT.md) and `pilot/*.example.json`. These prepare a portal-only, single-path synthetic task with separate credentials and disabled publication. Actual private bindings and execution readiness remain operator inputs.

Copy `config.example.json` into a private directory outside Git; replace the placeholder identities. Keep DB/WAL/SHM and backups out of web roots and network filesystems. Protect directories/NTFS ACLs, especially on Windows. The coordinator binds to **127.0.0.1**. Remote access requires a controlled TLS reverse proxy, firewall/allowlist and rate limits, not plaintext bearer tokens.

Provide the named secrets through your secret manager. Agent, publisher, ingress, operator and webhook keys must be independent random values of at least 32 characters. Configuration holds names, not secret values. Coordinator GitHub access requires its App/bot identity with issues read/write and pull requests read; optional CI observation also needs Actions read, but no contents-write or administration. The publisher uses a separate key and GitHub credential. The new agent has a dedicated **read-only** GitHub credential; it never receives the publisher key, bot token, coordinator database, Docker socket or Target credentials.

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

`POST /worker/claim` with `{}` returns `{job:null}` or `id`, `kind`, `revision`, `iteration`, `leaseToken`, `expires`, private request context and fixed routing. `triage` is read-only; `implement` requires current specification approval; `publish` is separately trusted.

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

The PR must be open in the configured repository/base ref, on same-repository branch `bot/<lowercase request ID>/v<revision>`, with `<!-- request-bot:REQ-...:vN -->`. The coordinator reads GitHub independently to match number/head/repositories/ref/marker. That receipt is not CI evidence. Automatic repairs use a new branch ending in `-fix1` or `-fix2` and marker `<!-- request-bot:REQ-...:vN:fix1 -->` (or `fix2`). The original branch/marker remain unchanged for iteration zero.

`POST /worker/jobs/:id/fail` accepts `leaseToken` and `code`: `worker_failed`, `budget_exhausted`, `unsupported_capability`, `tests_failed`. No raw logs/secrets. Identical completed receipts are idempotently acknowledged.

## CI observation and bounded repairs

Optional `projects.<id>.ci` belongs to the **private coordinator configuration**, not model output or issue labels. Omit it to keep the previous behavior. For example, after looking up the real workflow ID and exact job names:

```json
{
  "workflows": [
    { "id": 123456, "path": ".github/workflows/test.yml", "jobs": ["unit", "browser"] }
  ],
  "maxRepairs": 0
}
```

The numeric ID/names above are illustrative, not this repository's configured checks. Up to four workflows and eight jobs per workflow are supported. The default repair limit is **zero**. An operator may set one or two; the exact limit is displayed on the specification approval card. That policy is pinned in the request route. Changing it or revoking a user's binding cannot grant more authority to existing requests; create a new approved request instead. The example configuration deliberately does not enable CI or repair.

While the coordinator is running, `ci.mjs` reads at startup, every 60 seconds and through the operator's `/ops/reconcile`. It checks only configured `PR_READY` requests, up to 20 per sweep, oldest observation first. The 15-minute expired-job recovery remains separate. No GitHub Actions cron, daemon or background service is installed by the code. Stop/shutdown prevents an in-flight CI read from applying a new observation or queuing a repair; each provider call remains bounded by its timeout.

The observer independently reads the PR, current head and original base, configured workflow ID/path, `pull_request` association and latest run/attempt, then every required job in that attempt. It checks the run list and PR again before applying the result. It never accepts a model claim, arbitrary webhook payload, another branch's green badge, or a run for another PR/base. Reads are bounded to 300 entries per collection and reject incomplete/ambiguous pagination. Missing runs wait; skipped, neutral, cancelled, timed-out, ambiguous or missing required jobs cannot pass. API errors change the current observation to `unavailable`, rather than retaining an old green badge.

`/status` includes the CI state, exact head, observation timestamp and repair count. Repeated unchanged scans do not resend the same notification. `passed` is a timestamped observation of the configured CI jobs, not proof of every acceptance criterion, a fresh merge permission, Dev2 deployment or business acceptance. Job selection is an operator responsibility: the trusted workflow must actually run the necessary tests, not just contain an always-green placeholder. Draft PRs can execute workflows; only reviewed, unprivileged, secretless workflows may be used with model-generated code.

A confirmed test failure may enqueue a bounded repair **within the same approved specification**. Requirements revision and approval stay unchanged; a separate iteration counter increments. The worker verifies and overlays the previous artifact so the model sees its failed implementation, then preserves all earlier changes that the repair did not touch. The publisher validates the cumulative result against the original base and creates a separate draft PR/branch. It never force-pushes, closes the old PR or merges. Original-base drift stops publication rather than rebasing without review.

Only configured job names, conclusions and bounded failed-step names are provided as CI feedback. Raw logs, output text, artifact downloads and diagnostic URLs are **not** followed. This limits automatic fixes: a generic step named `npm test` may not contain enough information for a useful repair. The worker must not guess beyond the supplied context, weaken tests or expand scope. Two failed repairs, the existing job/call budget, cancelled checks or unclear outcomes stop automatic progression. The user can send `/changes` to propose a new requirements revision; the next specification requires approval again.

### Database upgrade

The coordinator migrates SQLite schema 1 to **2** transactionally, preserving request/job IDs, leases and recorded results; old jobs become iteration zero. Its uniqueness constraint now includes iteration. Back up the database consistently, stop the old coordinator and upgrade all worker/publisher processes together before resuming. The previous schema-1 service must not be restarted on the upgraded database. Downgrade only by restoring an appropriate backup while accounting for any external effects. Worker artifact format for iteration zero remains unchanged; repair artifacts add an iteration binding.

## Recovery and operation

On startup/every 15 minutes, expired read-only triage can be retried up to three claims. Expired code/publication work becomes `BLOCKED/worker_outcome_unknown`, not an automatic retry. Stale configuration cannot silently retarget work. The new worker's separate attempt/artifact journal and in-flight cancellation limits are documented in WORKER.md.

An ambiguous send becomes `unknown`. Unknown issue creation is searched by bot author/unique marker, never re-POSTed blindly. Lookup covers at most 300 recent issues and checks all fetched pages for duplicate markers. Only a complete bounded listing with one valid matching issue can supply a receipt. Duplicate markers, malformed receipts or a full third page retain the unknown outcome for inspection; absence is not proof of failure. Unknown VK sends/comments require inspection; `/status` creates a current card. Exactly-once delivery is not promised.

Operator-key `GET /ops/status` shows queue/outbox status without private conversation; `POST /ops/reconcile` runs recovery and configured CI observation once. Public `/healthz` returns only health and `liveDelivery:false`. There is no public arbitrary request-reader.

For blocked code/publication, inspect the private worker journal and GitHub first. Do not edit SQLite to force re-execution. Cancel and create an authorized replacement only after accounting for prior effects. Configure backups/restore tests, retention, disk monitoring, host ACLs, secret rotation and supervision before a live pilot. No high availability, retention pruning or multi-host storage is provided. Ensure proxy logs redact VK URLs/query strings, which carry tokens.

## Evidence

Tests use real SQLite and HTTP authorization, with network providers replaced. They cover identity/revision/routing isolation, replay/cancellation/expiry, HMAC/cursors/outbox recovery and worker generation/artifact/publication boundaries, CI origin/attempt/SHA validation, schema upgrade, cancellation during observation, and the HTTP failure -> repair -> new draft PR path including repair-budget exhaustion. Live VK/model/GitHub transport, code quality on a real task, Dev2 and screenshots remain unverified. See the [coordination contract](../../docs/contracts/request-bot.md) and [worker runbook](WORKER.md).
