# Request-bot coordination contract

Owner: `services/request-bot/`. Tracking: [issue #19](https://github.com/netbka/elma_wiki/issues/19). Status: implemented coordination/transport slice; **not a completed request-to-Dev2 system**.

## Authority and existing capabilities

This standalone service does not change Wiki authentication, `lib/vk-teams.mjs`, release candidates, `lib/delivery.mjs`, compiler/workspace state or Source/Target identity contracts. It runs no customer code inside the Wiki service. An existing bot must remain the single owner of its event stream.

The original [plan](../plans/vk-teams-agent-delivery.md) describes the full outcome. Current runtime scope and exact commands are in the [service runbook](../../services/request-bot/README.md); that description takes precedence over interpreting planned capabilities as implemented.

## Implemented state machine

`TRIAGING -> WAITING_USER -> TRIAGING -> AWAITING_APPROVAL -> QUEUED -> IMPLEMENTING -> PUBLISHING -> PR_READY`.

`BLOCKED` and `CANCELLED` are explicit stops. Questions can be skipped for a complete request. A substantive reply or PR change request increments the requirements revision and invalidates old approval/actions. PR_READY means only that the trusted publisher's PR was independently found at the expected GitHub repository/branch/SHA. It is **not** ready-on-Dev2, business acceptance, verified CI, merge or completion.

All message handling/state changes and new queue entries share a SQLite transaction. Private request records, jobs, inbox, outbox, approval actions, polling cursors and audit survive restart. Unknown events and unauthorized identities cannot schedule work. Replayed events use the original result. Raw .e365 attachments and arbitrary URLs are not accepted as executable inputs.

## Identity and routing

Bindings use exact VK user/chat IDs and optional numeric GitHub user IDs, not display names. A request is owner/project/chat-scoped. The project registry fixes repository, base ref, task kind and target reference at creation. Changing the registry or revoking the owner cannot silently change an approved job's destination. Workers have separate keys and project/kind scopes; publisher authority is distinct from coding authority.

No API accepts a user-supplied shell command, deployment target, policy override or arbitrary state transition. The server supplies the verified-publication receipt; it cannot be provided by the model or worker JSON. User text/specifications never go into a public GitHub issue/comment by default.

## Leases and uncertainty

One active job per request. Each claim has a new secret fencing token, an expiry and a maximum run deadline. Heartbeats cannot exceed the deadline; late callbacks do not change state. Exact completed callbacks are idempotently acknowledged. The executor must stop itself on lease loss; this service does not claim process-level fencing of remote side effects.

Read-only triage can recover up to three attempts. Uncertain code/publishing outcomes block rather than rerun. External sends are durably marked before dispatch. Lost acknowledgements are not called failures-with-no-effect: an uncertain issue create is reconciled by read; uncertain messages/comments require inspection. Cancellation is not rollback.

## Storage decision for this slice

2026-10-07: use built-in `node:sqlite` (Node 22.16+, experimental on Node 22) for an independently runnable, single-host pilot with no added package dependency or database service. WAL, synchronous FULL, migrations and transaction boundaries are implemented, not simulated by an in-memory production store.

This narrows the earlier PostgreSQL proposal intentionally. It is **not** a distributed/high-availability substitute. Workers communicate through HTTP; they must not open the database directly. A PostgreSQL-backed coordinator/migration, retention pruning, operational metrics and backup supervision remain work before a larger multi-host installation. The separate service's Node requirement does not change the main Wiki server requirement.

## Unimplemented gates: do not bypass

An actual LLM executor/sandbox, artifact store and trusted publisher must be provisioned and integrated. The job API is not evidence those components exist. The live Wiki preview/ELMA bridge must reuse the existing delivery capability: explicit immutable candidate, current approval, target identity, drift check, separately authorized dispatch and read-back. Browser scenarios must run against that verified candidate and produce real private screenshots/deep links. Acceptance and merge remain separate later gates. No PROD or deployment endpoint exists in this service.

## Verification

Focused command: `npm --prefix services/request-bot test`. This exercises persisted state, two database connections, HTTP boundaries and fake provider contracts. No existing Wiki renderer changes in this slice; the executable conversation/state fixtures are in `services/request-bot/test/workflow.test.mjs`, not a copied production/Storybook renderer. Live compatibility, live screenshots and Dev2 evidence remain unverified.
