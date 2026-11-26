import {detailProperty,detailServices} from './appliance-details';
import {validChoices,validRange} from './device-capabilities';
import type {DevicePanel,Property,Service} from './types';

const namedZones:Record<string,string>={
  'refrigerating-chamber':'冷藏室','refrigerating-room':'冷藏室',
  'freezing-chamber':'冷冻室','freezing-room':'冷冻室',
};
const chamberLabels:Array<[RegExp,string]>=[
  [/maternal|母婴/i,'母婴室'],[/refrigerat|冷藏/i,'冷藏室'],
  [/freez|冷冻/i,'冷冻室'],[/change|variabl|变温/i,'变温室'],[/fridge|冰箱/i,'冰箱室'],
];

function celsius(p:Property|undefined):Property|undefined {
  // Published chamber descriptors can omit unit on the standard temperature
  // properties. The range or enum still comes from that particular instance.
  if(p&&(!p.unit||p.unit==='celsius')&&/^(u?int(8|16|32|64)|float|double)$/.test(p.format))return p;
}

function readableMode(service:Service):Property|undefined {
  const p=detailProperty(service,'mode');
  if(p&&p.access.includes('write')&&validChoices(p))return p;
}

export function standardFridge(panel:DevicePanel|undefined){
  const services=detailServices(panel);
  const appliances=services.filter(s=>s.name==='fridge'||s.name==='refrigerator');
  const mode=appliances.length===1?readableMode(appliances[0]):undefined;
  const zones=services.filter(s=>s.name==='fridge-chamber'||Object.hasOwn(namedZones,s.name)).map(service=>{
    const label=namedZones[service.name]??chamberLabels.find(([pattern])=>pattern.test(service.description))?.[1]??'温区';
    const candidate=celsius(detailProperty(service,'target-temperature'));
    const target=candidate&&(validRange(candidate)||validChoices(candidate))?candidate:undefined;
    return {label,siid:service.siid,target,temperature:celsius(detailProperty(service,'temperature')),mode:readableMode(service)};
  }).filter(zone=>zone.target||zone.temperature||zone.mode);
  const zoneRank=(label:string)=>label==='冷藏室'?0:label==='冷冻室'?1:2;
  zones.sort((a,b)=>zoneRank(a.label)-zoneRank(b.label)||a.siid-b.siid);
  return {mode,zones:zones.map(zone=>{
    const same=zones.filter(z=>z.label===zone.label);
    return same.length>1?{...zone,label:`${zone.label} ${same.indexOf(zone)+1}`}:zone;
  })};
}
