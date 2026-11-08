import './ir-remote.css';
import './television-page.css';
import type {Device,DevicePanel,Json,Property} from '../types';
import {televisionCommand,televisionLabels,type TelevisionCommand,type TelevisionRole} from '../television';
import {officialIcon} from '../icons';
import {button,element} from './dom';
import {deviceSurfaces} from './device-surfaces';
import {resolveDeviceCapabilities,capabilityBinding} from '../device-capabilities';
import {renderControl} from './controls';

export function televisionPage(o:{device:Device;panel:DevicePanel;busy:boolean;cached:boolean;settings:boolean;pendingRole?:TelevisionRole;back:()=>void;showSettings:(open:boolean)=>void;press:(role:TelevisionRole,command:TelevisionCommand)=>void;write:(p:Property,v:Json)=>void;error:(e:unknown)=>void}):HTMLElement {
 const stage=element('div','device-stage'),page=element('section','device-page page-ir-remote page-television');
 const back=button('','page-icon-button',o.back,'back');back.setAttribute('aria-label','返回家庭');
 const more=button('','page-icon-button',()=>o.showSettings(true),'more');more.setAttribute('aria-label','电视设置');
 page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',o.device.name)),more));
 const body=element('div','device-page-scroll ir-remote-content');
 const console=element('section','ir-console');console.setAttribute('aria-label','小米电视遥控器');console.setAttribute('aria-busy',String(o.busy));
 const make=(role:TelevisionRole)=>{
  const command=televisionCommand(o.panel,role),b=button(role==='center'?'OK':'',`ir-key ir-${role}`,()=>{if(!b.disabled&&command)o.press(role,command);});
  b.setAttribute('aria-label',televisionLabels[role]);b.dataset.irRole=role;
  b.disabled=!command||!o.device.online||!!o.device.sharedReadOnly||o.busy||o.cached;
  if(!command)b.setAttribute('aria-description','此设备描述没有可用的对应按键。');
  else if(command.kind==='action'){b.dataset.siid=String(command.action.siid);b.dataset.aiid=String(command.action.aiid);if(role==='power')b.setAttribute('aria-description',command.service.name==='remote-control'?'打开设备的关机选项。':'设备提供云端关机操作，开机取决于设备连接能力。');}
  else{b.dataset.siid=String(command.property.siid);b.dataset.piid=String(command.property.piid);}
  b.classList.toggle('is-sending',o.busy&&role===o.pendingRole);
  if(['up','down','left','right'].includes(role))b.append(element('span','ir-direction-dot'));else if(role!=='center')b.append(officialIcon(`ir:${role}`));
  return b;
 };
 const row=(roles:TelevisionRole[],name:string)=>element('div',name,...roles.map(make));
 const pad=element('div','ir-direction-pad',...(['up','left','center','right','down'] as TelevisionRole[]).map(make));pad.setAttribute('role','group');pad.setAttribute('aria-label','方向和确认');
 console.append(row(['power','volume-down','volume-up'],'ir-top-row'),element('div','ir-pad-area',pad),row(['home','back','menu'],'ir-bottom-row'));
 body.append(console);page.append(body);
 if(o.settings){
  const overlay=element('div','television-settings-backdrop'),sheet=element('section','television-settings');sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');sheet.setAttribute('aria-label','电视设置');
  const close=button('','page-icon-button',()=>o.showSettings(false),'close');close.setAttribute('aria-label','关闭电视设置');sheet.append(element('header','',element('h3','','电视设置'),close));
  for(const binding of resolveDeviceCapabilities(o.panel).properties){if(!['volume','mute'].includes(binding.name))continue;const p=capabilityBinding(o.panel,binding);if(!p)continue;sheet.append(renderControl(binding.name==='mute'?{name:'Power',props:{property:p,label:'静音',style:'setting',glyph:'volume-off'}}:{name:'Slider',props:{property:p,label:'音量',unit:'%',theme:'volume'}},{device:o.device,busy:o.busy||o.cached,write:o.write,error:o.error}));}
  overlay.addEventListener('click',event=>{if(event.target===overlay)o.showSettings(false);});overlay.append(sheet);page.append(overlay);
 }
 page.dataset.visualAdapter='xiaomi-television-remote';stage.append(page);return deviceSurfaces(stage);
}
