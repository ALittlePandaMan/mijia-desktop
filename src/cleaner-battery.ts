import {capabilityCategory} from './device-capabilities';
import type {Device,DevicePanel,Property} from './types';

export function batteryOnlyCleaner(device:Pick<Device,'model'|'specType'>):boolean{
 const category=capabilityCategory(device.specType);
 return category==='mopping-machine'||category==='vacuum-cleaner'||device.model==='roidmi.vacuum.v1'||/^[^.]+\.(?:mop|cleaner)\.[^.]+$/.test(device.model);
}

export function cleanerBattery(panel:DevicePanel|undefined):Property|undefined{
 if(!panel||panel.unsupportedReason||!batteryOnlyCleaner(panel))return;
 for(const [service,name] of [['battery','battery-level'],['ble-battery','ble-battery-level']]){
  const matches=panel.services.filter(s=>s.name===service).flatMap(s=>{
   if(s.siid<1||panel.services.filter(other=>other.siid===s.siid).length!==1)return [];
   return s.properties.filter(p=>p.siid===s.siid&&p.piid>0&&p.name===name&&s.properties.filter(other=>other.piid===p.piid).length===1
     &&p.access.includes('read')&&!p.unsupportedReason&&/^(?:u?int(?:8|16|32)|float|double)$/.test(p.format)
     &&(p.unit==='percentage'||p.valueRange?.[0]===0&&p.valueRange[1]===100));
  });
  if(matches.length)return matches.length===1?matches[0]:undefined;
 }
}
export function currentCleanerBattery(property:Property|undefined):number|undefined{
 const value=property?.value;
 return property?.code===0&&typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?value:undefined;
}
export function cleanerBatteryCaption(value:unknown):string|undefined{
 return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?`电量 ${value}%`:undefined;
}
