import type { DevicePanel, Json, Property } from './types';
import { findProperty } from './panel-layout';
import {deviceChoiceLabel,deviceModeLabel,deviceUnit} from './device-labels';
import {capabilityCategory} from './device-capabilities';

type ObjectValue={ [key:string]:Json };
export interface WasherConfigReport { did:string;model:string;firmware:string;fetchedAt:number;config:ObjectValue }
export interface WasherProgram { name:string;title:string;meaning:string;value:number;minutes:number;autoTime:boolean;isOrder:boolean;items:ObjectValue[];published?:{siid:number;piid:number;glyph:string} }
export interface WasherField { name:string;label:string;unit:string;property?:Property;choices:(number|boolean)[];value:number|boolean;hidden:boolean;disabled:boolean;config:ObjectValue;published?:boolean }
export interface WasherDraft { program:string;values:Record<string,number|boolean>;selector?:string }
const object=(v:Json|undefined):ObjectValue=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const scalar=(v:Json|undefined):v is number|boolean=>typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v);
const equal=(a:unknown,b:unknown):boolean=>a===b;
const named:Record<string,[string,string]>={
 smart:['Smart','智能洗'],quickWash:['Quick Wash','快速洗'],dry:['Dry','单烘干'],dryAirWash:['Dry Air Wash','轻干洗'],followHeartWashDry:['Pleased Wash Dry','随心洗烘'],spin:['Spin','单脱水'],delicateWash:['Delicate Wash','轻柔洗'],mix:['Mix','混合洗'],intensive:['Intensive','强力洗'],downCoat:['Down Coat','羽绒服'],heavyWash:['Heavy Wash','大件洗'],rinseSpin:['Rinse Spin','漂洗+脱水'],underwear:['Underwear','内衣洗'],wool:['Wool','羊毛洗'],babyCare:['Baby Care','婴童洗'],cotton:['Cotton','棉麻洗'],degermingDry:['Bacteria Mite Removal','除菌除螨'],newClothesWash:['New-Clothes Wash','新衣洗'],boiling:['Boiling','高温洗'],jacket:['Jacket','冲锋衣'],jeans:['Jeans','牛仔洗'],synthetic:['Synthetic','化纤洗'],sportswear:['Sportswear','运动服'],silk:['Silk','真丝洗'],aromatherapyWash:['Aromatherapy Wash','香薰洗'],drumClean:['Drum Clean','筒自洁'],
};
const bindings:Record<string,[string,string,string]>={
 temperature:['target-temperature','洗涤温度','℃'],rinsh:['rinsh-times','漂洗次数','次'],speed:['spin-speed','脱水转速','转/分'],dry:['drying-level','烘干','分钟'],shakeTime:['shake-time','自动抖散','小时'],soak:['soak-time','浸泡时间','分钟'],sterilization:['steam-sterilization','蒸汽除菌',''],highWaterLevel:['high-water-switch','高水位',''],night:['sleep-mode','夜间洗',''],pleasedWash:['wash-time','洗涤时长','分钟'],pleasedDry:['drying-time','烘干时长','分钟'],mainWash:['wash-time','主洗时间','分钟'],regularDry:['drying-time','定时烘干','分钟'],
};
function locale(value:Json|undefined):string|undefined {if(typeof value==='string')return value;const v=object(value);return typeof v.zh_cn==='string'?v.zh_cn:typeof v.zh==='string'?v.zh:undefined;}
function chineseProgramLabel(text:string|undefined):string|undefined{
 const label=text?.trim();
 return label&&/[\u3400-\u9fff]/.test(label)&&!/[a-z]/i.test(label)?label:undefined;
}
/** Model enum descriptions bind semantic names; values are never program indices. */
export function washerPrograms(report:WasherConfigReport|undefined,panel:DevicePanel|undefined):WasherProgram[]{
 if(!report||!panel||report.did!==panel.did||report.model!==panel.model)return[];
 const mode=findProperty(panel,['washer'],['mode']);
 return (Array.isArray(report.config.modesData)?report.config.modesData:[]).flatMap(raw=>{
  const row=object(raw),name=typeof row.modeName==='string'?row.modeName:'',definition=named[name];if(!definition)return[];
  const meanings=mode?.valueList?.filter(choice=>choice.description.trim().toLowerCase()===definition[0].toLowerCase());
  if(meanings?.length!==1||typeof meanings[0].value!=='number')return[];
  const override=object(object(report.config.modesConfig)[name]);
  const title=deviceModeLabel(chineseProgramLabel(locale(row.title)),chineseProgramLabel(locale(override.title)),definition[1])!;
  return[{name,title,meaning:definition[0],value:meanings[0].value,minutes:typeof row.modeTime==='number'?row.modeTime:0,autoTime:name==='smart',isOrder:row.isOrder!==false,items:(Array.isArray(row.items)?row.items:[]).map(object)}];
 });
}
const modeAliases:Record<string,[string,string]>={
 standard:['mix','标准洗'],'daily wash':['mix','日常洗'],'super quick':['quickWash','超快洗'],
 chiffon:['delicateWash','雪纺洗'],drumdry:['dry','筒烘干'],drumclean:['drumClean','筒自洁'],
 rinse:['rinseSpin','漂洗'],'user define':['mix','自定义洗'],
 'golden wash':['mix','黄金洗'],'gold wash':['mix','黄金洗'],'golden dry':['dry','黄金烘'],
 'wash dry':['followHeartWashDry','洗烘'],'washing and drying':['followHeartWashDry','洗烘'],
 'wash dry 45':['followHeartWashDry','45 分钟洗烘'],'quick wash dry':['followHeartWashDry','快速洗烘'],
 'ai care':['smart','灵云洗护'],'one key smart wash':['smart','一键智洗'],'drum dry':['dry','筒风干'],
 'bo wash':['boiling','煮洗'],'baby boiling':['babyCare','婴童高温洗'],'baby delicate wash':['babyCare','婴童轻柔洗'],
 'baby energy saving':['babyCare','婴童节能洗'],'baby intensive':['babyCare','婴童强力洗'],'baby quick wash':['babyCare','婴童快洗'],
 'cold wash':['mix','冷水洗'],'color protection':['mix','护色洗'],basic:['mix','基础洗'],
 'soak wash':['mix','浸泡洗'],'so wash':['mix','浸泡洗'],soak:['mix','浸泡洗'],
 bra:['underwear','文胸洗'],shirt:['mix','衬衫洗'],wash:['mix','洗涤'],
};
const stateModes=new Set(['none','off','invalid','illegal','unselected','standby','idle','busy','running','pause','paused','wash paused','eoc','error','fault','appointment','delay','预约','关机','待机','故障']);
export const isDryerPanel=(panel:DevicePanel):boolean=>['dryer','clothes-dryer'].includes(capabilityCategory(panel.specType)??'');
const dryerTitles:Record<string,string>={'daily dry':'日常烘','quick dry':'快速烘','heavy dry':'大件烘','golden dry':'黄金烘',cotton:'棉麻烘',smart:'智能烘',
 'cold air':'冷风烘','warm clothes dry':'暖衣烘',timing:'定时烘',degerming:'除菌烘','user define':'自定义',wool:'羊毛烘',delicate:'轻柔烘',silk:'真丝烘'};
function modeName(text:string):string{return text.trim().toLowerCase().replace(/[\s_-]+/g,' ');}
const namedModes=new Map(Object.entries(named).map(([glyph,[meaning,title]])=>[modeName(meaning),[glyph,title] as const]));
function labeledMode(meaning:string):readonly [string,string]|undefined{
 const key=modeName(meaning);
 return namedModes.get(key)??(Object.hasOwn(modeAliases,key)?modeAliases[key]:undefined);
}
function washerProgramLabel(meaning:string,localized?:string):string|undefined{
 return deviceModeLabel(localized,labeledMode(meaning)?.[1],meaning);
}
export function washerReportedProgramLabel(meaning:string|undefined):string|undefined{
 return meaning?.trim()&&!stateModes.has(modeName(meaning))?washerProgramLabel(meaning):undefined;
}
function publishedProperty(panel:DevicePanel,siid:number,name:string):Property|undefined{
 const services=panel.services.filter(s=>s.siid===siid);
 if(services.length!==1)return;
 const properties=services[0].properties.filter(p=>p.siid===siid&&p.name===name);
 const property=properties[0];
 return properties.length===1&&property.piid>0&&services[0].properties.filter(p=>p.piid===property.piid).length===1?property:undefined;
}
export function washerDrums(panel:DevicePanel):{siid:number;label:string}[]{
 if(panel.unsupportedReason||capabilityCategory(panel.specType)!=='washer')return [];
 const labels:Record<string,string>={'left drum':'左筒','right drum':'右筒','upper drum':'上筒','lower drum':'下筒'};
 const drums=panel.services.filter(s=>s.name==='washer'&&Object.hasOwn(labels,s.description.trim().toLowerCase()))
  .map(s=>({siid:s.siid,label:labels[s.description.trim().toLowerCase()]}));
 const order=['上筒','左筒','右筒','下筒'];
 drums.sort((a,b)=>order.indexOf(a.label)-order.indexOf(b.label));
 if(!['上筒下筒','左筒右筒','左筒右筒下筒'].includes(drums.map(d=>d.label).join(''))
  ||drums.some(d=>!publishedProperty(panel,d.siid,'status')?.valueList?.length))return [];
 return drums;
}

export function washerProgramCatalog(report:WasherConfigReport|undefined,panel:DevicePanel,drum?:number):WasherProgram[]{
 const configured=washerPrograms(report,panel);
 if(configured.length)return configured;
 const dryer=isDryerPanel(panel),services=dryer?['dryer','clothes-dryer','cleanfly-dryer']:['washer'];
 const modeNames=dryer?['mode']:['mode','wash-program','washing-program','program'];
 const bindings=panel.services.filter(s=>services.includes(s.name)&&(drum===undefined||s.siid===drum)).flatMap(s=>modeNames.flatMap(name=>{
  const property=publishedProperty(panel,s.siid,name),choices=property?.valueList;
  if(!property||!property.access.some(access=>access==='read'||access==='write')||!choices?.length||choices.length>128)return[];
  const hasState=choices.some(choice=>['standby','wash paused','eoc','error','appointment'].includes(modeName(choice.description)));
  const programs=choices.filter(choice=>!stateModes.has(modeName(choice.description))&&!(hasState&&modeName(choice.description)==='wash')
   &&choice.description.trim()&&typeof choice.value==='number'&&Number.isSafeInteger(choice.value)
   &&choices.filter(other=>other.value===choice.value).length===1);
  return programs.length?[{property,programs}]:[];
 }));
 if(bindings.length!==1)return[];
 const {property,programs}=bindings[0];
 const reservation=publishedProperty(panel,property.siid,dryer?'reservation-dry-status':'reservation-wash-status');
 const time=publishedProperty(panel,property.siid,'reservation-left-time');
 const isOrder=drum===undefined&&!!reservation?.access.includes('write')&&!!reservation.valueList?.some(v=>modeName(v.description)===(dryer?'finish dry':'finish wash'))
  &&!!time?.access.includes('write')&&time.unit==='minutes'&&!!time.valueRange;
 return programs.flatMap(choice=>{
  const meaning=choice.description.trim();
  const title=dryer?deviceModeLabel(choice.localizedDescription,Object.hasOwn(dryerTitles,modeName(meaning))?dryerTitles[modeName(meaning)]:undefined,meaning):washerProgramLabel(meaning,choice.localizedDescription);
  if(!title)return [];
  const glyph=dryer?(modeName(meaning)==='quick dry'?'quickWash':labeledMode(meaning)?.[0]??'dry'):labeledMode(meaning)?.[0]??'mix';
  return [{name:`${dryer?'dryer':drum===undefined?'published':'drum'}-${property.siid}-${property.piid}-${choice.value}`,title,meaning,value:choice.value as number,
   minutes:0,autoTime:false,isOrder,items:[],published:{siid:property.siid,piid:property.piid,glyph}}];
 });
}

const publishedFields:Record<string,[string,string]>={
 'target-temperature':['洗涤温度','℃'],'rinsh-times':['漂洗次数','次'],'rinsh-time':['漂洗时长','分钟'],
 'spin-speed':['脱水转速','转/分'],'spin-time':['脱水时长','分钟'],'drying-level':['烘干',''],
 'drying-time':['烘干时长','分钟'],'shake-time':['自动抖散','分钟'],'soak-time':['浸泡时间','分钟'],
 'wash-time':['洗涤时长','分钟'],'target-water-level':['水位',''],'steam-sterilization':['蒸汽除菌',''],
 'high-water-switch':['高水位',''],'sleep-mode':['夜间洗',''],
};
const dryerFields:Record<string,[string,string]>={'drying-level':['烘干方式',''],'drying-degree':['烘干程度',''],'drying-time':['烘干时长','分钟'],
 'auto-shake-disperse':['自动抖散',''],'shake-time':['抖散时长','分钟']};
function publishedFieldChoices(property:Property):(number|boolean)[]{
 if(property.valueList?.length){
  const values=property.valueList.map(v=>v.value);
  return values.length<=128&&values.every(scalar)&&new Set(values).size===values.length?values:[];
 }
 if(property.format==='bool')return [false,true];
 const [min,max,step]=property.valueRange??[];
 if(!Number.isFinite(min)||!Number.isFinite(max)||!Number.isFinite(step)||step<=0||max<min)return [];
 const count=Math.floor((max-min)/step)+1;
 const at=(index:number)=>Number((min+index*step).toPrecision(12));
 return count<=512?Array.from({length:count},(_,i)=>at(i)):[];
}
function physicalChoice(property:Property,value:number):number|undefined{
 if(!property.valueList?.length)return value;
 const text=property.valueList.find(choice=>choice.value===value)?.description.trim();
 if(!text)return;
 if(/^(?:no spin|cold(?: water)?|常温|不脱水|不烘干)$/i.test(text))return 0;
 if(/^none$/i.test(text)&&property.name==='drying-time')return 0;
 const number=/^(?:level\s*)?(\d+(?:\.\d+)?)(?:\s*(?:celsius|rpm|r\/min|℃|°c|分钟|转\/分))?$/i.exec(text);
 return number?Number(number[1]):undefined;
}
function publishedWasherFields(program:WasherProgram,panel:DevicePanel,draft:WasherDraft):WasherField[]{
 const binding=program.published;
 if(!binding)return[];
 const dryer=isDryerPanel(panel),drum=program.name.startsWith('drum-'),level=publishedProperty(panel,binding.siid,'drying-level');
 const levelValue=draft.values['drying-level']??(level?.code===0?level.value:undefined);
 const timed=dryer&&([program.meaning,level?.valueList?.find(choice=>choice.value===levelValue)?.description??'']
   .some(description=>['timing','timed','timed dry','timing dry'].includes(modeName(description))));
 return Object.entries(dryer?dryerFields:publishedFields).flatMap<WasherField>(([name,[label,unit]])=>{
  if(drum&&!['target-temperature','rinsh-times','spin-speed','soak-time'].includes(name))return [];
  const property=publishedProperty(panel,binding.siid,name);
  if(!property||property.unsupportedReason||!property.access.includes('read'))return [];
  if(dryer&&name==='drying-time'&&(!timed||property.unit!=='minutes'||panel.model==='pgkj.dry.300pzr'))return [];
  const choices=publishedFieldChoices(property);
  const live=property.code===0&&scalar(property.value)&&(!choices.length||choices.includes(property.value))?property.value:undefined;
  const editable=(dryer||drum)&&live!==undefined&&property.access.includes('write')&&choices.length>1;
  const value=draft.values[name]??live;
  const config:ObjectValue={};
  if(dryer&&name==='drying-time'&&typeof value==='number')config.time=value;
  const fieldLabel=dryer&&name==='drying-level'&&!property.valueList?.some(choice=>['timed','auto'].includes(modeName(choice.description)))?'烘干程度':label;
  return value===undefined?[]:[{name,label:fieldLabel,unit:deviceUnit(property.unit)||unit,property,choices,value,hidden:false,disabled:!editable,config,published:true}];
 });
}
function merge(a:ObjectValue,b:ObjectValue):ObjectValue {
 const result={...a,...b};for(const key of ['timeObj','dataLabel','dataDesc'])if(a[key]||b[key])result[key]={...object(a[key]),...object(b[key])};return result;
}
function mergedItems(report:WasherConfigReport,program:WasherProgram):ObjectValue[]{
 const defaults=object(report.config.itemsConfig);
 return program.items.map(item=>merge(object(defaults[String(item.propertyName)]),item));
}
/** Static interpreter of the audited condition operators; no scripts/eval. */
export function washerConditions(raw:Json|undefined,values:Record<string,number|boolean>,definitions:ObjectValue={}):ObjectValue {
 const conditions=raw===undefined?[]:Array.isArray(raw)?raw:[raw];let result:ObjectValue={};const prior:boolean[]=[];
 for(const [index,entry]of conditions.entries()){
  const row=object(typeof entry==='string'?definitions[entry]:entry),key=row.key,desired=row.keyValue,operator=typeof row.operator==='string'?row.operator:'inculde';let yes=false;
  if(operator==='&'){const keys=typeof key==='number'?[key]:Array.isArray(key)?key:[];yes=keys.length>0&&keys.every((k,i)=>typeof k==='number'&&prior[k]===(Array.isArray(desired)?desired[i]:desired));}
  else if(typeof key==='string'){
   const value=values[key];
   if(['=','==='].includes(operator))yes=equal(value,desired);
   else if(['!','!=='].includes(operator))yes=!equal(value,desired);
   else if(['==','!='].includes(operator)){const same=scalar(desired)&&value!==undefined&&Number(value)===Number(desired);yes=operator==='=='?same:!same;}
   else if(['>','>=','<','<='].includes(operator)&&typeof value==='number'&&typeof desired==='number')yes=operator==='>'?value>desired:operator==='>='?value>=desired:operator==='<'?value<desired:value<=desired;
   else if(operator==='inculde')yes=Array.isArray(desired)?desired.includes(value):equal(value,desired);
  }
  prior[index]=yes;if(!yes)continue;if(row.stop===true)break;
  const config=Object.fromEntries(Object.entries(row).filter(([key])=>!['key','keyValue','operator','next','stop','merge'].includes(key)));
  result=row.merge===true?{...result,...config}:config;if(row.next!==true)break;
 }
 return result;
}
export function newWasherDraft(report:WasherConfigReport|undefined,program:WasherProgram,panel?:DevicePanel):WasherDraft {
 if(panel&&(isDryerPanel(panel)||program.name.startsWith('drum-')))return {program:program.name,values:{}};
 if(program.published&&panel){
  const draft={program:program.name,values:{}};
  return {...draft,values:Object.fromEntries(publishedWasherFields(program,panel,draft).map(field=>[field.name,field.value]))};
 }
 if(!report)return {program:program.name,values:{}};
 const values:Record<string,number|boolean>={};for(const item of mergedItems(report,program)){const name=String(item.propertyName);if(scalar(item.defaultValue))values[name]=item.defaultValue;else if(['night','highWaterLevel','sterilization'].includes(name))values[name]=false;}
 return{program:program.name,values};
}
export function washerFields(report:WasherConfigReport|undefined,program:WasherProgram,panel:DevicePanel,draft:WasherDraft):WasherField[]{
 if(program.published)return publishedWasherFields(program,panel,draft);
 if(!report)return [];
 const definitions=object(report.config.conditionsConfig);
 return mergedItems(report,program).flatMap(base=>{
  const name=String(base.propertyName),binding=bindings[name];if(!binding)return[];
  const item=merge(base,washerConditions(base.conditions,draft.values,definitions));
  const property=findProperty(panel,['washer'],[binding[0]]);
  const choices=Array.isArray(item.data)?item.data.filter(scalar):typeof draft.values[name]==='boolean'?[false,true]:[];
  const value=draft.values[name];if(!scalar(value))return[];
  return[{name,label:locale(item.title)??binding[1],unit:name==='shakeTime'&&item.unitType==='min'?'分钟':binding[2],property,choices,value,hidden:item.isHide===true,disabled:item.disabled===true||!property?.access.includes('write')||!choices.length,config:item}];
 });
}
/** Re-evaluate linked defaults until stable; limit cycles from invalid metadata. */
export function changeWasherDraft(report:WasherConfigReport|undefined,program:WasherProgram,panel:DevicePanel,draft:WasherDraft,name:string,value:number|boolean):WasherDraft {
 const original=washerFields(report,program,panel,draft).find(f=>f.name===name);
 if(!original||original.disabled||original.hidden||!original.choices.includes(value))return draft;
 const next={...draft,selector:undefined,values:{...draft.values,[name]:value}};
 if(program.published){
  if(!isDryerPanel(panel))return next;
  const fields=new Set(publishedWasherFields(program,panel,next).map(field=>field.name));
  return {...next,values:Object.fromEntries(Object.entries(next.values).filter(([name])=>fields.has(name)))};
 }
 for(let pass=0;pass<32;pass++){
  let fixed=false;
  for(const field of washerFields(report,program,panel,next)){
   const reset=(name==='dry'&&['speed','shakeTime'].includes(field.name))||(name==='temperature'&&field.name==='rinsh'&&panel.model==='mibx2.washer.v15rm'&&typeof field.value==='number'&&typeof field.config.defaultValue==='number'&&field.config.defaultValue>field.value)||(name==='night'&&field.name==='speed'&&field.value!==0&&field.value!==400);
   if((!field.choices.includes(field.value)||pass===0&&reset)&&scalar(field.config.defaultValue)&&field.choices.includes(field.config.defaultValue)&&field.value!==field.config.defaultValue){next.values[field.name]=field.config.defaultValue;fixed=true;}
  }
  if(!fixed)return next;
 }
 return draft;
}
export function washerFieldText(field:WasherField,value:number|boolean=field.value):string{
 const custom=locale(object(field.config.dataLabel)[String(value)]);if(custom)return custom;
 if(typeof value==='boolean')return value?'开启':'关闭';
 if(field.published){
  const choice=field.property?.valueList?.find(choice=>choice.value===value),label=choice?.description;
  const localized=chineseProgramLabel(choice?.localizedDescription);
  if(localized)return localized;
  const names:Record<string,string>={smart:'智能烘干','smart low':'低温烘干',none:'不烘干',timed:'定时烘干',timing:'定时烘干'};
  if(field.name==='drying-level'&&label)return names[modeName(label)]??deviceChoiceLabel(label,label);
  if(field.name==='drying-degree'&&label){const degrees:Record<string,string>={null:'无',ironing:'熨烫','wear immediately':'即穿',store:'储藏'};return degrees[modeName(label)]??deviceChoiceLabel(label,label);}
  const actual=field.property&&physicalChoice(field.property,value);
  if(actual===0&&field.name==='target-temperature')return '常温';
  if(actual===0&&field.name==='spin-speed')return '不脱水';
  return actual!==undefined&&field.unit?`${actual}${field.unit}`:label?deviceChoiceLabel(label,label):`${value}${field.unit}`;
 }
 if(field.name==='temperature'&&value===0)return'常温';
 if(field.name==='dry'){if(value===0)return'不烘干';if(value===1)return'智能烘干';if(value===1.1)return'熨烫';if(value===1.2)return'即穿';if(value===1.3)return'储藏';if(value===2)return'定时烘干';}
 if(value===0&&['soak','shakeTime','speed'].includes(field.name))return'无';
 return `${value}${field.unit}`;
}
export function washerMinutes(program:WasherProgram,fields:WasherField[]):number{
 const sum=fields.reduce((total,field)=>{const t=object(field.config.timeObj)[String(field.value)]??field.config.time;return total+(typeof t==='number'?t:0);},0);return sum||program.minutes;
}
