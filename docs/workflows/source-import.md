# Source import workflow

States: not-configured -> ready -> selecting -> exporting -> parsing -> snapshot-ready.

Failure states: connection-failed, export-failed, parse-partial, parse-failed.

1. Select/configure Source.
2. Run read-only capability check.
3. Select solution explicitly.
4. Export.
5. Hash/store returned archive as new immutable snapshot.
6. Parse project index and coverage.
7. Open viewer.

Existing snapshots remain unchanged. Errors never masquerade as snapshot-ready. Partial parse stays visible and preserves original evidence. Source credentials are not copied into the snapshot.

Implemented acquisition lives inside Add solution / Add change / Update
version. Open the secondary ELMA/archive option, choose DEV or dev2, load
one solution or all available solutions, then select a member. A server bundle
can also be uploaded manually; multiple native packages stay separate.
Confirm full/partial scope through the existing form before adding/reviewing.
The saved acquisition URL or recent-load list resumes after reload/network
failure. Paid exclusions remain visible. Download retains the exact original
container; it is not an ELMA deployment package.
See [API/format contract](../contracts/config-source-api.md).
