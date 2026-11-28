import type {Device,DevicePanel} from '../types';
import {televisionCategory,televisionCommand,televisionExtraKeys,televisionRoles,televisionSettings,televisionSourceIcon,televisionSourceLabel,type TelevisionCommand,type TelevisionRole} from '../television';
import {button,element} from './dom';
import {deviceUnavailablePage} from './device-unavailable';
import {remoteControlPage,type RemoteKey} from './remote-control-page';
import {renderControl,type ControlEnvironment} from './controls';

export function televisionPage(o:{device:Device;panel:DevicePanel;busy:boolean;cached:boolean;back:()=>void;
 press:(role:TelevisionRole,command:TelevisionCommand)=>void;
 pressExtra?:(command:TelevisionCommand)=>void;
 selectedExtra?:(command:Extract<TelevisionCommand,{kind:'action'}>)=>boolean;
 pending?:(command:Extract<TelevisionCommand,{kind:'action'}>)=>boolean;
 extrasOpen?:boolean;
}):HTMLElement {
 const disabled=!o.device.online||!!o.device.sharedReadOnly||o.cached||o.busy;
 const keys=Object.fromEntries(televisionRoles.flatMap(role=>{
  const command=televisionCommand(o.panel,role);
  if(!command)return [];
  const key:RemoteKey={press:()=>o.press(role,command)};
  if(command.kind==='action'){
   key.pending=o.pending?.(command);
   key.data={siid:String(command.action.siid),aiid:String(command.action.aiid)};
   if(role==='power'&&command.action.name==='turn-off')key.label=command.service.name==='remote-control'?'关机选项':'关机';
  }else{
   key.data={siid:String(command.property.siid),piid:String(command.property.piid)};
   if(role==='power'&&typeof command.property.value==='boolean')key.selected=command.property.value;
  }
  return [[role,key]];
 }));
 const {source,mute,hasStatefulKeys}=televisionSettings(o.panel);
 const env:ControlEnvironment={device:o.device,busy:o.cached||o.busy,
  write:(property,value)=>o.pressExtra?.({kind:'property',property,value}),error:()=>{}};
 const extras=element('div','ir-extra-content');
 if(o.pressExtra){
  if(source)extras.append(renderControl({name:'Selector',props:{
   label:'信号源',property:source,showValue:true,
   choiceLabel:(description,choice)=>televisionSourceLabel(description,choice?.localizedDescription)??(choice?`信号源 ${choice.value}`:undefined),
   choiceIcon:televisionSourceIcon,
  }},env));
  if(mute)extras.append(renderControl({name:'Power',props:{label:'静音',property:mute,glyph:'volume-off'}},env));
  const grid=element('div','ir-key-grid');
  for(const {label,command}of televisionExtraKeys(o.panel)){
   if(!command)continue;
   const control=button(label,'ir-extra-key',()=>{if(!control.disabled)o.pressExtra?.(command);});
   control.disabled=disabled;
   control.dataset.focusKey=`media-remote-extra-${label}`;
   if(o.selectedExtra)control.setAttribute('aria-pressed',String(o.selectedExtra(command)));
   if(o.pending?.(command))control.setAttribute('aria-busy','true');
   grid.append(control);
  }
  if(grid.childElementCount)extras.append(grid);
 }
 if(!Object.keys(keys).length&&!hasStatefulKeys&&!extras.childElementCount)return deviceUnavailablePage(o.device,o.back);
 return remoteControlPage({device:o.device,template:televisionCategory(o.panel.specType??o.device.specType)??'television',
  back:o.back,disabled,keys,extras:extras.childElementCount?extras:undefined,extrasOpen:o.extrasOpen,busy:Object.values(keys).some(k=>k.pending)});
}
