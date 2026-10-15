import crypto from 'node:crypto';
import fs from 'node:fs';
import { schemaValidator, e1HygieneErrors } from './native-materialization-e1.mjs';

// Wiki consumer of the netbka/elma365 #60 sibling contracts `elma365-native-coverage@1`
// (P4/MR-04) and `elma365-dependency-receipt@1` (P5/MR-05). The schemas and the
// generated capability catalog are vendored byte for byte and checked by digest, so a
// silent edit fails every validation closed (as E1_SCHEMA_INTACT). The semantic rules
// the schemas cannot express are ported from elma365 tools/native-materialization
// coverage.mjs and receipt.mjs at NATIVE_CONTRACT_SOURCE.revision. Pure: no IO beyond
// reading the vendored files at load, no native tool, server or provider call.
//
// Re-vendoring is one step: copy the three files from the new elma365 revision, then
// update NATIVE_CONTRACT_SOURCE and the VENDORED rows (schemaRevision, sha256,
// catalogDigest) together. Every consumer reads the pins from here.

// Schema revision 1.1 of both contracts and the catalog are pinned to the merge commit of
// netbka/elma365 PR #103 (1.0 was an unmerged PR head and is never vendored).
export const NATIVE_CONTRACT_SOURCE = Object.freeze({ repository: 'netbka/elma365', pullRequest: 103, issue: 60, merged: true,
  revision: 'c202d6980e4bfaacf449a6b3b829b8c6580287a7' });
const VENDORED = Object.freeze({
  coverage: Object.freeze({ id: 'elma365-native-coverage', version: 1, file: 'elma365-native-coverage-1.schema.json',
    path: 'tools/native-materialization/coverage.schema.json', schemaRevision: '1.1',
    sha256: '924ab59b40ebfc6fa5474148170415233193546bd79c888c212dac61a719f54d' }),
  receipt: Object.freeze({ id: 'elma365-dependency-receipt', version: 1, file: 'elma365-dependency-receipt-1.schema.json',
    path: 'tools/native-materialization/receipt.schema.json', schemaRevision: '1.1',
    sha256: '788efb1e1b9eafb475c25b131d1d0ef0bbecd49c3360d117166cfd6adff89e19' }),
  // The generated catalog moves with the evidence table: pinned to the merge commit of
  // netbka/elma365 PR #109 (appViews kind `appView` replaces the invented `collection`, synthetic-fixture basis;
  // other capabilities unchanged; schemas byte-identical).
  catalog: Object.freeze({ file: 'elma365-native-coverage-1.capabilities.json', path: 'tools/native-materialization/coverage.capabilities.json',
    pullRequest: 109, revision: 'fdab897b1d82139c5b6c6aa5363836f1c30e62f0',
    sha256: '8bfc9a11c94287eff5a6f4ef82daa1594ded4b7d42304958fd4b62e9cd5c585b',
    catalogDigest: '60048542c76aaa748b4c0f5e1e8a888a497cf17ab337e7cb10a6a2364467b58c' })
});

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const nonempty = value => typeof value === 'string' && value.length > 0;
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const result = errors => {
  const unique = new Map(errors.map(row => [canonical(row), row]));
  const rows = [...unique.values()].sort((a, b) => compare(canonical(a), canonical(b)));
  return Object.freeze({ valid: !rows.length, errors: Object.freeze(rows) });
};

// Digests are over the published LF bytes, independent of checkout line endings.
function load(row) {
  try {
    const text = fs.readFileSync(new URL('./contracts/' + row.file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    return { text, json: freeze(JSON.parse(text)) };
  } catch { return { text: '', json: null }; }
}
const coverageFile = load(VENDORED.coverage), receiptFile = load(VENDORED.receipt), catalogFile = load(VENDORED.catalog);
const intact = (file, row) => !!file.json && sha256(file.text) === row.sha256 && file.json.$defs?.schemaRevision?.const === row.schemaRevision;
export const COVERAGE_SCHEMA = coverageFile.json;
export const RECEIPT_SCHEMA = receiptFile.json;
export const COVERAGE_SCHEMA_INTACT = intact(coverageFile, VENDORED.coverage);
export const RECEIPT_SCHEMA_INTACT = intact(receiptFile, VENDORED.receipt);

const record = (row, isIntact) => Object.freeze({ id: row.id, version: row.version, repository: NATIVE_CONTRACT_SOURCE.repository,
  pullRequest: NATIVE_CONTRACT_SOURCE.pullRequest, merged: NATIVE_CONTRACT_SOURCE.merged, revision: NATIVE_CONTRACT_SOURCE.revision,
  path: row.path, schemaRevision: row.schemaRevision, sha256: row.sha256, intact: isIntact });
export const COVERAGE_SOURCE = record(VENDORED.coverage, COVERAGE_SCHEMA_INTACT);
export const RECEIPT_SOURCE = record(VENDORED.receipt, RECEIPT_SCHEMA_INTACT);
export const COVERAGE_CONTRACT = Object.freeze({ id: VENDORED.coverage.id, version: VENDORED.coverage.version });
export const RECEIPT_CONTRACT = Object.freeze({ id: VENDORED.receipt.id, version: VENDORED.receipt.version });
/** The provenance, expiry and compatibility semantics the receipt schema declares. */
export const RECEIPT_SEMANTICS = Object.freeze({ ...(RECEIPT_SCHEMA?.$defs?.semantics?.const ?? {}) });
/** The worker's read-only observation job a report must name as its provenance. */
export const OBSERVATION_JOB = Object.freeze({ job: 'target-profile-observation', mode: 'read-only', transport: 'elma-dev-bridge' });
/** Expiry semantics: expiresAt is at most one day after verifiedAt. */
export const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const coverageSchema = COVERAGE_SCHEMA ? schemaValidator(COVERAGE_SCHEMA) : null;
const receiptSchema = RECEIPT_SCHEMA ? schemaValidator(RECEIPT_SCHEMA) : null;
const drift = row => [{ reason: 'contract-schema-drift', path: row.path }];
const validateCoverageDef = (name, value) => COVERAGE_SCHEMA_INTACT ? coverageSchema(name, value) : drift(VENDORED.coverage);
const validateReceiptDef = (name, value) => RECEIPT_SCHEMA_INTACT ? receiptSchema(name, value) : drift(VENDORED.receipt);

// ---------------------------------------------------------------------------
// P4 elma365-native-coverage@1 (ported from coverage.mjs)

/** sha256(canonical(catalog without catalogDigest)). */
export const catalogDigest = catalog => {
  const { catalogDigest: ignored, ...rest } = catalog;
  return sha256(canonical(rest));
};

/** Structural and claim checks (elma365 validateCapabilityCatalog with derive: false).
 * Wiki cannot re-derive the catalog from the elma365 evidence table, so it pins the
 * published file digest and catalogDigest instead. */
export function validateCapabilityCatalog(catalog) {
  const errors = [...validateCoverageDef('capabilityCatalog', catalog), ...e1HygieneErrors(catalog)];
  if (errors.length) return result(errors);
  const add = (reason, details = {}) => errors.push({ reason, ...details });
  if (catalog.catalogDigest !== catalogDigest(catalog)) add('catalog-digest-mismatch');
  const seen = new Set();
  for (const row of catalog.capabilities) {
    const id = canonical([row.service, row.kind]), at = { service: row.service, kind: row.kind };
    if (seen.has(id)) add('duplicate-capability', at);
    seen.add(id);
    if (new Set(row.serializers.map(s => s.id)).size !== row.serializers.length) add('duplicate-serializer', at);
    if (new Set(row.edit.operations.map(o => o.op)).size !== row.edit.operations.length) add('duplicate-operation', at);
    // Evidence basis: proven claims name a basis, unproven ones none; a real-export basis needs the run's task record.
    const realRun = evidence => evidence.some(e => e.kind === 'task-record');
    if ((row.preserve.status === 'proven-offline') !== (row.preserve.basis !== 'none')) add('basis-status-mismatch', { ...at, aspect: 'preserve' });
    if (row.edit.operations.some(o => o.basis === 'none')) add('basis-status-mismatch', { ...at, aspect: 'edit' });
    if ((row.preserve.basis === 'native-real-export' && !realRun(row.preserve.evidence))
      || (row.edit.operations.some(o => o.basis === 'native-real-export') && !realRun(row.edit.evidence))) add('real-export-without-run-record', at);
    // A proven claim needs evidence; preservation is proven only when every serializer is.
    if (row.preserve.status === 'proven-offline' && (!row.preserve.evidence.length || row.serializers.some(s => s.preserve !== 'proven-offline' || !s.evidence.length)))
      add('unproven-preserve-claim', at);
    if (row.edit.status === 'proven-offline' && (row.preserve.status !== 'proven-offline' || !row.edit.operations.length || !row.edit.evidence.length))
      add('unproven-edit-claim', at);
    if (row.edit.status !== 'proven-offline' && row.edit.operations.length) add('operations-without-proof', at);
    if (row.edit.status === 'unsupported' && !row.edit.evidence.length) add('unsupported-without-evidence', at);
  }
  return result(errors);
}

// The vendored catalog is usable only when intact and valid against the intact schema.
const catalogValid = !!catalogFile.json && sha256(catalogFile.text) === VENDORED.catalog.sha256 && catalogFile.json.catalogDigest === VENDORED.catalog.catalogDigest
  && validateCapabilityCatalog(catalogFile.json).valid;
export const CAPABILITY_CATALOG = catalogValid ? catalogFile.json : null;
export const CAPABILITY_CATALOG_SOURCE = Object.freeze({ repository: NATIVE_CONTRACT_SOURCE.repository, pullRequest: VENDORED.catalog.pullRequest, revision: VENDORED.catalog.revision,
  path: VENDORED.catalog.path, sha256: VENDORED.catalog.sha256, catalogDigest: VENDORED.catalog.catalogDigest, intact: catalogValid });

const capabilityFor = (catalog, service, kind) => catalog.capabilities.find(row => row.service === service && row.kind === kind) ?? null;

/** Why a component cannot be declared supported, or null. `op` is the E1 operation
 * when the release changes the component, else undefined (preserve only). */
export function memberProblem(catalog, { service, kind }, op) {
  const row = capabilityFor(catalog, service, kind);
  if (!row) return 'unknown-capability';
  if (row.preserve.status !== 'proven-offline') return 'preserve-unproven';
  if (op === undefined) return null;
  if (row.edit.status === 'unsupported') return 'edit-unsupported';
  if (row.edit.status !== 'proven-offline') return 'edit-unproven';
  return row.edit.operations.some(o => o.op === op) ? null : 'operation-unproven';
}

/** Evidence basis of a supported component: synthetic-fixture when its preservation or
 * its changed operation is proven on the synthetic fixture only. Never native evidence. */
export function memberBasis(catalog, { service, kind }, op) {
  const row = capabilityFor(catalog, service, kind);
  const bases = [row.preserve.basis, ...(op === undefined ? [] : [row.edit.operations.find(o => o.op === op).basis])];
  return bases.includes('synthetic-fixture') ? 'synthetic-fixture' : 'native-real-export';
}
const combine = bases => !bases.length ? 'none' : bases.includes('synthetic-fixture') ? 'synthetic-fixture' : 'native-real-export';

/** Normalized change rows {solution, key, op, digest}: digest of the resulting component, null for remove. */
const normalizeChanges = changes => changes.map(row => ({ solution: row.solution, key: row.key, op: row.op, digest: row.op === 'remove' ? null : row.digest ?? null }))
  .sort((a, b) => compare(canonical([a.solution, a.key]), canonical([b.solution, b.key])));
/** Binds a declaration to the exact release changes it was derived for (elma365 changesDigest). */
export const changesDigest = changes => sha256(canonical(normalizeChanges(changes)));
/** Change rows of a Wiki materialization request (bare or E1 envelope), as elma365 changesFromRequest. */
export function changesFromRequest(request) {
  const wiki = request?.contract ? request.request : request;
  return (wiki?.operations ?? []).map(row => ({ solution: wiki.inputs.solution, key: row.key, service: row.service, op: row.op,
    digest: row.op === 'remove' ? null : row.digest }));
}

const memberId = row => canonical([row.solution, row.key]);

/** The classification elma365 declareCoverage derives for these captures and changes.
 * Wiki uses it only to reject a declaration that claims more (or other) support. */
export function deriveCoverageDeclaration({ catalog, captures = [], changes = [], targetProfileDigest, nativeRevision, evidenceRef, targetReport = null,
  adapter = 'elma365-native-coverage' } = {}) {
  const checked = validateCapabilityCatalog(catalog);
  if (!checked.valid) throw new Error('Invalid capability catalog: ' + checked.errors.map(row => row.reason).join(', '));
  if (!Array.isArray(captures) || !captures.length || !Array.isArray(changes)) throw new Error('Captures (non-empty) and changes must be arrays');
  const solutions = captures.map(row => row?.solution);
  if (solutions.some(code => !nonempty(code)) || new Set(solutions).size !== solutions.length) throw new Error('Exactly one capture per Solution is required');
  const changeOf = new Map();
  for (const row of changes) {
    if (!solutions.includes(row?.solution) || !nonempty(row?.key) || !['replace', 'add', 'remove'].includes(row?.op)) throw new Error('Invalid change row');
    if (changeOf.has(memberId(row))) throw new Error('Duplicate change row');
    if (row.op !== 'remove' && !/^[0-9a-f]{64}$/.test(row.digest ?? '')) throw new Error('A non-remove change needs the resulting component digest');
    changeOf.set(memberId(row), row);
  }
  const observed = targetReport?.status === 'observed' && targetReport.targetProfileDigest === targetProfileDigest ? targetReport : null;
  const units = captures.map(capture => {
    const members = [], unsupportedMembers = [], present = new Set(), bases = [];
    for (const component of capture.components ?? []) {
      const id = memberId({ solution: capture.solution, key: component.key });
      present.add(id);
      const change = changeOf.get(id);
      if (change?.op === 'remove') throw new Error('A removed component cannot be present in its capture');
      if (change && change.digest !== component.digest) throw new Error('A change digest differs from its captured component');
      const problem = memberProblem(catalog, component, change?.op);
      if (problem) unsupportedMembers.push({ solution: capture.solution, key: component.key, digest: component.digest,
        service: component.service ?? null, kind: component.kind ?? null, reason: problem });
      else {
        const evidenceBasis = memberBasis(catalog, component, change?.op);
        bases.push(evidenceBasis);
        members.push({ solution: capture.solution, key: component.key, digest: component.digest, evidenceBasis });
      }
    }
    for (const change of changes.filter(row => row.solution === capture.solution && !present.has(memberId(row)))) {
      if (change.op !== 'remove') throw new Error('A changed component is missing from its capture');
      const problem = memberProblem(catalog, change, 'remove');
      if (problem) unsupportedMembers.push({ solution: capture.solution, key: change.key, digest: null, service: change.service ?? null,
        kind: change.kind ?? null, reason: problem });
      else bases.push(memberBasis(catalog, change, 'remove'));
    }
    const byKey = (a, b) => compare(a.key, b.key);
    const unit = { id: 'package:' + capture.solution, status: unsupportedMembers.length ? 'unsupported' : 'supported',
      evidenceRef: 'elma365-native-coverage@1/catalog/' + catalog.catalogDigest, evidenceBasis: combine(bases), members: members.sort(byKey),
      unsupportedMembers: unsupportedMembers.sort(byKey), receipt: null };
    if (observed) unit.targetPrecondition = { mode: observed.installedSolutions.some(row => row.code === capture.solution) ? 'existing-target' : 'empty-target',
      evidenceRef: observed.evidenceRef, targetProfileDigest };
    return unit;
  }).sort((a, b) => compare(a.id, b.id));
  const unitBases = units.map(unit => unit.evidenceBasis).filter(basis => basis !== 'none');
  return { contract: { ...COVERAGE_CONTRACT }, nativeRevision, adapter, evidenceRef, targetProfileDigest, catalogDigest: catalog.catalogDigest,
    changesDigest: changesDigest(changes), evidenceBasis: combine(unitBases),
    captures: captures.map(row => ({ solution: row.solution, artifactChecksum: row.checksum })).sort((a, b) => compare(a.solution, b.solution)),
    units, applications: [], parts: [], server: null, publicationReady: false, executionEnabled: false };
}

/** Validates a coverage declaration ($defs/coverageDeclaration, hygiene and the
 * semantic rules of elma365 validateCoverageDeclaration). With `catalog` it must name
 * that catalog; with `captures` (Wiki records) it must bind exactly those checksums and
 * cover every captured component once at its digest; with both, its units must equal
 * the derived classification (`capability-mismatch` rejects over-claiming). */
export function validateNativeCoverageDeclaration(declaration, { catalog = null, captures = null, changes = null } = {}) {
  const errors = [...validateCoverageDef('coverageDeclaration', declaration), ...e1HygieneErrors(declaration)];
  if (errors.length) return result(errors);
  const add = (reason, details = {}) => errors.push({ reason, ...details });
  const solutions = declaration.captures.map(row => row.solution);
  if (new Set(solutions).size !== solutions.length) add('duplicate-capture');
  const units = new Set(), members = new Map();
  for (const unit of declaration.units) {
    if (units.has(unit.id)) add('duplicate-unit', { unitId: unit.id });
    units.add(unit.id);
    if ((unit.status === 'supported') !== (unit.unsupportedMembers.length === 0)) add('unit-status-mismatch', { unitId: unit.id });
    for (const row of [...unit.members, ...unit.unsupportedMembers]) {
      if (!solutions.includes(row.solution)) add('unbound-unit-member', { unitId: unit.id, key: row.key });
      if (members.has(memberId(row))) add('duplicate-unit-member', { key: row.key });
      members.set(memberId(row), row);
    }
    if (unit.targetPrecondition && unit.targetPrecondition.targetProfileDigest !== declaration.targetProfileDigest) add('stale-target-precondition', { unitId: unit.id });
  }
  if (catalog && declaration.catalogDigest !== catalog.catalogDigest) add('stale-capability-catalog');
  // The consumer supplies the changes of its own request; the declaration must have been derived for exactly them.
  if (changes !== null && (!Array.isArray(changes) || declaration.changesDigest !== changesDigest(changes))) add('stale-changes-binding');
  const unitBases = declaration.units.map(unit => unit.evidenceBasis).filter(basis => basis !== 'none');
  for (const unit of declaration.units) {
    const memberBases = unit.members.map(row => row.evidenceBasis);
    if (memberBases.includes('synthetic-fixture') && unit.evidenceBasis !== 'synthetic-fixture') add('evidence-basis-mismatch', { unitId: unit.id });
    if (unit.evidenceBasis === 'none' && memberBases.length) add('evidence-basis-mismatch', { unitId: unit.id });
  }
  if (declaration.evidenceBasis !== combine(unitBases)) add('evidence-basis-mismatch');
  if (captures) {
    const bound = new Map(declaration.captures.map(row => [row.solution, row.artifactChecksum]));
    if (!Array.isArray(captures) || captures.length !== bound.size || captures.some(row => bound.get(row?.solution) !== row?.checksum)) add('stale-capture-binding');
    const captured = new Set();
    for (const capture of Array.isArray(captures) ? captures : []) for (const component of capture?.components ?? []) {
      const id = memberId({ solution: capture.solution, key: component.key });
      captured.add(id);
      const row = members.get(id);
      if (!row) add('uncovered-component', { key: component.key });
      else if (row.digest !== component.digest) add('stale-member-digest', { key: component.key });
    }
    for (const [id, row] of members) if (!captured.has(id) && row.digest !== null) add('unknown-unit-member', { key: row.key });
    if (catalog && changes !== null && !errors.length) {
      // Re-derive the classification; a declaration may not claim more (or other) support.
      let expected = null;
      try {
        expected = deriveCoverageDeclaration({ catalog, captures, changes, targetProfileDigest: declaration.targetProfileDigest,
          nativeRevision: declaration.nativeRevision, evidenceRef: declaration.evidenceRef, adapter: declaration.adapter });
      } catch { add('underivable-declaration'); }
      const strip = rows => rows.map(({ targetPrecondition, ...unit }) => unit);
      if (expected && (canonical(strip(expected.units)) !== canonical(strip(declaration.units)) || expected.evidenceBasis !== declaration.evidenceBasis))
        add('capability-mismatch');
    }
  }
  return result(errors);
}

// ---------------------------------------------------------------------------
// P5 elma365-dependency-receipt@1 (ported from receipt.mjs)

const refKey = row => canonical([row.service, row.namespace, row.code]);
const byCode = (a, b) => compare(a.code, b.code);
// Wiki's receipt shape names `distribution.authorization` (an owner grant status and
// evidence reference, strictly typed by the schema); only that key is exempt from the
// secret-like key rule. Its values are still scanned.
const hygiene = value => e1HygieneErrors(value).filter(row => !(row.reason === 'secret-like-field' && /\/distribution\/authorization$/.test(row.path)));
const proven = row => row?.status === 'verified' && typeof row.evidenceRef === 'string' && row.evidenceRef.length > 0;
const covers = (namespaces, namespace) => namespaces.some(row => namespace === row || namespace.startsWith(row + '.'));

/** sha256(canonical(installed solutions sorted by code)). */
export const inventoryDigest = installed => sha256(canonical([...installed].sort(byCode)));
/** Deterministic receipt id over what the receipt asserts. */
export const receiptId = ({ targetProfileDigest, kind, provider, provides }) =>
  'dr-' + sha256(canonical({ targetProfileDigest, kind, provider, provides: [...provides].sort((a, b) => compare(refKey(a), refKey(b))) })).slice(0, 32);

function receiptErrors(receipt, path, report, add) {
  const at = { path, receiptId: receipt.id };
  if (receipt.id !== receiptId(receipt)) add('receipt-id-mismatch', at);
  if (new Set(receipt.provides.map(refKey)).size !== receipt.provides.length) add('duplicate-provided-reference', at);
  const verifiedAt = time(receipt.verifiedAt), expiresAt = time(receipt.expiresAt);
  if (expiresAt <= verifiedAt) add('expiry-before-verification', at);
  else if (expiresAt - verifiedAt > RECEIPT_MAX_AGE_MS) add('expiry-exceeds-max-age', at);
  if (receipt.kind === 'licensed-preinstallation' ? 'distribution' in receipt || !('activation' in receipt) : 'activation' in receipt || !('distribution' in receipt))
    add('kind-field-mismatch', at);
  if (receipt.status === 'verified') {
    const missing = [];
    if (!proven(receipt.entitlement)) missing.push('entitlement');
    if (receipt.compatibility.status !== 'compatible' || !receipt.compatibility.evidenceRef) missing.push('compatibility');
    if (!Array.isArray(receipt.requiredBindings)) missing.push('required-bindings');
    if (receipt.kind === 'licensed-preinstallation' && !proven(receipt.activation)) missing.push('activation');
    if (receipt.kind === 'official-distribution') {
      const dist = receipt.distribution;
      if (dist?.official !== true || dist?.intact !== true) missing.push('distribution-integrity');
      if (dist?.authorization?.status !== 'authorized' || !dist.authorization.evidenceRef) missing.push('distribution-authorization');
    }
    if (missing.length) add('unproven-verified-receipt', { ...at, missing });
  }
  if (!report) return;
  if (receipt.targetProfileDigest !== report.targetProfileDigest || receipt.targetId !== report.targetId || receipt.environment !== report.environment)
    add('receipt-profile-mismatch', at);
  if (receipt.compatibility.platformVersion !== report.platformVersion) add('receipt-platform-mismatch', at);
  if (receipt.verifiedAt !== report.observedAt || receipt.provenance.evidenceRef !== report.evidenceRef) add('receipt-not-observed', at);
  // A report's receipt restates its observation; it may not claim more than was observed.
  const installed = report.installedSolutions.find(row => row.code === receipt.provider.code);
  if (receipt.kind !== 'licensed-preinstallation' || !installed || installed.version !== receipt.provider.version
    || receipt.provides.some(row => !covers(installed.namespaces, row.namespace))) add('receipt-not-observed', at);
  else if (canonical(receipt.entitlement) !== canonical(installed.entitlement) || canonical(receipt.activation) !== canonical(installed.activation)
    || receipt.compatibility.status !== installed.compatibility.status || receipt.compatibility.evidenceRef !== installed.compatibility.evidenceRef
    || canonical(receipt.requiredBindings) !== canonical(installed.requiredBindings)) add('receipt-not-observed', at);
}

/** Validates one dependency receipt; with `report`, it must restate that observation. */
export function validateDependencyReceipt(receipt, { report = null } = {}) {
  const errors = [...validateReceiptDef('dependencyReceipt', receipt), ...hygiene(receipt)];
  if (!errors.length) receiptErrors(receipt, '', report, (reason, details) => errors.push({ reason, ...details }));
  return result(errors);
}

export function validateTargetProfileReport(report) {
  const errors = [...validateReceiptDef('targetProfileReport', report), ...hygiene(report)];
  if (errors.length) return result(errors);
  const add = (reason, details = {}) => errors.push({ reason, ...details });
  if (report.status === 'unavailable') {
    if (!report.unavailable || report.installedSolutions.length || report.receipts.length || report.inventoryDigest !== null || report.changedAt !== null
      || report.platformVersion !== null || report.observation !== null) add('unavailable-report-carries-observation');
    return result(errors);
  }
  if (report.observation === null) add('unattested-observation');
  if (report.unavailable !== null || report.targetProfileDigest === null || report.platformVersion === null || report.changedAt === null
    || report.inventoryDigest === null || !report.evidenceRef) add('incomplete-observed-report');
  else {
    if (report.inventoryDigest !== inventoryDigest(report.installedSolutions)) add('inventory-digest-mismatch');
    if (time(report.changedAt) > time(report.observedAt)) add('changed-after-observation');
  }
  const codes = report.installedSolutions.map(row => row.code);
  if (new Set(codes).size !== codes.length) add('duplicate-installed-solution');
  for (const row of report.installedSolutions) for (const field of ['entitlement', 'activation'])
    if (row[field].status === 'verified' && !row[field].evidenceRef) add('verified-without-evidence', { code: row.code, field });
  for (const row of report.installedSolutions)
    if (row.compatibility.status !== 'unknown' && !row.compatibility.evidenceRef) add('verified-without-evidence', { code: row.code, field: 'compatibility' });
  if (new Set(report.receipts.map(row => row.id)).size !== report.receipts.length) add('duplicate-receipt');
  report.receipts.forEach((receipt, index) => receiptErrors(receipt, '/receipts/' + index, report, add));
  return result(errors);
}

/** Wiki targetProfile ({targetId, environment, digest, platformVersion, changedAt}) of a
 * schema-valid observed report, else null. Wiki takes a native Target profile only from here. */
export function wikiTargetProfile(report) {
  if (report?.status !== 'observed' || !validateTargetProfileReport(report).valid) return null;
  return { targetId: report.targetId, environment: report.environment, digest: report.targetProfileDigest, platformVersion: report.platformVersion,
    changedAt: report.changedAt };
}
