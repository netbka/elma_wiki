## Outcome and scope

Owning issue and bounded stage (for rebuild work, #33 plus #34-#41):

User-visible result or infrastructure outcome:

Not completed / concrete blockers:

## Integration with the product direction

Review [the baseline-first direction](https://github.com/netbka/elma_wiki/blob/main/docs/PRODUCT_DIRECTION.md).

- [ ] State how this fits the managed workspace lifecycle, or why the change is independent. No partial package becomes a managed root; standalone inspection stays distinct.
- [ ] Identify overlapping PRs/capabilities and record the current base/head. Preserve existing fixes and the #32 engine lane; no competing compiler/deployment/state model.
- [ ] Record any conflicting product rule and its explicit owner decision, or state none. Older plans and later merge order do not override #33.

## Evidence and integration gate

- [ ] Record checks actually run against this head; distinguish synthetic, browser, live and not run. Changed UI uses production renderers in Storybook, with affected error/stale/conflict/recovery states (or explain not applicable).
- [ ] Before merge, refresh main/overlapping work, reconcile changes and rerun affected checks. Record preserved behavior rather than choosing an entire side of a conflict.
- [ ] Keep incomplete parent issues open. CI, documentation and infrastructure merges are not #33 product acceptance. #38 follows integrated #37/#39/#40/#41 evidence and the owner walkthrough.

Deployment/permissions/data changes and their explicit authorization (or none):
