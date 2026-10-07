import crypto from 'node:crypto';
import { parseProject } from './project-parser.mjs';
import { projectProcess } from '../web/visual/model.js';
export async function snapshotVisual(bytes, artifactId) {
  const {files,data,report}=await parseProject(bytes), processes=[];
  const checksum=crypto.createHash('sha256').update(bytes).digest('hex');
  const entities=data.entities.filter(e=>e.service==='processor');
  if(entities.length>50) throw Error('Для обзора выберите меньший пакет: не более 50 процессов.');
  for(const entity of entities) {
    const raw=JSON.parse(files.get(entity.archivePath).toString('utf8').replace(/^\uFEFF/,''));
    if(!raw?.process)continue;
    const visual=projectProcess(raw,entity.archivePath);
    for(const node of visual.nodes) node.anchor={artifactId,checksum,object:[entity.service,entity.namespace,entity.code],nodeId:node.id,pointer:node.pointer,
      fingerprint:crypto.createHash('sha256').update(JSON.stringify(node)).digest('hex')};
    processes.push({name:entity.name||entity.code,...visual});
  }
  return {schema:1,artifactId,checksum,processes,coverage:report.status,rendererVersion:'2',nativeObservation:'absent'};
}
// Persist only the bounded source references needed for durable discussions.
// Unsupported projections never prevent an ordinary captured Change review.
export async function sourceAnchorIndex(bytes, artifactId) {
  try {
    const visual = await snapshotVisual(bytes, artifactId);
    return { available: true, nodes: visual.processes.flatMap(process => process.nodes.map(node => ({ ...node.anchor, supported: node.supported }))) };
  } catch { return { available: false, nodes: [] }; }
}
