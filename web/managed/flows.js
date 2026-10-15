import { nouns, grouping, flows as flowLabels, tabs as tabLabels, facts, kindGroups } from './labels.js';
import { objectLabel, objectKind, groupObjects, responsibilityLabel, capturedArtifact, matchesQuery } from './model.js';
import { processSummary } from '../visual/model.js';
import { mountSnapshotVisual } from '../visual/render.js';

let sequence = 0;
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const title = (tag, row) => {
  const label = objectLabel(row), node = el(tag, label.text, label.technical ? 'managed-technical' : undefined);
  if (label.secondary) node.append(' ', el('small', label.secondary, 'managed-muted managed-code'));
  return node;
};
// One search box per tab: filters by business name and technical key, keeps the
// grouping, and announces the count. Keyboard order: search, then the groups.
const searchBox = (root, onChange) => {
  const wrap = el('div', undefined, 'managed-search'), label = el('label', flowLabels.search), input = el('input');
  input.type = 'search'; input.id = 'managed-search-' + ++sequence; label.htmlFor = input.id; input.autocomplete = 'off';
  const status = el('p', undefined, 'managed-muted'); status.setAttribute('role', 'status');
  input.oninput = () => onChange(input.value, status);
  wrap.append(label, input, status); root.append(wrap); return { input, status };
};
const visualFor = (visuals, artifactId) => artifactId ? visuals?.[artifactId] : undefined;

// UX-06 "Как работает": the processes of the accepted state grouped by module,
// each with its business name, muted code, declared responsibility and a
// one-line reading from its human tasks; the selected process opens the shared
// diagram with step detail. Diagrams come from the captured artifacts
// (`visuals`, loaded by the page); a missing one is loaded on demand.
export function mountFlows({ state, visuals = {}, selected = null }, actions = {}) {
  const root = el('section', undefined, 'managed-flows'); root.setAttribute('aria-labelledby', 'managed-flows-heading');
  const heading = el('h2', tabLabels.flows); heading.id = 'managed-flows-heading'; root.append(heading);
  const chips = el('p', undefined, 'managed-chips'); chips.append(el('span', facts.diagramFromExport, 'managed-chip'), ' ', el('span', facts.behaviorNotChecked, 'managed-chip')); root.append(chips);
  const processes = (state.current || []).filter(row => objectKind(row) === 'processes');
  if (!processes.length) { root.append(el('p', flowLabels.noProcesses, 'managed-muted')); return root; }
  const target = el('div', undefined, 'managed-flow-target');
  const cards = [];
  const { input } = searchBox(root, (query, status) => {
    let shown = 0;
    for (const { row, card } of cards) { const match = matchesQuery(row, query); card.hidden = !match; if (match) shown++; }
    for (const section of root.querySelectorAll('.managed-module')) section.hidden = ![...section.querySelectorAll('.managed-card')].some(card => !card.hidden);
    status.textContent = query ? shown ? `${shown} ${grouping.objects}` : flowLabels.nothingFound : '';
  });
  let openToken = 0;
  const open = async (row, card) => {
    const token = ++openToken, captured = capturedArtifact(state, row);
    target.replaceChildren(mountSnapshotVisual({ loading: true }));
    for (const other of cards) other.card.classList.toggle('managed-selected', other.row === row);
    let value = visualFor(visuals, captured?.id);
    if ((!value || value.error) && actions.visual && captured) { try { value = await actions.visual(captured.id); visuals[captured.id] = value; } catch (e) { value = { error: e.message }; } }
    // A slower earlier response must not replace the latest selection.
    if (token !== openToken) return;
    if (!value || value.error) { target.replaceChildren(mountSnapshotVisual({ error: value?.error || flowLabels.diagramUnavailable }, { retry: () => open(row, card) })); return; }
    const own = { ...value, processes: value.processes.filter(process => JSON.stringify(process.object) === row.key) };
    target.replaceChildren(mountSnapshotVisual(own, { explanations: actions.explanations }));
    target.querySelector('h2')?.scrollIntoView?.({ block: 'start' });
  };
  const grouped = groupObjects(processes);
  for (const group of grouped.modules) {
    const section = el('section', undefined, 'managed-module');
    section.append(el('h3', `${grouping.module} ${group.module || grouping.withoutModule} · ${group.count}`));
    for (const row of group.kinds.flatMap(kind => kind.rows)) {
      const card = el('article', undefined, 'managed-card'); card.append(title('h4', row));
      card.append(el('p', responsibilityLabel(row), 'managed-muted'));
      const captured = capturedArtifact(state, row), value = visualFor(visuals, captured?.id);
      const process = value?.processes?.find(process => JSON.stringify(process.object) === row.key);
      if (process) {
        const summary = processSummary(process);
        card.append(el('p', summary.tasks.length ? `${flowLabels.tasks}: ${summary.tasks.join(', ')}${summary.more ? ` ${grouping.andMore} ${summary.more}` : ''}. ${summary.steps} ${flowLabels.steps}.` : `${flowLabels.noTasks}. ${summary.steps} ${flowLabels.steps}.`));
      } else if (value?.error) card.append(el('p', `${flowLabels.diagramUnavailable}: ${value.error}`, 'managed-muted'));
      const button = el('button', `${flowLabels.view}: ${row.code || objectLabel(row).text}`, 'secondary'); button.type = 'button'; button.onclick = () => open(row, card);
      if (!captured) button.disabled = true;
      card.append(button); section.append(card); cards.push({ row, card });
    }
    root.append(section);
  }
  root.append(target);
  if (selected) { const found = cards.find(({ row }) => row.key === selected); if (found) open(found.row, found.card); }
  return root;
}

// UX-06 "Экраны и данные": forms and data objects of the accepted state by
// module, each with the fields its export declares; system objects collapsed;
// processes referenced on their own tab. Search by name and key.
export function mountScreens({ state, visuals = {} }, actions = {}) {
  const root = el('section', undefined, 'managed-screens'); root.setAttribute('aria-label', tabLabels.screensAndData);
  const rows = state.current || [], processes = rows.filter(row => objectKind(row) === 'processes');
  if (processes.length && actions.flowsHref) { const note = el('p', undefined, 'managed-muted'); const a = el('a', `${tabLabels.flows} · ${processes.length}`, 'managed-link'); a.href = actions.flowsHref; if (actions.navigate) a.onclick = event => { event.preventDefault(); actions.navigate(a.href); }; note.append(`${flowLabels.processesElsewhere} `, a); root.append(note); }
  const cards = [];
  searchBox(root, (query, status) => {
    let shown = 0;
    for (const { row, card } of cards) { const match = matchesQuery(row, query); card.hidden = !match; if (match) shown++; }
    for (const section of root.querySelectorAll('.managed-module, .managed-kind')) section.hidden = ![...section.querySelectorAll('.managed-card')].some(card => !card.hidden);
    status.textContent = query ? shown ? `${shown} ${grouping.objects}` : flowLabels.nothingFound : '';
  });
  const fieldTable = fields => {
    const table = el('table'), head = el('tr');
    for (const label of [flowLabels.field, flowLabels.fieldCode, flowLabels.fieldType, flowLabels.fieldRequired]) head.append(el('th', label));
    table.append(head);
    for (const field of fields) { const tr = el('tr'); tr.append(el('td', field.name || field.code), el('td', field.code, 'managed-code'), el('td', field.type), el('td', field.required ? flowLabels.yes : flowLabels.no)); table.append(tr); }
    const scroll = el('div', undefined, 'managed-table'); scroll.append(table); return scroll;
  };
  const card = row => {
    const article = el('article', undefined, 'managed-card'); article.append(title('h4', row), el('p', responsibilityLabel(row), 'managed-muted'));
    const captured = capturedArtifact(state, row), value = visualFor(visuals, captured?.id);
    const object = value?.objects?.find(object => JSON.stringify(object.object) === row.key);
    if (object?.fields?.length) { const details = el('details'); details.append(el('summary', `${flowLabels.fields} · ${object.fields.length}`), fieldTable(object.fields)); article.append(details); }
    else if (object) article.append(el('p', flowLabels.fieldsUnknown, 'managed-muted'));
    // The projection was not read (failed read, or none loaded for a captured artifact): the card says so.
    else if (captured && (!value || value.error)) article.append(el('p', value?.error ? `${flowLabels.fieldsUnavailable}: ${value.error}` : flowLabels.fieldsUnavailable, 'managed-muted'));
    cards.push({ row, card: article }); return article;
  };
  const grouped = groupObjects(rows.filter(row => objectKind(row) !== 'processes'));
  for (const group of grouped.modules) {
    const section = el('section', undefined, 'managed-module');
    section.append(el('h3', `${grouping.module} ${group.module || grouping.withoutModule} · ${group.count}`));
    for (const kind of group.kinds) { const block = el('div', undefined, 'managed-kind'); block.append(el('h4', `${kind.label} · ${kind.rows.length}`)); for (const row of kind.rows) block.append(card(row)); section.append(block); }
    root.append(section);
  }
  if (grouped.system.length) { const details = el('details'); details.append(el('summary', `${nouns.systemObjects} · ${grouped.system.length} · ${grouping.showAll}`)); for (const row of grouped.system) details.append(card(row)); root.append(details); }
  if (!grouped.modules.length && !grouped.system.length) root.append(el('p', `${kindGroups.forms}: 0 · ${kindGroups.data}: 0`, 'managed-muted'));
  return root;
}
