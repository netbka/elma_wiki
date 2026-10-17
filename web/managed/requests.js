// UX-07 "Запросы": a person asks for a change in plain words from the place
// where they see the problem (a process, a step, a screen, a data object or a
// field) or from the tab itself. The request is a private record of the
// Solution (docs/contracts/change-requests.md); publication to GitHub reuses
// the bug-report transport and happens only after explicit consent.
import { nouns, actions as actionLabels, requestForm as formLabels, requests as requestLabels, grouping, empty, header as headerLabels } from './labels.js';
import { objectLabel, groupObjects, moduleLabel, moduleNames, capturedArtifact, actorDisplay, relativeTime, dateLabel, requestTargetLabel, requestKindOf, requestInput } from './model.js';
import { captureWindow, readFile, editImage } from '../feedback/capture.js';

let sequence = 0;
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const button = (label, action, className = 'secondary') => { const node = el('button', label, className); node.type = 'button'; node.onclick = action; return node; };
const field = (parent, label, tag = 'input') => {
  const wrap = el('div', undefined, 'managed-field'), caption = el('label', label), input = el(tag);
  input.id = 'managed-request-' + ++sequence; caption.htmlFor = input.id; wrap.append(caption, input); parent.append(wrap); return input;
};
const choice = (parent, name, value, label, checked) => {
  const row = el('div', undefined, 'managed-choice'), caption = el('label'), input = el('input');
  input.type = 'radio'; input.name = name; input.value = value; input.checked = checked; caption.append(input, el('span', label)); row.append(caption); parent.append(row); return input;
};
const person = actor => { const view = actorDisplay(actor), node = el('span', undefined, 'managed-person'); node.append(el('span', view.initials, 'managed-initials'), ' ', view.name); return node; };
const versionLabel = (state, artifactId) => { const artifact = (state.artifacts || []).find(row => row.id === artifactId); return artifact ? `${headerLabels.versionFrom} ${dateLabel(artifact.snapshot?.createdAt || artifact.uploadedAt)}` : artifactId; };
const statusChip = request => el('span', formLabels.statuses[request.status] || request.status, 'managed-chip managed-chip-' + request.status);
const requestHref = (home, state, requestId, objectKey) => `${home}?${new URLSearchParams({ id: state.id, view: 'requests', ...(requestId ? { request: requestId } : {}), ...(objectKey ? { object: objectKey } : {}) })}`;

// Attachments for publication: window capture, files and pencil marks, as the bug
// report offers them. Nothing leaves the page until the person confirms publication.
function attachmentPicker(status) {
  const root = el('div', undefined, 'managed-attachments'), files = [], limit = 5;
  const heading = el('h4', `${requestLabels.attachments} · 0/${limit}`), toolbar = el('div', undefined, 'managed-actions'), list = el('div'), editor = el('section'); editor.hidden = true;
  const pickerLabel = el('label', requestLabels.attachFiles, 'secondary'), picker = el('input'); picker.type = 'file'; picker.multiple = true; picker.accept = 'image/png,image/jpeg,image/webp'; pickerLabel.append(picker);
  const capture = button(requestLabels.capture, async () => {
    try { await add([await captureWindow()]); status.textContent = ''; } catch (error) { status.textContent = error.message; }
  });
  toolbar.append(capture, pickerLabel); root.append(heading, toolbar, list, el('p', requestLabels.attachmentsNote, 'managed-muted'), editor);
  const render = () => {
    list.replaceChildren(); heading.textContent = `${requestLabels.attachments} · ${files.length}/${limit}`;
    files.forEach((item, index) => {
      const card = el('div', undefined, 'bug-attachment'), image = el('img'); image.src = item.dataUrl; image.alt = item.file.name; card.append(el('span', item.file.name), image);
      const pencil = button(requestLabels.pencil, () => annotate(index)); pencil.setAttribute('aria-label', `${requestLabels.pencil}: ${item.file.name}`);
      const remove = button(requestLabels.remove, () => { files.splice(index, 1); editor.hidden = true; render(); }); remove.setAttribute('aria-label', `${requestLabels.remove}: ${item.file.name}`);
      card.append(pencil, remove); list.append(card);
    });
    capture.disabled = picker.disabled = files.length >= limit;
  };
  const add = async selected => {
    if (files.length + selected.length > limit) throw Error(requestLabels.tooManyFiles);
    for (const file of selected) {
      if (!file.size || file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw Error(requestLabels.attachmentsNote);
      files.push({ file, mime: file.type, dataUrl: await readFile(file) });
    }
    render();
  };
  const annotate = async index => {
    const editing = files[index]; editor.replaceChildren(el('h4', requestLabels.markError)); editor.hidden = false;
    const canvas = el('canvas'); canvas.hidden = true; canvas.setAttribute('aria-label', requestLabels.markError); editor.append(canvas);
    const controls = el('div', undefined, 'managed-actions'); editor.append(controls);
    try {
      const drawing = await editImage(canvas, editing.file); canvas.hidden = false;
      controls.append(button(requestLabels.undoStroke, drawing.undo), button(requestLabels.clearMarks, drawing.clear), button(requestLabels.saveMarks, async () => {
        try { const file = await drawing.save(); const current = files.indexOf(editing); if (current < 0) throw Error(requestLabels.attachmentRemoved); files[current] = { file, mime: 'image/png', dataUrl: await readFile(file) }; editor.hidden = true; render(); }
        catch (error) { status.textContent = error.message; }
      }, ''), button(actionLabels.cancel, () => { editor.hidden = true; }));
    } catch (error) { status.textContent = error.message; editor.hidden = true; }
  };
  picker.onchange = async () => { try { await add([...picker.files]); status.textContent = ''; } catch (error) { status.textContent = error.message; } finally { picker.value = ''; } };
  return { root, editing: () => !editor.hidden, payload: () => files.map(item => ({ name: item.file.name, mime: item.mime, data: item.dataUrl.split(',')[1] })) };
}

// Publication block: the receipt's state when one exists, otherwise consent,
// attachments and one button. The server composes the report from the stored
// request; the page sends only consent and attachments.
export function mountPublication({ state, request, publication, config = {} }, actions = {}) {
  const root = el('section', undefined, 'managed-publication'); root.setAttribute('aria-label', requestLabels.publication);
  root.append(el('h4', requestLabels.publication));
  const status = el('p', undefined, 'managed-error'); status.setAttribute('role', 'alert');
  const render = receipt => {
    root.replaceChildren(el('h4', requestLabels.publication), status);
    if (receipt) {
      root.append(el('p', requestLabels.publicationStates[receipt.status] || receipt.status, 'managed-publication-state'));
      if (receipt.message) root.append(el('p', receipt.message, 'managed-muted'));
      if (receipt.issue) { const link = el('a', `${requestLabels.openIssue} #${receipt.issue.number}`, 'managed-link'); link.href = receipt.issue.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; root.append(link); }
      if (receipt.status !== 'published' && actions.retry) root.append(button(receipt.status === 'unknown' ? requestLabels.checkResult : requestLabels.retryPublish, async () => {
        status.textContent = ''; try { render(await actions.retry(request.id)); } catch (error) { status.textContent = error.message; }
      }));
      const wiki = el('a', requestLabels.reportInWiki, 'managed-link'); wiki.href = '/bug-reports?id=' + encodeURIComponent(receipt.id); root.append(wiki);
      return;
    }
    if (state.status === 'archived' || !actions.publish) { root.append(el('p', requestLabels.notPublished, 'managed-muted')); return; }
    const form = el('form'), attachments = attachmentPicker(status);
    const consentRow = el('label', undefined, 'managed-check'), consent = el('input'); consent.type = 'checkbox'; consent.required = true;
    consentRow.append(consent, el('span', `${requestLabels.publishConsent}${config.repository ? ` · ${config.repository}` : ''}. ${requestLabels.publishNote}`));
    const submit = el('button', requestLabels.publish); submit.type = 'submit';
    form.append(attachments.root, consentRow, submit);
    form.onsubmit = async event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      if (attachments.editing()) { status.textContent = requestLabels.finishMarks; return; }
      status.textContent = ''; submit.disabled = true;
      try { render(await actions.publish(request.id, { publishConfirmed: true, attachments: attachments.payload() })); }
      catch (error) { status.textContent = error.message; submit.disabled = false; }
    };
    root.append(form);
  };
  render(publication);
  return root;
}

// The form. `entry` carries what the entry point knows: the object row, the step
// anchor and name, the field (with its anchor when the export declares it
// uniquely). "Где" is filled from it and may be changed to any captured object of
// the accepted state or to the whole Solution; a step or field stays only with its object.
export function mountRequestForm({ state, config = {}, home = '/solutions', kind, row = null, anchor = null, stepName = '', fieldName = '', fieldCode = '', field: fieldAnchor = null }, actions = {}) {
  const dialog = el('dialog', undefined, 'managed-decision managed-request'); dialog.setAttribute('aria-label', nouns.request);
  const heading = el('h2', nouns.request); dialog.append(heading);
  const status = el('p', undefined, 'managed-error'); status.setAttribute('role', 'alert'); dialog.append(status);
  const form = el('form'); dialog.append(form);
  // Что изменить: three large choices.
  const what = el('fieldset'); what.append(el('legend', formLabels.what));
  const kinds = Object.entries(formLabels.kinds).map(([value, label]) => choice(what, 'request-kind', value, label, value === (kind || (row ? requestKindOf(row) : 'screen'))));
  form.append(what);
  // Где: the entry point's object, changeable; a step stays only with its object.
  const where = el('fieldset'); where.append(el('legend', formLabels.where));
  const select = el('select'); select.id = 'managed-request-' + ++sequence; select.setAttribute('aria-label', formLabels.where);
  const whole = el('option', requestLabels.wholeSolution); whole.value = ''; select.append(whole);
  for (const group of groupObjects(state.current || []).modules) {
    const optgroup = el('optgroup'); optgroup.label = `${grouping.module} ${moduleLabel(group.module, moduleNames(state.current || [])).text}`;
    for (const item of group.kinds.flatMap(kindGroup => kindGroup.rows)) {
      const label = objectLabel(item), option = el('option', label.secondary ? `${label.text} · ${label.secondary}` : label.text); option.value = item.key;
      if (!capturedArtifact(state, item)) option.disabled = true;
      optgroup.append(option);
    }
    select.append(optgroup);
  }
  if (row) select.value = row.key;
  const stepLine = el('p', undefined, 'managed-muted'), fieldLine = el('p', undefined, 'managed-muted');
  let step = anchor ? { anchor, name: stepName } : null;
  // An unsupported step cannot anchor a request (the API refuses it): it is named in the text instead, as a field is.
  const describeStep = () => { stepLine.textContent = step ? `${requestLabels.step}: ${step.name || step.anchor.nodeId} · ${requestLabels.stepNote}` : stepName && !anchor ? `${requestLabels.step}: ${stepName} · ${requestLabels.stepTextNote}` : ''; };
  describeStep();
  let fieldTarget = fieldAnchor;
  const describeField = () => { fieldLine.textContent = fieldTarget ? `${requestLabels.field}: ${fieldName || fieldCode} · ${requestLabels.fieldAnchorNote}` : (fieldName || fieldCode) && !fieldAnchor ? `${requestLabels.field}: ${fieldName || fieldCode} · ${requestLabels.fieldNote}` : ''; };
  describeField();
  select.onchange = () => {
    const own = select.value === row?.key;
    if (anchor) { step = own ? { anchor, name: stepName } : null; describeStep(); }
    if (fieldAnchor) { fieldTarget = own ? fieldAnchor : null; describeField(); }
  };
  where.append(select, stepLine, fieldLine); form.append(where);
  const title = field(form, requestLabels.title); title.required = true; title.maxLength = 160; title.autocomplete = 'off';
  const text = field(form, formLabels.shouldBe, 'textarea'); text.required = true; text.maxLength = 8000; text.rows = 5;
  if ((fieldName || fieldCode) && !fieldAnchor) text.value = `${requestLabels.field} «${fieldName || fieldCode}»${fieldCode && fieldName ? ` · ${fieldCode}` : ''}: `;
  else if (stepName && !anchor) text.value = `${requestLabels.step} «${stepName}»: `;
  const reason = field(form, formLabels.whyOptional, 'textarea'); reason.maxLength = 2000; reason.rows = 3;
  const urgency = el('fieldset'); urgency.append(el('legend', formLabels.urgency));
  const urgencies = Object.entries(formLabels.urgencies).map(([value, label]) => choice(urgency, 'request-urgency', value, label, value === 'normal'));
  form.append(urgency);
  const bar = el('div', undefined, 'managed-actions'), submit = el('button', actionLabels.send); submit.type = 'submit';
  const cancel = button(actionLabels.cancel, () => dialog.close());
  bar.append(submit, cancel); form.append(bar);
  const outcome = el('section'); outcome.hidden = true; dialog.append(outcome);
  let busy = false, saved = null;
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || !form.reportValidity()) return;
    const selectedRow = select.value ? (state.current || []).find(item => item.key === select.value) : null;
    const input = requestInput({ state, kind: kinds.find(item => item.checked).value, row: selectedRow, anchor: step?.anchor || null, field: fieldTarget,
      title: title.value, text: text.value, reason: reason.value, urgency: urgencies.find(item => item.checked).value });
    if (!input) { status.textContent = requestLabels.chooseObject; return; }
    busy = true; submit.disabled = cancel.disabled = true; status.textContent = '';
    try {
      saved = await actions.create(input);
      form.hidden = true; outcome.hidden = false;
      const open = el('a', requestLabels.open, 'managed-link'); open.href = requestHref(home, state, saved.id);
      if (actions.navigate) open.onclick = e => { e.preventDefault(); actions.navigate(open.href); };
      outcome.append(el('h3', requestLabels.saved), el('p', saved.title), open,
        mountPublication({ state, request: saved, publication: null, config }, { publish: actions.publish, retry: actions.retry }),
        button(requestLabels.close, () => dialog.close()));
      outcome.querySelector('h3').tabIndex = -1; outcome.querySelector('h3').focus();
      actions.saved?.(saved);
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; submit.disabled = cancel.disabled = false; }
  };
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.openModal = () => { dialog.showModal(); (row ? title : select).focus(); };
  return dialog;
}

// The chip on an object row: how many open requests name it, linking to the tab.
export function requestChip(count, href, navigate) {
  const chip = el('a', `${requestLabels.chip} · ${count}`, 'managed-chip managed-chip-request'); chip.href = href;
  if (navigate) chip.onclick = event => { event.preventDefault(); navigate(href); };
  return chip;
}

function mountRecord({ state, request, publication, config, home, now }, actions) {
  const root = el('article', undefined, 'managed-card managed-request-record');
  const render = (current, receipt) => {
    root.replaceChildren();
    const title = el('h3', current.title); title.tabIndex = -1; root.append(title);
    const chips = el('p', undefined, 'managed-chips'); chips.append(statusChip(current), ' ', el('span', formLabels.kinds[current.kind] || current.kind, 'managed-chip'));
    if (current.urgency === 'urgent') chips.append(' ', el('span', requestLabels.urgentChip, 'managed-chip managed-chip-warn'));
    root.append(chips);
    const target = requestTargetLabel(state, current), whereLine = el('p');
    whereLine.append(`${formLabels.where}: `, el('span', target.text, target.technical ? 'managed-technical' : undefined));
    if (target.step) whereLine.append(' · ', `${requestLabels.step}: `, el('span', target.step, 'managed-code'));
    if (target.field) whereLine.append(' · ', `${requestLabels.field}: `, el('span', target.field));
    if (current.anchorStatus !== 'current') whereLine.append(' · ', el('span', requestLabels.anchor[current.anchorStatus] || current.anchorStatus, 'managed-chip managed-chip-warn'));
    root.append(whereLine);
    const meta = el('p', undefined, 'managed-muted'); meta.append(`${requestLabels.author}: `, person(current.actor), ` · ${requestLabels.created}: ${dateLabel(current.createdAt)}`); root.append(meta);
    root.append(el('h4', formLabels.shouldBe), el('p', current.text));
    if (current.reason) root.append(el('h4', formLabels.why), el('p', current.reason));
    if (current.status === 'done' && current.fulfilledArtifactId) { const line = el('p'); const link = el('a', versionLabel(state, current.fulfilledArtifactId), 'managed-link'); link.href = `${home}?${new URLSearchParams({ id: state.id, view: 'review', artifact: current.fulfilledArtifactId })}`; line.append(`${requestLabels.fulfilledIn}: `, link); root.append(line); }
    root.append(mountPublication({ state, request: current, publication: receipt, config }, { publish: actions.publish, retry: actions.retry }));
    // History: comments and status changes, attributed, in order.
    root.append(el('h4', requestLabels.events));
    if (!current.events.length) root.append(el('p', requestLabels.noEvents, 'managed-muted'));
    else { const list = el('ul', undefined, 'managed-activity'); for (const event of current.events) { const item = el('li'); item.append(person(event.actor), ' · ', el('span', relativeTime(event.at, now), 'managed-muted'), ' · ', event.type === 'status' ? `${requestLabels.statusChanged}: ${formLabels.statuses[event.status] || event.status}${event.text ? ` · ${event.text}` : ''}` : event.text); list.append(item); } root.append(list); }
    if (state.status === 'archived') { root.append(el('p', requestLabels.archived, 'managed-muted')); return; }
    if (!actions.event) return;
    const status = el('p', undefined, 'managed-error'); status.setAttribute('role', 'alert'); root.append(status);
    const send = async input => { status.textContent = ''; try { const next = await actions.event(current.id, { operationId: crypto.randomUUID(), expectedVersion: current.version, ...input }); render(next, receipt); root.querySelector('h3').focus(); } catch (error) { status.textContent = error.message; } };
    const commentForm = el('form'); const comment = field(commentForm, requestLabels.comment, 'textarea'); comment.required = true; comment.maxLength = 4000; comment.rows = 3;
    const commentSubmit = el('button', requestLabels.addComment, 'secondary'); commentSubmit.type = 'submit'; commentForm.append(commentSubmit);
    commentForm.onsubmit = event => { event.preventDefault(); if (commentForm.reportValidity()) send({ type: 'comment', text: comment.value }); };
    root.append(commentForm);
    const statusForm = el('form'), statusSelect = field(statusForm, requestLabels.changeStatus, 'select');
    for (const [value, label] of Object.entries(formLabels.statuses)) { const option = el('option', label); option.value = value; option.selected = value === current.status; statusSelect.append(option); }
    const versionWrap = el('div', undefined, 'managed-field'), versionLabelNode = el('label', requestLabels.fulfillingVersion), version = el('select'); version.id = 'managed-request-' + ++sequence; versionLabelNode.htmlFor = version.id;
    for (const artifact of state.artifacts || []) { const option = el('option', versionLabel(state, artifact.id)); option.value = artifact.id; option.selected = artifact.id === (current.fulfilledArtifactId || state.baselineId); version.append(option); }
    versionWrap.append(versionLabelNode, version); versionWrap.hidden = statusSelect.value !== 'done'; statusForm.append(versionWrap);
    statusSelect.onchange = () => { versionWrap.hidden = statusSelect.value !== 'done'; };
    const note = field(statusForm, requestLabels.commentOptional, 'textarea'); note.maxLength = 4000; note.rows = 2;
    const statusSubmit = el('button', requestLabels.saveStatus, 'secondary'); statusSubmit.type = 'submit'; statusForm.append(statusSubmit);
    statusForm.onsubmit = event => { event.preventDefault(); if (!statusForm.reportValidity()) return; send({ type: 'status', status: statusSelect.value, ...(note.value.trim() ? { text: note.value } : {}), ...(statusSelect.value === 'done' ? { fulfilledArtifactId: version.value } : {}) }); };
    root.append(statusForm);
  };
  render(request, publication);
  return root;
}

// The tab: "Новый запрос", the list (newest first; filtered by object when the
// page came from a chip) and the selected request's record.
export function mountRequests({ state, requests = [], publication = null, config = {}, selected = null, object = null, loadError = null, home = '/solutions', now = Date.now() }, actions = {}) {
  const root = el('section', undefined, 'managed-requests'); root.setAttribute('aria-labelledby', 'managed-requests-heading');
  const heading = el('h2', nouns.requests); heading.id = 'managed-requests-heading'; root.append(heading);
  root.append(el('p', requestLabels.intro, 'managed-muted'));
  if (loadError) { const alert = el('p', `${requestLabels.loadFailed}: ${loadError}`, 'managed-error'); alert.setAttribute('role', 'alert'); root.append(alert); const retry = el('a', actionLabels.retry, 'managed-link'); retry.href = requestHref(home, state); root.append(retry); return root; }
  const bar = el('div', undefined, 'managed-actions');
  if (state.status !== 'archived' && actions.create) bar.append(button(actionLabels.newRequest, () => { const dialog = mountRequestForm({ state, config, home }, { ...actions, saved: saved => { requests = [saved, ...requests]; list(); } }); root.append(dialog); dialog.openModal(); }, ''));
  root.append(bar);
  const listRoot = el('div'), detail = el('div'); root.append(listRoot, detail);
  const list = () => {
    listRoot.replaceChildren();
    let rows = [...requests].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    if (object) {
      const objectRow = (state.current || []).find(item => item.key === object);
      const line = el('p'); line.append(`${requestLabels.filteredBy}: `, el('strong', objectRow ? objectLabel(objectRow).text : object));
      const all = el('a', requestLabels.showAll, 'managed-link'); all.href = requestHref(home, state); if (actions.navigate) all.onclick = event => { event.preventDefault(); actions.navigate(all.href); }; line.append(' · ', all); listRoot.append(line);
      rows = rows.filter(row => row.target.anchor?.key === object);
    }
    if (!rows.length) { listRoot.append(el('p', empty.requests, 'managed-muted')); return; }
    const table = el('table'), head = el('tr');
    for (const label of [nouns.request, requestLabels.status, requestLabels.author, formLabels.where, requestLabels.created, requestLabels.fulfilledIn]) head.append(el('th', label));
    table.append(head);
    for (const row of rows) {
      const tr = el('tr'), titleCell = el('td'), open = el('a', row.title, 'managed-link'); open.href = requestHref(home, state, row.id);
      open.onclick = event => { event.preventDefault(); show(row); }; titleCell.append(open);
      if (row.urgency === 'urgent') titleCell.append(' ', el('span', requestLabels.urgentChip, 'managed-chip managed-chip-warn'));
      const target = requestTargetLabel(state, row), whereCell = el('td'); whereCell.append(el('span', target.text, target.technical ? 'managed-technical' : undefined));
      if (target.field) whereCell.append(' · ', `${requestLabels.field}: ${target.field}`);
      if (row.anchorStatus !== 'current') whereCell.append(' ', el('span', requestLabels.anchor[row.anchorStatus] || row.anchorStatus, 'managed-chip managed-chip-warn'));
      const authorCell = el('td'); authorCell.append(person(row.actor));
      tr.append(titleCell, (() => { const cell = el('td'); cell.append(statusChip(row)); return cell; })(), authorCell, whereCell, el('td', relativeTime(row.createdAt, now)), el('td', row.status === 'done' && row.fulfilledArtifactId ? versionLabel(state, row.fulfilledArtifactId) : ''));
      table.append(tr);
    }
    const scroll = el('div', undefined, 'managed-table'); scroll.append(table); listRoot.append(scroll);
  };
  const show = async row => {
    detail.replaceChildren(el('p', requestLabels.loading, 'managed-muted'));
    let receipt = publication && publication.context?.changeRequestId === row.id ? publication : null, current = row;
    if (actions.get) { try { const value = await actions.get(row.id); ({ publication: receipt, ...current } = value); } catch (error) { detail.replaceChildren(el('p', error.message, 'managed-error')); return; } }
    detail.replaceChildren(mountRecord({ state, request: current, publication: receipt, config, home, now }, actions));
    detail.querySelector('h3')?.focus();
  };
  list();
  if (selected) { const found = requests.find(row => row.id === selected); if (found) show(found); else detail.append(el('p', requestLabels.notFound, 'managed-muted')); }
  return root;
}
