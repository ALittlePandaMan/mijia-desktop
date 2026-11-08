import './ir-remote.css';
import {deviceSurfaces} from './device-surfaces';
import type {Device} from '../types';
import {irControlKeys,type IrRemoteState,type IrReport} from '../ir-remote';
import {officialIcon} from '../icons';
import {button,element} from './dom';
import {deviceLoading} from './device-loading';

export function irRemotePage(o:{device:Device;state:IrRemoteState;back:()=>void;artwork:()=>HTMLElement}):HTMLElement {
 const {state,device}=o,stage=element('div','device-stage'),page=element('section','device-page page-ir-remote');
 const back=button('','page-icon-button',o.back,'back');back.setAttribute('aria-label','返回家庭');
 page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',device.name))));
 const body=element('div','device-page-scroll ir-remote-content');
 if(state.loading&&!state.report)body.append(deviceLoading(o.artwork(),device.name));
 page.setAttribute('aria-description',state.error?.message??state.message);
 if(state.report){
  const keys=state.report.keys,controls=irControlKeys(state.report),disabled=!!(!device.online||device.sharedReadOnly||state.pending||state.loading);
  // A new explicit press is a new intent. It never retries the previous key.
  const press=(name:string)=>{if(state.uncertain)state.acknowledge();void state.press(name);};
  const make=(key:IrReport['keys'][number],role:string)=>{
   const b=button(role==='center'?'OK':'',`ir-key ir-${role}`,()=>{if(!b.disabled)press(key.name);});
   b.setAttribute('aria-label',key.label);b.disabled=disabled;b.dataset.irKey=key.name;b.dataset.irRole=role;b.classList.toggle('is-sending',state.pending&&state.lastPressed===key.name);
   if(['up','down','left','right'].includes(role))b.append(element('span','ir-direction-dot'));
   else if(role!=='center')b.append(officialIcon(`ir:${role}`));
   return b;
  };
  const console=element('section','ir-console');console.setAttribute('aria-label','遥控器');console.setAttribute('aria-busy',String(state.pending));
  const row=(roles:readonly string[],className:string)=>{
   const node=element('div',className);
   for(const role of roles){const key=controls[role];if(key)node.append(make(key,role));else if(role==='menu'){const menu=button('','ir-key ir-menu',()=>{let panel=page.querySelector<HTMLElement>('.ir-settings-panel');if(panel){panel.remove();return;}panel=element('section','ir-settings-panel');panel.setAttribute('role','dialog');panel.setAttribute('aria-label','遥控器按键');panel.append(element('h3','','遥控器按键'));for(const k of keys){const control=button(k.label,'ir-extra-key',()=>{if(!control.disabled)press(k.name);});control.disabled=disabled;panel.append(control);}panel.append(button('关闭','ir-extra-key',()=>panel?.remove()));page.append(panel);});menu.append(officialIcon('ir:menu'));menu.setAttribute('aria-label','遥控器按键');menu.dataset.irRole='menu';node.append(menu);}else{const empty=element('span','ir-key-space');empty.setAttribute('aria-hidden','true');node.append(empty);}}
   return node;
  };
  console.append(row(['power','volume-down','volume-up'],'ir-top-row'));
  const pad=element('div','ir-direction-pad');pad.setAttribute('role','group');pad.setAttribute('aria-label','方向和确认');
  for(const role of ['up','left','center','right','down']){const key=controls[role];if(key)pad.append(make(key,role));}
  console.append(element('div','ir-pad-area',pad),row(['home','back','menu'],'ir-bottom-row'));
  if(keys.length)body.append(console);else body.append(element('p','ir-remote-message','该遥控器没有可用的日常按键。'));
  // Other verified STB keys remain available without changing the TV layout.
  const used=new Set(Object.values(controls).map(key=>key?.name)),extra=keys.filter(key=>!used.has(key.name));
  if(extra.length){
   const more=element('details','ir-extra-keys'),grid=element('div','ir-key-grid');more.append(element('summary','','更多按键'));
   for(const key of extra){const b=button(key.label,'ir-extra-key',()=>{if(!b.disabled)void state.press(key.name);});b.disabled=disabled;b.dataset.irKey=key.name;grid.append(b);}
   more.append(grid);body.append(more);
  }
  // The permanent reference layout stays concise; send feedback appears above.
  const help=element('p','ir-remote-help',keys.some(key=>key.name==='MUTE')?'红外遥控不能读取设备当前开关状态，电源和静音为切换按键。':'红外遥控不能读取设备当前开关状态，电源为切换按键。');
  help.id='ir-remote-help';console.setAttribute('aria-describedby',help.id);body.append(help);
 }
 page.append(body);stage.append(page);return deviceSurfaces(stage);
}
