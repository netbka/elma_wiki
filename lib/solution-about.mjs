import crypto from 'node:crypto';
import { moduleCards, objectLabel } from '../web/managed/model.js';
import { about as aboutLabels } from '../web/managed/labels.js';

// UX-05 "О решении": the purpose paragraph and the module descriptions are
// explanations with their own scopes. Both are generated from the accepted
// state's declared names only (entity names, namespaces, kinds); no captured
// bytes are read and nothing about ELMA behaviour is claimed. People edit and
// save them through the existing explanation store, so author and history are
// kept the same way as for processes and steps.
export const ABOUT_SCOPES = ['solution-purpose', 'module'];
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(Error(message), { statusCode }); };
const names = rows => rows.map(row => objectLabel(row).text).filter(Boolean);
const list = (label, rows, limit = 6) => rows.length ? `${label}: ${names(rows).slice(0, limit).join(', ')}${rows.length > limit ? ` и ещё ${rows.length - limit}` : ''}.` : '';

export function modulePurpose(card) {
  return [list(aboutLabels.processesList, card.processes), list(aboutLabels.screensList, card.forms), list(aboutLabels.dataList, card.data)].filter(Boolean).join(' ')
    || aboutLabels.moduleNoNames;
}

export function solutionPurposeDraft(state) {
  const cards = moduleCards(state.current || []);
  const paragraphs = [];
  if (!cards.length) paragraphs.push(aboutLabels.noModules);
  else {
    paragraphs.push(`${aboutLabels.purposeIntro} ${cards.map(card => `«${objectLabel({ code: card.module, name: card.name, namespace: card.module }).text}»`).join(', ')}.`);
    for (const card of cards) paragraphs.push(`${objectLabel({ code: card.module, name: card.name, namespace: card.module }).text}. ${modulePurpose(card)}`);
  }
  paragraphs.push(aboutLabels.purposeLimits);
  return paragraphs.join('\n\n');
}

export function aboutContext(record, target) {
  const state = record.state, writable = state.status === 'active';
  const reason = writable ? null : aboutLabels.archivedReadOnly;
  const base = { related: [], target: structuredClone(target), expectedRevision: state.revision, writable, reason };
  if (target.scope === 'solution-purpose') {
    if (target.artifactId !== undefined || target.source !== undefined || target.nodeId !== undefined || target.module !== undefined) fail('Описание решения относится к принятому состоянию');
    const fingerprint = hash(state.current.map(row => [row.key, row.digest]).sort((a, b) => a[0].localeCompare(b[0])));
    return { ...base, key: 'solution-purpose', fingerprint, title: state.name,
      draft: { text: solutionPurposeDraft(state), sources: [], engine: 'declared-names-v1', evidence: 'declared-names', nativeObservation: 'absent' } };
  }
  if (typeof target.module !== 'string' || !target.module || target.module.length > 160 || target.artifactId !== undefined || target.source !== undefined || target.nodeId !== undefined) fail('Выберите модуль');
  const card = moduleCards(state.current || []).find(row => row.module === target.module);
  if (!card) fail('Модуль не найден в принятом состоянии', 404);
  const rows = [...card.processes, ...card.forms, ...card.data, ...card.other];
  const fingerprint = hash(rows.map(row => [row.key, row.digest]).sort((a, b) => a[0].localeCompare(b[0])));
  return { ...base, key: JSON.stringify(['module', card.module]), fingerprint, title: objectLabel({ code: card.module, name: card.name, namespace: card.module }).text,
    draft: { text: `${modulePurpose(card)}\n\n${aboutLabels.purposeLimits}`, sources: [], engine: 'declared-names-v1', evidence: 'declared-names', nativeObservation: 'absent' } };
}
