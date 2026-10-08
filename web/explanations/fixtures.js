import { managedFixture } from '../managed/fixtures.js';
import { visualFixture, visualSource } from '../visual/fixtures.js';
export const explanationTarget={scope:'step',artifactId:'synthetic-artifact',source:'processor/synthetic.json',nodeId:'review'};
const draft={text:'Шаг «Согласовать» относится к учебному процессу. Объявлены переходы «Согласовать» → «Готово» и «Вернуть» → «Исправить». Поле «Документ» обязательно по экспорту.\n\nУсловия, права и выполнение в ELMA не установлены.',engine:'declared-source-v1',sources:[{label:'Согласовать',pointer:'processor/synthetic.json#/process/items/review',nodeId:'review'}]};
const entry={id:'synthetic-explanation',key:'synthetic-step',text:'Учебное пояснение, дополненное аналитиком: при возврате уточните причину.',title:'Учебное согласование → Согласовать',sources:draft.sources,fingerprint:'synthetic-fingerprint',actor:{id:'synthetic-actor',login:'Учебный аналитик'},at:'2026-10-08T10:00:00.000Z'};
export function explanationFixture(state='ready'){
  const response={title:entry.title,expectedRevision:0,version:0,fingerprint:entry.fingerprint,writable:true,draft,saved:null,history:[]};
  const model={target:explanationTarget,label:'Объяснить этот шаг'};
  if(state==='ready')return model;
  if(state==='loading')return {...model,state:'loading'};
  if(state==='error')return {...model,error:'Не удалось загрузить объяснение. Повторите запрос.'};
  if(['saved','stale','historical','conflict','regenerated'].includes(state))Object.assign(response,{version:1,saved:{...entry,sourceStatus:state==='stale'?'stale':'current'},history:[entry]});
  if(state==='historical')Object.assign(response,{writable:false,reason:'Это прежняя версия источника. Откройте актуальный процесс перед сохранением.'});
  return {...model,initial:response,state:['draft','conflict','regenerated'].includes(state)?state==='conflict'?'conflict':'draft':undefined,
    ...(state==='conflict'?{error:'Другой пользователь сохранил объяснение.',text:'Мой несохранённый текст'}:{}),
    ...(state==='regenerated'?{text:entry.text,proposed:draft.text}:{})};
}
export function explanationFixtureActions(){
  let response=explanationFixture('draft').initial;
  return {read:async()=>structuredClone(response),save:async(target,input)=>{
    const saved={...entry,text:input.text,sourceStatus:'current'};
    response={...response,version:response.version+1,saved,history:[saved,...response.history]};return structuredClone(response);
  }};
}
export function explanationSolutionFixture(){
  const model=managedFixture('solution'), component={key:JSON.stringify(['processor','synthetic.processes','approval']),service:'processor',code:'approval',digest:'a'.repeat(64),team:'Учебная команда',interventionId:null};
  model.workspace.current=[component];model.workspace.artifacts[0].components=[component];
  return model;
}
export function explanationSolutionActions(){
  const panels=new Map();
  const panel=target=>{
    const key=JSON.stringify(target);
    if(!panels.has(key)){
      const response=structuredClone(explanationFixture('draft').initial);
      if(target.scope==='solution'){response.title='Учебное решение';response.draft.text='Учебное решение содержит процесс согласования. Права и работа в ELMA не проверены.';response.draft.sources=[];}
      if(target.scope==='process')response.title='Учебное согласование';
      panels.set(key,response);
    }
    return panels.get(key);
  };
  return {navigate:()=>{},archive:async()=>{throw Error('Учебная история не изменяет решение.');},
    visual:async artifactId=>{const model=visualFixture('source');model.artifactId=artifactId;model.processes[0].object=['processor','synthetic.processes','approval'];return model;},
    context:async()=>({name:'Учебное согласование',source:'processor/synthetic.json',content:JSON.stringify(visualSource,null,2)}),
    explanations:{read:async target=>structuredClone(panel(target)),save:async(target,input)=>{
      const response=panel(target);response.version++;response.saved={...entry,title:response.title,text:input.text,sourceStatus:'current'};response.history.unshift(response.saved);return structuredClone(response);
    }}
  };
}
