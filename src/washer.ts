import type { DevicePanel, Json, Property } from './types';
import { findProperty } from './panel-layout';

type ObjectValue={ [key:string]:Json };
export interface WasherConfigReport { did:string;model:string;firmware:string;fetchedAt:number;config:ObjectValue }
export interface WasherProgram { name:string;title:string;meaning:string;value:number;minutes:number;autoTime:boolean;isOrder:boolean;items:ObjectValue[] }
export interface WasherField { name:string;label:string;unit:string;property?:Property;choices:(number|boolean)[];value:number|boolean;hidden:boolean;disabled:boolean;config:ObjectValue }
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
/** Model enum descriptions bind semantic names; values are never program indices. */
export function washerPrograms(report:WasherConfigReport|undefined,panel:DevicePanel|undefined):WasherProgram[]{
 if(!report||!panel||report.did!==panel.did||report.model!==panel.model)return[];
 const mode=findProperty(panel,['washer'],['mode']);
 return (Array.isArray(report.config.modesData)?report.config.modesData:[]).flatMap(raw=>{
  const row=object(raw),name=typeof row.modeName==='string'?row.modeName:'',definition=named[name];if(!definition)return[];
  const meanings=mode?.valueList?.filter(choice=>choice.description.trim().toLowerCase()===definition[0].toLowerCase());
  if(meanings?.length!==1||typeof meanings[0].value!=='number')return[];
  const override=object(object(report.config.modesConfig)[name]);
  return[{name,title:locale(row.title)??locale(override.title)??definition[1],meaning:definition[0],value:meanings[0].value,minutes:typeof row.modeTime==='number'?row.modeTime:0,autoTime:name==='smart',isOrder:row.isOrder!==false,items:(Array.isArray(row.items)?row.items:[]).map(object)}];
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
export function newWasherDraft(report:WasherConfigReport,program:WasherProgram):WasherDraft {
 const values:Record<string,number|boolean>={};for(const item of mergedItems(report,program)){const name=String(item.propertyName);if(scalar(item.defaultValue))values[name]=item.defaultValue;else if(['night','highWaterLevel','sterilization'].includes(name))values[name]=false;}
 return{program:program.name,values};
}
export function washerFields(report:WasherConfigReport,program:WasherProgram,panel:DevicePanel,draft:WasherDraft):WasherField[]{
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
export function changeWasherDraft(report:WasherConfigReport,program:WasherProgram,panel:DevicePanel,draft:WasherDraft,name:string,value:number|boolean):WasherDraft {
 const original=washerFields(report,program,panel,draft).find(f=>f.name===name);
 if(!original||original.disabled||original.hidden||!original.choices.includes(value))return draft;
 const next={...draft,selector:undefined,values:{...draft.values,[name]:value}};
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
 if(field.name==='temperature'&&value===0)return'常温';
 if(field.name==='dry'){if(value===0)return'不烘干';if(value===1)return'智能烘干';if(value===1.1)return'熨烫';if(value===1.2)return'即穿';if(value===1.3)return'储藏';if(value===2)return'定时烘干';}
 if(value===0&&['soak','shakeTime','speed'].includes(field.name))return'无';
 return `${value}${field.unit}`;
}
export function washerMinutes(program:WasherProgram,fields:WasherField[]):number{
 const sum=fields.reduce((total,field)=>{const t=object(field.config.timeObj)[String(field.value)]??field.config.time;return total+(typeof t==='number'?t:0);},0);return sum||program.minutes;
}
