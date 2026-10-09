# Native Solution admission

Owner request: unblock the existing full export; all live experiments on Dev2.
This task is stacked on paid dependency handling in PR #96, with its own branch
and worktree. Wiki and ELMA remain independent projects.

## Result

The local Wiki can accept all 11 readable native Dev2 Solution packages as full
comparison baselines: 1,076 components, zero component ambiguities. Downloading
each baseline original returns exactly its uploaded member bytes. The private
bundle, local store, identity maps and per-member checksum results remain in
owned ignored `.local/dev2-import-unblock-wiki-20261009/`.

The parser recognizes observed native service/kind profiles, empty native
manifests, declared resources and the localization singleton with a literal
null payload. Permission, extension and native process variants use kind in
their identity where namespace/code alone collide. Visual anchors and Solution
context lookups use the same identity. Legacy typed identity comparisons require
explicit baseline migration review. The Solution table distinguishes variants;
its Storybook fixture shares the production renderer.

These profiles establish manifest identity and byte comparison only. Unknown
service/kind/schema, duplicate identities, missing resources, unsafe paths and
unclassified files still block baseline acceptance. No imported code executes.
Paid/opaque originals remain preserved; their internals are unavailable.

## Verification and limits

- 279 unit tests passed, including unknown/duplicate/resource/migration guards
  and typed visual anchors.
- Browser upload, original download, opaque rejection, native component labels,
  keyboard and mobile reflow passed. The initial immediate visibility assertion
  raced asynchronous navigation; waiting for the rendered labels fixes the test.
- Storybook build, agent routing and repository verification passed.
- Real Dev2 exports were admitted through the local Solution store with exact
  original export read-back. This is local comparison evidence, not hosted Wiki
  deployment, ELMA installation or business-flow acceptance.

The companion ELMA task ran native validation on Dev2. Contract management still
fails because `_clients` is already owned by paid `spark_integration`, and
`_system_catalogs` by `system_directories`. Native export without dependencies
also refuses the declared dependencies. No ownership was removed, dependency
stripped, forced import attempted or business runtime published. Native delivery
needs a supported composition/ownership resolution and native acceptance.

Both task worktrees remain active for draft review. Private evidence and local
admission stores are retained; synthetic browser servers/stores are removed by
teardown. Prior tasks and concurrent work remain untouched. No product-direction
conflict was introduced: full baselines and partial Change review keep their
existing lifecycle. Refresh main and overlapping PRs before merge.
