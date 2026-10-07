import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
import * as typescript from 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';
import 'monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/esm/vs/editor/contrib/format/browser/formatActions.js';
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController.js';
import 'monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/goToCommands.js';

self.MonacoEnvironment = {getWorkerUrl:(_,label) => label === 'typescript' || label === 'javascript' ? '/assets/ts.worker.js' : '/assets/editor.worker.js'};
const $ = id => document.getElementById(id), [,,projectId,objectId] = location.pathname.split('/');
const prefix = '/api/projects/' + encodeURIComponent(projectId) + '/workspace/' + encodeURIComponent(objectId);
$('back').href='/p/'+encodeURIComponent(projectId)+'/#/object/'+encodeURIComponent(objectId);
let state, remote, selected, editor, diff, originalModel, modifiedModel, typesModels=[], models={}, timer, saving, dirty=false, frozen=false, generation=0, showingDiff=false;
const buttons=['save','check','checkpoint','changes','restore'];
const busy = value => buttons.forEach(id => $(id).disabled=value || frozen);
const request = async (action,payload) => {
  const response=await fetch(prefix+(action ? '/'+action : ''),payload === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json','X-Elma-Wiki-Request':'1'},body:JSON.stringify(payload)});
  const value=await response.json(); if (!response.ok) throw Object.assign(Error(value.error || 'Ошибка запроса'),{status:response.status}); return value;
};
const files = () => Object.fromEntries(Object.entries(models).map(([name,model]) => [name,model.getValue()]));
const showError = error => $('error').textContent=error.message;
function configureTypes() {
  const defaults=typescript.typescriptDefaults;
  defaults.setCompilerOptions({target:typescript.ScriptTarget.ES2022,module:typescript.ModuleKind.ESNext,moduleDetection:3,strict:true,noEmit:true,allowNonTsExtensions:true});
  defaults.setDiagnosticsOptions({noSemanticValidation:false,noSyntaxValidation:false});
  defaults.setExtraLibs([]); typesModels.forEach(m=>m.dispose()); typesModels=[];
  // The server performs side-specific checks; generated client declarations power completion.
  const text=state.types.client;
  defaults.addExtraLib(text,'file:///workspace/types.d.ts');
  defaults.addExtraLib(state.types.rpc,'file:///workspace/server.d.ts');
  typesModels.push(monaco.editor.createModel(text,'typescript',monaco.Uri.parse('file:///workspace/generated-types.d.ts')));
}
function showDiagnostics(result) {
  $('problems').replaceChildren();
  Object.values(models).forEach(model=>monaco.editor.setModelMarkers(model,'workspace',[]));
  if (!result) { $('check-state').textContent='— проверка требуется'; return; }
  $('check-state').textContent=result.typescript === 'passed' ? '— TypeScript пройден; ELMA не проверена' : '— ошибки TypeScript';
  for (const [name,model] of Object.entries(models)) monaco.editor.setModelMarkers(model,'workspace',result.diagnostics.filter(d=>d.file===name).map(d=>({...d,startLineNumber:d.startLineNumber || 1,startColumn:d.startColumn || 1,endLineNumber:d.endLineNumber || 1,endColumn:d.endColumn || 2,severity:d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,source:d.category === 'lint' ? 'ELMA lint (статический)' : 'TypeScript'})));
  for (const d of result.diagnostics) {
    const li=document.createElement('li'),button=document.createElement('button');button.className='problem-'+d.severity;
    button.textContent=`${d.file}:${d.startLineNumber || 1} · ${d.category === 'lint' ? 'Предупреждение lint' : d.code} · ${d.message}`;
    button.onclick=()=>{selectFile(d.file);editor.setPosition({lineNumber:d.startLineNumber || 1,column:d.startColumn || 1});editor.revealLineInCenter(d.startLineNumber || 1);editor.focus();};li.append(button);$('problems').append(li);
  }
}
function updateState(next) {
  state=next;
  $('restore-choice').replaceChildren();
  for (const row of [{id:'original',label:'Оригинал загрузки'},...state.checkpoints,...state.history.slice().reverse()]) { const option=document.createElement('option');option.value=row.id;option.textContent=row.label;$('restore-choice').append(option); }
  showDiagnostics(state.check);configureTypes();
}
function selectFile(name) {
  selected=name;showingDiff=false;$('diff').hidden=true;$('editor').hidden=false;
  const generated=name==='types.d.ts';editor.setModel(generated ? typesModels[0] : models[name]);editor.updateOptions({readOnly:generated || frozen});
  $('file-title').textContent=name+(generated ? ' · сгенерировано, только чтение' : ' · '+state.origins[name]);
  document.querySelectorAll('#explorer button').forEach(b=>b.classList.toggle('active',b.dataset.file===name));
}
async function conflict(error) {
  if (error.status !== 409) throw error;
  frozen=true;dirty=true;clearTimeout(timer);busy(false);editor.updateOptions({readOnly:true});
  $('save-state').textContent='Конфликт — локальный текст сохранён в редакторе';showError(error);
  remote=await request('');$('compare').hidden=false;$('accept-remote').hidden=false;
}
async function save() {
  clearTimeout(timer);if(frozen) throw Error('Сначала разрешите конфликт сохранения');
  if(saving) {await saving;return save();} if(!dirty)return;
  const at=generation,snapshot=files();$('save-state').textContent='Сохранение…';
  saving=(async()=>{try { const next=await request('save',{revision:state.revision,files:snapshot});state=next;dirty=generation!==at;if(!dirty){updateState(next);$('save-state').textContent='Сохранено · ревизия '+state.revision;} }
    catch(e){await conflict(e);throw e;}finally{saving=null;}})();
  await saving;if(dirty && !frozen) return save();
}
async function action(kind,payload={}) {
  busy(true);editor.updateOptions({readOnly:true});$('error').textContent='';
  try {await save();const at=generation;const next=await request(kind,{revision:state.revision,...payload});updateState(next);if(generation!==at){showDiagnostics(null);$('save-state').textContent='Есть несохранённые изменения';}else $('save-state').textContent='Сохранено · ревизия '+state.revision;return next;}
  catch(e){if(e.status===409 && !frozen) await conflict(e);showError(e);}
  finally{busy(false);editor.updateOptions({readOnly:frozen || selected==='types.d.ts'});}
}
function compare(remoteFiles) {
  const name=selected in models ? selected : Object.keys(models)[0];
  originalModel?.dispose();modifiedModel?.dispose();originalModel=monaco.editor.createModel(remoteFiles[name],'typescript');modifiedModel=monaco.editor.createModel(models[name].getValue(),'typescript');
  diff ||= monaco.editor.createDiffEditor($('diff'),{automaticLayout:true,readOnly:true,theme:'vs-dark',renderSideBySide:true});
  diff.setModel({original:originalModel,modified:modifiedModel});$('editor').hidden=true;$('diff').hidden=false;showingDiff=true;
  $('file-title').textContent=name+(remote ? ' · сохранённая копия / локальный текст' : ' · оригинал / рабочая копия');
}
async function start() {
  state=await request('');$('title').textContent=state.object.name || state.object.code;
  $('notice').textContent=state.limitations.join(' ');
  for (const [name,text] of Object.entries(state.files)) {
    const model=monaco.editor.createModel(text,'typescript',monaco.Uri.parse('file:///workspace/'+(name==='server.ts' ? 'source-server.ts' : name)));models[name]=model;
    model.onDidChangeContent(()=>{dirty=true;generation++;showDiagnostics(null);$('save-state').textContent='Есть несохранённые изменения';clearTimeout(timer);timer=setTimeout(()=>save().catch(showError),700);});
  }
  updateState(state);
  editor=monaco.editor.create($('editor'),{model:null,automaticLayout:true,theme:'vs-dark',minimap:{enabled:false},fontSize:14,scrollBeyondLastLine:false});
  for (const name of [...Object.keys(models),'types.d.ts']) {const button=document.createElement('button');button.textContent=name;button.dataset.file=name;button.onclick=()=>selectFile(name);$('explorer').append(button);}
  selectFile(Object.keys(models)[0]);$('save-state').textContent='Сохранено · ревизия '+state.revision;busy(false);
  $('save').onclick=async()=>{busy(true);$('error').textContent='';try{await save();}catch(e){showError(e);}finally{busy(false);}};
  $('check').onclick=()=>action('check');
  $('checkpoint').onclick=()=>{const label=prompt('Имя контрольной точки');if(label)action('checkpoint',{label});};
  $('restore').onclick=async()=>{if(!confirm('Восстановить выбранную версию? Текущая копия останется в истории.'))return;const next=await action('restore',{checkpoint:$('restore-choice').value});if(next){for(const [name,model] of Object.entries(models))model.setValue(next.files[name]);dirty=false;clearTimeout(timer);showDiagnostics(next.check);selectFile(selected);$('save-state').textContent='Сохранено · ревизия '+next.revision;}};
  $('changes').onclick=async()=>{try{await save();compare(state.original);}catch(e){showError(e);}};
  $('compare').onclick=()=>compare(remote.files);
  $('accept-remote').onclick=()=>{if(confirm('Локальный текст будет заменён сохранённой копией. Скопируйте нужные изменения перед продолжением.'))location.reload();};
  window.addEventListener('beforeunload',event=>{if(dirty || saving){event.preventDefault();event.returnValue='';}});
  window.__workspace={getValue:name=>models[name]?.getValue(),setValue:(name,text)=>models[name].setValue(text),save,getModel:name=>models[name],getState:()=>state,monaco,typescript};
}
start().catch(e=>{$('save-state').textContent='Редактор недоступен';showError(e);});
