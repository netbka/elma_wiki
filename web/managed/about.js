import { nouns, actions as actionLabels, about as aboutLabels, empty, grouping, plural } from './labels.js';
import { moduleCards, objectLabel, purposeNames, actorDisplay, relativeTime, activityFeed, dateLabel, moduleCardView } from './model.js';
import { mountExplanation } from '../explanations/render.js';

let sequence = 0;
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const person = actor => {
  const display = typeof actor?.known === 'boolean' ? actor : actorDisplay(actor), node = el('span', undefined, 'managed-person');
  if (display.initials) { const chip = el('span', display.initials, 'managed-initials'); chip.setAttribute('aria-hidden', 'true'); node.append(chip, ' '); }
  node.append(el('span', display.name)); node.title = display.login; return node;
};

// UX-05 "О решении": the purpose paragraph (an explanation of scope
// `solution-purpose`, edited in place with author and history), one card per
// module with a generated sentence and the shared explanation panel for scope
// `module`, and the activity list from the attributed audit records. Stateful
// only for the purpose editor; every other value is a projection of `state`.
export function mountAbout({ state, about = {}, editing = false, now }, actions = {}) {
  const root = el('div', undefined, 'managed-about');
  const purpose = el('section', undefined, 'managed-purpose'); purpose.setAttribute('aria-labelledby', 'managed-purpose-heading');
  const heading = el('h2', nouns.purpose); heading.id = 'managed-purpose-heading';
  const body = el('div'); purpose.append(heading, body); root.append(purpose);
  let response = about.purpose && !about.purpose.loadError ? about.purpose : null;
  let error = about.purpose?.loadError ? `${aboutLabels.loadFailed}: ${about.purpose.loadError}` : '';
  let text = response?.saved?.text ?? response?.draft?.text ?? '', busy = false, blocked = false, notice = '';
  let open = editing && !!response;
  const button = (parent, label, callback, { primary = false, disabled = false } = {}) => {
    const node = el('button', label, primary ? 'explanation-save' : 'secondary'); node.type = 'button'; node.disabled = disabled; node.onclick = callback; parent.append(node); return node;
  };
  const focusHeading = () => { heading.tabIndex = -1; heading.focus({ preventScroll: true }); };
  async function load() {
    if (busy || !actions.explanations) return;
    busy = true; error = ''; render();
    try { response = await actions.explanations.read({ scope: 'solution-purpose' }); blocked = false; text = response.saved?.text ?? response.draft.text; }
    catch (e) { error = `${aboutLabels.loadFailed}: ${e.message}`; }
    finally { busy = false; render(); focusHeading(); }
  }
  async function save() {
    if (busy || blocked || !response?.writable || !text.trim()) return;
    busy = true; error = ''; notice = ''; render();
    try {
      response = await actions.explanations.save({ scope: 'solution-purpose' }, { text, expectedRevision: response.expectedRevision, expectedVersion: response.version, expectedFingerprint: response.fingerprint });
      text = response.saved.text; open = false; notice = `${aboutLabels.text}: ${nouns.purpose} · ${relativeTime(response.saved.at, now)}`;
    } catch (e) { error = e.message || aboutLabels.loadFailed; blocked = e.status === 409 || e.requiresRefresh || e.status >= 500; }
    finally { busy = false; render(); focusHeading(); }
  }
  function render() {
    body.replaceChildren();
    if (busy) { const status = el('p', undefined, 'managed-muted'); status.setAttribute('role', 'status'); status.textContent = aboutLabels.loading; body.append(status); }
    if (error) { const alert = el('p', error); alert.setAttribute('role', 'alert'); body.append(alert); }
    if (notice) { const status = el('p', notice, 'managed-muted'); status.setAttribute('role', 'status'); body.append(status); }
    if (blocked) body.append(el('p', aboutLabels.blocked));
    const saved = response?.saved;
    if (!response && !busy) {
      // Not loaded (legacy API or a failed read): the empty sentence and one button that reads the draft.
      body.append(el('p', empty.purpose));
      if (actions.explanations) button(body, actionLabels.write, () => load().then(() => { if (response && !response.saved) { open = true; render(); } }), { primary: true });
      return;
    }
    if (!response) return;
    if (response.reason) body.append(el('p', response.reason, 'managed-muted'));
    if (saved && !open) {
      if (saved.sourceStatus === 'stale') { const stale = el('p', aboutLabels.stale, 'managed-note'); stale.setAttribute('role', 'status'); body.append(stale); }
      body.append(el('p', saved.text, 'change-text'));
      const meta = el('p', undefined, 'managed-muted'); meta.append(`${aboutLabels.savedBy} `, person(saved.actor), ` · ${relativeTime(saved.at, now)}`); body.append(meta);
      if (response.writable) button(body, aboutLabels.edit, () => { text = saved.text; open = true; render(); }, { disabled: busy || blocked });
    } else if (!open) {
      body.append(el('p', empty.purpose));
      // Without process or screen names the generated draft is only a module list: writing is primary.
      const names = purposeNames(state.current || []), named = names.processes.length + names.screens.length > 0;
      if (response.writable) button(body, actionLabels.write, () => { text = named ? response.draft.text : ''; open = true; render(); }, { primary: true, disabled: busy || blocked });
      if (response.writable && !named) button(body, aboutLabels.generateDraft, () => { text = response.draft.text; open = true; render(); }, { disabled: busy || blocked });
    }
    if (open) {
      if (!saved) body.append(el('p', aboutLabels.draftNote, 'managed-muted'));
      const label = el('label', aboutLabels.text), textarea = el('textarea'); textarea.id = 'managed-purpose-' + ++sequence; label.htmlFor = textarea.id;
      textarea.maxLength = 16000; textarea.value = text; textarea.disabled = busy; label.className = 'managed-field-label';
      textarea.oninput = () => { text = textarea.value; saveButton.disabled = busy || blocked || !text.trim(); };
      const bar = el('div', undefined, 'managed-actions');
      body.append(label, textarea, bar);
      const saveButton = button(bar, aboutLabels.save, save, { primary: true, disabled: busy || blocked || !text.trim() });
      button(bar, actionLabels.cancel, () => { open = false; text = saved?.text ?? response.draft.text; render(); }, { disabled: busy });
    }
    if (response.history?.length) {
      const history = el('details'); history.append(el('summary', `${aboutLabels.history} · ${response.history.length}`));
      for (const entry of response.history) { const item = el('div'); const meta = el('p', undefined, 'managed-muted'); meta.append(person(entry.actor), ` · ${dateLabel(entry.at)}`); item.append(meta, el('p', entry.text, 'change-text')); history.append(item); }
      body.append(history);
    }
  }
  render();

  // Модули: one card per module. The sentence is generated from declared names on
  // the client; the editable description with history is the shared explanation panel.
  const modules = el('section'); modules.setAttribute('aria-labelledby', 'managed-modules-heading');
  const modulesHeading = el('h2', nouns.modules); modulesHeading.id = 'managed-modules-heading'; modules.append(modulesHeading);
  const cards = moduleCards(state.current || []), list = el('div', undefined, 'managed-list');
  if (!cards.length) modules.append(el('p', aboutLabels.noModules, 'managed-muted'));
  for (const card of cards) {
    const article = el('article', undefined, 'managed-card'), view = moduleCardView(card);
    const title = el('h3', view.title.text, view.title.technical ? 'managed-technical' : undefined); article.append(title);
    const counts = [['processes', card.processes.length], ['forms', card.forms.length], ['data', card.data.length], ['other', card.other.length]].filter(([, n]) => n)
      .map(([kind, n]) => plural(n, aboutLabels.moduleCounts[kind]));
    article.append(el('p', counts.join(' · ') + (card.system ? ` · ${nouns.systemObjects}: ${card.system}` : ''), 'managed-muted'));
    const kindLabels = { processes: aboutLabels.processesList, forms: aboutLabels.screensList, data: aboutLabels.dataList };
    const sentence = el('p');
    for (const part of view.parts) {
      sentence.append(`${kindLabels[part.kind]}: ${part.names.join(', ')}`);
      // More than six names: the rest are one click away on the Экраны и данные tab (plain text when no link is available).
      if (part.more) { const more = actions.open ? el('a', grouping.showAll, 'managed-link') : el('span', grouping.showAll, 'managed-muted'); if (actions.open) { more.href = actions.open(card.module); if (actions.navigate) more.onclick = event => { event.preventDefault(); actions.navigate(more.href); }; } sentence.append(' ', more); }
      sentence.append('. ');
    }
    if (!view.parts.length) sentence.textContent = aboutLabels.moduleNoNames;
    article.append(sentence);
    if (actions.open) { const a = el('a', actionLabels.open, 'managed-link'); a.href = actions.open(card.module); if (actions.navigate) a.onclick = event => { event.preventDefault(); actions.navigate(a.href); }; article.append(a); }
    // A module without a code has no description scope: no Explain button.
    if (actions.explanations && view.explainable) article.append(el('p', actionLabels.explainModuleHint, 'managed-muted'), mountExplanation({ target: { scope: 'module', module: card.module }, label: actionLabels.explain }, actions.explanations));
    list.append(article);
  }
  modules.append(list); root.append(modules);
  return root;
}

export function mountActivity(state, { now } = {}) {
  const section = el('section'); section.setAttribute('aria-labelledby', 'managed-activity-heading');
  const heading = el('h2', nouns.activity); heading.id = 'managed-activity-heading'; section.append(heading);
  const feed = activityFeed(state, 8, now);
  if (!feed.length) { section.append(el('p', aboutLabels.noActivity, 'managed-muted')); return section; }
  const list = el('ol', undefined, 'managed-activity'); list.setAttribute('aria-labelledby', 'managed-activity-heading');
  for (const row of feed) {
    const item = el('li'); item.append(person(row.actor), ' · ', el('span', row.label), ' · ', el('time', row.when, 'managed-muted'));
    item.lastChild.setAttribute('datetime', row.at); item.lastChild.title = dateLabel(row.at); list.append(item);
  }
  section.append(list); return section;
}
