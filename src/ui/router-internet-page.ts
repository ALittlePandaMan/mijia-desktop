import {dismissOnBackdrop} from './dialog-dismiss';
import {describeOperation} from './operation-feedback';
import type {Device} from '../types';
import {internetLabels,type RouterInternetState} from '../router-internet';
import {button,element} from './dom';
import {icon} from '../icons';
import {deviceWait} from './device-loading';
interface Props {device:Device;state:RouterInternetState;busy:boolean;artwork:()=>HTMLElement;back:()=>void;wifi:()=>void;changed:()=>void;save:(confirmed:boolean)=>void;ports:()=>void;ipv6:()=>void}
const ipv6Labels:Record<string,string>={off:'不启用',native:'自动',pi_relay:'Passthrough',dhcpv6:'DHCPv6',pppoev6:'PPPoEv6',static:'静态IPv6'};
export function routerInternetPage(p:Props):HTMLElement {
 const s=p.state,r=s.report,stage=element('div','device-stage'),page=element('section','device-page page-router page-router-internet');stage.append(page);page.dataset.internetLoading=String(s.loading);page.dataset.localAvailable=String(r?.localAvailable??false);page.dataset.pendingOperations=String(s.pending||s.blocked?1:0);page.dataset.internetView=s.editor??(s.networkInfo?'info':'home');
 const back=button('','page-icon-button',()=>{if(!s.back())p.back();},'back');back.setAttribute('aria-label',s.editor||s.networkInfo?'返回上网模式设置':'返回路由器');
 const title=s.editor?internetLabels[s.editor]??'上网设置':s.networkInfo?'WAN网络信息':'';
 page.append(element('header','device-page-header',back,...(title?[element('div','device-page-title',element('h2','',title))]:[])));
 if(!title){const wifi=button('Wi-Fi设置','',p.wifi),selected=element('span','selected','上网模式设置');page.append(element('div','router-wifi-tabs',wifi,selected));}
 const body=element('div',`device-page-scroll router-internet-content${s.networkInfo?' info':''}${s.editor?' editor':''}`);page.append(body);
 if(s.loading&&!r){body.append(deviceWait(p.artwork,'上网模式设置',false));return stage;}
 const row=(label:string,value:string,action?:()=>void)=>{const el=action?button('','router-internet-row',action):element('div','router-internet-row');el.append(element('span','',label),element('span','router-internet-value',value));if(action)el.append(icon('chevron'));return el;};
 if(r){
  if(s.networkInfo){for(const[i,n]of r.networks.entries()){if(r.networks.length>1)body.append(element('h3','router-internet-group-title',`WAN${i+1}口网络信息`));for(const[label,value]of [['WAN IPv4地址',n.ipv4],['WAN IPv4网关',n.gateway4],['WAN IPv6地址',n.ipv6.join('\n')],['WAN IPv6网关',n.gateway6]]){const el=row(label,value||'--');el.querySelector('.router-internet-value')!.setAttribute('data-sensitive','network');body.append(el);}}}
  else if(s.editor&&s.draft){
   const d=s.draft,disabled=!s.canEdit||p.busy||!p.device.online||!!p.device.sharedReadOnly;
   const field=(key:'dns1'|'dns2'|'account'|'password'|'ip'|'mask'|'gateway',label:string,placeholder:string)=>{const el=element('label','router-internet-field',element('span','',label)),input=element('input');input.value=d[key];input.type=key==='password'&&!s.passwordVisible?'password':'text';input.autocomplete='off';input.spellcheck=false;input.setAttribute('aria-label',label);input.dataset.sensitive='network';input.placeholder=placeholder;input.disabled=disabled;input.addEventListener('input',()=>s.edit(key,input.value));el.append(input);if(key==='password'){const eye=button('','router-internet-eye',()=>{s.passwordVisible=!s.passwordVisible;input.type=s.passwordVisible?'text':'password';eye.setAttribute('aria-label',s.passwordVisible?'隐藏密码':'显示密码');},'eye');eye.setAttribute('aria-label',s.passwordVisible?'隐藏密码':'显示密码');eye.disabled=disabled;el.append(eye);}body.append(el);};
   if(s.editor==='dhcp')body.append(row('配置方式',d.autoDns?'自动(推荐)':'手动',()=>{if(s.canEdit){s.picker='dns';p.changed();}}));
   if(s.editor==='pppoe'){field('account','宽带账号','请输入宽带账号');field('password','宽带密码','请输入宽带密码');}
   if(s.editor==='static'){field('ip','IP地址','必填');field('mask','子网掩码','必填');field('gateway','网关','必填');}
   if(s.editor==='static'||s.editor==='dhcp'&&!d.autoDns){field('dns1','DNS1','必填');field('dns2','DNS2','选填');}
   const save=button('确定','router-wifi-save router-internet-save',()=>p.save(false));save.disabled=disabled;body.append(save);
  }else{
   body.append(row('切换模式','',()=>s.switchMode()),row('当前模式',internetLabels[r.values.mode]??'未知',()=>s.open(r.values.mode)));
   if(r.portVisible)body.append(row('WAN口选择',r.portAuto===null?'--':r.portAuto?'自动':'手动',p.ports));
   if(r.moreInfo)body.append(row('WAN网络信息','',()=>{s.networkInfo=true;p.changed();}));else if(r.networks[0]?.ipv4){for(const[label,value]of [['WAN IP',r.networks[0].ipv4],['WAN口网关',r.networks[0].gateway4]]){const el=row(label,value);el.querySelector('.router-internet-value')!.setAttribute('data-sensitive','network');body.append(el);}}
   if(r.ipv6Supported||r.ipv6Mode!==null)body.append(row('IPv6网络设置',r.ipv6Mode===null?'--':ipv6Labels[r.ipv6Mode]??r.ipv6Mode,()=>{if(!r.localAvailable){s.notice='请连接当前路由器的网络后再进行设置。';p.changed();}else p.ipv6();}));
  }
 }
 const message=!r?s.error?.message:undefined;if(message)body.append(element('p','router-warning',message));for(const warning of r?.warnings??[])body.append(element('p','router-warning',warning));
 describeOperation(page,s.notice);
 if(s.picker){const overlay=element('div','router-modal-backdrop'),dialog=element('section','router-confirm router-advanced-picker router-network-dialog router-network-port-picker');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',s.picker==='mode'?'切换模式':'配置方式');dialog.append(element('h3','',s.picker==='mode'?'切换模式':'配置方式'));
  const options=s.picker==='mode'?['dhcp','pppoe','static'].filter(mode=>mode!==r?.values.mode):['auto','manual'];
  for(const value of options){const selected=s.picker==='dns'&&(s.draft?.autoDns?value==='auto':value==='manual'),item=button('',`router-advanced-choice${selected?' selected':''}`,()=>s.picker==='mode'?s.open(value):s.autoDns(value==='auto')),arrow=element('span','router-network-choice-arrow');if(selected)arrow.append(icon('chevron'));item.dataset.internetChoice=value;item.append(arrow,element('span','',s.picker==='mode'?internetLabels[value]:value==='auto'?'自动(推荐)':'手动'));dialog.append(item);}
  overlay.append(dialog);page.append(overlay);trapDialog(dialog,()=>{s.picker=undefined;p.changed();});
 }
 if(s.success)queueMicrotask(()=>{if(page.isConnected)s.back();});
 if(s.confirming){const overlay=element('div','router-modal-backdrop'),dialog=element('section','router-confirm router-internet-confirm');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','上网设置提示');dialog.append(element('h3','','提示'),element('p','','修改上网设置可能暂时中断网络连接，是否继续？'));
  const footer=element('footer','',button('取消','',()=>{s.confirming=false;p.changed();}),button('确定','selected',()=>p.save(true)));dialog.append(footer);overlay.append(dialog);page.append(overlay);trapDialog(dialog,()=>{if(!s.pending){s.confirming=false;p.changed();}});
 }
 return stage;
}
function trapDialog(dialog:HTMLElement,cancel:()=>void):void{dismissOnBackdrop(dialog.parentElement!,cancel);dialog.tabIndex=-1;queueMicrotask(()=>{if(dialog.isConnected)dialog.focus();});dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();cancel();return;}if(e.key!=='Tab')return;const items=[...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];if(e.shiftKey&&(document.activeElement===dialog||document.activeElement===items[0])){e.preventDefault();items.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0]?.focus();}});}
