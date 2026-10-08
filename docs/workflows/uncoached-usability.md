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
