import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildDtsRequest, sdkRequestHash, compilerContract, supportedVersions } from './widget-context.mjs';
import { serverFunctions } from './workspace-check.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const unavailable=reason=>({available:false,reason});
// Operator-provisioned, per-project, offline SDK. No credential or network path.
export async function loadCompilerProfile(directory, project, entity, fields, files) {
  const root=path.join(directory,'compiler');
  try {
    const read=async(filename,limit) => {
      if(!/^(?:profile\.json|[a-f0-9]{64}\.d\.ts)$/.test(filename))throw Error('Некорректное имя файла SDK');
      const absolute=path.join(root,filename),stat=await fs.lstat(absolute);
      if(!stat.isFile() || stat.isSymbolicLink() || stat.size>limit)throw Error('Некорректный файл SDK');
      const rootStat=await fs.lstat(root),realRoot=await fs.realpath(root),realFile=await fs.realpath(absolute);
      const canonical=value=>process.platform==='win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
      if(!rootStat.isDirectory() || rootStat.isSymbolicLink() || canonical(path.dirname(realFile))!==canonical(realRoot))throw Error('Каталог SDK не должен быть ссылкой');
      const handle=await fs.open(absolute,'r');
      try { const bytes=Buffer.alloc(stat.size);const result=await handle.read(bytes,0,bytes.length,0);if(result.bytesRead!==stat.size)throw Error('SDK изменился во время чтения');return new TextDecoder('utf8',{fatal:true}).decode(bytes); }
      finally{await handle.close();}
    };
    const profile=JSON.parse(await read('profile.json',64*1024)),url=new URL(profile.host);
    if(url.protocol!=='https:' || url.origin!==profile.host || url.username || url.password || !supportedVersions.has(profile.platformVersion) || profile.typescriptVersion!=='5.9.3' || profile.compilerContract!==compilerContract || profile.sourceChecksum!==project.checksum) return unavailable('Профиль compiler не соответствует host, snapshot или поддержанной версии');
    if(typeof profile.evidence?.reference!=='string' || !profile.evidence.reference.trim() || typeof profile.evidence?.verifiedAt!=='string' || !Number.isFinite(Date.parse(profile.evidence.verifiedAt)))return unavailable('В профиле отсутствует evidence соответствия compiler');
    if(entity.descriptor?.dataFieldCode && !Array.isArray(fields))return unavailable('Связанное приложение/процесс отсутствует или неоднозначен в этом snapshot');
    const sdk={},additional={},records={};
    for(const side of Object.keys(files).map(name=>name.split('.')[0])) {
      const body=buildDtsRequest(entity,side,fields,side==='client' ? serverFunctions(files['server.ts']) : []);
      const requestHash=sdkRequestHash(profile,body),record=profile.entries?.[requestHash];
      if(!record || !/^[a-f0-9]{64}$/.test(record.sha256))return unavailable('В offline SDK отсутствует точный контекст '+side+'; обновите профиль');
      const dts=await read(requestHash+'.d.ts',2*1024*1024);
      if(digest(dts)!==record.sha256 || !/declare\s+(?:const|let|var)\s+Context\b/.test(dts) || side==='client' && !/declare\s+(?:const|let|var)\s+Server\b/.test(dts) || entity.descriptor?.dataFieldCode && !/declare\s+(?:const|let|var)\s+ViewContext\b/.test(dts))return unavailable('Контрольная сумма или контекст SDK не совпадает');
      sdk[side]=dts;additional[side]={};records[side]={requestHash,sha256:record.sha256};
      for(const name of ['additionalDts','serverDependencyDts'])if(record[name]) {
        const sha=record[name];if(!/^[a-f0-9]{64}$/.test(sha))return unavailable('Некорректная ссылка на dependency SDK');
        const text=await read(sha+'.d.ts',2*1024*1024);if(digest(text)!==sha)return unavailable('Контрольная сумма dependency SDK не совпадает');
        additional[side][name]=text;records[side][name]=sha;
      }
    }
    return {available:true,sdk,additional,metadata:{host:profile.host,platformVersion:profile.platformVersion,typescriptVersion:profile.typescriptVersion,compilerContract,profileHash:digest(JSON.stringify(profile)),sourceChecksum:project.checksum,records,evidence:{verifiedAt:profile.evidence.verifiedAt,reference:profile.evidence.reference}}};
  } catch(e) {return unavailable(e.code==='ENOENT' ? 'Offline SDK compiler не настроен для этого проекта' : 'Offline SDK compiler недоступен или повреждён');}
}
