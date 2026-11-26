import {capabilityCategory,validChoices,validRange} from './device-capabilities';
import {detailProperty,detailServices} from './appliance-details';
import type {DevicePanel,Json,Property} from './types';

export type WaterHeatingCategory='kettle'|'health-pot'|'water-dispenser'|'teabar';

const numeric=(p:Property)=>/^(u?int(8|16|32|64)|float|double)$/.test(p.format);
export function waterTemperature(p:Property|undefined):Property|undefined {
  if(p&&numeric(p)&&p.unit==='celsius')return p;
}

export function powerSwitchBinding(p:Property|undefined):{property:Property;values?:readonly [Json,Json]}|undefined {
  if(!p?.access.includes('write'))return;
  if(p.format==='bool'&&!p.valueList&&!p.valueRange)return {property:p};
  if(!validChoices(p)||p.valueList?.length!==2)return;
  const find=(pattern:RegExp)=>p.valueList?.find(option=>pattern.test(option.description.trim())||pattern.test(option.localizedDescription?.trim()??''));
  const off=find(/^(off|close|power[ -]?off|关|关闭|关机)$/i),on=find(/^(on|open|power[ -]?on|开|开启|开机)$/i);
  if(off&&on&&off.value!==on.value)return {property:p,values:[off.value,on.value]};
}

export function waterHeatingBindings(panel:DevicePanel|undefined,category:WaterHeatingCategory) {
  const services=capabilityCategory(panel?.specType)===category?detailServices(panel):[];
  const primary=services.filter(s=>s.name===category);
  const service=primary.length===1?primary[0]:undefined;
  const get=(name:string)=>service&&detailProperty(service,name);
  const target=waterTemperature(get(category==='teabar'?'boiling-point':'target-temperature'));
  if(category==='water-dispenser')return {target};
  let warm=waterTemperature(get('keep-warm-temperature'));
  if(!warm&&panel?.model==='xiaomi.kettle.mek21'&&panel.specType==='urn:miot-spec-v2:device:kettle:0000A009:xiaomi-mek21:3'){
    const verified=service?.properties.filter(p=>p.name==='keep-warm-temperature'&&p.piid===29&&p.siid===service.siid&&p.access.includes('read')&&!p.unsupportedReason);
    if(verified?.length===1&&service?.properties.filter(p=>p.piid===29).length===1)warm=waterTemperature(verified[0]);
  }
  const mode=category==='health-pot'?get('mode'):category==='teabar'?get('cook-mode'):undefined;
  const current=category==='teabar'?waterTemperature(get('temperature')):undefined;
  if(category==='health-pot'&&panel?.model==='viomi.health_pot.c2'){
    const custom=services.filter(s=>s.name==='custom-keep-warm');
    if(custom.length===1)warm??=waterTemperature(detailProperty(custom[0],'keep-warm'));
  }
  const soaking=category==='health-pot'&&panel?.model==='xiaomi.health_pot.p1pro'?services.filter(s=>s.name==='custom'):undefined;
  return {power:powerSwitchBinding(get('on')),target,warm,current,mode:mode&&mode.access.includes('write')&&validChoices(mode)?mode:undefined,
    soaking:soaking?.length===1?waterTemperature(detailProperty(soaking[0],'soaking-temperature')):undefined};
}

export function adjustableWaterTemperature(property:Property):boolean {
  return property.access.includes('write')&&(validRange(property)||
    validChoices(property)&&property.valueList!.every(option=>typeof option.value==='number'));
}
