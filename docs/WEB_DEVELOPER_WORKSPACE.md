# ELMA Developer Workspace - implementation contract

Date: 2026-10-07.

Status: implementation contract with an experimental local browser editor. Monaco, limited descriptor-derived types/RPC completion, TypeScript checks, lint, autosave, exact diff and checkpoints/restore are implemented. Verified ELMA compiler, full object-specific SDK and bridge remain unavailable; Slice A is not complete. See [STATE.md](STATE.md) for current behavior and [INDEX.md](INDEX.md) for the relationship between proposals.

## Product decision

ELMA Wiki evolves from a read-only structural viewer into **developer tools for ELMA365**.

We do **not** build a second visual ELMA Designer.

ELMA Designer remains the primary place for low-code modeling, visual form layout, processes and platform configuration.

Our product owns the engineering loop around code:

**Understand -> Code -> Check -> Run/Observe -> Fix -> Review -> Deploy/Verify**

The primary interface is a browser workspace. VS Code, CLI and AI are optional clients of the same core, not prerequisites.

## What the user gets

A developer uploads an existing .e365 and opens a supported form/widget.

Instead of raw JSON, the workspace presents:

- client.ts;
- server.ts;
- relevant generated/read-only ELMA types;
- descriptor/metadata as advanced information;
- Problems;
- Console;
- Context;
- RPC/Network;
- Trace/Performance;
- Changes.

The experience should feel familiar to a modern IDE, while remaining approachable to a developer who has only used ELMA Designer.

## UX shell

Recommended desktop layout:

```
+---------------------------------------------------------------+
| Project / Widget            Check  Run  Deploy DEV   Changes  |
+-------------+--------------------------------+----------------+
| Explorer    | editor                         | Context/Trace  |
|             |                                |                |
| client.ts   | async function onInit() {      | Context.data   |
| server.ts   |   Context.data.customer...     | customer ...   |
| types       |                ^ error          |                |
| metadata    | }                              | RPC calls ...  |
+-------------+--------------------------------+----------------+
| Problems | Console | RPC | Trace | Performance | Changes      |
+---------------------------------------------------------------+
```

Mobile/tablet can be read/review oriented. Full editing is optimized for desktop.

Use an established browser code editor such as Monaco rather than implementing a text editor from scratch.

## Core capabilities

### 1. Source explorer

For a supported widget/form:

- map ELMA object name to archive path and source files;
- expose client.ts/server.ts as primary editable artifacts;
- show descriptor, manifest, runtime and provenance as advanced/read-only by default;
- clearly label generated/service metadata;
- preserve unknown files byte-for-byte where possible.

Never make a generated runtime blob look like normal hand-edited source.

### 2. TypeScript language experience

The editor should provide:

- syntax highlighting;
- completion;
- hover/type information;
- go to definition where possible;
- find references within workspace;
- rename only when impact analysis says the operation is supported;
- inline diagnostics;
- Problems panel;
- format document;
- basic refactoring supplied by the TS language service where safe.

ELMA-specific typings must be generated/resolved for the selected object so completion can understand:

- Context.data;
- ViewContext.data;
- Server.rpc;
- allowed Namespace/Global/Application APIs;
- client/server differences.

### 3. ELMA compiler check

`Check` runs the same verified compilation contract already researched for supported widget scripts.

Result model:

```
TypeScript       PASS
ELMA Compiler    PASS
ELMA Linter      2 warnings
RPC Contract     PASS
Package state    CLEAN
```

Compiler diagnostics point to the editable source file and source line, not runtime output.

Do not claim this compiler contract for entity types that were not verified.

### 4. ELMA linter

Create a separate rule engine. Compiler errors and lint findings are different categories.

Initial rules should be conservative and evidence-based.

Candidate correctness rules:

- reference to an unknown Context/ViewContext field;
- client call to an unknown Server.rpc method;
- function declared but not found in known lifecycle/event bindings;
- known client/server contract mismatch;
- stale generated runtime relative to editable source.

Candidate performance rules, only where static evidence is reliable:

- await in a loop around known expensive ELMA operation;
- repeated equivalent search/query in one path;
- multiple sequential RPC calls in initialization where a combined call is plausible.

Candidate maintainability/security rules can be added later. A rule must explain its evidence and avoid pretending heuristic findings are compiler facts.

Each finding includes:

- rule id;
- severity;
- source range;
- short explanation;
- evidence;
- suggested next action;
- optional AI explanation/fix, never required.

### 5. Impact analysis

Before rename/removal or other structural change, show known usage:

```
customerId

3 forms
7 functions
1 process reference
2 RPC paths
```

The UI distinguishes:

- proven structural reference;
- static textual reference;
- unresolved/dynamic usage;
- not analyzed.

No claim of "unused" when coverage is incomplete.

### 6. Changes and semantic diff

Show two levels.

First, human meaning:

```
Customer Card

- client validation changed
- one server RPC changed
- no field schema change
- generated runtime rebuilt
```

Then exact file diff.

Generated changes are collapsible, not hidden.

### 7. Checkpoints and undo

Every meaningful edit session has checkpoints.

Minimum:

- original imported snapshot;
- autosaved working state;
- explicit named checkpoint before build/deploy;
- deploy snapshot/result.

User can restore a previous working state without Git.

Git integration may later map checkpoints to commits, but Git is not required for undo/history.

## Run, Observe and Debug

### Product principle

A code editor without a feedback loop is not sufficient.

The workspace must progressively support:

**Code -> Check -> Run -> Observe -> Fix**

However, we must not promise a full remote debugger until the ELMA runtime can actually be controlled.

### Preview levels

Every object displays its preview capability explicitly:

- **Static preview unavailable** - code can be checked but not executed locally.
- **Local harness** - selected pure/client behavior can run in a controlled local harness.
- **ELMA DEV preview** - execute/open the real object on a connected development ELMA.
- **Trace only** - server behavior is observed through ELMA traces rather than paused.

Never simulate an ELMA runtime and present it as equivalent to the real platform.

### Context inspector

Where context is available, provide a structured inspector:

```
Context.data
  customer
    name
    status
  orders[]
  loading
```

For a local harness/test scenario, allow controlled test values.

For a live target, distinguish observed values from locally supplied test fixtures.

### RPC / network inspector

Represent known call chains:

```
onInit
  Server.rpc.loadCustomer
  Server.rpc.loadOrders
  Server.rpc.loadInvoices
```

Include timing when it comes from a real trace or measurement.

Do not invent timings from static analysis.

### Trace / performance

Ingest supported ELMA developer-tool/server-trace evidence and map it back to source when possible.

Goal:

```
server.ts:34  Namespace.orders.app.search()   1.72 s
```

with call tree and source navigation.

Source mapping must be proven for the relevant compiled output. If exact mapping is unavailable, show function/object-level attribution rather than a false exact line.

### Breakpoints

Client-side breakpoint integration is a later research track.

Server-side ELMA scripts currently get **trace/replay semantics**, not a promised step debugger.

Do not advertise step into/step over for server scripts until a real runtime control protocol exists.

### Replay

Research a safe DEV replay workflow:

- capture/select diagnostic context;
- redact secrets and business-sensitive values by policy;
- reproduce with test fixtures or a DEV target;
- rerun check/trace;
- compare before/after.

Never replay a production write operation automatically.

## Deploy and verify

Browser editing and static checks do not require a local bridge.

Access to private/on-prem ELMA usually does.

Architecture:

```
Browser workspace
      |
Developer service
      |
secure job/control channel
      |
Local ELMA Bridge
      |
ELMA DEV / TEST
```

The bridge:

- runs inside the user's reachable network;
- owns target credentials locally;
- exposes capability/status, not raw secrets;
- executes allowlisted compile/deploy/export/trace operations;
- requires explicit confirmation for state-changing operations;
- defaults PROD to protected/disabled;
- returns structured result/evidence.

The hosted Wiki must not store ELMA admin tokens merely to enable deployment.

### Deploy flow

1. Check source.
2. Build supported package.
3. Show semantic + exact diff.
4. Snapshot target when supported.
5. Explicit user confirmation.
6. Deploy to DEV.
7. Re-export/read target state.
8. Verify expected source/runtime/version.
9. Exercise real form/widget where possible.
10. Store deployment evidence and rollback reference.

Import exit code alone is not success.

## Workspace and file storage

This is a core architecture requirement, not an implementation detail.

### Immutable source

For every project retain an immutable original upload or encrypted object copy, subject to retention policy.

The original is never edited in place.

Record:

- content hash;
- original filename;
- upload timestamp;
- parser version;
- owner/project id;
- package provenance discovered from file.

### Extracted workspace

Each project has a versioned workspace derived from the original:

```
project/
  source/
    original.e365
  workspace/
    widgets/...
    ...
  generated/
    typings/
    runtime/
    analysis/
  state/
    checkpoints
    diagnostics
    deployment-evidence
```

Logical structure only - physical implementation may use object storage + database rather than a literal filesystem.

### What is editable

Editable artifacts are allowlisted by capability contract.

Example for verified widget script workflow:

- client.ts;
- server.ts.

Generated artifacts are produced by tooling and read-only by default:

- runtime;
- fn declarations;
- generated typings;
- derived indexes.

Unknown/opaque artifacts are preserved but not silently edited.

### Persistence model

Store separately:

1. original immutable artifact;
2. current editable workspace;
3. generated artifacts;
4. analysis/index;
5. change/checkpoint history;
6. deployment evidence;
7. target connection metadata without credentials.

Every record is scoped by ownerId + projectId.

Every read and mutation checks the authenticated owner on the server, including source, checkpoints, diagnostics and generated artifacts. Mutations keep the existing same-origin and request-header protections. Knowing a project or checkpoint id never grants access.

### Autosave

Browser edits autosave as working-state deltas/checkpoints.

Each save includes the expected workspace revision. A stale save from another tab or client is rejected as a conflict without overwriting newer work; the user can compare and resolve it. Restore creates a new revision and preserves the immutable original and checkpoint history.

Autosave is not deployment.

A visible state indicator distinguishes:

- Saved in workspace;
- Checked;
- Built;
- Deployed to DEV;
- Verified on target.

Checks and builds record the exact source revision/hash, tool version and capability used. Editing or restoring source invalidates current Checked/Built status. A candidate pins an immutable build and its check evidence; deployment cannot silently substitute a newer workspace. Verification identifies the candidate and target connection plus the read-back evidence. Historical evidence stays available but never certifies a changed revision.

This avoids the dangerous "saved means live" mental model.

### Secrets

Never index credentials/default secret values into searchable project data.

Do not put ELMA target tokens into project files.

Bridge-side credentials use local protected storage.

Logs/traces pass through redaction before persistent storage.

## Shared dev core

Avoid implementing features separately in Web, VS Code and AI.

Create a reusable domain/core layer with contracts such as:

- project model;
- source extraction;
- capability detection;
- typings;
- compile;
- lint;
- impact analysis;
- semantic diff;
- build;
- deployment plan;
- verification result.

Clients:

```
                Developer Core
        +-----------+-----------+
        |           |           |
       Web       VS Code      MCP/API
        |           |           |
        +------ Local Bridge ---+
                    |
                  ELMA
```

Web is first.

VS Code extension is optional later for developers who want local files, native Git and larger coding sessions.

AI consumes the same APIs/checks and cannot bypass deployment gates.

## Landing page positioning

This section describes the future coding product. Until Slice A passes its acceptance checks, the current homepage uses the shipped viewer promise in [DEVELOPER_VALUE_WORKFLOW.md](DEVELOPER_VALUE_WORKFLOW.md). Planned functionality belongs in a clearly labeled roadmap, not the current hero, proof strip or an active editor CTA. Public UI stays Russian under AGENTS.md; the English copy below is a design sketch to translate when the associated capability ships.

The homepage must no longer lead with "we decoded .e365" or "technical wiki".

Primary promise:

**Develop ELMA365 code with modern developer tools.**

Suggested hero:

> **ELMA365 development, without being trapped in the Designer.**
>
> Upload your .e365. Find the code behind a form or widget, edit TypeScript with autocomplete and ELMA-aware diagnostics, understand impact, inspect changes and verify the result before it reaches your environment.
>
> Keep using ELMA Designer for low-code modeling. Use Developer Workspace when the work becomes code.

Primary CTA: **Open E365 project**

Secondary CTA: **Try developer workspace**

Proof strip should communicate capabilities, not counts:

- ELMA-aware TypeScript;
- Compiler diagnostics;
- Impact analysis;
- Semantic diff;
- Trace to source;
- DEV deploy verification.

Do not advertise a capability until its implementation status is real. Before release, mark unavailable items as "planned" in public UI rather than rendering fake successful panels.

### Explain the new mental model

A visible section for existing ELMA developers:

**Designer is still there. The coding workflow changes.**

```
ELMA Designer
model apps, fields, processes, simple UI
        |
        v
Developer Workspace
understand code -> edit -> check -> observe -> review
        |
        v
ELMA DEV
run on the real platform -> verify
```

This section should explicitly say that Git, VS Code and AI are optional.

## First implementation slice

Do not attempt the full IDE in one release.

Deliver a vertical slice that proves the product.

### Slice A - browser coding

For an uploaded .e365 and a supported existing widget/form:

1. Open in Developer Workspace.
2. Show client.ts/server.ts.
3. Monaco editor.
4. Object-specific ELMA typings.
5. TypeScript autocomplete/hover.
6. Inline compiler diagnostics.
7. Problems panel.
8. Run verified ELMA compiler check.
9. Basic conservative ELMA lint rules.
10. Autosave working state.
11. Changes/file diff.
12. Restore original/checkpoint.

No deployment is required to call Slice A complete.

### Slice B - real DEV loop

1. Connect Local ELMA Bridge.
2. Detect target/version/capabilities.
3. Build supported widget package.
4. Show diff.
5. Deploy DEV with confirmation.
6. Re-export/read back.
7. Verify.
8. Open real ELMA object.
9. Collect available trace/performance evidence.
10. Navigate evidence back to source where proven.

### Slice C - advanced developer experience

After evidence:

- semantic diff;
- impact-assisted refactoring;
- richer lint/performance rules;
- replay;
- Git/PR integration;
- VS Code extension;
- custom UI/component framework research.

## Acceptance tests for Slice A

Use a synthetic fixture only.

1. Open a known widget.
2. `Context.data.` completion lists fixture fields.
3. Misspelled field produces an inline diagnostic.
4. `Server.rpc.` completion reflects fixture server functions.
5. Introduce a TS type error - Check fails and points to source.
6. Correct it - Check passes.
7. Linter warning is visually distinct from compiler error.
8. Edit source - Changes shows exact diff.
9. Reload browser - autosaved workspace survives.
10. Restore checkpoint - source returns exactly.
11. Original uploaded artifact remains unchanged.
12. Unsupported entity cannot be edited through the widget contract.

## Acceptance tests for Slice B

On an explicitly configured non-production test target:

1. Bridge connects without uploading raw target credentials to hosted Wiki.
2. Target version/capability is displayed.
3. Deploy is blocked if Check fails.
4. Deploy requires explicit confirmation.
5. Tool records pre-deploy evidence/snapshot where available.
6. Package build updates required generated artifacts for verified widget workflow.
7. Deploy result is not accepted from exit code alone.
8. Target state is read back/re-exported.
9. Expected source/runtime/version is verified.
10. Failure produces actionable source/object-level diagnostics.
11. Rollback reference is shown.
12. PROD remains protected unless separately enabled by an explicit future policy.

## Explicit non-goals for this phase

- clone ELMA visual Designer;
- generic drag-and-drop form builder;
- claim support for arbitrary JSON editing;
- full VS Code clone;
- server-side step debugger without runtime control;
- execute unknown uploaded code on the hosted service;
- silently connect to customer ELMA;
- store customer admin tokens in the Wiki;
- deploy to production as part of the initial experiment.

## Success criterion

A developer familiar with ELMA Designer but unfamiliar with Git/VS Code can:

1. upload .e365;
2. find an existing coded form/widget;
3. open its real TypeScript in a familiar IDE-like browser screen;
4. receive ELMA-aware autocomplete and diagnostics;
5. make a small change;
6. check it;
7. understand exactly what changed;
8. restore it safely.

Then, with the bridge enabled, the same developer can deploy that verified change to a DEV target and prove that the target contains the intended result.

If this flow is materially easier than editing/debugging the same code through Designer, the product direction is validated.
