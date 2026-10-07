# Data-only coding worker and trusted PR publisher

Tracking: issue #19 / PR #25. These are executable workers for the existing HTTP protocol, not a claim that the live bot or model account is connected. `worker.mjs` supports two separately credentialed roles. Both are **disabled unless explicitly enabled**.

## What this slice does

The agent claims a triage or approved implementation job, pins the current GitHub base commit, reads explicitly configured context files and calls the OpenAI Responses API with a strict JSON schema and **no tools**. Triage returns necessary questions or a specification. Implementation returns complete text file replacements/additions. The trusted worker validates them and stores a content-addressed private artifact; the model cannot write to the filesystem or call GitHub.

The publisher claims a publish job, independently validates the artifact, owner/project/request/revision/iteration/specification binding, base commit, original blob hashes, file modes and configured editable paths. It creates a tree **on the existing base tree**, a commit, a new request/version branch and a **draft PR**. No existing branch is updated or force-pushed. The existing coordinator independently checks the PR receipt again before `PR_READY`.

This deliberately chooses a smaller initial executor than the planned full Codex CLI sandbox. There is no shell, code interpreter, build/test command, local checkout, imported customer code or model tool execution. Repository text and generated source are data, not executable modules. The agent is useful for small, bounded `wiki_code` changes; it refuses ELMA configuration/Target jobs. Larger changes or missing context must be escalated rather than invented.

**PR_READY still does not mean CI passed, code is correct, a browser was tested, Dev2 changed or the business accepted the result.** The coordinator now observes explicitly configured CI and may queue up to two separately numbered repairs under the same approved specification. Human review, an execution sandbox, live ELMA/preview delivery, genuine screenshots and acceptance/merge remain separate gates. See [CI setup and limits](README.md#ci-observation-and-bounded-repairs). The old `npm run demo` is intentionally still a coordinator-only demo. The new end-to-end worker check is `test/worker.test.mjs`.

## Repair iterations

An approved CI repair reuses the original base and approved specification, not a new task silently inferred from a log. The worker independently validates the previous artifact's identity/digest/iteration, overlays those changes for model context, then preserves previous edits not changed by the repair. Before publication it validates the cumulative artifact against the original base. A changed base, corrupted previous artifact, out-of-scope edit or lost lease stops the job.

Iteration zero keeps `bot/<request>/vN`; repairs use `vN-fix1` and `vN-fix2`, with matching PR markers and artifact iteration bindings. Old branches/PRs are retained; there is no force-push, automatic closure or merge. Feedback contains only independently read workflow/job results and failed-step names, not raw logs. Generic failure names may be insufficient to repair code. No local execution or claim that model output passes tests is added by this loop.

## Operator configuration

Keep configuration and all database/WAL/SHM files outside every Git checkout and web root. Use a dedicated local directory, not a network filesystem. The worker refuses a symlink data path, a non-file database and a directory under a `.git` ancestor. POSIX file permissions are restricted; on Windows explicitly configure private NTFS ACLs for the service accounts, directory and backups. This is one host with a shared private artifact database, not a distributed object store.

Copy `worker.example.json` into that private directory. Match `installation`, repository, base ref and project names to the intended coordinator. The example editable paths are a **sample scope**, not general permission to edit the project: select all necessary production/test/Storybook files for the assigned capability. Context always includes `AGENTS.md` and `.agent/capabilities.yaml`; add the routed capability contracts. Existing editable files are included as context automatically. An absent editable path permits a new file, while an absent required context file stops the job.

Bind the corresponding coordinator workers to `projects: ["wiki"]`. Do not let this narrow worker claim the coordinator example's `elma` jobs. Unknown projects, changed routing, unsupported task kinds, unexpected Target refs and stale specification approval stop before generation/publication.

Run the agent with a dedicated coordinator agent key, a GitHub **contents-read** credential and a model API key. Select a model/account that supports Responses strict structured outputs. The keys are supplied by the environment/secret manager through the names in configuration, never through the model input.

```sh
REQUEST_WORKER_ENABLED=1 \
REQUEST_WORKER_CONFIG=/private/request-worker/agent.json \
REQUEST_WORKER_DATA=/private/request-worker/data \
node services/request-bot/worker.mjs
```

The default executes **one eligible job**, or reports idle. Only an explicitly invoked `--loop` keeps claiming work. Merging this code does not install a service, schedule or auto-start configuration. Transport is HTTPS for remote coordinators; plaintext is allowed only to numeric loopback. Configure TLS termination, firewall and request rate limits before any remote access.

For the publisher, copy the configuration to a separate private file and use:

```json
{
  "role": "publisher",
  "tokenEnv": "REQUEST_PUBLISHER_KEY",
  "githubTokenEnv": "REQUEST_PUBLISHER_GITHUB_TOKEN"
}
```

These fields replace the corresponding fields in the full configuration; this fragment is not a complete file. Remove `provider` from the publisher file. Keep the same `installation`, project policy and `REQUEST_WORKER_DATA`. The publisher's GitHub identity requires only contents read/write and pull requests read/write in the explicitly selected repository. It needs no administration, secrets, workflow-write, deployment or merge authority. Run agent and publisher as separately credentialed trusted processes. Do not give either the coordinator database, bot token, Docker socket or Target credentials.

`publishEnabled` must be explicitly set to true in the publisher's project policy. For a public repository, `allowPublicCode` must also be true **after reviewing the data and CI policy**. No public code publication occurs with the example defaults. Before enabling, verify that PR workflows execute untrusted generated code with no private deployment credentials, no privileged `pull_request_target` checkout and appropriately limited tokens. A draft PR can still trigger CI; draft status is not an execution sandbox.

The model never receives the GitHub write credential, coordinator key or provider key. It does receive the authorized request and selected source files. Do not feed real exports, client scripts, passwords or confidential content into this public-code workflow. The publisher refuses common secret patterns and protected paths, but that scanner is **not a guarantee of detecting arbitrary confidential content**. `allowPublicCode` is a deliberate operator publication permission, not de-identification.

## Bounds and fail-closed behavior

At most 32 distinct context/editable paths, 16 changed files, 64 KiB per source file, 120 KiB of source context and 64 KiB of total changed UTF-8 content. The serialized prompt and remote responses also have limits. No binary, deletion, rename, symlink, submodule, duplicate/case-conflicting path or executable mode change is supported. File bytes, including whitespace, are preserved. The GitHub tree must be complete; truncated trees stop the job.

The worker cannot edit its own service, hidden configuration, AGENTS/CLAUDE instructions, workflow files, package manifests/lockfiles, deployment files, core auth/delivery/store modules or contracts/runbooks. The fixed policy is additional to the approved functional scope, not derived from model text. A task outside those boundaries is blocked for a different explicitly reviewed executor.

`maxOutputTokens` is 256-8192 per call. `maxCallsPerDay` is a persisted UTC-day call reservation shared by all workers using this artifact database; the reservation happens before dispatch, including failed/ambiguous calls. This limits call count/output size, **not exact monetary spend**. Set the provider project's spending controls separately. No automatic generation retry is performed. An aborted request may still incur provider charges.

Heartbeats renew the existing coordinator lease. A separate expiry watchdog aborts network work at the last granted expiry even if the heartbeat itself stalls. Every GitHub mutation has a fresh lease check; completion retries only the identical idempotent receipt. The coordinator's maximum run duration still applies. Timeouts, refusals, incomplete JSON and malformed changes cannot produce an artifact or a success claim.

## Persistence and recovery

The artifact database uses SQLite WAL/synchronous FULL. Artifacts are addressed and rechecked by SHA-256, and bind exact request/project/owner/chat/revision/specification/base identity. Agent and publisher share the private artifact store; neither reads the coordinator DB. The local attempt journal is keyed by installation/job/request/revision/kind/lease. It reserves work before model/publication dispatch and records safe blocker codes or the result. Model usage stores only numeric token counts, never raw responses or prompts.

A same-lease completed receipt can be replayed without regenerating or republishing. An interrupted attempt does not silently run again. The current coordinator does **not** redispatch a running lease after worker restart; expired implementation/publication jobs become blocked and require inspection. The journal is a safety stop, not an automatic crash-resume engine.

If a new branch/PR create response is lost, the publisher performs a read-only lookup and accepts only the expected commit/PR receipt. It does not repeat the POST or overwrite a branch. Failed lookups stop; they do not prove that nothing happened. Orphaned Git objects or a branch without a PR may remain after an interruption. Inspect GitHub before canceling/replacing the request; do not delete journal rows to force a replay.

Cancellation and expiry prevent subsequent requests and abort in-flight HTTP. A GitHub server may already have accepted an in-flight mutation; no claim of atomic remote cancellation/rollback is made. Later merge/review must recheck the current base/head. Source-base checks are conservative but not a cross-GitHub transaction.

Retention pruning, quotas for disk storage, backup supervision, global multi-host budgets and automatic unknown-outcome recovery are not supplied. Configure backup/restore and storage monitoring for any pilot.

## Verification and references

```sh
node --test services/request-bot/test/worker.test.mjs
npm --prefix services/request-bot test
```

The worker tests use the actual coordinator HTTP server, independent agent/publisher authentication and real file-backed SQLite. Only GitHub and model network responses are test doubles. They cover the complete question/answer/specification/approval/artifact/draft-PR receipt path, no writes from the agent role, invalid/secret/binary/protected changes, owner/revision/before-hash/mode swaps, base drift, missing context, cancellation/expiry/stalled heartbeat, budgets, lost create/completion acknowledgements and restart safety. No generated source is executed during those tests. They are not proof of a real model account, bot installation, GitHub publication or Dev2 connection.

Primary API references checked 2026-10-07: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GitHub tree creation and base-tree preservation](https://docs.github.com/en/rest/git/trees). The existing `GitHubClient` and coordinator publication check are reused rather than duplicated. Real account/model/API compatibility remains a separately observed connection test.
