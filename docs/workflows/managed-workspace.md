# Managed workspace journey

Historical #48 implementation evidence. Current product/UI authority is [the Solution-first journey](solutions.md) under #52. The private API remains a compatibility capability; its earlier user-facing terms below are superseded.

Authority: #33 and docs/PRODUCT_DIRECTION.md. This implements the bounded #35/#36/#40 lifecycle surface over #32's domain/storage/API. It does not close the product epic or substitute for #37/#41 independent review and #38 owner acceptance.

## Entry and orientation

Authenticated bot-link sign-in, an already authenticated login page and the signed-in service home lead to `/workspaces`. Active workspaces, archive and creation form are primary navigation. Each workspace shows its name, saved Source reference or explicit manual-source limitation, accepted baseline date/owner, changed object count and pending reviews. These counts are metadata summaries, not verified runtime state or a conflict-free claim. Standalone file inspection remains at `/dashboard`; existing releases are unchanged and link back to workspaces.

`web/managed/render.js` is the shared production and Storybook markup. `model.js` supplies labels, summaries and visible acceptance gates; the server remains the authority. `page.js` supplies authenticated network actions. Synthetic Storybook fixtures never call an ELMA endpoint, read a real uploaded file or save product decisions.

## Journey and decisions

1. **Create:** name the workspace and baseline owner, upload an explicit full snapshot, and confirm completeness. The upload remains an isolated owned project; the managed API captures its explicit snapshot. Unknown evidence blocks creation, and the saved file remains linked for standalone inspection. Repeating a failed managed request reuses the uploaded snapshot until the file selection changes.
2. **Continue:** overview shows current object responsibility, pending changes, accepted history and original downloads. Raw IDs, hashes and parser evidence are behind details. The virtual working state is explicitly not an installable archive.
3. **Upload change:** supply team/task, a partial package and explicit scope/same-Source confirmations. Only present components are overlaid. Preparation stores the original and review before presenting a decision.
4. **Review:** baseline crossings require a separate checkbox for each affected component plus an acceptance confirmation. Unknown evidence and another team's overlapping intervention block acceptance and provide a route to a new full snapshot. All evidence is rendered as text, never inserted as HTML or executed.
5. **Refresh full snapshot:** confirm full scope and same Source, then compare three ways. Every conflict requires a `keep-working` or `take-snapshot` choice. A separate confirmation explains that accepting a baseline is not an ELMA installation. Full-snapshot removals are identified near the affected object.
6. **Archive/reopen:** an explicit checkbox precedes the operation. Archive hides the workspace from active navigation, keeping originals and history; reopening restores work against the same baseline.

New baseline acceptance records `baselineAcceptedAt`. Partial acceptance, archive and reopen do not change it. Older persisted records without a timestamp show the initial creation time only if there has been no reconciliation; otherwise the UI says the date was not recorded. No historical date is guessed.

## Failure and recovery

- Loading and fetch errors have a visible state and retry path.
- Form values survive a failed mutation; completed uploads are retained and linked rather than uploaded again automatically.
- While awaiting a response, form controls are disabled and status is announced. A 409 or lost mutation response blocks replay and points to refreshed server state. A pending proposal made stale by another accepted change is never silently rebased.
- Archived workspaces cannot upload/accept; the return path leads to reopen.
- The UI offers no candidate composition or deployment action. Existing code editing remains standalone; this checkpoint does not claim a code editor synchronized with the managed virtual overlay, release association, collaborative comments or finer process-node responsibility.

## Evidence and review scope

Fourteen `managed-workspace--*` stories cover empty/list/create/overview/pending/change/review/conflict/overlap/ambiguous/stale/archived/loading/load-error with the shared renderer. Stories are synthetic inspectable states; they do not constitute uncoached first use.

`npm run test:managed:browser` starts a synthetic loopback service and uses the real UI/API to create a full baseline, accept a reviewed partial, resolve a full conflict, archive/reopen, reject a stale tab and recover from a fetch failure. It exercises keyboard activation, checks page reflow at 1920/800/390 widths, opens all 14 built Storybook states, and retains screenshots plus `qa/managed-browser-evidence.json`. Build Storybook first; Chromium must be installed. The VK browser check verifies sign-in to workspaces and logout.

CI and screenshots are implementation evidence. Independent visual/product review, uncoached analyst comprehension, live Source/Target verification and final owner acceptance remain separately recorded gates; do not describe this workflow as finally accepted or deployed without that evidence.
