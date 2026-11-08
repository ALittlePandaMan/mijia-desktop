import type {Device,DevicePanel} from './types';
import {panelLayout,propertyReading,type PanelLayout} from './panel-layout';
import {capabilityBinding,resolveDeviceCapabilities} from './device-capabilities';
import {sensorReadingVisible} from './sensor-presentation';
import {cloudDoorbellProfile} from './camera-profiles';

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
/** Private snapshots affect readiness, never the visual route. */
export function presentationReady(device:Device|undefined,panel:DevicePanel|undefined):boolean{
 if(!device||!panel||panel.did!==device.did||panel.model!==device.model)return false;
 if(panel.unsupportedReason)return false;
 if(dedicatedPage(device.model)==='purifier')return !!panel.purifier;
 if(dedicatedPage(device.model)==='dispenser')return !!panel.dispenser;
 const capabilities=resolveDeviceCapabilities(panel);
 const visible=capabilities.properties.filter(p=>!['battery','battery-service','ble-battery'].includes(p.service)&&!p.name.includes('battery-level')&&sensorReadingVisible(capabilities.category,p.service,p.name));
 if(visible.length)return visible.some(p=>propertyReading(capabilityBinding(panel,p)).source!=='missing');
 // Actions with no readable state are legitimate; an empty descriptor is not.
 if(capabilities.actions.length||capabilities.events.length)return true;
 return panel.services.some(s=>!['device-information','battery','battery-service','ble-battery'].includes(s.name)&&s.properties.some(p=>!p.name.includes('battery-level')&&propertyReading(p).source!=='missing'));
}
/** Values, report timestamps and private snapshots never change this identity. */
export function presentationFingerprint(panel:DevicePanel):string{
 return JSON.stringify([PRESENTATION_VERSION,panel.model,panel.specType,panel.services.map(s=>[s.siid,s.name,
  s.properties.map(p=>[p.piid,p.name,p.format,p.unit,[...p.access].sort(),p.valueRange,p.valueList]),
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
