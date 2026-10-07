# ELMA Wiki current state

Last repository verification: 2026-10-07.

## Implemented
- Shared authenticated Solution catalog (P1 / #55): explicitly admitted new uploads/Solutions in a separate storage root; equal access for authenticated actors, persistent trusted identities and atomically attributed upload/prepare/accept/archive history. Legacy owner-private data stays isolated. Two-actor synthetic HTTP/restart/privacy evidence; Solution-first UI and attributed discussions follow in P2-P4. See contracts/shared-solutions.md.
- Portal-origin worker queue API: authenticated Wiki sessions create/read/revise/approve/cancel requests through the existing coordinator and worker protocol. VK configuration is optional for this mode. Independent ingress/worker credentials, allowlisted owners/projects, restart-safe operation receipts and revision guards. Synthetic HTTP/SQLite evidence only; workspace task UI and live model/GitHub execution remain open. See contracts/portal-requests.md.
- Managed workspace foundation (#33/#34, PR #32 lane): full baseline, partial interventions, full-snapshot reconciliation, immutable original capture/history and owner-scoped HTTP create/list/prepare/review/accept/archive/reopen. Explicit scope and same-Source assertions, stored Source mismatch rejection, revision/digest-bound acceptance and corruption checks. Synthetic storage/HTTP evidence; candidate handoff and live deployment remain pending. See contracts/managed-workspace.md.
- Managed lifecycle UI (#35/#36/#40): `/workspaces` is the signed-in entry, with active/archive overview, full-baseline creation, partial review, explicit conflict choices for full reconciliation and archive/reopen. One production/Storybook renderer covers 14 synthetic states; original downloads and standalone inspection remain available. Browser/keyboard/reflow verification is tracked on the integration PR. Managed code/release association, independent product review and final owner acceptance are not complete. See workflows/managed-workspace.md.
- Bridge dispatch cancellation/restart safety: queued jobs require a current request grant; aborted or orphaned jobs cannot dispatch. Claimed jobs retain unknown outcomes and late results while new artifact reads are denied. Synthetic queue-race and existing delivery checks; no live ELMA result is implied.
- Release input selection: explicitly pick immutable source/baseline snapshots, including two versions of one project, with hash/provenance and blocked/retry loading. Capture uses pinned parser documents without changing the project/workspace selection. Synthetic local evidence only.
- Immutable project snapshot storage foundation: isolated upload snapshots, trusted Source-reference append methods, pinned original bytes/parser revisions/provenance, owner-scoped snapshot reads and stale-safe selection. Legacy reparse pins its prior index; releases capture explicit snapshots. Synthetic evidence only; no Source adapter or project-viewer selector UI. See contracts/project-snapshots.md.
- Release delivery UI: unavailable state keeps offline handoff usable; explicitly enabled synthetic mode provides stand selection/probe, separate typed confirmation, read-back, discrepancies/history, preparation cancellation and lost-response reconciliation. Historical evidence becomes stale after candidate/condition changes. Shared production/Storybook renderer. The same panel carries the operator-bridge path: bridge tokens issued once, bridge-backed Target connections, refresh of an in-progress operation.
- Delivery foundation (AR-04 part 1): owner-scoped Target connection references without credentials, attempt lifecycle `prepared -> deploying -> deployed-unverified -> verified | verification-failed` with `failed`/`unknown-outcome`/`blocked`/`cancelled`, server-side PROD refusal (environment and probed identity), explicit confirmation, idempotent single dispatch, drift/stale-approval blocking, restart reconciliation and read-back verification by file hash (policy `exact-solution-inventory-v1`). Synthetic adapter stays test-only, disabled on a hosted service by default.
- Operator bridge adapter (AR-04 part 3): one-time bridge tokens stored hashed, per-bridge job queue polled by `elma-dev bridge --target=<dev|test>` on the operator machine (export/unpack/import via elma365pm; ELMA tokens never reach the Wiki, which makes no outbound connections), long deploys answered as `deploying` and finished in the background. Exercised live read-only against dev2 (health, inspect: 51 files); no live deploy has run. Under the exact read-back policy a real `elma365pm import --version-up` cannot verify (it rewrites package/manifest history), so the first live delivery also needs a decision on a versioned normalization policy. See contracts/target-deployment.md.
- Owner-only offline analyst releases at /releases: explicitly pinned DEV/baseline originals, complete inventory comparison and structural field impact, durable decisions, revision conflicts, unchanged-original candidate and exact private handoff. Local acceptance never authorizes import; ELMA, dependency and target checks remain Not run. Workspace edits are excluded. See contracts/analyst-releases.md.
- Node service with identity/auth (e-mail code login; GitHub OAuth removed) and isolated user projects.
- Manual .e365 upload/project parsing and structural viewer.
- Public article sources (TRUST-01, #27): every public article page lists its declared `sources` as explicitly reviewed repository-file or canonical ELMA help-page links, repeats the article status verbatim next to them and says explicitly that a reference is not an ELMA verification. Malformed or unsafe references render only a category reason; their raw values never enter the public model or HTML. Shared production/Storybook renderer, with local generator and desktop/mobile browser evidence. See workflows/public-article-sources.md.
- Synthetic showcase/fixtures.
- E365 workbench tooling exists for file-oriented work.
- Local workflow Storybook and shared /flows system map: investigation, review, upload, proposed Source/Target and synthetic ELMA examples.
- Persistent local comments, replies, rejection/resolution/reopen and version-bound acceptance. Remote collaborative review is not implemented.
- Browser Developer Workspace (PR #8, fix PR #12): for a recognised WIDGET the
  workspace offers Monaco, inferred context types/RPC completion, diagnostics,
  lint, a separate working copy, autosave, diff, checkpoints/restore and tab
  conflict detection. The original .e365 is never modified. Native lowercase
  widget exports open in the workspace.
- Per-project offline compiler profile (see COMPILER_PROFILE.md): operator-provided
  full-context SDK and dependency typings; check uses the researched platform
  compiler, TypeScript 5.9.3 and an explicit host/version; profile/request/content
  hashes invalidate stale evidence. Without a profile no external SDK is resolved,
  and TypeScript PASS does not mean ELMA compiler PASS. The SDK is never downloaded
  by the application.
- Request-bot coordination and bounded worker slice (issue #19): standalone disabled-by-default Node service in services/request-bot; durable SQLite requests/inbox/outbox/jobs, private clarification, revision-bound approval, independent agent/publisher roles, leases and recovery, VK dispatcher/dedicated-polling adapter and safe GitHub issue/status projection. A data-only Responses worker now generates scoped wiki_code file changes; private SHA-256 artifacts and a separately credentialed publisher produce a draft PR with an independently checked receipt. File-backed SQLite/HTTP/provider-double tests only; no live model/bot/GitHub transport or Dev2 evidence. PR_READY is not passing CI or task completion. See contracts/request-bot.md and services/request-bot/WORKER.md.
- Request-bot CI feedback (issue #19): optional workflow/job/head/base/attempt-bound observations, timestamped status and at most two explicitly approved same-specification repairs. Cumulative artifacts preserve prior edits; repairs create new draft branches rather than overwriting existing work. SQLite schema 2 retains old jobs/receipts and fences repair iterations. HTTP/provider-double tests cover success, failure, stale/ambiguous results, revocation, shutdown, migration and the two-repair limit. No live CI-repair pilot or deployment is implied.

## Designed, not yet proven as runtime
- Source ELMA connection/export into immutable snapshots.
- First live delivery through the bridge: the owner must designate the non-production Target (dev2 proposed) and a solution/candidate; the bridge and lifecycle exist, the live deploy evidence does not.
- Snapshot/workspace/target comparisons.
- Live Target adapter and read-back evidence beyond the synthetic delivery UI.
- Storybook coverage of existing public/auth/project viewer renderers; workflow catalog has explicit exclusions for these surfaces.
- Build, live ELMA connections, deployment candidates and read-back for the
  browser workspace (Slice B not started).
- Full request-to-Dev2 loop: general tool-using executor/build sandbox, live model/bot/GitHub CI-repair compatibility, delivery integration, genuine browser evidence, acceptance/merge and operational hardening remain beyond the bounded issue #19 worker and CI slice.

## Safety
- No PROD deployment capability is verified.
- Public copy must not claim Source/Target gateway until E2E evidence exists.
- Synthetic unit/API/browser checks cover the editor workflow, compiler/profile
  gates, SDK completion and invalidation; they do not prove live platform
  equivalence for a customer host/version.
