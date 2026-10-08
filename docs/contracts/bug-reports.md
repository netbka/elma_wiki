# Contextual bug reports

Owner request: #85. Capability: `bug-reports`. Entry: a secondary side Bug icon on authenticated Wiki pages. It preserves the current page and does not introduce a primary destination or a new Solution lifecycle.

Status: reviewable implementation draft. The owner choice between Change rejection and a report-only rejection, and external attachment publication, remains pending. The current draft records `reject` as a report type only; it does not add a blocking Change finding or claim product rejection. Attachments currently stay behind Wiki authentication. Do not merge until those choices are resolved and their affected contracts/checks are implemented.

An authenticated actor supplies a title and description, captures a window or adds files, previews/removes attachments and optionally draws pencil marks. Up to five PNG/JPEG/WebP/PDF/text attachments are accepted, each at most 5 MiB. Server enforcement is independent of the UI. Screenshots use the chosen capture source's full pixel dimensions, not a thumbnail or an invented image. Capture is user initiated, uses the browser permission picker, takes one frame, and stops every track on success/error/cancellation. Cancelled or unavailable capture retains the report and offers file attachment. Annotation uses the original resolution with undo/clear/cancel/save; saved marks replace that attachment rather than consuming a sixth slot.

Before submission, the user explicitly agrees to publishing the displayed title and description in GitHub. Context retains only the route, viewport and supported Solution/Change IDs/revisions, not query strings or login tokens. Screenshot/file bytes remain in private runtime storage and are linked through authenticated Wiki downloads; there is no anonymous image endpoint or Git commit. All signed-in MVP actors have equal report/content access; mutation attribution comes from the trusted session. Unsupported/executable attachments are refused and downloads use attachment disposition, octet-stream and nosniff.

`BUG_REPORT_GITHUB_REPOSITORY` selects an explicit repository and `BUG_REPORT_GITHUB_TOKEN` is a server-only Issues-write credential. Both are required for publication. No existing user/GitHub login or ELMA connection is inferred. Missing configuration saves the report with `unconfigured` status, never claims a created issue, and requires an explicit later retry. GitHub receives title/description, report type and authenticated links; attachment bytes and actor login do not leave Wiki.

## API and publication states

- `GET /api/bug-reports`: configured destination and public limits, never credentials.
- `POST /api/bug-reports`: immutable client UUID, report fields, exact attachment payload and explicit publication consent. Same actor/UUID/payload reuses the existing receipt; different content or actor is rejected.
- `GET /api/bug-reports/:id`: authenticated persisted report and attachment metadata.
- `GET /api/bug-reports/:id/attachments/:attachmentId`: authenticated, checksum-verified original/annotated attachment.
- `POST /api/bug-reports/:id/retry`: explicit retry/reconciliation of a saved report.

Reports and attachments are committed in one private staging-directory rename before external dispatch. One store/process serializes submission and retries. Publication persists `publishing` before sending, then `published`, `failed` (definite HTTP refusal), or `unknown` (timeout/unreadable/ambiguous receipt). `publishing` on restart is treated as unknown. A retry of an unknown result only reads a complete bounded issue listing and accepts one unique exact report marker; absent, duplicate or incomplete results stay unknown and never cause blind redispatch. The configured repository cannot silently change for an already dispatched report. This is not multi-process coordination; run one service instance per private storage directory.

The shared GitHub transport is also used by the existing request-bot adapter, preserving its private requirement projection and error contracts. Reporting does not authorize a worker, deployment, native ELMA operation or product acceptance. Synthetic Storybook fixtures use the production feedback renderer; capture and GitHub are never connected from Storybook.
