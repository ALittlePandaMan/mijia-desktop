import interlocks from './bathroom-interlocks.json';
import {capabilityCategory,validChoices,validRange} from './device-capabilities';
import {coercePropertyInput,inputUnsupportedReason} from './logic';
import {isReadableValue} from './panel-layout';
import type {Action,Device,DevicePanel,Json,Property,Service} from './types';

export type BathroomCategory='toilet'|'water-heater'|'boiler'|'bath-heater'|'towel-rack'|'water-faucet'|'shower';
export type BathroomCommand=
  | {property:Property;value:Json}
  | {service:Service;action:Action;inputs:Json[]};

const categories:readonly string[]=['toilet','water-heater','boiler','bath-heater','towel-rack','water-faucet','shower'];
export const bathroomKey=(text:string)=>text.trim().toLowerCase().replace(/[\s_.-]+/g,'');
export function bathroomCategory(device:Device|undefined,panel:DevicePanel|undefined):BathroomCategory|undefined {
  if(!device||!panel||panel.did!==device.did||panel.model!==device.model||panel.unsupportedReason)return;
  const category=capabilityCategory(panel.specType);
  if(category&&categories.includes(category))return category as BathroomCategory;
}

type Choice=NonNullable<Property['valueList']>[number];
export const bathroomChoiceKeys=(choice:Choice)=>[bathroomKey(choice.description),bathroomKey(choice.localizedDescription??'')];
export const bathroomChoice=(property:Property|undefined)=>isReadableValue(property)
  ?property.valueList?.find(choice=>choice.value===property.value):undefined;

export function propertiesFor(panel:DevicePanel,paths:readonly string[],accept:(p:Property)=>boolean):Property[] {
  return paths.flatMap(path=>{
    const [service,name]=path.split('.');
    return panel.services.flatMap(s=>s.name===service?s.properties.filter(p=>p.siid===s.siid&&p.name===name&&accept(p)):[]);
  });
}

export const bathroomReadable=(p:Property)=>p.access.includes('read')&&!p.unsupportedReason;
export const bathroomWritable=(p:Property)=>bathroomReadable(p)&&p.access.includes('write')&&!inputUnsupportedReason(p);
export const bathroomAdjustable=(p:Property)=>bathroomWritable(p)&&(validRange(p)||validChoices(p));
export function bathroomCurrentValid(p:Property):boolean {
  if(!isReadableValue(p))return false;
  try{
    const index=p.valueList?.findIndex(option=>option.value===p.value);
    return coercePropertyInput(p,String(index??p.value))===p.value;
  }catch{return false;}
}

export function bathroomToggle(p:Property,zeroOne=false):{off:Json;on:Json}|undefined {
  if(p.format==='bool'&&!p.valueList&&!p.valueRange)return {off:false,on:true};
  if(validChoices(p)&&p.valueList!.length===2){
    const off=p.valueList!.find(c=>bathroomChoiceKeys(c).some(k=>['off','close','closed','ventclose','blowclsoe','关','关闭'].includes(k)));
    const on=p.valueList!.find(c=>bathroomChoiceKeys(c).some(k=>['on','open','opened','ventopen','blowopen','开','开启'].includes(k)));
    if(off&&on&&off.value!==on.value)return {off:off.value,on:on.value};
  }
  if(zeroOne&&validRange(p)&&p.valueRange!.join(',')==='0,1,1')return {off:0,on:1};
}

export function toiletSeated(panel:DevicePanel):boolean|undefined {
  const p=propertiesFor(panel,interlocks.seats,bathroomReadable)[0];
  if(!isReadableValue(p)||!bathroomCurrentValid(p))return;
  if(typeof p.value==='boolean')return p.value;
  const choice=bathroomChoice(p);
  if(choice){
    const keys=bathroomChoiceKeys(choice);
    if(keys.some(k=>interlocks.seated.includes(k)))return true;
    if(keys.some(k=>interlocks.unseated.includes(k)))return false;
  }
  if(validRange(p)&&p.valueRange!.join(',')==='0,1,1'&&(p.value===0||p.value===1))return p.value===1;
}

export function bathroomAction(panel:DevicePanel,paths:readonly string[]):Extract<BathroomCommand,{action:Action}>|undefined {
  for(const path of paths){
    const [serviceName,actionName]=path.split('.');
    for(const service of panel.services.filter(s=>s.name===serviceName)){
      const action=service.actions.find(a=>a.siid===service.siid&&a.name===actionName&&!a.unsupportedReason&&!a.in.length);
      if(action)return {service,action,inputs:[]};
    }
  }
}

const toiletProperties={
  lid:['function.open-lid','toilet-jomoo.cover-plate'],
  seat:['function.open-circle','toilet-jomoo.seat-ring'],
  eco:['function.eco','custom.eco','function.eco-smart','more-functions.auto-energy-saving'],
  light:['night-light.on','night-light.status-led','more-functions.night-light'],
  foam:['foam-shield.foam-shield','function.bubble-generating'],
  flush:interlocks.flushProperties,
  stop:['one-click-stop.one-click-stop'],
  ...interlocks.seatedProperties,
};
const toiletActions={
  lid:['function.cover-open-close','custom.toggle-cover','custom.fangai','changyong.fangai','toilet.flip-cover','smart-toilet.cover-work','seat-cover.cover-work'],
  seat:['function.ring-open-close','custom.toggle-circle','custom.fanquan','changyong.fanquan','toilet.flip-seat','smart-toilet.seat-work','seat-cover.seat-work'],
  eco:['toilet.eco','changyong.jieneng'],
  light:['custom.night-light','toilet.light','changyong.zhaoming'],
  foam:['function.bubble','function.foam-shield','custom.paopaowei','custom.toggle-froth','changyong.paopaopwei','deodorant-foam.start-foam'],
  flush:interlocks.flushActions,
  stop:['toilet.stop-working','toilet.stop','qingxi.tingzhi'],
  nozzleClean:['function.nozzle-selfclean','function.nozzle-cleaning','function.self-cleaning','toilet.self-clean','custom.zijie'],
  ...interlocks.seatedActions,
};
const toiletInputs=[
  'water-temp-t','water-strong-t','water-pos-t','moving-t','status-massage-t',
  'water-temp-w','water-strong-w','water-pos-w','moving-w','status-massage-w',
  'level-watertemp-t','level-waterflow-t','level-waterstrong-t','level-pos-t','switch-moving-t',
  'level-watertemp-w','level-waterflow-w','level-waterstrong-w','level-pos-w','switch-moving-w',
  'fen-temp','level-warmdry',
];
const actionToggleInputs:Partial<Record<ToiletRole,readonly string[]>>={
  lid:['status-cover'],seat:['status-seat'],foam:['switch-bubble','switch'],flush:['status-flush','switch-flush','flush-on'],
};
export const toiletLabels:Record<keyof typeof toiletActions,string>={
  lid:'开关坐盖',seat:'开关坐圈',eco:'节能',light:'夜灯',foam:'泡沫盾',dry:'暖风烘干',flush:'冲水',stop:'停止',
  rear:'臀洗清洁',front:'妇洗功能',child:'儿童清洗',auto:'自动清洗',move:'往复按摩',strong:'强弱按摩',massage:'冷热按摩',nozzleClean:'喷杆自洁',
};
export type ToiletRole=keyof typeof toiletLabels;
export const toiletCommon:readonly ToiletRole[]=['lid','seat','eco','foam','light','dry','flush','stop'];
export const toiletCleaning:readonly ToiletRole[]=['rear','front','child','auto','move','strong','massage','nozzleClean'];
export interface ToiletControl {role:ToiletRole; command?:BathroomCommand; selected?:boolean; blocked:boolean}
export const toiletStatuses:Partial<Record<ToiletRole,readonly string[]>>={
  rear:['assclean','tunwash','posteriorwash','臀洗'],front:['femaleclean','women','womenwash','妇洗'],
  dry:['drying','warmdry','烘干'],flush:['flushing','flush','冲水'],foam:['bubble','foam','泡沫盾'],
  nozzleClean:['clean','喷嘴自洁'],stop:['idle','idlestatus','standby','待机','空闲'],
};

function toiletAction(panel:DevicePanel,role:ToiletRole){
  for(const path of toiletActions[role]){
    const [serviceName,actionName]=path.split('.');
    for(const service of panel.services.filter(s=>s.name===serviceName)){
      const action=service.actions.find(a=>a.siid===service.siid&&a.name===actionName&&!a.unsupportedReason);
      if(!action||new Set(action.in).size!==action.in.length)continue;
      const inputs:Json[]=[];
      let ready=true;
      const parameters=action.in.map(i=>service.properties.find(p=>p.piid===i&&p.siid===service.siid));
      if(parameters.some(p=>!p||!bathroomReadable(p)))continue;
      for(const p of parameters as Property[]){
        const toggle=actionToggleInputs[role]?.includes(p.name)?bathroomToggle(p,true):undefined;
        if(!toggle&&!toiletInputs.includes(p.name)){ready=false;break;}
        if(!bathroomCurrentValid(p))continue;
        inputs.push(toggle?(role==='lid'||role==='seat')&&p.value===toggle.on?toggle.off:toggle.on:p.value!);
      }
      const toggle=(role==='lid'||role==='seat')&&parameters[0]&&bathroomToggle(parameters[0],true);
      if(ready)return {binding:inputs.length===action.in.length?{service,action,inputs}:undefined,
        selected:toggle&&bathroomCurrentValid(parameters[0]!)?parameters[0]!.value===toggle.on:undefined};
    }
  }
}

export function toiletControls(panel:DevicePanel):ToiletControl[] {
  const modes=propertiesFor(panel,['toilet.mode','toilet-jomoo.work-mode'],p=>bathroomWritable(p)&&validChoices(p));
  const seated=toiletSeated(panel);
  const flush=propertiesFor(panel,interlocks.flushStatus,bathroomReadable)[0];
  const flushState=bathroomChoice(flush);
  const flushReady=!flush||!!flushState&&bathroomChoiceKeys(flushState).includes('idle');
  const cover=propertiesFor(panel,['function.cover-ring-status','function.cover-circle-status'],bathroomReadable)[0];
  const coverChoice=bathroomChoice(cover);
  const coverState=coverChoice?bathroomChoiceKeys(coverChoice)[0]:undefined;
  const status=bathroomChoice(propertiesFor(panel,['toilet.status','toilet-jomoo.work-status'],bathroomReadable)[0]);
  return [...toiletCommon,...toiletCleaning].flatMap(role=>{
    const names=(toiletProperties as Partial<Record<ToiletRole,string[]>>)[role]??[];
    const setting=propertiesFor(panel,names,p=>bathroomWritable(p)&&!!bathroomToggle(p,p.name==='on'||p.name==='status-led'))[0];
    const states=setting&&bathroomToggle(setting,setting.name==='on'||setting.name==='status-led');
    const action=toiletAction(panel,role);
    const modeKeys=(interlocks.modes as Partial<Record<ToiletRole,string[]>>)[role];
    const mode=modes.find(p=>p.valueList!.some(c=>bathroomChoiceKeys(c).some(k=>modeKeys?.includes(k))));
    const option=mode?.valueList!.find(c=>bathroomChoiceKeys(c).some(k=>modeKeys?.includes(k)));
    // An idle option is a stop command only in a service which also exposes
    // an actual cleaning or drying program.
    const modeCommand=mode&&option&&(role!=='stop'||mode.valueList!.some(c=>bathroomChoiceKeys(c).some(k=>[...interlocks.modes.rear,...interlocks.modes.front,...interlocks.modes.dry].includes(k))));
    if(!setting&&!action&&!modeCommand)return [];
    const live=setting&&states&&bathroomCurrentValid(setting)?setting.value===states.on:undefined;
    const pulse=role==='flush'||role==='foam'||role==='stop';
    const command=action?.binding??(setting&&states&&live!==undefined&&(!pulse||!live)?{property:setting,value:pulse||!live?states.on:states.off}
      :modeCommand&&bathroomCurrentValid(mode)?{property:mode,value:option.value}:undefined);
    const selected=live??action?.selected??(mode&&option&&role!=='stop'&&isReadableValue(mode)?mode.value===option.value
      :role==='lid'&&coverState&&coverState!=='lose'?coverState!=='allclose':role==='seat'&&coverState&&coverState!=='lose'?coverState==='allopen':undefined);
    const needsSeat=Object.hasOwn(interlocks.seatedActions,role)||Object.hasOwn(interlocks.seatedProperties,role);
    const active=status&&role!=='stop'&&bathroomChoiceKeys(status).some(k=>toiletStatuses[role]?.includes(k));
    return [{role,command,selected:active||selected,blocked:needsSeat&&seated!==true||role==='flush'&&!flushReady}];
  });
}

const toiletGears:readonly [string,readonly string[]][]=[
  ['喷杆位置',['toilet.nozzle-position','gear-adjustment.lance-position']],
  ['水温调节',['function.water-temperature','gear-adjustment.water-temperature','toilet-jomoo.water-temperature','custom.water-temp']],
  ['水压调节',['toilet.washing-strength','gear-adjustment.water-pressure']],
  ['风温调节',['function.wind-temperature','gear-adjustment.temperature-of-wind','toilet-jomoo.wind-temperature','custom.wind-temperature','smart-toilet.level-warmdry','smart-toilet.fen-temp']],
  ['坐圈加热',['seat.heat-level','gear-adjustment.seat-temperature','toilet-jomoo.seat-temperature','smart-toilet.seat-temp','seat.seat-temp','custom.seat-temp','customer-service.seat-temperature']],
  ['臀洗位置',['smart-toilet.level-pos-t','smart-toilet.water-pos-t','toilet-jomoo.hip-nozzle-position']],
  ['臀洗水温',['smart-toilet.level-watertemp-t','smart-toilet.water-temp-t']],
  ['臀洗水压',['smart-toilet.level-waterflow-t','smart-toilet.level-waterstrong-t','smart-toilet.water-strong-t','toilet-jomoo.hip-water-gage']],
  ['妇洗位置',['smart-toilet.level-pos-w','smart-toilet.water-pos-w','toilet-jomoo.woman-nozzle-pos']],
  ['妇洗水温',['smart-toilet.level-watertemp-w','smart-toilet.water-temp-w']],
  ['妇洗水压',['smart-toilet.level-waterflow-w','smart-toilet.level-waterstrong-w','smart-toilet.water-strong-w','toilet-jomoo.woman-water-gage']],
];
// Two target-temperature properties can coexist on the same standard service.
// Bind by the published description only when it identifies the heated medium.
export function toiletSettings(panel:DevicePanel):{label:string;property:Property}[] {
  const generic=propertiesFor(panel,['toilet.target-temperature'],bathroomAdjustable);
  return toiletGears.flatMap(([label,paths])=>{
    const description=label==='水温调节'?/water[\s-]*temperature|水温/i:label==='风温调节'?/wind[\s-]*temperature|风温/i:label==='坐圈加热'?/seat[\s-]*temperature|座温|坐温/i:undefined;
    const property=propertiesFor(panel,paths,bathroomAdjustable)[0]??(description&&generic.find(p=>description.test(p.description)));
    return property?[{label,property}]:[];
  });
}

export function bathroomTemperature(panel:DevicePanel,path:string,writable=false):Property|undefined {
  return propertiesFor(panel,[path],p=>(writable?bathroomAdjustable(p):bathroomReadable(p))
    &&(p.unit==='celsius'||p.unit==='fahrenheit'||p.unit==='kelvin'||writable&&path==='towel-rack.target-temperature'&&(!p.unit||p.unit==='none')))[0];
}
export function bathroomBattery(panel:DevicePanel):Property|undefined {
  return propertiesFor(panel,['battery.battery-level','single-use-battery.battery-level'],p=>bathroomReadable(p)&&['percentage','percent'].includes(p.unit??''))[0];
}
