import {detailProperty,detailServices,matchingPanel} from './appliance-details';
import {validChoices,validRange} from './device-capabilities';
import {deviceModeLabel} from './device-labels';
import {isReadableValue,numericValue} from './panel-layout';
import {powerSwitchBinding} from './water-heating';
import type {Device,DevicePanel,Property,Service} from './types';

const nameKey=(name:string)=>name.trim().toLowerCase().replace(/[\s_-]+/g,'');
type Choice=NonNullable<Property['valueList']>[number];

function uniqueService(services:Service[],name:string){
  const matches=services.filter(service=>service.name===name);
  return matches.length===1?matches[0]:undefined;
}

function scopedServices(device:Device,panel:DevicePanel|undefined){
  return detailServices(matchingPanel(device,panel)).filter(service=>device.controlServiceId==null||service.siid===device.controlServiceId);
}

function field(service:Service|undefined,name:string){
  return service&&detailProperty(service,name);
}

function setting(property:Property|undefined){
  return property?.access.includes('write')&&(validChoices(property)||validRange(property))?property:undefined;
}

export function kitchenFanBindings(device:Device,panel:DevicePanel|undefined,category:'hood'|'integrated-stove'|'ceiling-fan'){
  const services=scopedServices(device,panel);
  const ceiling=category==='ceiling-fan';
  const main=uniqueService(services,ceiling?'ceiling-fan':'hood');
  const fan=main&&uniqueService(services,'fan-control');
  // A stove's master relay and oven may be independent of its hood.
  const on=powerSwitchBinding(field(main,'on'));
  const light=powerSwitchBinding(field(uniqueService(services,'light'),'on'));
  const mode=setting(field(main,'mode'))??(ceiling?setting(field(uniqueService(services,'mode'),'mode')):undefined);
  const speed=setting(field(main,'fan-level'))??setting(field(fan,'fan-level'));
  const swing=ceiling?powerSwitchBinding(field(main,'vertical-swing')??field(fan,'vertical-swing')):undefined;
  const ceilingSpeed=ceiling?setting(field(uniqueService(services,'fan-speed-control'),'fan-speed-control')):undefined;
  return {on,light,speed:ceilingSpeed??speed,swing,mode:mode&&validChoices(mode)?mode:undefined};
}

export function switchState(binding:ReturnType<typeof powerSwitchBinding>):boolean|undefined {
  if(!isReadableValue(binding?.property))return;
  const value=binding.property.value;
  if(binding.values)return value===binding.values[1]?true:value===binding.values[0]?false:undefined;
  return typeof value==='boolean'?value:undefined;
}

const washLabels:Record<string,[string,string]>={
  basic:['标准洗','mix'],standardwashing:['标准洗','mix'],normal:['标准','mix'],
  quick:['快速','quickWash'],quickwash:['快速洗','quickWash'],
  energysaving:['节能洗','synthetic'],energysavingwash:['节能洗','synthetic'],
  intensive:['强力洗','intensive'],strongwashing:['强力洗','intensive'],
  disinfect:['消毒','degermingDry'],disinfecting:['消毒','degermingDry'],sterilize:['消毒','degermingDry'],
  glass:['玻璃洗','delicateWash'],prewash:['预洗','rinseSpin'],towashbeforemeal:['餐前洗','rinseSpin'],
  dry:['烘干','dry'],fresh:['保鲜','dryAirWash'],keep:['保管','dryAirWash'],auto:['自动','smart'],
  intelligentwashing:['智能洗','smart'],instantwashing:['即时洗','quickWash'],
  favourite:['收藏','followHeartWashDry'],custom:['自定义','followHeartWashDry'],
  seafood:['海鲜洗','delicateWash'],selfclean:['自清洁','drumClean'],selfwash:['自清洗','drumClean'],
  dailywash:['日常洗','mix'],dailywashing:['日常洗','mix'],crystalsoftwash:['晶柔洗','delicateWash'],
  ultraclean:['超净洗','intensive'],prewashbeforemeals:['餐前洗','rinseSpin'],washbeforemeals:['餐前洗','rinseSpin'],
  bitwash:['少量餐具洗','mix'],independentdrying:['单烘干','dry'],independentsterilization:['单消毒','degermingDry'],
};

const idleCycles=/^(off|poweroff|close|closed|shutdown|idle|standby|ready|stopped|待机|待机中|空闲中|关机)$/;
const activeCycles=/^(busy|working|running|washing|washstart|washinginitialization|startafterpause|dry|drying|drysaving|preservation|disinfect|disinfecting|sterilize|sterilizing|steriliser|ste|ste(?:dry|fan|dryfan)|dryfan|fan|cooling|heaten|heatwith(?:cooling|uv)|uv|uvwithcooling|allengaged|auto|keeping|doordrying|运行中|洗涤中|工作中|消毒中|烘干中|保鲜中|保存中)$/;

export function kitchenCycleStatus(choice:Choice|undefined):'idle'|'working'|'paused'|'scheduled'|'completed'|undefined{
  if(!choice)return;
  const keys=[nameKey(choice.description),nameKey(choice.localizedDescription??'')];
  if(keys.some(key=>activeCycles.test(key)))return 'working';
  if(keys.some(key=>/^(completed|endofwashing|finishwashing|工作完成|已完成|洗涤结束)$/.test(key)))return 'completed';
  if(keys.some(key=>idleCycles.test(key)))return 'idle';
  if(keys.some(key=>/^(pause|paused|washpause|suspendreservation|storagepause|暂停|已暂停|暂停中)$/.test(key)))return 'paused';
  if(keys.some(key=>/^(delay|appointed|appointment|scheduled|预约中)$/.test(key)))return 'scheduled';
}

export type KitchenCycleCategory='dishwasher'|'sterilizer';
export function kitchenCycleBindings(device:Device,panel:DevicePanel|undefined,category:KitchenCycleCategory){
  const services=scopedServices(device,panel);
  const legacy=category==='sterilizer'&&panel?.specType==='urn:miot-spec-v2:device:sterilizer:0000A04F:era-gc01:1';
  const main=uniqueService(services,legacy?'custom':category);
  const mode=field(main,'mode');
  const status=field(main,legacy?'workstatus':'status');
  const left=field(main,legacy?'lefttime':'left-time');
  const choiceFor=(property:Property|undefined)=>isReadableValue(property)?property.valueList?.find(c=>c.value===property.value):undefined;
  const statusChoice=choiceFor(status);
  const phase=kitchenCycleStatus(statusChoice);
  const options=mode&&validChoices(mode)?mode.valueList!:[];
  const named=options.flatMap(choice=>{
    const key=nameKey(choice.description);
    if(/^(idle|off|closed|null|none|unselected|neutralwash)$/.test(key))return [];
    const style=washLabels[key];
    const variants=options.filter(item=>item.description===choice.description);
    const base=variants.find(item=>item.localizedDescription&&choice.localizedDescription?.replace(/[2-9]$/,'')===item.localizedDescription&&
      !/\d$/.test(item.localizedDescription));
    const label=deviceModeLabel(base?.localizedDescription,choice.localizedDescription,style?.[0],choice.description);
    return label?[{...choice,label,glyph:style?.[1]??'smart',variant:!!base&&base!==choice}]:[];
  });
  const choices=named.filter((option,index)=>!option.variant&&named.findIndex(candidate=>!candidate.variant&&candidate.label===option.label)===index);
  // The separate start endpoint distinguishes a mode setting from a command
  // that may start the cycle by writing the mode itself.
  const startName=category==='dishwasher'?'start-wash':'start-work';
  const hasSeparateStart=main?.actions.some(action=>action.name===startName&&!action.unsupportedReason&&action.siid===main.siid)
    ||!!powerSwitchBinding(field(main,'on'));
  const minutes=(field:Property|undefined)=>{
    const time=numericValue(field);
    return time!=null&&time>0?(field?.unit==='seconds'?Math.ceil(time/60):field?.unit==='minutes'?Math.ceil(time):undefined):undefined;
  };
  return {mode,phase,choices,remaining:minutes(left),duration:minutes(field(main,'target-time')),
    canSelect:(phase==='idle'||phase==='completed')&&!!hasSeparateStart&&!!mode?.access.includes('write'),
    selected:named.find(choice=>choice.value===choiceFor(mode)?.value)};
}

export function waterHardness(device:Device,panel:DevicePanel|undefined){
  const main=uniqueService(scopedServices(device,panel),'water-softener');
  const reading=field(main,'water-hardness');
  if(reading&&/^(u?int(8|16|32|64)|float|double)$/.test(reading.format))return reading;
}
