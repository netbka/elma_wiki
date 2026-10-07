import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildDtsRequest, sdkRequestHash, compilerContract } from '../lib/widget-context.mjs';
import { serverFunctions } from '../lib/workspace-check.mjs';

// Synthetic SDK only. This is deliberately not a customer/server export.
export async function installSyntheticProfile({directory,projects,project,object='object-0',boundFields=null}) {
  const data=await projects.read(project.id,'local'),e=data.entities.find(e=>e.id===object),raw=JSON.parse((await projects.preview(project.id,'local',e.archivePath)).text);
  raw.namespace=e.namespace;
  const files={};for(const side of ['client','server'])if(typeof raw.descriptor[side+'Scripts']==='string')files[side+'.ts']=raw.descriptor[side+'Scripts'];
  const profile={host:'https://target.example',platformVersion:'2026.7.23',typescriptVersion:'5.9.3',compilerContract,sourceChecksum:project.checksum,evidence:{verifiedAt:'2026-10-07T00:00:00Z',reference:'Synthetic fixture; not live platform evidence'},entries:{}};
  const root=path.join(directory,'projects',project.id,'compiler');await fs.mkdir(root,{recursive:true});
  for(const side of Object.keys(files).map(f=>f.split('.')[0])) {
    const request=buildDtsRequest(raw,side,boundFields,serverFunctions(files['server.ts']));
    const fields=list=>list.filter(f=>/^[A-Za-z_$][\w$]*$/.test(f.code)).map(f=>`${JSON.stringify(f.code)}: ${f.type==='STRING' ? 'string' : f.type==='NUMBER' ? 'number' : 'unknown'};`).join('\n');
    const rpc=side==='client' ? `declare const Server: { rpc: { ${request.serverRPC.functions.map(f=>`${JSON.stringify(f.name)}: (...args: any[]) => Promise<void>;`).join('\n')} } };` : '';
    const view=request.extraContexts.map(c=>`declare const ${c.name}: { data: { ${fields(c.fields)} } };`).join('\n');
    const dts=`declare const Context: { data: { ${fields(request.fields)} } };\n${view}\n${rpc}\n`;
    const key=sdkRequestHash(profile,request);profile.entries[key]={sha256:createHash('sha256').update(dts).digest('hex')};await fs.writeFile(path.join(root,key+'.d.ts'),dts);
  }
  await fs.writeFile(path.join(root,'profile.json'),JSON.stringify(profile));
  return {root,profile};
}
