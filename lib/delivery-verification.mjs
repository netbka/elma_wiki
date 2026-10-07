import crypto from 'node:crypto';

// A byte-level contract, NOT an ELMA semantic or runtime compatibility claim.
// Any future normalization requires its own versioned, tested policy.
export const READ_BACK_POLICY = 'exact-solution-inventory-v1';
const sha256 = /^[0-9a-f]{64}$/;
const invalid = () => {
  throw Object.assign(new Error('Invalid read-back inventory: expected unique relative file paths and SHA-256 hashes'), { statusCode: 502 });
};

/** Validate before comparison/hashing; never normalize away an unknown difference. */
export function canonicalInventory(inventory) {
  if (!Array.isArray(inventory) || inventory.length > 25000) invalid();
  const seen = new Set();
  const rows = [];
  for (const row of inventory) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) invalid();
    const name = row.path;
    if (typeof name !== 'string' || !name || name.length > 4096 ||
        /[\\\x00-\x1f\x7f]/.test(name) || /^[A-Za-z]:/.test(name) ||
        name.split('/').some(part => !part || part === '.' || part === '..') ||
        typeof row.sha256 !== 'string' || !sha256.test(row.sha256) || seen.has(name)) invalid();
    seen.add(name);
    rows.push({ path: name, sha256: row.sha256 });
  }
  // Code-point order is stable across platforms/locales and does not mutate inputs.
  return rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export function inventoryHash(inventory) {
  const rows = canonicalInventory(inventory).map(row => [row.path, row.sha256]);
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

/** Compare the complete declared solution scope, including package/manifest files. */
export function compareReadBack(expected, actual) {
  const wanted = canonicalInventory(expected), received = canonicalInventory(actual);
  const present = new Map(received.map(row => [row.path, row.sha256]));
  const wantedPaths = new Set(wanted.map(row => row.path));
  const missing = [], different = [];
  for (const row of wanted) {
    if (!present.has(row.path)) missing.push(row.path);
    else if (present.get(row.path) !== row.sha256) different.push(row.path);
  }
  const unexpected = received.filter(row => !wantedPaths.has(row.path)).map(row => row.path);
  return {
    policy: READ_BACK_POLICY,
    match: wanted.length > 0 && !missing.length && !different.length && !unexpected.length,
    compared: wanted.length, missing, different, unexpected,
    // Retained in the evidence shape for older consumers; nothing is ignored.
    volatile: []
  };
}
