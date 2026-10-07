# Analyst release investigation and offline milestone

Investigated main `fd45c08` (7 October 2026), after checking current main and open PRs. No overlapping open PR was present. Issue #11's useful offline milestone is the assigned outcome; later live TEST/PROD slices remain separately gated.

Findings: uploads already have owner checks, immutable originals, checksum validation, revision inventories and isolated UUID projects. Browser workspace and offline compiler are integrated; changes there are distinct from originals. No release record, explicit baseline, durable analyst decision, frozen original candidate or private evidence bundle existed. Dashboard began with projects and structural exploration. Source/Target lifecycle remains a contract, not an implemented live adapter.

Implementation reuses `projectStore.snapshot` to capture a consistent owner-authorized original/metadata pair under the project queue. It adds private durable release records, pins both explicit artifacts, compares the complete expanded inventory, then uses structural fields to explain impact. No files are silently excluded or normalized. Per-file review decisions and limitations precede a frozen original candidate; owner acceptance precedes handoff. A common renderer and pure ViewModel power the actual private UI and synthetic stories.

Support matrix:

| Capability | Offline milestone |
| --- | --- |
| Manual DEV package selection and original preservation | Implemented, owner-only |
| Previous DEV baseline, file hashes, structural field explanations | Implemented; two-way review, no target-conflict claim |
| Durable rejection/acceptance, resume, stale-tab protection | Implemented |
| Unchanged-original candidate and private handoff | Implemented; acceptance is local handoff only |
| Unknown/malformed/encrypted content | Visible, preserved; parser holes block candidate preparation |
| Workspace edits and generated package construction | Outside this milestone; explicitly excluded from candidate |
| Source/Target adapter, ELMA checks, dependency readiness | Not run / not implemented |
| Live delivery, read-back, independent team approval, recovery | Later gates; no deployment authorization |

Evidence is synthetic unit/API and real local browser behavior. No customer archive, live import or production operation was used. No measured human usability claim is made; the proposed 20-second target still needs an analyst study. A live TEST milestone will require an explicitly nominated environment, solution, adapter and operator authorization rather than treating a successful local handoff as delivery proof.
