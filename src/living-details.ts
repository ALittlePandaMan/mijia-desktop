import {detailProperty,detailPropertyAt,detailServices} from './appliance-details';
import {capabilityCategory,validChoices} from './device-capabilities';
import {booleanValue} from './panel-layout';
import type {DevicePanel,Property,Service} from './types';
import {adjustableWaterTemperature,powerSwitchBinding,waterTemperature} from './water-heating';

export type LivingCategory='mosquito-dispeller'|'mirror'|'electric-blanket'|'sofa';

const blanketZones:Record<string,readonly {siid:number;piid:number;name:string;label:string}[]>={
  'urn:miot-spec-v2:device:electric-blanket:0000A069:qushui-g3:1':[
    {siid:2,piid:4,name:'target-temperature',label:'上部目标温度'},
    {siid:2,piid:5,name:'target-temperature',label:'下部目标温度'},
  ],
  'urn:miot-spec-v2:device:electric-blanket:0000A069:jipin-snt1sk:1':[
    {siid:2,piid:4,name:'target-temperature',label:'左侧目标温度'},
    {siid:2,piid:5,name:'target-temperature',label:'右侧目标温度'},
  ],
  'urn:miot-spec-v2:device:electric-blanket:0000A069:miaomiaoce-d02:2':[
    {siid:2,piid:4,name:'target-temperature',label:'左侧目标温度'},
    {siid:4,piid:4,name:'target-temperature',label:'右侧目标温度'},
  ],
  'urn:miot-spec-v2:device:electric-blanket:0000A069:caih-z1a:1':[
    {siid:3,piid:3,name:'left-temperature',label:'脚部目标温度'},
    {siid:3,piid:4,name:'right-temperature',label:'背部目标温度'},
  ],
  'urn:miot-spec-v2:device:electric-blanket:0000A069:caih-1866:2':[
    {siid:3,piid:3,name:'left-temperature',label:'左侧目标温度'},
    {siid:3,piid:4,name:'right-temperature',label:'右侧目标温度'},
  ],
};

function onlyService(services:Service[],name:string):Service|undefined {
  const matches=services.filter(s=>s.name===name);
  if(matches.length===1)return matches[0];
}

export function simpleLivingBindings(panel:DevicePanel|undefined,category:Exclude<LivingCategory,'sofa'>) {
  const services=capabilityCategory(panel?.specType)===category?detailServices(panel):[];
  const powers:(NonNullable<ReturnType<typeof powerSwitchBinding>> & {label:string})[]=[];
  const temperatures:{property:Property;label:string}[]=[];
  const addPower=(property:Property|undefined,label:string)=>{
    const power=powerSwitchBinding(property);
    if(power?.property.access.includes('read'))powers.push({...power,label});
  };
  if(category==='mirror'){
    const light=onlyService(services,'light');
    addPower(light&&detailProperty(light,'on'),'灯光');
    return {powers,temperatures};
  }
  if(category==='mosquito-dispeller'){
    const primary=onlyService(services,category);
    const alternate=panel?.model==='kaenou.mosq.v1'&&
      panel.specType==='urn:miot-spec-v2:device:mosquito-dispeller:0000A065:kaenou-v1:1'
      ?services.find(s=>s.name==='function'&&s.siid===2):undefined;
    addPower(primary?detailProperty(primary,'on'):alternate&&detailPropertyAt(alternate,1,'on'),'电源');
    return {powers,temperatures};
  }
  const blankets=services.filter(s=>s.name===category);
  const remoteService=onlyService(services,'recommended-standard');
  const remote=remoteService&&detailProperty(remoteService,'remote-controllable');
  const remoteLocked=remote?.format==='bool'&&booleanValue(remote)!==true;
  const zones=Object.hasOwn(blanketZones,panel?.specType??'')?blanketZones[panel!.specType!]:[];
  const add=(p:Property|undefined,label:string)=>{
    const property=waterTemperature(p);
    if(property?.access.includes('read')&&adjustableWaterTemperature(property))temperatures.push({property,label});
  };
  for(const service of blankets){
    const regions=zones.filter(zone=>zone.siid===service.siid);
    if(regions.length)for(const zone of regions)add(detailPropertyAt(service,zone.piid,zone.name),zone.label);
    else if(blankets.length===1||zones.length)add(detailProperty(service,'target-temperature'),'目标温度');
  }
  const switches=blankets.flatMap(s=>{const p=detailProperty(s,'on');return p?.access.includes('write')?[p]:[];});
  if(switches.length===1)addPower(switches[0],'电源');
  else if(panel?.specType==='urn:miot-spec-v2:device:electric-blanket:0000A069:miaomiaoce-d02:2'){
    for(const property of switches){
      if(property.siid===2)addPower(property,'左侧电源');
      if(property.siid===4)addPower(property,'右侧电源');
    }
  }
  return {powers,temperatures,remoteLocked};
}

const massageSofaTypes=new Set([
  'urn:miot-spec-v2:device:sofa:0000A0A8:qushui-003:1',
  'urn:miot-spec-v2:device:sofa:0000A0A8:qushui-004:1',
  'urn:miot-spec-v2:device:sofa:0000A0A8:uehome-imi1:1',
]);

export function selectableSofaMode(description:string):boolean {
  const mode=description.trim();
  return !!mode&&!/^(invalid|none|schemaless|null)$/i.test(mode);
}

export function sofaMode(panel:DevicePanel|undefined):{property:Property;label:string}|undefined {
  if(!panel||capabilityCategory(panel.specType)!=='sofa')return;
  const service=onlyService(detailServices(panel),'sofa');
  if(!service)return;
  const massage=service.siid===2&&massageSofaTypes.has(panel.specType??'');
  // Those descriptors publish the motor and massage program under the same property name.
  const property=massage?detailPropertyAt(service,7,'mode'):detailProperty(service,'mode');
  if(property?.access.includes('read')&&validChoices(property)&&
    property.valueList!.some(choice=>selectableSofaMode(choice.description))){
    return {property,label:massage?'按摩模式':'模式'};
  }
}

export function clothesDryerPower(panel:DevicePanel) {
  if(capabilityCategory(panel.specType)!=='clothes-dryer')return;
  const service=onlyService(detailServices(panel),'clothes-dryer');
  if(!service)return;
  const property=detailProperty(service,'on')??
    (panel.model==='ym001.dryer.ymgyj'&&panel.specType==='urn:miot-spec-v2:device:clothes-dryer:0000A06D:ym001-ymgyj:1'&&service.siid===2
      ?detailProperty(service,'dryer'):undefined);
  return powerSwitchBinding(property);
}
