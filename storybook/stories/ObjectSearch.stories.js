import { objectSearchModel, renderObjectResults, resolveSourceMatch, renderSourceMatch, mountObjectSearch } from '../../dist/object-search.js';
const entity = { id:'synthetic',name:'Учебная форма',service:'widgets',namespace:'synthetic',code:'form',archivePath:'widgets/form.json',fields:[{code:'title',name:'Тема',type:'STRING',origin:'descriptor.fields',source:'widgets/form.json#/descriptor/fields/0'}],functionSources:[{name:'onOpen',side:'client',path:'widgets/form.json.client.ts'}] };
export default {id:'object-search',title:'Исследование/Точное поле и источник',parameters:{layout:'fullscreen'}};
const shell = node => { const main=document.createElement('main');main.append(node);return main; };
export const Fields = {render:()=>shell(mountObjectSearch([entity],{query:'title'}))};
export const Functions = {render:()=>shell(mountObjectSearch([entity],{query:'onOpen'}))};
export const Empty = {render:()=>shell(mountObjectSearch([entity],{query:'not-found'}))};
export const Selected = {render:()=>{const node=document.createElement('div');node.innerHTML=renderSourceMatch(resolveSourceMatch(entity,JSON.stringify(['field','title','','widgets/form.json#/descriptor/fields/0'])));return shell(node);}};
export const Ambiguous = {render:()=>{const node=document.createElement('div');node.innerHTML=renderSourceMatch({state:'ambiguous'});return shell(node);}};
