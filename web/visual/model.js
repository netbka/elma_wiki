import { visualForm } from '../managed/labels.js';
const object = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const text = v => typeof v === 'string' ? v.slice(0, 512) : '';
const escape = v => String(v).replaceAll('~', '~0').replaceAll('/', '~1');
const coordinate = v => Number.isFinite(v) && Math.abs(v) <= 100000 ? v : null;
const entries = v => Array.isArray(v) ? v.map((x,i) => [String(i),x]) : Object.entries(object(v));
const shapes = new Set(['start','end','user','assignment','gateway','script','notification','app_update','status','call','ca']);
const containers = new Set(['item-form-complex-popup','modal-body','row-layout','row','column','tabset','tab','sidebar-widget','groupbox']);
// A declaration is evidence, never an evaluated expression or an ELMA default.
function bindingReference(value, pointer) {
  const path=object(value).path;
  // Native path segments are declarative references. Opaque expressions keep
  // their exact immutable source pointer; executable bodies never cross this API.
  return {pointer,kind:Array.isArray(path)&&path.length<=100&&path.every(segment=>typeof segment==='string'&&segment.length<=512)?'path':value&&typeof value==='object'?'expression':'literal',
    ...(Array.isArray(path)&&path.length<=100&&path.every(segment=>typeof segment==='string'&&segment.length<=512)?{path:[...path]}:{}),evaluation:'unknown'};
}
function declaration(values, key, pointer) {
  if (!Object.hasOwn(values, key)) return {state:'absent'};
  return typeof values[key] === 'boolean' ? {state:'constant',value:values[key],pointer:`${pointer}/${key}`} : {state:'unknown',...bindingReference(values[key],`${pointer}/${key}`)};
}
function declarations(values, pointer) {
  return {required:declaration(values,'required',pointer),readOnly:declaration(values,'__readOnly',pointer),hidden:declaration(values,'__hidden',pointer)};
}
export function projectForm(value, pointer, issues = [], budget = {controls:0}, depth = 0) {
  if (++budget.controls > 2000 || depth > 20) throw Error('Форма превышает ограничения визуального обзора.');
  const node=object(value), values=object(node.values), descriptor=text(node.descriptor), children=[], regions=[];
  for (const [slot, rows] of entries(node.content)) {
    const region={name:slot,pointer:`${pointer}/content/${escape(slot)}`,from:children.length,to:children.length,supported:Array.isArray(rows)};
    if (!region.supported) issues.push({pointer:region.pointer,reason:'Неизвестная структура области формы'});
    else rows.forEach((child,i)=>children.push(projectForm(child,`${region.pointer}/${i}`,issues,budget,depth+1)));
    region.to=children.length; regions.push(region);
  }
  if (node.content !== undefined && (!node.content || typeof node.content !== 'object')) issues.push({pointer:pointer+'/content',reason:visualForm.regionsUnknown});
  const fields=descriptor==='dynamic-form' && Array.isArray(values.fields)?values.fields:[];
  if (fields.length>100) throw Error('Форма превышает ограничения визуального обзора.');
  const binding=descriptor==='dynamic-form' && values.fields!==undefined && !Array.isArray(values.fields)
    || descriptor==='dynamic-form-row' || descriptor==='buttons-panel' && values.buttons!==undefined;
  // An ordinary native binding is runtime uncertainty, not lost structure.
  // Keep it on the node/scenario; only an unavailable field list is a process issue.
  if (descriptor==='dynamic-form' && values.fields!==undefined && !Array.isArray(values.fields))
    issues.push({pointer:pointer+'/values/fields',reason:visualForm.bindingNotEvaluated});
  const label=values.label ?? values.title;
  const bindings=['fields','form','control','buttons','action','onClick','onChangeValue','__hidden','__readOnly','required','label','title','displayName']
    .filter(key=>Object.hasOwn(values,key)&&(values[key]!==null&&typeof values[key]==='object'&&!Array.isArray(values[key])||['action','onClick','onChangeValue'].includes(key)))
    .map(key=>({name:key,...bindingReference(values[key],`${pointer}/values/${key}`)}));
  return {descriptor,pointer,label:text(label),labelState:label===undefined?'absent':typeof label==='string'?'source-derived':'unknown',
    supported:containers.has(descriptor)||['dynamic-form','dynamic-form-row','button','buttons-panel'].includes(descriptor),
    declarations:declarations(values,pointer+'/values'),bindings,children,regions,
    // Uploaded styling and expressions are deliberately not passed to the DOM.
    ...(values.__styles?{style:'unknown'}:{}),
    ...(binding?{binding:'unknown'}:{}),
    ...(descriptor==='groupbox'?{collapsible:declaration(values,'collapsible',pointer+'/values'),expanded:declaration(values,'expanded',pointer+'/values')}:{}),
    ...(descriptor==='dynamic-form'?{fields:fields.map((f,i)=>({code:text(f?.code),name:text(f?.view?.name)||text(f?.name)||text(f?.code),type:text(f?.type),required:f?.required===true,
      declarations:declarations(object(f),`${pointer}/values/fields/${i}`),pointer:`${pointer}/values/fields/${i}`}))}:{}),
    ...(descriptor==='dynamic-form-row'?{field:{name:text(values.displayName),required:values.required===true,type:'unknown',declarations:declarations(values,pointer+'/values'),pointer:pointer+'/values/control'}}:{})};
}
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
  const budget={controls:0};
  const projectedForms=forms.map((value,i)=>({code:text(value?.code),name:text(value?.name)||text(value?.code),tree:projectForm(value,`${source}#/forms/${i}`,issues,budget)}));
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
    if (!tree.supported || tree.binding === 'unknown' || tree.bindings?.some(binding=>binding.evaluation==='unknown') || Object.values(tree.declarations||{}).some(d=>d.state==='unknown')) unknown = true;
    for (const field of tree.fields || [tree.field].filter(Boolean)) {
      const supported = ['string','text','boolean','date','number','integer','float'].includes(field.type);
      if (!supported || Object.values(field.declarations||{}).some(d=>d.state==='unknown')) unknown = true;
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

// UX-06: a one-line reading of a process from its declared human tasks, in the
// order the export lists them. Names only; no execution order is claimed.
export function processSummary(process, limit = 6) {
  const tasks = (process?.nodes || []).filter(node => ['user', 'assignment'].includes(node.type)).map(node => node.name).filter(Boolean);
  return { tasks: tasks.slice(0, limit), more: Math.max(0, tasks.length - limit), steps: process?.nodes?.length || 0 };
}
// The lane whose declared rectangle contains the step; null when none or ambiguous.
export function laneOf(process, node) {
  if (!node?.position) return null;
  const cx = node.position.x + node.position.width / 2, cy = node.position.y + node.position.height / 2;
  const lanes = (process?.lanes || []).filter(lane => lane.supported && lane.position && cx >= lane.position.x && cx <= lane.position.x + lane.position.width && cy >= lane.position.y && cy <= lane.position.y + lane.position.height);
  return lanes.length === 1 ? lanes[0] : null;
}
