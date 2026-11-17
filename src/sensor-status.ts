import type {Json,Property} from './types';
/** MIoT contact is true when the two parts touch. Native isa.magnet.dw2hl
 * comparison: the observed false report is displayed as 已打开 by Xiaomi Home.
 * Never reinterpret a missing reading or override an explicit device enum. */
export function sensorStatusLabel(service:string|undefined,property:Property,value:Json|undefined):string|undefined {
 if(service==='magnet-sensor'&&property.name==='contact-state'&&property.format==='bool'&&!property.valueList?.length&&typeof value==='boolean')return value?'已关闭':'已打开';
 if(service==='occupancy-sensor'&&property.name==='occupancy-status'&&property.format==='bool'&&!property.valueList?.length&&typeof value==='boolean')return value?'有人':'无人';
 if(property.format==='bool'&&!property.valueList?.length&&typeof value==='boolean'){
  if(service==='submersion-sensor'&&property.name==='submersion-state')return value?'检测到漏水':'正常';
  if(service==='pressure-sensor'&&property.name==='pressure-present-state')return value?'有压力':'无压力';
  if(service==='motion-sensor'&&['motion-state','motion-detection-state'].includes(property.name))return value?'检测到移动':'未检测到移动';
 }
 return undefined;
}
