import {detailProperty,detailPropertyAt,detailServices} from './appliance-details';
import {curtainMotorValue,type CurtainCommand} from './curtain-detail';
import {capabilityCategory,validChoices,validRange} from './device-capabilities';
import {booleanValue,numericValue} from './panel-layout';
import type {DevicePanel,Property,Service} from './types';

const multiWindowModel = 'evecca.wopener.na03ma';

function writableProperty(service:Service,name:string):Property|undefined {
  const matches=service.properties.filter(property=>property.name===name);
  if(matches.length!==1)return;
  const property=detailPropertyAt(service,matches[0].piid,name);
  if(property?.access.includes('write'))return property;
}

function percent(property:Property|undefined):Property|undefined {
  if(property&&validRange(property)&&['percentage','percent'].includes(property.unit??'')
    &&property.valueRange![0]>=0&&property.valueRange![1]<=100)return property;
}

function rail(service:Service,channel?:string){
  const suffix=channel?`-${channel}`:'';
  const motor=writableProperty(service,'motor-control'+suffix);
  const target=percent(writableProperty(service,'target-position'+suffix));
  const position=percent(detailProperty(service,'current-position'+suffix));
  const online=channel?booleanValue(detailProperty(service,'online'+suffix))===true:true;
  return {siid:service.siid,channel,online,motor:motor&&validChoices(motor)?motor:undefined,
    target:target?.access.includes('read')?target:undefined,position,status:detailProperty(service,'status')};
}

export function windowOpenerRails(panel:DevicePanel|undefined,serviceId?:number|null){
  if(!panel||capabilityCategory(panel.specType)!=='window-opener')return [];
  const services=detailServices(panel).filter(service=>serviceId==null||service.siid===serviceId);
  if(panel.model===multiWindowModel)return services.flatMap(service=>{
    const channel=/^param-set-([a-d])$/.exec(service.name)?.[1];
    if(!channel)return [];
    const kind=detailProperty(service,`devicetype-${channel}`);
    const value=numericValue(kind);
    if(!kind||!validChoices(kind)||value===undefined||value===0||!kind.valueList!.some(choice=>choice.value===value))return [];
    return [rail(service,channel)];
  }).filter(binding=>binding.motor||binding.target||binding.position);
  const windowServices=services.filter(service=>service.name==='window-opener');
  if(windowServices.length!==1)return [];
  const binding=rail(windowServices[0]);
  return binding.motor||binding.target||binding.position?[binding]:[];
}

export function windowOpenerCommand(binding:ReturnType<typeof rail>,meaning:CurtainCommand){
  const {motor}=binding;
  const value=curtainMotorValue(motor,meaning);
  return motor&&value!==undefined?{property:motor,value}:undefined;
}

export function openingPositionReading(position:Property|undefined):number|undefined {
  const value=numericValue(position);
  const range=position?.valueRange;
  if(range&&value!==undefined&&value>=range[0]&&value<=range[1])return value;
}

export function openingPositionInput(
  target:Property|undefined,position:Property|undefined
):Property|undefined {
  if(!target||!position||target.pending)return target??position;
  const value=openingPositionReading(position);
  const [min,max,step]=target.valueRange!;
  if(value===undefined||value<min||value>max)return target;
  const index=(value-min)/step;
  return Math.abs(index-Math.round(index))<1e-7?position:target;
}
