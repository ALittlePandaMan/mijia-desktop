import {capabilityCategory} from './device-capabilities';
import {deviceChoiceLabel} from './device-labels';
import {missingReadingText} from './logic';
import type {Device,DevicePanel,Property} from './types';

type Category='lock'|'alertor'|'intercom'|'door'|'safe-box'|'tracker';
type Metric='battery'|'door'|'state';
const categories:Record<Category,readonly Metric[]>={lock:['battery','door'],alertor:['state','battery'],intercom:['battery'],door:['door'],'safe-box':['battery'],tracker:['state']};
const deviceTypes:Record<string,Category>={lock:'lock','door-lock':'lock',alarm:'alertor',alertor:'alertor',intercom:'intercom',door:'door',safe:'safe-box','safe-box':'safe-box',tracker:'tracker'};
const titles:Record<Metric,string>={battery:'当前电量',door:'门状态',state:'当前状态'};

export function securityCategory(device:Pick<Device,'model'|'specType'>):Category|undefined {
 const published=capabilityCategory(device.specType);
 const key=published??device.model.split('.')[1];
 return key&&Object.hasOwn(deviceTypes,key)?deviceTypes[key]:undefined;
}

const valid=(p?:Property)=>p?.code===0&&p.value!=null;
function valueLabel(property:Property|undefined):string|undefined {
 if(!valid(property)||!property)return;
 const choice=property.valueList?.find(c=>c.value===property.value);
 if(!choice)return;
 const translated=choice.localizedDescription;
 if(translated&&/[\u3400-\u9fff]/.test(translated))return translated;
 const known:Record<string,string>={off:'关闭',busy:'工作中',error:'异常',idle:'待机',normal:'正常',open:'已打开',opened:'已打开',closed:'已关闭',close:'已关闭',
  locked:'已上锁',unlocked:'已开锁',ajar:'门虚掩','door was ajar':'门虚掩','door opening':'正在开门','door closing':'正在关门','leaving the door open timed out':'门超时未关'};
 const key=choice.description.trim().toLowerCase();
 return Object.hasOwn(known,key)?known[key]:deviceChoiceLabel(choice.description,missingReadingText,'state');
}

export function securityReadings(category:Category,panel?:DevicePanel):{metric:Metric;label:string;value?:string;property?:Property}[] {
 const property=(service:string,name:string,accept:(p:Property)=>boolean=()=>true)=>{
  const candidates=panel?.services.filter(s=>s.name===service&&s.siid>0&&panel.services.filter(other=>other.siid===s.siid).length===1)
   .flatMap(s=>s.properties.filter(p=>p.siid===s.siid&&p.piid>0&&p.name===name&&p.access.includes('read')&&!p.unsupportedReason
    &&s.properties.filter(other=>other.piid===p.piid).length===1&&accept(p)))??[];
  return candidates.length===1?candidates[0]:undefined;
 };
 return categories[category].map(metric=>{
  const label=titles[metric];
  if(metric==='battery'){
   const percent=(p:Property)=>/^(u?int(8|16|32)|float|double)$/.test(p.format)&&!p.valueList&&(p.unit==='percentage'||p.valueRange?.[0]===0&&p.valueRange[1]===100);
   const p=property('battery','battery-level',percent)??property('ble-battery','ble-battery-level',percent)??property('intercom','battery-level',percent);
   return {metric,label,property:valid(p)&&typeof p?.value==='number'&&p.value>=0&&p.value<=100?p:undefined};
  }
  if(metric==='door'){
   const states=(p:Property)=>!!p.valueList?.some(item=>/open|clos|lock|ajar|开|关|锁/.test((item.description+' '+(item.localizedDescription??'')).toLowerCase()));
   const p=property('door','door-state')??property('door','status',states)??(category==='door'?property('settings','door-status',states):undefined);
   return {metric,label,value:valueLabel(p)};
  }
  if(category==='tracker'){
   const ride=property('custom','ride-status',p=>p.format==='bool');
   const direct=property('tracker','status');
   return {metric,label,value:valid(ride)&&typeof ride?.value==='boolean'?(ride.value?'有人乘坐':'无人乘坐'):valueLabel(direct)};
  }
  const status=property('alertor','status');
  const on=property('alertor','on',p=>p.format==='bool');
  const alarms=['over-voltage-alarm','under-voltage-alarm','over-current-alarm','leakage-alarm','live-line-ot-alarm','null-line-ot-alarm']
   .flatMap(name=>property('custom',name,p=>p.format==='bool')??[]);
  const alarming=alarms.some(p=>valid(p)&&p.value===true);
  const clear=alarms.length>0&&alarms.every(p=>valid(p)&&p.value===false);
  return {metric,label,value:valueLabel(status)??(alarming?'报警中':clear?'正常':valid(on)&&typeof on?.value==='boolean'?(on.value?'已开启':'已关闭'):undefined)};
 });
}
