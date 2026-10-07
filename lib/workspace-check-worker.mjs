import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { serverFunctions } from './workspace-check.mjs';
import { compileScript, typescriptVersion } from './widget-compiler.mjs';

const {files,types,compiler} = workerData, diagnostics = [];
const options = {noEmit:true,noImplicitAny:true,strictNullChecks:true,skipLibCheck:true,target:ts.ScriptTarget.ES2018,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,lib:['lib.es2018.d.ts']};
// No project filesystem, network, plugins, or uploaded module resolution.
const libDirectory = path.resolve(path.dirname(ts.getDefaultLibFilePath(options)));
const trustedLib = filename => path.dirname(path.resolve(filename)) === libDirectory && /^lib\.[\w.]+\.d\.ts$/.test(path.basename(filename));
const server = (files['server.ts'] || '') + '\nexport { ' + [...new Set(serverFunctions(files['server.ts']))].join(', ') + ' };\n';
const virtualRoot = '/workspace/';
const range = (tree,start,length=1) => { const a=tree.getLineAndCharacterOfPosition(Math.min(start,tree.text.length)),b=tree.getLineAndCharacterOfPosition(Math.min(start+length,tree.text.length)); return {startLineNumber:a.line+1,startColumn:a.character+1,endLineNumber:b.line+1,endColumn:b.character+1}; };
try {
  for (const side of ['server','client']) {
    const name = side+'.ts'; if (!(name in files)) continue;
    const sideOptions = options;
    if(compiler.available) {
      const result=compileScript({source:files[name],runtime:side,dts:compiler.sdk[side],...compiler.additional?.[side]});
      for(const error of result.errors) {
        const source=error.filename==='script.ts';
        diagnostics.push({file:source ? name : 'types.d.ts',category:source ? 'elma-compiler' : 'sdk',severity:'error',code:'TS'+error.code,message:(source ? '' : 'SDK '+side+': ')+error.message,startLineNumber:(error.position?.line || 0)+1,startColumn:(error.position?.character || 0)+1,endLineNumber:(error.position?.line || 0)+1,endColumn:(error.position?.character || 0)+Math.max(1,error.errorPart?.length || 1)+1});
      }
    }
    const virtual = new Map([[virtualRoot+name,side === 'server' ? server : files[name]],[virtualRoot+'types.d.ts',types[side]]]);
    if (side === 'client') virtual.set(virtualRoot+'server.ts',server);
    const read = filename => virtual.get(filename) ?? (trustedLib(filename) ? fs.readFileSync(filename,'utf8') : undefined);
    const host = {getSourceFile:(filename,version) => { const text=read(filename); return text === undefined ? undefined : ts.createSourceFile(filename,text,version,true); },
      getDefaultLibFileName:() => ts.getDefaultLibFilePath(options),writeFile:() => {},getCurrentDirectory:() => virtualRoot,
      getDirectories:() => [],fileExists:filename => virtual.has(filename) || trustedLib(filename) && fs.existsSync(filename),readFile:read,
      getCanonicalFileName:filename => filename,useCaseSensitiveFileNames:() => true,getNewLine:() => '\n',
      resolveModuleNames:names => names.map(n => n === './server' ? {resolvedFileName:virtualRoot+'server.ts',extension:ts.Extension.Ts} : undefined)};
    const program = compiler.available ? null : ts.createProgram([virtualRoot+name,virtualRoot+'types.d.ts'],sideOptions,host);
    for (const d of program ? ts.getPreEmitDiagnostics(program) : []) {
      if (d.file && d.file.fileName !== virtualRoot+name) continue;
      if (d.start !== undefined && d.start >= files[name].length) continue;
      diagnostics.push({file:name,category:'typescript',severity:d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',code:'TS'+d.code,message:ts.flattenDiagnosticMessageText(d.messageText,'\n'),...(d.file ? range(d.file,d.start || 0,d.length || 1) : {})});
      if (diagnostics.length >= 200) break;
    }
    const tree = ts.createSourceFile(name,files[name],ts.ScriptTarget.ES2022,true);
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['eval','Function'].includes(node.expression.text) || ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function')
        diagnostics.push({file:name,category:'lint',severity:'warning',code:'dynamic-code',message:'Динамический код: статический анализ не подтверждает область изменения.',evidence:node.expression.text,...range(tree,node.getStart(tree),node.getWidth(tree))});
      ts.forEachChild(node,visit);
    }; visit(tree);
  }
  const failed=diagnostics.some(d=>d.category!=='lint' && d.severity==='error');
  parentPort.postMessage({typescript:failed ? 'failed' : 'passed',elmaCompiler:compiler.available ? failed ? 'failed' : 'passed' : 'unavailable',toolVersion:typescriptVersion,compilerProfileHash:compiler.available ? compiler.metadata.profileHash : null,compilerProfile:compiler.available ? compiler.metadata : null,diagnostics:diagnostics.slice(0,200)});
} catch { parentPort.postMessage({error:true}); }
