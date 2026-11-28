import type {AppError,Device} from '../types';
import type {DesktopPadding} from '../desktop-widgets';
import type {LocalPreferences,PreferenceChange} from '../local-preferences';
import {button,element} from './dom';
import {icon} from '../icons';
import {deviceWait} from './device-loading';
import {monitorEligible} from '../monitor';
import {mediaStorageSettings} from './media-storage-settings';
import {settingsNavigationIcon} from './settings-navigation-icons';
import {settingsCopy,settingsGroup,settingsSwitch} from './settings-content';
import {deviceArtwork} from './device-artwork';
import {desktopGridSettings} from './settings-desktop-grid';
import './settings-page.css';
import {selectedMonitorMembers,type MonitorCatalogController} from '../monitor-catalog';

type SettingsList='monitor'|'homeHidden'|'hidden';
const categories=[
 {id:'application',title:'应用与启动',home:false},
 {id:'display',title:'显示与排列',home:false},
 {id:'desktop',title:'桌面卡片',home:false},
 {id:'monitor',title:'监控设置',home:false},
 {id:'mcp',title:'MCP',home:false},
 {id:'hidden',title:'隐藏设备',home:true},
 {id:'about',title:'关于',home:false},
]as const;
export type SettingsCategory=typeof categories[number]['id'];
/** Transient UI only: never serialize with home or media preferences. */
export interface SettingsPanelState{desktopPaddingDrafts?:Map<string,DesktopPadding>;selectedDesktopDisplayId?:string;expanded?:SettingsList;listContext?:string;scrollTop:number;focusKey:string;focusFallback?:string;focusAlternatives?:string[];inputDrafts?:Record<string,{value:string;baseline:string}>}
export interface SettingsViewState{category:SettingsCategory;panels:Record<SettingsCategory,SettingsPanelState>;sidebarScrollTop:number;focusKey:string}
export function createSettingsViewState(category:SettingsCategory='application'):SettingsViewState{
 const panels=Object.fromEntries(categories.map(({id})=>[id,{scrollTop:0,focusKey:`settings-section-${id}`}]))as Record<SettingsCategory,SettingsPanelState>;
 return{category,panels,sidebarScrollTop:0,focusKey:`settings-nav-${category}`};
}
interface SettingsOwner{view:SettingsViewState;category:SettingsCategory;panel:SettingsPanelState}
const owners=new WeakMap<HTMLElement,SettingsOwner>();
function rememberSettingsFocus(page:HTMLElement,owner:SettingsOwner):void{
 const active=document.activeElement;if(!(active instanceof HTMLElement)||!page.contains(active)||!active.dataset.focusKey)return;
 owner.view.focusKey=active.dataset.focusKey;if(!active.closest('.settings-scroll'))return;
 const view=owner.panel;view.focusKey=active.dataset.focusKey;view.focusFallback=active.closest<HTMLElement>('[data-settings-focus-group]')?.dataset.settingsFocusGroup;
 const panel=active.closest('.settings-list-panel'),controls=panel?[...panel.querySelectorAll<HTMLElement>('[data-focus-key]')]:[],index=controls.indexOf(active);
 view.focusAlternatives=index<0?[]:[...controls.slice(index+1),...controls.slice(0,index).reverse()].map(node=>node.dataset.focusKey!);
}
export function captureSettingsView(root:ParentNode,view:SettingsViewState):void{
 const page=root.querySelector<HTMLElement>('.settings-page'),owner=page&&owners.get(page);if(!page||owner?.view!==view)return;
 owner.panel.scrollTop=page.querySelector('.settings-scroll')?.scrollTop??owner.panel.scrollTop;
 // Desktop padding owns per-screen drafts; a second generic copy could revive a reset value.
 for(const input of page.querySelectorAll<HTMLInputElement>('input.settings-number[data-focus-key]')){if(input.closest('.settings-desktop-layout'))continue;const key=input.dataset.focusKey!;if(input.value!==input.defaultValue)(owner.panel.inputDrafts??={})[key]={value:input.value,baseline:input.defaultValue};else if(owner.panel.inputDrafts)delete owner.panel.inputDrafts[key];}
 view.sidebarScrollTop=page.querySelector('.settings-sidebar')?.scrollTop??view.sidebarScrollTop;
 rememberSettingsFocus(page,owner);
}
export function restoreSettingsView(root:ParentNode,view:SettingsViewState):void{
 const page=root.querySelector<HTMLElement>('.settings-page'),owner=page&&owners.get(page);if(!page||owner?.view!==view)return;
 const panel=owner.panel,scroll=page.querySelector<HTMLElement>('.settings-scroll'),sidebar=page.querySelector<HTMLElement>('.settings-sidebar');if(scroll)scroll.scrollTop=panel.scrollTop;if(sidebar)sidebar.scrollTop=view.sidebarScrollTop;
 for(const input of page.querySelectorAll<HTMLInputElement>('input.settings-number[data-focus-key]')){if(input.closest('.settings-desktop-layout'))continue;const key=input.dataset.focusKey!,draft=panel.inputDrafts?.[key];if(draft){if(draft.baseline===input.defaultValue)input.value=draft.value;else delete panel.inputDrafts![key];}}
 // Screen settings arrive asynchronously; wait for their controls before resolving saved focus.
 if(page.querySelector('.settings-desktop-layout[data-loading=true]'))return;
 const controls=[...page.querySelectorAll<HTMLElement>('[data-focus-key]')],available=(node:HTMLElement)=>!node.closest('[hidden]')&&!node.matches(':disabled');
 const byKey=(key?:string)=>controls.find(node=>node.dataset.focusKey===key&&available(node)),saved=byKey(view.focusKey);
 const neighbor=panel.focusAlternatives?.map(key=>byKey(key)).find(node=>!!node);
 const target=saved??neighbor??byKey(panel.focusFallback)??byKey(`settings-section-${owner.category}`)??byKey(`settings-nav-${owner.category}`);
 target?.focus({preventScroll:true});if(!saved&&target)target.scrollIntoView({block:'nearest',inline:'nearest'});
 if(scroll)panel.scrollTop=scroll.scrollTop;if(sidebar)view.sidebarScrollTop=sidebar.scrollTop;
}
interface SettingsProps{
 application?:{card:(category:'application'|'mcp'|'about',view:SettingsPanelState)=>HTMLElement};
 monitorCatalog?:MonitorCatalogController;
 monitorWindow?:{separate:boolean;opening:boolean;saving:boolean;change:(enabled:boolean)=>void};
 homeAvailable:boolean;changed:()=>void;
 homeName:string;devices:readonly Device[];preferences?:LocalPreferences;loading:boolean;pending:boolean;error?:AppError;
 view:SettingsViewState;back:()=>void;retry:()=>void;change:(change:PreferenceChange)=>void;artwork:(device:Device)=>HTMLElement;
}
export function settingsPage(props:SettingsProps):HTMLElement{
 const {view}=props;if(!props.homeAvailable&&categories.find(c=>c.id===view.category)?.home){view.category='application';view.focusKey='settings-nav-application';}
 const category=view.category,panelView=view.panels[category],page=element('main','settings-page'),owner={view,category,panel:panelView};owners.set(page,owner);
 const back=button('返回','settings-back',props.back);back.prepend(settingsNavigationIcon('back'));back.setAttribute('aria-label','返回家庭');back.dataset.focusKey='settings-back';
 const sidebar=element('nav','settings-sidebar'),tabs=element('div','settings-navigation'),scroll=element('div','settings-scroll'),content=element('div','settings-content');scroll.append(content);sidebar.append(back,tabs);sidebar.setAttribute('aria-label','设置分类');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-orientation','vertical');tabs.setAttribute('aria-label','设置分类');
 const navButtons:HTMLButtonElement[]=[];
 for(const item of categories){
  const selected=category===item.id,nav=button(item.title,'settings-nav-item',()=>{if(view.category===item.id)return;captureSettingsView(page.parentNode??page,view);view.category=item.id;view.focusKey=`settings-nav-${item.id}`;props.changed();});nav.prepend(settingsNavigationIcon(item.id));
  nav.id=`settings-nav-${item.id}`;nav.dataset.focusKey=nav.id;nav.setAttribute('role','tab');nav.setAttribute('aria-selected',String(selected));if(selected)nav.setAttribute('aria-controls',`settings-panel-${item.id}`);nav.disabled=item.home&&!props.homeAvailable;nav.tabIndex=-1;navButtons.push(nav);tabs.append(nav);
 }
 const focusableNav=navButtons.filter(node=>!node.disabled),navFocus=focusableNav.find(node=>node.id===view.focusKey)??focusableNav.find(node=>node.id===`settings-nav-${category}`);if(navFocus)navFocus.tabIndex=0;
 tabs.addEventListener('focusin',event=>{for(const nav of navButtons)nav.tabIndex=nav===event.target?0:-1;});
 tabs.addEventListener('keydown',event=>{
  const index=focusableNav.indexOf(document.activeElement as HTMLButtonElement);if(index<0)return;
  let target:number|undefined;if(event.key==='ArrowDown')target=(index+1)%focusableNav.length;else if(event.key==='ArrowUp')target=(index-1+focusableNav.length)%focusableNav.length;else if(event.key==='Home')target=0;else if(event.key==='End')target=focusableNav.length-1;
  if(target!==undefined){event.preventDefault();focusableNav[target].focus();}
  else if(event.key==='Tab'&&!event.shiftKey){event.preventDefault();const controls=[...content.querySelectorAll<HTMLElement>('[data-focus-key]')].filter(node=>!node.closest('[hidden]')&&!node.matches(':disabled'));const saved=controls.find(node=>node.dataset.focusKey===panelView.focusKey);(saved??controls.find(node=>node.tabIndex>=0)??scroll).focus({preventScroll:true});}
 });
 scroll.id=`settings-panel-${category}`;scroll.dataset.settingsCategory=category;scroll.setAttribute('role','tabpanel');scroll.setAttribute('aria-labelledby',`settings-nav-${category}`);scroll.tabIndex=-1;
 page.append(element('div','settings-layout',sidebar,scroll));
 scroll.addEventListener('scroll',()=>{if(page.isConnected)panelView.scrollTop=scroll.scrollTop;},{passive:true});
 sidebar.addEventListener('scroll',()=>{if(page.isConnected)view.sidebarScrollTop=sidebar.scrollTop;},{passive:true});
 page.addEventListener('focusin',()=>rememberSettingsFocus(page,owner));
 const section=(id:string,title:string,card:HTMLElement,context='',subsection=false)=>{
  const heading=element(subsection?'h2':'h1','',element('span','',title));heading.tabIndex=-1;heading.dataset.focusKey=`settings-section-${id}`;
  const label=element('header','settings-section-heading',heading);if(context){const name=element('span','settings-section-context',context);name.setAttribute('aria-description',context);label.append(name);}
  const group=element('section','settings-section',label,card);group.setAttribute('aria-label',title);group.dataset.settingsFocusGroup=heading.dataset.focusKey;content.append(group);
 };
 const mediaControls=()=>settingsGroup('截图与录制',mediaStorageSettings());
 if(props.error&&(category==='monitor'||categories.find(item=>item.id===category)?.home)){const retry=button('重试','button button-small button-secondary',props.retry);retry.dataset.focusKey='settings-preferences-retry';const error=element('div','settings-error',element('span','',props.error.message),retry);error.setAttribute('role','alert');content.append(error);}
 if(category==='application'||category==='mcp'||category==='about'){section(category,category==='application'?'应用与启动':category==='about'?'关于':'MCP',props.application?.card(category,panelView)??element('p','settings-empty','设置暂不可用'));return page;}
 if(category==='desktop'){
  const desktop=desktopGridSettings(panelView.desktopPaddingDrafts??=new Map(),panelView);
  desktop.addEventListener('desktop-settings-ready',()=>{if(page.isConnected&&page.parentNode)restoreSettingsView(page.parentNode,view);},{once:true});
  section('desktop','桌面卡片',desktop);return page;
 }
 const preferences=props.preferences;
 if(!preferences){const content=element('div','settings-groups',element('div','settings-card',props.loading?deviceWait(undefined,'设置'):element('p','settings-empty','设置暂不可用')));if(category==='monitor')content.append(mediaControls());section(category,categories.find(item=>item.id===category)!.title,content);return page;}
 page.setAttribute('aria-busy',String(props.pending));
 const lists=new Map<SettingsList,{header:HTMLButtonElement;panel:HTMLElement;populate:()=>HTMLElement;ready:boolean;count:number}>();
 const expand=(id?:SettingsList)=>{
  panelView.expanded=id;
  for(const[key,list]of lists){const open=id===key&&list.count>0;if(open&&!list.ready){list.panel.append(list.populate());list.ready=true;}list.panel.hidden=!open;list.header.setAttribute('aria-expanded',String(open));}
 };
 const disclosure=(id:SettingsList,title:string,count:number,summary:string,populate:()=>HTMLElement,description='',outside=false)=>{
  const header=button('',`settings-disclosure${outside?' settings-group-disclosure':''}`,()=>{if(count)expand(panelView.expanded===id?undefined:id);});header.dataset.focusKey=`settings-list-${id}`;
  header.setAttribute('aria-expanded','false');header.setAttribute('aria-controls',`settings-list-panel-${id}`);header.setAttribute('aria-disabled',String(count===0));
  const amount=element('span','settings-list-count',summary);header.append(settingsCopy(title,description),amount,icon('chevron','settings-disclosure-arrow'));
  const panel=element('div',`settings-list-panel${outside?' settings-card':''}`);panel.id=`settings-list-panel-${id}`;panel.hidden=true;panel.setAttribute('role','group');panel.setAttribute('aria-label',title);
  const group=element('div',`settings-list${outside?' settings-group':' settings-card'}`,header,panel);group.dataset.settingsFocusGroup=header.dataset.focusKey;lists.set(id,{header,panel,populate,ready:false,count});return group;
 };
 if(category==='display'){
 const options=element('div','settings-groups'),display=element('div','settings-card'),order=element('div','settings-card');
 for(const[key,label,description,checked,operation,destination]of[
  ['hide-offline','自动隐藏离线设备','设备离线时自动隐藏，恢复在线后重新显示',preferences.hideOffline,'setHideOffline',display],
  ['split-switches','单键开关独立显示','将单键开关显示为独立的设备卡片',!!preferences.splitSwitches,'setSplitSwitches',display],
  ['drag-locked','锁定设备位置','锁定后无法拖动设备，可避免误操作',preferences.dragLocked,'setDragLocked',order],
 ]as const){const toggle=button('',`settings-toggle${checked?' checked':''}`,()=>props.change({operation,value:!checked}));toggle.setAttribute('role','switch');toggle.setAttribute('aria-checked',String(checked));toggle.setAttribute('aria-label',label);toggle.dataset.focusKey=key;destination.append(element('div','settings-row',settingsCopy(label,description),toggle));}
 const reset=button('恢复米家排序','settings-action',()=>props.change({operation:'resetOrder'}));reset.disabled=!Object.keys(preferences.roomOrders).length;reset.dataset.focusKey='reset-order';
 order.append(element('div','settings-row',settingsCopy('设备排序','清除自定义排序，使用米家中的排列顺序'),reset));options.append(settingsGroup('设备显示',display),settingsGroup('设备排列',order));section('display','显示与排列',options);
 return page;}
 if(category==='monitor'){
 const all=!!preferences.monitorAllHomes,catalog=props.monitorCatalog,view=catalog?.data,monitor=preferences.monitor??{enabled:false,excludedDeviceIds:[]};
 const cameras=all?(view?.homes.flatMap(h=>h.devices)??[]):props.devices.filter(monitorEligible),selected=all?(view?selectedMonitorMembers(view).length:0):cameras.filter(device=>!monitor.excludedDeviceIds.includes(device.did)).length;
 const cameraCount=all?new Set(cameras.map(d=>d.did)).size:cameras.length;
 if(!panelView.listContext){panelView.listContext='monitor';panelView.expanded='monitor';}
 const monitorContent=element('div','settings-groups'),monitorCard=element('div','settings-card'),monitorToggle=button('',`settings-toggle${monitor.enabled?' checked':''}`,()=>props.change({operation:'setMonitorEnabled',value:!monitor.enabled}));
 monitorToggle.setAttribute('role','switch');monitorToggle.setAttribute('aria-checked',String(monitor.enabled));monitorToggle.setAttribute('aria-label','监控模式');monitorToggle.dataset.focusKey='monitor-mode';
 monitorToggle.disabled=!!(props.monitorWindow?.opening||props.monitorWindow?.saving)||!monitor.enabled&&(selected===0||props.pending||!!(all&&(catalog?.loading||catalog?.pending)));
 const scope=button('全屋监控',`settings-action settings-monitor-scope${all?' checked':''}`,()=>props.change({operation:'setMonitorAllHomes',value:!all}));scope.dataset.focusKey='monitor-all-homes';scope.setAttribute('aria-pressed',String(all));scope.disabled=props.pending||!!catalog?.pending;
 monitorCard.append(element('div','settings-row',settingsCopy('监控范围',all?'所有家庭':'当前家庭'),scope));
 monitorCard.append(element('div','settings-row',settingsCopy('监控模式'),monitorToggle));
 if(props.monitorWindow){
  const separate=settingsSwitch('独立窗口',props.monitorWindow.separate,props.monitorWindow.change);
  separate.dataset.focusKey='monitor-separate-window';separate.disabled=props.monitorWindow.opening;
  monitorCard.append(element('div','settings-row',settingsCopy('独立窗口'),separate));
 }
 monitorContent.append(monitorCard,disclosure('monitor','参与监控的设备',cameraCount,`已选择 ${selected} / ${cameraCount} 台`,()=>{
  const list=element('div','settings-monitor-devices');
  const knownDevices=new Map(props.devices.map(device=>[device.did,device]));
  const appendDevice=(device:Device,homeId?:string,excluded=monitor.excludedDeviceIds,homeName?:string)=>{const check=element('input');check.type='checkbox';check.checked=!excluded.includes(device.did);check.setAttribute('aria-label',`监控${[homeName,device.name].filter(Boolean).join(' ')}`);check.dataset.focusKey=`monitor-device-${homeId??''}-${device.did}`;check.addEventListener('change',()=>{if(homeId)catalog?.select(homeId,device.did,!check.checked);else props.change({operation:'setMonitorExcluded',did:device.did,excluded:!check.checked});});
   // Reuse artwork already loaded for this device without fetching full home cards.
   const known=knownDevices.get(device.did),artwork={...device,customIcon:device.customIcon??known?.customIcon,icon:device.icon??known?.icon,productIcon:device.productIcon??known?.productIcon};
   const description=homeName?`${homeName} ${device.roomName||'未分配房间'} ${device.online?'在线':'离线'}`:`${device.roomName||'未分配房间'} · ${device.online?'在线':'离线'}`;
   const name=element('strong','',device.name);name.setAttribute('aria-description',device.name);const copy=element('span','settings-device-name',name,element('small','',description));list.append(element('label','settings-monitor-device',deviceArtwork(artwork,'settings-device-artwork'),copy,check));};
  if(all){for(const home of view?.homes??[])for(const device of home.devices)appendDevice(device,home.home.id,home.excludedDeviceIds,home.home.name);}
  else for(const device of cameras)appendDevice(device);
  return list;
 },'',true),mediaControls());
 if(all&&(catalog?.loading||catalog?.error||view?.incomplete)){const status=element('div','settings-card settings-row',element('p','settings-caption',catalog?.loading?'正在读取摄像头列表':catalog?.error||'部分家庭读取失败，当前列表不完整'));if(!catalog?.loading)status.append(button('重试','settings-action',()=>{void catalog?.load(true);}));monitorContent.insertBefore(status,monitorContent.lastChild);}
 section('monitor','监控设置',monitorContent);
 }else{
 if(!panelView.listContext){panelView.listContext='hidden';panelView.expanded='hidden';}
 const hiddenCard=element('div','settings-groups');
 for(const[id,title,ids,operation,className]of[
  ['homeHidden','仅在全屋隐藏',preferences.homeHiddenDeviceIds??[],'setHomeHidden','home-hidden-devices'],
  ['hidden','已隐藏设备',preferences.hiddenDeviceIds,'setHidden','hidden-devices'],
 ]as const){hiddenCard.append(disclosure(id,title,ids.length,`${ids.length} 台`,()=>{
  const list=element('div',`settings-hidden-devices ${className}`);
  for(const did of ids){const device=props.devices.find(d=>d.did===did),restore=button('取消隐藏','settings-action',()=>props.change({operation,did,hidden:false}));restore.setAttribute('aria-label',`${title}，取消隐藏${device?.name??'已移除的设备'}`);restore.dataset.focusKey=`restore-${operation}-${did}`;
   const titleNode=element('strong','',device?.name??'已移除的设备');titleNode.setAttribute('aria-description',titleNode.textContent??'');
   const name=element('div','settings-device-name',titleNode,element('small','',device?`${device.roomName||'未分配房间'} · ${device.online?'在线':preferences.hideOffline?'离线，自动隐藏中':'离线'}`:'此设备已不在当前家庭'));
   const artwork=device?props.artwork(device):element('span','device-artwork',icon('device'));artwork.classList.add('settings-device-artwork');
   list.append(element('div','settings-row hidden-device-row',artwork,name,restore));}
  return list;
 },id==='homeHidden'?'仅在全屋视图中隐藏，房间内仍可查看':'在全屋和房间内隐藏，可随时恢复'));}
 section('hidden','隐藏设备',hiddenCard);
 }
 // A metadata load can temporarily make the all-home list empty. Preserve the
 // user's disclosure state so the grouped list reappears when loading finishes.
 expand(category==='monitor'?panelView.expanded:panelView.expanded&&lists.get(panelView.expanded)?.count?panelView.expanded:undefined);
 return page;
}
