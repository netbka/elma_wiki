# Contextual Solution explanations

Owner-authorized outcome (8 October 2026): click to understand a Solution or
flow element; review/edit the explanation and save it beside that element.
Authority: Solution-first product plan. Phase: change. Boundaries: UI, domain,
parser projection, authenticated storage, security and Storybook tooling.

## User experience

Solution Overview / Solution offers **Объяснить решение** as a secondary action.
The Solution object table opens the exact captured accepted process matching the
current component digest. Change review keeps its captured process/form preview.
The shared preview offers **Объяснить этот процесс** and **Объяснить этот шаг**.
An explanation identifies its destination, describes declared steps/transitions,
forms/fields and missing evidence, and links to source references. Users edit and
save in place. Generating a replacement shows it beside the existing text;
only **Использовать новый черновик** replaces the editor. Navigation among
processes/steps in one mounted preview preserves each unsaved panel.

Saved explanations show their trusted actor, time and history. The Solution
explanation includes a catalogue of saved process/step explanations, including
removed elements, so historical knowledge remains accessible. Source buttons
inspect captured inert text or select a source step. Archive paths are references,
never filesystem paths or imported URLs.

## Engine and evidence

`declared-source-v1` is a deterministic local engine. It uses the existing parser
and bounded visual projection, not an external AI provider. Solution summaries
resolve current accepted components to immutable artifacts by exact identity and
digest; pending changes are excluded. This is a description of accepted virtual
state, not a composed package. Process/step explanations use one explicit captured
artifact. No arbitrary code, conditions, integration or ELMA action executes.

Purpose, actual participants, permission enforcement, script behavior and
integration outcomes remain unknown. Lane names do not establish assignment.
Element order is an inventory, not an executable sequence. Evidence labels say
declared source and absent native observation. Unsupported or ambiguous
relationships stay explicit. Future AI/provider use requires a separate decision
about which configuration content may leave the service.

## API, storage and update rules

Authenticated `GET /api/solutions/:id/explanations` accepts only `scope` plus
optional `artifactId`, `source`, `nodeId` as appropriate. Duplicate or unknown
query fields fail. `solution` selects accepted state without artifact parameters;
`process` selects an artifact and exact projected source; `step` also requires a
unique durable native/dictionary node identity. No positional guessing.

`POST` uses that target plus `text`, `expectedRevision`, `expectedVersion`, and
`expectedFingerprint`. Existing Host/Origin/service-header/JSON/body-size rules
apply. The session supplies the actor; caller actor/storage/source claims fail.
All actors share explanations. Anonymous requests and cross-Solution artifact
references fail before reading original bytes.

Reads and saves run within the managed store's existing serial queue and verify
captured checksums. Explanation entries persist separately from lifecycle state
inside the atomic workspace record; saving does not change the domain revision,
review discussion, accepted source, deployment candidate or acceptance gates.
An audit entry identifies the actual actor. Saves require an active Solution and
a current accepted component or current unsuperseded proposal. Historical source
and archived explanations are readable but cannot be overwritten there.

Process/step identity is the source object tuple and native/dictionary node ID,
independent of archive path or array location. Dependency fingerprinting is
conservative: the entire component digest covers source settings, transitions,
forms, sidecar scripts, manifest semantics and declared resource bytes. A change
anywhere in that component marks its explanation stale. External dependencies
and runtime state are not proven. Solution fingerprinting covers current accepted
component identities/digests. Human edits are retained; regeneration never writes.

The latest saved text is current/stale relative to the selected captured source.
The accepted Solution catalogue additionally marks removed/ambiguous identities;
historical/pending context is explicit. No absence in a partial artifact removes
an accepted object. Source removals retain the original explanation and references.

Revision/fingerprint/version conflicts prevent overwriting another user's text.
409 and uncertain/lost save responses retain the editor and block further writes
until the user refreshes saved state. Refresh reads the result without replaying
the save and retains the editor for comparison. Limits: 16,000 characters, 500
source references per draft, 1,000 immutable explanation revisions per Solution;
the latest 20 revisions of the selected explanation are returned as history.
Oversized generation fails explicitly and asks for a narrower process/step.

## Storybook and verification

Customer explanations remain in authenticated runtime storage, never Git, public
Learn content or actual Storybook stories. `web/explanations/render.js` is reused
by production and nine `solution-explanation--*` states: ready, draft, saved,
stale, loading, error/retry, conflict, historical/read-only and regenerated.
Fixtures and save actions are explicitly synthetic. Storybook demonstrates this
UI; it is not a second content store.

`test/solution-explanations.test.mjs` covers shared actors, source evidence,
restart/history, unchanged lifecycle state, concurrent overwrite, archive,
auth/Origin/header/field/identity guards, stale dependency fingerprints, accepted
partial-state resolution, checksum rejection and retained removed-step knowledge.
`npm run test:explanations:browser` checks actual UI/API generation/source
navigation/edit/save/reload, draft preservation, replacement comparison,
concurrency/lost-response recovery, escaped text, keyboard, 390px/200% reflow and
the nine shared renderer states. Evidence is synthetic; live ELMA, external AI,
deployment and independent user comprehension are not claimed.
