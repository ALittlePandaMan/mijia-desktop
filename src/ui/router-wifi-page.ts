import {dismissOnBackdrop} from './dialog-dismiss';
import {deviceSurfaces} from './device-surfaces';
import type {Device} from '../types';
import type {RouterWifiState} from '../router-wifi';
import {button,element} from './dom';
import {deviceWait} from './device-loading';
import {icon} from '../icons';
interface Props {device:Device;state:RouterWifiState;busy:boolean;artwork:()=>HTMLElement;back:()=>void;changed:()=>void;save:(confirmed:boolean)=>void;advanced?:()=>void;internet?:()=>void;daily?:boolean}
export function routerWifiPage(p:Props):HTMLElement {
 const s=p.state,r=s.report,d=s.draft,stage=element('div','device-stage'),page=element('section','device-page page-router page-router-wifi');stage.append(page);page.dataset.routerView='wifi';page.dataset.wifiLoading=String(s.loading);page.dataset.pendingOperations=String(s.pending?1:0);page.dataset.uncertainOperations=String(s.blocked?1:0);
 const back=button('','page-icon-button',p.back,'back');back.setAttribute('aria-label','返回路由器');page.append(element('header','device-page-header',back));
 const tabs=element('div','router-wifi-tabs',element('span','selected','Wi-Fi设置'));if(!p.daily&&p.internet)tabs.append(button('上网模式设置','router-internet-entry',p.internet));page.append(tabs);
 const body=element('div','device-page-scroll router-wifi-content');page.append(body);
 if(s.loading&&!d){body.append(deviceWait(p.artwork,'Wi-Fi设置',false));return deviceSurfaces(stage);}
 const blocked=!s.canEdit||p.busy||!p.device.online||!!p.device.sharedReadOnly;
 if(r&&d){
  if(!p.daily&&r.canMerge){const row=button('','router-wifi-merge',()=>s.merge());row.setAttribute('role','switch');row.setAttribute('aria-label','多频合一');row.setAttribute('aria-checked',String(d.merged));row.disabled=blocked;row.append(element('div','router-wifi-row-copy',element('strong','','多频合一'),element('p','','不同Wi-Fi频段合并，自动为你切换至最佳Wi-Fi网络')),element('span',`router-wifi-switch${d.merged?' selected':''}`));body.append(row);}
  if(!p.daily&&p.advanced){const advanced=button('','router-wifi-advanced',p.advanced);advanced.append(element('strong','','Wi-Fi'),element('span','','高级'),icon('chevron'));body.append(advanced);}
  if(p.daily)for(let i=0;i<2;i++){const on=d.enabled?.[i]??r.enabled[i],toggle=button('','router-wifi-basic-toggle',()=>s.toggleBand(i));toggle.setAttribute('role','switch');toggle.setAttribute('aria-label',`${i===0?'2.4GHz':'5GHz'} Wi-Fi`);toggle.setAttribute('aria-checked',String(on));toggle.disabled=blocked;toggle.append(element('strong','',`${i===0?'2.4GHz':'5GHz'} Wi-Fi`),element('span',`router-wifi-switch${on?' selected':''}`));body.append(toggle);}
  for(let i=0;i<(d.merged?1:2);i++){
   const group=element('section',`router-wifi-band${d.merged?' merged':''}`);if(!d.merged)group.append(element('h3','',i===0?'2.4GHz Wi-Fi':'5GHz Wi-Fi'));
   if(d.enabled?.[i]??r.enabled[i]){const fields=element('div','router-wifi-fields');for(const[field,title,placeholder]of [['ssid','名称','请输入Wi-Fi名称'],['password','密码','请输入Wi-Fi密码']]as const){
    const label=element('label','router-wifi-field',element('span','',title)),input=element('input');input.type='text';input.value=d.bands[i][field];input.autocomplete='off';input.spellcheck=false;input.setAttribute('autocapitalize','off');input.setAttribute('aria-label',`${i===0?'2.4GHz':'5GHz'} ${title}`);input.dataset.sensitive='wifi';input.placeholder=placeholder;input.disabled=blocked||field==='password'&&!r.encrypted[i];input.addEventListener('input',()=>s.editBand(i,field,input.value));label.append(input);fields.append(label);
   }group.append(fields);}else group.append(element('p','router-warning','此频段已关闭。'));body.append(group);
  }
 }
 const message=!r?s.error?.message:undefined;if(message){const note=element('p','router-warning',message);note.setAttribute('role','status');body.append(note);}
 const save=button('确定','router-wifi-save',()=>{if(!s.dirty)p.back();else p.save(false);});save.disabled=blocked;body.append(save);
 if(s.success)queueMicrotask(()=>{if(page.isConnected){s.success=false;p.back();}});
 if(s.confirming){const overlay=element('div','router-modal-backdrop'),dialog=element('section','router-confirm router-wifi-confirm');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Wi-Fi修改提示');dialog.append(element('h3','','提示'),element('p','','该修改将重启Wi-Fi，并导致Wi-Fi下设备暂时失去连接。'));
  const actions=element('footer');actions.append(button('取消','',()=>{s.confirming=false;p.changed();}),button('确定','',()=>p.save(true)));dialog.append(actions);dismissOnBackdrop(overlay,()=>{if(!s.pending){s.confirming=false;p.changed();}});overlay.append(dialog);page.append(overlay);focus(dialog);
 }
 return deviceSurfaces(stage);
}
function focus(dialog:HTMLElement):void{dialog.tabIndex=-1;queueMicrotask(()=>{if(dialog.isConnected)dialog.focus();});dialog.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const items=[...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];if(e.shiftKey&&(document.activeElement===dialog||document.activeElement===items[0])){e.preventDefault();items.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0]?.focus();}});}
