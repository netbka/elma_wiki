# Solution -> Change -> Review

Authority: #52 / SOLUTION_FIRST_PRODUCT_PLAN.md. P2-P3: #56. Identity/privacy: contracts/shared-solutions.md.

Signed-in home and the verified VK link open `/solutions`. Empty state offers one Add solution action. A Solution stays in Overview / Changes / Solution context; Learn is secondary. Legacy upload/workspace/release routes shared by signed-in users are compatibility capabilities. An exact accepted full export can enter contextual handoff and guarded delivery through the existing delivery contract; composed configuration release remains under P6.

`web/managed/render.js` remains the single production/Storybook renderer. The controller selects the shared `/api/solutions` root or the shared historical-content compatibility API, without crossing storage principals. Synthetic fixtures never use customer files or contact ELMA.

## Journey

1. Add solution: name it, identify responsibility for its starting version and upload a full .e365 export. Explicitly confirm full scope; all uploads are shared automatically. Responsibility is declared evidence, not a user role or inferred native author.
2. Overview: current version, attention and one recommended action. Add change / Update version are subordinate when not recommended. Source/history/archiving are disclosed when needed.
3. Add change: describe it, identify responsibility, upload a partial export and confirm scope and same Solution/Source. Missing objects never mean deletion in a partial export. Optionally choose the accepted full version the export was based on: each choice shows its exact acceptance revision and SHA-256, and earlier accepted versions remain selectable. The choice requires a separate confirmation and is recorded as a declared, not verified, ancestry; leaving it empty records an unknown base exactly as before. With a declared base a partial change may also name its component scope by exact captured keys from that base, from the replaced upload of the same change, or entered exactly; every object of the partial export must be included. A scoped member absent from the export stays unchanged; no deletion control is offered here. Review shows the declared or unknown base, ancestry status and scope membership. None of this enables automatic merge, build or delivery.
4. Review: examine changed objects/responsibility, confirm each relevant boundary or choose each conflict version, then Accept change. Known process parts show their previous declared team, additions, boundary edits and cross-team conflicts; download the responsibility report when sharing this review. Unknown parts preserve whole-object review. A conflict decision still selects the whole captured process file. A full update advances the current version. Neither decision installs anything in ELMA.
   When a Change declares its accepted full base and another accepted change has since edited the same objects, Review shows **Совмещение с принятыми изменениями**: the base / accepted / this-change comparison, objects preserved without conflict and blocked evidence. Choose a version for every conflicting object (whole object only; nothing is preselected), give a reason and **Сохранить решение**. The decision is saved with its author and exact versions; a later accepted change, a replacement upload or another saved decision makes it stale or superseded, and a competing save is refused while the typed draft stays on the page. Saving a resolution does not accept the change, produce a package or install anything (`test:merge-resolution:browser`).
5. Changes shows pending review and accepted history; Solution shows current objects. A Change contains attributed discussion/findings, before/after source context and supported contextual code. Process/form preview exposes the captured scenario catalog, bounded Wiki path checks and step-linked comments; native behavior remains unknown.
6. Archive is a secondary disclosed action. Archived state recommends reopening and retains history/originals.

To understand the accepted configuration, choose **Объяснить решение** in Overview
or Solution. Open an accepted process from its object row, or a captured process
in Change review, then choose **Объяснить этот процесс/шаг**. Inspect sources,
edit the draft and **Сохранить объяснение** beside that object. New drafts are
compared before replacement. Source changes request review; removed-step text
remains in the Solution's saved explanation catalogue. This documentation does
not accept a Change or establish native ELMA behavior. See the
[explanation contract](../contracts/solution-explanations.md).

## Attention and recovery

In **Передача**, review the exact accepted original, freeze it and accept it for
handoff. The contextual **Доставка и проверка результата** panel uses the exact
Solution/handoff pair and the session actor's explicit Target references. An
unavailable adapter or unhealthy/offline connection blocks delivery; the private
handoff bundle remains available. Probe a selected connection before preparation.
Check the observed Target identity, version and candidate hash, then type the
separate confirmation. Preparation can be cancelled before dispatch.

During dispatch refresh the stored state; after completion read back and compare
the entire inventory. A mismatch or read failure offers read-back retry; another
import requires a new preparation and confirmation. Unknown outcomes reserve the
Target and require read-back without redispatch. On a lost response, **Обновить
состояние доставки** reloads the stored handoff/attempt while retaining drafts
and contextual focus. Failed loads offer retry and no delivery action. Stale
associations retain history and preparation cancellation but cannot confirm or
verify a changed candidate. Historical verified is displayed as stale when the
server's current evidence flags are false. Package read-back does not establish
native business acceptance or a completed configuration release.

`test:solution-delivery:browser` checks these controls through authenticated
synthetic API/storage. `test:solution-delivery:storybook` checks 17 contextual
states and the interactive path using the same production renderers. #59/#41
remains deferred; these checks do not restart or replace human evidence.

`solutionNextAction` is a pure projection: error/stale recovery and archive precede normal work; no source requests an initial export; fresh conflict/unknown evidence precedes other pending review; needs-changes requests a corrected export; otherwise review the first fresh change. Only stale proposals request a fresh comparison. Accepted state opens Solution; ready state adds a change. TEST-awaiting-verification/verified projections require a supplied supported delivery capability and are not inferred from review acceptance.

Preparation saves conflict/unknown counts as overview hints. Acceptance still recomputes evidence and enforces revision, digest, Source, boundary and conflict gates. Loading/fetch/mutation/lost-response/stale/archived paths are explicit. Forms keep entered values and a saved upload after a safe failure. Lost responses/409 block replay and request server state; no automatic retry writes. Change/update preparation also keeps a per-tab draft (attribution, base, scope and saved upload, but not confirmations) across a stale or rejected submit and refresh; after a lost response it warns that the change may already be saved and links to Changes. A successful preparation or **Очистить черновик** removes it. `npm run test:change-base:browser` checks historical/unknown base, duplicate/foreign members, absent-not-deleted acceptance, stale submit, lost response, draft retention and five Storybook states through the authenticated synthetic API.

## Evidence and limits

Thirty-nine shared `managed-workspace--*` stories cover the current tabs, attention/recovery, Change discussion/decision and process-part responsibility, change base/scope and merge-resolution states; nine `solution-visual--*` stories cover reconstructed process/form and bounded scenario states. ViewModel tests verify attention priority and gates; catalog/API/storage/auth tests preserve identity/privacy and lifecycle.

`npm run test:managed:browser` exercises shared creation, attributed Change findings, explicit correction, retained stale anchors, resolution, acceptance history, contextual editor save/check, partial boundary review, full conflict choice, archive/reopen, stale rejection, fetch recovery, keyboard focus and 1920/800/390 reflow. The process case also downloads the report, accepts additions without transferring untouched parts, checks a baseline boundary, blocks cross-team overlap and chooses the whole file during reconciliation. It retains synthetic screenshots and `qa/managed-browser-evidence.json`. Build the editor and Storybook first; CI supplies Chromium when unavailable locally. VK browser verification checks the entry.

Automated evidence does not establish uncoached comprehension. #59/#38 require human review/owner acceptance. No live Source, TEST delivery, native runtime equivalence or production deployment is claimed.

### Independent integration check — 8 October 2026

Reviewed #63 at `71084d9` against main `cef0195` after #62 merged.
The three merge conflicts were confined to protected routes and the task
panel's return destinations. Retaining #63's `/solutions` routes and return
links preserves both capabilities. The resolved application tree is identical
to the reviewed #63 tree; the merge records main's ancestry.

Local checks passed: 31 focused catalog/auth/ViewModel/coordinator/server/bridge
tests, repository verification, the 83-story catalog and Storybook build.
Headless Chrome passed the shared Solution lifecycle and all 19 managed stories,
plus the task-panel queue/retry/clarification/approval/cancellation journey,
keyboard, mobile and zoom checks. Desktop conflict, mobile overview and working
task-panel screenshots were inspected. Evidence uses synthetic local data.
GitHub's Verify service and Request bot contracts also passed at `71084d9`.

This integration does not complete #57's separately claimed discussion work,
#58's visual reconstruction, uncoached acceptance or any live delivery gate.
