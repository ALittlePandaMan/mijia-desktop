import {capabilityCategory} from './device-capabilities';
import {missingReadingText} from './logic';
import {propertyReading} from './panel-layout';
import {sensorStatusLabel} from './sensor-status';
import type {Device,DevicePanel,Property,Service} from './types';

const sensorModels = {
 sensor_ht:'temperature-humidity-sensor',weather:'temperature-humidity-sensor',
 sensor_occupy:'occupancy-sensor',motion:'motion-sensor',sensor_motion:'motion-sensor',
 sensor_gas:'gas-sensor',sensor_natgas:'gas-sensor',flood:'submersion-sensor',sensor_wleak:'submersion-sensor',
 magnet:'magnet-sensor',sensor_magnet:'magnet-sensor',vibration:'vibration-sensor',sensor_smoke:'smoke-sensor',
 sen_ill:'illumination-sensor',senpres:'pressure-sensor',
} as const;
type SensorCategory = typeof sensorModels[keyof typeof sensorModels];
export type SensorMetric = 'state'|'battery'|'illumination'|'temperature'|'humidity';
interface SensorReading {
 metric:SensorMetric;
 property?:Property;
 serviceName?:string;
 label:string;
 unit?:string;
 precision?:number;
 displayValue?:string;
}

export function sensorDetailCategory(device:Pick<Device,'model'|'specType'>, panel?:DevicePanel):SensorCategory|undefined {
 const category=capabilityCategory(panel?.specType??device.specType);
 if(category)return Object.values(sensorModels).find(type=>type===category);
 const family=device.model.split('.')[1];
 return Object.hasOwn(sensorModels,family)?sensorModels[family as keyof typeof sensorModels]:undefined;
}

const stateNames:Partial<Record<SensorCategory,readonly string[]>>={
 'magnet-sensor':['contact-state','status'],
 'motion-sensor':['motion-state','motion-detection-state','status'],
 'occupancy-sensor':['occupancy-status'],
 'gas-sensor':['status'],
 'smoke-sensor':['status'],
 'submersion-sensor':['submersion-state','status'],
 'pressure-sensor':['pressure-present-state','status'],
 'vibration-sensor':['vibration-state','status'],
};
const statusLabels:Record<string,string>={
 normal:'正常','normal monitoring':'正常','normal status':'正常',
 'no one':'无人','has someone':'有人','has one':'有人',someone:'有人',occupied:'有人',unoccupied:'无人',
 open:'已打开',opened:'已打开',close:'已关闭',closed:'已关闭',
 alarm:'报警中',alarming:'报警中',fault:'故障','in fault':'故障','device fault':'设备故障',
 'in fire alarm':'火警','in gas leakage alarm':'燃气泄漏','natural gas leak alarm':'天然气泄漏',
 'co leak alarm':'一氧化碳泄漏','end of life':'传感器寿命到期','sensor end of life':'传感器寿命到期',
 'sensor life expiration':'传感器寿命到期','expiry of equipment life':'传感器寿命到期',expire:'传感器寿命到期',
 preheating:'预热中','warm up':'预热中','self inspection':'自检中',
 'smoke chamber dust warning':'烟室积尘','high temperature alarm no smoke':'高温报警',
 idle:'待机',busy:'工作中',error:'异常',weak:'弱',strong:'强',fully:'充足',full:'充足',
 low:'低电量','low battery':'低电量',exhausted:'电量耗尽',centre:'中等',high:'充足','charging in progress':'充电中',
};
const numeric=(p:Property)=>/^(u?int(8|16|32|64)|float|double)$/.test(p.format);
const enumOrFlag=(p:Property)=>p.format==='bool'||!!p.valueList?.length;
const level=(p:Property)=>numeric(p)&&!p.valueList?.length&&(p.unit==='percentage'||p.valueRange?.[0]===0&&p.valueRange[1]===100);
const batteryServices=['battery','single-use-battery','battery-service','ble-battery'];

export function sensorDetailReadings(category:SensorCategory,panel?:DevicePanel):SensorReading[]{
 const services=panel?.services.filter(s=>s.siid>0&&panel.services.filter(other=>other.siid===s.siid).length===1)??[];
 const property=(service:Service,name:string,accept:(p:Property)=>boolean)=>{
  const matches=service.properties.filter(p=>p.siid===service.siid&&p.piid>0&&p.name===name&&p.access.includes('read')&&!p.unsupportedReason
    &&service.properties.filter(other=>other.piid===p.piid).length===1&&accept(p));
  return matches.length===1?matches[0]:undefined;
 };
 const find=(names:readonly string[],properties:readonly string[],accept:(p:Property)=>boolean)=>{
  for(const serviceName of names)for(const name of properties){
   const candidates=services.filter(s=>s.name===serviceName).flatMap(service=>property(service,name,accept)??[]);
   // The standard service at IID 2 is the device-wide reading, for example
   // on Xiaomi P1 where additional occupancy services report individual zones.
   const binding=candidates.length===1?candidates[0]:candidates.find(p=>p.siid===2);
   if(binding)return {property:binding,serviceName};
  }
 };
 const format=(binding:ReturnType<typeof find>)=>{
  if(!binding)return missingReadingText;
  const {property:p,serviceName}=binding;
  const {value}=propertyReading(p);
  const choice=p.valueList?.find(entry=>entry.value===value);
  if(choice){
   const description=choice.localizedDescription??choice.description;
   return /[\u3400-\u9fff]/.test(description)?description:statusLabels[choice.description.trim().toLowerCase().replaceAll('-',' ')]??description;
  }
  return sensorStatusLabel(serviceName,p,value)
   ??(typeof value==='boolean'&&serviceName==='motion-sensor'?(value?'检测到移动':'未检测到移动'):undefined)
   ??(typeof value==='boolean'&&serviceName==='vibration-sensor'?(value?'检测到振动':'未检测到振动'):undefined)
   ??missingReadingText;
 };
 const readings:SensorReading[]=[];
 if(category==='temperature-humidity-sensor'){
  for(const [metric,name,label,unit,precision] of [['temperature','temperature','温度','celsius',1],['humidity','relative-humidity','湿度','percentage',0]] as const){
   const binding=find([category,'environment'],[name],p=>numeric(p)&&p.unit===unit);
   if(binding)readings.push({metric,...binding,label,unit:unit==='celsius'?'℃':'%',precision});
  }
 }else if(category!=='illumination-sensor'){
  const names=stateNames[category]??[];
  const binding=find([category],names,enumOrFlag)
   ??(category==='submersion-sensor'?find(['rain-sensor'],['rain-status'],enumOrFlag):undefined);
  readings.push({metric:'state',...binding,label:'当前状态',displayValue:format(binding)});
 }
 const illumination=find([category,'environment','illumination-sensor','illumination'],['illumination'],p=>(numeric(p)&&p.unit==='lux')||!!p.valueList?.length);
 if(illumination)readings.push({metric:'illumination',...illumination,label:'光照',unit:illumination.property.unit==='lux'?'lx':undefined,
  displayValue:illumination.property.valueList?.length?format(illumination):undefined});
 const battery=find([...batteryServices,category],['battery-level','ble-battery-level'],level)
  ??find([...batteryServices,category],['battery-level','battery-state','ble-battery-level'],p=>!!p.valueList?.length);
 if(battery){
  const percent=level(battery.property);
  const {value}=propertyReading(battery.property);
  const valid=typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;
  if(percent&&!valid)readings.push({metric:'battery',label:'当前电量',unit:'%',displayValue:missingReadingText});
  else readings.push({metric:'battery',...battery,label:'当前电量',unit:percent?'%':undefined,displayValue:percent?undefined:format(battery)});
 }
 return readings;
}

/** Page scope only: protocol capabilities and raw readings remain intact. */
export function isSensorCategory(category:string|null|undefined):boolean{
 return !!category&&(/-sensor$/.test(category)||['air-monitor','air-quality-monitor'].includes(category));
}
export function sensorReadingVisible(category:string|null|undefined,service:string,name:string):boolean{
 if(!isSensorCategory(category))return true;
 if(service==='battery')return name==='battery-level';
 const current=new Set(['temperature','relative-humidity','illumination','battery-level','ble-battery-level','occupancy-status','contact-state','gas-concentration','smoke-concentration','pm2.5-density','pm10-density','co2-density','air-quality','status','submersion-state','motion-state','motion-detection-state','pressure-present-state','wind-speed','rainfall','atmospheric-pressure']);
 return current.has(name)&&['temperature-humidity-sensor','environment','occupancy-sensor','magnet-sensor','gas-sensor','smoke-sensor','air-monitor','air-quality-monitor','motion-sensor','submersion-sensor','illumination-sensor','vibration-sensor','pressure-sensor','battery-service','ble-battery'].includes(service);
}
