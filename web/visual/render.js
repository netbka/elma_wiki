import { relatedForm } from './model.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const svg=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
export function mountSnapshotVisual(model={},actions={}) {
  const root=el('section');root.className='solution-visual';
  const style=el('style',`.solution-visual .visual-layout{display:grid;grid-template-columns:minmax(0,2fr) minmax(240px,1fr);gap:20px}.solution-visual svg{width:100%;max-height:560px;border:1px solid #d4dedb;background:#fafcfb}.solution-visual button{margin:4px;padding:8px}.solution-visual .visual-source{overflow-wrap:anywhere;font-size:12px;color:#536660}.solution-visual .visual-form{padding:16px;border:1px solid #d4dedb}.solution-visual .visual-unknown{padding:8px;border:1px dashed #9e751f}.solution-visual label{display:block;margin:8px 0}.solution-visual [role=button]:focus{outline:3px solid #147c61}.solution-visual input{max-width:100%}@media(max-width:760px){.solution-visual .visual-layout{grid-template-columns:1fr}}`);
  style.textContent += '.solution-visual{min-width:0;overflow-wrap:anywhere}.solution-visual .visual-layout>*{min-width:0}.solution-visual pre{white-space:pre-wrap;overflow-wrap:anywhere}.solution-visual input{box-sizing:border-box;width:100%}.solution-visual button{max-width:100%;overflow-wrap:anywhere}';
  root.append(style,el('h2','Процесс и форма'),el('p','Схема восстановлена из экспорта. Поведение и права ELMA не проверены.'));
  if(model.loading){root.append(el('p','Загружаем визуальный обзор…'));return root;}
  if(model.error){const e=el('p',model.error);e.setAttribute('role','alert');root.append(e);if(actions.retry){const b=el('button','Повторить загрузку');b.type='button';b.onclick=actions.retry;root.append(b);}return root;}
  if(!model.processes?.length){root.append(el('p','В этом снимке нет поддерживаемой схемы процесса. Исходный файл сохранён.'));return root;}
  if(model.synthetic)root.append(el('p','Учебный пример. Данные и сценарии синтетические.'));
  const source=p=>{const n=el('details');n.className='visual-source';n.append(el('summary','Источник'),el('p',p));return n;};
  const displayForm=(tree,parent)=>{
    const box=el('section');box.append(source(tree.pointer));
    if(!tree.supported){box.className='visual-unknown';box.append(el('p','Не поддерживается: '+(tree.descriptor||'неизвестный элемент')));}
    else if(tree.descriptor==='button'){const b=el('button',tree.label||'Действие');b.type='button';b.disabled=true;box.append(b,el('small','Поведение не проверено'));}
    else for(const f of tree.fields||[tree.field].filter(Boolean)){
      const label=el('label',f.name||f.code||'Поле без названия'), input=el('input');input.disabled=true;
      input.type=f.type==='boolean'?'checkbox':f.type==='date'?'date':'text';label.append(input,el('small',f.required?' · Обязательное по экспорту':' · Представление поля'));
      if(!['string','text','boolean','date','number','integer','float','file','table','reference'].includes(f.type))label.append(el('small',' · Тип / привязка не поддерживаются'));
      box.append(label,source(f.pointer));
    }
    tree.children.forEach(child=>displayForm(child,box));parent.append(box);
  };
  const catalog=el('div'), content=el('div');root.append(catalog,content);
  const show=process=>{
    content.replaceChildren(el('h3',process.name));
    const layout=el('div');layout.className='visual-layout';const diagram=svg('svg',{viewBox:process.viewBox.join(' '),role:'img','aria-label':'Схема процесса из экспорта'}),panel=el('section');panel.className='visual-form';panel.setAttribute('aria-live','polite');
    const select=node=>{
      panel.replaceChildren(el('h3',node.name),source(node.pointer));
      diagram.querySelectorAll('[data-node]').forEach(n=>n.setAttribute('stroke',n.dataset.node===node.id?'#087451':'#536660'));
      const relation=relatedForm(process,node.id);
      if(relation.form){panel.append(el('p','Связь с формой указана в экспорте'),el('h4',relation.form.name));displayForm(relation.form.tree,panel);}
      else panel.append(el('p',relation.status==='ambiguous'?'Связь неоднозначна: повторяется код узла или формы.':'Связь с формой не подтверждена.'));
      const branches=process.edges.filter(e=>e.source===node.id);
      panel.append(el('h4','Варианты перехода'));
      for(const edge of branches){const b=el('button','Посмотреть переход: '+(edge.name||'без названия'));b.type='button';b.disabled=!edge.supported;b.onclick=()=>{const target=process.nodes.find(n=>n.id===edge.target);if(target)select(target);};panel.append(b,el('small',' · Только просмотр связи, условия и исполнение неизвестны'));}
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
    if(process.nodes.length)select(process.nodes[0]);
  };
  for(const process of model.processes){const b=el('button',process.name||process.source);b.type='button';b.onclick=()=>show(process);catalog.append(b);}
  show(model.processes[0]);return root;
}
