import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function checkHealth({port=Number(process.env.PORT || 43171),host=new URL(process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:43171').host,timeout=4000}={}) {
  return new Promise(resolve=>{
    const req=http.get({hostname:'127.0.0.1',port,path:'/healthz',headers:{Host:host}},res=>{
      res.resume();res.on('end',()=>resolve(res.statusCode===200));res.on('error',()=>resolve(false));
    });
    req.setTimeout(timeout,()=>req.destroy());req.on('error',()=>resolve(false));
  });
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {if(!await checkHealth())process.exitCode=1;} catch {process.exitCode=1;}
}
