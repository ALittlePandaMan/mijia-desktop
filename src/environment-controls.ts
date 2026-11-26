import {detailProperty,detailPropertyAt,detailServices,matchingPanel} from './appliance-details';
import {capabilityCategory,validChoices,validRange} from './device-capabilities';
import type {Device,DevicePanel,Property,Service} from './types';
import {powerSwitchBinding} from './water-heating';

const simpleCategories = ['humidifier','heater','fresh-air','diffuser','dehumidifier','thermostat'] as const;
export type SimpleClimateCategory = typeof simpleCategories[number];
type EnvironmentCategory = SimpleClimateCategory | 'air-conditioner' | 'air-condition-outlet' | 'air-purifier' | 'fan';

const modelCategories: Record<string, EnvironmentCategory> = {
  aircondition:'air-conditioner', airc:'air-conditioner', acpartner:'air-condition-outlet',
  airp:'air-purifier', airpurifier:'air-purifier',
  fan:'fan', humidifier:'humidifier', heater:'heater', airfresh:'fresh-air',
  diffuser:'diffuser', derh:'dehumidifier', airrtc:'thermostat',
};

export function environmentCategory(device: Device, panel?: DevicePanel): EnvironmentCategory | undefined {
  const category=capabilityCategory(matchingPanel(device,panel)?.specType??device.specType);
  const family=device.model.split('.')[1];
  if(category==='air-conditioner'&&family==='airrtc')return 'thermostat';
  if(category==='air-conditioner'&&family==='acpartner')return 'air-condition-outlet';
  if(category==='ventilator')return 'fresh-air';
  if(category==='air-conditioner'||category==='air-condition-outlet'||category==='air-purifier'||category==='fan'||simpleClimateCategory(category))return category;
  if(!category&&Object.hasOwn(modelCategories,family))return modelCategories[family];
}

export function simpleClimateCategory(category: string | undefined): category is SimpleClimateCategory {
  return (simpleCategories as readonly string[]).includes(category??'');
}

function writable(property: Property | undefined): property is Property {
  return !!property&&property.access.includes('read')&&property.access.includes('write');
}

function power(property: Property | undefined): Property | undefined {
  if(writable(property)&&property.format==='bool'&&!property.valueList&&!property.valueRange)return property;
}

function setting(property: Property | undefined, kind: 'enum' | 'number'): Property | undefined {
  if(!writable(property))return;
  if(kind==='enum'&&validChoices(property))return property;
  if(kind==='number'&&(validRange(property)||validChoices(property)&&property.valueList!.length>1&&
    property.valueList!.every(v=>typeof v.value==='number')))return property;
}

function singleService(services: readonly Service[], names: readonly string[]): Service | undefined {
  const matches=services.filter(s=>names.includes(s.name));
  if(matches.length===1)return matches[0];
}

function property(service: Service | undefined, name: string): Property | undefined {
  return service&&detailProperty(service,name);
}

function speed(service: Service | undefined, kind: 'range' | 'enum', names: readonly string[]): Property | undefined {
  if(!service)return;
  for(const name of names){
    const matches=service.properties.filter(p=>p.name===name&&(kind==='range'?validRange(p):validChoices(p)));
    if(matches.length!==1)continue;
    const field=detailPropertyAt(service,matches[0].piid,name);
    if(setting(field,'number'))return field;
  }
}

const speedNames=['fan-level','speed-level'];
function fanSpeed(service: Service | undefined): Property | undefined {
  return speed(service,'enum',speedNames)??speed(service,'range',speedNames);
}

export function airPurifierBindings(device:Device,panel:DevicePanel){
  const services=detailServices(matchingPanel(device,panel));
  const main=singleService(services.filter(s=>device.controlServiceId==null||s.siid===device.controlServiceId),['air-purifier']);
  if(!main)return;
  const auxiliary=device.controlServiceId==null?singleService(services,['fan-control']):undefined;
  const names=['stepless-fan-level','fan-level','fan-speed','speed-level'];
  const direct=speed(main,'range',names)??speed(auxiliary,'range',names)??speed(main,'enum',names)??speed(auxiliary,'enum',names);
  const favorite=device.controlServiceId==null?singleService(services,['air-purifier-favorite']):undefined;
  const favoriteNames=['favorite-fan-level','fan-level'];
  const fan=direct??speed(favorite,'range',favoriteNames)??speed(favorite,'enum',favoriteNames);
  const special=(names:readonly string[])=>{
    for(const name of names){
      const toggle=powerSwitchBinding(property(main,name)??property(auxiliary,name));
      if(toggle)return toggle;
    }
    if(device.controlServiceId!=null)return;
    const service=singleService(services,names);
    return powerSwitchBinding(property(service,'on')??property(service,service?.name??''));
  };
  return {on:powerSwitchBinding(property(main,'on')),fan,mode:setting(property(main,'mode'),'enum'),
    favorite:!!fan&&!direct,uv:special(['uv','uv-sterilization','ultraviolet']),
    anion:special(['anion','negative-ion','anion-generator']),plasma:special(['plasma'])};
}

const heatingSettings=(property: Property)=>['celsius','fahrenheit','kelvin'].includes(property.unit??'');
const humiditySettings=(property: Property)=>['percentage','percent'].includes(property.unit??'');

/** Bind only the requested settings of the primary appliance, never a
 * similarly named switch, heater, or humidifier on an auxiliary service. */
export function simpleClimateBindings(device: Device, panel: DevicePanel, category: SimpleClimateCategory) {
  const services=detailServices(matchingPanel(device,panel)).filter(s=>device.controlServiceId==null||s.siid===device.controlServiceId);
  const names=category==='fresh-air'?['air-fresh','fresh-air','ventilator']:[category];
  if(category==='thermostat'&&capabilityCategory(panel.specType)==='air-conditioner')names.push('air-conditioner');
  const main=singleService(services,names);
  const f=category==='thermostat'&&device.controlServiceId==null?singleService(services,['fan-control']):undefined;
  const temperature=category==='heater'||category==='thermostat';
  const humidity=category==='humidifier'||category==='dehumidifier';
  let on=power(property(main,'on'));
  let target=temperature?setting(property(main,'target-temperature'),'number'):humidity?setting(property(main,'target-humidity'),'number'):undefined;
  let fan=category==='heater'||category==='diffuser'?undefined:fanSpeed(main)??fanSpeed(f);
  // This thermostat's primary on/temperature/speed share a service with
  // independently controlled floor heating and fresh air.
  if(panel.specType==='urn:miot-spec-v2:device:thermostat:0000A031:cnhdm-wkq01:1'&&main?.siid===2){
    on=power(detailPropertyAt(main,3,'on'));
    target=setting(detailPropertyAt(main,5,'target-temperature'),'number');
    fan=setting(detailPropertyAt(main,2,'fan-level'),'number');
  }
  if(panel.specType==='urn:miot-spec-v2:device:diffuser:0000A01E:svamm1-aroma1:1'&&main?.siid===2)
    on=power(detailPropertyAt(main,1,'on'));
  if(target&&!(temperature?heatingSettings(target):humiditySettings(target)))target=undefined;
  const mode=category==='heater'?undefined:setting(property(main,'mode'),'enum');
  return {on,target,mode,fan};
}

const fanPowerAliases: Record<string, string> = {
  'urn:miot-spec-v2:device:fan:0000A005:gswl-x1sfb:1':'fan',
  'urn:miot-spec-v2:device:fan:0000A005:gswl-v1sfz1:1':'fan',
  'urn:miot-spec-v2:device:fan:0000A005:gswl-fsx1:1':'function',
  'urn:miot-spec-v2:device:fan:0000A005:laiex-lesfs:1':'function',
  'urn:miot-spec-v2:device:fan:0000A005:amdq-amfs:1':'function',
  'urn:miot-spec-v2:device:fan:0000A005:fungu-nkbds1:1':'function',
};

export function fanDetailBindings(device: Device, panel: DevicePanel) {
  const all=detailServices(matchingPanel(device,panel));
  const services=all.filter(s=>device.controlServiceId==null||s.siid===device.controlServiceId);
  const main=singleService(services,['fan']);
  const auxiliary=main&&device.controlServiceId==null?singleService(services,['fan-control']):undefined;
  const environment=device.controlServiceId==null?singleService(services,['environment']):undefined;
  const spec=panel.specType??'';
  const alias=Object.hasOwn(fanPowerAliases,spec)?singleService(services,[fanPowerAliases[spec]]):undefined;
  const on=power(property(main,'on'))??(alias?.siid===2?power(detailPropertyAt(alias,1,'switch')):undefined);
  const mode=setting(property(main,'mode'),'enum');
  const gear=speed(main,'enum',speedNames)??speed(auxiliary,'enum',speedNames);
  const rangeNames=['stepless-fan-level',...speedNames];
  const continuous=speed(main,'range',rangeNames)??speed(auxiliary,'range',rangeNames);
  const horizontal=power(property(main,'horizontal-swing'))??power(property(auxiliary,'horizontal-swing'));
  const vertical=power(property(main,'vertical-swing'))??power(property(auxiliary,'vertical-swing'));
  const angle=(swing: Property | undefined,direction: 'horizontal' | 'vertical')=>{
    const service=swing&&services.find(s=>s.siid===swing.siid);
    const included=property(service,direction+'-swing-included-angle'), direct=property(service,direction+'-angle');
    return setting(included,'enum')??setting(direct,'enum')
      ??[included,direct].find(field=>writable(field)&&validRange(field));
  };
  const humidity=property(environment,'relative-humidity');
  const temperature=property(environment,'temperature');
  return {on,mode,gear,continuous,horizontal,vertical,horizontalAngle:angle(horizontal,'horizontal'),
    verticalAngle:angle(vertical,'vertical'),humidity:humidity&&humiditySettings(humidity)?humidity:undefined,
    temperature:temperature&&temperature.unit==='celsius'?temperature:undefined};
}
