import { componentIdentity } from './native-components.mjs';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const canonical = value => JSON.stringify(value, (_, row) => row && typeof row === 'object' && !Array.isArray(row)
  ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
const refId = ref => JSON.stringify([ref?.solution, ref?.key]);
const refOf = row => ({ solution: row.solution, key: row.key });
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const nonempty = value => typeof value === 'string' && value.length > 0;
const candidatesOf = dep => (dep.candidates || []).map(({ code, version, paid }) => ({ code, version, paid }))
  .sort((a, b) => compare(canonical(a), canonical(b)));

// An accounting floor, not a claim that these are all native server domains.
export const REQUIRED_GLOBAL_DOMAINS = Object.freeze([
  'global-settings', 'access-groups-relations', 'schedules', 'integration-bindings', 'configuration-reference-data'
]);

/** Pure planning over parseManagedArtifact captures and dependencyReport rows.
 * Native unit/application/domain declarations come from a trusted adapter;
 * this function neither proves those assertions nor creates release eligibility.
 */
export function planReleaseScope({ request, artifacts = [], applications = [], importUnits = [], serverInventory = null } = {}) {
  if (!['part', 'application', 'solution', 'server'].includes(request?.kind)) throw Error('Explicit release scope is required');
  for (const rows of [artifacts, applications, importUnits]) if (!Array.isArray(rows)) throw Error('Planner inventories must be arrays');
  const blockers = new Map(), expansions = new Map(), prerequisites = new Map();
  const block = (reason, details = {}) => {
    const row = { reason, ...details }; blockers.set(canonical(row), row);
  };
  const expand = row => expansions.set(canonical(row), row);
  const captures = new Map(), components = new Map(), units = new Map(), invalidUnits = new Set();
  for (const artifact of artifacts) {
    if (!nonempty(artifact?.solution) || !Array.isArray(artifact.components)) throw Error('Captured solution/components are required');
    const prior = captures.get(artifact.solution) || []; prior.push(artifact); captures.set(artifact.solution, prior);
    for (const component of artifact.components) {
      const identity = componentIdentity(component);
      if (!identity || component.key !== JSON.stringify(identity) || !nonempty(component.digest)) {
        block('unproven-component', { solution: artifact.solution, key: component.key ?? null }); continue;
      }
      const row = { ...component, solution: artifact.solution }, id = refId(row);
      const matches = components.get(id) || []; matches.push(row); components.set(id, matches);
    }
  }
  for (const unit of importUnits) {
    if (!nonempty(unit?.id) || !Array.isArray(unit.members)) throw Error('Native unit id/members are required');
    const matches = units.get(unit.id) || []; matches.push(unit); units.set(unit.id, matches);
    if (!unit.members.length || unit.members.some(ref => !nonempty(ref?.solution) || !nonempty(ref?.key) || !nonempty(ref?.digest)) ||
        new Set(unit.members.map(refId)).size !== unit.members.length) {
      invalidUnits.add(unit); block('invalid-native-unit-coverage', { unitId: unit.id });
    }
  }
  const required = new Set(), requested = new Set(), queue = [], edges = new Map(), selectedUnits = new Set();
  const resolve = ref => {
    if (!nonempty(ref?.solution) || !nonempty(ref.key)) { block('unknown-component-reference'); return null; }
    const id = refId(ref), matches = components.get(id) || [];
    if (matches.length !== 1) { block(matches.length ? 'ambiguous-component' : 'missing-component', { ...refOf(ref) }); return null; }
    return matches[0];
  };
  const add = (ref, reason, from = null) => {
    const row = resolve(ref); if (!row) return;
    const id = refId(row);
    if (reason === 'requested') requested.add(id);
    else if (!requested.has(id) && !(reason === 'native-import-unit' && required.has(id))) expand({ reason, component: refOf(row), ...(from ? { from } : {}) });
    if (!required.has(id)) { required.add(id); queue.push(id); }
  };
  const fullSolution = solution => {
    const rows = captures.get(solution) || [];
    if (rows.length !== 1) { block(rows.length ? 'ambiguous-solution-capture' : 'missing-solution', { solution }); return; }
    if (rows[0].scope !== 'full') block('incomplete-solution-inventory', { solution });
    for (const row of rows[0].components) add({ solution, key: row.key }, 'requested');
  };
  if (request.kind === 'part') {
    const row = resolve(request.component);
    if (row) {
      if (!nonempty(request.partId) || row.structure?.version !== 1 || !Array.isArray(row.structure?.ambiguities) || row.structure.ambiguities.length ||
          row.structure?.elements?.filter(part => part.id === request.partId).length !== 1)
        block('unknown-part-identity', { ...refOf(row), partId: request.partId ?? null });
      add(row, 'requested'); expand({ reason: 'part-to-component', component: refOf(row), partId: request.partId ?? null });
    }
  } else if (request.kind === 'application') {
    const matches = applications.filter(row => row.solution === request.solution && row.id === request.applicationId);
    if (matches.length !== 1) block(matches.length ? 'ambiguous-application' : 'unknown-application', { solution: request.solution ?? null, applicationId: request.applicationId ?? null });
    else {
      const app = matches[0];
      if (app.coverage !== 'complete' || !nonempty(app.evidenceRef) || !Array.isArray(app.members) || !app.members.length)
        block('incomplete-application-inventory', { solution: app.solution, applicationId: app.id });
      for (const ref of app.members || []) add(ref, 'requested');
    }
  } else if (request.kind === 'solution') {
    if (!nonempty(request.solution)) throw Error('Requested Solution is required');
    fullSolution(request.solution);
  } else {
    if (serverInventory?.coverage !== 'complete' || !nonempty(serverInventory?.evidenceRef) ||
        !nonempty(serverInventory?.targetProfileDigest) || !Array.isArray(serverInventory?.solutions) || !Array.isArray(serverInventory?.requiredGlobalDomains)) block('unknown-server-inventory');
    for (const solution of [...new Set(serverInventory?.solutions || [])].sort(compare)) fullSolution(solution);
    if (!serverInventory?.solutions?.length) block('unknown-server-solutions');
    const domains = [...new Set([...REQUIRED_GLOBAL_DOMAINS, ...(serverInventory?.requiredGlobalDomains || []),
      ...(serverInventory?.globalDomains || []).map(row => row.domain)])].sort(compare);
    for (const domain of domains) {
      const matches = (serverInventory?.globalDomains || []).filter(row => row.domain === domain);
      if (matches.length !== 1) { block(matches.length ? 'ambiguous-global-domain' : 'unknown-global-domain', { domain }); continue; }
      const row = matches[0];
      if (row.status === 'included' && nonempty(row.evidenceRef) && Array.isArray(row.members) && row.members.length) {
        for (const ref of row.members) add(ref, 'global-domain', { domain });
      } else if (row.status === 'externally-provisioned-and-verified' && nonempty(row.evidenceRef) && nonempty(row.adapter) &&
                 nonempty(serverInventory.targetProfileDigest) && row.targetProfileDigest === serverInventory.targetProfileDigest) {
        prerequisites.set(canonical({ domain }), { domain, status: row.status, evidenceRef: row.evidenceRef, adapter: row.adapter, targetProfileDigest: row.targetProfileDigest });
      } else block('unresolved-global-domain', { domain });
    }
  }
  if (!required.size) block('empty-required-scope');

  // Unit expansion and dependency closure share a queue: newly included siblings
  // must contribute their dependencies too. No arbitrary recursion depth limit.
  for (let cursor = 0; cursor < queue.length; cursor++) {
    queue.splice(cursor, queue.length - cursor, ...queue.slice(cursor).sort(compare));
    const id = queue[cursor], row = components.get(id)[0]; edges.set(id, new Set());
    const captureRows = captures.get(row.solution);
    if (captureRows.length !== 1) { block('ambiguous-solution-capture', { solution: row.solution }); continue; }
    const capture = captureRows[0];
    if (!Array.isArray(capture.ambiguities) || !Array.isArray(capture.unclassifiedFiles) || capture.ambiguities.length || capture.unclassifiedFiles.length)
      block('incomplete-capture', { solution: row.solution });
    if (capture.dependencies?.schemaVersion !== 1 || !Array.isArray(capture.dependencies.rows)) block('unknown-dependency-inventory', { solution: row.solution });
    for (const dep of [...(capture.dependencies?.rows || [])].sort((a, b) => compare(canonical(a), canonical(b)))) {
      // Existing report marks sysDependencies non-required; they are required
      // runtime prerequisites here. Optional declarations are disclosed below.
      if (dep.category === 'optionalDependencies') continue;
      if (!['dependencies', 'internalDependencies', 'sysDependencies'].includes(dep.category)) {
        block('unknown-dependency-category', { solution: row.solution, category: dep.category ?? null }); continue;
      }
      const source = dep.source || {};
      const supplied = ['service', 'namespace', 'code'].filter(key => nonempty(source[key]));
      if (supplied.length && supplied.length !== 3) block('unknown-reference-source', { solution: row.solution });
      if (supplied.length === 3 && capture.components.filter(component => supplied.every(key => source[key] === component[key])).length !== 1)
        block('unknown-reference-source', { solution: row.solution, source: { service: source.service, namespace: source.namespace, code: source.code } });
      if (supplied.length === 3 && !supplied.every(key => source[key] === row[key])) continue;
      const targets = [...components.values()].flat().filter(target => target.service === dep.service && target.namespace === dep.targetNamespace && target.code === dep.targetCode);
      if (!nonempty(dep.service) || !nonempty(dep.targetNamespace) || !nonempty(dep.targetCode) || dep.status === 'unknown-identity') {
        block('unknown-reference-identity', { from: refOf(row) }); continue;
      }
      if (targets.length !== 1) {
        const prerequisite = { from: refOf(row), service: dep.service, namespace: dep.targetNamespace, code: dep.targetCode,
          status: dep.status ?? 'provider-not-observed', candidates: candidatesOf(dep) };
        prerequisites.set(canonical(prerequisite), prerequisite);
        block(targets.length ? 'ambiguous-reference' : 'missing-reference', prerequisite); continue;
      }
      if ((dep.candidates || []).some(candidate => candidate.paid !== false) || dep.status === 'paid-source-unavailable') {
        const prerequisite = { from: refOf(row), service: dep.service, namespace: dep.targetNamespace, code: dep.targetCode,
          status: 'license-not-verified', candidates: candidatesOf(dep) };
        prerequisites.set(canonical(prerequisite), prerequisite); block('unverified-licensed-prerequisite', prerequisite);
      }
      const target = targets[0]; edges.get(id).add(refId(target)); add(target, 'dependency', refOf(row));
    }
    const providers = importUnits.filter(unit => unit.members.some(ref => refId(ref) === id));
    if (providers.length !== 1) { block(providers.length ? 'ambiguous-native-import-unit' : 'unknown-native-import-unit', refOf(row)); continue; }
    const unit = providers[0];
    if (invalidUnits.has(unit) || units.get(unit.id).length !== 1 || unit.status !== 'supported' || !nonempty(unit.adapter) || !nonempty(unit.evidenceRef)) {
      block('unsupported-native-import-unit', { unitId: unit.id }); continue;
    }
    const member = unit.members.find(ref => refId(ref) === id);
    if (member.digest !== row.digest) block('stale-native-unit-coverage', { unitId: unit.id, component: refOf(row) });
    selectedUnits.add(unit.id);
    for (const ref of [...unit.members].sort((a, b) => compare(refId(a), refId(b)))) add(ref, 'native-import-unit', { unitId: unit.id });
  }

  // Iterative DFS reports back-edge cycles without inventing an import order.
  const state = new Map(), order = [];
  for (const root of [...required].sort(compare)) {
    if (state.has(root)) continue;
    const stack = [{ id: root, remaining: [...(edges.get(root) || [])].sort(compare), cursor: 0 }]; state.set(root, 1);
    while (stack.length) {
      const frame = stack.at(-1);
      if (frame.cursor === frame.remaining.length) { state.set(frame.id, 2); order.push(frame.id); stack.pop(); continue; }
      const next = frame.remaining[frame.cursor++];
      if (state.get(next) === 1) {
        const start = stack.findIndex(frame => frame.id === next);
        block('dependency-cycle', { components: stack.slice(start).map(frame => refOf(components.get(frame.id)[0])) });
      } else if (!state.has(next)) {
        state.set(next, 1); stack.push({ id: next, remaining: [...(edges.get(next) || [])].sort(compare), cursor: 0 });
      }
    }
  }
  // A component DAG can still create an import-unit cycle when coupled siblings
  // require opposite packages. Order whole units, never just their components.
  const unitEdges = new Map([...selectedUnits].map(id => [id, new Set()]));
  const unitFor = id => [...selectedUnits].find(unitId => units.get(unitId)[0].members.some(ref => refId(ref) === id));
  for (const [id, targets] of edges) {
    const sourceUnit = unitFor(id);
    for (const target of targets) {
      const targetUnit = unitFor(target);
      if (sourceUnit && targetUnit && sourceUnit !== targetUnit) unitEdges.get(sourceUnit).add(targetUnit);
    }
  }
  const unitOrder = [], pending = new Set(selectedUnits);
  while (pending.size) {
    const available = [...pending].filter(id => [...unitEdges.get(id)].every(target => !pending.has(target))).sort(compare);
    if (!available.length) { block('native-import-unit-cycle', { unitIds: [...pending].sort(compare) }); break; }
    for (const id of available) { pending.delete(id); unitOrder.push(id); }
  }
  const targetPreconditions = [];
  for (const unitId of [...selectedUnits].sort(compare)) {
    const condition = units.get(unitId)[0].targetPrecondition;
    if (!['empty-target', 'existing-target'].includes(condition?.mode) || !nonempty(condition?.evidenceRef) || !nonempty(condition?.targetProfileDigest) ||
        condition.mode === 'existing-target' && !nonempty(condition.requiredBaselineDigest)) block('unknown-target-precondition', { unitId });
    else targetPreconditions.push({ unitId, mode: condition.mode, evidenceRef: condition.evidenceRef, targetProfileDigest: condition.targetProfileDigest,
      ...(condition.mode === 'existing-target' ? { requiredBaselineDigest: condition.requiredBaselineDigest } : {}) });
  }
  const targetProfiles = new Set(targetPreconditions.map(row => row.targetProfileDigest));
  if (request.kind === 'server' && nonempty(serverInventory?.targetProfileDigest)) targetProfiles.add(serverInventory.targetProfileDigest);
  if (targetProfiles.size > 1) block('inconsistent-target-profile');
  const sorted = values => [...values].sort((a, b) => compare(canonical(a), canonical(b)));
  const requestedScope = { kind: request.kind, ...(request.kind === 'solution' ? { solution: request.solution } :
    request.kind === 'application' ? { solution: request.solution ?? null, applicationId: request.applicationId ?? null } :
    request.kind === 'part' ? { component: request.component ? refOf(request.component) : null, partId: request.partId ?? null } : {}) };
  return freeze({ schemaVersion: 1, requestedScope,
    requiredComponents: [...required].sort(compare).map(id => ({ ...refOf(components.get(id)[0]), digest: components.get(id)[0].digest })),
    requestedComponents: [...requested].sort(compare).map(id => refOf(components.get(id)[0])),
    expansions: sorted(expansions.values()), nativeImportUnits: [...selectedUnits].sort(compare),
    nativeImportOrder: pending.size || [...blockers.values()].some(row => row.reason === 'dependency-cycle') ? null : unitOrder, targetPreconditions,
    dependencyOrder: [...blockers.values()].some(row => row.reason === 'dependency-cycle') ? null : order.map(id => refOf(components.get(id)[0])),
    prerequisites: sorted(prerequisites.values()), blockers: sorted(blockers.values()),
    optionalReferences: sorted([...captures.entries()].filter(([solution]) => queue.some(id => components.get(id)[0].solution === solution))
      .flatMap(([solution, rows]) => rows.flatMap(row => (row.dependencies?.rows || []).filter(dep => dep.category === 'optionalDependencies')
        .map(dep => ({ solution, service: dep.service, namespace: dep.targetNamespace, code: dep.targetCode, status: 'excluded-optional' }))))),
    planningComplete: blockers.size === 0, publicationReady: false, executionEnabled: false,
    limitations: ['Adapter declarations are planning evidence, not native installability or entitlement verification.',
      'Dynamic references require separate binding and affected business-flow evidence.', 'No package materialization, candidate eligibility or provider execution is performed.'] });
}
