import { comparisons as text } from './labels.js';
import { objectLabel } from './model.js';

const el = (tag, value) => { const node = document.createElement(tag); if (value !== undefined) node.textContent = value; return node; };
const option = (value, label) => { const node = el('option', label); node.value = value; return node; };
const digest = value => value ? value.slice(0, 12) + '…' : text.absent;
export function sourceComparisonView(comparison) {
  const comparable = comparison?.status === 'compared';
  const rows = comparison?.review?.rows || [];
  return { status: text.sourceStates[comparison?.status] || text.sourceStates['history-unavailable'],
    comparable, rows: comparable ? rows.filter(row => row.baselineDigest !== row.incomingDigest) : [],
    unchanged: comparable ? rows.filter(row => row.baselineDigest === row.incomingDigest) : [] };
}
function reference(parent, label, value, api) {
  const block = el('details'); block.append(el('summary', label));
  if (!value) block.append(el('p', text.absent));
  else {
    for (const item of [value.artifactId, value.checksum, value.snapshot?.source?.connectionId, value.snapshot?.source?.solutionRef]) if (item) block.append(el('p', item));
    if (api && value.artifactId) { const link = el('a', text.original); link.href = `${api}/artifacts/${encodeURIComponent(value.artifactId)}/original`; block.append(link); }
  }
  parent.append(block);
}
export function mountSourceComparisons({ history = [], api } = {}) {
  const root = el('section'); root.setAttribute('aria-label', text.sourceTitle);
  root.append(el('h2', text.sourceTitle), el('p', text.sourceMeaning));
  const select = el('select'); select.setAttribute('aria-label', text.capture);
  history.forEach((row, index) => select.append(option(String(index), `${index + 1} · ${row.after?.snapshot?.source?.connectionId || text.unknownSource} · ${row.after?.artifactId || text.absent}`)));
  select.value = String(history.length - 1);
  const body = el('div');
  const draw = () => {
    const comparison = history[Number(select.value)], view = sourceComparisonView(comparison);
    body.replaceChildren(el('p', view.status));
    if (!comparison) return;
    reference(body, text.beforeCapture, comparison.before, api); reference(body, text.afterCapture, comparison.after, api);
    if (!view.comparable) return;
    body.append(el('p', view.rows.length ? text.changed : text.noChanges));
    const table = rows => {
      const node = el('table'), header = el('tr');
      for (const value of [text.object, text.before, text.after]) header.append(el('th', value)); node.append(header);
      for (const row of rows) {
        const tr = el('tr'); tr.append(el('td', objectLabel(row).text));
        for (const value of [row.baselineDigest, row.incomingDigest]) { const cell = el('td', digest(value)); cell.title = value || text.absent; tr.append(cell); }
        node.append(tr);
      }
      const scroll = el('div'); scroll.className = 'managed-table'; scroll.tabIndex = 0; scroll.append(node); return scroll;
    };
    if (view.rows.length) body.append(table(view.rows));
    if (view.unchanged.length) { const details = el('details'); details.append(el('summary', `${text.unchanged} · ${view.unchanged.length}`), table(view.unchanged)); body.append(details); }
  };
  select.onchange = draw;
  if (history.length) root.append(select);
  root.append(body); draw(); return root;
}

export function installedObservationAt(record) {
  return [record?.createdAt, record?.installedObservation?.at, record?.comparison?.observed?.at,
    record?.readBack?.at, record?.evidence?.readBack?.at, record?.evidence?.verificationError?.at]
    .filter(value => Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) || null;
}
export function latestInstalledRecord(records, connectionId) {
  const sequence = record => record.installedObservation?.sequence ?? record.comparison?.before?.sequence ?? 0;
  return records.filter(row => row.connection?.id === connectionId).sort((a, b) =>
    (Date.parse(installedObservationAt(a)) || 0) - (Date.parse(installedObservationAt(b)) || 0) ||
    sequence(a) - sequence(b) || Number(!!a.comparison) - Number(!!b.comparison) ||
    String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id))).at(-1);
}
export function installedComparisonView(record, release, connectionId) {
  const comparison = record?.comparison;
  const proposed = record?.proposed || comparison?.proposed || record?.installedObservation?.candidate;
  const current = !!record && record.connection?.id === connectionId && proposed?.candidateId === release?.candidate?.id &&
    proposed?.sha256 === release?.candidate?.sha256 && proposed?.releaseRevision === release?.revision;
  const failed = record?.evidence?.verificationError?.at === installedObservationAt(record);
  const drifted = record?.evidence?.readBack?.at === installedObservationAt(record) && record.evidence.comparison?.match === false;
  return { current, status: !record ? text.notRead : !current ? text.stale : failed ? text.installedStates['observation-failed'] : drifted ? text.installedStates.drifted : record.installedObservation && !comparison ? text.observed : text.installedStates[comparison?.status] || text.notRead,
    delta: current && comparison?.status === 'compared' ? comparison.delta : null };
}
export function mountInstalledComparison({ release, connections = [], client, isBlocked = () => false } = {}) {
  const root = el('section'); root.setAttribute('aria-label', text.installedTitle);
  const targets = connections.filter(row => row.role === 'target' && (row.adapter === 'synthetic' ||
    row.id === 'preset-dev2' && row.preset?.available === true && row.preset.allowedOperations?.includes('readBack')));
  let selected = targets[0]?.id || '', records = [], busy = false, error = '', needsRefresh = false, sequence = 0;
  const draw = () => {
    root.replaceChildren(el('h3', text.installedTitle), el('p', text.installedMeaning));
    if (targets.find(row => row.id === selected)?.adapter === 'synthetic') root.append(el('p', text.synthetic));
    const status = el('p', busy ? text.loading : error); status.setAttribute('aria-live', error ? 'assertive' : 'polite'); root.append(status);
    const picker = el('select'); picker.setAttribute('aria-label', text.target);
    for (const row of targets) picker.append(option(row.id, row.name)); picker.value = selected; picker.disabled = busy;
    picker.onchange = () => { selected = picker.value; draw(); }; root.append(picker);
    if (!targets.length) root.append(el('p', text.noTarget));
    const record = latestInstalledRecord(records, selected), view = installedComparisonView(record, release, selected);
    root.append(el('p', view.status), el('p', text.businessUnknown));
    if (installedObservationAt(record)) root.append(el('p', `${text.observedAt} ${installedObservationAt(record)}`));
    if (record) {
      const detail = el('details'); detail.append(el('summary', text.evidence));
      for (const value of [installedObservationAt(record), record.targetIdentity?.host, record.proposed?.sha256 || record.installedObservation?.candidate?.sha256, record.comparison?.before?.candidate?.sha256, record.comparison?.evidenceBasis || record.installedObservation?.evidenceBasis]) if (value) detail.append(el('p', value));
      root.append(detail);
    }
    if (view.delta && !needsRefresh) for (const key of ['missing', 'different', 'unexpected']) {
      if (!view.delta[key]?.length) continue;
      const list = el('ul'); for (const path of view.delta[key] || []) list.append(el('li', path));
      root.append(el('h4', text.delta[key]), list);
    }
    if (view.delta?.match && !needsRefresh) root.append(el('p', text.noInstalledChanges));
    const actions = el('div'); actions.className = 'managed-actions'; root.append(actions);
    const add = (label, action, disabled = false) => { const button = el('button', label); button.className = 'secondary'; button.type = 'button'; button.dataset.unavailable = String(busy || disabled); button.disabled = busy || disabled || isBlocked(); button.onclick = action; actions.append(button); };
    add(text.refresh, () => run(), false);
    const eligible = !!selected && release?.approval?.revision === release?.revision && !!release?.candidate && release?.associationStatus !== 'stale';
    add(text.compareInstalled, () => run('compareInstalled'), !eligible || needsRefresh);
    add(text.reconcileInstalled, () => run('reconcileInstalled'), !eligible || needsRefresh);
    root.append(el('p', text.reconcileMeaning));
  };
  const run = async action => {
    if (busy || isBlocked()) return;
    const hadFocus = root.contains(document.activeElement);
    const turn = ++sequence; busy = true; error = ''; draw();
    try {
      if (action) await client.installedAction(release.id, { action, revision: release.revision, connectionId: selected });
      const history = await client.installedHistory(release.id);
      if (!Array.isArray(history)) throw Error('Invalid comparison history');
      if (turn === sequence) { records = history; needsRefresh = false; }
    } catch (failure) { error = action ? failure.status >= 400 && failure.status < 500 ? failure.message : text.responseUnknown : text.loadError; needsRefresh = true; }
    finally { busy = false; draw(); if (hadFocus && root.isConnected) { const heading = root.querySelector('h3'); heading.tabIndex = -1; heading.focus({ preventScroll: true }); } }
  };
  draw(); run(); return root;
}
