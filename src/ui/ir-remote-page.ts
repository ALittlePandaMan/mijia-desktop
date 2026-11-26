import type {Device} from '../types';
import {irControlKeys,type IrRemoteState} from '../ir-remote';
import {button,element} from './dom';
import {deviceUnavailablePage} from './device-unavailable';
import {remoteControlPage,type RemoteKey} from './remote-control-page';

export function irRemotePage({device,state,back,extrasOpen}:{device:Device;state:IrRemoteState;back:()=>void;extrasOpen?:boolean}):HTMLElement{
 const base={device,back,template:'ir-remote'};
 const report=state.report;
 if(!report)return remoteControlPage({...base,loading:state.loading,error:state.error?.message,retry:()=>void state.read()});
 if(!report.keys.length)return deviceUnavailablePage(device,back);
 const disabled=!device.online||!!device.sharedReadOnly||state.loading;
 const press=(name:string)=>{if(state.uncertain)state.acknowledge();void state.press(name);};
 const controls=irControlKeys(report);
 const keys=Object.fromEntries(Object.entries(controls).flatMap(([role,key])=>{
  if(!key)return [];
  const bound:RemoteKey={label:key.label,press:()=>press(key.name),pending:state.keyPending(key.name),data:{irKey:key.name}};
  return [[role,bound]];
 }));
 const used=new Set(Object.values(controls).map(key=>key?.name));
 const extras=element('div','ir-key-grid');
 for(const key of report.keys.filter(key=>!used.has(key.name))){
  const control=button(key.label,'ir-extra-key',()=>{if(!control.disabled)press(key.name);});
  control.disabled=disabled;
  control.dataset.focusKey=`media-remote-extra-${key.name}`;
  if(state.keyPending(key.name))control.setAttribute('aria-busy','true');
  control.dataset.irKey=key.name;
  extras.append(control);
 }
 return remoteControlPage({...base,keys,disabled,busy:state.pending,extras:extras.childElementCount?extras:undefined,extrasOpen});
}
