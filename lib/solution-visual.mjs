import crypto from 'node:crypto';
import { parseProject } from './project-parser.mjs';
import { projectProcess } from '../web/visual/model.js';
export const SOURCE_ANCHOR_VERSION = 3;
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
      node.anchor={artifactId,checksum,object:[entity.service,entity.namespace,entity.code],nodeId:node.id,pointer:node.pointer,
        // Hash the complete source node, including settings omitted by the
        // renderer. Only the digest crosses the API; imported code stays inert.
        fingerprint:crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex')};
    });
    processes.push({name:entity.name||entity.code,...visual});
  }
  return {schema:1,artifactId,checksum,processes,coverage:report.status,rendererVersion:'3',nativeObservation:'absent'};
}
// Persist only the bounded source references needed for durable discussions.
// Unsupported projections never prevent an ordinary captured Change review.
export async function sourceAnchorIndex(bytes, artifactId) {
  try {
    const visual = await snapshotVisual(bytes, artifactId);
    return { version: SOURCE_ANCHOR_VERSION, available: true, nodes: visual.processes.flatMap(process => process.nodes.map(node => ({ ...node.anchor, supported: node.supported && node.anchorIdentityKnown }))) };
  } catch { return { version: SOURCE_ANCHOR_VERSION, available: false, nodes: [] }; }
}
