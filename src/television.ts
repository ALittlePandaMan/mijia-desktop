import type {Action,Device,DevicePanel,Json,Property,Service} from './types';
import {capabilityCategory} from './device-capabilities';
import {isReadableValue} from './panel-layout';
import {writeUnsupportedReason} from './logic';

export const televisionRoles=['power','volume-down','volume-up','up','left','center','right','down','home','back','menu'] as const;
export type TelevisionRole=typeof televisionRoles[number];
export type TelevisionCommand={kind:'action';service:Service;action:Action}|{kind:'property';property:Property;value:Json};
const actions:Record<TelevisionRole,string>={power:'turn-off','volume-down':'press-volume-down','volume-up':'press-volume-up',up:'press-up',left:'press-left',center:'press-ok',right:'press-right',down:'press-down',home:'press-home',back:'press-back',menu:'press-menu'};
export const televisionLabels:Record<TelevisionRole,string>={power:'电源','volume-down':'音量减','volume-up':'音量加',up:'上',left:'左',center:'确认',right:'右',down:'下',home:'主页',back:'返回',menu:'菜单'};
const iid=(id:number)=>Number.isSafeInteger(id)&&id>0&&id<=0xffffffff;
export function televisionPageEligible(device:Pick<Device,'did'|'model'|'specType'>,panel:DevicePanel):boolean {
 return /^xiaomi\.tv\./.test(device.model)&&panel.did===device.did&&panel.model===device.model&&!panel.unsupportedReason&&capabilityCategory(panel.specType??device.specType)==='television';
}
function service(panel:DevicePanel,name:string):Service|undefined {
 const found=panel.services.filter(s=>s.name===name);
 return found.length===1&&iid(found[0].siid)&&panel.services.filter(s=>s.siid===found[0].siid).length===1?found[0]:undefined;
}
function action(panel:DevicePanel,serviceName:string,name:string):TelevisionCommand|undefined {
 const s=service(panel,serviceName),found=s?.actions.filter(a=>a.name===name);
 if(!s||found?.length!==1)return;
 const a=found[0];if(a.siid===s.siid&&iid(a.aiid)&&!a.in.length&&!a.unsupportedReason&&s.actions.filter(b=>b.aiid===a.aiid).length===1)return{kind:'action',service:s,action:a};
}
function property(panel:DevicePanel,serviceName:string,name:string):Property|undefined {
 const s=service(panel,serviceName),found=s?.properties.filter(p=>p.name===name);
 if(!s||found?.length!==1)return;
 const p=found[0];return p.siid===s.siid&&iid(p.piid)&&s.properties.filter(v=>v.piid===p.piid).length===1&&p.access.includes('write')&&isReadableValue(p)&&!writeUnsupportedReason(p)?p:undefined;
}
/** Bind the authenticated description's semantic keys, never a copied service ID.
 * Cloud-only power remains shutdown when the description has no power-on control. */
export function televisionCommand(panel:DevicePanel,role:TelevisionRole):TelevisionCommand|undefined {
 if(!televisionPageEligible({did:panel.did,model:panel.model},panel))return;
 const remote=action(panel,'remote-control',actions[role]);if(remote)return remote;
 if(role==='power'){
  const p=property(panel,'television','on');if(p?.format==='bool'&&typeof p.value==='boolean')return{kind:'property',property:p,value:!p.value};
  return action(panel,'television','turn-off');
 }
 if(role==='volume-down'||role==='volume-up'){
  const p=property(panel,'speaker','volume')??property(panel,'television','volume'),range=p?.valueRange;
  if(!p||typeof p.value!=='number'||!Number.isFinite(p.value)||!range||p.valueList||range.length!==3||!range.every(Number.isFinite)||range[2]<=0||range[1]<=range[0]||p.value<range[0]||p.value>range[1])return;
  const value=Number(Math.min(range[1],Math.max(range[0],p.value+(role==='volume-up'?range[2]:-range[2]))).toFixed(8));
  if(value!==p.value)return{kind:'property',property:p,value};
 }
}
