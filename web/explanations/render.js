let sequence = 0;
const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };

// Production and Storybook share this stateful panel. Drafts belong to this
// browser instance and survive source navigation, safe failures and refresh.
export function mountExplanation(model = {}, actions = {}) {
  const root = el('section'); root.className = 'solution-explanation';
  const style = el('style', '.solution-explanation{margin:16px 0;padding:12px;border:1px solid #bcced6;min-width:0;overflow-wrap:anywhere}.solution-explanation pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit}.solution-explanation textarea{box-sizing:border-box;width:100%;min-height:220px;font:inherit}.solution-explanation button{padding:8px;margin:4px;max-width:100%;overflow-wrap:anywhere;background:#fff;color:#125b88;border:1px solid #8aa0b0;border-radius:5px}.solution-explanation .explanation-save{background:#146c53;color:#fff}.solution-explanation [role=alert]{color:#8c2630}.solution-explanation .explanation-comparison{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}@media(max-width:760px){.solution-explanation .explanation-comparison{grid-template-columns:1fr}}');
  const body = el('div'); root.append(style,body);
  let response = model.initial || null, busy = model.state === 'loading', error = model.error || '', blocked = model.state === 'conflict';
  let opened = !!model.initial || !!model.state || !!model.error, editing = model.state === 'draft' || !!response&&!response.saved, text = model.text ?? model.initial?.draft?.text ?? '', proposed = model.proposed ?? null;
  let notice = '', requestId = 0;
  const button = (parent, label, callback, disabled = false) => { const node = el('button',label); node.type='button'; node.disabled=disabled; node.onclick=callback; parent.append(node); return node; };
  async function load(regenerate = false) {
    if (busy) return;
    busy = true; opened = true; error = ''; notice = ''; render();
    const token = ++requestId;
    try {
      const result = await actions.read(model.target);
      if (token !== requestId) return;
      response = result; blocked = false;
      if (regenerate) proposed = result.draft.text;
      else if (!editing) { text = result.saved?.text ?? result.draft.text; editing = !result.saved; }
    } catch (e) { error = e.message || 'Не удалось загрузить объяснение.'; }
    finally { busy = false; render(); focusHeading(); }
  }
  async function save() {
    if (busy || blocked || !response?.writable || !text.trim()) return;
    busy=true; error=''; notice=''; render();
    try {
      response = await actions.save(model.target, { text, expectedRevision: response.expectedRevision,
        expectedVersion: response.version, expectedFingerprint: response.fingerprint });
      text=response.saved.text; editing=false; proposed=null; notice='Объяснение сохранено: '+response.title;
    } catch (e) {
      error=e.message || 'Не удалось сохранить объяснение.';
      blocked=e.status===409 || e.requiresRefresh || e.status>=500;
    } finally { busy=false; render(); focusHeading(); }
  }
  function focusHeading(){const heading=body.querySelector('h4');heading.tabIndex=-1;heading.focus({preventScroll:true});}
  function sources(parent, rows) {
    const details=el('details'); details.append(el('summary','Источники объяснения'));
    for (const row of rows || []) {
      const item=el('div');
      if (actions.openSource) button(item,row.label,()=>actions.openSource(row)); else item.append(el('strong',row.label));
      item.append(el('p',row.pointer)); details.append(item);
    }
    parent.append(details);
  }
  function render() {
    body.replaceChildren(el('h4','Объяснение'));
    if (!opened) { button(body,model.label || 'Объяснить, как это работает',()=>load()); return; }
    if (busy) { const status=el('p','Подготавливаем объяснение…'); status.setAttribute('role','status'); body.append(status); }
    if (error) { const alert=el('p',error); alert.setAttribute('role','alert'); body.append(alert); }
    if (notice) { const status=el('p',notice); status.setAttribute('role','status'); body.append(status); }
    if (blocked) body.append(el('p','Сохранение заблокировано до обновления. Ваш текст остаётся в редакторе. Сравните его с сохранённым текстом перед повтором.'));
    if (!response) { if (!busy) button(body,'Повторить загрузку объяснения',()=>load()); return; }
    body.append(el('p','Место сохранения: '+response.title),el('p','Подготовлено по объявленным данным экспорта. Назначение и работа в ELMA требуют проверки.'));
    if (response.reason) body.append(el('p',response.reason));
    if (response.saved) {
      if (response.saved.sourceStatus==='stale') body.append(el('p','Источник изменился — проверьте объяснение. Предыдущий текст сохранён.'));
      body.append(el('p',`Сохранил: ${response.saved.actor.login} · ${response.saved.at}`),el('pre',response.saved.text));
      sources(body,response.saved.sources);
      if (!editing) button(body,'Изменить объяснение',()=>{text=response.saved.text; editing=true; render();},busy||blocked||!response.writable);
    }
    if (editing) {
      const label=el('label','Текст объяснения'), textarea=el('textarea'); textarea.id='explanation-text-'+ ++sequence;
      label.htmlFor=textarea.id; textarea.maxLength=16000; textarea.value=text; textarea.disabled=busy;
      textarea.oninput=()=>{text=textarea.value; saveButton.disabled=busy||blocked||!response.writable||!text.trim();};
      body.append(label,textarea);
      const saveButton=button(body,'Сохранить объяснение',save,busy||blocked||!response.writable||!text.trim());
      saveButton.className='explanation-save';
      sources(body,response.draft.sources);
    }
    if (proposed !== null) {
      const compare=el('div'); compare.className='explanation-comparison';
      const current=el('section'), next=el('section'); current.append(el('h5','Ваш текст'),el('pre',text)); next.append(el('h5','Новый черновик'),el('pre',proposed)); compare.append(current,next); body.append(compare);
      button(body,'Использовать новый черновик',()=>{text=proposed; proposed=null; editing=true; render();},busy||blocked||!response.writable);
      button(body,'Оставить мой текст',()=>{proposed=null; render();},busy);
    }
    button(body,'Подготовить новое объяснение',()=>load(true),busy||blocked||!response.writable);
    button(body,'Обновить сохранённое объяснение',()=>load(),busy);
    if (response.history?.length) {
      const history=el('details'); history.append(el('summary','История объяснений'));
      for (const entry of response.history) history.append(el('p',`${entry.actor.login} · ${entry.at} · ${entry.title}`),el('pre',entry.text));
      body.append(history);
    }
    if (response.related?.length) {
      const related=el('details');related.append(el('summary','Сохранённые объяснения процессов и шагов'));
      const statuses={current:'Источник актуален',stale:'Источник изменился — требуется проверка',removed:'Элемент удалён из принятого состояния',ambiguous:'Связь с элементом неоднозначна'};
      for(const entry of response.related){
        related.append(el('h5',entry.title),el('p',statuses[entry.sourceStatus]),el('p',`${entry.actor.login} · ${entry.at}`),el('pre',entry.text));
        sources(related,entry.sources);
      }
      body.append(related);
    }
  }
  render(); return root;
}
