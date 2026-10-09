# Paid dependency inspection and encrypted uploads

Owner request: implement the paid-dependency/export workflow; live experiments
are restricted to Dev2. This branch owns Wiki ingestion, immutable capture context
and the shared acquisition/review renderer. It consumes the ELMA export API/artifact
contract without importing another project's source or tools at runtime.

Encrypted native exports remain preserved/downloadable. Add Solution now explains
why they cannot be editable baselines and offers readable per-solution/bundle
acquisition. Retrying the same file reuses its saved acquisition. Dependency reports
distinguish structurally available source, unavailable paid source, catalog-only
providers, missing evidence, unknown identity and ambiguous providers. Catalog
context is pinned to an exact project/snapshot/checksum and included in review
evidence. Uploaded catalog assertions cannot establish Source identity, activation,
compatibility or installation readiness. Native references are preserved.

## Verification

- All 274 Wiki unit/integration tests passed. Added coverage includes paid source,
  unknown/multiple providers, metadata filtering, encrypted baseline rejection,
  snapshot association and persistence after restart. Existing missing/unknown
  component and partial-deletion protections still pass.
- Synthetic browser acceptance passed: Dev2 selection and reload, paid dependency
  persistence into Solution view, native/bundle/multiple uploads, encrypted upload
  blocked from acceptance, exact original downloads, errors, keyboard operation and
  1440/390 pixel reflow. The mobile screenshot was visually inspected.
- Storybook production build, flow catalog and capability routing passed; new paid
  dependency and encrypted acquisition stories use the production renderer.
- Repository verification passed. npm installation reported existing dependency
  audit warnings; package/lock versions were not changed.
- A fresh Dev2 bundle containing 11 readable native members and two paid refusals
  was locally ingested. SHA-256:
  `1cd0a2407d8493a22ba788a93d97ba95a5f280c35ea07119f99b6973bce6ecc0`.
  Exact original bytes were preserved, 398 supported components were identified
  and 1,753 local ambiguity entries remain. Entries can overlap; this is not an
  object count. Contract-management declarations include unavailable paid source.

## Limits and ownership

None of these real full packages is certified as an accepted editable baseline.
Unsupported service/schema/resource evidence still blocks acceptance. The native
Dev2 plan also has 32 unresolved required references and, under the current
ELMA main BOM checks, 19 ambiguous providers. Implementing additional
evidence-backed service readers and native target prerequisite validation remains
necessary for full real-solution delivery. No gate was relaxed to hide these gaps.
No customer code was executed, no ELMA configuration was installed, and hosted
Wiki/DEV/PROD were not changed.

Private bundle bytes, acquired stores and detailed inspection evidence remain in
the owned ignored `.local/paid-dependencies-wiki-20261009/` directory. Synthetic
screenshots/results are in ignored `qa/`; browser/unit test servers and temporary
stores were closed/removed by teardown. Owned node_modules, editor/Storybook build
outputs and logs remain ignored. This is a locally verified repository change;
publication and full business acceptance remain unclaimed.
