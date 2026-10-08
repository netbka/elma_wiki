# Repository execution workflow

Authority: [AGENTS.md](../../AGENTS.md). This procedure makes its routing and handoff concrete; it does not grant new product, hosting, data or deployment authority.

## Start an assigned task

1. Read AGENTS and `.agent/capabilities.yaml`. Refresh `origin`, inspect open PRs and worktrees, and clean up only proven finished secondary worktrees after checking ignored artifacts. Keep active, dirty, locked or uncertain worktrees. Report what was removed or retained.
2. Classify the phase and select the capabilities actually crossed. List available names with `npm run agent:context -- --list`. For example:

   ```sh
   npm run agent:context -- change agent-system
   npm run agent:context -- change managed-workspace-ui shared-solutions
   ```

   Read the returned routes. Boundaries are candidates to assess, not an automatic scope expansion. Broad owners such as `lib/` and `server.mjs` make automatic file-to-task assignment unreliable, so selection is explicit. The command reads repository metadata only; it does not inspect GitHub, clean worktrees or execute a task.
3. Record the requested outcome, owning issue when one exists, bounded stage, actual boundaries, current base/head and overlapping work in the PR template. Work in a separate branch/worktree when another lane is active. A roadmap entry alone is not an assignment.
4. For product, domain, UI or integration work, read the current Solution-first product, execution and contradiction contracts. Historical plans supply evidence; the current owner instruction and product authority govern decisions.

## Implement and verify

An implementation request authorizes investigation, change and focused verification. Follow the root cause across adjacent capabilities when needed, updating the selected context. Ask only for unresolved material choices or actions covered by the explicit confirmation rules in AGENTS and the relevant runbook.

Choose verification for the changed invariant and materially crossed boundaries. Use the capability's existing tests and workflow. Visible UI changes update the production renderer and affected synthetic Storybook states in the same task, with browser/keyboard/reflow checks where relevant. Source/Target operations retain their explicit candidate, confirmation and read-back gates.

Run `npm run check:agent` after changing routing. It validates YAML structure, named boundaries, existing owner paths, existing contract files and the agent-system's current authority routes. `npm run verify` also runs it, so existing CI rejects broken routing. The checker does not establish the truth of prose, test sufficiency, live connectivity or human acceptance.

## Integrate and complete

Refresh main and overlapping PRs before integration; preserve their fixes and reconcile contradictions. Perform one final change-aware review and rerun checks affected by integration. Use the PR template to record actual verification and remaining blockers; distinguish synthetic, browser, live, not run and human evidence.

Finish the assigned outcome with proportional evidence or a concrete blocker. Keep incomplete parent issues open. Technical merge is separate from deployment and final product acceptance: #59 requires uncoached users, and #38 requires the owner's integrated walkthrough. No tool or CI success substitutes for either gate.
