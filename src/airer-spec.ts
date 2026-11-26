import {airerModel,type AirerIntent} from './airer';
import {capabilityBinding, capabilityCategory, resolveDeviceCapabilities,validRange} from './device-capabilities';
import type {Device, DevicePanel, Json, Property} from './types';

type Choice = NonNullable<Property['valueList']>[number];
export type AirerPhase = AirerIntent | 'stopped' | 'top' | 'bottom' | 'blocked' | 'unknown';
export interface AirerRail {
  motor: Property;
  label: string;
  values: Partial<Record<AirerIntent, Json>>;
  status?: Property;
  phase: AirerPhase;
  position?: number;
  fault: 'normal' | 'active' | 'unknown';
}

export function airerPageEligible(device: Device | undefined, panel: DevicePanel | undefined): boolean {
  return !!device && !!panel && panel.did === device.did && panel.model === device.model
    && capabilityCategory(panel.specType) === 'airer' && !panel.unsupportedReason;
}

const key = (name: string) => name.trim().toLowerCase().replace(/[\s_-]+/g, '');
const live = (p?: Property) => p?.code === 0 && p.access.includes('read') ? p.value : undefined;
export const airerIntents = ['up','pause','down'] as const;
const wireNames: Record<AirerIntent, string[]> = {up:['up','raise'],pause:['pause','stop'],down:['down','lower']};

export function airerMotorValues(motor: Property): AirerRail['values'] {
  const choices = motor.valueList;
  if (!motor.access.includes('write') || motor.unsupportedReason || !['uint8','uint16','uint32','int8','int16','int32'].includes(motor.format)
    || !choices?.length || motor.valueRange || !choices.every(c=>typeof c.value==='number'&&Number.isSafeInteger(c.value))
    || new Set(choices.map(c=>c.value)).size !== choices.length) return {};
  const values: AirerRail['values'] = {};
  for (const intent of airerIntents) {
    const matching = choices.filter(choice => wireNames[intent].includes(key(choice.description)) && !/设限|校准/.test(choice.localizedDescription??''));
    const choice = matching.length === 1 ? matching[0] : intent === 'pause' && matching.length === 2
      && matching.some(choice => choice.value === 3) && choices.some(choice=>key(choice.description)==='upwhilesetlimit')
      ? matching.find(choice=>choice.value===0) : undefined;
    if (choice) values[intent] = choice.value;
  }
  return values;
}

const phaseNames: Record<string, AirerPhase> = {
  stop:'stopped', stopped:'stopped', idle:'stopped', normal:'stopped', other:'stopped',
  pause:'pause', paused:'pause', stopatmiddle:'pause', middle:'pause',
  up:'up', rise:'up', rising:'up', uping:'up', down:'down', lower:'down', dropping:'down', falling:'down', downing:'down', dowm:'down',
  top:'top', upper:'top', ceiling:'top', upperlimit:'top', upperlimitstop:'top', stopupperlimit:'top', stopathighest:'top', risefinish:'top', highest:'top',
  bottom:'bottom', lowerlimit:'bottom', floor:'bottom', lowerlimitstop:'bottom', stoplowerlimit:'bottom', stopatlowest:'bottom', downfinish:'bottom', lowest:'bottom',
  settingheight:'blocked', calibrating:'blocked', obstaclestop:'blocked', impede:'blocked', motorlock:'blocked', fault:'blocked', limitfault:'blocked', circuitfault:'blocked',
};

export function airerPhase(choice: Choice | undefined): AirerPhase {
  if (!choice) return 'unknown';
  const label=choice.localizedDescription?.trim()??'';
  if (/校准|设限|设置高度|遇阻|保护|故障|过载|超重/.test(label)) return 'blocked';
  if (/上限位|最高位|升到顶|上升完成/.test(label)) return 'top';
  if (/下限位|最低位|降到底|下降完成/.test(label)) return 'bottom';
  if (/^(正在)?(上升|升高)(中)?$/.test(label)) return 'up';
  if (/^(正在)?(下降|降低)(中)?$/.test(label)) return 'down';
  if (/^(暂停|已暂停|中间位停止|设备暂停|暂停中)$/.test(label)) return 'pause';
  const name=key(choice.description);
  if (Object.hasOwn(phaseNames,name)) return phaseNames[name];
  return /^(停止|已停止|待机)$/.test(label)?'stopped':'unknown';
}

function currentChoice(property?: Property): Choice | undefined {
  const value=live(property);
  return property?.valueList?.find(choice=>choice.value===value);
}

export function standardAirerRails(panel: DevicePanel): AirerRail[] {
  const rails: AirerRail[] = [];
  for (const service of panel.services.filter(service=>service.name==='airer'&&service.siid>0)) {
    if (panel.services.filter(s=>s.siid===service.siid).length!==1) continue;
    const property=(name:string)=>{
      const candidates=service.properties.filter(p=>p.name===name&&p.siid===service.siid&&p.piid>0&&!p.unsupportedReason);
      if(candidates.length===1&&service.properties.filter(p=>p.piid===candidates[0].piid).length===1)return candidates[0];
    };
    const motor=property('motor-control');
    if(!motor)continue;
    const values=airerMotorValues(motor);
    if(!Object.keys(values).length)continue;
    const status=property('status'), faultProperty=property('fault');
    const nightService=panel.model==='hyd.airer.1s1'&&service.siid===2?panel.services.filter(s=>s.siid===4&&s.name==='set-night-light'):[];
    const extendedPosition=nightService.length===1?nightService[0].properties.filter(p=>p.siid===4&&p.piid===11&&p.name==='current-position'&&!p.unsupportedReason):[];
    const positionProperty=extendedPosition.length===1?extendedPosition[0]:property('current-position');
    const declared = airerPhase(currentChoice(status)), positionPhase=airerPhase(currentChoice(positionProperty));
    const still = declared==='unknown'||declared==='stopped'||declared==='pause';
    const phase = still&&(positionPhase==='top'||positionPhase==='bottom')?positionPhase:declared;
    const rawPosition=live(positionProperty), range=positionProperty?.valueRange;
    const position=range?.[0]===0&&range[1]===100&&typeof rawPosition==='number'&&rawPosition>=0&&rawPosition<=100?rawPosition:undefined;
    const faultValue=live(faultProperty), faultLabel=currentChoice(faultProperty);
    const fault = !faultProperty ? 'normal' : faultValue===undefined||faultValue===null ? 'unknown'
      : faultLabel ? /^(nofaults?|normal|faultfree|none|ok|upperlimit|lowerlimit)$/.test(key(faultLabel.description)) || /^(无故障|正常|无|上限位|下限位)$/.test(faultLabel.localizedDescription?.trim()??'') ? 'normal' : 'active'
      : faultValue===0 ? 'normal':'active';
    const index=/\b(?:airer|rod|rail)\s*([12])\s*$/i.exec(service.description)?.[1]??/晾[衣]?杆\s*([12])\s*$/.exec(service.description)?.[1];
    rails.push({motor,values,status,phase,position,fault,label:index?`晾杆 ${index}`:'晾杆'});
  }
  const individual=rails.filter(rail=>rail.label!=='晾杆');
  return individual.length>1 ? individual.sort((a,b)=>a.label.localeCompare(b.label)) : rails;
}

export function airerPositionTarget(panel:DevicePanel,siid:number):Property|undefined {
  const dedicated=[airerModel,'hyd.airer.1s1'].includes(panel.model);
  if(dedicated&&siid!==2)return;
  const rail=panel.services.filter(s=>s.siid===siid);
  if(rail.length!==1||rail[0].name!=='airer')return;
  const source=dedicated?panel.services.filter(s=>s.siid===4):rail;
  if(source.length!==1||dedicated&&source[0].name!=='set-night-light')return;
  const targets=source[0].properties.filter(p=>p.name===(dedicated?'set-position':'target-position'));
  const property=targets[0];
  if(targets.length!==1||property.siid!==source[0].siid||property.piid<=0||dedicated&&property.piid!==9||
    source[0].properties.filter(p=>p.piid===property.piid).length!==1||property.unsupportedReason||
    property.format!=='uint8'||!['percentage','percent'].includes(property.unit??'')||!property.access.includes('read')||
    !property.access.includes('write')||!validRange(property)||/限位|校准|起始位置|终止位置|limit|calibrat/i.test(property.description))return;
  const [min,max,step]=property.valueRange!;
  if(min<0||max>100||![min,max,step].every(Number.isInteger))return;
  if(!dedicated)return property;
  const bound=(piid:number,name:string,format:string)=>{
    const rows=source[0].properties.filter(p=>p.piid===piid);
    const p=rows[0];
    return rows.length===1&&p.siid===4&&p.name===name&&p.format===format?live(p):undefined;
  };
  const upper=bound(7,'upper-limit','int8'),lower=bound(8,'lower-limit','uint8');
  if(typeof upper!=='number'||typeof lower!=='number'||!Number.isInteger(upper)||!Number.isInteger(lower)||
    upper<min||upper>49||lower<51||lower>max||(upper-min)%step!==0||(lower-min)%step!==0)return;
  return {...property,valueRange:[upper,lower,step]};
}

export function standardAirerLight(panel: DevicePanel): {power?:Property;brightness?:Property} {
  const caps=resolveDeviceCapabilities(panel);
  const binding=(role:string,kinds:string[])=>{
    const candidates=caps.properties.filter(p=>p.role===role&&kinds.includes(p.kind));
    return candidates.length===1?capabilityBinding(panel,candidates[0]):undefined;
  };
  let power=binding('light.on',['power']);
  if(!power&&['hyd.airer.lyjpro','mrbond.airer.m2','viomi.airer.ich110'].includes(panel.model)){
    const service=panel.services.filter(s=>s.siid===3&&s.name==='light');
    const properties=service.length===1?service[0].properties.filter(p=>p.siid===3&&p.piid===1):[];
    const target=properties.length===1&&properties[0];
    if(target&&target.name==='on'&&!target.unsupportedReason&&target.access.includes('read')&&target.access.includes('write')
      &&(target.format==='bool'||panel.model==='mrbond.airer.m2'&&target.format==='uint8'&&target.valueRange?.join() === '0,1,1'))power=target;
  }
  const brightness=binding('light.brightness',['enum','range']);
  if(power||brightness)return {power,brightness:!power||power.siid===brightness?.siid?brightness:undefined};
  const builtin=binding('airer.on',['power']);
  return {power:builtin&&/light|light(ing)? switch|照明|灯光/i.test(builtin.description)?builtin:undefined};
}

export function airerRailAllows(rail: AirerRail, intent: AirerIntent): boolean {
  if (rail.values[intent]===undefined) return false;
  if (intent==='pause') return true;
  return rail.fault==='normal'&&rail.phase!=='blocked';
}

export function previewAirerStatus(rail: AirerRail, phase: AirerPhase): Json | undefined {
  return rail.status?.valueList?.find(choice=>airerPhase(choice)===phase)?.value;
}
