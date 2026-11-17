import type {DevicePanel,Property} from './types';
export interface SwitchPolicy {label?:string;reason?:string}
/** Same-service read dependency. Do not infer modes from room/device names. */
export function switchPolicy(panel:DevicePanel|undefined,on:Property|undefined):SwitchPolicy {
 const service=panel?.services.find(s=>s.name==='switch'&&s.siid===on?.siid);
 const mode=service?.properties.find(p=>p.name==='mode'&&p.access.includes('read'));
 if(!mode)return {};
 if(mode.code!==0||mode.value==null)return {reason:'开关模式未读取，暂不能操作此按键。'};
 const name=mode.valueList?.find(c=>c.value===mode.value)?.description.toLowerCase().replace(/[\s_-]/g,'');
 const label=panel?.model==='yeelink.switch.ylsw6'&&mode.value===2&&name==='wireless'?'灵动开关':name==='wireless'||name==='wirelessswitch'?'无线开关':name==='flex'||name==='flexswitch'?'灵动开关':undefined;
 if(label)return {label,reason:`此按键已转为${label}，不能切断供电。`};
 return name==='wiredandwireless'?{}:{reason:'无法确认开关模式，暂不能操作此按键。'};
}
