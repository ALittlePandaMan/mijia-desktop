import type {Action,Device,DevicePanel,Json,Property,Service} from './types';
import {capabilityCategory,validChoices,validRange} from './device-capabilities';
import {isReadableValue} from './panel-layout';
import {coercePropertyInput,inputUnsupportedReason} from './logic';
import {isIrRemote} from './ir-remote';

export const televisionRoles=['power','volume-down','volume-up','up','left','center','right','down','home','back','menu'] as const;
export type TelevisionRole=typeof televisionRoles[number];
export type TelevisionCommand={kind:'action';service:Service;action:Action;inputs:Json[]}|{kind:'property';property:Property;value:Json};
const actions:Record<TelevisionRole,string>={power:'press-power','volume-down':'press-volume-down','volume-up':'press-volume-up',up:'press-up',left:'press-left',center:'press-ok',right:'press-right',down:'press-down',home:'press-home',back:'press-back',menu:'press-menu'};
const legacyKeys:Record<TelevisionRole,string>={power:'power','volume-down':'volume-down','volume-up':'volume-up',up:'up',left:'left',center:'ok',right:'right',down:'down',home:'home',back:'back',menu:'menu'};
const keyLabels:Record<TelevisionRole,string>={power:'power','volume-down':'volumedown','volume-up':'volumeup',up:'up',left:'leftbutton',center:'ok',right:'rightbutton',down:'down',home:'home',back:'back',menu:'menu'};
export const televisionLabels:Record<TelevisionRole,string>={power:'电源','volume-down':'音量减','volume-up':'音量加',up:'上',left:'左',center:'确认',right:'右',down:'下',home:'主页',back:'返回',menu:'菜单'};
const iid=(id:number)=>Number.isSafeInteger(id)&&id>0&&id<=0xffffffff;
const categories=['television','tv-box','stb','projector'];
export function televisionCategory(type:Device['specType']):string|undefined {
 const category=capabilityCategory(type);
 return category&&categories.includes(category)?category:undefined;
}
export function televisionPageEligible(device:Pick<Device,'did'|'model'|'specType'>,panel:DevicePanel):boolean {
 return !isIrRemote(device.model)&&panel.did===device.did&&panel.model===device.model&&!panel.unsupportedReason
  &&!!televisionCategory(panel.specType??device.specType);
}
function service(panel:DevicePanel,name:string):Service|undefined {
 const found=panel.services.filter(s=>s.name===name);
 return found.length===1&&iid(found[0].siid)&&panel.services.filter(s=>s.siid===found[0].siid).length===1?found[0]:undefined;
}
function action(panel:DevicePanel,serviceName:string,name:string,input?:{piid:number;value:Json}):Extract<TelevisionCommand,{kind:'action'}>|undefined {
 const s=service(panel,serviceName),found=s?.actions.filter(a=>a.name===name);
 if(!s||found?.length!==1)return;
 const a=found[0],matchingInput=input?a.in.length===1&&a.in[0]===input.piid:!a.in.length;
 if(a.siid===s.siid&&iid(a.aiid)&&matchingInput&&!a.unsupportedReason&&s.actions.filter(b=>b.aiid===a.aiid).length===1)
  return {kind:'action',service:s,action:a,inputs:input?[input.value]:[]};
}
function property(panel:DevicePanel,serviceName:string,name:string):Property|undefined {
 const s=service(panel,serviceName),found=s?.properties.filter(p=>p.name===name);
 if(!s||found?.length!==1)return;
 const p=found[0];
 return p.siid===s.siid&&iid(p.piid)&&s.properties.filter(v=>v.piid===p.piid).length===1&&!inputUnsupportedReason(p)?p:undefined;
}
function setting(panel:DevicePanel,name:string,services:readonly string[],accept:(p:Property)=>boolean):Property|undefined{
 for(const serviceName of services){
  const p=property(panel,serviceName,name);
  if(p&&p.access.includes('read')&&p.access.includes('write')&&accept(p))return p;
 }
}
const virtualKey=(label:string)=>label.trim().toLowerCase().replace(/[\s_-]/g,'');
function virtualAction(panel:DevicePanel,key:string){
 const p=property(panel,'virtual-remote','button-type');
 if(!p||p.format!=='uint8'||!validChoices(p))return;
 const options=p.valueList!.filter(v=>virtualKey(v.description)===key);
 const value=options[0]?.value;
 if(options.length!==1||typeof value!=='number'||!Number.isInteger(value)||value<0||value>255)return;
 return action(panel,'virtual-remote','press-button',{piid:p.piid,value});
}

function deviceServices(panel:DevicePanel):string[]{
 const category=televisionCategory(panel.specType);
 return category==='television'?[category,'television-alexa']:category?[category]:[];
}
const boolSetting=(p:Property)=>p.format==='bool'&&!p.valueList&&!p.valueRange;
const televisionPower=(panel:DevicePanel)=>setting(panel,'on',deviceServices(panel),boolSetting);
const televisionVolume=(panel:DevicePanel)=>setting(panel,'volume',['speaker',...deviceServices(panel)],validRange);

/** Both action layouts carry the actual service/action IIDs and the model's argument. */
export function televisionCommand(panel:DevicePanel,role:TelevisionRole):TelevisionCommand|undefined {
 if(!televisionPageEligible({did:panel.did,model:panel.model},panel))return;
 const remote=action(panel,'remote-control',actions[role])??(role==='power'?action(panel,'remote-control','turn-off'):undefined)
  ??virtualAction(panel,keyLabels[role])??action(panel,'remote-key',legacyKeys[role]);
 if(remote)return remote;
 if(role==='power'){
  const p=televisionPower(panel);
  if(p)return isReadableValue(p)&&typeof p.value==='boolean'?{kind:'property',property:p,value:!p.value}:undefined;
  return action(panel,televisionCategory(panel.specType)??'','turn-off');
 }
 if(role==='volume-down'||role==='volume-up'){
  const p=televisionVolume(panel);
  if(!isReadableValue(p)||typeof p.value!=='number')return;
  const next=Number((p.value+(role==='volume-up'?1:-1)*p.valueRange![2]).toFixed(8));
  try{
   if(coercePropertyInput(p,String(p.value))!==p.value)return;
   return {kind:'property',property:p,value:coercePropertyInput(p,String(next))};
  }catch{return;}
 }
}

export function televisionSettings(panel:DevicePanel){
 return {
  source:setting(panel,'input-control',deviceServices(panel),validChoices),
  mute:setting(panel,'mute',['speaker',...deviceServices(panel)],boolSetting),
  hasStatefulKeys:!!(televisionPower(panel)||televisionVolume(panel)),
 };
}

export function televisionExtraKeys(panel:DevicePanel){
 return [
  {label:'设置',command:action(panel,'remote-control','press-settings')??virtualAction(panel,'settings')},
  {label:'对焦',command:action(panel,'remote-control','press-focus')??virtualAction(panel,'focus')??action(panel,'remote-key','focus')},
  {label:'自动对焦',command:virtualAction(panel,'autofocus')},
  {label:'对焦加',command:virtualAction(panel,'focusup')},
  {label:'对焦减',command:virtualAction(panel,'focusdown')},
  {label:'播放',command:action(panel,'play-control','play')},
  {label:'暂停',command:action(panel,'play-control','pause')},
  {label:'上一首',command:action(panel,'play-control','previous')},
  {label:'下一首',command:action(panel,'play-control','next')},
  {label:'停止播放',command:action(panel,'play-control','stop')},
  {label:'梯形校正',command:virtualAction(panel,'keystonecorrection')??action(panel,'remote-key','t-correction')},
 ];
}
