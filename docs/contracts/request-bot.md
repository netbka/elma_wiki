# Request-bot coordination contract

Owner: `services/request-bot/`. Tracking: [issue #19](https://github.com/netbka/elma_wiki/issues/19). Status: implemented coordination/transport plus **bounded data-only worker/artifact/draft-PR publication**; not a completed request-to-Dev2 system.

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

This is an intentional narrower executor than a full CLI coding sandbox. It supports small `wiki_code` text additions/replacements with an operator-maintained exact path allowlist. It refuses ELMA Target jobs, missing/truncated context, symlinks/submodules/binaries, case collisions, mode changes, protected policy/credential/workflow/dependency files and model self-modification. Model output never executes locally. Tests/builds and the CI fix loop still need a separately isolated execution capability.

Artifacts use SHA-256 and bind request, revision, owner, chat, project, repository, base ref, approved spec hash, base SHA, before-blob hashes and file modes. Publisher checks the current base, performs lease checks before mutations, preserves the full base tree and never force-updates an existing branch. Public-code publication requires explicit policy opt-in; a simple secret-pattern check does not guarantee removal of arbitrary confidential data. Secretless/unprivileged PR CI must be reviewed before enablement.

## Leases, budgets and uncertainty

One active job per request. Claims receive a new fencing token, expiry and maximum deadline. Heartbeats cannot extend past the deadline. Late results cannot change state; identical completed receipts are acknowledged. Worker network requests abort on cancellation, deadline or last granted lease expiry, including a stalled heartbeat. The coordinator cannot forcibly terminate another process or roll back an already accepted remote operation.

Read-only triage can recover up to three claims. Unknown code/publication outcomes block. The worker journal reserves model calls before dispatch; daily call and per-response token/context limits are persisted/bounded. These are not an exact dollar cap. Provider spending controls remain required. No automatic generation retry occurs after an uncertain response.

External sends are durably marked before dispatch. Unknown issue creations are reconciled by read. The publisher similarly reads an ambiguously created branch/PR instead of blindly repeating the POST. Existing branches are never overwritten. Unknown results, orphan Git objects/branches and undelivered callbacks require inspection; absence in a bounded lookup is not proof of no effect. Cancellation is not rollback.

## Storage decision

Use built-in `node:sqlite` on Node 22.16+ (experimental on Node 22) for the single-host pilot, without npm dependencies. Coordinator DB and private worker artifact/journal DB are separate. Both use WAL and synchronous FULL. Workers access coordinator state only through authenticated HTTP, never its database. Agent/publisher share only the protected local artifact store.

This intentionally narrows the original PostgreSQL proposal and is not distributed/high-availability storage. The separate service does not change the Wiki runtime requirement. NTFS ACLs, backup/restore, retention, disk quotas and provider controls must be configured before a pilot. Multi-host storage, retention pruning and automated unknown-outcome recovery are not implemented.

## Unimplemented/live-unverified gates

The data-only model worker and publisher exist as code with HTTP/provider-double tests. Actual model/account compatibility, VK installation and GitHub transport are not proven by them. A full tool-using executor/build sandbox, CI observation/repair, live preview/ELMA bridge, browser screenshots, acceptance and merge remain open.

Future delivery must reuse explicit immutable candidate, current approval, Target identity, drift check, separately authorized dispatch and read-back. Browser checks must target that verified candidate and produce actual private screenshots/deep links. No PROD or deployment endpoint exists here. Enabling workers is a separate operational action, not a side effect of merging this PR.

## Verification

`npm --prefix services/request-bot test` includes actual SQLite, restart, concurrent connections, HTTP roles, adversarial model/file outputs and fake network contracts. `test/worker.test.mjs` adds the full coordinator-to-worker-to-publisher receipt path and failure tests. No existing Wiki renderer is changed. Passing these tests is not live model, CI-quality, ELMA or Dev2 evidence.
