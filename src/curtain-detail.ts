import {detailProperty,detailPropertyAt,detailServices} from './appliance-details';
import {capabilityCategory,validChoices,validRange} from './device-capabilities';
import {isReadableValue,numericValue} from './panel-layout';
import type {CurtainOpening,DevicePanel,Json,Property} from './types';
import openingSpec from './curtain-opening.json';

export type CurtainCommand='open'|'pause'|'close';
const openingOrder=Object.keys(openingSpec.choices) as CurtainOpening[];
export const curtainOpeningLabels:Record<CurtainOpening,string>={'single-left':'左单开','single-right':'右单开',double:'双开'};

export function curtainOpeningChoices(property:Property|undefined){
  if(!property||!validChoices(property))return [];
  const aliases:Partial<Record<string,CurtainOpening>>=property.name==='curtain-yangshi'
    ? openingSpec.propertyChoices['curtain-yangshi'] as Record<string,CurtainOpening> : {};
  return property.valueList!.flatMap(choice=>{
    for(const label of [choice.localizedDescription,choice.description]){
      const name=label?.toLowerCase().replace(/[\s_-]/g,'');
      if(!name)continue;
      const opening=openingOrder.find(mode=>openingSpec.choices[mode].includes(name))??(Object.hasOwn(aliases,name)?aliases[name]:undefined);
      if(opening)return [{choice,opening}];
    }
    return [];
  }).sort((a,b)=>openingOrder.indexOf(a.opening)-openingOrder.indexOf(b.opening));
}

function curtainOpeningProperty(panel:DevicePanel|undefined,serviceId:number):Property|undefined{
  const services=detailServices(panel);
  const curtains=services.filter(s=>s.name==='curtain');
  // Auxiliary settings are device-wide. Require an unambiguous curtain to use them.
  const candidates=services.filter(s=>s.siid===serviceId||curtains.length===1&&s.name!=='curtain')
    .flatMap(s=>openingSpec.properties.map(name=>detailProperty(s,name)))
    .filter((p):p is Property=>!!p&&curtainOpeningChoices(p).length>0);
  return candidates.length===1?candidates[0]:undefined;
}

const commands:Record<CurtainCommand,RegExp>={
  open:/^(open|打开|开启)$/i,pause:/^(pause|stop|暂停|停止)$/i,close:/^(close|关闭)$/i,
};
const states:Record<CurtainCommand,RegExp>={
  open:/^(opening|正在打开|打开中|开启中)$/i,
  pause:/^(paused?|stop(?:ped)?|idle|已暂停|已停止|暂停|停止|静止)$/i,
  close:/^(closing|正在关闭|关闭中)$/i,
};

function matchingChoice(property:Property|undefined,pattern:RegExp):Json|undefined {
  if(!property||!validChoices(property))return;
  const choices=property.valueList!.filter(choice=>[choice.description,choice.localizedDescription].some(label=>pattern.test(label?.trim()??'')));
  if(choices.length===1)return choices[0].value;
}

export function curtainBindings(panel?:DevicePanel,serviceId?:number|null) {
  const services=capabilityCategory(panel?.specType)==='curtain'?detailServices(panel):[];
  const primary=services.filter(s=>s.name==='curtain'&&(serviceId==null||s.siid===serviceId));
  // The primary curtain service precedes the secondary drape in multi-drape specs.
  const service=primary.find(s=>s.siid===2)??(primary.length===1?primary[0]:undefined);
  if(!service)return;
  const percent=(property:Property|undefined)=>property&&['percentage','percent'].includes(property.unit??'')&&validRange(property)
    &&property.valueRange![0]>=0&&property.valueRange![1]<=100?property:undefined;
  const position=percent(detailProperty(service,'current-position'));
  const targets=service.properties.filter(p=>p.name==='target-position');
  const desired=targets.length===1?percent(detailPropertyAt(service,targets[0].piid,'target-position')):undefined;
  // A write-only target can use the current position as its live feedback.
  const target=desired&&(desired.access.includes('read')||desired.access.includes('write')&&position
    &&desired.valueRange!.every((value,index)=>value===position.valueRange![index]))?desired:undefined;
  const status=detailProperty(service,'status');
  const journey=detailProperty(service,'whole-journey-time');
  const motors=service.properties.filter(p=>p.name==='motor-control');
  const motor=motors.length===1?detailPropertyAt(service,motors[0].piid,'motor-control'):undefined;
  const openingProperty=curtainOpeningProperty(panel,service.siid);
  const opening=isReadableValue(openingProperty)?curtainOpeningChoices(openingProperty).find(({choice})=>choice.value===openingProperty.value)?.opening:undefined;
  return {position,target,status,journey,motor,openingProperty,opening:opening??'double' as const};
}

export function curtainStatus(status:Property|undefined):number|undefined {
  if(!isReadableValue(status))return;
  if(status.value===matchingChoice(status,states.open))return 1;
  if(status.value===matchingChoice(status,states.close))return 2;
  if(status.value===matchingChoice(status,states.pause))return 3;
}

export function curtainExplicitlyPaused(status:Property|undefined):boolean {
  return isReadableValue(status)&&status.value===matchingChoice(status,/^(paused?|已暂停|暂停)$/i);
}

export function curtainJourney(journey:Property|undefined):number|undefined {
  if(journey?.unit==='seconds')return numericValue(journey);
}

export function curtainFeedback(bindings:NonNullable<ReturnType<typeof curtainBindings>>,meaning:CurtainCommand) {
  const {status,position}=bindings;
  const state=matchingChoice(status,states[meaning]);
  if(status&&state!==undefined)return {property:status,value:state};
  const end=meaning==='open'?100:0;
  if(meaning!=='pause'&&position&&position.valueRange?.[meaning==='open'?1:0]===end)return {property:position,value:end};
}

export function curtainMotorMeaning(motor:Property,desired:Json):CurtainCommand|undefined {
  return (Object.keys(commands) as CurtainCommand[]).find(meaning=>matchingChoice(motor,commands[meaning])===desired);
}

export function curtainCommand(bindings:ReturnType<typeof curtainBindings>,meaning:CurtainCommand) {
  if(!bindings)return;
  const {target,motor}=bindings;
  const end=meaning==='open'?100:0;
  if(meaning!=='pause'&&target?.access.includes('write')&&target.valueRange?.[meaning==='open'?1:0]===end){
    return {property:target,value:end};
  }
  const value=matchingChoice(motor,commands[meaning]);
  if(motor?.access.includes('write')&&value!==undefined&&(motor.access.includes('read')||curtainFeedback(bindings,meaning))){
    return {property:motor,value};
  }
}
