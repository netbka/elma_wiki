# Contextual change requests — UX-07 backend

Authority: [intuitive Solution UI plan](../plans/intuitive-solution-ui-2026-10-15.md), section 6.7. This implements its persistence/API foundation only. The request form, selection entry points, object chips, list tab and field-level anchors remain unimplemented; UX-07 is not complete. No new worker, ELMA action or deployment authority is introduced.

## Storage and identity

Requests live in the Solution's existing private `workspace.json`, under `changeRequests`. They share its serialized atomic rename and captured-original integrity checks. All authenticated MVP actors have equal access; the trusted session supplies creation and event actors. No caller-selected storage path, actor, digest, checksum or label is trusted.

Request content is immutable: UUID, kind (`screen`, `process`, `data`), title (160 characters), desired behavior (8000), optional reason (2000), urgency (`normal`, `urgent`) and captured target. Creation requires the current Solution revision. The target selects a captured artifact in that exact Solution, optionally its component key and source step anchor. Object identity must resolve uniquely; the server copies its digest. Step identity, source pointer, fingerprint and checksum must match exactly one supported entry in the existing source-anchor index of the checksum-verified original. Unsupported or duplicate anchors fail closed. No unimplemented field anchor is accepted.

The UUID is an idempotency key: the original actor and exact normalized input can recover an existing creation even after the Solution changes. Changed content or actor gets 409. At most 500 requests are stored per Solution, with 200 events per request. Missing fields in older Solution records mean no requests; reads never migrate them.

Request status is `new`, `in-progress`, `done` or `rejected`. Comments and status changes append attributed events, guarded by `expectedVersion` and a UUID `operationId`. A repeated identical operation by the same actor returns its existing result before stale checks; changed reuse fails. Concurrent edits cannot overwrite one another. Completion must name an accepted artifact in the same Solution; pending or foreign artifacts are refused. This is a person's completion assertion, not native verification. Reopening clears the fulfilling-version link and preserves history.

Reads project `anchorStatus` as current/stale/removed/ambiguous against the accepted component state. A component digest change conservatively makes a step request stale even if that step's own bytes happen to be unchanged. Solution-level targets become stale after any domain revision change. The original anchor never moves to a new version. Request mutations do not advance the configuration revision, resolve review findings, accept a Change or make a candidate eligible. Archived Solutions remain readable and refuse new creation/events/publication; existing external publication receipts may still be reconciled.

## Authenticated API

All routes sit under `/api/solutions/:solutionId/change-requests`. Existing Host, Origin, service-header, authentication and JSON/body limits apply. No legacy-root ID is promoted into a Solution.

- `GET /`: `{requests, publication}`; the latter is the existing safe GitHub destination/limits configuration, never credentials.
- `POST /`: `{id, expectedRevision, kind, title, text, reason?, urgency, target: {artifactId, componentKey?, sourceAnchor?}}`; persists locally without publication consent or external dispatch.
- `GET /:id`: the request plus its existing publication receipt or `null`.
- `POST /:id/events`: `{operationId, expectedVersion, type: 'comment', text}` or `{operationId, expectedVersion, type: 'status', status, text?, fulfilledArtifactId?}`. Comments cannot change status. Completion requires `fulfilledArtifactId`; other statuses clear it.
- `POST /:id/publish`: `{publishConfirmed: true, attachments: []}` with the existing optional image payloads. Explicit consent covers the immutable title, desired behavior, reason, kind/urgency and supplied attachments. The server constructs the report from the stored request, not caller-supplied request text or identity.
- `POST /:id/retry`: `{}`; requires an existing consented receipt and uses its immutable payload. It cannot create consent or a new report.

Publication reuses `bugReportStore`, its image checks/private downloads, repository pin, durable receipts and exact issue-marker reconciliation. Report kind is `change-request`, with the Solution/artifact/request IDs in context. There is no fabricated viewport. The direct bug creation route refuses this kind: publication must resolve a real Solution request first. A UUID collision with a different report fails rather than reconciling it. Request author and publication actor remain separate facts. Authenticated identity is not added to the GitHub issue.

Local creation never publishes. Missing GitHub configuration after consent persists `unconfigured`; failed/ambiguous dispatch retains the existing bug-report states. A lost issue response is reconciled without blind duplicate creation. Retrying after restart does not modify request content/status or accept configuration changes. An explicit publish is immutable; subsequent comments/status events are not silently republished. This slice has synthetic transport evidence only, no live GitHub publication.

Focused evidence: `node --test test/change-requests.test.mjs test/bug-reports.test.mjs`. UI/Storybook and full UX-07 acceptance belong to the subsequent UI slice.
