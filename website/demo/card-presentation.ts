import {curtainBindings} from './desktop/src/curtain-detail';
import {capabilityCategory,validRange} from './desktop/src/device-capabilities';
import {lightChannelBindings} from './desktop/src/light-bindings';
import {booleanValue,climateBindings,climateChoiceIndex,isReadableValue,numericValue} from './desktop/src/panel-layout';
import type {CardControl,Device,DevicePanel,HomeCardPresentation,Property} from './desktop/src/types';

function rangeControl(property:Property|undefined,appearance:NonNullable<CardControl['appearance']>,label:string,unit:string,available:boolean):CardControl|undefined{
  if(!property?.access.includes('write')||!property.access.includes('read')||!validRange(property))return;
  const id=`${property.siid}:${property.piid}`;
  const [min,max,step]=property.valueRange!;
  const value=numericValue(property);
  const hasValue=value!==undefined&&Number.isFinite(value);
  return {
    id,fieldId:id,appearance,kind:appearance==='temperature'?'stepper':'slider',label,
    value:hasValue?value:null,enabled:available&&hasValue,
    reason:null,options:[],range:{min,max,step,unit},
  };
}

/** Adapt the demo's simulated properties for the shared desktop card renderer. */
export function demoCardPresentation(device:Device,panel:DevicePanel):HomeCardPresentation|undefined{
  const category=capabilityCategory(panel.specType);
  const available=device.online&&!device.sharedReadOnly;
  let adjustment:CardControl|undefined;
  let power:CardControl|undefined;

  if(category==='curtain'){
    const bindings=curtainBindings(panel,device.controlServiceId);
    adjustment=rangeControl(bindings?.target,'curtain-position','目标位置','%',available);
    if(adjustment)adjustment.curtainOpening=bindings?.opening;
  }else if(category==='light'||category==='air-conditioner'){
    const channels=category==='light'?lightChannelBindings(panel).filter(channel=>device.controlServiceId==null||channel.service.siid===device.controlServiceId):[];
    const light=channels.length===1?channels[0]:undefined;
    const climate=category==='air-conditioner'?climateBindings(panel,undefined,device.controlServiceId):undefined;
    const on=light?.on??climate?.on;
    if(!on?.access.includes('write'))return;
    const id=`${on.siid}:${on.piid}`,onValue=booleanValue(on);
    power={id,fieldId:id,kind:'toggle',label:'电源',value:onValue??null,enabled:available&&onValue!==undefined,reason:null,options:[],range:null};
    const enabled=available&&onValue===true;
    if(light){
      adjustment=rangeControl(light.brightness,light.color?'rgb-brightness':'white-brightness','亮度','%',enabled);
    }else if(climate){
      const mode=climate.mode;
      const selectedMode=isReadableValue(mode)?mode.valueList?.find(choice=>choice.value===mode.value):undefined;
      const temperatureAllowed=!mode||(selectedMode!==undefined&&climateChoiceIndex(selectedMode,'mode')!==2);
      adjustment=rangeControl(climate.target,'temperature','目标温度','℃',enabled&&temperatureAllowed);
    }
  }
  if(!adjustment)return;
  return {
    did:device.did,templateId:'demo-desktop-'+category,revision:1,
    headerControl:power?.id??null,rows:[[adjustment.id]],controls:power?[power,adjustment]:[adjustment],
  };
}
