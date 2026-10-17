import { relatedForm, checkScenarioStep, laneOf } from './model.js';
import { mountExplanation } from '../explanations/render.js';
import { diagram as diagramLabels, flows as flowLabels, actions as actionLabels, visualForm } from '../managed/labels.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const svg=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
const sourceDetails=pointer=>{const n=el('details');n.className='visual-source';n.append(el('summary','Источник'),el('p',pointer));return n;};
let formSequence=0;
// One declarative tree renderer for process forms and captured widget templates.
// Region names, constants and unknown bindings are evidence, not runtime behavior.
export function mountFormVisual(tree,{simulation=false,values={}}={}) {
  const root=el('section');root.className='solution-form';
  const evidence=el('details');evidence.className='visual-form-evidence';evidence.append(el('summary',visualForm.sourceDeclarations));
  root.append(el('style',`.solution-form{min-width:0;overflow-wrap:anywhere}.solution-form *{box-sizing:border-box}.solution-form .visual-source{font-size:12px;color:#536660}.solution-form .visual-source p{overflow-wrap:anywhere}.solution-form .visual-form-region{min-width:0;margin:8px 0}.solution-form .visual-region-label{font-size:12px;color:#536660}.solution-form .visual-form-row>.visual-form-region>.visual-region-content{display:flex;gap:12px;align-items:flex-start}.solution-form .visual-form-row>.visual-form-region>.visual-region-content>.visual-form-node{flex:1;min-width:0}.solution-form .visual-form-group{border:1px solid #d4dedb;padding:12px;min-width:0}.solution-form .visual-form-node{min-width:0}.solution-form .visual-form-node label{display:block;margin:8px 0}.solution-form input{max-width:100%;width:100%}.solution-form input[type=checkbox]{width:auto}.solution-form .visual-unknown{border:1px dashed #9e751f;padding:8px}.solution-form [role=tablist]{display:flex;flex-wrap:wrap;gap:4px}.solution-form [role=tab][aria-selected=true]{border-bottom:3px solid #087451}.solution-form button{max-width:100%;overflow-wrap:anywhere}.solution-form [hidden]{display:none!important}.solution-form :focus-visible{outline:3px solid #147c61}@media(max-width:760px){.solution-form .visual-form-row>.visual-form-region>.visual-region-content{flex-direction:column}.solution-form .visual-form-row>.visual-form-region>.visual-region-content>.visual-form-node{width:100%}}`));
  const hints=(decl,parent)=>{
    for(const [key,label] of [['required',visualForm.required],['readOnly',visualForm.readOnly],['hidden',visualForm.hidden]]){
      const d=decl?.[key];if(!d||d.state==='absent')continue;
      const note=el('small',`${label}: ${d.state==='constant'?(d.value?flowLabels.yes:flowLabels.no)+' '+visualForm.declared:visualForm.runtimeUnknown}`);note.className='visual-declaration';parent.append(note,' ',sourceDetails(d.pointer));
    }
  };
  const visit=(node,parent,inheritedReadOnly=false,labelled=false)=>{
    const box=el('section');box.className='visual-form-node';box.dataset.descriptor=node.descriptor;
    const nodeEvidence=sourceDetails(node.pointer);nodeEvidence.querySelector('summary').textContent=node.label||node.descriptor||'Источник';evidence.append(nodeEvidence);
    const readOnly=inheritedReadOnly||node.declarations?.readOnly?.state==='unknown'||node.declarations?.readOnly?.value===true;
    hints(node.declarations,nodeEvidence);
    if(node.bindings?.length){
      const bindings=el('details');bindings.className='visual-source-bindings';bindings.append(el('summary',visualForm.sourceBindings+' · '+node.bindings.length));
      for(const binding of node.bindings)bindings.append(el('p',`${binding.name}: ${binding.kind==='path'?binding.path.join(' → '):visualForm.declarationSource}. ${visualForm.evaluationUnknown}`),sourceDetails(binding.pointer));
      nodeEvidence.append(bindings);
    }
    if(node.labelState==='unknown')box.append(el('p',visualForm.labelUnknown));
    if(node.style==='unknown')nodeEvidence.append(el('small',visualForm.styleUnknown));
    if(node.binding==='unknown')nodeEvidence.append(el('p',visualForm.bindingUnknown));
    if(!node.supported){box.classList.add('visual-unknown');box.append(el('p','Не поддерживается: '+(node.descriptor||'неизвестный элемент')));}
    let body=box;
    if(node.descriptor==='groupbox'){
      if(node.collapsible?.state==='constant'&&node.collapsible.value){
        body=el('details');body.className='visual-form-group';body.open=node.expanded?.state==='constant'?node.expanded.value:true;body.append(el('summary',node.label||visualForm.group));box.append(body);
      } else {box.classList.add('visual-form-group');box.append(el('h5',node.label||visualForm.group));}
      if(node.collapsible?.state==='unknown'||node.expanded?.state==='unknown')nodeEvidence.append(el('small',visualForm.groupStateUnknown));
    } else if(node.label&&node.descriptor!=='button'&&!labelled)box.append(el('h5',node.label));
    if(['row','row-layout'].includes(node.descriptor))body.classList.add('visual-form-row');
    if(node.descriptor==='button'){const button=el('button',node.label||'Действие');button.type='button';button.disabled=true;box.append(button,el('small','Поведение не проверено'));}
    if(node.descriptor==='buttons-panel')box.append(el('p',visualForm.actionsUnknown));
    for(const field of node.fields||[node.field].filter(Boolean)){
      const label=el('label',field.name||field.code||'Поле без названия'),input=el('input');
      const supported=['string','text','boolean','date','number','integer','float'].includes(field.type);
      input.disabled=!simulation||!supported||readOnly||field.declarations?.readOnly?.value===true||field.declarations?.readOnly?.state==='unknown';
      input.type=field.type==='boolean'?'checkbox':field.type==='date'?'date':['number','integer','float'].includes(field.type)?'number':field.type==='file'?'file':'text';
      if(input.type==='checkbox')input.checked=values[field.pointer]===true;else if(input.type!=='file')input.value=values[field.pointer]??'';
      input.oninput=()=>{values[field.pointer]=input.type==='checkbox'?input.checked:input.value;};
      if(field.type==='table')input.placeholder='Строки и структура таблицы неизвестны';
      if(field.type==='reference')input.placeholder='Ссылка и доступ в ELMA не проверены';
      const marks=field.required?[' · Обязательное по экспорту']:[];
      for(const [key,name] of [['required',visualForm.required],['readOnly',visualForm.readOnly],['hidden',visualForm.hidden]]){
        const d=field.declarations?.[key];
        if(d?.state==='unknown')marks.push(` · ${name}: ${visualForm.runtimeUnknown}`);
        else if(key!=='required'&&d?.state==='constant'&&d.value)marks.push(` · ${name}: ${flowLabels.yes} ${visualForm.declared}`);
      }
      label.append(input,...(marks.length?marks:[' · Представление поля']).map(mark=>{const note=el('small',mark);note.className='visual-field-declaration';return note;}));
      if(field.type==='unknown')label.append(el('small',' · '+visualForm.typeUnknown));
      else if(!['string','text','boolean','date','number','integer','float','file','table','reference'].includes(field.type))label.append(el('small',' · Тип / привязка не поддерживаются'));
      body.append(label);const fieldEvidence=sourceDetails(field.pointer);fieldEvidence.querySelector('summary').textContent=field.name||field.code||'Источник';nodeEvidence.append(fieldEvidence);hints(field.declarations,fieldEvidence);
    }
    const children=node.children||[];
    const regions=node.regions||[{name:'',from:0,to:children.length,supported:true}];
    for(const region of regions){
      const area=el('section');area.className='visual-form-region';area.dataset.region=region.name;
      const regionKey=region.name.startsWith('[')&&region.name.endsWith(']')?region.name.slice(1,-1):null;
      const regionLabel=regionKey&&Object.hasOwn(visualForm.regions,regionKey)?visualForm.regions[regionKey]:null;
      if(regionLabel){const label=el('h5',regionLabel);label.className='visual-region-label';area.append(label);}
      if(region.pointer)nodeEvidence.append(sourceDetails(region.pointer));
      if(!region.supported){area.classList.add('visual-unknown');area.append(el('p',visualForm.regionUnknown));}
      const regionChildren=children.slice(region.from,region.to);
      const regionBody=el('div');regionBody.className='visual-region-content';area.append(regionBody);
      if(node.descriptor==='tabset'&&regionChildren.length&&regionChildren.every(child=>child.descriptor==='tab')){
        const tabs=el('div');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',node.label||visualForm.tabs);regionBody.append(tabs);
        const buttons=[],panels=[];
        const activate=index=>{buttons.forEach((b,i)=>{b.setAttribute('aria-selected',String(i===index));b.tabIndex=i===index?0:-1;panels[i].hidden=i!==index;});};
        regionChildren.forEach((child,index)=>{
          const id='visual-form-tab-'+ ++formSequence,button=el('button',child.label||visualForm.tab+' '+(index+1)),panel=el('section');
          button.type='button';button.id=id;button.setAttribute('role','tab');button.setAttribute('aria-controls',id+'-panel');panel.id=id+'-panel';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',id);panel.tabIndex=0;
          buttons.push(button);panels.push(panel);button.onclick=()=>activate(index);
          button.onkeydown=event=>{let next;if(event.key==='ArrowRight')next=(index+1)%buttons.length;if(event.key==='ArrowLeft')next=(index+buttons.length-1)%buttons.length;if(event.key==='Home')next=0;if(event.key==='End')next=buttons.length-1;if(next!==undefined){event.preventDefault();activate(next);buttons[next].focus();}};
          tabs.append(button);visit(child,panel,readOnly,true);regionBody.append(panel);
        });activate(0);
      }else regionChildren.forEach(child=>visit(child,regionBody,readOnly));
      body.append(area);
    }
    parent.append(box);
  };
  visit(tree,root);root.append(evidence);return root;
}
export function mountSnapshotVisual(model={},actions={}) {
  const root=el('section');root.className='solution-visual';
  const style=el('style',`.solution-visual .visual-layout{display:grid;grid-template-columns:minmax(0,2fr) minmax(240px,1fr);gap:20px}.solution-visual svg{width:100%;max-height:560px;border:1px solid #d4dedb;background:#fafcfb}.solution-visual button{margin:4px;padding:8px}.solution-visual .visual-source{overflow-wrap:anywhere;font-size:12px;color:#536660}.solution-visual .visual-form{padding:16px;border:1px solid #d4dedb}.solution-visual .visual-unknown{padding:8px;border:1px dashed #9e751f}.solution-visual label{display:block;margin:8px 0}.solution-visual [role=button]:focus{outline:3px solid #147c61}.solution-visual input{max-width:100%}@media(max-width:760px){.solution-visual .visual-layout{grid-template-columns:1fr}}`);
  style.textContent += '.solution-visual{min-width:0;overflow-wrap:anywhere}.solution-visual .visual-layout>*{min-width:0}.solution-visual pre{white-space:pre-wrap;overflow-wrap:anywhere}.solution-visual input{box-sizing:border-box;width:100%}.solution-visual button{max-width:100%;overflow-wrap:anywhere}';
  style.textContent += '.solution-visual button{background:#fff;color:#125b88;border:1px solid #8aa0b0;border-radius:5px}.solution-visual .visual-evidence{display:flex;flex-wrap:wrap;gap:6px}.solution-visual .visual-evidence span{padding:5px 8px;background:#eef4f7;border-radius:4px;font-size:12px}.solution-visual .visual-scenario{padding:12px;border-left:4px solid #a4791e;background:#fff8e6}.solution-visual [role=alert]{color:#8c2630}';
  root.append(style,el('h2','Процесс и форма'),el('p','Схема восстановлена из экспорта. Поведение и права ELMA не проверены.'));
  if(model.loading){root.append(el('p','Загружаем визуальный обзор…'));return root;}
  if(model.error){const e=el('p',model.error);e.setAttribute('role','alert');root.append(e);if(actions.retry){const b=el('button','Повторить загрузку');b.type='button';b.onclick=actions.retry;root.append(b);}return root;}
  if(model.processLimit){root.append(el('p',flowLabels.tooManyProcesses+' · '+model.processLimit));return root;}
  if(!model.processes?.length){root.append(el('p','В этом снимке нет поддерживаемой схемы процесса. Исходный файл сохранён.'));return root;}
  if(model.synthetic)root.append(el('p','Учебный пример. Данные и сценарии синтетические.'));
  const badges=el('div');badges.className='visual-evidence';
  for(const label of ['Геометрия и поля: из экспорта','Представление: восстановлено Wiki','Наблюдение в ELMA: нет данных','Условия, права и интеграции: неизвестны'])badges.append(el('span',label));root.append(badges);
  const source=sourceDetails;
  const displayForm=(tree,parent,simulation=false,values={})=>parent.append(mountFormVisual(tree,{simulation,values}));
  const catalog=el('div'), content=el('div');root.append(catalog,content);
  const explanationPanels=new Map();
  // UX-03b: steps named by a review as changed are drawn with a warm fill and
  // listed once; the highlight is a projection of review evidence, not native
  // ELMA state. focusProcess() picks the process by its exact object identity.
  let highlighted=new Set();
  const explanation=(target,label,openSource)=>{
    const key=JSON.stringify(target);
    if(!explanationPanels.has(key)){
      const entry={openSource};
      entry.root=mountExplanation({target,label}, {...actions.explanations,openSource:reference=>entry.openSource(reference)});
      explanationPanels.set(key,entry);
    }
    const entry=explanationPanels.get(key);entry.openSource=openSource;return entry.root;
  };
  const show=process=>{
    content.replaceChildren(el('h3',process.name));
    let simulation=!!model.scenario, current, path=[], values=structuredClone(model.scenario?.values||{});
    const scenario=el('section');scenario.className='visual-scenario';
    const mode=el('button','Проверить путь по экспорту');mode.type='button';
    const status=el('p'), error=el('p');status.setAttribute('role','status');error.setAttribute('role','alert');
    const refresh=()=>{mode.textContent=simulation?'Завершить проверку пути':'Проверить путь по экспорту';status.textContent=simulation?
      'Проверка Wiki: '+path.join(' → ')+'. Выбор шага начинает новый путь; введённые значения сохраняются. Обязательность полей взята из экспорта; поведение ELMA не проверено.':'Выберите шаг и переход для просмотра. Проверка пути использует только локальные учебные значения.';};
    mode.onclick=()=>{simulation=!simulation;path=[];values={};error.textContent='';if(current)select(current);refresh();};
    scenario.append(mode,status,error);content.append(scenario);
    const layout=el('div');layout.className='visual-layout';const diagram=svg('svg',{viewBox:process.viewBox.join(' '),role:'img','aria-label':'Схема процесса из экспорта'}),panel=el('section');panel.className='visual-form';panel.setAttribute('aria-live','polite');
    const select=(node,followTransition=false)=>{
      current=node;error.textContent='';if(simulation){
        if(followTransition)path.push(node.name);else path=[node.name];
      }refresh();
      panel.replaceChildren(el('h3',node.name),source(node.pointer));
      // UX-06: who does it, from the lane that contains the step in the export.
      const lane=laneOf(process,node);panel.append(el('p',flowLabels.whoDoes+': '+(lane?lane.name:flowLabels.laneUnknown)));
      // UX-07: a request from this step carries its source anchor.
      if(actions.requestChange){const request=el('button',actionLabels.requestChange);request.type='button';request.className='secondary';request.onclick=()=>actions.requestChange({anchor:node.supported&&node.anchorIdentityKnown?node.anchor:null,stepName:node.name});panel.append(request);}
      if(actions.explanations)panel.append(explanation({scope:'step',artifactId:model.artifactId,source:process.source,nodeId:node.id},'Объяснить этот шаг',openSource));
      diagram.querySelectorAll('[data-node]').forEach(n=>n.setAttribute('stroke',n.dataset.node===node.id?'#087451':n.dataset.changed?'#b36b00':'#536660'));
      const relation=relatedForm(process,node.id);
      values[node.id]??={};
      if(relation.form){panel.append(el('p','Связь с формой указана в экспорте'),el('h4',relation.form.name));displayForm(relation.form.tree,panel,simulation,values[node.id]);}
      else panel.append(el('p',relation.status==='ambiguous'?'Связь неоднозначна: повторяется код узла или формы.':'Связь с формой не подтверждена.'));
      const branches=process.edges.filter(e=>e.source===node.id);
      panel.append(el('h4','Варианты перехода'));
      for(const edge of branches){const b=el('button',(simulation?'Проверить переход: ':'Посмотреть переход: ')+(edge.name||'без названия'));b.type='button';b.disabled=!edge.supported;b.onclick=()=>{
        if(simulation){
          if(path.length>=100){error.textContent='Достигнут предел проверки: 100 шагов. Выберите шаг, чтобы начать новый путь. Введённые значения сохранены.';return;}
          const result=checkScenarioStep(process,node.id,values[node.id],edge.id);
          if(!result.allowed){error.textContent=result.missing.length?'По экспорту требуется: '+result.missing.map(field=>field.name||field.code).join(', ')+'. Введённые значения сохранены.':'Проверка связи недоступна: неоднозначное или неподдерживаемое исходное состояние.';return;}}
        const target=process.nodes.find(n=>n.id===edge.target);if(target)select(target,simulation);
      };panel.append(b,el('small',' · Проверка Wiki и просмотр связи не подтверждают исполнение в ELMA'));}
      if(!branches.length)panel.append(el('p','Исходящих переходов в экспорте нет.'));
      if(node.anchor){const detail=el('details');detail.append(el('summary','Источник для замечания'),el('pre',JSON.stringify(node.anchor,null,2)));panel.append(detail);actions.selectAnchor?.(node.anchor);}
    };
    const openSource=reference=>{
      const matches=process.nodes.filter(node=>node.id===reference.nodeId);
      if(matches.length===1){select(matches[0]);const heading=panel.querySelector('h3');heading.tabIndex=-1;heading.focus();}
    };
    if(actions.explanations)content.append(explanation({scope:'process',artifactId:model.artifactId,source:process.source},'Объяснить этот процесс',openSource));
    for(const lane of process.lanes.filter(l=>l.position)){const p=lane.position;diagram.append(svg('rect',{...p,fill:'#edf3f0',stroke:'#bacbc4'}));const label=svg('text',{x:p.x+8,y:p.y+18,'font-size':14});label.textContent=lane.name;diagram.append(label);}
    for(const edge of process.edges.filter(e=>e.supported)){diagram.append(svg('polyline',{points:edge.points.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:'#667c72','stroke-width':2}));const p=edge.points[Math.floor(edge.points.length/2)],label=svg('text',{x:p.x+4,y:p.y-4,'font-size':12});label.textContent=edge.name;diagram.append(label);
      const end=edge.points.at(-1),before=edge.points.at(-2),angle=Math.atan2(end.y-before.y,end.x-before.x),back={x:end.x-9*Math.cos(angle),y:end.y-9*Math.sin(angle)};
      diagram.append(svg('polygon',{points:`${end.x},${end.y} ${back.x+4*Math.sin(angle)},${back.y-4*Math.cos(angle)} ${back.x-4*Math.sin(angle)},${back.y+4*Math.cos(angle)}`,fill:'#667c72'}));
    }
    if(highlighted.size){const legend=el('p',diagramLabels.changedSteps+': '+process.nodes.filter(node=>highlighted.has(node.id)).map(node=>node.name).join(', '));legend.className='visual-changed-legend';legend.setAttribute('role','status');content.append(legend);}
    for(const node of process.nodes){
      const changed=highlighted.has(node.id);
      const b=el('button',node.name+(node.supported?'':' · Не поддерживается')+(changed?' · '+diagramLabels.changedStep:''));b.type='button';b.onclick=()=>select(node);content.append(b);
      if(!node.position)continue;const p=node.position,g=svg('g',{role:'button',tabindex:0,'aria-label':node.name+(changed?' · '+diagramLabels.changedStep:''),'data-node':node.id,...(changed?{'data-changed':'true'}:{}),stroke:changed?'#b36b00':'#536660','stroke-width':changed?3:2});
      const shape=['start','end'].includes(node.type)?svg('ellipse',{cx:p.x+p.width/2,cy:p.y+p.height/2,rx:p.width/2,ry:p.height/2,fill:'#fff'}):node.type==='gateway'?svg('polygon',{points:`${p.x+p.width/2},${p.y} ${p.x+p.width},${p.y+p.height/2} ${p.x+p.width/2},${p.y+p.height} ${p.x},${p.y+p.height/2}`,fill:'#fff'}):svg('rect',{...p,rx:6,fill:node.supported?'#fff':'#fff2db'});
      const label=svg('text',{x:p.x+p.width/2,y:p.y+p.height/2,'text-anchor':'middle','font-size':12,stroke:'none',fill:'#213b2e'}),limit=Math.max(3,Math.floor(p.width/7));label.textContent=node.name.length>limit?node.name.slice(0,limit-1)+'…':node.name;
      const title=svg('title');title.textContent=node.name;g.append(title);
      if(changed)shape.setAttribute('fill','#fff3d6');
      g.append(shape,label);g.onclick=()=>select(node);g.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();select(node);}};diagram.append(g);
    }
    layout.append(diagram,panel);content.append(layout);
    // UX-06: unsupported lanes, transitions and projection issues in one collapsed list with a count.
    const unsupported=el('details'), unsupportedBody=el('div');unsupported.className='visual-unsupported';let unsupportedCount=0;
    for(const lane of process.lanes.filter(l=>!l.supported)){unsupportedCount++;unsupportedBody.append(el('p','Область процесса не поддерживается: '+(lane.name||lane.id)),source(lane.pointer));}
    for(const edge of process.edges.filter(e=>!e.supported)){unsupportedCount++;unsupportedBody.append(el('p','Переход не поддерживается: '+(edge.name||edge.id)),source(edge.pointer));}
    for(const issue of process.issues){unsupportedCount++;unsupportedBody.append(el('p',issue.reason),source(issue.pointer));}
    if(unsupportedCount){unsupported.append(el('summary',flowLabels.unsupported+' · '+unsupportedCount),unsupportedBody);content.append(unsupported);}
    if(process.nodes.length)select(process.nodes.find(node=>node.id===model.scenario?.stepId)||process.nodes[0]);
    if(model.scenario?.missing && current){const result=checkScenarioStep(process,current.id,values[current.id]||{},process.edges.find(edge=>edge.source===current.id)?.id);
      if(result.missing.length)error.textContent='По экспорту требуется: '+result.missing.map(field=>field.name||field.code).join(', ')+'. Введённые значения сохранены.';}
  };
  for(const process of model.processes){const b=el('button',process.name||process.source);b.type='button';b.onclick=()=>show(process);catalog.append(b);}
  show(model.processes[0]);
  root.focusProcess=({object,nodeIds=[]}={})=>{
    const process=model.processes.find(p=>JSON.stringify(p.object)===object);
    if(!process)return false;
    highlighted=new Set(nodeIds);show(process);
    root.scrollIntoView?.({block:'start'});return true;
  };
  return root;
}
