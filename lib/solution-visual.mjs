import crypto from 'node:crypto';
import { parseProject } from './project-parser.mjs';
import { componentIdentity } from './native-components.mjs';
import { projectProcess } from '../web/visual/model.js';
export const SOURCE_ANCHOR_VERSION = 4;
export async function snapshotVisual(bytes, artifactId) {
  const {files,data,report}=await parseProject(bytes), processes=[];
  const checksum=crypto.createHash('sha256').update(bytes).digest('hex');
  const entities=data.entities.filter(e=>e.service==='processor');
  if(entities.length>50) throw Error('Для обзора выберите меньший пакет: не более 50 процессов.');
  for(const entity of entities) {
    const raw=JSON.parse(files.get(entity.archivePath).toString('utf8').replace(/^\uFEFF/,''));
    if(!raw?.process)continue;
    const visual=projectProcess(raw,entity.archivePath);
    const items=raw.process.items, array=Array.isArray(items);
    const sourceNodes=array?items.map((item,index)=>[String(index),item]):Object.entries(items&&typeof items==='object'?items:{});
    visual.nodes.forEach((node,index)=>{
      const [key,item]=sourceNodes[index];
      // Array position is a rendering fallback, never a durable source ID.
      // Dictionary keys can identify a source item when no native ID exists.
      const id=typeof item?.id==='string'&&item.id?item.id:array?null:key;
      node.anchorIdentityKnown=id===node.id;
      node.anchor={artifactId,checksum,object:componentIdentity(entity),nodeId:node.id,pointer:node.pointer,
        // Hash the complete source node, including settings omitted by the
        // renderer. Only the digest crosses the API; imported code stays inert.
        fingerprint:crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex')};
    });
    processes.push({name:entity.name||entity.code,object:componentIdentity(entity),...visual});
  }
  // UX-06: screens (widgets) and data objects (applications, collections) with the
  // fields their export declares. Only declarative field evidence is projected;
  // scripts, actions and bindings never leave the archive. Fields are null when the
  // export declares none in a known place.
  const objects=[];
  for(const entity of data.entities.filter(e=>['widgets','applications','collections'].includes(e.service))){
    let raw=null; try{raw=JSON.parse(files.get(entity.archivePath).toString('utf8').replace(/^\uFEFF/,''));}catch{raw=null;}
    const o=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
    const declared=entity.service==='widgets'?o.descriptor?.fields:o.fields;
    const fields=Array.isArray(declared)?declared.slice(0,200).filter(f=>f&&typeof f==='object').map((f,i)=>({
      code:String(f.code??'').slice(0,256),name:String(f.view?.name||f.name||f.code||'').slice(0,512),type:String(f.type??'').slice(0,64),required:f.required===true,
      pointer:`${entity.archivePath}#/${entity.service==='widgets'?'descriptor/fields':'fields'}/${i}`})):null;
    objects.push({object:componentIdentity(entity),service:entity.service,code:entity.code,name:entity.name||entity.code,fields,source:entity.archivePath});
  }
  return {schema:1,artifactId,checksum,processes,objects,coverage:report.status,rendererVersion:'3',nativeObservation:'absent'};
}
// Persist only the bounded source references needed for durable discussions.
// Unsupported projections never prevent an ordinary captured Change review.
export async function sourceAnchorIndex(bytes, artifactId) {
  try {
    const visual = await snapshotVisual(bytes, artifactId);
    return { version: SOURCE_ANCHOR_VERSION, available: true, nodes: visual.processes.flatMap(process => process.nodes.map(node => ({ ...node.anchor, supported: node.supported && node.anchorIdentityKnown }))) };
  } catch { return { version: SOURCE_ANCHOR_VERSION, available: false, nodes: [] }; }
}
