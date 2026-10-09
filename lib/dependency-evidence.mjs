const code = value => typeof value === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
export function readDependencyCatalog(evidence) {
  if (evidence === undefined) return [];
  if (evidence?.schemaVersion !== 1 || !Array.isArray(evidence.catalog) || evidence.catalog.length > 100) throw Error('Unsupported dependency evidence');
  const seen = new Set();
  return evidence.catalog.map(row => {
    if (!code(row?.code) || seen.has(row.code) || !Array.isArray(row.namespaces) || row.namespaces.length > 100 || row.namespaces.some(value => !code(value)) ||
        ![true, false, null].includes(row.paid) || row.version !== null && (typeof row.version !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(row.version)) ||
        typeof row.observedAt !== 'string' || !Number.isFinite(Date.parse(row.observedAt))) throw Error('Invalid dependency catalog');
    seen.add(row.code);
    return { code: row.code, paid: row.paid, version: row.version, namespaces: [...new Set(row.namespaces)].sort(), observedAt: row.observedAt,
      evidence: 'catalog-assertion', paidEvidence: ['source-catalog', 'cli-paid-refusal'].includes(row.paidEvidence) ? row.paidEvidence : 'unspecified', activation: 'unknown', compatibility: 'not-verified' };
  });
}
export function dependencyReport(declarations = [], { catalog = [], components = [], provenance = 'manual-upload' } = {}) {
  const rows = declarations.map(dep => {
    const required = ['dependencies', 'internalDependencies'].includes(dep.category);
    const matches = components.filter(entity => entity.coverage === 'structural' && entity.service === dep.service && entity.namespace === dep.targetNamespace && entity.code === dep.targetCode);
    const providers = [...new Set(matches.map(entity => entity.solution).filter(Boolean))];
    const catalogCandidates = catalog.filter(row => row.code === dep.ownerCode || row.namespaces.some(ns => dep.targetNamespace === ns || dep.targetNamespace?.startsWith(ns + '.')));
    const candidates = catalogCandidates.map(({code, paid, version, observedAt}) => ({code, paid, version, observedAt}));
    const status = dep.status === 'unknown-schema' || !dep.targetNamespace || !dep.targetCode ? 'unknown-identity' : matches.length > 1 ? 'ambiguous-provider' :
      matches.length ? 'component-source-present' : candidates.length > 1 ? 'ambiguous-provider' : candidates[0]?.paid === true ? 'paid-source-unavailable' : candidates.length ? 'catalog-present-source-unavailable' : 'provider-not-observed';
    return { category: dep.category, required, service: dep.service, targetNamespace: dep.targetNamespace ?? null, targetCode: dep.targetCode ?? null,
      source: { namespace: dep.source?.namespace ?? null, code: dep.source?.code ?? null, service: dep.source?.service ?? null }, ownerCode: dep.ownerCode ?? null, status, providers, candidates,
      sourceAvailability: matches.length ? 'readable' : 'unavailable', versionCompatibility: 'not-verified', activation: 'unknown' };
  });
  return { schemaVersion: 1, provenance, rows, publicationReady: false, targetVerification: 'not-run',
    limitations: ['Catalog membership does not prove referenced component existence, activation or runtime compatibility.', 'Source absence is not evidence of component deletion.'] };
}
