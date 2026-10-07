import { projectProcess } from './model.js';
// Native descriptor/geometry shapes, entirely invented labels, identities and business data.
export const visualSource = {
  process: {
    lanes: { review:{id:'review',name:'Согласующий',x:0,y:0,width:680,height:220} },
    items: {
      start:{id:'start',type:'start',name:'Начало',x:30,y:80,width:50,height:50},
      review:{id:'review',type:'user',name:'Согласовать',x:180,y:70,width:130,height:70,settings:{formCode:'approval'}},
      revise:{id:'revise',type:'user',name:'Исправить',x:400,y:70,width:130,height:70,settings:{formCode:'return'}},
      end:{id:'end',type:'end',name:'Готово',x:580,y:80,width:50,height:50}
    },
    transitions:{
      enter:{id:'enter',source:'start',target:'review',path:[{x:80,y:105},{x:180,y:105}]},
      approve:{id:'approve',name:'Согласовать',source:'review',target:'end',path:[{x:310,y:105},{x:345,y:105},{x:345,y:30},{x:605,y:30},{x:605,y:80}]},
      return:{id:'return',name:'Вернуть',source:'review',target:'revise',path:[{x:310,y:105},{x:400,y:105}]},
      repeat:{id:'repeat',name:'Повторное рассмотрение',source:'revise',target:'review',path:[{x:465,y:140},{x:465,y:180},{x:245,y:180},{x:245,y:140}]}
    }
  },
  forms:[
    {code:'approval',name:'Согласование',descriptor:'item-form-complex-popup',content:{'[content]':[
      {descriptor:'dynamic-form',values:{fields:[{code:'title',name:'Документ',type:'string',required:true}]}},
      {descriptor:'button',values:{label:'Согласовать',action:'Never executed'}},
      {descriptor:'synthetic-unknown-control',values:{html:'<img onerror=alert(1)>'}}
    ]}},
    {code:'return',name:'Причина возврата',descriptor:'modal-body',content:{'':[
      {descriptor:'dynamic-form',values:{fields:[{code:'comment',name:'Комментарий',type:'string',required:true}]}},
      {descriptor:'button',values:{label:'Вернуть'}}
    ]}}
  ]
};
export function visualFixture(state='source') {
  if(state==='empty')return {processes:[]};
  if(state==='loading')return {loading:true};
  if(state==='error')return {error:'Не удалось загрузить обзор. Исходный снимок сохранён.'};
  const raw=structuredClone(visualSource);
  if(state==='unknown'){raw.process.items.review.type='synthetic-unknown-node';raw.process.items.review.settings.formCode='missing';raw.process.lanes.review.width=0;}
  if(state==='duplicate'){
    raw.process.items.duplicate={...raw.process.items.review,name:'Повторное согласование',x:330};
    raw.process.transitions.duplicate={...raw.process.transitions.approve,name:'Повторяющийся переход'};
  }
  return {synthetic:true,processes:[{name:'Учебное согласование',...projectProcess(raw,'processor/entities/synthetic/approval.json')}]};
}
