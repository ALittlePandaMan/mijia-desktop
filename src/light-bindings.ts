import {capabilityCategory,validRange} from './device-capabilities';
import type {DevicePanel,Property,Service} from './types';

/** A packed RGB value needs the actual descriptor. */
export function rgbPropertyReason(property: Property | undefined): string | undefined {
  if (!property) return '此设备未提供 RGB 颜色属性。';
  if (property.unsupportedReason) return property.unsupportedReason;
  const range = property.valueRange;
  if (property.name !== 'color' || property.format !== 'uint32' || property.unit !== 'rgb' || property.valueList != null || !range || range.length !== 3 || range[0] !== 0 || range[1] !== 0xffffff || range[2] !== 1) return '此颜色编码或范围尚未适配。';
  return undefined;
}

function serviceProperty(service:Service,name:string):Property|undefined {
  const matches=service.properties.filter(p=>p.name===name);
  const property=matches[0];
  return matches.length===1&&property.siid===service.siid&&positiveId(property.piid)&&
    service.properties.filter(p=>p.piid===property.piid).length===1&&
    !property.unsupportedReason&&property.access.includes('read')?property:undefined;
}

function positiveId(id:number):boolean {
  return Number.isInteger(id)&&id>0&&id<=0xffffffff;
}

function uniqueServices(panel:DevicePanel|undefined):Service[] {
  if(!panel||panel.unsupportedReason)return [];
  return panel.services.filter(s=>positiveId(s.siid)&&panel.services.filter(item=>item.siid===s.siid).length===1);
}

function power(service:Service):Property|undefined {
  const on=serviceProperty(service,'on');
  return on?.format==='bool'&&!on.valueList&&!on.valueRange?on:undefined;
}

export function lightingCategory(type:string|null|undefined):boolean {
  return ['light','night-light','ceiling-fan'].includes(capabilityCategory(type)??'');
}

export function lightChannelBindings(panel:DevicePanel|undefined,type=panel?.specType) {
  if(!lightingCategory(type))return [];
  return uniqueServices(panel).filter(s=>s.name==='light'||(s.name==='night-light'&&capabilityCategory(type)==='night-light')).map(service=>{
    const brightness=serviceProperty(service,'brightness');
    const temperature=serviceProperty(service,'color-temperature');
    const color=serviceProperty(service,'color');
    return {
      service,
      on:power(service),
      brightness:brightness&&validRange(brightness)&&
        (brightness.unit==null||['percentage','percent'].includes(brightness.unit))?brightness:undefined,
      temperature:temperature?.unit==='kelvin'&&validRange(temperature)?temperature:undefined,
      color:rgbPropertyReason(color)?undefined:color,
      mode:serviceProperty(service,'mode'),
    };
  }).filter(({on,brightness,temperature,color})=>[on,brightness,temperature,color].some(p=>p?.access.includes('write')));
}

export function fanLightPower(panel:DevicePanel|undefined):Property|undefined {
  const services=uniqueServices(panel);
  for(const name of ['ceiling-fan','fan']){
    const candidates=services.filter(service=>service.name===name);
    if(candidates.length!==1)continue;
    const on=power(candidates[0]);
    if(on?.access.includes('write'))return on;
  }
}
