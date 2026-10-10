import crypto from 'node:crypto';
import { parseProject } from './project-parser.mjs';
import { dependencyReport } from './dependency-evidence.mjs';
import { componentIdentity, resourcePaths } from './native-components.mjs';
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
const keyOf = entity => componentIdentity(entity) ? JSON.stringify(componentIdentity(entity)) : null;
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
  const original = state.artifacts.find(row => row.id === state.baselineId);
  if ((original.identityVersion ?? 1) !== (artifact.identityVersion ?? 1) && artifact.components.some(row => JSON.parse(row.key).length > 3))
    fail('Native identity profile changed; review baseline migration before comparing typed components', 409);
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
    // parseProject intentionally drops resources from its sanitized entity
    // projection. Read declared resource evidence from the original manifest.
    let resources;
    try { resources = resourcePaths(entity.service, record); }
    catch (error) { ambiguities.push({ key, reason: error.message }); continue; }
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
    components.push({ key, service: entity.service, namespace: entity.namespace, code: entity.code, kind: entity.kind,
      digest: hash(canonical({ metadata, files: evidence.map(({ role, sha256 }) => ({ role, sha256 })) })), evidence,
      ...(structure ? { structure } : {}) });
  }
  if (!data.solution?.code) ambiguities.push({ reason: 'unproven-solution' });
  // Unindexed bytes are preserved as evidence, never silently classified as a
  // known component or converted into a deployable composed archive.
  const unclassifiedFiles = inventory.filter(row => !used.has(row.path));
  for (const row of unclassifiedFiles) ambiguities.push({ reason: 'unclassified-file', source: row.path });
  return freeze({ id, scope, identityVersion: 2, solution: data.solution?.code ?? null, checksum: hash(original), parserVersion: report.parserVersion,
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

// Resolves an explicit base declaration to an accepted full artifact in this
// lifecycle. Membership and integrity are checked; native ancestry is not.
const declaredBase = (state, artifact) => {
  const declaration = artifact.baseDeclaration;
  const original = state.artifacts.find(row => row.id === declaration?.artifactId);
  const acceptedRevision = original && (state.history.some(row => row.type === 'created' && row.baselineId === original.id) ? 0
    : state.history.find(row => row.type === 'baseline-accepted' && row.id === original.id)?.revision);
  return declaration?.status === 'declared' && original && original.scope === 'full'
      && original.scopeDeclaration?.scope === 'full'
      && canonical(declaration.snapshot) === canonical(original.snapshot)
      && canonical(declaration.scopeDeclaration) === canonical(original.scopeDeclaration)
      && declaration.checksum === original.checksum && declaration.revision === acceptedRevision
    ? { original, acceptedRevision } : null;
};

// Bounded component declarations never establish native ancestry or installability.
export function declareManagedChangeScope(state, artifact, input, declaredBy) {
  return scopeDeclaration(state, artifact, input, declaredBy, { currentDeletion: true });
}

// The merge plan validates the same tombstone bindings against the declared base,
// then classifies an intervening edit instead of rejecting it.
function scopeDeclaration(state, artifact, input, declaredBy, { currentDeletion }) {
  if (input === undefined) return { schemaVersion: 1, status: 'unknown', method: 'not-declared' };
  const strict = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => keys.includes(key));
  if (!strict(input, ['name', 'members', 'deletions', 'confirmed']) || input.confirmed !== true
      || !Array.isArray(input.members) || !input.members.length || input.members.length > 10000
      || input.members.some(key => typeof key !== 'string') || new Set(input.members).size !== input.members.length
      || !Array.isArray(input.deletions ?? [])) fail('Declare a named unique captured-component scope explicitly');
  const name = text(input.name, 'Change scope name'), { original, acceptedRevision } = declaredBase(state, artifact) ?? {};
  if (!original || artifact.scopeDeclaration?.scope !== 'partial' || original.ambiguities.length || artifact.ambiguities.length)
    fail('Change scope requires an unambiguous declared accepted full base and partial capture', 422);
  if (artifact.sourceDeclaration?.baselineId !== state.baselineId || artifact.scope !== 'partial')
    fail('Change scope requires current Source and partial scope evidence', 409);
  const base = index(original.components), incoming = index(artifact.components);
  if (base.size !== original.components.length || incoming.size !== artifact.components.length)
    fail('Duplicate component identity blocks change scope', 422);
  if (artifact.components.some(row => !input.members.includes(row.key)))
    fail('Partial capture contains members outside the declared change scope', 422);
  const members = input.members.map(key => {
    const b = base.get(key), n = incoming.get(key);
    if (!b && !n) fail('Scope member is not proven in the declared base or partial capture', 422);
    return { key, baseDigest: b?.digest ?? null, incomingDigest: n?.digest ?? null,
      baseEvidence: structuredClone(b?.evidence ?? null), incomingEvidence: structuredClone(n?.evidence ?? null) };
  }).sort((a, b) => a.key.localeCompare(b.key, 'en'));
  const deletions = (input.deletions ?? []).map(row => {
    if (!strict(row, ['key', 'baseDigest', 'confirmed']) || row.confirmed !== true
        || !input.members.includes(row.key) || !base.has(row.key) || incoming.has(row.key)
        || row.baseDigest !== base.get(row.key).digest)
      fail('Deletion must bind an absent scoped member to its exact existing base digest', 422);
    // An older full base can describe a change, but cannot authorize removal from
    // a newer baseline or an intervening edit. MR-02 owns delete/edit resolution.
    if (currentDeletion && (original.id !== state.baselineId || !same(base.get(row.key), index(state.current).get(row.key))))
      fail('Deletion base or member changed; reconcile before declaring removal', 409);
    return { key: row.key, baseDigest: row.baseDigest, confirmed: true };
  }).sort((a, b) => a.key.localeCompare(b.key, 'en'));
  if (new Set(deletions.map(row => row.key)).size !== deletions.length) fail('Duplicate deletion claim', 422);
  return { schemaVersion: 1, status: 'declared', method: 'explicit-assertion', name, members, deletions,
    baseArtifactId: original.id, baseRevision: acceptedRevision, baseChecksum: original.checksum,
    artifactChecksum: artifact.checksum, sourceDeclaration: structuredClone(artifact.sourceDeclaration),
    scopeDeclaration: structuredClone(artifact.scopeDeclaration ?? null), declaredBy, declaredAt: new Date().toISOString(),
    ancestryVerified: false, automaticMergeEnabled: false, buildEnabled: false };
}

const changeScope = (state, artifact, { currentDeletion = true } = {}) => {
  const declaration = artifact.changeScopeDeclaration;
  if (!declaration) return { schemaVersion: 1, status: 'unknown', method: 'not-recorded' };
  if (declaration.status === 'unknown') return { schemaVersion: 1, status: 'unknown', method: declaration.method ?? 'not-recorded' };
  const checked = scopeDeclaration(state, artifact, { name: declaration.name,
    members: declaration.members?.map(row => row.key), deletions: declaration.deletions, confirmed: true }, declaration.declaredBy, { currentDeletion });
  const keys = ['schemaVersion', 'status', 'method', 'name', 'members', 'deletions', 'baseArtifactId', 'baseRevision',
    'baseChecksum', 'artifactChecksum', 'sourceDeclaration', 'scopeDeclaration', 'ancestryVerified', 'automaticMergeEnabled', 'buildEnabled'];
  if (keys.some(key => canonical(checked[key]) !== canonical(declaration[key])))
    fail('Change scope evidence changed; prepare a new declaration', 409);
  return structuredClone(declaration);
};

export function previewManagedChange(state, artifact, { team } = {}) {
  compatible(state, artifact, 'partial');
  const scope = changeScope(state, artifact);
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
  for (const deletion of scope.deletions ?? []) rows.push({ key: deletion.key, classification: 'component-deleted',
    baselineClassification: 'baseline-removed', boundaryCrossing: true, conflict: false,
    previousTeam: working.get(deletion.key)?.team ?? null, digest: null, baseDigest: deletion.baseDigest, explicitDeletion: true });
  return freeze({ revision: state.revision, artifactId: artifact.id, artifactDigest: artifactDigest(artifact), rows, changeScopeDeclaration: scope,
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
  for (const row of preview.rows.filter(row => row.explicitDeletion)) current.delete(row.key);
  const next = structuredClone(state);
  next.revision++; next.artifacts.push(structuredClone(artifact));
  next.changes.push({ id: artifact.id, team: owner, taskRef: task, baselineId: state.baselineId, rows: preview.rows });
  next.current = sorted(current.values()); next.history.push({ type: 'change-accepted', id: artifact.id, revision: next.revision });
  return freeze(next);
}

// Whole-component three-way plan: immutable declared full base B, current
// accepted working state A and an incoming partial C. Pure and deterministic; it
// proposes, never accepts, resolves, materializes bytes or enables a build.
const MERGE_PROPOSALS = {
  unchanged: 'keep-current', 'current-only': 'keep-current', 'addition-current': 'keep-current',
  identical: 'keep-current', 'addition-identical': 'keep-current', 'delete-identical': 'keep-current',
  'incoming-only': 'take-incoming', 'addition-incoming': 'take-incoming', 'delete-incoming': 'remove',
  divergent: null, 'addition-divergent': null, 'delete-edit': null, 'edit-delete': null
};
const sideChange = (base, other) => !base && !other ? 'absent' : !base ? 'added' : !other ? 'removed'
  : same(base, other) ? 'none' : 'modified';
const classifyMerge = (current, incoming, a, c) => {
  if (incoming === 'no-claim' || incoming === 'none')
    return current === 'none' ? 'unchanged' : current === 'added' ? 'addition-current' : 'current-only';
  if (incoming === 'added') return current === 'absent' ? 'addition-incoming' : same(a, c) ? 'addition-identical' : 'addition-divergent';
  if (incoming === 'removed') return current === 'none' ? 'delete-incoming' : current === 'removed' ? 'delete-identical' : 'delete-edit';
  return current === 'none' ? 'incoming-only' : current === 'removed' ? 'edit-delete' : same(a, c) ? 'identical' : 'divergent';
};
const unknownEvidence = artifact => ({ ambiguities: structuredClone(artifact?.ambiguities ?? []),
  unclassifiedFiles: structuredClone(artifact?.unclassifiedFiles ?? []) });

export function planManagedComponentMerge(state, artifact) {
  compatible(state, artifact, 'partial');
  const blockers = [], declared = declaredBase(state, artifact);
  if (!declared) {
    if (artifact.baseDeclaration?.status === 'declared') fail('Declared base evidence changed; prepare a new declaration', 409);
    blockers.push({ reason: 'unknown-base', method: artifact.baseDeclaration?.method ?? 'not-recorded' });
  }
  const { original = null, acceptedRevision = null } = declared ?? {};
  if (artifact.ambiguities.length) blockers.push({ reason: 'incoming-ambiguity', count: artifact.ambiguities.length });
  if (original?.ambiguities.length) blockers.push({ reason: 'base-ambiguity', count: original.ambiguities.length });
  // An ambiguous capture cannot carry a validated scope; its tombstones are never used.
  const scope = declared && !artifact.ambiguities.length ? changeScope(state, artifact, { currentDeletion: false })
    : { schemaVersion: 1, status: artifact.changeScopeDeclaration?.status === 'declared' ? 'unvalidated' : 'unknown',
      method: artifact.changeScopeDeclaration?.method ?? 'not-recorded' };
  const baseRows = original?.components ?? [], b = index(baseRows), a = index(state.current), c = index(artifact.components);
  for (const [input, map, rows] of [['base', b, baseRows], ['current', a, state.current], ['incoming', c, artifact.components]])
    if (map.size !== rows.length) blockers.push({ reason: 'duplicate-identity', input });
  const tombstones = new Map((scope.deletions ?? []).map(row => [row.key, row]));
  const keys = declared ? [...new Set([...b.keys(), ...a.keys(), ...c.keys(), ...tombstones.keys()])].sort((x, y) => x.localeCompare(y, 'en')) : [];
  const rows = keys.map(key => {
    const base = b.get(key), current = a.get(key), incoming = c.get(key), tombstone = tombstones.get(key);
    const currentChange = sideChange(base, current);
    // Partial absence is no claim. Only a validated tombstone removes.
    const incomingChange = tombstone ? 'removed' : incoming ? sideChange(base, incoming) : 'no-claim';
    const part = incoming ?? current ?? base;
    return { key, service: part.service, namespace: part.namespace, code: part.code, kind: part.kind,
      classification: classifyMerge(currentChange, incomingChange, current, incoming), currentChange, incomingChange,
      blockers: artifact.ambiguities.filter(row => row.key === key).map(row => row.reason),
      base: base ? { artifactId: original.id, digest: base.digest, evidence: structuredClone(base.evidence) } : null,
      current: current ? { digest: current.digest, team: current.team ?? null, interventionId: current.interventionId ?? null,
        evidence: structuredClone(current.evidence) } : null,
      incoming: tombstone ? { artifactId: artifact.id, tombstone: { baseDigest: tombstone.baseDigest } }
        : incoming ? { artifactId: artifact.id, digest: incoming.digest, evidence: structuredClone(incoming.evidence) } : null };
  });
  // Identity is the exact native tuple. An incoming addition/removal beside an
  // opposite change of the same service/kind may be a rename; nothing is matched.
  for (const members of Object.values(Object.groupBy(rows, row => JSON.stringify([row.service, row.kind])))) {
    const removed = members.filter(row => [row.currentChange, row.incomingChange].includes('removed'));
    const added = members.filter(row => [row.currentChange, row.incomingChange].includes('added'));
    if (removed.length && added.length && [...removed, ...added].some(row => ['removed', 'added'].includes(row.incomingChange)))
      for (const row of new Set([...removed, ...added])) row.blockers.push('rename-uncertain');
  }
  for (const row of rows) {
    row.blockers = [...new Set(row.blockers)].sort();
    row.status = row.blockers.length ? 'blocked' : MERGE_PROPOSALS[row.classification] ? 'clear' : 'resolution-required';
    row.proposal = row.status === 'clear' ? MERGE_PROPOSALS[row.classification] : null;
  }
  if (rows.some(row => row.blockers.includes('rename-uncertain'))) blockers.push({ reason: 'rename-uncertain' });
  const plan = { schemaVersion: 1, method: 'whole-component-three-way',
    status: blockers.length || rows.some(row => row.status === 'blocked') ? 'blocked'
      : rows.some(row => row.status === 'resolution-required') ? 'resolution-required' : 'clear',
    blockers,
    inputs: {
      base: original ? { status: 'declared', artifactId: original.id, revision: acceptedRevision, checksum: original.checksum,
        artifactDigest: artifactDigest(original), declaration: structuredClone(artifact.baseDeclaration) }
        : { status: 'unknown', declaration: structuredClone(artifact.baseDeclaration ?? null) },
      current: { workspaceId: state.id, revision: state.revision, baselineId: state.baselineId, digest: hash(canonical(state.current)) },
      incoming: { artifactId: artifact.id, checksum: artifact.checksum, artifactDigest: artifactDigest(artifact), changeScope: scope }
    },
    rows, unknown: { base: unknownEvidence(original), incoming: unknownEvidence(artifact) },
    ancestryVerified: false, automaticMergeEnabled: false, acceptanceEnabled: false, buildEnabled: false };
  return freeze({ ...plan, planDigest: hash(canonical(plan)) });
}

// A plan is valid only for the exact B/A/C evidence it was computed from.
export function assertCurrentManagedMergePlan(plan, state, artifact) {
  if (!plan?.planDigest || canonical(plan) !== canonical(planManagedComponentMerge(state, artifact)))
    fail('Merge plan inputs changed; prepare a new plan', 409);
  return plan;
}

// Supported whole-component choices for rows that require a human decision.
// There is no default, byte merge, part merge or upload-order winner.
export const MERGE_RESOLUTION_CHOICES = Object.freeze({
  divergent: Object.freeze(['keep-current', 'take-incoming']),
  'addition-divergent': Object.freeze(['keep-current', 'take-incoming']),
  'delete-edit': Object.freeze(['keep-current', 'remove']),
  'edit-delete': Object.freeze(['keep-current', 'take-incoming'])
});
const outcome = (row, choice) => {
  const pick = choice === 'take-incoming' ? row.incoming?.digest ? { source: 'incoming', artifactId: row.incoming.artifactId, digest: row.incoming.digest } : null
    : choice === 'keep-current' ? row.current ? { source: 'current', interventionId: row.current.interventionId, digest: row.current.digest } : null : null;
  return pick ?? { source: 'absent', digest: null };
};
const revisionBody = resolution => { const { revisionDigest, ...body } = resolution; return body; };

// Immutable resolved revision of one reviewed plan. It references B/A/C by
// artifact ID/digest; it never copies or materializes bytes, accepts the
// result or enables a build. A parent link orders successive decisions.
export function resolveManagedMerge(plan, { decisions, reason, actor, parent = null, id = crypto.randomUUID(), at = new Date().toISOString() } = {}) {
  if (!plan?.planDigest || plan.method !== 'whole-component-three-way') fail('A reviewed merge plan is required', 409);
  if (plan.status === 'blocked') fail('Blocked merge evidence cannot be resolved; remediate the blocked inputs first', 422);
  if (!actor?.id || !actor.login) fail('An authenticated resolver is required', 401);
  if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions) || Object.values(decisions).some(value => typeof value !== 'string'))
    fail('Conflict decisions must map component keys to choices');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000) fail('Resolution reason is required (1–2000 characters)');
  const required = plan.rows.filter(row => row.status === 'resolution-required');
  if (Object.keys(decisions).some(key => !required.some(row => row.key === key)))
    fail('Decisions may only address rows that require resolution in this plan', 409);
  for (const row of required) if (!MERGE_RESOLUTION_CHOICES[row.classification]?.includes(decisions[row.key]))
    fail('Choose a supported resolution for every conflicting component', 422);
  if (parent && (parent.inputs?.current?.workspaceId !== plan.inputs.current.workspaceId || parent.inputs?.incoming?.artifactId !== plan.inputs.incoming.artifactId))
    fail('Parent resolution belongs to another change', 409);
  const result = plan.rows.map(row => {
    const choice = decisions[row.key] ?? row.proposal;
    return { key: row.key, classification: row.classification, choice, decided: row.key in decisions, ...outcome(row, choice) };
  });
  const resolution = { schemaVersion: 1, method: 'whole-component-resolution', id: text(id, 'Resolution ID'),
    sequence: parent ? parent.sequence + 1 : 1, parentId: parent?.id ?? null, parentDigest: parent?.revisionDigest ?? null,
    planDigest: plan.planDigest, planStatus: plan.status, inputs: structuredClone(plan.inputs),
    decisions: required.map(row => ({ key: row.key, classification: row.classification, choice: decisions[row.key] })),
    result, resultDigest: hash(canonical(result)), reason: reason.trim(),
    actor: { id: actor.id, login: actor.login, provider: actor.provider ?? null }, at,
    ancestryVerified: false, automaticMergeEnabled: false, acceptanceEnabled: false, buildEnabled: false, materialized: false };
  return freeze({ ...resolution, revisionDigest: hash(canonical(resolution)) });
}

// A resolution is usable only while its stored revision is intact and the exact
// B/A/C plan it decided is still the current plan.
export function managedResolutionStatus(resolution, plan) {
  if (!resolution?.revisionDigest || hash(canonical(revisionBody(resolution))) !== resolution.revisionDigest) return 'corrupt';
  return plan?.planDigest && plan.planDigest === resolution.planDigest ? 'current' : 'stale';
}

export function assertCurrentManagedResolution(resolution, state, artifact) {
  const status = managedResolutionStatus(resolution, planManagedComponentMerge(state, artifact));
  if (status !== 'current') fail(status === 'corrupt' ? 'Resolution evidence is corrupt' : 'Resolution inputs changed; resolve the current plan again', 409);
  return resolution;
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
