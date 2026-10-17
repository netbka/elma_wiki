import { dateLabel } from './model.js';
import { mountDelivery } from '../releases/delivery.js';
import { buildEligibility, buildGateLabels, buildGateStatuses, buildBlockReasons, grouping, candidateEvidence, composerBuild, targetProfileRefresh as profileLabels } from './labels.js';
// Solution composer (#94 MR-06): a pure projection of server-frozen composed
// candidates plus the server's build capability. The server stays authoritative:
// it builds the accepted merged revision, holds the validated build and freezes it
// on confirmation; evidence labels never grant delivery.
export const composerMissingLabels = {
  'native-materialization-worker': 'нативный исполнитель сборки, реализующий опубликованный контракт',
  'versioned-materialization-request-contract': 'версионированный запрос нативной сборки',
  'baseline-preserving-stage-service': 'подготовка с сохранением исходной версии',
  'process-runtime-compiler': 'компилятор процессов',
  'native-package-validation-receipt': 'квитанция проверки нативного пакета',
  'manifest-regeneration-policy': 'правила пересборки manifest',
  'isolated-native-assembler': 'изолированный нативный сборщик'
};
const statusLabels = {
  stale: 'Устарел: принятые изменения, решение конфликта или рецензия изменились после сборки',
  'awaiting-approval': 'Собран; точные байты ещё не приняты',
  approved: 'Точные байты приняты; доставка только через проверяемую попытку'
};
// Unknown gap keys stay visible with a neutral label; nothing is hidden or reworded as solved.
export const composerMissingLabel = key => composerMissingLabels[key] || `не описанное требование: ${key}`;
// The reason reflects what the server reports: pinned contracts vs. none, never a fixed claim.
export function composerBuildView(build) {
  const available = build?.available === true, reference = build?.reference || 'netbka/elma365#60';
  const contracts = Array.isArray(build?.contracts) ? build.contracts.filter(row => typeof row === 'string') : [];
  const reason = available ? '' : contracts.length
    ? `Нативная сборка конфигурации недоступна: контракт ${contracts.join(', ')} закреплён, но его ещё никто не исполняет (${reference}).`
    : build?.contracts ? `Нативная сборка конфигурации недоступна: закреплённого контракта материализации ELMA нет (${reference}).`
    : `Нативная сборка конфигурации недоступна: сервис не сообщил её возможность (${reference}).`;
  return { available, reason, contracts, reference,
    missing: available ? [] : (Array.isArray(build?.missing) ? build.missing : []).map(composerMissingLabel) };
}

// One readable line per blocking reason: its label plus the object, unit or module it names.
// Unknown reason keys stay visible with a neutral label, never hidden or reworded as solved.
const reasonText = key => buildBlockReasons[key] || `${buildEligibility.unknownReason} ${key}`;
const codeOf = key => { try { const parts = JSON.parse(key); return Array.isArray(parts) ? parts.at(-1) : key; } catch { return key; } };
export function buildReasonLine(row = {}) {
  const subject = row.unitId ? `${buildEligibility.unit} ${row.unitId}`
    : row.code && row.namespace ? `${buildEligibility.module} ${row.namespace}.${row.code}`
    : row.key ? `${buildEligibility.object} ${codeOf(row.key)}`
    : Array.isArray(row.components) ? row.components.map(item => codeOf(item.key)).join(' → ')
    : Array.isArray(row.unitIds) ? row.unitIds.join(', ') : row.domain || '';
  const details = [...(Array.isArray(row.members) ? [`${buildEligibility.object} ${row.members.map(item => codeOf(item.key)).join(', ')}`] : []),
    ...(row.fact ? [`${buildEligibility.fact} ${reasonText(row.fact)}`] : []),
    ...(Array.isArray(row.details) ? row.details.map(reasonText) : []), ...(Array.isArray(row.missing) ? row.missing.map(composerMissingLabel) : [])];
  return [reasonText(row.reason), subject, details.join(', ')].filter(Boolean).join(' · ');
}
// A whole Solution can block per object: each reason keeps its first rows and counts the rest.
const SHOWN_PER_REASON = 5;
function reasonLines(rows) {
  const groups = new Map();
  for (const row of rows) groups.set(row.reason, [...(groups.get(row.reason) || []), row]);
  return [...groups.values()].flatMap(group => [...group.slice(0, SHOWN_PER_REASON).map(buildReasonLine),
    ...(group.length > SHOWN_PER_REASON ? [`${reasonText(group[0].reason)} · ${grouping.andMore} ${group.length - SHOWN_PER_REASON}`] : [])]);
}
// The server's per-Solution eligibility: every gate with its status and reasons. A missing
// or failed read leaves the build unavailable and says so.
export function buildEligibilityView(eligibility) {
  if (!eligibility || eligibility.loadError || !Array.isArray(eligibility.gates)) return { eligible: false, loaded: false, gates: [] };
  const gates = eligibility.gates.map(gate => ({ id: gate.id, label: buildGateLabels[gate.id] || gate.id, status: gate.status,
    statusLabel: buildGateStatuses[gate.status] || buildGateStatuses.unknown, reasons: reasonLines(gate.reasons || []) }));
  return { eligible: eligibility.eligible === true && gates.every(gate => gate.status === 'verified'), loaded: true, gates };
}

// The operator's Target profile refresh as the server reports it next to eligibility. Only a
// server-reported configured bridge, an operator session and a known Solution revision offer it.
const profileDetail = key => profileLabels.details[key] || `${profileLabels.unknownDetail} ${key}`;
export function targetProfileView(eligibility) {
  const refresh = eligibility && !eligibility.loadError ? eligibility.targetProfileRefresh : null;
  if (!refresh || typeof refresh !== 'object') return { shown: false };
  const last = refresh.last && typeof refresh.last === 'object' ? refresh.last : null;
  const list = value => Array.isArray(value) ? value.filter(row => typeof row === 'string') : [];
  const state = refresh.configured !== true ? (refresh.reason === 'target-not-designated' ? 'target-not-designated' : 'target-profile-observation-unconfigured')
    : refresh.inProgress === true ? 'in-progress' : refresh.current === true ? 'observed' : refresh.staleInputs === true ? 'stale'
    : last?.outcome === 'stale' ? 'moved' : ['unavailable', 'invalid', 'unknown'].includes(last?.outcome) ? last.outcome : 'never';
  const details = ['unavailable', 'invalid', 'unknown', 'moved'].includes(state) ? [...(last?.reason ? [last.reason] : []), ...list(last?.errors)].map(profileDetail) : [];
  const profile = state === 'observed' && last?.targetProfile ? last.targetProfile : null;
  const target = typeof refresh.target === 'string' ? refresh.target.toUpperCase() : null;
  const revision = Number.isInteger(eligibility.revision) ? eligibility.revision : null;
  return { shown: true, state, message: profileLabels.states[state], details, target,
    profile: profile ? `${profileLabels.profile} ${target ?? ''} · ${profileLabels.platform} ${profile.platformVersion} · ${String(profile.digest).slice(0, 12)} · ${profileLabels.observedAt} ${dateLabel(profile.observedAt)}` : '',
    evidence: refresh.configured === true ? buildEvidenceView(refresh) : null,
    operator: refresh.configured === true && refresh.operator === true, expectedRevision: revision,
    canRefresh: refresh.configured === true && refresh.operator === true && refresh.inProgress !== true && revision !== null };
}
// Native build evidence held with the profile, as the server reports it. Only the server's `use`
// verdict for the current inputs makes it current; anything else names why it does not count.
const evidenceLabels = profileLabels.evidence;
export function buildEvidenceView(refresh) {
  const row = refresh?.buildEvidence;
  if (!row || typeof row !== 'object' || row.configured !== true) return null;
  const last = row.last && typeof row.last === 'object' ? row.last : null;
  const list = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
  const state = row.current === true && row.use?.status === 'current' ? 'current' : row.expired === true ? 'expired' : last?.outcome === 'produced' ? 'stale'
    : ['unavailable', 'invalid', 'unknown', 'not-requested'].includes(last?.outcome) ? last.outcome : 'none';
  const details = ['unavailable', 'invalid', 'unknown', 'not-requested'].includes(state) ? [...(last?.reason ? [last.reason] : []), ...list(last?.errors)]
    : state === 'none' ? list(row.inputBlockers) : [];
  const fact = key => evidenceLabels.facts[key] || `${profileLabels.unknownDetail} ${key}`;
  return { state, message: evidenceLabels.states[state], details: details.map(profileDetail),
    compiler: state === 'current' && list(last?.compilerServices).length ? `${evidenceLabels.compiler} ${list(last.compilerServices).map(key => evidenceLabels.services[key] || key).join(', ')}` : '',
    missing: state === 'current' && list(last?.missing).length ? `${evidenceLabels.missing} ${list(last.missing).map(fact).join(', ')}` : '' };
}
// A refused, failed or lost refresh request as one notice. A moved Solution, a running read or an
// unknown outcome needs a fresh read before another one; nothing is repeated automatically.
export function targetProfileFailureView(error = {}) {
  if (!error.status) return { message: error.requiresRefresh ? profileLabels.lost : error.message || profileLabels.outcomes.unknown, reasons: [], refresh: true };
  const body = error.body && typeof error.body === 'object' ? error.body : {};
  const reasons = [...(typeof body.reason === 'string' ? [body.reason] : []), ...(Array.isArray(body.errors) ? body.errors.filter(row => typeof row === 'string') : [])].map(profileDetail);
  return { message: profileLabels.outcomes[body.outcome] || profileLabels.outcomes.refused, reasons,
    refresh: !!error.requiresRefresh || ['stale', 'in-progress', 'unknown'].includes(body.outcome) };
}

// A refused or lost build/freeze request as one notice. A request whose inputs
// moved (or whose response was lost) needs a fresh read before another build;
// a blocked or failed build may be retried as is.
const RETRYABLE = new Set(['blocked', 'unavailable', 'failed', 'tool-fault', 'unbound-receipt', 'output-rejected', 'no-validated-build', 'foreign-build']);
export function buildFailureView(error = {}) {
  if (!error.status) return error.requiresRefresh ? { message: composerBuild.lost, reasons: [], refresh: true }
    : { message: error.message || composerBuild.outcomes.unknown, reasons: [], refresh: false };
  const body = error.body && typeof error.body === 'object' ? error.body : {};
  const key = body.outcome === 'refused' ? body.reason : body.outcome;
  const list = value => Array.isArray(value) ? value.filter(row => row && typeof row.reason === 'string') : [];
  const gates = Array.isArray(body.gates) ? body.gates.flatMap(gate => reasonLines(list(gate?.reasons))) : [];
  const reasons = [...gates, ...reasonLines([...list(body.blockers), ...list(body.reasons)])];
  const refresh = !!error.requiresRefresh || !RETRYABLE.has(key);
  return { message: composerBuild.outcomes[key] || (error.status === 409 ? composerBuild.outcomes.changed : composerBuild.outcomes.unknown), reasons, refresh };
}

export function composedCandidateRow(record) {
  const approved = !!record.approval && record.approval.revision === record.revision;
  const status = record.inputsStatus === 'stale' ? 'stale' : approved ? 'approved' : 'awaiting-approval';
  const native = record.evidenceBasis === 'native';
  const synthetic = record.evidenceBasis === 'synthetic';
  const releaseEligible = native && record.releaseEligible === true && !(record.pendingNativeEvidence?.length);
  return { id: record.id, revision: record.revision, status, statusLabel: statusLabels[status],
    sha256: record.candidate.sha256, shortSha: record.candidate.sha256.slice(0, 12), size: record.candidate.size,
    createdAt: dateLabel(record.createdAt), frozenBy: record.frozenBy?.login || 'Автор не зафиксирован',
    units: (record.units || []).map(unit => ({ id: unit.id, adapter: unit.adapter })),
    platformVersion: record.targetProfile?.platformVersion || 'не установлена', native, releaseEligible,
    evidenceLabel: native ? releaseEligible ? 'Нативная сборка; пригодность к выпуску требует проверки на Target'
      : candidateEvidence.nativePending
      : synthetic ? 'Учебная сборка (синтетический сборщик): не нативный пакет ELMA, к выпуску не допускается; доставка только на учебный стенд'
      : candidateEvidence.unknown,
    approval: approved ? { actor: record.approval.actor?.login || 'Автор не зафиксирован', at: dateLabel(record.approval.at), reason: record.approval.reason } : null,
    canApprove: status === 'awaiting-approval', canRevoke: status === 'approved', deliverable: record.deliverable === true && status === 'approved' };
}

// Shape consumed by the shared delivery renderer; the server re-checks everything.
export const composedDeliveryRelease = record => ({ id: record.id, revision: record.revision, approval: record.approval, candidate: record.candidate,
  code: record.code, blockers: [], associationStatus: record.inputsStatus === 'stale' ? 'stale' : 'current' });

export function composerView({ candidates = [], build = null, eligibility = null, selectedId = null } = {}) {
  const rows = [...candidates].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(composedCandidateRow);
  const gates = buildEligibilityView(eligibility), materialization = composerBuildView(build);
  // A build is offered only when native materialization is available and every eligibility gate is verified.
  const buildView = { ...materialization, available: materialization.available && gates.eligible, eligibility: gates,
    reason: materialization.available && !gates.eligible ? buildEligibility.blockedSummary : materialization.reason };
  const current = rows.filter(row => row.status !== 'stale');
  const selected = rows.find(row => row.id === selectedId) || null;
  const summary = !rows.length ? buildView.available ? 'Принятая версия ещё не собрана.' : 'Собранных конфигураций нет. ' + buildView.reason
    : !current.length ? 'Все сборки устарели. Нужна новая сборка для текущих принятых изменений.'
    : current.some(row => row.status === 'approved') ? 'Есть принятая сборка. Проверьте её доставкой и чтением результата.'
    : 'Есть сборка, ожидающая решения по точным байтам.';
  return { rows, build: buildView, targetProfile: targetProfileView(eligibility), selected, summary, missingSelection: !!selectedId && !selected };
}

export function composerGate(row, action, reason = '') {
  if (!row) return 'Сборка не выбрана.';
  if (row.status === 'stale') return 'Сборка устарела; решение по ней недоступно.';
  if (action === 'approve' && !row.canApprove) return 'Сборка уже принята.';
  if (action === 'revoke' && !row.canRevoke) return 'Принятие уже отозвано.';
  if (!reason.trim()) return 'Укажите причину решения.';
  return '';
}

const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
let sequence = 0;
// model: { candidates, build, selected (full record or null), error, loadError }
// actions: { link(label, href, primary), candidateHref(id), listHref, change(id, input), deliveryClient }
export function mountComposer(model = {}, actions = {}) {
  const root = el('section', undefined, 'managed-composer'); root.setAttribute('aria-label', 'Сборка конфигурации');
  const heading = el('h2', 'Сборка конфигурации'); heading.tabIndex = -1;
  const status = el('p', '', 'managed-notice'); status.setAttribute('role', 'status');
  const error = el('div', model.error || '', 'managed-error'); error.setAttribute('role', 'alert');
  root.append(heading, el('p', 'Принятые изменения → сборка неизменяемой конфигурации → решение по точным байтам → доставка и чтение результата на Target.', 'managed-muted'), status, error);
  const link = actions.link || ((label, href) => { const a = el('a', label, 'managed-link'); a.href = href; return a; });
  if (model.loadError) {
    root.append(el('p', 'Состояние сборок не получено. Действия недоступны до успешной загрузки.'), link('Повторить загрузку сборок', actions.listHref, true));
    return root;
  }
  const view = composerView({ candidates: model.candidates, build: model.build, eligibility: model.eligibility, selectedId: model.selected?.id ?? model.selectedId });
  root.append(el('p', view.summary));

  const build = el('div', undefined, 'managed-card'); build.setAttribute('aria-label', 'Новая сборка');
  const target = model.target ?? null, canBuild = view.build.available && !!target && typeof actions.build === 'function' && typeof actions.freeze === 'function';
  const start = el('button', composerBuild.start); start.type = 'button'; start.disabled = !canBuild;
  if (!canBuild) start.dataset.unavailable = 'true';
  build.append(el('h3', 'Новая сборка'), start);
  if (view.build.available) build.append(el('p', target ? composerBuild.ready : composerBuild.noMerge, target ? 'managed-muted' : 'managed-note'));
  else {
    build.append(el('p', view.build.reason, 'managed-note'));
    if (view.build.missing.length) { const list = el('ul'); list.setAttribute('aria-label', 'Чего не хватает для нативной сборки'); view.build.missing.forEach(text => list.append(el('li', text))); build.append(list); }
    build.append(el('p', 'Нерабочая сборка не изображается рабочей: учебные сборки ниже созданы синтетическим сборщиком и не являются пакетом ELMA.', 'managed-muted'));
  }
  const outcome = el('div', undefined, 'managed-build-outcome');
  build.append(outcome, mountEligibility(view.build.eligibility));
  if (view.targetProfile.shown) build.append(mountTargetProfile(view.targetProfile, actions, { status, error, link }));
  root.append(build);
  if (canBuild) mountBuildFlow({ start, outcome, status, error, target, actions, link });

  if (view.missingSelection) root.append(el('p', 'Выбранная сборка не найдена в этом решении.', 'managed-note'));
  const list = el('div', undefined, 'managed-list');
  for (const row of view.rows) {
    const card = el('article', undefined, 'managed-card');
    card.append(el('h3', `Сборка ${row.shortSha}`), el('p', row.statusLabel, row.status === 'approved' ? 'managed-accepted' : row.status === 'stale' ? 'managed-note' : ''),
      el('p', row.evidenceLabel, row.native ? 'managed-muted' : 'managed-note'),
      el('p', `${row.frozenBy} · ${row.createdAt} · единиц установки: ${row.units.length}`, 'managed-muted'));
    if (view.selected?.id !== row.id) card.append(link('Открыть сборку', actions.candidateHref?.(row.id)));
    else card.setAttribute('aria-current', 'true');
    list.append(card);
  }
  if (view.rows.length) root.append(el('h3', `Сборки · ${view.rows.length}`), list);
  if (view.selected && model.selected) root.append(mountCandidate(model.selected, view.selected, actions, { status, error }));
  return root;
}

// Build, then freeze: the server holds one validated build per Solution and freezes
// it only when this page confirms its manifest digest. Neither request is replayed
// after a lost response; a moved input needs a fresh read before another build.
function mountBuildFlow({ start, outcome, status, error, target, actions, link }) {
  let busy = false, blocked = false;
  const sync = () => { start.disabled = busy || blocked; };
  const fail = e => {
    const failure = buildFailureView(e);
    blocked = failure.refresh; status.textContent = '';
    const notice = el('div', undefined, 'managed-error'); notice.setAttribute('role', 'alert');
    notice.append(el('p', failure.message));
    if (failure.reasons.length) { const list = el('ul'); list.setAttribute('aria-label', composerBuild.reasons); failure.reasons.forEach(text => list.append(el('li', text))); notice.append(list); }
    if (failure.refresh) notice.append(link(composerBuild.refresh, actions.listHref, true));
    outcome.replaceChildren(notice); start.textContent = composerBuild.retry;
  };
  const validated = result => {
    const manifest = result?.manifest;
    if (result?.outcome !== 'validated' || manifest?.status !== 'materialized'
      || !/^[a-f0-9]{64}$/.test(manifest?.manifestDigest) || !Array.isArray(manifest.artifacts)) {
      fail({ status: 502, body: { outcome: 'invalid-response' }, requiresRefresh: true }); return;
    }
    const freeze = el('button', composerBuild.freeze); freeze.type = 'button';
    freeze.onclick = async () => {
      if (busy || blocked) return;
      busy = true; freeze.disabled = true; sync(); error.textContent = ''; status.textContent = composerBuild.freezing;
      try { await actions.freeze({ ...target, manifestDigest: manifest.manifestDigest }); status.textContent = composerBuild.frozen; }
      catch (e) { fail(e); } finally { busy = false; sync(); }
    };
    outcome.replaceChildren(el('p', composerBuild.validated, 'managed-accepted'),
      el('p', `${composerBuild.manifest}: ${manifest.manifestDigest.slice(0, 12)} · ${composerBuild.artifacts}: ${(manifest.artifacts || []).length}`, 'change-text'), freeze);
    start.textContent = composerBuild.retry;
  };
  start.onclick = async () => {
    if (busy || blocked) return;
    busy = true; sync(); error.textContent = ''; outcome.replaceChildren(); status.textContent = composerBuild.running;
    try { const result = await actions.build(target); status.textContent = ''; validated(result); }
    catch (e) { fail(e); } finally { busy = false; sync(); }
  };
}

// Each gate with its status; a gate that is not verified lists every reason it blocks.
function mountEligibility(eligibility) {
  const root = el('div', undefined, 'managed-eligibility');
  root.append(el('h4', buildEligibility.heading));
  if (!eligibility.loaded) { root.append(el('p', buildEligibility.notLoaded, 'managed-note')); return root; }
  const list = el('ul'); list.setAttribute('aria-label', buildEligibility.listName);
  for (const gate of eligibility.gates) {
    const item = el('li'); item.dataset.gate = gate.id; item.dataset.status = gate.status;
    item.append(el('strong', gate.label), document.createTextNode(': ' + gate.statusLabel));
    if (gate.reasons.length) { const reasons = el('ul'); reasons.setAttribute('aria-label', gate.label); gate.reasons.forEach(text => reasons.append(el('li', text))); item.append(reasons); }
    list.append(item);
  }
  root.append(list);
  return root;
}

// The operator's explicit read-only Target profile refresh. One request per click; a lost
// response or moved Solution disables it until a fresh read of the page.
function mountTargetProfile(view, actions, { status, error, link }) {
  const root = el('div', undefined, 'managed-target-profile'); root.setAttribute('role', 'group'); root.setAttribute('aria-label', profileLabels.heading);
  root.dataset.state = view.state;
  root.append(el('h4', profileLabels.heading), el('p', view.message, view.state === 'observed' ? 'managed-accepted' : 'managed-note'));
  if (view.profile) root.append(el('p', view.profile, 'change-text'));
  if (view.details.length) { const list = el('ul'); list.setAttribute('aria-label', profileLabels.reasons); view.details.forEach(text => list.append(el('li', text))); root.append(list); }
  if (view.evidence) {
    const evidence = el('div', undefined, 'managed-build-evidence'); evidence.setAttribute('role', 'group'); evidence.setAttribute('aria-label', profileLabels.evidence.heading);
    evidence.dataset.state = view.evidence.state;
    evidence.append(el('h5', profileLabels.evidence.heading), el('p', view.evidence.message, view.evidence.state === 'current' ? 'managed-accepted' : 'managed-note'));
    if (view.evidence.compiler) evidence.append(el('p', view.evidence.compiler, 'change-text'));
    if (view.evidence.missing) evidence.append(el('p', view.evidence.missing, 'managed-muted'));
    if (view.evidence.details.length) { const list = el('ul'); list.setAttribute('aria-label', profileLabels.evidence.reasons); view.evidence.details.forEach(text => list.append(el('li', text))); evidence.append(list); }
    root.append(evidence);
  }
  if (['target-profile-observation-unconfigured', 'target-not-designated'].includes(view.state)) return root;
  if (!view.operator) { root.append(el('p', profileLabels.operatorOnly, 'managed-muted')); return root; }
  const start = el('button', `${profileLabels.start}${view.target ? ' ' + view.target : ''}`); start.type = 'button';
  const outcome = el('div', undefined, 'managed-profile-outcome');
  let busy = false, blocked = !view.canRefresh || typeof actions.refreshTargetProfile !== 'function';
  const sync = () => { start.disabled = busy || blocked; };
  start.onclick = async () => {
    if (busy || blocked) return;
    busy = true; sync(); error.textContent = ''; outcome.replaceChildren(); status.textContent = profileLabels.running;
    try { await actions.refreshTargetProfile({ expectedRevision: view.expectedRevision }); status.textContent = profileLabels.done; }
    catch (e) {
      const failure = targetProfileFailureView(e);
      blocked = failure.refresh; status.textContent = '';
      const notice = el('div', undefined, 'managed-error'); notice.setAttribute('role', 'alert');
      notice.append(el('p', failure.message));
      if (failure.reasons.length) { const list = el('ul'); list.setAttribute('aria-label', profileLabels.reasons); failure.reasons.forEach(text => list.append(el('li', text))); notice.append(list); }
      if (failure.refresh) notice.append(link(profileLabels.refresh, actions.listHref, true));
      outcome.replaceChildren(notice);
    } finally { busy = false; sync(); }
  };
  sync();
  root.append(start, el('p', profileLabels.readOnly, 'managed-muted'), outcome);
  return root;
}

function mountCandidate(record, row, actions, { status, error }, initialDrafts = new Map()) {
  const root = el('section', undefined, 'managed-card'); root.setAttribute('aria-label', 'Выбранная сборка');
  root.append(el('h3', `Выбранная сборка ${row.shortSha}`), el('p', row.statusLabel, row.status === 'approved' ? 'managed-accepted' : 'managed-note'),
    el('p', `SHA-256: ${row.sha256} · ${row.size} байт · платформа Target: ${row.platformVersion}`, 'change-text'), el('p', row.evidenceLabel));
  const units = el('ol'); units.setAttribute('aria-label', 'Порядок импорта');
  row.units.forEach(unit => units.append(el('li', `${unit.id} · ${unit.adapter}`))); root.append(el('h4', 'Порядок импорта'), units);
  if (row.approval) root.append(el('p', `Принял ${row.approval.actor} · ${row.approval.at}: ${row.approval.reason}`, 'change-text'));
  // `blocked` follows a conflict or lost response; a stale candidate still loads its history read-only.
  let busy = false, blocked = false;
  if (row.canApprove || row.canRevoke) {
    const action = row.canApprove ? 'approve' : 'revoke', form = el('form'), gate = el('p', '', 'managed-note');
    const caption = el('label', row.canApprove ? 'Причина принятия точных байтов' : 'Причина отзыва принятия'), reason = el('textarea');
    reason.id = 'managed-composer-reason-' + ++sequence; caption.htmlFor = reason.id; reason.required = true; reason.maxLength = 4000;
    const submit = el('button', row.canApprove ? 'Принять сборку' : 'Отозвать принятие'); submit.type = 'submit';
    const update = () => { gate.textContent = composerGate(row, action, reason.value); submit.disabled = busy || blocked || !!gate.textContent; };
    reason.oninput = update;
    form.append(caption, reason, el('p', 'Принятие относится к рецензии точных байтов. Оно не разрешает импорт и не выбирает Target.', 'managed-muted'), gate, submit);
    form.onsubmit = async event => {
      event.preventDefault(); if (busy || blocked || composerGate(row, action, reason.value)) return;
      busy = true; update(); error.textContent = ''; status.textContent = 'Сохраняем. Дождитесь ответа…';
      try { await actions.change(record.id, { action, revision: record.revision, reason: reason.value }); status.textContent = 'Сохранено. Открываем обновлённое состояние…'; }
      catch (e) {
        blocked = e.status === 409 || !!e.requiresRefresh; status.textContent = '';
        error.textContent = e.message || 'Не удалось выполнить действие.';
        if (blocked) error.append(el('p', 'Проверьте актуальное состояние перед повтором. Введённый текст сохранён на этой странице.'), (actions.link || (() => el('span')))('Обновить состояние', actions.candidateHref?.(record.id), true));
      } finally { busy = false; update(); }
    };
    root.append(form); update();
  } else if (row.status === 'stale') root.append(el('p', 'Решение и доставка недоступны: соберите конфигурацию заново для текущих принятых изменений. История сохраняется.', 'managed-note'));
  if (actions.deliveryClient && row.status !== 'awaiting-approval') {
    // Same contract as the handoff: a write whose response is lost is never replayed;
    // the section is redrawn only from a fresh server read.
    const replace = async (operation, drafts) => {
      error.textContent = '';
      try {
        const next = await operation();
        const replacement = mountCandidate(next, composedCandidateRow(next), actions, { status, error }, drafts);
        root.replaceWith(replacement); replacement.querySelector('.release-delivery h2')?.focus({ preventScroll: true });
      } catch (e) {
        blocked = blocked || e.status === 409 && !e.recoverable || !!e.requiresRefresh;
        error.textContent = e.message || 'Не удалось выполнить действие.';
        if (blocked) root.querySelectorAll('button').forEach(node => { node.disabled = true; });
        if (blocked) error.append(el('p', 'Проверьте актуальное состояние перед повтором; операция не повторяется автоматически.'), (actions.link || (() => el('span')))('Обновить состояние', actions.candidateHref?.(record.id), true));
      }
    };
    const panel = mountDelivery({ release: composedDeliveryRelease(record), client: actions.deliveryClient, isBlocked: () => busy || blocked, initialDrafts,
      onAction: input => replace(() => actions.deliveryClient.act(record.id, input), panel.getDrafts()),
      onRefresh: () => replace(() => actions.deliveryClient.refresh(record.id), panel.getDrafts()) });
    root.append(panel);
  } else if (row.status === 'awaiting-approval') root.append(el('p', 'Доставка станет доступна после принятия точных байтов.', 'managed-muted'));
  return root;
}
