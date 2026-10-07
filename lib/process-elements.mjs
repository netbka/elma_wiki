import crypto from 'node:crypto';
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const escape = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');
const index = rows => new Map((rows || []).map(row => [row.id, row]));
const same = (left, right) => (left?.digest ?? null) === (right?.digest ?? null);

// Native complete process entity definitions only. Array positions/display
// names never establish identity; all remaining source is kept as uncertainty.
export function processElementEvidence(raw, source, metadata, evidence) {
  if (!object(raw.process)) return null;
  const elements = [], ambiguities = [], rest = structuredClone(raw);
  const add = (value, kind, pointer, identity) => {
    if (value === undefined) return false;
    if (!Array.isArray(value) && !object(value)) { ambiguities.push({ pointer, reason: 'unknown-element-collection' }); return false; }
    const rows = Array.isArray(value) ? value.map((row, i) => [String(i), row]) : Object.entries(value);
    if (rows.length > 1000) { ambiguities.push({ pointer, reason: 'element-limit' }); return false; }
    const groups = new Map();
    for (const [key, row] of rows) {
      const code = object(row) && identity(row, Array.isArray(value) ? null : key);
      if (typeof code !== 'string' || !code.trim() || code.length > 512) { ambiguities.push({ pointer: pointer + '/' + escape(key), reason: 'unproven-element-identity' }); continue; }
      const group = groups.get(code) || []; group.push([key, row]); groups.set(code, group);
    }
    for (const [code, group] of groups) {
      if (group.length !== 1) { ambiguities.push({ id: JSON.stringify([kind, code]), pointer, reason: 'duplicate-element-identity' }); continue; }
      const [key, row] = group[0];
      elements.push({ id: JSON.stringify([kind, code]), kind, code, name: typeof row.name === 'string' ? row.name.slice(0, 512) : code,
        ...(kind === 'transition' ? { from: typeof row.source === 'string' ? row.source.slice(0,512) : null, to: typeof row.target === 'string' ? row.target.slice(0,512) : null } : {}),
        digest: digest(row), pointer: source + '#' + pointer + '/' + escape(key) });
    }
    return true;
  };
  for (const [section, kind] of [['items','node'],['transitions','transition'],['lanes','lane']])
    if (add(raw.process[section], kind, '/process/' + section, (row, key) => row.id || key)) delete rest.process[section];
  if (raw.process.items === undefined) ambiguities.push({ pointer: '/process/items', reason: 'unproven-complete-process' });
  if (Array.isArray(raw.context)) { if (add(raw.context, 'variable', '/context', row => row.code)) delete rest.context; }
  else if (object(raw.context) && Array.isArray(raw.context.fields)) { if (add(raw.context.fields, 'variable', '/context/fields', row => row.code)) delete rest.context.fields; }
  else if (raw.context !== undefined) ambiguities.push({ pointer: '/context', reason: 'unknown-context-fields' });
  return { version: 1, elements: elements.sort((a,b) => a.id.localeCompare(b.id)), ambiguities,
    residualDigest: digest({ raw: rest, metadata, evidence: evidence.filter(row => row.role !== 'entity').map(({role,sha256}) => ({role,sha256})) }) };
}

export function classifyVersions(base, working, incoming) {
  const known = !same(base, working), external = !same(base, incoming);
  return same(working, incoming) ? known ? 'known-change-incorporated' : 'unchanged'
    : !external ? 'known-change-retained' : !known ? 'external-change' : 'conflict';
}
export function reviewProcessElements(base, working, incoming, { mode, team, baselineOwner } = {}) {
  if (![base,working,incoming].some(row => row?.structure)) return null;
  const b = index(base?.structure?.elements), w = index(working?.structure?.elements), n = index(incoming?.structure?.elements);
  const owners = index(working?.responsibility?.elements);
  const complete = [base,working,incoming].filter(Boolean).every(row => row.structure && !row.structure.ambiguities.length);
  const rows = [...new Set([...b.keys(),...w.keys(),...n.keys()])].sort().map(id => {
    const before = w.get(id), after = n.get(id), original = b.get(id), owner = owners.get(id);
    const changed = !same(before, after), part = after || before || original;
    return { ...part, classification: mode === 'reconciliation' ? classifyVersions(original,before,after)
      : !changed ? 'unchanged' : !before ? 'element-added' : !after ? 'element-removed' : 'element-modified',
      team: owner ? owner.team : before ? baselineOwner : null, removed: !!before && !after,
      boundaryCrossing: changed && !!original && !same(original, after),
      conflict: mode === 'reconciliation' ? classifyVersions(original,before,after) === 'conflict'
        : changed && !!owner?.interventionId && owner.team !== team,
      beforeDigest: before?.digest ?? null, afterDigest: after?.digest ?? null };
  });
  return { rows, complete, baselineTeam: working?.responsibility?.baselineTeam || baselineOwner,
    residualChanged: !!working && !!incoming && working.structure?.residualDigest !== incoming.structure?.residualDigest,
    ambiguities: [base,working,incoming].flatMap(row => row?.structure?.ambiguities || []) };
}

export function processResponsibility(component, owner, { previous, baseline, baselineResponsibility, team = owner, artifactId, full = false } = {}) {
  if (!component.structure) return null;
  const incoming = index(component.structure.elements), before = index(previous?.structure?.elements), base = index(baseline?.structure?.elements);
  const priorOwners = index(previous?.responsibility?.elements), baselineOwners = index(baselineResponsibility?.elements);
  const unknown = !!previous && !previous.structure || !!baseline && !baseline.structure;
  const elements = [...incoming.values()].map(part => {
    let attribution;
    if (same(before.get(part.id), part) && priorOwners.has(part.id) && (!full || priorOwners.get(part.id).interventionId)) attribution = priorOwners.get(part.id);
    else if (!full && same(base.get(part.id), part)) attribution = baselineOwners.get(part.id) || { team: owner, interventionId: null };
    else attribution = { team: unknown ? null : team, interventionId: !full && artifactId || null };
    return { ...part, team: attribution.team, interventionId: attribution.interventionId };
  });
  const removed = full ? [] : [...(previous?.responsibility?.removed || []), ...[...before.values()].filter(part => !incoming.has(part.id))
    .map(part => ({ ...part, team: unknown ? null : team, interventionId: artifactId, removed: true }))]
    .filter((part,i,all) => !incoming.has(part.id) && all.findLastIndex(row => row.id === part.id) === i);
  return { baselineTeam: baseline ? owner : previous?.responsibility?.baselineTeam || team,
    status: unknown ? 'unknown' : component.structure.ambiguities.length ? 'partial' : 'known', elements, removed };
}
