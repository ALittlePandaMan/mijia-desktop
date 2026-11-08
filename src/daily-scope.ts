import type {Action,DevicePanel,Property,Service} from './types';
import {miotCategory} from './panel-layout';
import {hasCapabilityCategory,resolveDeviceCapabilities} from './device-capabilities';
import type {RouterView} from './router';
import {sensorReadingVisible} from './sensor-presentation';
import {deviceServiceLabel} from './device-labels';

export function desktopScheduleField(service:string,name:string):boolean{return /(?:^|-)(?:timer|delay|countdown|schedule)(?:-|$)/i.test(service)||/(?:^|-)(?:off-delay|on-delay|delay|countdown|timer|schedule)(?:-|$)/i.test(name);}
function lightModeProperty(name:string):boolean{return name==='mode'||name.endsWith('-mode');}
export function desktopHiddenProperty(category:string|null|undefined,name:string):boolean{return category==='outlet'&&['physical-controls-locked','child-lock'].includes(name);}

/** Presentation choices keep the original descriptor available to compound controls. */
export function desktopHiddenPropertyKeys(panel:DevicePanel):ReadonlySet<string>{
  const hidden=new Set<string>(),capabilities=resolveDeviceCapabilities(panel);
  const speedNames=['fan-level','speed-level','stepless-fan-level'];
  for(const service of panel.services){
    const hasGear=service.name==='fan'&&capabilities.properties.some(b=>b.siid===service.siid&&b.service==='fan'&&b.kind==='enum'&&speedNames.includes(b.name));
    for(const property of service.properties){
      const lighting=service.name==='light'||capabilities.category==='light'&&!['fan','ceiling-fan'].includes(service.name);
      if((hasGear&&speedNames.includes(property.name)&&!property.valueList?.length)||(lighting&&lightModeProperty(property.name)))hidden.add(`${property.siid}.${property.piid}`);
    }
  }
  return hidden;
}

/** Product scope, separate from protocol support and write permissions. */
export function dailyRouterView(view:RouterView):RouterView {
  const pages=['home','clients','client','optimize','speed'];
  return pages.includes(view.page)?{...view,tab:view.tab==='filter'?'online':view.tab}:{page:'home',tab:'online'};
}
const readings=new Set(['status','fault','temperature','relative-humidity','illumination','battery-level','charging-state','tds-in','tds-out','filter-life-level','filter-used-time','pm2.5-density','pm10-density','co2-density','air-quality','electric-current','voltage','electric-power','power-consumption','weight','bmi','body-fat-rate','water-level','remaining-time','current-position']);
const excludedServices=new Set(['memory-card-management','nas','p2p-stream','camera-ipc-cloud','self-check','user-management','message-router','ble-control','sensor-config','ble-conn','syncinfo','share-cancel']);
const sensorReadings:Record<string,string[]>={
  'occupancy-sensor':['occupancy-status','has-someone-duration','no-one-duration'],
  'magnet-sensor':['contact-state'],
  'gas-sensor':['gas-concentration'],
  'air-fryer':['left-time'],
  'play-control':['playing-state'],
};
const controls:Record<string,string[]>={
  light:['on','brightness','color-temperature','color','rgb','mode'],
  fan:['on','mode','fan-level','speed-level','horizontal-swing','vertical-swing','horizontal-angle','vertical-angle','off-delay-time'],
  'ceiling-fan':['on','mode','fan-level','speed-level','horizontal-swing','vertical-swing','off-delay-time'],
  'air-conditioner':['on','mode','target-temperature','fan-level','vertical-swing','horizontal-swing'],
  'air-purifier':['on','mode','fan-level','favorite-level','child-lock','buzzer'],
  humidifier:['on','mode','target-humidity','fan-level','child-lock'],
  dehumidifier:['on','mode','target-humidity','fan-level','child-lock'],
  ventilator:['on','mode','fan-level'],
  'fresh-air':['on','mode','fan-level'],
  curtain:['motor-control','target-position'],
  vacuum:['on','mode','sweep-mode','suction-state','water-level'],
  television:['on','volume','mute'],
  speaker:['volume','mute'],
  projector:['input-control','volume','mute'],
  'air-fryer':['mode','target-time','target-temperature','auto-keep-warm'],
};
export function dailyProperty(category:string|undefined,service:Service,property:Property):boolean {
  if(desktopScheduleField(service.name,property.name))return false;
  if(category==='switch')return service.name==='switch'&&property.name==='on';
  if(excludedServices.has(service.name)||category==='speaker'&&service.name==='clock')return false;
  if(category==='camera')return service.name==='camera-control'&&(property.name==='on'||['status','fault'].includes(property.name)&&property.access.includes('read')&&!property.access.includes('write'))||service.name==='battery'&&property.name==='battery-level';
  if(property.access.includes('read')&&!property.access.includes('write')&&sensorReadings[service.name]?.includes(property.name))return true;
  if(['ceiling-fan','bath-heater'].includes(category??'')&&service.name==='light')return controls.light.includes(property.name);
  if(category==='bath-heater'&&service.name==='ptc-bath-heater')return ['mode','blow','heating','ventilation','heat-level','target-temperature','off-delay','off-delay-time'].includes(property.name);
  if(category==='outlet')return ['outlet','switch'].includes(service.name)&&property.name==='on'||service.name==='physical-controls-locked'&&property.name==='physical-controls-locked'||property.access.includes('read')&&!property.access.includes('write')&&readings.has(property.name);
  if(property.access.includes('read')&&!property.access.includes('write')&&readings.has(property.name))return true;
  if(service.name==='battery')return ['battery-level','charging-state'].includes(property.name);
  if(service.name==='physical-controls-locked')return property.name==='physical-controls-locked';
  return !!category&&!!controls[category]?.includes(property.name)&&[category,'light','fan','speaker'].includes(service.name);
}
export function dailyAction(category:string|undefined,service:Service,action:Action):boolean {
  if(action.in.length)return false;
  if(category==='curtain'&&service.name==='curtain')return ['open','close','pause'].includes(action.name);
  if(category==='vacuum'&&['vacuum','battery'].includes(service.name))return ['start-sweep','stop-sweeping','pause-sweeping','start-charge'].includes(action.name);
  if(category==='television'&&service.name==='television')return action.name==='turn-off';
  if(category==='speaker'&&service.name==='play-control')return ['play','pause','next','previous'].includes(action.name);
  if(category==='projector')return service.name==='projector'&&action.name==='turn-off'||service.name==='play-control'&&['play','pause'].includes(action.name);
  if(category==='bath-heater'&&service.name==='ptc-bath-heater')return action.name==='stop-working';
  if(category==='air-fryer'&&service.name==='air-fryer')return ['start-cook','cancel-cooking','pause','resume-cook'].includes(action.name);
  return false;
}
/** User-facing names for the retained parameterless commands; protocol IDs stay intact. */
export function dailyActionLabel(category:string|undefined,service:Service,action:Action):string|undefined {
  if(!dailyAction(category,service,action))return undefined;
  const labels:Record<string,string>={'turn-on':'开机','turn-off':'关机','volume-up':'音量＋','volume-down':'音量－','channel-up':'下一频道','channel-down':'上一频道','mute-on':'静音','mute-off':'取消静音','start-sweep':'开始清扫','stop-sweeping':'停止清扫','pause-sweeping':'暂停清扫','start-charge':'回充','play':'播放','pause':'暂停','next':'下一首','previous':'上一首','open':'打开','close':'关闭','stop-working':'停止','start-cook':'开始烹饪','cancel-cooking':'取消烹饪','resume-cook':'继续烹饪'};
  return labels[action.name];
}
export function dailyPanel(panel:DevicePanel):DevicePanel {
  const category=miotCategory(panel.specType);
  const capabilities=resolveDeviceCapabilities(panel);
  const known=hasCapabilityCategory(capabilities.category);
  const allowedProperties=new Set(capabilities.properties.map(property=>`${property.siid}.${property.piid}`));
  const allowedActions=new Set(capabilities.actions.map(action=>`${action.siid}.${action.aiid}`));
  const hidden=desktopHiddenPropertyKeys(panel);
  return {...panel,services:panel.services.map(service=>({...service,
    description:service.name==='ir-tv-control'?'电视遥控':service.name==='ir-stb-control'?'机顶盒遥控':deviceServiceLabel(service),
    properties:service.properties.filter(property=>!hidden.has(`${property.siid}.${property.piid}`)&&!desktopHiddenProperty(category,property.name)&&!desktopScheduleField(service.name,property.name)&&sensorReadingVisible(category,service.name,property.name)&&(known?allowedProperties.has(`${property.siid}.${property.piid}`):dailyProperty(category,service,property))),
    actions:service.actions.filter(action=>!desktopScheduleField(service.name,action.name)&&(known?allowedActions.has(`${action.siid}.${action.aiid}`):dailyAction(category,service,action))).map(action=>({...action,description:dailyActionLabel(category,service,action)??action.description})),
  })).filter(service=>service.properties.length||service.actions.length)};
}
