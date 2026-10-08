import { relatedForm, checkScenarioStep } from './model.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const svg=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
export function mountSnapshotVisual(model={},actions={}) {
  const root=el('section');root.className='solution-visual';
  const style=el('style',`.solution-visual .visual-layout{display:grid;grid-template-columns:minmax(0,2fr) minmax(240px,1fr);gap:20px}.solution-visual svg{width:100%;max-height:560px;border:1px solid #d4dedb;background:#fafcfb}.solution-visual button{margin:4px;padding:8px}.solution-visual .visual-source{overflow-wrap:anywhere;font-size:12px;color:#536660}.solution-visual .visual-form{padding:16px;border:1px solid #d4dedb}.solution-visual .visual-unknown{padding:8px;border:1px dashed #9e751f}.solution-visual label{display:block;margin:8px 0}.solution-visual [role=button]:focus{outline:3px solid #147c61}.solution-visual input{max-width:100%}@media(max-width:760px){.solution-visual .visual-layout{grid-template-columns:1fr}}`);
  style.textContent += '.solution-visual{min-width:0;overflow-wrap:anywhere}.solution-visual .visual-layout>*{min-width:0}.solution-visual pre{white-space:pre-wrap;overflow-wrap:anywhere}.solution-visual input{box-sizing:border-box;width:100%}.solution-visual button{max-width:100%;overflow-wrap:anywhere}';
  style.textContent += '.solution-visual button{background:#fff;color:#125b88;border:1px solid #8aa0b0;border-radius:5px}.solution-visual .visual-evidence{display:flex;flex-wrap:wrap;gap:6px}.solution-visual .visual-evidence span{padding:5px 8px;background:#eef4f7;border-radius:4px;font-size:12px}.solution-visual .visual-scenario{padding:12px;border-left:4px solid #a4791e;background:#fff8e6}.solution-visual [role=alert]{color:#8c2630}';
  root.append(style,el('h2','Процесс и форма'),el('p','Схема восстановлена из экспорта. Поведение и права ELMA не проверены.'));
  if(model.loading){root.append(el('p','Загружаем визуальный обзор…'));return root;}
  if(model.error){const e=el('p',model.error);e.setAttribute('role','alert');root.append(e);if(actions.retry){const b=el('button','Повторить загрузку');b.type='button';b.onclick=actions.retry;root.append(b);}return root;}
  if(!model.processes?.length){root.append(el('p','В этом снимке нет поддерживаемой схемы процесса. Исходный файл сохранён.'));return root;}
  if(model.synthetic)root.append(el('p','Учебный пример. Данные и сценарии синтетические.'));
  const badges=el('div');badges.className='visual-evidence';
  for(const label of ['Геометрия и поля: из экспорта','Представление: восстановлено Wiki','Наблюдение в ELMA: нет данных','Условия, права и интеграции: неизвестны'])badges.append(el('span',label));root.append(badges);
  const source=p=>{const n=el('details');n.className='visual-source';n.append(el('summary','Источник'),el('p',p));return n;};
  const displayForm=(tree,parent,simulation=false,values={})=>{
    const box=el('section');box.append(source(tree.pointer));
    if(!tree.supported){box.className='visual-unknown';box.append(el('p','Не поддерживается: '+(tree.descriptor||'неизвестный элемент')));}
    else if(tree.descriptor==='button'){const b=el('button',tree.label||'Действие');b.type='button';b.disabled=true;box.append(b,el('small','Поведение не проверено'));}
    else for(const f of tree.fields||[tree.field].filter(Boolean)){
      const label=el('label',f.name||f.code||'Поле без названия'), input=el('input');
      const supported=['string','text','boolean','date','number','integer','float'].includes(f.type);
      input.disabled=!simulation||!supported;
      input.type=f.type==='boolean'?'checkbox':f.type==='date'?'date':['number','integer','float'].includes(f.type)?'number':f.type==='file'?'file':'text';
      if(input.type==='checkbox')input.checked=values[f.pointer]===true;else if(input.type!=='file')input.value=values[f.pointer]??'';
      input.oninput=()=>{values[f.pointer]=input.type==='checkbox'?input.checked:input.value;};
      if(f.type==='table')input.placeholder='Строки и структура таблицы неизвестны';
      if(f.type==='reference')input.placeholder='Ссылка и доступ в ELMA не проверены';
      label.append(input,el('small',f.required?' · Обязательное по экспорту':' · Представление поля'));
      if(!['string','text','boolean','date','number','integer','float','file','table','reference'].includes(f.type))label.append(el('small',' · Тип / привязка не поддерживаются'));
      box.append(label,source(f.pointer));
    }
    tree.children.forEach(child=>displayForm(child,box,simulation,values));parent.append(box);
  };
  const catalog=el('div'), content=el('div');root.append(catalog,content);
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
      diagram.querySelectorAll('[data-node]').forEach(n=>n.setAttribute('stroke',n.dataset.node===node.id?'#087451':'#536660'));
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
    for(const lane of process.lanes.filter(l=>l.position)){const p=lane.position;diagram.append(svg('rect',{...p,fill:'#edf3f0',stroke:'#bacbc4'}));const label=svg('text',{x:p.x+8,y:p.y+18,'font-size':14});label.textContent=lane.name;diagram.append(label);}
    for(const edge of process.edges.filter(e=>e.supported)){diagram.append(svg('polyline',{points:edge.points.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:'#667c72','stroke-width':2}));const p=edge.points[Math.floor(edge.points.length/2)],label=svg('text',{x:p.x+4,y:p.y-4,'font-size':12});label.textContent=edge.name;diagram.append(label);
      const end=edge.points.at(-1),before=edge.points.at(-2),angle=Math.atan2(end.y-before.y,end.x-before.x),back={x:end.x-9*Math.cos(angle),y:end.y-9*Math.sin(angle)};
      diagram.append(svg('polygon',{points:`${end.x},${end.y} ${back.x+4*Math.sin(angle)},${back.y-4*Math.cos(angle)} ${back.x-4*Math.sin(angle)},${back.y+4*Math.cos(angle)}`,fill:'#667c72'}));
    }
    for(const node of process.nodes){
      const b=el('button',node.name+(node.supported?'':' · Не поддерживается'));b.type='button';b.onclick=()=>select(node);content.append(b);
      if(!node.position)continue;const p=node.position,g=svg('g',{role:'button',tabindex:0,'aria-label':node.name,'data-node':node.id,stroke:'#536660','stroke-width':2});
      const shape=['start','end'].includes(node.type)?svg('ellipse',{cx:p.x+p.width/2,cy:p.y+p.height/2,rx:p.width/2,ry:p.height/2,fill:'#fff'}):node.type==='gateway'?svg('polygon',{points:`${p.x+p.width/2},${p.y} ${p.x+p.width},${p.y+p.height/2} ${p.x+p.width/2},${p.y+p.height} ${p.x},${p.y+p.height/2}`,fill:'#fff'}):svg('rect',{...p,rx:6,fill:node.supported?'#fff':'#fff2db'});
      const label=svg('text',{x:p.x+p.width/2,y:p.y+p.height/2,'text-anchor':'middle','font-size':12,stroke:'none',fill:'#213b2e'}),limit=Math.max(3,Math.floor(p.width/7));label.textContent=node.name.length>limit?node.name.slice(0,limit-1)+'…':node.name;
      const title=svg('title');title.textContent=node.name;g.append(title);
      g.append(shape,label);g.onclick=()=>select(node);g.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();select(node);}};diagram.append(g);
    }
    layout.append(diagram,panel);content.append(layout);
    for(const lane of process.lanes.filter(l=>!l.supported))content.append(el('p','Область процесса не поддерживается: '+(lane.name||lane.id)),source(lane.pointer));
    for(const edge of process.edges.filter(e=>!e.supported))content.append(el('p','Переход не поддерживается: '+(edge.name||edge.id)),source(edge.pointer));
    for(const issue of process.issues)content.append(el('p',issue.reason),source(issue.pointer));
    if(process.nodes.length)select(process.nodes.find(node=>node.id===model.scenario?.stepId)||process.nodes[0]);
    if(model.scenario?.missing && current){const result=checkScenarioStep(process,current.id,values[current.id]||{},process.edges.find(edge=>edge.source===current.id)?.id);
      if(result.missing.length)error.textContent='По экспорту требуется: '+result.missing.map(field=>field.name||field.code).join(', ')+'. Введённые значения сохранены.';}
  };
  for(const process of model.processes){const b=el('button',process.name||process.source);b.type='button';b.onclick=()=>show(process);catalog.append(b);}
  show(model.processes[0]);return root;
}
