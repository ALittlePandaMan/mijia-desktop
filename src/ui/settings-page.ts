import type {AppError,Device} from '../types';
import type {LocalPreferences,PreferenceChange} from '../local-preferences';
import {button,element} from './dom';
import {icon} from '../icons';
import {deviceWait} from './device-loading';
import {monitorEligible} from '../monitor';
import {mediaStorageSettings} from './media-storage-settings';
import './settings-page.css';

type SettingsList='monitor'|'homeHidden'|'hidden';
/** Transient UI only: never serialize with home or media preferences. */
export interface SettingsViewState{expanded?:SettingsList;scrollTop:number;focusKey:string;focusFallback?:string;focusAlternatives?:string[]}
export function createSettingsViewState():SettingsViewState{return{scrollTop:0,focusKey:'settings-back'};}
const owners=new WeakMap<HTMLElement,SettingsViewState>();
function rememberSettingsFocus(page:HTMLElement,view:SettingsViewState):void{
 const active=document.activeElement;if(!(active instanceof HTMLElement)||!page.contains(active)||!active.dataset.focusKey)return;
 view.focusKey=active.dataset.focusKey;view.focusFallback=active.closest<HTMLElement>('[data-settings-focus-group]')?.dataset.settingsFocusGroup;
 const panel=active.closest('.settings-list-panel'),controls=panel?[...panel.querySelectorAll<HTMLElement>('[data-focus-key]')]:[],index=controls.indexOf(active);
 view.focusAlternatives=index<0?[]:[...controls.slice(index+1),...controls.slice(0,index).reverse()].map(node=>node.dataset.focusKey!);
}
export function captureSettingsView(root:ParentNode,view:SettingsViewState):void{
 const page=root.querySelector<HTMLElement>('.settings-page');if(!page||owners.get(page)!==view)return;
 view.scrollTop=page.querySelector('.settings-scroll')?.scrollTop??view.scrollTop;
 rememberSettingsFocus(page,view);
}
export function restoreSettingsView(root:ParentNode,view:SettingsViewState):void{
 const page=root.querySelector<HTMLElement>('.settings-page');if(!page||owners.get(page)!==view)return;
 const scroll=page.querySelector<HTMLElement>('.settings-scroll');if(scroll)scroll.scrollTop=view.scrollTop;
 const controls=[...page.querySelectorAll<HTMLElement>('[data-focus-key]')],available=(node:HTMLElement)=>!node.closest('[hidden]')&&!node.matches(':disabled');
 const byKey=(key?:string)=>controls.find(node=>node.dataset.focusKey===key&&available(node)),saved=byKey(view.focusKey);
 const neighbor=view.focusAlternatives?.map(key=>byKey(key)).find(node=>!!node);
 const target=saved??neighbor??byKey(view.focusFallback)??page.querySelector<HTMLElement>('.settings-header button');
 target?.focus({preventScroll:true});if(!saved&&target)target.scrollIntoView({block:'nearest',inline:'nearest'});
 if(scroll)view.scrollTop=scroll.scrollTop;
}
interface SettingsProps{
 homeName:string;devices:readonly Device[];preferences?:LocalPreferences;loading:boolean;pending:boolean;error?:AppError;
 view:SettingsViewState;back:()=>void;retry:()=>void;change:(change:PreferenceChange)=>void;artwork:(device:Device)=>HTMLElement;
}
export function settingsPage(props:SettingsProps):HTMLElement{
 const {view}=props,page=element('main','settings-page');owners.set(page,view);
 const back=button('','page-icon-button',props.back,'back');back.setAttribute('aria-label','返回家庭');back.dataset.focusKey='settings-back';
 const scroll=element('div','settings-scroll'),content=element('div','settings-content');scroll.append(content);
 page.append(element('header','settings-header',back,element('h1','','设置')),scroll);
 scroll.addEventListener('scroll',()=>{if(page.isConnected)view.scrollTop=scroll.scrollTop;},{passive:true});
 page.addEventListener('focusin',()=>rememberSettingsFocus(page,view));
 const section=(id:string,title:string,card:HTMLElement,context='')=>{
  const heading=element('h2','',title);heading.tabIndex=-1;heading.dataset.focusKey=`settings-section-${id}`;
  const label=element('header','settings-section-heading',heading);if(context){const name=element('span','settings-section-context',context);name.title=context;label.append(name);}
  const group=element('section','settings-section',label,card);group.setAttribute('aria-label',title);group.dataset.settingsFocusGroup=heading.dataset.focusKey;content.append(group);
 };
 if(props.error){const error=element('div','settings-error',element('span','',props.error.message),button('重试','button button-small button-secondary',props.retry));error.setAttribute('role','alert');content.append(error);}
 const preferences=props.preferences;
 if(!preferences){content.append(props.loading?deviceWait(undefined,'设置'):element('p','settings-empty','设置暂不可用'));section('media','截图与录制',mediaStorageSettings());return page;}
 page.setAttribute('aria-busy',String(props.pending));
 const lists=new Map<SettingsList,{header:HTMLButtonElement;panel:HTMLElement;populate:()=>HTMLElement;ready:boolean;count:number}>();
 const expand=(id?:SettingsList)=>{
  view.expanded=id;
  for(const[key,list]of lists){const open=id===key&&list.count>0;if(open&&!list.ready){list.panel.append(list.populate());list.ready=true;}list.panel.hidden=!open;list.header.setAttribute('aria-expanded',String(open));}
 };
 const disclosure=(id:SettingsList,title:string,count:number,summary:string,populate:()=>HTMLElement)=>{
  const header=button('','settings-disclosure',()=>{if(count)expand(view.expanded===id?undefined:id);});header.dataset.focusKey=`settings-list-${id}`;
  header.setAttribute('aria-expanded','false');header.setAttribute('aria-controls',`settings-list-panel-${id}`);header.setAttribute('aria-disabled',String(count===0));
  const amount=element('span','settings-list-count',summary);header.append(element('span','settings-disclosure-title',title),amount,icon('chevron','settings-disclosure-arrow'));
  const panel=element('div','settings-list-panel');panel.id=`settings-list-panel-${id}`;panel.hidden=true;panel.setAttribute('role','group');panel.setAttribute('aria-label',title);
  const group=element('div','settings-list',header,panel);group.dataset.settingsFocusGroup=header.dataset.focusKey;lists.set(id,{header,panel,populate,ready:false,count});return group;
 };
 const options=element('div','settings-card');
 for(const[key,label,checked,operation]of[
  ['hide-offline','自动隐藏离线设备',preferences.hideOffline,'setHideOffline'],
  ['drag-locked','锁定设备位置',preferences.dragLocked,'setDragLocked'],
  ['split-switches','单键开关独立显示',!!preferences.splitSwitches,'setSplitSwitches'],
 ]as const){const toggle=button('',`settings-toggle${checked?' checked':''}`,()=>props.change({operation,value:!checked}));toggle.setAttribute('role','switch');toggle.setAttribute('aria-checked',String(checked));toggle.setAttribute('aria-label',label);toggle.dataset.focusKey=key;options.append(element('div','settings-row',element('span','settings-row-label',label),toggle));}
 const reset=button('恢复米家排序','settings-action',()=>props.change({operation:'resetOrder'}));reset.disabled=!Object.keys(preferences.roomOrders).length;reset.dataset.focusKey='reset-order';
 options.append(element('div','settings-row',element('span','settings-row-label','设备排序'),reset));section('display','显示与排列',options);
 const cameras=props.devices.filter(monitorEligible),monitor=preferences.monitor??{enabled:false,excludedDeviceIds:[]},selected=cameras.filter(device=>!monitor.excludedDeviceIds.includes(device.did)).length;
 const monitorCard=element('div','settings-card'),monitorToggle=button('',`settings-toggle${monitor.enabled?' checked':''}`,()=>props.change({operation:'setMonitorEnabled',value:!monitor.enabled}));
 monitorToggle.setAttribute('role','switch');monitorToggle.setAttribute('aria-checked',String(monitor.enabled));monitorToggle.setAttribute('aria-label','监控模式');monitorToggle.dataset.focusKey='monitor-mode';monitorToggle.disabled=selected===0;
 monitorCard.append(element('div','settings-row',element('span','settings-row-label','监控模式'),monitorToggle),disclosure('monitor','参与监控的设备',cameras.length,cameras.length?`${selected} / ${cameras.length} 台`:'0 台',()=>{
  const list=element('div','settings-monitor-devices');
  for(const device of cameras){const check=element('input');check.type='checkbox';check.checked=!monitor.excludedDeviceIds.includes(device.did);check.setAttribute('aria-label',`监控${device.name}`);check.dataset.focusKey=`monitor-device-${device.did}`;check.addEventListener('change',()=>props.change({operation:'setMonitorExcluded',did:device.did,excluded:!check.checked}));
   const name=element('strong','',device.name);name.title=device.name;const copy=element('span','settings-device-name',name,element('small','',`${device.roomName||'未分配房间'} · ${device.online?'在线':'离线'}`));list.append(element('label','settings-monitor-device',copy,check));}
  return list;
 }));section('monitor','监控',monitorCard);
 section('media','截图与录制',mediaStorageSettings());
 const hiddenCard=element('div','settings-card');
 for(const[id,title,ids,operation,className]of[
  ['homeHidden','仅在全屋隐藏',preferences.homeHiddenDeviceIds??[],'setHomeHidden','home-hidden-devices'],
  ['hidden','已隐藏设备',preferences.hiddenDeviceIds,'setHidden','hidden-devices'],
 ]as const){hiddenCard.append(disclosure(id,title,ids.length,`${ids.length} 台`,()=>{
  const list=element('div',`settings-hidden-devices ${className}`);
  for(const did of ids){const device=props.devices.find(d=>d.did===did),restore=button('取消隐藏','settings-action',()=>props.change({operation,did,hidden:false}));restore.setAttribute('aria-label',`${title}，取消隐藏${device?.name??'已移除的设备'}`);restore.dataset.focusKey=`restore-${operation}-${did}`;
   const titleNode=element('strong','',device?.name??'已移除的设备');titleNode.title=titleNode.textContent??'';
   const name=element('div','settings-device-name',titleNode,element('small','',device?`${device.roomName||'未分配房间'} · ${device.online?'在线':preferences.hideOffline?'离线，自动隐藏中':'离线'}`:'此设备已不在当前家庭'));
   list.append(element('div','settings-row hidden-device-row',device?props.artwork(device):element('span','device-artwork'),name,restore));}
  return list;
 }));}
 section('hidden','隐藏设备',hiddenCard,props.homeName);
 expand(view.expanded&&lists.get(view.expanded)?.count?view.expanded:undefined);
 return page;
}
