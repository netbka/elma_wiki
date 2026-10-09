import crypto from 'node:crypto';
import { parseProject } from './project-parser.mjs';
import { dependencyReport } from './dependency-evidence.mjs';
import { processElementEvidence, classifyVersions, reviewProcessElements, processResponsibility } from './process-elements.mjs';

const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 160) fail(`${label} is required (1–160 characters)`);
  return value.trim();
};
const keyOf = entity => [entity.service, entity.namespace, entity.code].every(part => typeof part === 'string' && part)
  ? JSON.stringify([entity.service, entity.namespace, entity.code]) : null;
const index = components => new Map(components.map(component => [component.key, component]));
const same = (left, right) => (left?.digest ?? null) === (right?.digest ?? null);
const sorted = components => [...components].sort((a, b) => a.key.localeCompare(b.key, 'en'));
const artifactDigest = artifact => hash(canonical(artifact));
const guard = (state, revision) => {
  if (!Number.isInteger(revision) || revision !== state.revision) fail('Workspace revision changed; refresh before accepting', 409);
  if (state.status !== 'active') fail('Reopen the workspace before changing it', 409);
};
const compatible = (state, artifact, scope) => {
  if (artifact.scope !== scope) fail(`An explicit ${scope} artifact is required`);
  if (artifact.solution !== state.solution) fail('Artifact belongs to a different solution', 409);
  if (state.artifacts.some(row => row.id === artifact.id)) fail('Artifact ID already belongs to this workspace', 409);
};
const clear = artifact => {
  if (artifact.ambiguities.some(row => row.reason === 'opaque')) fail('Конфигурация сохранена, но содержимое непрозрачно или зашифровано. Для изменений загрузите читаемый экспорт решения; платные компоненты остаются зависимостями.', 422);
  if (artifact.ambiguities.length) fail('Ambiguous or incomplete component evidence requires review; acceptance is blocked', 422);
};
const baseline = state => index(state.artifacts.find(row => row.id === state.baselineId).components);

// Called with authorized private bytes by a future storage adapter. Scope is an
// explicit caller assertion: neither filename nor package.isAuthor proves it.
export async function parseManagedArtifact(bytes, { id = crypto.randomUUID(), scope, dependencyContext = {} } = {}) {
  if (!['full', 'partial'].includes(scope)) fail('Declare artifact scope as full or partial');
  id = text(id, 'Artifact ID');
  const original = Buffer.from(bytes);
  const parsed = await parseProject(original), { data, report, inventory, files } = parsed;
  const ambiguities = report.diagnostics.filter(row => ['unknown', 'missing', 'malformed', 'opaque'].includes(row.status))
    .map(row => ({ reason: row.status, source: row.path }));
  const grouped = new Map(), used = new Set(['package.json', ...files.keys()].filter(file => file === 'package.json' || /^[^/]+\/manifest\.json$/.test(file)));
  for (const entity of data.entities) {
    const key = keyOf(entity);
    if (!key || entity.coverage !== 'structural') {
      ambiguities.push({ reason: 'unproven-identity', source: entity.archivePath }); continue;
    }
    const rows = grouped.get(key) || []; rows.push(entity); grouped.set(key, rows);
  }
  const components = [];
  for (const [key, rows] of grouped) {
    if (rows.length !== 1) { ambiguities.push({ key, reason: 'duplicate-identity' }); continue; }
    const entity = rows[0];
    const [manifestPath, pointer] = entity.provenance.identity.split('#');
    const record = JSON.parse(files.get(manifestPath).toString('utf8').replace(/^\uFEFF/, '')).entities[Number(pointer.split('/').at(-1))];
    if (record.resources !== undefined && !Array.isArray(record.resources)) {
      ambiguities.push({ key, reason: 'unknown-resource-schema' }); continue;
    }
    // parseProject intentionally drops resources from its sanitized entity
    // projection. Read declared resource evidence from the original manifest.
    const resources = (Array.isArray(record.resources) ? record.resources : [])
      .map(row => entity.service + '/' + String(row?.path || '').replaceAll('\\', '/').replace(/^\/+/, ''));
    const paths = [entity.archivePath,
      ...['client', 'server'].map(side => entity.archivePath + '.' + side + '.ts').filter(file => files.has(file)),
      ...resources];
    const evidence = [...new Set(paths)].map(source => {
      used.add(source);
      const row = inventory.find(row => row.path === source);
      return { role: source === entity.archivePath ? 'entity' : source.startsWith(entity.archivePath + '.')
        ? source.slice(entity.archivePath.length + 1) : source, source, sha256: row?.sha256 ?? null };
    }).sort((a, b) => a.role.localeCompare(b.role, 'en'));
    if (evidence.some(row => row.sha256 === null)) { ambiguities.push({ key, reason: 'missing-component-file' }); continue; }
    // Manifest ordering and display name never establish identity. Include the
    // record's semantic metadata in content evidence, without its array index.
    const { path: ignoredPath, ...metadata } = record;
    used.add(manifestPath);
    const structure = entity.service === 'processor' ? processElementEvidence(JSON.parse(files.get(entity.archivePath).toString('utf8').replace(/^\uFEFF/, '')), entity.archivePath, metadata, evidence) : null;
    components.push({ key, service: entity.service, namespace: entity.namespace, code: entity.code,
      digest: hash(canonical({ metadata, files: evidence.map(({ role, sha256 }) => ({ role, sha256 })) })), evidence,
      ...(structure ? { structure } : {}) });
  }
  if (!data.solution?.code) ambiguities.push({ reason: 'unproven-solution' });
  // Unindexed bytes are preserved as evidence, never silently classified as a
  // known component or converted into a deployable composed archive.
  const unclassifiedFiles = inventory.filter(row => !used.has(row.path));
  for (const row of unclassifiedFiles) ambiguities.push({ reason: 'unclassified-file', source: row.path });
  return freeze({ id, scope, solution: data.solution?.code ?? null, checksum: hash(original), parserVersion: report.parserVersion,
    provenance: data.provenance, components: sorted(components), ambiguities, unclassifiedFiles,
    dependencies: dependencyReport(data.solution?.dependencies, { ...dependencyContext, components: data.entities.map(entity => ({ ...entity, solution: data.solution.code })) }) });
}

export function createManagedWorkspace(artifact, { name, baselineOwner, id = crypto.randomUUID() } = {}) {
  if (artifact.scope !== 'full') fail('A managed workspace must start with an explicit full snapshot');
  clear(artifact);
  const owner = text(baselineOwner, 'Baseline owner');
  return freeze({ id: text(id, 'Workspace ID'), name: text(name, 'Workspace name'), solution: artifact.solution,
    revision: 0, status: 'active', baselineId: artifact.id, baselineOwner: owner,
    artifacts: [structuredClone(artifact)], changes: [], reconciliations: [],
    current: artifact.components.map(component => ({ ...structuredClone(component), team: owner, interventionId: null,
      ...(component.structure ? { responsibility: processResponsibility(component, owner, { full: true }) } : {}) })),
    baselineResponsibilities: Object.fromEntries(artifact.components.filter(row => row.structure).map(row => [row.key, processResponsibility(row, owner, { full: true })])),
    history: [{ type: 'created', baselineId: artifact.id }] });
}

export function previewManagedChange(state, artifact, { team } = {}) {
  compatible(state, artifact, 'partial');
  const owner = text(team, 'Intervention team'), base = baseline(state), working = index(state.current);
  const rows = artifact.components.map(component => {
    const previous = working.get(component.key), original = base.get(component.key), changed = !same(previous, component);
    const elements = reviewProcessElements(original, previous, component, { mode: 'change', team: owner, baselineOwner: state.baselineOwner });
    const precise = elements?.complete && !elements.residualChanged;
    return { key: component.key, classification: !changed ? 'unchanged' : !previous ? 'intervention-added' : 'component-modified',
      baselineClassification: same(original, component) ? 'baseline-unchanged' : original ? 'baseline-modified' : 'intervention-added',
      boundaryCrossing: precise ? elements.rows.some(row => row.boundaryCrossing) : changed && !!original && !same(original, component),
      conflict: precise ? elements.rows.some(row => row.conflict) : changed && !!previous?.interventionId && previous.team !== owner,
      previousTeam: previous?.team ?? null, digest: component.digest, ...(elements ? { elements } : {}) };
  });
  return freeze({ revision: state.revision, artifactId: artifact.id, artifactDigest: artifactDigest(artifact), rows,
    ambiguities: structuredClone(artifact.ambiguities), unclassifiedFiles: structuredClone(artifact.unclassifiedFiles), dependencies: structuredClone(artifact.dependencies ?? null) });
}

export function acceptManagedChange(state, artifact, { expectedRevision, reviewedDigest, team, taskRef, reviewedBoundaryKeys = [] } = {}) {
  guard(state, expectedRevision); clear(artifact);
  const preview = previewManagedChange(state, artifact, { team });
  if (reviewedDigest !== preview.artifactDigest) fail('Acceptance must bind the reviewed partial change evidence', 409);
  if (preview.rows.some(row => row.conflict)) fail('Cross-team overlap requires reconciliation; change acceptance is blocked', 409);
  if (preview.rows.some(row => row.boundaryCrossing && !reviewedBoundaryKeys.includes(row.key)))
    fail('Review every baseline boundary crossing before acceptance', 409);
  const task = text(taskRef, 'Task reference'), owner = text(team, 'Intervention team'), current = index(state.current), base = baseline(state);
  for (const component of artifact.components) {
    if (same(current.get(component.key), component)) continue;
    const restored = same(base.get(component.key), component);
    current.set(component.key, { ...structuredClone(component), team: restored ? state.baselineOwner : owner,
      interventionId: restored ? null : artifact.id,
      ...(component.structure ? { responsibility: processResponsibility(component, state.baselineOwner, { previous: current.get(component.key),
        baseline: base.get(component.key), baselineResponsibility: state.baselineResponsibilities?.[component.key], team: owner, artifactId: artifact.id }) } : {}) });
  }
  const next = structuredClone(state);
  next.revision++; next.artifacts.push(structuredClone(artifact));
  next.changes.push({ id: artifact.id, team: owner, taskRef: task, baselineId: state.baselineId, rows: preview.rows });
  next.current = sorted(current.values()); next.history.push({ type: 'change-accepted', id: artifact.id, revision: next.revision });
  return freeze(next);
}

export function previewReconciliation(state, artifact) {
  compatible(state, artifact, 'full');
  const base = baseline(state), working = index(state.current), incoming = index(artifact.components);
  const keys = [...new Set([...base.keys(), ...working.keys(), ...incoming.keys()])].sort();
  const rows = keys.map(key => {
    const b = base.get(key), w = working.get(key), n = incoming.get(key);
    const external = !same(b, n);
    const classification = artifact.ambiguities.length ? 'ambiguous' : classifyVersions(b,w,n);
    const elements = reviewProcessElements(b, w, n, { mode: 'reconciliation', baselineOwner: state.baselineOwner });
    return { key, classification, baselineDigest: b?.digest ?? null, workingDigest: w?.digest ?? null,
      incomingDigest: n?.digest ?? null, removed: classification === 'ambiguous' ? null : !!b && !n,
      team: w?.team ?? state.baselineOwner, boundaryCrossing: classification === 'ambiguous' ? null : external && !!b,
      ...(elements ? { elements } : {}) };
  });
  return freeze({ revision: state.revision, artifactId: artifact.id, artifactDigest: artifactDigest(artifact), rows,
    ambiguities: structuredClone(artifact.ambiguities), unclassifiedFiles: structuredClone(artifact.unclassifiedFiles), dependencies: structuredClone(artifact.dependencies ?? null) });
}

export function acceptReconciliation(state, artifact, { expectedRevision, reviewedDigest, resolutions = {}, baselineOwner } = {}) {
  guard(state, expectedRevision); clear(artifact);
  const preview = previewReconciliation(state, artifact);
  if (reviewedDigest !== preview.artifactDigest) fail('Acceptance must bind the reviewed full snapshot evidence', 409);
  const conflicts = preview.rows.filter(row => row.classification === 'conflict');
  if (Object.keys(resolutions).some(key => !conflicts.some(row => row.key === key)) ||
      conflicts.some(row => !['keep-working', 'take-snapshot'].includes(resolutions[row.key])))
    fail('Resolve each conflict explicitly against this snapshot', 409);
  const owner = text(baselineOwner, 'New baseline owner'), working = index(state.current), incoming = index(artifact.components), current = [];
  for (const row of preview.rows) {
    const keep = row.classification === 'known-change-retained' || resolutions[row.key] === 'keep-working';
    const component = (keep ? working : incoming).get(row.key);
    if (component) current.push(keep ? structuredClone(component) : { ...structuredClone(component), team: owner, interventionId: null,
      ...(component.structure ? { responsibility: processResponsibility(component, owner, { previous: working.get(row.key), full: true }) } : {}) });
  }
  const next = structuredClone(state);
  next.revision++; next.baselineId = artifact.id; next.baselineOwner = owner;
  next.artifacts.push(structuredClone(artifact)); next.current = sorted(current);
  next.baselineResponsibilities = Object.fromEntries(artifact.components.filter(row => row.structure).map(row => [row.key,
    processResponsibility(row, owner, { previous: working.get(row.key), full: true })]));
  next.reconciliations.push({ artifactId: artifact.id, previousBaselineId: state.baselineId,
    rows: preview.rows, resolutions: structuredClone(resolutions), revision: next.revision });
  next.history.push({ type: 'baseline-accepted', id: artifact.id, revision: next.revision });
  return freeze(next);
}

export function setManagedWorkspaceArchived(state, archived, expectedRevision) {
  if (typeof archived !== 'boolean' || expectedRevision !== state.revision || !Number.isInteger(expectedRevision))
    fail('A current revision and explicit archive state are required', 409);
  if ((state.status === 'archived') === archived) return state;
  const next = structuredClone(state); next.revision++; next.status = archived ? 'archived' : 'active';
  next.history.push({ type: archived ? 'archived' : 'reopened', revision: next.revision }); return freeze(next);
}
