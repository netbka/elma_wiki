# Request-bot coordination contract

Owner: `services/request-bot/`. Tracking: [issue #19](https://github.com/netbka/elma_wiki/issues/19). Status: implemented coordination/transport plus **bounded data-only worker/artifact/draft-PR publication and CI observation/repair**; not a completed request-to-Dev2 system.

## Authority and existing capabilities

This standalone service does not change Wiki authentication, `lib/vk-teams.mjs`, release candidates, `lib/delivery.mjs`, compiler/workspace state or Source/Target identity contracts. It executes no customer/generated code inside Wiki or the worker. An existing bot remains the single owner of its event stream.

The [plan](../plans/vk-teams-agent-delivery.md) describes the full goal. Current executable scope takes precedence over interpreting that plan as implemented: [coordinator runbook](../../services/request-bot/README.md), [worker runbook](../../services/request-bot/WORKER.md).

## State machine

`TRIAGING -> WAITING_USER -> TRIAGING -> AWAITING_APPROVAL -> QUEUED -> IMPLEMENTING -> PUBLISHING -> PR_READY`.

`BLOCKED` and `CANCELLED` are explicit stops. Questions can be skipped when the request is complete. Substantive replies/change requests increment requirements revision and invalidate prior approvals/actions. `PR_READY` means the trusted publisher's PR was independently found at the expected repository/branch/SHA. It is not passing CI, ready-on-Dev2, business acceptance, merge or completion.

All message/state changes and new jobs share a SQLite transaction. Private requests, jobs, inbox/outbox, actions, polling cursors and audit survive restart. Unauthorized identities cannot schedule work. Replayed events use the original outcome. Exports, attachments and arbitrary URLs are not executable inputs.

## Identity and routing

Bindings use exact VK user/chat IDs and optional numeric GitHub user IDs, not names. Requests are owner/project/chat-scoped. Repository, base ref, task kind and Target reference are fixed at creation. Registry changes/revocation cannot silently redirect approved work. Workers have independent keys and project/kind scopes; publication authority is separate from model analysis.

No API accepts shell commands, a user-selected deployment Target, policy overrides or arbitrary state transitions. Only the server's independent GitHub read supplies the publication receipt. User text/specifications never go to public GitHub issue/PR descriptions by default.

## Executable worker boundary

`worker.mjs` implements the existing protocol in two roles. Agent: pinned source context -> Responses API strict JSON with no tools -> validated triage or file changes -> private content-addressed artifact. Publisher: validate artifact identity/specification/base/file policy -> new Git tree/commit/branch -> draft PR -> independent receipt check. It reuses `GitHubClient` and the existing server verification; no parallel coordinator or deployment route is introduced.

This is an intentional narrower executor than a full CLI coding sandbox. It supports small `wiki_code` text additions/replacements with an operator-maintained exact path allowlist. It refuses ELMA Target jobs, missing/truncated context, symlinks/submodules/binaries, case collisions, mode changes, protected policy/credential/workflow/dependency files and model self-modification. Model output never executes locally. Build/test execution remains in operator-configured external CI, not this worker. The coordinator now independently observes those checks and can queue limited same-specification repairs; a general local execution sandbox is not supplied.

Artifacts use SHA-256 and bind request, revision, repair iteration (when nonzero), owner, chat, project, repository, base ref, approved spec hash, base SHA, before-blob hashes and file modes. Publisher checks the current base, performs lease checks before mutations, preserves the full base tree and never force-updates an existing branch. Public-code publication requires explicit policy opt-in; a simple secret-pattern check does not guarantee removal of arbitrary confidential data. Secretless/unprivileged PR CI must be reviewed before enablement.

## CI observation and repair authority

`ci.mjs` uses authenticated read-only GitHub Actions/PR calls. Optional workflow IDs, paths, required job names and a zero-to-two repair limit are normalized and pinned in the request route at creation. The limit is shown before specification approval; policy changes cannot expand existing authority. The default is no automatic repairs.

A receipt binds the current PR/head, original base, configured workflow identity, PR event/association, latest run and attempt-specific jobs. Required jobs must all conclude success; missing/partial/ambiguous data, skipped/neutral/cancelled/timeout outcomes and reruns never imply pass. The observer rereads runs/PR after collecting jobs and transactionally compares request revision, iteration, approval, route and PR before saving. API errors invalidate a previously green observation. A cancelled/revised/revoked request or service stop cannot apply late CI results.

State remains `PR_READY` with explicit `ci.status`, `observedAt` and exact SHA. A passed observation is not an acceptance/merge/deployment authorization. A failed required test may transition `PR_READY -> QUEUED -> IMPLEMENTING -> PUBLISHING -> PR_READY` without changing the approved requirements revision. A distinct iteration number (maximum two) fences jobs and artifacts. The previous implementation is validated, overlaid into model context and preserved in the cumulative replacement artifact. Each repair creates a new draft branch/PR; previous branches remain intact. Drift from the original base blocks publication. Approval, job/call budgets and all existing file restrictions still apply.

Only bounded failed-step names and job conclusions reach the model; no raw logs or arbitrary diagnostic URLs. This is a deliberately limited repair input, not a general debugging sandbox. The private configuration/runbook defines meaningful required jobs; passing an always-green configured workflow does not prove functionality. Checks are read at startup/every minute while running; the observer is not a GitHub Actions scheduler. Per-sweep and pagination limits fail closed rather than silently dropping checks.

## Leases, budgets and uncertainty

One active job per request. Claims receive a new fencing token, expiry and maximum deadline. Heartbeats cannot extend past the deadline. Late results cannot change state; identical completed receipts are acknowledged. Worker network requests abort on cancellation, deadline or last granted lease expiry, including a stalled heartbeat. The coordinator cannot forcibly terminate another process or roll back an already accepted remote operation.

Read-only triage can recover up to three claims. Unknown code/publication outcomes block. The worker journal reserves model calls before dispatch; daily call and per-response token/context limits are persisted/bounded. These are not an exact dollar cap. Provider spending controls remain required. No automatic generation retry occurs after an uncertain response.

External sends are durably marked before dispatch. Unknown issue creations are reconciled by read. The publisher similarly reads an ambiguously created branch/PR instead of blindly repeating the POST. Existing branches are never overwritten. Unknown results, orphan Git objects/branches and undelivered callbacks require inspection; absence in a bounded lookup is not proof of no effect. Cancellation is not rollback.

## Storage decision

Use built-in `node:sqlite` on Node 22.16+ (experimental on Node 22) for the single-host pilot, without npm dependencies. Coordinator DB and private worker artifact/journal DB are separate. Both use WAL and synchronous FULL. Coordinator schema 2 adds job iteration to uniqueness via a transactional migration preserving old jobs, leases and receipts as iteration zero. Back up and stop the old service before upgrade; old schema-1 binaries cannot reopen the upgraded DB. Worker artifact format stays compatible for iteration zero. Workers access coordinator state only through authenticated HTTP, never its database. Agent/publisher share only the protected local artifact store.

This intentionally narrows the original PostgreSQL proposal and is not distributed/high-availability storage. The separate service does not change the Wiki runtime requirement. NTFS ACLs, backup/restore, retention, disk quotas and provider controls must be configured before a pilot. Multi-host storage, retention pruning and automated unknown-outcome recovery are not implemented.

## Unimplemented/live-unverified gates

The data-only model worker and publisher exist as code with HTTP/provider-double tests. Actual model/account compatibility, VK installation and GitHub transport are not proven by them. A full tool-using executor/build sandbox, live CI/repair pilot, bot-to-preview/ELMA bridge integration, browser screenshots, acceptance and merge remain open. The separate Wiki operator bridge is not automatically integrated by this service.

Future delivery must reuse explicit immutable candidate, current approval, Target identity, drift check, separately authorized dispatch and read-back. Browser checks must target that verified candidate and produce actual private screenshots/deep links. No PROD or deployment endpoint exists here. Enabling workers is a separate operational action, not a side effect of merging this PR.

## Verification

`npm --prefix services/request-bot test` includes actual SQLite, restart, concurrent connections, HTTP roles, adversarial model/file outputs and fake network contracts. `test/worker.test.mjs` adds the full coordinator-to-worker-to-publisher receipt path and failure tests, including cumulative two-iteration CI repair. `test/ci.test.mjs` covers origin/attempt/current-head validation, negative statuses, policy limits, late results and schema migration. No existing Wiki renderer is changed. Passing these tests is not live model, CI-quality, ELMA or Dev2 evidence.
