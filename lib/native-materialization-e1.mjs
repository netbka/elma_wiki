import crypto from 'node:crypto';
import fs from 'node:fs';

// Wiki consumer of netbka/elma365 `elma365-native-materialization@1` (E1, #60).
// The schema is vendored byte for byte from the commit below and checked by
// digest, so a silent edit fails every validation closed. This module is pure: it
// builds and validates the request envelope and validates worker receipts and
// their output bytes. It runs no native tool, reads no host path and enables
// nothing. The semantic and hygiene rules are ported from elma365
// tools/native-materialization/contract.mjs at the same commit.
export const E1_CONTRACT = Object.freeze({ id: 'elma365-native-materialization', version: 1 });
// Schema revision 1.2 and the rules are pinned to the head of netbka/elma365 PR #99,
// which is not merged yet. Re-pin `revision`/`commit` to #99's merge commit once it merges.
export const E1_SOURCE = Object.freeze({ repository: 'netbka/elma365', pullRequest: 99, issue: 60, merged: false,
  revision: '8e662ef7a76b4fe2d0ccc422a695ef4879835bb1', commit: '8e662ef7a76b4fe2d0ccc422a695ef4879835bb1',
  path: 'tools/native-materialization/contract.schema.json', schemaRevision: '1.2',
  sha256: '1edd76e8c5ef078e0be008dccf56a76e9f9a8ae23c23a38c1a27276491c8c69f' });

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
const pointer = (path, key) => path + '/' + String(key).replace(/~/g, '~0').replace(/\//g, '~1');

// The digest is over the published LF bytes, independent of checkout line endings.
const schemaText = fs.readFileSync(new URL('./contracts/elma365-native-materialization-1.schema.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
export const E1_SCHEMA = freeze(JSON.parse(schemaText));
export const E1_SCHEMA_INTACT = hash(schemaText) === E1_SOURCE.sha256 && E1_SCHEMA.$defs.schemaRevision?.const === E1_SOURCE.schemaRevision;
export const E1_SCHEMA_REVISION = E1_SCHEMA.$defs.schemaRevision?.const ?? null;
const POLICY = E1_SCHEMA.$defs.manifestRegenerationPolicy.const;
export const E1_MANIFEST_POLICY = Object.freeze({ id: POLICY.id, version: POLICY.version });
export const E1_REQUIRED_CHECKS = Object.freeze(['original-digests', 'native-layout', 'expected-files', 'component-digests',
  'manifest-regeneration', 'native-package-check', 'native-pack']);

// The JSON Schema 2020-12 keywords this validator implements. Any other keyword
// in a schema node fails closed instead of being silently ignored.
const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', '$defs']);
const KEYWORDS = new Set(['$ref', 'anyOf', 'const', 'enum', 'type', 'minLength', 'maxLength', 'pattern', 'minimum', 'items', 'minItems', 'maxItems',
  'properties', 'required', 'additionalProperties']);
function schemaErrors(schema, value, path, errors) {
  const unsupported = Object.keys(schema).filter(key => !KEYWORDS.has(key) && !ANNOTATIONS.has(key));
  if (unsupported.length) return errors.push({ reason: 'unsupported-schema-keyword', path, detail: unsupported.sort().join(',') }), errors;
  if (schema.$ref) {
    const target = schema.$ref.startsWith('#/$defs/') ? E1_SCHEMA.$defs[schema.$ref.slice('#/$defs/'.length)] : null;
    return target ? schemaErrors(target, value, path, errors) : (errors.push({ reason: 'unsupported-schema-keyword', path, detail: '$ref' }), errors);
  }
  if (schema.anyOf) {
    const branches = schema.anyOf.map(branch => schemaErrors(branch, value, path, []));
    if (!branches.some(rows => !rows.length)) errors.push(...branches.reduce((a, b) => b.length < a.length ? b : a));
    return errors;
  }
  const invalid = detail => errors.push({ reason: 'invalid-value', path, detail });
  if ('const' in schema && canonical(schema.const) !== canonical(value)) return invalid('const'), errors;
  if (schema.enum && !schema.enum.some(row => canonical(row) === canonical(value))) return invalid('enum'), errors;
  const types = [schema.type ?? []].flat(), actual = typeOf(value);
  if (types.length && !types.includes(actual) && !(actual === 'integer' && types.includes('number'))) return invalid('type'), errors;
  if (typeof value === 'string') {
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) invalid('length');
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) invalid('pattern');
  }
  if (typeof value === 'number' && value < (schema.minimum ?? -Infinity)) invalid('minimum');
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) invalid('items');
    if (schema.items) value.forEach((row, index) => schemaErrors(schema.items, row, pointer(path, index), errors));
  }
  if (actual === 'object' && schema.properties) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push({ reason: 'missing-field', path: pointer(path, key) });
    for (const [key, row] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties, key)) schemaErrors(schema.properties[key], row, pointer(path, key), errors);
      else if (schema.additionalProperties === false) errors.push({ reason: 'unknown-field', path: pointer(path, key) });
    }
  }
  return errors;
}
const DRIFT = ['contract-schema-drift', 'unsupported-schema-keyword'];
const validateDef = (name, value, path = '') => E1_SCHEMA_INTACT ? schemaErrors(E1_SCHEMA.$defs[name], value, path, [])
  : [{ reason: 'contract-schema-drift', path: E1_SOURCE.path }];

// E1 data hygiene: no host filesystem path, host URL or secret material in any key
// or string value, whole or embedded in free text.
const SECRET_KEY = /(token|secret|passw(or)?d|pwd|authori[sz]ation|cookie|api[-_]?key|private[-_]?key|credential|bearer)/i;
const SECRET_VALUE = [
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)-----/,
  /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i,
  // Scheme-relative URL user-info: //user:pass@host. Scheme-less user:pass@host is userInfoCredential below.
  /(?:^|[^\w/])\/\/[^/\s:@]+:[^/\s@]+@/,
  /\b(token|secret|passw(or)?d|api[-_]?key)\s*[:=]\s*\S+/i
];
// Scheme-less URL user-info user:pass@host[:port][/path]. It is a credential when the
// host is an IPv4 address, localhost or a dotted name ending in a letter label, when a
// port or path follows, or when the password segment is password-like (contains a
// non-letter). Plain identifiers stay valid: ns:module@1.0.0/x (a version, not a host),
// svc:widgets@Contracts and role:admin@company (single-label host, letters-only segment).
const USER_INFO = /(?:^|[\s"'`(<>[{=,;:|])([^\s:@/"'`]+):([^\s@/"'`]+)@([A-Za-z0-9][A-Za-z0-9.-]*)(:\d+|\/[^\s\"'`]*)?(?=$|[\s:/"'`)>\]},;|.])/g;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const DOTTED_HOST = /^(?:[A-Za-z0-9-]+\.)+[A-Za-z][A-Za-z0-9-]*$/;
const userInfoCredential = value => [...value.matchAll(USER_INFO)].some(([, , password, host, rest]) => {
  const name = host.replace(/\.$/, '');
  if (IPV4.test(name)) return true;
  if (!/^[A-Za-z]/.test(name)) return false;
  return /^localhost$/i.test(name) || DOTTED_HOST.test(name) || Boolean(rest) || /[^A-Za-z]/.test(password);
});
// HTTP Basic credentials: "Basic <base64>" (or basic:/basic=<base64>) whose decoded value is user:password.
const BASIC_CREDENTIAL = /\bbasic(?:\s+|\s*[:=]\s*)([A-Za-z0-9+/]{4,}={0,2})(?![A-Za-z0-9+/=])/gi;
const basicCredential = value => [...value.matchAll(BASIC_CREDENTIAL)]
  .some(([, token]) => /^[^\u0000-\u001f:]+:[^\u0000-\u001f]*$/.test(Buffer.from(token, 'base64').toString('latin1')));
// A whole value that is a host path or URL, or one embedded in free text after a
// separator (including key:value and <...>): drive, UNC, ~/, file:, an absolute
// POSIX path of two or more segments or under a well-known root. Archive paths
// never start with "/"; ELMA API routes (/api/..., /pub/...) are not host paths
// unless the route contains a "..", a backslash or a percent-encoded dot or separator.
const API_ROUTE = String.raw`(?!(?:api|pub)(?!\S*?(?:\.\.|\\|%2e|%2f|%5c))(?:[/?#\s]|$))`;
const SEPARATOR = String.raw`(?:^|[\s"'${'`'}(<>[{=,;:|])`;
const HOST_PATH = new RegExp(String.raw`^([A-Za-z]:[\\/]|\\\\|\/${API_ROUTE}|~[\\/]|file:)`, 'i');
const EMBEDDED_HOST_PATH = new RegExp(SEPARATOR + String.raw`(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+|~[\\/]|file:|\/${API_ROUTE}(?:[^\s/\\]+\/)+`
  + String.raw`|\/(?:home|Users|tmp|var|etc|opt|srv|mnt|root|usr|private|Volumes)\b)`, 'i');
const HOST_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
const EMBEDDED_HOST_URL = new RegExp(SEPARATOR + String.raw`[a-z][a-z0-9+.-]*:\/\/`, 'i');
function scan(value, path, errors) {
  if (typeof value === 'string') {
    if (SECRET_VALUE.some(pattern => pattern.test(value)) || basicCredential(value) || userInfoCredential(value)) errors.push({ reason: 'secret-like-value', path });
    else if (HOST_PATH.test(value) || EMBEDDED_HOST_PATH.test(value)) errors.push({ reason: 'host-path', path });
    else if (HOST_URL.test(value) || EMBEDDED_HOST_URL.test(value)) errors.push({ reason: 'client-host-reference', path });
  } else if (value && typeof value === 'object') {
    for (const [key, row] of Object.entries(value)) {
      if (!Array.isArray(value) && SECRET_KEY.test(key)) errors.push({ reason: 'secret-like-field', path: pointer(path, key) });
      scan(row, pointer(path, key), errors);
    }
  }
  return errors;
}
/** E1 hygiene scan of one value (also used by the parity check against elma365). */
export const e1HygieneErrors = value => scan(value, '', []);

const result = (errors, extra = {}) => {
  const rows = [...new Map(errors.map(row => [canonical(row), row])).values()].sort((a, b) => compare(canonical(a), canonical(b)));
  return freeze({ valid: !rows.length, errors: rows, ...extra });
};
const wikiRequestOf = request => request?.contract ? request.request : request;
/** No-edit mode: a request (bare or in its envelope) with zero operations. Its
 * output must equal the base; nothing is regenerated, replaced, removed or imported. */
export const isE1NoEdit = request => Array.isArray(wikiRequestOf(request)?.operations) && wikiRequestOf(request).operations.length === 0;
const coupledServices = request => [...new Set(request.operations.filter(op => op.coupled).map(op => op.service))].sort(compare);
const changedServices = request => [...new Set(request.operations.map(op => op.service))].sort(compare);
const bytesOf = value => { try { return Buffer.from(value); } catch { return null; } };

/** Wraps a Wiki request in the E1 envelope: the request verbatim, a transport
 * manifest of its originals and the explicit release scope from its coverage. */
export function buildE1Envelope(request, originals = new Map()) {
  const coverage = request?.inputs?.coverage;
  return { contract: { ...E1_CONTRACT }, request,
    originals: (request?.inputs?.originals ?? []).map(row => {
      const bytes = originals instanceof Map ? bytesOf(originals.get(row.artifactId) ?? []) : null;
      return { artifactId: row.artifactId, sha256: row.checksum, size: bytes?.length ?? 0 };
    }),
    releaseScope: { solution: request?.inputs?.solution, units: (coverage?.units ?? []).map(unit => unit.id), importOrder: coverage?.importOrder ?? null } };
}

// E1 semantic request rules (elma365 contract.mjs requestSemantics at E1_SOURCE.commit).
function requestSemantics(request, errors) {
  const { inputs } = request, add = (reason, details = {}) => errors.push({ reason, ...details });
  if (hash(canonical(inputs)) !== request.inputsDigest) add('inputs-digest-mismatch', { path: '/request/inputsDigest' });
  const originals = new Map();
  for (const row of inputs.originals) {
    if (originals.has(row.artifactId)) add('duplicate-original', { artifactId: row.artifactId });
    originals.set(row.artifactId, row.checksum);
  }
  if (originals.get(inputs.base.artifactId) !== inputs.base.checksum) add('base-not-in-originals', { artifactId: inputs.base.artifactId });
  const synthetic = request.evidenceBasis === 'synthetic';
  if (synthetic !== (request.blockers.length === 1)) add('synthetic-basis-mismatch', { path: '/request/blockers' });
  if (inputs.dependencies.planDigest !== inputs.coverage.planDigest) add('stale-dependency-plan', { path: '/request/inputs/dependencies/planDigest' });
  for (const [index, lock] of inputs.dependencies.locks.entries()) {
    if (!synthetic && lock.evidence !== 'native-receipt') add('synthetic-basis-mismatch', { path: `/request/inputs/dependencies/locks/${index}` });
    if (lock.targetProfileDigest !== inputs.targetProfile.digest) add('dependency-profile-mismatch', { path: `/request/inputs/dependencies/locks/${index}` });
    if ((lock.activation === 'pending-installation') !== Object.hasOwn(lock, 'artifactDigest')) add('dependency-lock-invalid', { path: `/request/inputs/dependencies/locks/${index}` });
  }
  if (inputs.compiler.platformVersion !== inputs.targetProfile.platformVersion) add('compiler-platform-mismatch');
  for (const service of coupledServices(request)) if (!inputs.compiler.services.includes(service)) add('unsupported-compiler-scope', { service });
  const units = inputs.coverage.units, unitIds = units.map(unit => unit.id);
  if (canonical([...unitIds].sort(compare)) !== canonical([...inputs.coverage.importOrder].sort(compare)) || new Set(unitIds).size !== unitIds.length)
    add('import-order-mismatch', { path: '/request/inputs/coverage/importOrder' });
  for (const [index, op] of request.operations.entries()) {
    const at = `/request/operations/${index}`;
    if (!originals.has(op.sourceArtifactId)) add('unknown-source-artifact', { path: at, artifactId: op.sourceArtifactId });
    const shape = op.op === 'add' ? op.digest && op.baseDigest === null : op.op === 'replace' ? op.digest && op.baseDigest && op.digest !== op.baseDigest
      : op.digest === null && op.baseDigest && op.sourceArtifactId === inputs.base.artifactId;
    if (!shape) add('operation-digest-invalid', { path: at });
    const covering = units.filter(unit => unit.members.some(member => member.solution === inputs.solution && member.key === op.key));
    if (covering.length !== 1) add('uncovered-operation', { path: at });
  }
  // No-edit mode: the output is the base, file for file.
  if (!request.operations.length) for (const [index, file] of request.expected.files.entries())
    if (file.action !== 'preserve' || file.sourceArtifactId !== inputs.base.artifactId) add('no-edit-file-not-preserved', { path: `/request/expected/files/${index}` });
  const seen = new Set(), manifests = new Set(), regenerated = new RegExp(POLICY.regeneratedFilePattern);
  for (const [index, file] of request.expected.files.entries()) {
    const at = `/request/expected/files/${index}`;
    if (seen.has(file.path)) add('duplicate-expected-path', { path: at });
    seen.add(file.path);
    const valid = file.action === 'remove' ? file.sha256 === null && file.sourceArtifactId === null
      : file.sha256 !== null && originals.has(file.sourceArtifactId) && (file.action !== 'native-manifest' || regenerated.test(file.path));
    if (!valid) add('expected-file-invalid', { path: at });
    if (file.action === 'native-manifest') manifests.add(file.path.split('/')[0]);
    if (POLICY.preservedFiles.includes(file.path) && file.action !== 'preserve') add('manifest-policy-violation', { path: at });
  }
  for (const service of changedServices(request)) if (!manifests.has(service)) add('missing-service-manifest', { service });
  for (const service of manifests) if (!changedServices(request).includes(service)) add('manifest-policy-violation', { service });
}

/** Validates an E1 request envelope and the exact original bytes it transports.
 * Fails closed: schema errors in the request stop semantic checks; absent bytes are missing. */
export function validateE1Request(envelope, { originals = new Map() } = {}) {
  const errors = scan(envelope, '', validateDef('materializationRequest', envelope));
  if (!(originals instanceof Map)) return result([...errors, { reason: 'invalid-value', path: 'originals', detail: 'map' }]);
  for (const id of originals.keys()) if (typeof id !== 'string') errors.push({ reason: 'unexpected-original', artifactId: String(id) });
  if (errors.some(row => DRIFT.includes(row.reason) || (['missing-field', 'invalid-value'].includes(row.reason) && /^\/(request|originals|releaseScope)(\/|$)/.test(row.path)))
    || typeOf(envelope) !== 'object') return result(errors);
  const { request } = envelope;
  requestSemantics(request, errors);
  const declared = new Map(request.inputs.originals.map(row => [row.artifactId, row.checksum])), transported = new Map();
  for (const row of envelope.originals) {
    if (transported.has(row.artifactId)) errors.push({ reason: 'duplicate-original', artifactId: row.artifactId });
    transported.set(row.artifactId, row);
  }
  for (const [artifactId, checksum] of declared) {
    const row = transported.get(artifactId), raw = originals.get(artifactId), bytes = raw === undefined ? null : bytesOf(raw);
    if (!row || !bytes) { errors.push({ reason: 'missing-original', artifactId }); continue; }
    if (row.sha256 !== checksum) errors.push({ reason: 'original-digest-mismatch', artifactId, path: '/originals' });
    if (hash(bytes) !== checksum) errors.push({ reason: 'original-digest-mismatch', artifactId });
    else if (bytes.length !== row.size) errors.push({ reason: 'original-size-mismatch', artifactId });
  }
  for (const artifactId of new Set([...transported.keys(), ...originals.keys()])) if (!declared.has(artifactId)) errors.push({ reason: 'unexpected-original', artifactId });
  const scope = envelope.releaseScope, coverage = request.inputs.coverage;
  // No-edit mode imports nothing: its release scope is empty.
  if (isE1NoEdit(request) && (scope.units.length || scope.importOrder.length)) errors.push({ reason: 'no-edit-scope-not-empty', path: '/releaseScope' });
  if (scope.solution !== request.inputs.solution || canonical([...scope.units].sort(compare)) !== canonical(coverage.units.map(unit => unit.id).sort(compare))
    || canonical(scope.importOrder) !== canonical(coverage.importOrder)) errors.push({ reason: 'release-scope-mismatch', path: '/releaseScope' });
  return result(errors);
}

/** Output byte transport (elma365 validateReceiptArtifacts): `bytes` maps the
 * transport name (the 64-hex sha256) to delivered bytes. Every listed artifact
 * needs bytes whose sha256 AND length equal its entry; absent, misnamed or extra
 * bytes (including any bytes with an unavailable receipt) are rejected. */
export function validateE1ReceiptArtifacts(receipt, bytes = new Map()) {
  if (!(bytes instanceof Map)) return result([{ reason: 'invalid-value', path: 'bytes', detail: 'map' }]);
  const errors = [], names = new Set();
  for (const [index, artifact] of (Array.isArray(receipt?.artifacts) ? receipt.artifacts : []).entries()) {
    const at = `/artifacts/${index}`, name = artifact?.sha256;
    if (typeof name !== 'string' || !/^[0-9a-f]{64}$/.test(name) || !Number.isInteger(artifact.size)) { errors.push({ reason: 'invalid-value', path: at }); continue; }
    if (names.has(name)) errors.push({ reason: 'duplicate-artifact', path: at });
    names.add(name);
    if (!bytes.has(name)) { errors.push({ reason: 'missing-artifact-bytes', path: at }); continue; }
    const buffer = bytesOf(bytes.get(name)) ?? Buffer.alloc(0);
    if (hash(buffer) !== name) errors.push({ reason: 'artifact-digest-mismatch', path: at });
    if (buffer.length !== artifact.size) errors.push({ reason: 'artifact-size-mismatch', path: at });
  }
  for (const name of bytes.keys()) {
    if (typeof name !== 'string' || !/^[0-9a-f]{64}$/.test(name)) errors.push({ reason: 'artifact-name-invalid', name: String(name) });
    else if (!names.has(name)) errors.push({ reason: 'unexpected-artifact', name });
  }
  return result(errors);
}

/** Validates an E1 receipt against the exact Wiki request it answers and returns
 * {valid, errors, state}. `state` is `validated`, `failed` or `unavailable` only
 * for a self-consistent receipt bound to that request; anything else is `invalid`.
 * A relabelled unavailable receipt can never read as validated. With `artifacts`
 * (the returned `[{solution, bytes, sha256?}]`, named by `sha256` or else by the
 * digest of their bytes) the output transport is bound as well
 * (validateE1ReceiptArtifacts): every listed archive needs bytes of exactly that
 * sha256 and size, and no other bytes may arrive. */
export function validateE1Receipt(receipt, request, { artifacts } = {}) {
  const errors = scan(receipt, '', validateDef('validationReceipt', receipt));
  if (validateDef('wikiRequest', request, '/request').length) errors.push({ reason: 'invalid-request' });
  const done = () => { const checked = result(errors); return freeze({ ...checked, state: checked.valid ? receipt.status : 'invalid' }); };
  if (errors.some(row => ['missing-field', 'invalid-value', 'invalid-request', ...DRIFT].includes(row.reason))) return done();
  if (artifacts !== undefined) {
    const named = new Map();
    for (const row of Array.isArray(artifacts) ? artifacts : []) {
      const bytes = bytesOf(row?.bytes ?? null) ?? Buffer.alloc(0), name = typeof row?.sha256 === 'string' ? row.sha256 : hash(bytes);
      if (named.has(name)) errors.push({ reason: 'duplicate-artifact-bytes', name });
      named.set(name, bytes);
    }
    errors.push(...validateE1ReceiptArtifacts(receipt, named).errors);
  }
  const add = (reason, details = {}) => errors.push({ reason, ...details });
  if (receipt.requestDigest !== hash(canonical(request))) add('request-digest-mismatch');
  if (receipt.inputsDigest !== request.inputsDigest) add('inputs-digest-mismatch');
  if (receipt.targetProfileDigest !== request.inputs.targetProfile.digest) add('target-profile-mismatch');
  if (receipt.compilerProfileDigest !== request.inputs.compiler.profileDigest) add('compiler-profile-mismatch');
  const keys = receipt.checks.map(row => canonical([row.id, row.service]));
  if (new Set(keys).size !== keys.length) add('duplicate-check');
  for (const [index, row] of receipt.checks.entries()) if ((row.id === 'service-compile') !== (row.service !== null)) add('check-service-invalid', { path: `/checks/${index}` });
  if (receipt.status === 'unavailable') {
    if (!receipt.unavailable) add('unavailable-without-reason');
    if (receipt.artifacts.length) add('unavailable-with-artifacts');
    if (receipt.coverage) add('unavailable-with-coverage');
    for (const [index, row] of receipt.checks.entries()) if (row.status !== 'unavailable') add('unavailable-check-result', { path: `/checks/${index}` });
    return done();
  }
  if (receipt.unavailable) add(receipt.status + '-with-unavailable');
  const artifact = receipt.artifacts[0], coverage = receipt.coverage;
  if (artifact && artifact.solution !== request.inputs.solution) add('artifact-solution-mismatch');
  const complete = coverage && coverage.matchedFiles === coverage.expectedFiles && coverage.unexpectedPaths === 0
    && coverage.matchedComponents === coverage.expectedComponents && coverage.expectedFiles === request.expected.files.length
    && coverage.expectedComponents === request.expected.components.length
    && Object.entries(coverage.actions).every(([action, count]) => request.expected.files.filter(row => row.action === action).length === count);
  if (receipt.status === 'failed') {
    if (complete && !receipt.checks.some(row => row.status === 'failed')) add('failed-without-failure');
    return done();
  }
  if (!artifact) add('artifact-missing');
  if (!complete) add('coverage-incomplete');
  if (isE1NoEdit(request) && coverage && (coverage.unexpectedPaths || coverage.actions.replace || coverage.actions.remove || coverage.actions['native-manifest']))
    add('no-edit-output-changed');
  if (receipt.evidenceRef === null) add('evidence-missing');
  const required = [...E1_REQUIRED_CHECKS.map(id => ({ id, service: null })), ...coupledServices(request).map(service => ({ id: 'service-compile', service }))];
  for (const need of required) if (!receipt.checks.some(row => row.id === need.id && row.service === need.service)) add('missing-check', need);
  for (const [index, row] of receipt.checks.entries()) {
    const at = `/checks/${index}`;
    if (row.status !== 'passed') add('check-not-passed', { path: at });
    if (!row.tool) add('check-tool-missing', { path: at });
    if (!row.evidenceRef) add('evidence-missing', { path: at });
    if (row.artifactSha256 !== (row.id === 'original-digests' ? null : artifact?.sha256 ?? null)) add('check-artifact-mismatch', { path: at });
  }
  return done();
}
