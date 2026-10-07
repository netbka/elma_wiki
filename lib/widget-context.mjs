import { createHash } from 'node:crypto';

export const compilerContract = 'widget-worker-ts-5.9.3-v1';
export const supportedVersions = new Set(['2025.4.55','2026.7.23']);
const visible = (field,client) => field && !field.view?.hidden && !(field.type === 'EVENT' && (field.view?.system || !client));
export function buildDtsRequest(entity, side, boundFields, functions=[]) {
  const d=entity.descriptor || {},client=side === 'client';
  const options=(client ? d.clientScriptOptions : d.serverScriptOptions) || d.scriptOptions || {};
  const own=(Array.isArray(d.fields) ? d.fields : []).filter(f=>visible(f,client));
  const bound=!!d.dataFieldCode,namespace=entity.namespace || '',platform=namespace==='system' || namespace==='global';
  const body={namespace,allowGlobal:options.allowGlobal ?? platform,allowNamespace:!platform && (options.allowNamespace ?? !namespace.includes('.')),
    allowServer:client,allowContext:true,fields:bound ? (boundFields || []).filter(f=>visible(f,client)) : own,
    extraContexts:bound ? [{name:'ViewContext',fields:own,group:'',readonly:false}] : [],isClientScript:client,
    importsDependencies:options.importsDependencies ?? d.scriptOptions?.importsDependencies ?? d.importsDependencies};
  if(client) body.serverRPC={functions:functions.map(name=>({name}))};
  return body;
}
const canonical = value => {
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])]));
  return value;
};
export const sdkRequestHash = (profile,body) => createHash('sha256').update(JSON.stringify(canonical({host:profile.host,platformVersion:profile.platformVersion,typescriptVersion:profile.typescriptVersion,compilerContract,body}))).digest('hex');
