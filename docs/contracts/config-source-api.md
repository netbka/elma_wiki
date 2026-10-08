# Configuration acquisition API v1

Owner-assigned 2026-10-08: load main DEV or dev2 through an independent Docker
export service, or upload a native full/single .e365 or versioned inspection
bundle. Operational implementation belongs to netbka/elma365; Wiki uses only
the HTTP/artifact contract. Source is read-only and never implies Target.

## Export service

Every /v1/ route requires a configured bearer token. Server identifiers are
explicit dev = main DEV and dev2. GET /v1/servers; GET
/v1/servers/:server/solutions; POST /v1/exports with {server,solution?};
GET /v1/exports/:id; GET /v1/exports/:id/artifact. POST returns 202.
Export state: queued -> running -> ready | failed. Ready includes artifact
SHA-256, byte count, filename and per-solution coverage. Paid exclusions and
export failures remain explicit. Captures are fresh, sequential, immutable;
they are not an atomic server/database/infrastructure backup.

Wiki operators set CONFIG_SOURCE_API_URL and CONFIG_SOURCE_API_TOKEN privately.
No browser-supplied URLs, credentials or arbitrary servers are accepted.
Redirects are refused, requests have timeout/size limits, remote errors never
copy tokens or CLI output into user responses. The remote token stays in the
server process, not projects/snapshots/Git/browser storage.

## Artifacts

Native .e365 uses package.json and nested service ZIPs or native service files.
An inspection bundle uses config-bundle.json and solutions/<code>.e365.
Manifest: format elma-config-bundle, schemaVersion 1, deployable false,
solutions array. Exported rows have code, status exported, path, bytes and
sha256. Exclusions use excluded-paid/export-failed/pack-failed.
Unknown versions, duplicate codes/paths, unexpected entries, hash/length/code
mismatches and oversized/unsafe archives are rejected. Each native member is
parsed separately, preserving original bytes and package/dependency provenance.
The container is not ELMA-importable. No upload-derived server metadata grants
a trusted Source identity.

## Wiki routes and workflow

All /api/config-source/ routes require an authenticated session. Writes retain
Host/Origin/service-header guards. GET /servers, GET /servers/:server/solutions;
POST /exports JSON {server,solution?}; POST /uploads bounded binary;
GET /acquisitions/:id; GET /acquisitions/:id/original.

Acquisition state: exporting -> parsing -> ready | failed. Acquisition records
and original containers remain private and persist across restart. Public
responses omit remote job IDs and credentials. Ready lists immutable project
captures per solution, exclusions and checksum. All members validate before
storage; a later storage failure exposes failed state and any captured members,
never claims an atomic success. Interrupted parsing is not retried blindly.
Export failures require a fresh job; transient connection failure can resume
the same acquisition. Reload URLs retain the acquisition ID.

Within Add solution / Add change / Update version, the shared acquisition
renderer lets the person upload a bundle/multiple individual packages, load
one/all solutions from DEV/dev2, download the original and select a member.
Selection feeds the existing full/partial/same-Source responsibility/review
engine. Upload/import never automatically accepts changes or infers deletions.
Each connected member gets the selected named Source reference; manual uploads
get uploader provenance only. Shared content is available to authenticated
actors; Source credentials and execution routing remain server-side.

Paid package code is unavailable. Dependent editable solutions retain their
references; browsing/editing can proceed while compatible target verification
is a separate publication gate. Global platform configuration is not claimed
to be covered by the solution catalog.
