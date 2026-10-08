import { captureWindow, readFile, editImage } from './capture.js';
const element = (tag, text, className) => { const value = document.createElement(tag); if (text) value.textContent = text; if (className) value.className = className; return value; };
const button = (text, action, parent) => { const value = element('button', text); value.type = 'button'; value.onclick = action; parent?.append(value); return value; };
const input = (label, tag, parent) => { const row = element('label', label), value = element(tag); row.append(value); parent.append(row); return value; };

export function mountBugReporter(config = {}, actions = {}) {
  const host = element('aside', null, 'bug-reporter');
  host.setAttribute('aria-label', 'Сообщить об ошибке');
  const trigger = button('🐞', () => open(), host); trigger.className = 'bug-trigger'; trigger.title = 'Сообщить об ошибке'; trigger.setAttribute('aria-label', 'Сообщить об ошибке');
  const dialog = element('dialog', null, 'bug-dialog'); host.append(dialog);
  dialog.setAttribute('aria-label', 'Сообщить об ошибке');
  let files = [], payload = null, saved = null, busy = false, originalFocus, context;
  const header = element('div', null, 'bug-header'); header.append(element('h2', 'Сообщить об ошибке'));
  button('Закрыть', () => close(), header); dialog.append(header);
  const status = element('p', null, 'bug-status'); status.setAttribute('role', 'status'); dialog.append(status);
  const form = element('form', null, 'bug-form'); dialog.append(form);
  const title = input('Кратко об ошибке', 'input', form); title.required = true; title.maxLength = 160;
  const description = input('Что произошло и что ожидалось', 'textarea', form); description.required = true; description.maxLength = 8000; description.rows = 5;
  const type = input('Тип отчёта', 'select', form);
  for (const [value, text] of [['bug', 'Ошибка'], ['reject', 'Отклонить']]) { const option = element('option', text); option.value = value; type.append(option); }
  const kindNote = element('p', null, 'bug-muted'); form.append(kindNote);
  const updateKind = () => { kindNote.textContent = type.value === 'reject' ? config.rejectNote || 'Отчёт об отклонении.' : ''; };
  type.onchange = updateKind;
  const attachmentsHeading = element('h3', 'Вложения · до 5 файлов'); form.append(attachmentsHeading);
  const toolbar = element('div', null, 'bug-actions'); form.append(toolbar);
  const capture = button('📷 Снимок окна', async () => {
    setBusy(true); host.classList.add('bug-capturing');
    try { const file = await (actions.capture || captureWindow)(); await addFiles([file]); status.textContent = 'Снимок добавлен. Проверьте его или добавьте отметки карандашом.'; }
    catch (error) { status.textContent = error.message; }
    finally { host.classList.remove('bug-capturing'); setBusy(false); }
  }, toolbar);
  const pickerLabel = element('label', 'Прикрепить файлы'), picker = element('input'); picker.type = 'file'; picker.multiple = true;
  picker.accept = 'image/png,image/jpeg,image/webp,application/pdf,text/plain,.txt,.log'; pickerLabel.append(picker); toolbar.append(pickerLabel);
  picker.onchange = async () => { try { await addFiles([...picker.files]); } catch (error) { status.textContent = error.message; } finally { picker.value = ''; } };
  const list = element('div', null, 'bug-attachments'); form.append(list);
  form.append(element('p', 'PNG, JPEG, WebP, PDF или текст · до 5 МБ каждый. Вложения доступны только после входа в Wiki.', 'bug-muted'));
  const editor = element('section', null, 'bug-editor'); editor.hidden = true; form.append(editor);
  const consentRow = element('label'), consent = element('input'); consent.type = 'checkbox'; consent.required = true;
  consentRow.append(consent, document.createTextNode(' Опубликовать заголовок и описание в GitHub' + (config.repository ? ` (${config.repository})` : '') + '. Вложения останутся в Wiki.')); form.append(consentRow);
  const submit = element('button', 'Отправить отчёт'); submit.type = 'submit'; form.append(submit);
  const outcome = element('section', null, 'bug-outcome'); outcome.hidden = true; dialog.append(outcome);
  function setBusy(value) {
    busy = value; form.querySelectorAll('input,textarea,select,button').forEach(node => { node.disabled = value || !!payload; });
    outcome.querySelectorAll('button').forEach(node => { node.disabled = value; });
    capture.disabled ||= files.length >= 5;
    picker.disabled ||= files.length >= 5;
  }
  async function addFiles(selected) {
    if (files.length + selected.length > 5) throw Error('Можно добавить не более пяти вложений. Удалите лишний файл.');
    const added = [];
    for (const file of selected) {
      if (!file.size || file.size > 5 * 1024 * 1024) throw Error('Каждое вложение должно быть не больше 5 МБ.');
      const mime = file.type || (/\.(txt|log)$/i.test(file.name) ? 'text/plain' : '');
      if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'].includes(mime)) throw Error('Разрешены PNG, JPEG, WebP, PDF и текстовые файлы.');
      const dataUrl = await readFile(file); added.push({ file, mime, dataUrl });
    }
    files.push(...added); renderAttachments();
  }
  function renderAttachments() {
    list.replaceChildren(); attachmentsHeading.textContent = `Вложения · ${files.length}/5`;
    files.forEach((item, index) => {
      const card = element('div', null, 'bug-attachment'); card.append(element('span', item.file.name));
      if (item.mime.startsWith('image/')) {
        const image = element('img'); image.src = item.dataUrl; image.alt = 'Предпросмотр: ' + item.file.name; card.append(image);
        button('✏ Карандаш', () => annotate(index), card).setAttribute('aria-label', 'Карандаш: ' + item.file.name);
      }
      button('Удалить', () => { files.splice(index, 1); editor.hidden = true; renderAttachments(); }, card).setAttribute('aria-label', 'Удалить: ' + item.file.name);
      list.append(card);
    });
    capture.disabled = busy || !!payload || files.length >= 5; picker.disabled = busy || !!payload || files.length >= 5;
  }
  async function annotate(index) {
    const editing = files[index];
    editor.replaceChildren(element('h3', 'Отметьте ошибку карандашом')); editor.hidden = false;
    const canvas = element('canvas'); canvas.hidden = true; canvas.setAttribute('aria-label', 'Снимок для отметок'); editor.append(canvas);
    const controls = element('div', null, 'bug-actions'); editor.append(controls);
    try {
      const drawing = await editImage(canvas, editing.file);
      canvas.hidden = false;
      button('Отменить штрих', drawing.undo, controls); button('Очистить отметки', drawing.clear, controls);
      button('Сохранить отметки', async () => {
        try { const file = await drawing.save(); if (file.size > 5 * 1024 * 1024) throw Error('Снимок с отметками превышает 5 МБ.'); const current = files.indexOf(editing); if (current < 0) throw Error('Вложение удалено.'); files[current] = { file, mime: 'image/png', dataUrl: await readFile(file) }; editor.hidden = true; renderAttachments(); }
        catch (error) { status.textContent = error.message; }
      }, controls);
      button('Отмена', () => { editor.hidden = true; }, controls);
    } catch (error) { status.textContent = error.message; editor.hidden = true; }
  }
  function showResult(result) {
    saved = result; outcome.replaceChildren(); outcome.hidden = false;
    const messages = { published: 'Отчёт отправлен в GitHub', unconfigured: 'Отчёт сохранён в Wiki', failed: 'Не удалось отправить в GitHub', unknown: 'Проверяем результат отправки' };
    outcome.append(element('h3', messages[result.status] || 'Отчёт сохранён'));
    if (result.message) outcome.append(element('p', result.message));
    if (result.issue) { const link = element('a', 'Открыть GitHub issue #' + result.issue.number); link.href = result.issue.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; outcome.append(link); }
    if (result.status !== 'published') button(result.status === 'unknown' ? 'Проверить результат' : 'Повторить отправку', async () => {
      setBusy(true); try { showResult(await actions.retry(result.id)); } catch (error) { status.textContent = error.message; } finally { setBusy(false); }
    }, outcome);
    const link = element('a', 'Отчёт и вложения в Wiki'); link.href = '/bug-reports?id=' + result.id; outcome.append(link);
  }
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || !form.reportValidity() || !editor.hidden) { if (!editor.hidden) status.textContent = 'Сохраните или отмените отметки перед отправкой.'; return; }
    payload ||= { id: crypto.randomUUID(), title: title.value, text: description.value, kind: type.value, context,
      publishConfirmed: consent.checked, attachments: files.map(item => ({ name: item.file.name, mime: item.mime, data: item.dataUrl.split(',')[1] })) };
    setBusy(true); status.textContent = 'Сохраняем отчёт и вложения…';
    try { showResult(await actions.submit(payload)); status.textContent = ''; }
    catch (error) {
      status.textContent = error.message;
      outcome.replaceChildren(); outcome.hidden = false;
      button('Повторить сохранение', () => form.requestSubmit(), outcome);
      if (error.status === 400 || error.status === 409) { payload = null; outcome.replaceChildren(); }
    } finally { setBusy(false); }
  };
  function close() { if (busy) return; dialog.close(); originalFocus?.focus(); }
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  async function open() {
    originalFocus = document.activeElement;
    context = actions.context?.() || { route: location.pathname, viewport: { width: innerWidth, height: innerHeight, devicePixelRatio } };
    if (!dialog.open) dialog.showModal();
    if (config.open) { title.value = config.title || ''; description.value = config.text || ''; }
    updateKind(); title.focus();
    if (config.files && !files.length) await addFiles(config.files);
    if (config.message) status.textContent = config.message;
    if (config.result) showResult(config.result);
  }
  if (config.open) queueMicrotask(open);
  return host;
}
