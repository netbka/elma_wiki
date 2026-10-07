# Portal requests and worker queue

The Wiki and VK Teams are independent entry points to one request coordinator.
VK credentials are not required for portal-origin requests. This is an API
capability; the baseline-first workspace UI does not yet expose a task panel.

The authenticated Wiki supplies `session.user.id` to the coordinator over a
server-to-server connection. A private allowlist binds that exact owner ID to
configured projects. The browser cannot choose another owner, submit worker
results or obtain a worker/ingress credential. The portal uses its own shared
ingress key, separate from coding-worker and publisher credentials.

## API

- `GET /api/requests`: allowed project keys and up to 100 recent owned requests.
- `GET /api/requests/REQ-…`: current conversation, questions, specification,
  approval/state and matched PR/CI summary. Worker leases and patch artifacts
  are excluded. `deployed` remains false.
- `POST /api/requests`: `{operationId, project, text}` creates a triage job.
- `POST /api/requests/REQ-…/reply`: `{operationId, revision, text}` revises the
  requirements, invalidating the previous specification/approval.
- `POST /api/requests/REQ-…/approve`: `{operationId, revision}` authorizes coding
  under the current exact specification. It does not authorize deployment.
- `POST /api/requests/REQ-…/cancel`: `{operationId, revision}` fences queued and
  active jobs. Existing PRs remain; cancellation is not rollback.

POST requests use JSON and the usual `X-Elma-Wiki-Request: 1`/same-origin gate.
Use a random operation ID (16–100 alphanumeric, `_` or `-` characters). Retain
the same ID and payload after a lost acknowledgement. The transactional receipt
survives coordinator restart; reusing an ID with a different command is refused.
Stale revisions are refused. No-owner responses and expired sessions never fall
back to a public or operator identity.

## Private operator configuration

Use `services/request-bot/portal.example.json` as the coordinator template.
Keep configuration/database outside Git; run on numeric loopback or behind an
approved HTTPS reverse proxy. `vk` may be omitted. Do not put a fake VK identity
in the portal binding. Obtain the actual Wiki user ID from that user's session.

On the Wiki server set `REQUEST_COORDINATOR_URL` and `REQUEST_PORTAL_KEY` through
private environment configuration. The URL must be HTTPS or numeric loopback,
without embedded credentials, path, query or fragment. If both are absent,
the API returns an explicit unconfigured state. An unavailable coordinator
does not create an invented local success; retries preserve the operation ID.

Run the existing separate agent and publisher as described in
`services/request-bot/WORKER.md`. Their `/worker/claim`/heartbeat/completion
protocol is unchanged. The current worker uses a provider API for bounded
data-only edits; it is not a general shell/ELMA executor. GitHub issue/PR
projection and coding credentials remain separate from the Wiki browser.
Adding a portal ingress installs no daemon, model account or Target adapter.

Portal requests never enqueue VK messages. A VK transport can be added later
with distinct explicit identity bindings and one approved event consumer.

## Evidence

Focused tests use the real Wiki login/session HTTP API, real coordinator HTTP
API, SQLite queue and existing worker protocol, with synthetic accounts/keys.
They verify owner isolation, role separation, current-version approval,
clarification/cancellation, same-origin protection and restart-safe retries.
They do not claim a live provider call, GitHub publication, VK connection,
ELMA delivery or an integrated browser task panel.
