import fs from 'node:fs';
import path from 'node:path';

// DEV2 candidate designations kept in a private operator record (#94, PLAN-01 P8).
// The legacy mode reads WIKI_TARGET_DEV2_DEPLOY_CANDIDATES once at startup, so every
// change restarts Wiki and ends every session. After the operator explicitly adopts
// WIKI_TARGET_DEV2_DESIGNATIONS=file through prod:update, the server re-reads this record
// at every check instead. Only deploy/prod-update.py writes it, as root, under the
// rollout lock; Wiki only reads it and exposes no route that changes it.
//
// The record is fixed: <data root>/operator/dev2-designations.json. A missing, unsafe,
// unreadable, malformed or stale record designates nothing (fail closed) and never
// falls back to the startup variable.
export const DESIGNATION_MODE_KEY = 'WIKI_TARGET_DEV2_DESIGNATIONS';
export const DESIGNATION_SCHEMA = 'wiki-dev2-designations';
export const DESIGNATION_VERSION = 1;
export const MAX_DESIGNATIONS = 32;
export const MAX_RECORD_BYTES = 8192;
export const designationDirectory = directory => path.join(directory, 'operator');
export const designationFile = directory => path.join(designationDirectory(directory), 'dev2-designations.json');

const sha256 = /^[0-9a-f]{64}$/;
const keys = ['candidates', 'revision', 'schema', 'version'];
// Fixed reasons only: never a path, value or system error text.
export const designationReasons = Object.freeze({
  missing: 'запись назначений отсутствует',
  unsafe: 'запись назначений небезопасна (ссылка, не файл или выход за каталог данных)',
  unreadable: 'запись назначений не читается',
  invalid: 'запись назначений не соответствует схеме',
  stale: 'запись назначений старше уже прочитанной'
});

// Strict versioned schema; candidates are unique, lowercase and sorted, so one set has one encoding.
export function parseDesignations(text) {
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Object.keys(value).sort().join() !== keys.join()) return null;
  if (value.schema !== DESIGNATION_SCHEMA || value.version !== DESIGNATION_VERSION) return null;
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) return null;
  const { candidates } = value;
  if (!Array.isArray(candidates) || candidates.length > MAX_DESIGNATIONS) return null;
  if (!candidates.every((item, index) => typeof item === 'string' && sha256.test(item) && (index === 0 || candidates[index - 1] < item))) return null;
  return { revision: value.revision, candidates: [...candidates] };
}

// One reader per data root. `highest` makes an older revision than one this process
// already read (a restored backup, a rolled-back file) count as stale, so a withdrawn
// digest cannot come back without a new operator update.
export function designationReader(directory) {
  const root = path.resolve(directory), folder = designationDirectory(root), file = designationFile(root);
  let highest = 0;
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  return function read() {
    const refuse = reason => ({ ok: false, reason });
    let descriptor;
    try {
      const dir = fs.lstatSync(folder, { throwIfNoEntry: false });
      if (!dir) return refuse('missing');
      if (dir.isSymbolicLink() || !dir.isDirectory()) return refuse('unsafe');
      const entry = fs.lstatSync(file, { throwIfNoEntry: false });
      if (!entry) return refuse('missing');
      if (entry.isSymbolicLink() || !entry.isFile()) return refuse('unsafe');
      if (fs.realpathSync(file) !== path.join(fs.realpathSync(root), 'operator', 'dev2-designations.json')) return refuse('unsafe');
      descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
      const opened = fs.fstatSync(descriptor);
      // The opened file must be the one inspected, not a replacement swapped in between.
      if (!opened.isFile() || opened.ino !== entry.ino || opened.dev !== entry.dev) return refuse('unsafe');
      if (opened.size > MAX_RECORD_BYTES) return refuse('invalid');
      const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
      const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
      if (length > MAX_RECORD_BYTES) return refuse('invalid');
      const record = parseDesignations(buffer.subarray(0, length).toString('utf8'));
      if (!record) return refuse('invalid');
      if (record.revision < highest) return refuse('stale');
      highest = record.revision;
      return { ok: true, ...record };
    } catch (error) {
      return refuse(error?.code === 'ELOOP' ? 'unsafe' : 'unreadable');
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  };
}

// The DEV2 preset with its current designations. A legacy preset is returned unchanged;
// a file-mode preset designates exactly what the record holds now, or nothing.
export function withCurrentDesignations(preset, read) {
  if (preset?.designationMode !== 'file') return preset;
  const current = read();
  if (!current.ok) return { ...preset, designatedCandidates: [], designationRevision: null, designationError: designationReasons[current.reason] };
  return { ...preset, designatedCandidates: current.candidates, designationRevision: current.revision, designationError: null };
}
