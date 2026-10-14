import crypto from 'node:crypto';
import { canonicalInventory } from './delivery-verification.mjs';

// Owner-approved (2026-10-14, #37) expected-outcome rules for `elma365pm import --version-up`.
// Opt-in only: exact-solution-inventory-v1 stays the default read-back policy.
// A byte/JSON contract, NOT an ELMA semantic or runtime compatibility claim.
export const IMPORT_NORMALIZED_POLICY = 'import-normalized-v1';
const DEPENDENCY_CATEGORIES = ['dependencies', 'internalDependencies', 'optionalDependencies', 'sysDependencies'];
// A rewritten dependency record must keep what it depends on; only its other metadata may change.
const DEPENDENCY_IDENTITY = ['code', 'namespace', 'service'];
const DEPENDENCY_REFERENCES = ['dependsOn', 'data', 'entity'];

const invalid = () => {
  throw Object.assign(new Error('Invalid read-back content: expected the bytes of every differing package/manifest file'), { statusCode: 502 });
};
const pointer = parts => parts.map(part => '/' + String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('');
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const eligible = name => name === 'package.json' || /^[^/]+\/manifest\.json$/.test(name);

/** Value equality of parsed JSON: array order counts, object key order and whitespace do not. */
function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => same(item, b[i]));
  if (!plain(a) || !plain(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && same(a[key], b[key]));
}

/** Leaf pointers where two JSON values differ; used only to report accepted dependency rewrites. */
function differences(a, b, at, out) {
  if (same(a, b)) return out;
  if (plain(a) && plain(b)) {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (!own(a, key) || !own(b, key)) out.push(pointer([...at, key]));
      else differences(a[key], b[key], [...at, key], out);
    }
  } else out.push(pointer(at));
  return out;
}

/**
 * The first place where parsing would lose information that ELMA's decoder can still see: a number
 * literal that does not re-serialize to its own text (unsafe integers, `1.0`, `1e2`, `-0`) or a
 * duplicate object key. `text` is already valid JSON.
 */
function lossy(text) {
  const token = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],]/g, colon = /\s*:/y;
  const open = [];
  for (const { 0: part, index } of text.matchAll(token)) {
    const top = open.at(-1);
    if (part[0] === '"') {
      colon.lastIndex = index + part.length;
      if (!top || !top.expectKey || !colon.test(text)) continue;
      const key = JSON.parse(part);
      if (top.keys.has(key)) return `duplicate key ${part}`;
      top.keys.add(key); top.expectKey = false;
    } else if (part === '{') open.push({ keys: new Set(), expectKey: true });
    else if (part === '[') open.push(null);
    else if (part === '}' || part === ']') open.pop();
    else if (part === ',') { if (top) top.expectKey = true; }
    else if (String(Number(part)) !== part) return `number ${part} does not round-trip`;
  }
  return '';
}

/** Parse fail-closed: `{ reason }` when the bytes are not JSON or parsing would lose a distinction. */
function parse(bytes) {
  const text = Buffer.from(bytes).toString('utf8');
  let value;
  try { value = JSON.parse(text); } catch { return { reason: '/: not valid JSON' }; }
  const loss = lossy(text);
  return loss ? { reason: `/: ${loss}; JSON comparison would not be lossless` } : { value };
}

/**
 * Accept an import's history append: the expected array unchanged as a prefix plus exactly one
 * appended object. Removed, reordered, edited or several appended entries are not accepted.
 */
function history(expected, actual, at, normalized) {
  if (!Array.isArray(expected) || !Array.isArray(actual)) return same(expected, actual) ? '' : `${pointer(at)}: history is not an array in both files`;
  if (same(expected, actual)) return '';
  if (actual.length !== expected.length + 1 || !expected.every((entry, i) => same(entry, actual[i])))
    return `${pointer(at)}: history is not the expected history with one appended entry`;
  if (!plain(actual[expected.length])) return `${pointer(at)}: appended history entry is not an object`;
  normalized.push({ kind: 'appended-history', pointer: pointer([...at, expected.length]) });
  return '';
}

const identity = value => DEPENDENCY_IDENTITY.map(field => value[field]);
// An identity needs at least one present identity field; an all-absent identity binds nothing.
const identified = value => plain(value) && DEPENDENCY_IDENTITY.some(field => typeof value[field] === 'string' && value[field] !== '');

/**
 * A record keeps its identity when its own identity fields are present and equal and every reference
 * keeps what it points at: an identified object reference keeps its identity fields; any other
 * present reference (string, array, number, unidentified object) must stay value-equal.
 */
function identityKept(wanted, got) {
  if (!identified(wanted) || !plain(got) || !same(identity(wanted), identity(got))) return false;
  return DEPENDENCY_REFERENCES.every(key => identified(wanted[key])
    ? plain(got[key]) && same(identity(wanted[key]), identity(got[key]))
    : same(wanted[key], got[key]));
}

/** Accept rewritten metadata inside existing dependency records whose identity and position stay the same. */
function dependencies(expected, actual, at, normalized) {
  if (expected === undefined && actual === undefined) return '';
  if (same(expected, actual)) return '';
  if (!plain(expected) || !plain(actual)) return `${pointer(at)}: dependency category is not an object in both files`;
  const services = Object.keys(expected);
  if (services.length !== Object.keys(actual).length || !services.every(service => own(actual, service))) return `${pointer(at)}: dependency services were added or removed`;
  for (const service of services.sort()) {
    const wanted = expected[service], got = actual[service];
    if (!Array.isArray(wanted) || !Array.isArray(got)) { if (!same(wanted, got)) return `${pointer([...at, service])}: dependency records are not an array in both files`; continue; }
    if (wanted.length !== got.length) return `${pointer([...at, service])}: dependency records were added or removed`;
    for (let i = 0; i < wanted.length; i++) {
      if (same(wanted[i], got[i])) continue;
      if (!identityKept(wanted[i], got[i])) return `${pointer([...at, service, i])}: dependency identity or order changed`;
      for (const changed of differences(wanted[i], got[i], [...at, service, i], [])) normalized.push({ kind: 'rewritten-dependency', pointer: changed });
    }
  }
  return '';
}

/** Compare everything except the named keys exactly. */
function rest(expected, actual, skip, at) {
  const strip = value => Object.fromEntries(Object.entries(value).filter(([key]) => !skip.includes(key)));
  if (same(strip(expected), strip(actual))) return '';
  const changed = differences(strip(expected), strip(actual), at, []);
  return `${changed[0] || pointer(at) || '/'}: field outside the import normalization changed`;
}

function packageFile(expected, actual, normalized) {
  if (!plain(expected) || !plain(actual)) return '/: package.json is not a JSON object in both files';
  const reasons = [rest(expected, actual, ['history', ...DEPENDENCY_CATEGORIES], []), history(expected.history, actual.history, ['history'], normalized)];
  for (const category of DEPENDENCY_CATEGORIES) reasons.push(dependencies(expected[category], actual[category], [category], normalized));
  return reasons.find(Boolean) || '';
}

function manifestFile(expected, actual, normalized) {
  if (!plain(expected) || !plain(actual)) return '/: manifest.json is not a JSON object in both files';
  const reasons = [rest(expected, actual, ['history', 'entities'], []), history(expected.history, actual.history, ['history'], normalized)];
  if (!Array.isArray(expected.entities) || !Array.isArray(actual.entities)) reasons.push(same(expected.entities, actual.entities) ? '' : '/entities: entities are not an array in both files');
  else if (expected.entities.length !== actual.entities.length) reasons.push('/entities: entities were added or removed');
  else expected.entities.forEach((entity, i) => {
    const other = actual.entities[i];
    if (!plain(entity) || !plain(other)) reasons.push(same(entity, other) ? '' : `${pointer(['entities', i])}: entity is not an object in both files`);
    else reasons.push(rest(entity, other, ['history'], ['entities', i]), history(entity.history, other.history, ['entities', i, 'history'], normalized));
  });
  return reasons.find(Boolean) || '';
}

function contentOf(files, name, sha256) {
  const bytes = files instanceof Map ? files.get(name) : undefined;
  if (!(bytes instanceof Uint8Array)) invalid();
  // Bind the supplied bytes to the compared inventory row; never judge other content.
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== sha256) invalid();
  return bytes;
}

/**
 * Same complete two-way inventory comparison as exact-solution-inventory-v1. A differing root
 * package.json or <service>/manifest.json is accepted only when its sole changes are one appended
 * import history entry per history array and, in package.json, rewritten metadata inside existing
 * dependency records. Each accepted change is listed in `normalized`; anything else stays `different`.
 * `expectedFiles`/`actualFiles` map archive paths to bytes and must cover every differing eligible file.
 */
export function compareImportNormalizedReadBack(expected, actual, { expectedFiles, actualFiles } = {}) {
  const wanted = canonicalInventory(expected), received = canonicalInventory(actual);
  const present = new Map(received.map(row => [row.path, row.sha256]));
  const wantedPaths = new Set(wanted.map(row => row.path));
  const missing = [], different = [], normalized = [], rejected = [];
  for (const row of wanted) {
    if (!present.has(row.path)) { missing.push(row.path); continue; }
    if (present.get(row.path) === row.sha256) continue;
    if (!eligible(row.path)) { different.push(row.path); rejected.push({ path: row.path, reason: 'file outside the import normalization changed' }); continue; }
    const before = parse(contentOf(expectedFiles, row.path, row.sha256)), after = parse(contentOf(actualFiles, row.path, present.get(row.path)));
    const accepted = [];
    const reason = before.reason || after.reason || (row.path === 'package.json' ? packageFile : manifestFile)(before.value, after.value, accepted);
    if (reason) { different.push(row.path); rejected.push({ path: row.path, reason }); }
    else if (!accepted.length) { different.push(row.path); rejected.push({ path: row.path, reason: 'bytes changed without a JSON difference' }); }
    else normalized.push(...accepted.map(item => ({ path: row.path, ...item })));
  }
  const unexpected = received.filter(row => !wantedPaths.has(row.path)).map(row => row.path);
  return {
    policy: IMPORT_NORMALIZED_POLICY,
    match: wanted.length > 0 && !missing.length && !different.length && !unexpected.length,
    compared: wanted.length, missing, different, unexpected, normalized, rejected,
    // Kept for the shared evidence shape; nothing is ignored silently.
    volatile: []
  };
}
