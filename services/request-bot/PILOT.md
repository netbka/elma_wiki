# Bounded #19 provider/repository pilot preparation

Assigned stage: prepare private bindings and scope. This package prepares the existing data-only worker; it does not enable it. Tracking: [#19](https://github.com/netbka/elma_wiki/issues/19). Use the [worker contract](../../docs/contracts/request-bot.md), [WORKER.md](WORKER.md) and [coordinator runbook](README.md) for execution and recovery. Solutions remain the product home; this is a secondary engineering pilot.

## C1: prepared provider/artifact/draft-publication scope

Coordination: [#91](https://github.com/netbka/elma_wiki/issues/91). C1 and C2 have independent readiness and evidence records. This package supplies C1 preparation only. C1 live status is blocked until the private inputs below are bound and concrete execution is authorized. Preparation review/merge cannot establish live compatibility.

Proposed first task: create only `docs/examples/request-worker-pilot.txt`, UTF-8 with LF line endings, containing exactly:

```text
Synthetic request worker pilot.
No ELMA configuration or deployment evidence.
```

Require a final LF and no other file changes. The file is intentionally absent from the preparation branch: the future worker must create it. If it already exists at the selected base, stop and revise the scope before approving a request. This tests real generation, artifact binding and publication without changing product behavior. It cannot establish coding quality on a substantive task.

| Bound | Prepared value |
| --- | --- |
| Entry | Existing authenticated `/requests` panel; no VK adapter/poller |
| Repository / base | `netbka/elma_wiki` / `main`; worker pins actual base SHA at execution |
| Identity | One verified Wiki session user ID; unresolved in template |
| Task / path | `wiki_code`; one exact synthetic text path above |
| Calls | Three per UTC day in the shared artifact DB: initial triage, optional clarification, implementation |
| Output / duration | 1024 output tokens per call; 180 seconds per worker job; coordinator run deadline 300 seconds |
| Jobs / active requests | Four jobs per request; one active request for the bound actor/project |
| Repair policy | CI omitted, hence no automatic repair; later CI configuration must keep `maxRepairs: 0` |
| Endpoint | Independently matched draft PR, followed by human file review and separately observed CI |
| Publication | Both policy flags false until explicit enablement after data/workflow review |

These are preparation defaults, not approval of a future specification or live run. `maxActive` is not a lifetime request limit and daily calls reset at UTC midnight. The operator must admit exactly one request, use one-shot workers without `--loop`, stop after it and retain the same artifact DB across restarts. No unattended backlog, merge, preview deployment, ELMA Source/Target, Dev2 or PROD is included. A call count/output limit is not a monetary cap; provider-project spending controls remain necessary.

## Private binding package

Copy the three `pilot/*.example.json` files to a new protected directory outside all Git checkouts, web roots and network filesystems, naming them `coordinator.json`, `agent.json` and `publisher.json`. They are complete configuration shapes with unresolved identity/model placeholders. They contain environment variable names, never secret values. Do not start a process with placeholders.

Maintain a private binding record with status `prepared-disabled`, preparation source commit, repository/base, approved runner/service identities, configuration paths, secret-manager references, storage paths, limits, designated requester, approval/evidence records and remaining blockers. Private endpoint/account/installation details belong there, not in Git or issues. Keep coordinator database/WAL/SHM separate from the shared agent/publisher artifact database. Match installation, repository, base and exact project policy across both worker files.

| Environment name | Private binding needed / access |
| --- | --- |
| `REQUEST_PORTAL_KEY` | Same ingress secret on Wiki and coordinator; exact trusted Wiki actor binding |
| `REQUEST_AGENT_KEY` | Coordinator agent role only, triage/implement on `wiki` |
| `REQUEST_PUBLISHER_KEY` | Independent coordinator publisher role only |
| `REQUEST_OPERATOR_KEY` | Independent operator status/reconcile role |
| `REQUEST_GITHUB_WEBHOOK_SECRET` | Independent HMAC secret required by coordinator configuration |
| `REQUEST_GITHUB_TOKEN` | Coordinator bot identity: issues read/write, PR read; Actions read only when CI configured |
| `REQUEST_AGENT_GITHUB_READ_TOKEN` | Separate repository contents-read identity |
| `REQUEST_PUBLISHER_GITHUB_TOKEN` | Separate repository contents read/write and PR read/write identity |
| `REQUEST_MODEL_API_KEY` | Approved provider project/account; Responses strict structured outputs, no tools |

Role keys and HMAC secret must be independent and at least 32 characters. Inject only each process's required environment; the agent must not inherit publisher, bot, deployment or operator credentials. The publisher must not inherit the provider credential. Existing interactive Codex/GitHub connector access is not a binding or credential source for these service processes. Do not copy interactive credentials.

Set `REQUEST_BOT_ENABLED=0` and `REQUEST_WORKER_ENABLED=0` in the preparation record. Record `REQUEST_BOT_CONFIG`, `REQUEST_BOT_DATABASE`, `REQUEST_WORKER_CONFIG`, `REQUEST_WORKER_DATA`, and `REQUEST_COORDINATOR_URL` separately for each process. The numeric loopback URL assumes Wiki and coordinator share the designated host; a different topology needs the existing HTTPS/proxy contract. No service, schedule, firewall or Wiki environment change is installed by preparation.

## C1 readiness and bounded execution handoff

1. Resolve the approved provider/model, provider spending cap, secret references, one requester, bot/application identity, repository grants, runner accounts and private paths. Verify private NTFS ACLs for service accounts/backups, Node 22.16+ with SQLite, network access, disk monitoring and a backup/restore rehearsal. Configuration shape validation with synthetic keys is not readiness evidence.
2. Inspect the actual base and overlapping work. Review every workflow a draft PR will trigger for unprivileged, secretless execution and no privileged checkout of generated code. Read actual branch rules and required checks. Record workflow IDs, paths and exact required job names privately if using CI observation; do not invent IDs from workflow filenames. Omitted CI means no coordinator CI evidence, not a pass.
3. Obtain operational authorization for the concrete provider/runner/publication bindings and this task. Keep publication flags false until reviewed public synthetic data and triggered CI are approved. Configure coordinator CI, if any, before creating the request; route policy is pinned at creation. Changing it later requires a new approved request.
4. Start only the designated coordinator and connect the existing Wiki ingress under that authorization. Create one request with the exact task/criteria above. Invoke the agent once for triage, answer at most one necessary clarification, inspect the specification and approve its current revision. Stop if it broadens scope or needs more calls/jobs. Invoke the agent once for implementation. No process loops or concurrent request admission.
5. Inspect private artifact identity, digest, base SHA and exact file bytes. Enable publication only in the reviewed private publisher policy, then run the publisher once. It creates a new draft branch/PR; coordinator independently matches the receipt. Base drift, unknown outcome or cancellation stops the pilot; inspect journal and GitHub before any replacement. Never clear journals/reset budgets or retry unknown mutations blindly.
6. Record request/revision/approval, source base and head SHA, artifact digest, PR receipt, provider numeric usage, exact CI run/attempt/job observations and human byte/diff review in private evidence. A green check must correspond to that head. Without configured CI, record independently observed checks separately and keep coordinator status explicitly unobserved. Stop processes, revoke/disable pilot access as appropriate and preserve evidence/backups. Do not merge the pilot PR as part of this stage.

Success of this bounded pilot means observed live provider compatibility and independently verified publication of the synthetic artifact. It does not complete #19. VK, general execution/build sandbox, repair compatibility, Solution-context integration, candidate delivery/read-back, genuine target screenshots and business acceptance remain separate work.

## C2: separately scoped CI-repair compatibility

C2 is deferred, unconfigured and unauthorized by C1. Do not turn the zero-repair C1 request into a repair pilot by editing its configuration or reusing its approval. C1 success, an observed CI failure or a preparation merge does not authorize C2.

Before C2 execution, prepare a separate bounded policy and obtain approval of its concrete specification. The current two-line text artifact has no meaningful failing behavior to repair: select a synthetic capability fixture and observable failure whose correction fits the existing data-only worker. Name exact editable/context files and criteria; do not weaken tests or permit workflow/service/policy edits. Bind actual workflow IDs/paths, required jobs, branch rules and unprivileged CI execution, an explicit repair limit (at most two), provider spending/call/job/time bounds including the initial implementation and each repair, requester/runner identities and independent publication authority. Use a new request with this route pinned at creation and a separately approved current specification. Do not supply invented workflow IDs or enable a repair limit in the C1 templates.

C2 evidence must independently associate the failure and each subsequent observation with request/specification revision, original base SHA, current PR/head SHA, workflow, run and attempt-specific jobs. Verify that the worker reads the prior artifact and preserves cumulative edits, that each approved repair creates its distinct `vN-fix1`/`vN-fix2` draft branch, and that the coordinator independently checks publication and CI receipts. Record bounded failed-step feedback, usage and actual outcome privately. Generic feedback that cannot support a correction is a blocker, not permission to expand scope. Base drift, stale/cancelled/revoked work, ambiguous side effects and budget exhaustion must stop automatic progression. Synthetic contract coverage is already available; live compatibility needs observed live evidence.

Readiness status for C2 remains `deferred-separate-scope-required`. No C2 configuration, request, repair, daemon or ELMA operation is created by this handoff. #19 remains open after either stage.

## Missing private inputs and stage status

The private record should contain separate `C1` and `C2` entries with preparation status, operational status, scope/policy reference, missing input categories, approval references and observed evidence. Keep secret values, account/participant identities, private endpoints and screenshots out of coordination comments and Git. Public reports contain categories and evidence status only.

| Stage | Preparation / operation | Missing input categories |
| --- | --- | --- |
| C1 | Preparation ready for review; operation blocked, prepared-disabled | Approved provider/model and data-transfer scope; provider spending controls; private secret references; verified requester/coordinator/service identities; approved runner/topology; actual repository grants/branch rules/triggered CI review; protected storage, backup/restore and disk monitoring; concrete execution/specification/publication approval |
| C2 | Deferred; separate bounded policy/specification required | C1-compatible operational bindings; meaningful synthetic repair fixture and criteria; exact context/edit paths; real workflow/job/attempt bindings; explicit repair/call/job/spending limits; separately approved request/specification and publication authority |

Actual provider/model, secret-manager references, requester/service identities, runner authorization, spending limit, private storage operational evidence and reviewed live repository/CI bindings are not supplied by these templates. Leave status `prepared-disabled` until each is resolved and evidenced. No live connection, PR publication, daemon or delivery is established by copying or validating this package.
