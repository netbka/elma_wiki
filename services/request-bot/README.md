# VK Teams request coordinator (issue #19)

A runnable, **disabled-by-default** internal service. It receives requests, saves the conversation, obtains version-bound approval, queues isolated worker jobs, and independently verifies the PR reported by a trusted publisher. It is not an autonomous coding agent or a live ELMA deployer.

## Run without any accounts

Node.js 22.16+ is required for this separate service. There are **no npm dependencies**. Node 22 marks `node:sqlite` experimental; this service does not change the Wiki server's runtime requirements.

```sh
npm --prefix services/request-bot test
npm --prefix services/request-bot run demo
```

The demo explicitly uses synthetic participants and stops at a missing real executor. It does not invent a successful PR, screenshot, or Dev2 result.

## What is implemented

SQLite transactions, durable inbox/outbox and polling cursor, request/project identity bindings, clarification and specification revision, explicit approvals, separate agent/publisher roles, bounded worker leases and run deadlines, stale-result fencing, cancellation, issue creation and safe state comments, GitHub HMAC validation and authorized comment replies, VK transport and dedicated polling or existing-dispatcher ingress, and recovery every 15 minutes while the service is running.

Only safe request IDs and state projections go into GitHub, because the project repositories are public. User text, requirements and chat identifiers stay in the private database and original authorized conversation. Ordinary issue comments and bot state comments cannot trigger jobs.

## Deployment boundary

**Not implemented or enabled here:** LLM/sandbox provisioning, a code-writing worker, artifact storage and trusted patch publisher, CI repair loop, live Wiki preview/ELMA adapter, Dev2 approval/import/read-back, browser screenshots, user acceptance, or merge. The service stops at `PR_READY`; that state does not mean tests passed, Dev2 changed, or the task is finished. No route executes shell commands, starts an LLM, imports a package, or merges a PR.

Do not give the coding worker the coordinator database, VK/GitHub credentials, Docker socket, deployment credentials or publisher key. Run it on a separately approved isolated executor. The future delivery integration must call the existing release/delivery capability; do not duplicate `lib/delivery.mjs` or call `elma365pm` from this service. See [contract](../../docs/contracts/request-bot.md).

## Configure an authorized pilot

Copy `config.example.json` into a private directory **outside Git** and replace the placeholder identities. Store the DB/WAL/SHM files in a dedicated local private directory, not in a public web root or network filesystem. The coordinator binds to **127.0.0.1** only. Remote access needs a controlled TLS reverse proxy; never expose it with plaintext bearer tokens. Enforce request rate limits and an IP allowlist at that boundary.

Set secret variables referenced by the config through your secret manager. Agent, publisher, ingress, operator and webhook secrets must be independent random values of at least 32 characters. The config contains secret *names*, not secret values. For GitHub use the configured App/bot identity with only issues read/write and pull requests read; this service does not need contents write or administration. The independent publisher has its own installation/credential, outside this service. Token suppliers read the environment on each request; a service restart is required when its environment is changed externally.

Start only after the parameters are supplied and authorized:

```sh
REQUEST_BOT_ENABLED=1 \
REQUEST_BOT_CONFIG=/private/request-bot/config.json \
REQUEST_BOT_DATABASE=/private/request-bot/requests.sqlite \
node services/request-bot/server.mjs
```

Default port: 43174 (`REQUEST_BOT_PORT`). No schedule or deployment is installed merely by merging this code. The database uses WAL, synchronous FULL, transactional migrations and private file permissions. Protect the parent directory and backups with filesystem ACLs, especially on Windows.

### Existing bot vs dedicated bot

Default `vk.mode=dispatcher`: the existing bot's **single** event consumer POSTs `{"events":[...]}` (raw VK Bot API events) to `/integrations/vk/events` with its ingress bearer token. The dispatcher should checkpoint only after a successful response and may replay a batch. Inspect per-event outcomes, including rejections; acknowledge callback queries through the existing bot's normal mechanism. This service does not poll in dispatcher mode.

For a new dedicated bot, select `dedicated-polling` and set `dedicatedBotConfirmed=true`. Its loop calls `events/get`, persists every event outcome and advances the cursor in one transaction. Do **not** enable this mode for the existing shared bot. SDK-compatible callback sender IDs are checked; API compatibility and callback acknowledgements must be tested on the actual VK installation. Polling/data retention gaps are not reconstructed automatically.

### User commands

- `/task wiki <description>` (or `elma`) starts a request in an allowed project.
- `/reply REQ-... <answer>` answers/changes the current requirement; `/changes REQ-... <feedback>` also reopens a prepared PR iteration.
- `/approve REQ-... <revision>` or the version-bound button approves the specification, **not deployment**.
- `/status REQ-...` and `/cancel REQ-...` work only for that request's owner/chat.

A natural-language first message is accepted in a private chat bound to exactly one project. A natural-language answer is accepted when exactly one active request is waiting for clarification. With multiple active requests, use an explicit request ID or a supported reply-to-message ID. Group chat traffic requires explicit commands. Cancellation stops new jobs; existing PRs are retained and no rollback is implied.

### GitHub replies

Configure an issue-comment webhook at `/integrations/github/webhook`, with the independent HMAC secret. Add the trusted human's numeric `githubUserId` to their identity binding. Only a new `/reply ...` or `/changes ...` comment on that user's already-linked issue is accepted. Repository, issue, sender and comment-author identities are checked. The deduplication key is the repository/comment identity, not an attacker-replaceable delivery header. Edited comments and ordinary prose never approve or change a task.

## Worker protocol

Workers use independent bearer keys. Each key is restricted to configured project IDs and job kinds. The publisher cannot share an agent role/key. Do not construct a shell command from these JSON fields.

`POST /worker/claim` with `{}` returns `{job:null}` or a job containing `id`, `kind`, `revision`, `leaseToken`, `expires`, the private request context and fixed repository/target routing. `triage` is read-only analysis. `implement` is issued only after approval of the exact current specification. `publish` is a separate trusted stage.

`POST /worker/jobs/:id/heartbeat` with `{"leaseToken":"..."}` renews the lease, but never past the run deadline. Every worker must stop side effects on lease loss. The publisher must recheck the lease immediately before publishing. The coordinator cannot forcibly stop an external process; isolation, process termination and monetary/token budgets must be enforced by the executor.

`POST /worker/jobs/:id/complete` takes `leaseToken` and one of these `result` objects:

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

First two results are triage-only; patch manifest is implement-only; PR result is publisher-only. The implementer cannot claim a PR exists or report a deployment. Arbitrary extra fields (such as `targetRef` or `state`) are rejected. The publisher must independently retrieve and verify the artifact digest, base commit, allowed changes, tests and repository policy before publishing. The service never dereferences `artifactId` as a filesystem path or URL.

The PR must be open in the configured base repository/ref, with a same-repository branch `bot/<lowercase request ID>/v<revision>` and the body marker `<!-- request-bot:REQ-...:vN -->`. The coordinator independently reads GitHub to match the PR number, head SHA, repositories, branch and marker before recording `PR_READY`. A green build is not inferred from that read.

`POST /worker/jobs/:id/fail` takes `leaseToken` and `code`: `worker_failed`, `budget_exhausted`, `unsupported_capability` or `tests_failed`. Errors are structured codes, not raw logs or credentials.

## Recovery and operator controls

The process checks expired jobs/sends on startup and every 15 minutes; job claims also require an unexpired lease. Expired read-only triage can retry up to three claims. An expired implementation or publish job becomes `BLOCKED/worker_outcome_unknown` and is **not automatically repeated**. A stuck/revoked route does not prevent other eligible jobs from being claimed. Configuration changes cannot silently retarget an approved request.

An ambiguous external send becomes `unknown`. Unknown issue creations are looked up by bot author and unique marker, without reissuing the POST. The lookup is bounded to 300 recent issues: absence does not prove the POST failed. Unknown VK sends/comments remain visible for operator inspection; `/status` requests a fresh current card. Exactly-once external delivery is not promised.

With the operator bearer key, `GET /ops/status` returns recent queue/outbox statuses without private conversation text, tokens or worker results. `POST /ops/reconcile` runs recovery once. `/healthz` is public but only returns health and `liveDelivery:false`. There is no public request-list or arbitrary request-read endpoint.

For a blocked code/publish job, inspect the external runner and PR before doing anything else. Do not edit SQLite rows to reissue a job. Cancel the request and create an explicitly authorized replacement after accounting for prior effects; old PRs remain linked in the audit/history. Automated retry controls for unknown side effects are intentionally absent.

Before a live pilot, configure DB backups and restore rehearsal, private storage retention, host ACLs, reverse-proxy rate limits, secret rotation and runner supervision. Avoid logging VK URLs/query strings: this API carries its token in query parameters. The coordinator sanitizes provider errors but cannot configure your proxy logs. Retention pruning, high availability and multi-host storage are not supplied by this slice.

## Evidence

`npm test` covers the real SQLite implementation, restart, two connections, HTTP role separation, versioned approvals, cancellation, stale/duplicate worker callbacks, bounded leases, invalid model outputs, webhook signatures, polling cursor atomicity, unknown external-send recovery and privacy-safe GitHub projections. Network provider responses are test doubles; these tests are not evidence of connection to a real bot, agent, PR publisher or ELMA.
