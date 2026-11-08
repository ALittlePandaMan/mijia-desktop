import {dismissOnBackdrop} from './dialog-dismiss';
import type {Device} from '../types';
import type {RouterIndicatorState} from '../router-indicator';
import {button,element} from './dom';
import {deviceWait} from './device-loading';
interface Props {device:Device;state:RouterIndicatorState;timerSupported:boolean;busy:boolean;artwork:()=>HTMLElement;back:()=>void;changed:()=>void;save:(confirmedOff:boolean)=>void}
export function routerIndicatorPage(p:Props):HTMLElement {
 const s=p.state,d=s.draft,stage=element('div','device-stage'),page=element('section','device-page page-router page-router-indicator');stage.append(page);page.dataset.routerView='indicator';page.dataset.pendingOperations=String(s.pending?1:0);page.dataset.uncertainOperations=String(s.blocked?1:0);
 const back=button('','page-icon-button',p.back,'back');back.setAttribute('aria-label','返回路由设置');page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','','指示灯控制'))));
 const body=element('div','device-page-scroll router-led-content');page.append(body);
 if(s.loading&&!d){body.append(deviceWait(p.artwork,'指示灯设置',false));return stage;}
 const blocked=!s.canEdit||p.busy||!p.device.online||!!p.device.sharedReadOnly;
 if(d){
  const b=button('','router-led-row',()=>s.edit({on:!d.on}));b.setAttribute('role','switch');b.setAttribute('aria-label','指示灯开关');b.setAttribute('aria-checked',String(d.on));b.disabled=blocked;b.append(element('span','','指示灯开关'),element('span','router-led-value',d.on?'打开':'关闭'));body.append(b);
 }
 if(s.error&&!s.report){const message=element('p','router-warning',s.error?.message);message.setAttribute('role','status');body.append(message);}
 if(p.device.sharedReadOnly)body.append(element('p','router-warning','此共享设备只有读取权限。'));
 const save=button('确定','router-led-save',()=>{if(!s.dirty)p.back();else p.save(false);});save.disabled=blocked;page.append(save);
 if(s.confirmOff){const overlay=element('div','router-modal-backdrop'),dialog=element('section','router-confirm');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','关闭指示灯提示');dialog.append(element('h3','','提示'),element('p','','关闭指示灯后，将无法根据指示灯的状态及时了解路由器的工作情况。'),element('footer','',button('取消','',()=>{s.confirmOff=false;if(d)d.on=true;p.changed();}),button('确定','',()=>p.save(true))));dismissOnBackdrop(overlay,()=>{if(!s.pending){s.confirmOff=false;if(d)d.on=true;p.changed();}});overlay.append(dialog);page.append(overlay);focus(dialog);}
 return stage;
}
function focus(dialog:HTMLElement):void{dialog.tabIndex=-1;queueMicrotask(()=>{if(dialog.isConnected)dialog.focus();});dialog.addEventListener('keydown',e=>{if(e.key==='Tab'){const nodes=[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]),[role=listbox]')];if(e.shiftKey&&(document.activeElement===nodes[0]||document.activeElement===dialog)){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}}});}
