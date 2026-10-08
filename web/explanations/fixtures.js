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
