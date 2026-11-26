import policy from './cooking-policy.json';
import {detailProperty,detailServices} from './appliance-details';
import {capabilityCategory,validChoices,validRange} from './device-capabilities';
import {deviceModeLabel} from './device-labels';
import {isReadableValue,numericValue} from './panel-layout';
import type {Action,DevicePanel,Json,Property,Service} from './types';
import {coercePropertyInput} from './logic';

const fryerCategories=['air-fryer','multifunction-cooking-pot','electric-steamer'] as const;
type FryerCategory=typeof fryerCategories[number];
export type CookingCategory='cooker'|'pressure-cooker'|FryerCategory;
export type CookingPhase='ready'|'cooking'|'warming'|'scheduled'|'paused';
export interface CookingCommand{action:Action;inputs:Json[];kind:'start'|'stop'|'resume'|'pause'|'reserve';mode?:Json}
export type CookingView={mode:Json}|{task:true}|undefined;

export function fryerStyleCategory(category:string|undefined):category is FryerCategory {
  return (fryerCategories as readonly string[]).includes(category??'');
}

export function cookingCategory(type:string|null|undefined):CookingCategory|undefined {
  const category=capabilityCategory(type);
  if(category==='cooker'||category==='pressure-cooker'||fryerStyleCategory(category))return category;
}

const key=(label:string)=>label.toLowerCase().trim().replace(/[\s_-]+/g,'');
const phases:CookingPhase[]=['ready','cooking','warming','scheduled','paused'];
function choice(property:Property|undefined){
  return isReadableValue(property)?property.valueList?.find(v=>v.value===property.value):undefined;
}

export function cookingPhase(option:Pick<NonNullable<Property['valueList']>[number],'description'|'localizedDescription'>|undefined,standard=false):CookingPhase|undefined {
  if(!option)return;
  const labels=[key(option.description),key(option.localizedDescription??'')];
  return phases.find(phase=>labels.some(label=>policy[phase].includes(label)||standard&&(policy.standardFryer[phase] as readonly string[]).includes(label)));
}

function serviceFor(panel:DevicePanel):Service|undefined {
  const category=cookingCategory(panel.specType);
  const matches=detailServices(panel).filter(service=>service.name===category);
  if(matches.length===1)return matches[0];
}

function actionFor(service:Service,name:string):Action|undefined {
  const matches=service.actions.filter(action=>action.name===name);
  const action=matches[0];
  if(matches.length===1&&action.siid===service.siid&&Number.isSafeInteger(action.aiid)&&action.aiid>0&&
    !action.unsupportedReason&&service.actions.filter(a=>a.aiid===action.aiid).length===1)return action;
}

function readyToHeat(panel:DevicePanel,service:Service):boolean {
  const fault=detailProperty(service,'fault');
  if(service.properties.some(p=>p.name==='fault')&&(!isReadableValue(fault)||
    (fault.valueList?!['nofault','nofaults','无故障'].some(label=>[choice(fault)?.description,choice(fault)?.localizedDescription].some(text=>text!=null&&key(text)===label)):fault.value!==0)))return false;
  const locked=detailServices(panel).filter(s=>s.name==='physical-controls-locked')
    .flatMap(s=>s.properties.filter(p=>['current-physical-control-lock','physical-controls-locked'].includes(p.name)&&p.access.includes('read')));
  if(locked.some(p=>!isReadableValue(p)||p.value!==false))return false;
  if(fryerStyleCategory(service.name)){
    for(const name of ['door-state','lid-status','pan-status']){
      if(!service.properties.some(p=>p.name===name))continue;
      const state=choice(detailProperty(service,name));
      if(!state||![state.description,state.localizedDescription].some(label=>label!=null&&['closed','close','closedinplace','已关闭','关闭','已合盖'].includes(key(label))))return false;
    }
  }
  if(service.name!=='pressure-cooker')return true;
  const lid=Object.hasOwn(policy.pressureLids,panel.model)?policy.pressureLids[panel.model as keyof typeof policy.pressureLids]:undefined;
  if(!lid||lid.specType!==panel.specType)return false;
  const lidService=detailServices(panel).find(s=>s.siid===lid.siid&&s.name===lid.service);
  const lidState=lidService&&detailProperty(lidService,lid.property);
  return isReadableValue(lidState)&&lidState.piid===lid.piid&&lidState.value===lid.closed;
}

const modeLabels:Record<string,string>={finecook:'精煮饭',quickcook:'快煮饭',cookcongee:'煮粥',keepwarm:'保温',
  soup:'煲汤',multigrainrice:'杂粮饭',rice:'煮饭',steam:'蒸煮',stew:'炖煮',claypotrice:'煲仔饭',
  redmeat:'牛羊肉',poultry:'禽肉',tendons:'豆类／蹄筋',reheat:'热饭',hotmeal:'热饭',custom:'自定义烹饪'};

const fryerLabels:Record<string,string>={...modeLabels,manual:'自定义',optional:'自选',boiled:'烧水',convection:'热风循环',
  lambchops:'羊排',fish:'鱼',chicken:'整鸡',tart:'蛋挞',sausage:'香肠',peanut:'花生',yogurt:'酸奶',
  hotpot:'火锅',barbecue:'烧烤',panfry:'煎炒',steamboil:'蒸煮',beefsteak:'牛排',porridge:'煮粥',noodles:'煮面',
  customizerecipe:'自定义食谱',reservation:'预约',afcustom:'自定义空炸',stmcustom:'自定义蒸煮'};

function namedMode(option:NonNullable<Property['valueList']>[number],labels:Record<string,string>):CookingMode[]{
  const meaning=key(option.description);
  const label=deviceModeLabel(option.localizedDescription,labels[meaning],option.description);
  return label&&label!=='无'&&!/^(none|null|unselected|off)$/.test(meaning)?[{value:option.value,meaning,label}]:[];
}

interface CookingMode { value:Json;label:string;meaning:string }
interface CookingPanelView {
  modes:CookingMode[];phase?:CookingPhase;active:boolean;selected?:CookingMode;
  remaining?:number;total?:number;temperature?:number;
  modeSetting?:Property;target?:Property;duration?:Property;warm?:Property;
  start:(value:Json)=>CookingCommand|undefined;stop?:CookingCommand;resume?:CookingCommand;pause?:CookingCommand;
  programMinutes?:(value:Json)=>number|undefined;
  reservation?:CookingReservation;
}

interface CookingReservation {
  mode:Json;
  cookingMinutes:number;
  ventingMinutes:number;
  limitMinutes:number;
  schedulable:boolean;
  available:boolean;
  command:(finishInMinutes:number)=>CookingCommand|undefined;
}

function timeInMinutes(property:Property|undefined){
  const value=numericValue(property);
  if(value!=null&&Number.isFinite(value)&&value>=0)return property?.unit==='minutes'?value:property?.unit==='seconds'?value/60:undefined;
}

function setting(property:Property|undefined){
  if(property?.access.includes('write')&&(validRange(property)||validChoices(property)))return property;
}

function argument(property:Property,value:Json):boolean {
  if(value===null)return false;
  const index=property.valueList?.findIndex(entry=>entry.value===value);
  try{return coercePropertyInput(property,String(index??value))===value;}catch{return false;}
}

const reservationSpecs:Readonly<Record<string,string>>=policy.recipeReservations;

export function cookingReservationModel(panel:DevicePanel):boolean {
  return Object.hasOwn(reservationSpecs,panel.model)&&panel.specType===reservationSpecs[panel.model];
}

function recipeBytes(value:Json|undefined):Uint8Array|undefined {
  if(typeof value!=='string'||!(/^[0-9a-f]{364}$/i.test(value)))return;
  return Uint8Array.from(value.match(/../g)!,pair=>Number.parseInt(pair,16));
}

export function cookingReservationMinutes(value:Json|undefined):number|undefined {
  const bytes=recipeBytes(value);
  if(bytes)return (bytes[14]&0x7f)*60+bytes[15]+bytes[28];
}

function recipeChecksum(bytes:Uint8Array):number {
  let crc=0;
  for(const byte of bytes.subarray(0,-2)){
    crc^=byte<<8;
    for(let bit=0;bit<8;bit++)crc=((crc<<1)^(crc&0x8000?0x1021:0))&0xffff;
  }
  return crc;
}

function reported(service:Service,name:string,piid:number):Json|undefined {
  const property=detailProperty(service,name);
  if(isReadableValue(property)&&property.piid===piid)return property.value;
}

function recipeReservation(panel:DevicePanel,service:Service,mode:CookingMode,ready:boolean):CookingReservation|undefined {
  // The manufacturer's cmby plug-ins carry the completion delay in the recipe
  // action. Bind it to the device-reported official recipe for this mode.
  if(!cookingReservationModel(panel)||service.siid!==2||
    reported(service,'recipe-type',13)!==0)return;
  const action=actionFor(service,'start-recipe-cook');
  if(action?.aiid!==4||action.in.length!==2||action.in[0]!==15||action.in[1]!==17)return;
  const source=recipeBytes(reported(service,'recipe-command',15));
  const id=reported(service,'recipe-id',12),name=reported(service,'recipe-name',17);
  if(!source||typeof id!=='string'||!(/^(?:0x)?[0-9a-f]{1,8}$/i.test(id))||
    new DataView(source.buffer).getUint32(3)!==Number.parseInt(id,16)||Number.parseInt(id,16)===0||
    recipeChecksum(source)!==((source.at(-2)!<<8)|source.at(-1)!))return;
  if(typeof name!=='string'||name.length>256||!(/^(?:[0-9a-f]{2})+$/i.test(name)))return;
  try{
    const title=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(name.match(/../g)!,pair=>Number.parseInt(pair,16)));
    if(title!==mode.label)return;
  }catch{return;}
  if(source[9]>59)return;
  const cookingMinutes=source[8]*60+source[9],ventingMinutes=source[28];
  if(!cookingMinutes)return;
  const limitMinutes=policy.recipeReservationLimitMinutes;
  const remote=detailServices(panel).find(section=>section.siid===8&&section.name==='recommended-standard');
  const lid=reported(service,'temperature',19);
  const schedulable=!!(source[7]&0x40)&&cookingMinutes+ventingMinutes<limitMinutes;
  const available=schedulable&&ready&&typeof lid==='number'&&Number.isInteger(lid)&&lid>=0&&lid<=10&&
    (lid<6||lid>8)&&!!remote&&reported(remote,'remote-controllable',1)===true;
  return {mode:mode.value,cookingMinutes,ventingMinutes,limitMinutes,schedulable,available,command:finishInMinutes=>{
    if(!available||!Number.isInteger(finishInMinutes)||finishInMinutes<=cookingMinutes+ventingMinutes||finishInMinutes>limitMinutes)return;
    const minutes=finishInMinutes-ventingMinutes,bytes=source.slice();
    bytes[14]=0x80|Math.floor(minutes/60);
    bytes[15]=minutes%60;
    const checksum=recipeChecksum(bytes);
    bytes[bytes.length-2]=checksum>>8;
    bytes[bytes.length-1]=checksum&0xff;
    return {kind:'reserve',action,inputs:[Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join(''),name]};
  }};
}

function standardFryerPanel(panel:DevicePanel,service:Service):CookingPanelView {
  const get=(name:string)=>detailProperty(service,name);
  const rawMode=get('mode')??get('cook-mode');
  const mode=rawMode&&validChoices(rawMode)?rawMode:undefined;
  const modeSetting=setting(mode);
  const target=setting(get('target-temperature'));
  const duration=setting(get('target-time'));
  const warm=get('auto-keep-warm');
  const temperature=target?.unit==='celsius'?target:undefined;
  const time=duration&&['minutes','seconds'].includes(duration.unit??'')?duration:undefined;
  const start=actionFor(service,'start-cook');
  const named=mode?.valueList?.flatMap(option=>namedMode(option,fryerLabels))??[];
  const modes=named.length?named:temperature||time||start?[{value:null,label:mode?'当前程序':'自定义烹饪',meaning:'manual'}]:[];
  const reportedMode=choice(mode);
  const selected=mode?modes.find(item=>item.value===reportedMode?.value):undefined;
  const phase=cookingPhase(choice(get('status')),true);
  const active=phase!==undefined&&phase!=='ready';
  const canHeat=(phase==='ready'||phase==='paused')&&readyToHeat(panel,service);
  const action=(kind:CookingCommand['kind'],name:string,allowed:boolean)=>{
    const binding=allowed&&actionFor(service,name);
    return binding&&binding.in.length===0?{kind,action:binding,inputs:[]}:undefined;
  };
  const args=[mode,temperature,time,setting(get('heat-level'))].filter((field):field is Property=>!!field);
  return {modes,phase,active,selected,remaining:timeInMinutes(get('left-time')),total:timeInMinutes(duration),
    temperature:get('temperature')?.unit==='celsius'?numericValue(get('temperature')):undefined,modeSetting,target:temperature,duration:time,
    warm:warm?.format==='bool'&&warm.access.includes('write')&&!warm.valueList&&!warm.valueRange?warm:undefined,
    start:value=>{
      if(phase!=='ready'||!canHeat||!start||!modes.some(item=>item.value===value))return;
      if(mode&&named.length&&!start.in.includes(mode.piid)&&selected?.value!==value)return;
      const inputs:Json[]=[];
      for(const id of start.in){
        const field=args.find(property=>property.piid===id);
        if(!field)return;
        const chosen=field===mode?value:isReadableValue(field)?field.value:null;
        if(!argument(field,chosen))return;
        inputs.push(chosen);
      }
      return {kind:'start',action:start,inputs,mode:value};
    },
    stop:action('stop','cancel-cooking',active),pause:action('pause','pause',phase==='cooking'),
    resume:action('resume','resume-cook',phase==='paused'&&canHeat),
  };
}

export function cookingPanel(panel:DevicePanel|undefined):CookingPanelView|undefined {
  const service=panel&&serviceFor(panel);
  if(!service||!panel)return;
  if(fryerStyleCategory(service.name))return standardFryerPanel(panel,service);
  const start=actionFor(service,'start-cook');
  const candidates=service.properties.filter(p=>p.name==='cook-mode'&&p.siid===service.siid&&
    Number.isSafeInteger(p.piid)&&p.piid>0&&service.properties.filter(q=>q.piid===p.piid).length===1&&!p.unsupportedReason&&validChoices(p));
  const input=start?.in.length===1?candidates.find(p=>p.piid===start.in[0]):undefined;
  const mode=input??(candidates.length===1?candidates[0]:undefined);
  const modes=mode?.valueList?.flatMap(item=>namedMode(item,modeLabels))??[];
  const status=detailProperty(service,'status');
  const phase=cookingPhase(choice(status));
  const active=phase!==undefined&&phase!=='ready';
  const liveMode=detailProperty(service,'cook-mode');
  const currentMode=choice(liveMode);
  const selected=currentMode?modes.find(m=>m.value===currentMode.value):undefined;
  const canHeat=(phase==='ready'||phase==='paused')&&readyToHeat(panel,service);
  const cancel=actionFor(service,'cancel-cooking'),resume=actionFor(service,'resume-cook');
  const pause=actionFor(service,'pause');
  const reservation=selected&&recipeReservation(panel,service,selected,phase==='ready'&&canHeat);
  const timing=(name:string)=>{
    const primary=detailProperty(service,name);
    if(primary)return timeInMinutes(primary);
    const extra=detailServices(panel).filter(s=>s.name==='custom-property'||s.name==='custom')
      .flatMap(s=>detailProperty(s,name)??[]);
    if(extra.length===1)return timeInMinutes(extra[0]);
  };
  const temperature=detailProperty(service,'temperature');
  const targetTime=detailProperty(service,'target-time');
  const exactTargetTime=panel.model==='xiaomi.cooker.cmc301'&&
    panel.specType==='urn:miot-spec-v2:device:cooker:0000A00B:xiaomi-cmc301:1:0000D06B'&&service.siid===2&&targetTime?.piid===20?targetTime:undefined;
  const total=timing('cook-total-time')??timeInMinutes(exactTargetTime);
  return {modes,phase,active,selected,remaining:(phase==='scheduled'?timing('reservation-left-time'):undefined)??timing('left-time'),total,
    temperature:temperature?.unit==='celsius'?numericValue(temperature):undefined,reservation,
    programMinutes:value=>phase==='ready'&&!liveMode?.pending&&selected?.value===value?(reservation?.cookingMinutes??total):undefined,
    modeSetting:start?.in.length===0&&canHeat?setting(liveMode):undefined,
    start: (value:Json):CookingCommand|undefined=>{
      if(phase!=='ready'||!canHeat||!start||!modes.some(m=>m.value===value))return;
      if(input)return {kind:'start',action:start,inputs:[value],mode:value};
      if(!start.in.length&&selected?.value===value)return {kind:'start',action:start,inputs:[],mode:value};
    },
    stop:active&&cancel?.in.length===0?{kind:'stop',action:cancel,inputs:[]} as CookingCommand:undefined,
    pause:phase==='cooking'&&pause?.in.length===0?{kind:'pause',action:pause,inputs:[]} as CookingCommand:undefined,
    resume:phase==='paused'&&canHeat&&resume?.in.length===0?{kind:'resume',action:resume,inputs:[]} as CookingCommand:undefined,
  };
}

export function cookingCommandAllowed(panel:DevicePanel,command:CookingCommand):boolean {
  const state=cookingPanel(panel);
  if(!state)return false;
  if(command.kind==='reserve'){
    const booking=state.reservation,minutes=cookingReservationMinutes(command.inputs[0]);
    if(!booking||minutes===undefined)return false;
    const expected=booking.command(minutes);
    return expected?.action.siid===command.action.siid&&expected.action.aiid===command.action.aiid&&
      JSON.stringify(expected.inputs)===JSON.stringify(command.inputs);
  }
  const expected=command.kind==='start'?state.modes.filter(mode=>command.mode===undefined||mode.value===command.mode).map(mode=>state.start(mode.value)):[state[command.kind]];
  return expected.some(item=>item&&item.action.siid===command.action.siid&&item.action.aiid===command.action.aiid&&
    JSON.stringify(item.inputs)===JSON.stringify(command.inputs));
}
