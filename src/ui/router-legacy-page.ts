import {describeOperation} from './operation-feedback';
import type {Device,RouterClient} from '../types';
import {connectionLabel,routerClientQuality,routerClients,routerEventTime,routerSpeed,type RouterState,type RouterView} from '../router';
import {button,element} from './dom';
import {deviceWait} from './device-loading';
import {icon,officialIcon} from '../icons';
import type {RouterIndicatorState} from '../router-indicator';
import {routerIndicatorPage} from './router-indicator-page';
import type {RouterWifiState} from '../router-wifi';
import {routerWifiPage} from './router-wifi-page';
import type {RouterAdvancedState} from '../router-advanced';import type {RouterAdvancedField} from '../types';import {routerAdvancedPage} from './router-advanced-page';
import type {RouterInternetState} from '../router-internet';
import {routerInternetPage} from './router-internet-page';
import type {RouterNetworkState} from '../router-network';
import {routerNetworkPage} from './router-network-page';
import type {RouterPasswordState} from '../router-password';
import {routerPasswordCard,routerPasswordDialog} from './router-password-card';
import type {RouterClientNameState} from '../router-client-name';
import {canonicalClientMac,commonSections,type RouterCommonState} from '../router-common';
import type {RouterClassificationState} from '../router-classification';
import {routerClassificationPage} from './router-classification-page';
import type {RouterQosState} from '../router-qos';
import type {RouterFamilyState} from '../router-family';
import {routerClientFamily,routerFamilyPage} from './router-family-page';
import type {RouterUrlState} from '../router-url';
import {routerClientUrl,routerUrlPage} from './router-url-page';
import type {RouterAccessState} from '../router-access';
import type {RouterBlockRecordsState} from '../router-block-records';
import {routerBlockRecordsPage} from './router-block-records-page';
import {routerClientAccess,routerAccessDialog,routerAccessPage} from './router-access-page';
import {routerClientQos,routerQosDialog,routerQosPage} from './router-qos-page';
export interface RouterPageProps {daily?:import('../router-daily').RouterDailyState;family?:RouterFamilyState;url?:RouterUrlState;records?:RouterBlockRecordsState;access?:RouterAccessState;qos?:RouterQosState;classification?:RouterClassificationState;common?:RouterCommonState;savedCommon?:string[];commonPending?:boolean;commonError?:string;toggleCommon?:(mac:string)=>void;manageCommon?:()=>void;saveCommon?:()=>void;clientName?:RouterClientNameState;password?:RouterPasswordState;network:RouterNetworkState;saveNetwork:(confirmed:boolean)=>void;ackNetwork:()=>void;internet:RouterInternetState;saveInternet:(confirmed:boolean)=>void;device:Device;state:RouterState;indicator:RouterIndicatorState;wifi:RouterWifiState;advanced:RouterAdvancedState;view:RouterView;busy:boolean;artwork:()=>HTMLElement;back:()=>void;navigate:(view:RouterView)=>void;saveIndicator:(confirmedOff:boolean)=>void;saveWifi:(confirmed:boolean)=>void;requestAdvanced:(f:RouterAdvancedField)=>void;confirmAdvanced:()=>void;saveAdvanced:()=>void;respondDfs:(proceed:boolean)=>void}
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
export function routerPage(p:RouterPageProps):HTMLElement {
 if(p.view.page==='family'&&p.family)return routerFamilyPage(p.family,()=>{p.family!.leave();p.navigate({...p.view,page:'client'});});
 if(['website','urlBlack','urlWhite'].includes(p.view.page)&&p.url)return routerUrlPage(p.url,p.view.page==='urlBlack'?'black':p.view.page==='urlWhite'?'white':undefined,()=>p.navigate({...p.view,page:p.view.page==='website'?'client':'website'}),list=>p.navigate({...p.view,page:list==='black'?'urlBlack':'urlWhite'}));
 if(p.view.page==='blockRecords'&&p.records)return routerBlockRecordsPage(p.records,()=>p.navigate({...p.view,page:'access'}));
 if((p.view.page==='access'||p.view.page==='filterList')&&p.access)return routerAccessPage({state:p.access,device:p.device,list:p.view.page==='filterList',back:()=>p.navigate({...p.view,page:p.view.page==='filterList'?'access':p.view.accessBack??'safety'}),backLabel:p.view.page==='filterList'?'返回防蹭网':p.view.accessBack==='client'?'返回设备详情':'返回安全管理',openList:()=>p.navigate({...p.view,page:'filterList'}),records:p.records?()=>p.navigate({...p.view,page:'blockRecords'}):undefined,wifi:()=>p.navigate({...p.view,page:'wifi'})});
 if(p.view.page==='qos'&&p.qos)return routerQosPage(p.qos,p.device,()=>p.navigate({...p.view,page:p.view.mac?'client':'networkTools'}),p.view.mac?'返回设备详情':'返回网络管理');
 if(p.view.page==='classify'&&p.classification)return routerClassificationPage(p.classification,p.device,()=>p.navigate({...p.view,page:'client'}));
 if(p.view.page==='ports'||p.view.page==='ipv6')return routerNetworkPage({device:p.device,state:p.network,busy:p.busy,artwork:p.artwork,back:()=>p.navigate({...p.view,page:'internet'}),changed:()=>p.navigate({...p.view}),save:p.saveNetwork,ack:p.ackNetwork});
 if(p.view.page==='internet')return routerInternetPage({device:p.device,state:p.internet,busy:p.busy,artwork:p.artwork,back:()=>p.navigate({...p.view,page:'home'}),wifi:()=>p.navigate({...p.view,page:'wifi'}),changed:()=>p.navigate({...p.view}),save:p.saveInternet,ports:()=>p.navigate({...p.view,page:'ports'}),ipv6:()=>p.navigate({...p.view,page:'ipv6'})});
 if(p.view.page==='wifi')return routerWifiPage({device:p.device,state:p.wifi,busy:p.busy,artwork:p.artwork,back:()=>p.navigate({...p.view,page:'home'}),changed:()=>p.navigate({...p.view}),save:p.saveWifi,internet:()=>p.navigate({...p.view,page:'internet'}),advanced:()=>p.navigate({...p.view,page:'advanced'})});
 if(p.view.page==='advanced')return routerAdvancedPage({device:p.device,state:p.advanced,wifi:p.wifi,busy:p.busy,artwork:p.artwork,back:()=>p.navigate({...p.view,page:'wifi'}),done:()=>p.navigate({...p.view,page:'home'}),changed:()=>p.navigate({...p.view}),request:p.requestAdvanced,confirm:p.confirmAdvanced,save:p.saveAdvanced,dfs:p.respondDfs});
 if(p.view.page==='indicator')return routerIndicatorPage({device:p.device,state:p.indicator,timerSupported:p.state.report?.indicatorTimerSupported===true,busy:p.busy,artwork:p.artwork,back:()=>p.navigate({...p.view,page:'settings'}),changed:()=>p.navigate({...p.view}),save:p.saveIndicator});
 const v=p.view,s=p.state,r=s.report,stage=element('div','device-stage'),page=element('section',`device-page page-router page-router-${v.page}`);
 stage.append(page);page.dataset.routerView=v.page;page.dataset.routerLoading=String(s.loading);page.setAttribute('aria-busy',String(s.loading));
 const go=(page:RouterView['page'],mac?:string)=>p.navigate({...v,page,mac});
 const back=button('','page-icon-button',v.page==='home'?p.back:()=>go(v.page==='client'?'clients':v.page==='common'?'client':'home',v.mac),'back');back.setAttribute('aria-label',v.page==='home'?'返回家庭':v.page==='client'?'返回设备管理':v.page==='common'?'返回设备详情':'返回路由器');
 const header=element('header','device-page-header',back);if(v.page==='home'||v.page==='settings'||v.page==='networkTools'||v.page==='safety')header.append(element('div','device-page-title',element('h2','',v.page==='home'?p.device.name:v.page==='networkTools'?'网络管理':v.page==='safety'?'安全管理':'路由设置')));page.append(header);
 const body=element('div','device-page-scroll router-content');page.append(body);
 if(v.page==='clients'||v.page==='client'||v.page==='common')body.append(element('h1','router-title',v.page==='clients'?'设备管理':v.page==='common'?'常用设备':'设备详情'));
 if(!r&&s.loading){body.append(deviceWait(p.artwork,p.device.name,false));return stage;}
 if(s.error&&!r){const note=element('p','router-warning',s.error.message);note.setAttribute('role','alert');body.append(note);}
 if(v.page==='home'){
  const hero=element('section','router-hero'),normal=!!r&&r.network==='ok'&&!s.error&&p.device.online;
  hero.append(element('h1',`router-network${normal?' normal':''}`,!p.device.online?'路由器已离线':normal?'网络连接正常':'网络状态未确认'));
  const speeds=element('div','router-speeds');for(const[kind,value]of [['up',r?.uploadBps],['down',r?.downloadBps]]as const){const speed=routerSpeed(value),digits=element('strong','router-speed-value');
   if(speed.value==='--')digits.textContent='--';else{const padded=speed.value.padStart(3,'0');[...padded].forEach((digit,index)=>digits.append(element('span',index<padded.length-speed.value.length?'placeholder':'',digit)));}
   const row=element('div','router-speed',digits,element('div','router-speed-unit',officialIcon('router:arrow-'+kind,'router-speed-arrow'),element('span','',speed.unit)));row.setAttribute('aria-label',`${kind==='up'?'上传速度':'下载速度'} ${speed.value}${speed.unit}`);speeds.append(row);
  }hero.append(speeds,element('p','router-features',[r?.wifi7?'Wi-Fi 7':'',r?.mesh?'Mesh':''].filter(Boolean).join(' | ')),networkIllustration());page.insertBefore(hero,body);
  body.addEventListener('scroll',()=>{hero.style.opacity=String(1-Math.min(Math.max(body.scrollTop,0),360)/360);},{passive:true});
  const toolbar=element('div','router-toolbar');for(const[symbol,label]of [['wifi','Wi-Fi设置'],['boost','Wi-Fi优化'],['mesh','Mesh设备'],['speed','场景测速']]as const){const item=symbol==='wifi'?button('','router-unavailable-feature router-wifi-entry',()=>go('wifi')):element('div','router-unavailable-feature');item.append(element('span','router-feature-symbol',routerSymbol(symbol)),element('span','',label));if(symbol!=='wifi')item.setAttribute('aria-description','此专用功能尚未适配');toolbar.append(item);}body.append(toolbar);
  const list=element('section','router-menu');
  list.append(routerPasswordCard(p.password));
  const devices=button('','router-menu-row',()=>go('clients'));devices.append(element('strong','','设备管理'),element('span','',String(routerClients(r,'online')?.length??'--')),icon('chevron'));list.append(devices);body.append(list);
  const tiles=element('div','router-settings-tiles'),settings=button('','router-settings-entry',()=>go('settings'));settings.append(routerSymbol('router'),element('span','','路由设置'));const network=button('','router-settings-entry',()=>go('networkTools'));network.append(routerSymbol('network'),element('span','','网络管理'));const safety=button('','router-settings-entry',()=>go('safety'));safety.append(element('span','router-setting-symbol',icon('grid')),element('span','','安全管理'));tiles.append(settings,network,safety);body.append(tiles);
 }else if(v.page==='clients'){
  const tabs=element('div','router-tabs');tabs.setAttribute('role','tablist');
  for(const[tab,label]of [['online','在线'],['offline','离线'],['filter',r?.filterMode==='white'?'白名单':r?.filterMode==='black'?'黑名单':'访问控制']]as const){const items=routerClients(r,tab),b=button(`${label} ${items?.length??'--'}`,'router-tab',()=>p.navigate({...v,tab}));b.setAttribute('role','tab');b.setAttribute('aria-selected',String(v.tab===tab));tabs.append(b);}body.append(tabs);if(v.tab==='filter'&&p.access){const manage=button('管理名单','router-access-manage',()=>p.navigate({...v,page:'access',accessBack:'clients'}));body.append(manage);}
  const items=routerClients(r,v.tab);
  if(items===null)body.append(element('p','router-empty','设备列表暂不可用。'));
  else if(!items.length)body.append(element('p','router-empty','暂无设备'));
  else {const groups=v.tab==='filter'?[{title:r?.filterMode==='white'?'白名单设备':r?.filterMode==='black'?'黑名单设备':'访问控制名单',items}]:[...(()=>{const split=commonSections(items,p.savedCommon??[]);return[...(split.common.length?[{title:'常用设备',items:split.common}]:[]),{title:v.tab==='online'?'在线设备':'离线设备',items:split.other}];})()];for(const group of groups){if(!group.items.length)continue;body.append(element('p','router-list-label',group.title));for(const client of group.items){const b=button('','router-client',()=>go('client',client.mac)),info=element('div','router-client-info',element('strong','',client.name));
   if(client.online===true){const speed=routerSpeed(client.downloadBps);info.append(element('p','router-client-speed',officialIcon('router:arrow-down'),`${speed.value}${speed.unit}`));}
   info.append(element('p','router-client-meta',[connectionLabel(client.connection),routerEventTime(client.eventTime)].filter(Boolean).join('  ')));b.append(artwork(client),info);body.append(b);
  }}}
 }else if(v.page==='client'){
  const client=[...(r?.clients??[]),...(r?.filteredClients??[])].find(c=>c.mac===v.mac);
  if(!client)body.append(element('p','router-empty','设备已不在当前列表中。'));
  else{const speeds=element('p','router-client-detail-speeds');for(const[label,value] of [['up',client.uploadBps],['down',client.downloadBps]] as const){const speed=routerSpeed(value);speeds.append(element('span','',officialIcon('router:arrow-'+label),`${speed.value}${speed.unit}`));}const info=element('div','router-client-detail-info',element('h2','',client.name),speeds);body.append(element('section','router-client-detail',artwork(client),info));if(client.online!==true)body.append(element('p','router-warning',client.online===false?'设备已离线':'设备状态未确认'));
   body.append(element('h3','router-list-label','设备信息'));
   const card=element('div','router-details router-client-name-card'),rename=button('','router-client-name-row',()=>p.clientName?.open());rename.append(element('span','','设备名称'),element('span','router-client-name-value',client.name),icon('chevron'));
   rename.disabled=!p.clientName||p.busy||!p.device.online||!!p.device.sharedReadOnly||p.clientName.blocked||p.clientName.pending||!/^([a-f\d]{2}:){5}[a-f\d]{2}$/i.test(client.mac)||(r?.clients??[]).filter(item=>item.mac.toLowerCase()===client.mac.toLowerCase()).length!==1;const classification=button('','router-client-classification-row',()=>go('classify',client.mac));classification.disabled=!p.classification||!/^([a-f\d]{2}:){5}[a-f\d]{2}$/i.test(client.mac);const classReport=p.classification?.report;classification.append(element('span','','设备信息'),element('span','router-classify-value',classReport?.mac.toLowerCase()===client.mac.toLowerCase()?classReport.summary:''),icon('chevron'));card.append(rename,classification);body.append(card);
   describeOperation(body,p.clientName?.message);
   if(p.device.sharedReadOnly)body.append(element('p','router-warning','此共享路由器的云端控制只有读取权限，本机常用设备设置仍可使用。'));
   body.append(element('h3','router-list-label','网络信息'));const details=element('dl','router-details');for(const[label,value]of [['IP地址',client.ip??'--'],['MAC地址',client.mac]])details.append(element('div','',element('dt','',label),element('dd','',value)));body.append(details);
   const quality=routerClientQuality(client);if(quality.length){const card=element('dl','router-details router-client-quality');for(const[label,value] of quality)card.append(element('div','',element('dt','',label),element('dd','',value)));body.append(element('h3','router-list-label','网络质量'),card);}
   if(p.common&&p.savedCommon&&p.toggleCommon){const mac=canonicalClientMac(client.mac),on=!!mac&&p.savedCommon.includes(mac),toggle=button('','router-common-switch-row',()=>{if(mac)p.toggleCommon?.(mac);});toggle.dataset.focusKey='router-common-toggle';toggle.setAttribute('role','switch');toggle.setAttribute('aria-label','设为常用设备');toggle.setAttribute('aria-checked',String(on));toggle.disabled=!mac||!!p.commonPending;toggle.append(element('span','router-common-switch-copy',element('strong','','设为常用设备'),element('small','','设置后可在设备管理中快速查看')),element('span',`purifier-settings-switch${on?' checked':''}`));body.append(element('h3','router-list-label','基础设置'),toggle);}
   if(p.access)body.append(routerClientAccess(p.access,client.mac,p.device));
   if(p.commonError){const note=element('p','router-warning',p.commonError);note.setAttribute('role','alert');body.append(note);}
   body.append(element('h3','router-list-label','特殊设置'));if(p.family)body.append(routerClientFamily(p.family,()=>{p.family!.start();go('family',client.mac);}));if(p.url)body.append(routerClientUrl(p.url,()=>go('website',client.mac),!!p.family?.report?.supported));if(p.qos)body.append(routerClientQos(p.qos,p.device));body.append(element('p','router-warning',p.family?.report?.supported?'磁盘权限设置仍在适配。':'禁止联网时段和磁盘权限设置仍在适配。'));}
 }else if(v.page==='common'){
  const state=p.common,items=state?.draft??[],known=[...(r?.clients??[]),...(r?.filteredClients??[])];
  const name=(mac:string)=>known.find(c=>c.mac.toUpperCase()===mac)?.name??mac;
  body.append(element('p','router-list-label',`已添加的常用设备（${items.length}/5）`));
  for(const mac of items){const remove=button('移除','router-common-remove',()=>state?.remove(mac));remove.setAttribute('aria-label',`移除 ${name(mac)}`);const row=element('div','router-common-manage-row',element('span','',name(mac)),remove);row.draggable=true;row.tabIndex=0;row.dataset.focusKey=`router-common-${mac}`;row.setAttribute('aria-label',`${name(mac)}，可用上下方向键调整顺序`);row.addEventListener('dragstart',()=>{if(state)state.dragMac=mac;});row.addEventListener('dragover',e=>e.preventDefault());row.addEventListener('drop',e=>{e.preventDefault();if(state?.dragMac)state.move(state.dragMac,mac);if(state)state.dragMac=undefined;});row.addEventListener('dragend',()=>{if(state)state.dragMac=undefined;});row.addEventListener('keydown',e=>{if(e.target!==row||!state?.draft||!['ArrowUp','ArrowDown'].includes(e.key))return;const index=state.draft.indexOf(mac),target=state.draft[index+(e.key==='ArrowUp'?-1:1)];if(target){e.preventDefault();state.move(mac,target);}});body.append(row);}
  if(state?.candidates.length){body.append(element('p','router-list-label','待添加的常用设备'));for(const mac of state.candidates){const add=button('添加','router-common-add',()=>state.add(mac));add.disabled=items.length>=5;add.setAttribute('aria-label',`添加 ${name(mac)}`);body.append(element('div','router-common-manage-row',element('span','',name(mac)),add));}}
  describeOperation(body,state?.message);const save=button('保存','router-common-save',()=>p.saveCommon?.());save.disabled=!state?.draft||!!p.commonPending||JSON.stringify(state.baseline)===JSON.stringify(state.draft);page.append(save);
 }else if(v.page==='safety'){
  const row=button('','router-setting-row router-access-entry',()=>p.navigate({...v,page:'access',accessBack:'safety'}));row.append(element('span','router-setting-symbol',icon('grid')),element('strong','','防蹭网'),icon('chevron'));body.append(row,element('p','router-warning','其他安全管理功能暂未支持。'));
 }else if(v.page==='networkTools'){
  const row=button('','router-setting-row router-qos-entry',()=>go('qos'));row.append(element('span','router-setting-symbol',routerSymbol('speed')),element('strong','','QoS限速'),icon('chevron'));body.append(row,element('p','router-warning','其他网络管理功能暂未支持。'));
 }else{
  for(const title of ['重启路由','管理密码','恢复路由器出厂设置','指示灯控制','升级助手','Mesh设备','自定义Hosts']){
   const row=title==='指示灯控制'?button('','router-setting-row',()=>go('indicator')):element('div','router-setting-row unavailable');
   row.append(element('span','router-setting-symbol',icon(title==='指示灯控制'?'light':'grid')),element('strong','',title));
   if(title==='指示灯控制')row.append(icon('chevron'));else row.append(element('small','','暂未支持'));
   body.append(row);
  }
  body.append(element('p','router-warning',`固件版本 ${r?.firmware??'--'}`));
 }
 if(v.page==='client'&&p.access){const dialog=routerAccessDialog(p.access,()=>p.navigate({...v,page:'access',accessBack:'client'}));if(dialog)page.append(dialog);}
 if(v.page==='client'&&p.qos){const dialog=routerQosDialog(p.qos,()=>p.navigate({...v,page:'qos'}));if(dialog)page.append(dialog);}
 if(v.page==='home'&&p.password){const dialog=routerPasswordDialog(p.password);if(dialog)page.append(dialog);}
 if(v.page==='client'&&p.common?.limitMac){const state=p.common,overlay=element('div','router-modal-backdrop'),dialog=element('section','router-confirm router-common-limit');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','无法添加常用设备');dialog.tabIndex=-1;dialog.append(element('h3','','无法添加常用设备'),element('p','','已超出5台常用设备上限，请编辑已添加的常用设备。'),element('footer','',button('取消','',()=>state.dismiss()),button('去设置','',()=>p.manageCommon?.())));overlay.append(dialog);page.append(overlay);overlay.addEventListener('click',e=>{if(e.target===overlay)state.dismiss();});dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();state.dismiss();}else if(e.key==='Tab'){const controls=[...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=controls.indexOf(document.activeElement as HTMLButtonElement);if(e.shiftKey&&index<=0||!e.shiftKey&&index===controls.length-1){e.preventDefault();controls[e.shiftKey?controls.length-1:0]?.focus();}}});queueMicrotask(()=>{if(dialog.isConnected)dialog.focus();});}
 if(v.page==='client'&&p.clientName?.modalOpen){
  const s=p.clientName,overlay=element('div','router-modal-backdrop router-client-name-backdrop'),dialog=element('section','router-client-name-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','修改备注');
  const input=element('input','router-client-name-input');input.value=s.draft;input.maxLength=24;input.setAttribute('aria-label','设备名称');input.disabled=s.pending;input.addEventListener('input',()=>{s.draft=input.value;});
  const cancel=button('取消','router-client-name-cancel',()=>s.cancel()),save=button('确定','router-client-name-save',()=>{void s.save();});cancel.disabled=s.pending;save.disabled=s.pending||s.blocked;
  dialog.append(element('h3','','修改备注'),input);describeOperation(dialog,s.message);dialog.append(element('div','router-client-name-actions',cancel,save));overlay.append(dialog);page.append(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)s.cancel();});dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();s.cancel();}else if(e.key==='Enter'&&e.target===input){e.preventDefault();void s.save();}else if(e.key==='Tab'){const items=[input,cancel,save].filter(item=>!item.disabled),i=items.indexOf(document.activeElement as HTMLInputElement);if(items.length&&(e.shiftKey&&i<=0||!e.shiftKey&&i===items.length-1)){e.preventDefault();items[e.shiftKey?items.length-1:0].focus();}}});queueMicrotask(()=>{if(input.isConnected&&!input.disabled){input.focus();input.select();}});
 }
 for(const warning of r?.warnings??[])body.append(element('p','router-warning',warning));
 return stage;
}
