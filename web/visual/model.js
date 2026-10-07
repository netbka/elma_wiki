const object = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const text = v => typeof v === 'string' ? v.slice(0, 512) : '';
const escape = v => String(v).replaceAll('~', '~0').replaceAll('/', '~1');
const coordinate = v => Number.isFinite(v) && Math.abs(v) <= 100000 ? v : null;
const entries = v => Array.isArray(v) ? v.map((x,i) => [String(i),x]) : Object.entries(object(v));
const shapes = new Set(['start','end','user','assignment','gateway','script','notification','app_update','status','call','ca']);
const containers = new Set(['item-form-complex-popup','modal-body','row-layout','row','column','tabset','tab','sidebar-widget']);
function geometry(raw) {
  const x=coordinate(raw.x), y=coordinate(raw.y), width=coordinate(raw.width), height=coordinate(raw.height);
  return x !== null && y !== null && width > 0 && height > 0 ? {x,y,width,height} : null;
}
export function projectProcess(raw, source) {
  const process=object(raw.process), issues=[];
  const identities = rows => {
    const counts=new Map();
    for(const [key,value] of rows){const id=text(object(value).id)||key;counts.set(id,(counts.get(id)||0)+1);}
    return counts;
  };
  const rows=(value,section) => {
    const input=entries(value), counts=identities(input);
    if(input.length>500) throw Error('Слишком много элементов для визуального обзора.');
    return input.map(([key,value]) => {
      const item=object(value), id=text(item.id) || key, position=geometry(item);
      const pointer=`${source}#/process/${section}/${escape(key)}`;
      const duplicate=counts.get(id)>1;
      if(duplicate)issues.push({pointer,reason:'Неоднозначная идентичность элемента: повторяется код'});
      return {id,name:text(item.name)||text(item.type)||id,type:text(item.type),position,pointer,
        supported:!duplicate && !!position && (section==='lanes'||shapes.has(item.type)),
        ...(section==='items'?{formCode:text(object(item.settings).formCode)}:{})};
    });
  };
  const lanes=rows(process.lanes,'lanes'), nodes=rows(process.items,'items');
  const transitions=entries(process.transitions);
  if(transitions.length>1000) throw Error('Слишком много переходов для визуального обзора.');
  const transitionIds=identities(transitions);
  const edges=transitions.map(([key,value]) => {
    const edge=object(value), rawPoints=Array.isArray(edge.path)?edge.path:[];
    const points=rawPoints.slice(0,100).map(p=>({x:coordinate(p?.x),y:coordinate(p?.y)}));
    const sourceNode=nodes.filter(n=>n.id===edge.source), targetNode=nodes.filter(n=>n.id===edge.target);
    const id=text(edge.id)||key,pointer=`${source}#/process/transitions/${escape(key)}`,duplicate=transitionIds.get(id)>1;
    if(duplicate)issues.push({pointer,reason:'Неоднозначная идентичность перехода: повторяется код'});
    return {id,name:text(edge.name),type:text(edge.type),source:text(edge.source),target:text(edge.target),points,
      supported:!duplicate && rawPoints.length>=2 && rawPoints.length<=100 && points.every(p=>p.x!==null&&p.y!==null)
        && (edge.type===undefined || ['default','error','plain'].includes(edge.type))
        && sourceNode.length===1 && targetNode.length===1 && sourceNode[0].supported && targetNode[0].supported,
      pointer,behavior:'unknown'};
  });
  const forms=Array.isArray(raw.forms)?raw.forms:[];
  if(forms.length>100) throw Error('Слишком много форм для визуального обзора.');
  let controls=0;
  const form=(value,pointer,depth=0) => {
    if(++controls>2000||depth>20) throw Error('Форма превышает ограничения визуального обзора.');
    const node=object(value), values=object(node.values), descriptor=text(node.descriptor), children=[];
    for(const [slot,rows] of entries(node.content)) {
      if(!Array.isArray(rows)){issues.push({pointer:pointer+'/content/'+escape(slot),reason:'Неизвестная структура области формы'});continue;}
      rows.forEach((child,i)=>children.push(form(child,`${pointer}/content/${escape(slot)}/${i}`,depth+1)));
    }
    const fields=descriptor==='dynamic-form' && Array.isArray(values.fields)?values.fields:[];
    if(fields.length>100)throw Error('Форма превышает ограничения визуального обзора.');
    if(descriptor==='dynamic-form' && values.fields!==undefined && !Array.isArray(values.fields))issues.push({pointer:pointer+'/values/fields',reason:'Привязка полей требует ELMA; список полей не восстановлен'});
    // Preserve declarative field evidence only. No HTML, URLs, actions or script expressions reach the renderer.
    return {descriptor,pointer,label:text(values.label)||text(values.title),supported:containers.has(descriptor)
      ||['dynamic-form','dynamic-form-row','button'].includes(descriptor),children,
      ...(descriptor==='dynamic-form'?{fields:fields.slice(0,100).map((f,i)=>({code:text(f?.code),name:text(f?.view?.name)||text(f?.name)||text(f?.code),type:text(f?.type),required:f?.required===true,pointer:`${pointer}/values/fields/${i}`}))}:{}),
      ...(descriptor==='dynamic-form' && values.fields!==undefined && !Array.isArray(values.fields)?{binding:'unknown'}:{}),
      ...(descriptor==='dynamic-form-row'?{field:{name:text(values.displayName),required:values.required===true,type:'unknown',pointer:pointer+'/values/control'},binding:'unknown'}:{})};
  };
  const projectedForms=forms.map((value,i)=>({code:text(value?.code),name:text(value?.name)||text(value?.code),tree:form(value,`${source}#/forms/${i}`)}));
  const bounds=[...lanes,...nodes].filter(n=>n.position).map(n=>n.position);
  const points=edges.filter(e=>e.supported).flatMap(e=>e.points);
  const minX=Math.min(0,...bounds.map(p=>p.x),...points.map(p=>p.x)), minY=Math.min(0,...bounds.map(p=>p.y),...points.map(p=>p.y));
  const maxX=Math.max(100,...bounds.map(p=>p.x+p.width),...points.map(p=>p.x)), maxY=Math.max(100,...bounds.map(p=>p.y+p.height),...points.map(p=>p.y));
  return {source,nodes,lanes,edges,forms:projectedForms,issues,viewBox:[minX-20,minY-20,maxX-minX+40,maxY-minY+40],
    evidence:{geometry:'source-derived',rendering:'reconstructed',behavior:'unknown',nativeObservation:'absent'}};
}
export function relatedForm(process,nodeId) {
  const nodes=process.nodes.filter(n=>n.id===nodeId);
  if(nodes.length>1)return {status:'ambiguous'};
  if(nodes.length!==1||!nodes[0].formCode)return {status:'unknown'};
  const forms=process.forms.filter(f=>f.code===nodes[0].formCode);
  return forms.length===1?{status:'source-derived',form:forms[0]}:{status:forms.length?'ambiguous':'missing'};
}
export function scenarioFields(process, nodeId) {
  const relation = relatedForm(process, nodeId), fields = [];
  let unknown = relation.status !== 'source-derived';
  const visit = tree => {
    if (!tree.supported || tree.binding === 'unknown') unknown = true;
    for (const field of tree.fields || [tree.field].filter(Boolean)) {
      const supported = ['string','text','boolean','date','number','integer','float'].includes(field.type);
      if (!supported) unknown = true;
      fields.push({ ...field, supported });
    }
    tree.children.forEach(visit);
  };
  if (relation.form) visit(relation.form.tree);
  return { fields, unknown };
}
export function checkScenarioStep(process, nodeId, values = {}, transitionId) {
  const nodes = process.nodes.filter(node => node.id === nodeId), edges = process.edges.filter(edge => edge.id === transitionId && edge.source === nodeId);
  const { fields, unknown } = scenarioFields(process, nodeId);
  const missing = fields.filter(field => field.required && field.supported &&
    (values[field.pointer] === undefined || values[field.pointer] === null || typeof values[field.pointer] === 'string' && !values[field.pointer].trim()));
  const supported = nodes.length === 1 && nodes[0].supported && edges.length === 1 && edges[0].supported;
  return { allowed: supported && !missing.length, missing, unknown: unknown || !supported,
    evidence: 'simulated', nativeObservation: 'absent' };
}
