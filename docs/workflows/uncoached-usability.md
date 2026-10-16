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

Limits of the synthetic session: it has no configured ELMA server, so the
primary entry **Загрузить решение** reads `Сервер недоступен` and participants
add and update Solutions from the three files under **Прежние загрузки**; the
fixed server path is covered by its Storybook states and the owner's live pass.
GitHub is not configured, so a published request reads "Сохранён в Wiki.
Отправка в GitHub не настроена". Nothing reaches ELMA.

The tasks follow the questions of the
[intuitive Solution UI plan](../plans/intuitive-solution-ui-2026-10-15.md),
section 3: what the Solution is for, how it works, which screens and data it
has, what changed and who changed it, what needs a decision, what happens next
and how to ask for a change. The tasks name goals, never buttons.

## Participant tasks

1. Add a Solution named for your test from `01-full.e365`, a full export.
   Say what this Solution is for and which modules it has; if the text is
   missing or wrong, write your own one-sentence purpose and reopen it.
2. Say how the approval process works: who does each step, what they fill
   in and where it goes next. Save your own one-sentence explanation of one
   step, reopen it and say who wrote it.
3. Say which screens the Solution has, which fields the contract screen
   keeps and what data the Solution stores. Say which of this is known from
   the export and what has not been checked in ELMA.
4. Review `02-change.e365`, a partial export from the same Solution. Say what
   changed since the first version, who loaded it and what needs your
   decision.
5. Mark the changed objects you have looked at, leave a comment about the
   change and show who wrote it.
6. Decide on the version and say what your decision changes and what happens
   next in the Solution.
7. Review `03-later-full.e365`, a later full export from the same source.
   Say what conflicts and choose what to keep.
8. Find the changed object's supported code and check it. Say whether
   checking or saving code changes the captured export or publishes to ELMA.
9. Ask for a change to the contract screen from the place where you see the
   screen. Say where the request went, what its state is and whether it
   reached GitHub.
10. Say the next action for the Solution, then archive and reopen it. Open
    the other participant's Solution and comment in your own profile and
    distinguish their author from your own identity.

## Observer record

Do not name buttons, guide clicks or explain terminology before the first
attempt. Record the participant's first actions and words, and the exact label a
participant reads aloud or misnames (a repeatedly misunderstood label is a
product defect, not a documentation gap). If help is needed,
record it as coaching; do not mark that task uncoached PASS. Record each task's
outcome, actions, navigation transitions, choices, input and loss of context;
note hesitation, wrong clicks and misunderstood labels. Preserve exact defect
reproduction and the source revision. Fix material UI defects in the shared
renderer, update its Storybook state and re-test.

The private `observations.local.json` starts with `performed: false` and null
outcomes. Fill it only from actual participant observations. Use role labels
instead of personal details in any public summary. Record an independent
integrated visual review separately from automated checks, using the
[visual audit checklist](visual-audit-checklist.md). After both user
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
