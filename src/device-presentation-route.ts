import type {Device,DevicePanel} from './types';
import {panelLayout,propertyReading,type PanelLayout} from './panel-layout';
import {capabilityBinding,capabilityCategory,resolveDeviceCapabilities} from './device-capabilities';
import {sensorReadingVisible} from './sensor-presentation';
import {cloudDoorbellProfile} from './camera-profiles';
import {vacuumPageEligible} from './vacuum-spec';
import {airerPageEligible} from './airer-spec';
import {batteryOnlyCleaner} from './cleaner-battery';
import {securityCategory} from './security-readings';
import {bathroomCategory} from './bathroom';
import {televisionPageEligible} from './television';
import {applianceDetailCategory,simpleLivingDetail,specializedKitchenDetail} from './appliance-details';
import {audioDetailEligible} from './speaker';
import {environmentCategory} from './environment-controls';

export const PRESENTATION_VERSION=4;
const dedicated:Record<string,string>={
 'xiaomi.waterpuri.lx32':'purifier','xiaomi.ysj.gxj':'dispenser',
 'xiaomi.fryer.maf16':'fryer',
 'midjd8.washer.42':'washer','midjd.fridge.f01':'fridge','hyd.airer.1s':'airer','xiaomi.router.rn02':'router',
 'dmaker.fan.p28':'fan','xiaomi.fan.p69':'fan-p69','mijia.light.group3':'light-group',
 'yeelink.light.wyra01':'light','xiaomi.curtain.acn009':'curtain','lemesh.airc.b27m':'air-conditioner','linp.switch.e2db3':'switch',
 'yeelink.bhf_light.v13':'bath-heater',
 'yeelink.ven_fan.vf3':'ceiling-fan',
 'madv.cateye.mi3iot':'doorbell-cloud',
};
export function dedicatedPage(model:string):string|undefined{return cloudDoorbellProfile(model)?'doorbell-cloud':Object.hasOwn(dedicated,model)?dedicated[model]:undefined;}
export function washerPageEligible(device:Device|undefined,panel:DevicePanel|undefined):boolean{
 return !!device&&!!panel&&device.did===panel.did&&device.model===panel.model&&!panel.unsupportedReason
  &&(dedicatedPage(device.model)==='washer'||['washer','dryer','clothes-dryer'].includes(capabilityCategory(panel.specType)??''));
}
/** Private snapshots affect readiness, never the visual route. */
export function presentationReady(device:Device|undefined,panel:DevicePanel|undefined):boolean{
 if(!device||!panel||panel.did!==device.did||panel.model!==device.model)return false;
 if(panel.unsupportedReason)return false;
 if(dedicatedPage(device.model)==='purifier')return !!panel.purifier;
 const appliance=applianceDetailCategory(device,panel);
 if(['card-switch','water-purifier','fridge','curtain'].includes(appliance??'')||simpleLivingDetail(appliance))return true;
 if(dedicatedPage(device.model)==='dispenser'||audioDetailEligible(device,panel))return true;
 if(environmentCategory(device,panel))return true;
 if(specializedKitchenDetail(appliance))return true;
 if(televisionPageEligible(device,panel)||bathroomCategory(device,panel)||batteryOnlyCleaner(device)||securityCategory(device)||washerPageEligible(device,panel)||vacuumPageEligible(device,panel)||airerPageEligible(device,panel))return true;
 const capabilities=resolveDeviceCapabilities(panel);
 const visible=capabilities.properties.filter(p=>!['battery','battery-service','ble-battery'].includes(p.service)&&!p.name.includes('battery-level')&&sensorReadingVisible(capabilities.category,p.service,p.name));
 if(visible.length)return visible.some(p=>propertyReading(capabilityBinding(panel,p)).source!=='missing');
 // Actions with no readable state are legitimate; an empty descriptor is not.
 if(capabilities.actions.length||capabilities.events.length)return true;
 return panel.services.some(s=>!['device-information','battery','battery-service','ble-battery'].includes(s.name)&&s.properties.some(p=>!p.name.includes('battery-level')&&propertyReading(p).source!=='missing'));
}
/** Values, report timestamps, localized labels and private snapshots never change this identity. */
export function presentationFingerprint(panel:DevicePanel):string{
 return JSON.stringify([PRESENTATION_VERSION,panel.model,panel.specType,panel.services.map(s=>[s.siid,s.name,
  s.properties.map(p=>[p.piid,p.name,p.format,p.unit,[...p.access].sort(),p.valueRange,p.valueList?.map(option=>[option.value,option.description])]),
  s.actions.map(a=>[a.aiid,a.name,a.in,a.out]),(s.events??[]).map(e=>[e.eiid,e.name,e.arguments])])]);
}
export class DevicePresentationRoute{
 private key='';private selected:PanelLayout|undefined;private fingerprint='';changed=false;
 reset():void{this.key='';this.selected=undefined;this.fingerprint='';this.changed=false;}
 choose(device:Device|undefined,panel?:DevicePanel):PanelLayout{
  if(!device)return'generic';
  const key=JSON.stringify([device.did,device.model]);if(key!==this.key){this.reset();this.key=key;}
  if(panel&&panel.did===device.did&&panel.model===device.model&&!panel.unsupportedReason&&panel.services.length>0){
   const fingerprint=presentationFingerprint(panel);
   if(!this.selected){this.selected=panelLayout(device,panel);this.fingerprint=fingerprint;}
   else if(fingerprint!==this.fingerprint)this.changed=true;
  }
  return this.selected??'generic';
 }
}
