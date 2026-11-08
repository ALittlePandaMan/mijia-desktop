import {describeOperation} from './operation-feedback';
import {deviceSurfaces} from './device-surfaces';
import {dailyRouterTool} from './router-daily-page';
import {routerScenePage} from './router-scene-page';
import type {RouterPageProps as Props} from './router-legacy-page';
import {dailyRouterView} from '../daily-scope';
import {routerClients,routerSpeed,connectionLabel,routerEventTime,routerClientQuality} from '../router';
import type {RouterView} from '../router';
import type {RouterClient} from '../types';
import {button,element} from './dom';import {icon,officialIcon} from '../icons';
import {deviceWait} from './device-loading';
import {routerPasswordCard,routerPasswordDialog} from './router-password-card';
function routerSymbol(kind:'wifi'|'boost'|'mesh'|'speed'|'router'|'network'):SVGSVGElement{return officialIcon('router:'+(kind==='boost'?'optimize':kind));}
function networkIllustration():SVGSVGElement {
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 400 400');svg.setAttribute('aria-hidden','true');
 // Independent geometric illustration; vendor package artwork is not bundled.
 svg.innerHTML='<g fill="#dce5f0" opacity=".48"><path d="m65 125 80-46 80 46-80 46zM145 200l80-46 80 46-80 46zM65 275l80-46 80 46-80 46zM225 125l60-35 60 35-60 35z"/><path d="m65 125 80 46v28l-80-46zm80 75 80 46v28l-80-46zm-80 75 80 46v28l-80-46zm160-150 60 35v28l-60-35z" fill="#d0dcec"/><path d="m145 171 80-46v28l-80 46zm80 75 80-46v28l-80 46zm-80 75 80-46v28l-80 46zm140-161 60-35v28l-60 35z" fill="#e8eef7"/></g><g fill="#6da5ff"><ellipse cx="285" cy="126" rx="47" ry="27" opacity=".04"/><ellipse cx="285" cy="126" rx="34" ry="20" opacity=".09"/><ellipse cx="285" cy="126" rx="21" ry="12" opacity=".15"/><ellipse cx="285" cy="126" rx="12" ry="7" opacity=".28"/></g>';
 return svg;
}
function artwork(client:RouterClient):HTMLElement {
 const frame=element('div','router-client-icon');
 if(client.icon){const image=element('img');image.src=client.icon;image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';image.addEventListener('error',()=>{image.remove();frame.append(icon('device'));},{once:true});frame.append(image);}else frame.append(icon('device'));
 return frame;
}
export function routerPage(p:Props&{scene?:import('../router-scene').RouterSceneState}):HTMLElement {
 const v=dailyRouterView(p.view),s=p.state,r=s.report;
 const go=(page:RouterView['page'],mac?:string)=>p.navigate({...v,page,mac});
 const stage=element('div','device-stage'),page=element('section',`device-page page-router page-router-${v.page}`),body=element('div','device-page-scroll router-content');stage.append(page);page.dataset.routerView=v.page;page.dataset.routerLoading=String(s.loading);page.setAttribute('aria-busy',String(s.loading));
 const back=button('','page-icon-button',v.page==='home'?p.back:()=>go(v.page==='client'?'clients':'home'),'back');back.setAttribute('aria-label',v.page==='home'?'返回家庭':v.page==='client'?'返回设备管理':'返回路由器');page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',v.page==='home'?p.device.name:v.page==='clients'?'设备管理':v.page==='client'?'设备详情':v.page==='optimize'?'Wi-Fi优化':'场景测速'))),body);
 if(!r&&s.loading){body.append(deviceWait(p.artwork,p.device.name,false));return deviceSurfaces(stage);}
 if(s.error&&!r){const note=element('p','router-warning',s.error.message);note.setAttribute('role','alert');body.append(note);}
 if(v.page==='home'){
  const hero=element('section','router-hero'),normal=!!r&&r.network==='ok'&&!s.error&&p.device.online;hero.append(element('h1',`router-network${normal?' normal':''}`,!p.device.online?'路由器已离线':normal?'网络连接正常':'网络状态未确认'));
  const speeds=element('div','router-speeds');for(const[kind,value]of [['up',r?.uploadBps],['down',r?.downloadBps]]as const){const speed=routerSpeed(value),digits=element('strong','router-speed-value');if(speed.value==='--')digits.textContent='--';else{const padded=speed.value.padStart(3,'0');[...padded].forEach((digit,index)=>digits.append(element('span',index<padded.length-speed.value.length?'placeholder':'',digit)));}const row=element('div','router-speed',digits,element('div','router-speed-unit',officialIcon('router:arrow-'+kind,'router-speed-arrow'),element('span','',speed.unit)));row.setAttribute('aria-label',`${kind==='up'?'上传速度':'下载速度'} ${speed.value}${speed.unit}`);speeds.append(row);}hero.append(speeds,element('p','router-features',r?.wifi7?'Wi-Fi 7':''),networkIllustration());page.insertBefore(hero,body);body.addEventListener('scroll',()=>{hero.style.opacity=String(1-Math.min(Math.max(body.scrollTop,0),360)/360);},{passive:true});
  const toolbar=element('div','router-toolbar router-daily-toolbar');for(const[symbol,label,destination]of [['boost','Wi-Fi优化','optimize'],['speed','场景测速','speed']]as const){const item=button('',`router-unavailable-feature router-${destination}-entry`,()=>go(destination));item.append(element('span','router-feature-symbol',routerSymbol(symbol)),element('span','',label));toolbar.append(item);}body.append(toolbar);
  const menu=element('section','router-menu');menu.append(routerPasswordCard(p.password));const devices=button('','router-menu-row',()=>go('clients'));devices.append(element('strong','','设备管理'),element('span','',String(routerClients(r,'online')?.length??'--')),icon('chevron'));menu.append(devices);body.append(menu);
 }else if(v.page==='clients'){
  const tabs=element('div','router-tabs');tabs.setAttribute('role','tablist');for(const[tab,label]of [['online','在线'],['offline','离线']]as const){const items=routerClients(r,tab),b=button(`${label} ${items?.length??'--'}`,'router-tab',()=>p.navigate({...v,tab}));b.setAttribute('role','tab');b.setAttribute('aria-selected',String(v.tab===tab));tabs.append(b);}body.append(tabs);const items=routerClients(r,v.tab);if(items===null)body.append(element('p','router-empty','设备列表暂不可用。'));else if(!items.length)body.append(element('p','router-empty','暂无设备'));else for(const client of items){const b=button('','router-client',()=>go('client',client.mac)),info=element('div','router-client-info',element('strong','',client.name));if(client.online===true){const speed=routerSpeed(client.downloadBps);info.append(element('p','router-client-speed',officialIcon('router:arrow-down'),`${speed.value}${speed.unit}`));}info.append(element('p','router-client-meta',[connectionLabel(client.connection),routerEventTime(client.eventTime)].filter(Boolean).join('  ')));b.append(artwork(client),info);body.append(b);}
 }else if(v.page==='client'){
  const client=r?.clients?.find(c=>c.mac===v.mac);if(!client)body.append(element('p','router-empty','设备已不在当前列表中。'));else{
   const speeds=element('p','router-client-detail-speeds');for(const[label,value]of [['up',client.uploadBps],['down',client.downloadBps]]as const){const speed=routerSpeed(value);speeds.append(element('span','',officialIcon('router:arrow-'+label),`${speed.value}${speed.unit}`));}body.append(element('section','router-client-detail',artwork(client),element('div','router-client-detail-info',element('h2','',client.name),speeds)));if(client.online!==true)body.append(element('p','router-warning',client.online===false?'设备已离线':'设备状态未确认'));
   const rename=button('','router-client-name-row',()=>p.clientName?.open());rename.disabled=!p.clientName||p.busy||!p.device.online||!!p.device.sharedReadOnly||p.clientName.blocked||p.clientName.pending;rename.append(element('span','','设备备注'),element('span','router-client-name-value',client.name),icon('chevron'));body.append(element('div','router-details router-client-name-card',rename));
   const details=element('dl','router-details');for(const[label,value]of [['连接方式',connectionLabel(client.connection)],['IP地址',client.ip??'--'],['MAC地址',client.mac],...routerClientQuality(client)])details.append(element('div','',element('dt','',label),element('dd','',value)));body.append(details);describeOperation(body,p.clientName?.message);
  }
 }else if(v.page==='speed'&&p.scene)body.append(routerScenePage(p.scene));
 else if(p.daily&&v.page==='optimize')body.append(dailyRouterTool(p.daily,'optimize'));
 if(v.page==='home'&&p.password){const dialog=routerPasswordDialog(p.password);if(dialog)page.append(dialog);}
 if(v.page==='client'&&p.clientName?.modalOpen){
  const s=p.clientName,overlay=element('div','router-modal-backdrop router-client-name-backdrop'),dialog=element('section','router-client-name-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','修改备注');
  const input=element('input','router-client-name-input');input.value=s.draft;input.maxLength=24;input.setAttribute('aria-label','设备名称');input.disabled=s.pending;input.addEventListener('input',()=>{s.draft=input.value;});
  const cancel=button('取消','router-client-name-cancel',()=>s.cancel()),save=button('确定','router-client-name-save',()=>{void s.save();});cancel.disabled=s.pending;save.disabled=s.pending||s.blocked;
  dialog.append(element('h3','','修改备注'),input);describeOperation(dialog,s.message);dialog.append(element('div','router-client-name-actions',cancel,save));overlay.append(dialog);page.append(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)s.cancel();});dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();s.cancel();}else if(e.key==='Enter'&&e.target===input){e.preventDefault();void s.save();}else if(e.key==='Tab'){const items=[input,cancel,save].filter(item=>!item.disabled),i=items.indexOf(document.activeElement as HTMLInputElement);if(items.length&&(e.shiftKey&&i<=0||!e.shiftKey&&i===items.length-1)){e.preventDefault();items[e.shiftKey?items.length-1:0].focus();}}});queueMicrotask(()=>{if(input.isConnected&&!input.disabled){input.focus();input.select();}});
 }
 return deviceSurfaces(stage);
}
