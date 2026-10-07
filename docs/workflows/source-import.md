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
