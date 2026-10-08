# Uncoached Solution review

Owning issues: #59, #41, #38. This uses the current Solution-first product and
synthetic inputs. Two people perform the tasks: one ELMA-familiar technical
user and one technically literate user who has not read repository docs.
Automated browser tests do not fill in their outcomes.

## Prepare

From the repository, install locked dependencies and build the editor, then run:

```powershell
npm.cmd ci
npm.cmd run build:editor
node tools/usability-session.mjs
```

The helper binds only to loopback and creates new, separate synthetic storage.
It prints two synthetic sign-in links and a private directory containing the
input files and an empty observation record. Use separate browser profiles.
These links exercise the existing signed-link/actor path without sending a
message or connecting to VK Teams. They prove no live identity integration.
Do not use customer files. Stop with Ctrl+C; the synthetic session is retained.
No production service or ELMA Target is used or enabled.

The session records the Git revision and whether the tested checkout has local
changes. Start the acceptance pass from a clean committed checkout and keep it
unchanged while participants use it. Missing Git metadata or a dirty checkout
remains explicit and cannot produce a complete
report. Keep each pass bound to its own session directory; a fix requires a new
pass against the new revision. Previously created sessions without this source
record remain useful notes but cannot establish version-bound acceptance.

Give participants only their own link, the three files with their stated scope
and the tasks below. Do not give them the observer section or repository docs.
Start each participant at the Solutions list; the catalog is intentionally
shared, so each creates a differently named Solution and can inspect the
other participant's discussion later.

## Participant tasks

1. Add a Solution named for your test using `01-full.e365`, a full export.
2. Explain the current state and what you would do next.
3. Review `02-change.e365`, a partial export from the same Solution/Source.
   Explain what changed and what needs attention.
4. Leave a comment about the change; show who wrote it.
5. Find the changed object's supported code and check it. Explain whether
   checking or saving code changes the captured export or publishes to ELMA.
6. Decide whether to accept the change and explain its consequence.
7. Review `03-later-full.e365`, a later full export from the same Source.
   Explain any conflict and choose what to keep.
8. Find the captured approval process/form and explain what is known from
   the export, what the preview simulates and what has not been checked live.
9. Explain the next action, then archive and reopen the Solution.
10. Open the other participant's Solution/comment in your own profile and
    distinguish its author from your own identity.

## Observer record

Do not name buttons, guide clicks or explain terminology before the first
attempt. Record the participant's first actions and words. If help is needed,
record it as coaching; do not mark that task uncoached PASS. Record each task's
outcome, actions, navigation transitions, choices, input and loss of context;
note hesitation, wrong clicks and misunderstood labels. Preserve exact defect
reproduction and the source revision. Fix material UI defects in the shared
renderer, update its Storybook state and re-test.

The private `observations.local.json` starts with `performed: false` and null
outcomes. Fill it only from actual participant observations. Use role labels
instead of personal details in any public summary. Record an independent
integrated visual review separately from automated checks. After both user
passes and the visual gate, the owner walks the product and records accepted
or deferred gaps for #38. Availability of people is not completion of a test.

For each numbered task in the observation file record `outcome` (`pass`, `fail`
or `blocked`), `coachingGiven` (boolean), and `actions` (the actual first actions
and words). Each participant also records `performed`, `coachingGiven`, overall
`outcome`, and the four observation arrays. Do not erase findings to obtain a
passing report; fix material defects and repeat the affected human pass.
The independent visual record contains `performed`, `independent`, `outcome`,
`sourceRevision` and `materialFindings`; its reviewer must meet #41's independence
requirement. Keep the generated source/session identifiers unchanged.

```powershell
node tools/usability-report.mjs <session-directory>
```

The read-only report omits login links, identities and observation text. Exit 1
means missing, coached, failing, mismatched or unversioned evidence. Exit 0 means
the observer declarations are complete enough for an owner walkthrough; it does
not certify that the review happened, accept the product, close issues or grant
deployment permission. Owner acceptance stays separate in #38.
