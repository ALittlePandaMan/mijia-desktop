import {invoke, isTauri} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {monitorInBackground, ResourceRevisions, type ResourceState} from './background-work';
import {adoptFullscreen, nativeFullscreen, setNativeFullscreen} from './desktop-fullscreen';
import {normalizeError} from './logic';
import {readMonitorCatalog, selectedMonitorMembers,type MonitorCatalog} from './monitor-catalog';
import {listenResourceState} from './resource-events';
import {setupDesktopFrame} from './ui/desktop-frame';
import {button, element} from './ui/dom';
import {MonitorWall} from './ui/monitor-wall';
import {showToast} from './ui/toast';
import './style.css';
import './theme.css';

const REFRESH_MS=5*60*1000;
const root=document.querySelector<HTMLElement>('#app')!;
const lifetime=new AbortController();
const {signal}=lifetime;
const revisions=new ResourceRevisions();
let opening=false, lastRead=0, minimized=false, nativeBackground:boolean|undefined, covered=false;
let catalog:MonitorCatalog|undefined,selectedHome:string|null|undefined,allowAll=false;
const exit=()=>{if(isTauri())void getCurrentWindow().close().catch(()=>{});};
const status=element('main','monitor-empty monitor-window-status');
status.setAttribute('role','status');
const wall=new MonitorWall(exit,error=>{
 if(normalizeError(error).kind==='authExpired')exit();
},undefined,'window');

function showStatus(message:string,retry=false):void{
 document.body.classList.add('monitor-mode');
 status.replaceChildren(element('span','',message));
 if(retry)status.append(button('重试','monitor-retry',()=>{void load(true);}));
 root.replaceChildren(status);
}

function syncHomePicker():void{
 if(!catalog)return;
 const homes=catalog.availableHomes??catalog.homes.map(item=>item.home);
 wall.setHomeChoices(homes,selectedHome??null,allowAll,id=>{void load(false,id);},opening);
}

async function load(force=false,homeId=selectedHome):Promise<void>{
 const switching=selectedHome!==undefined&&homeId!==selectedHome;
 if(opening||signal.aborted||switching&&!wall.canSwitchHome)return;
 opening=true;
 syncHomePicker();
 try{
  const view=await readMonitorCatalog(force,homeId??undefined);
  if(signal.aborted||switching&&!wall.canSwitchHome)return;
  if(catalog&&view.scope!==catalog.scope){exit();return;}
  if(!catalog)allowAll=view.allHomes;
  catalog=view;
  selectedHome=homeId===undefined?(view.allHomes?null:view.homes[0]?.home.id??null):homeId;
  lastRead=Date.now();
  if(view.incomplete&&!selectedMonitorMembers(view,selectedHome??undefined).length){
   wall.close();
   showStatus('摄像头列表读取失败',true);
   return;
  }
  if(!root.contains(wall.root))root.replaceChildren(wall.root);
  wall.updateAll(view,selectedHome??undefined);
 }catch(error){
  if(signal.aborted)return;
  const failure=normalizeError(error);
  if(failure.kind==='authExpired'){exit();return;}
  if(!switching&&failure.kind==='permissionDenied')wall.close();
  if(!wall.active)showStatus(failure.message,true);
  else if(switching)showToast(root,failure.message,false);
 }finally{
  opening=false;
  if(!signal.aborted)syncHomePicker();
 }
}

function syncVisibility():void{
 const background=monitorInBackground(nativeBackground,minimized,false);
 wall.setPaused(background,covered||document.hidden);
 if(!background&&Date.now()-lastRead>=REFRESH_MS)void load();
}

function acceptResources(state:ResourceState):void{
 if(!revisions.accept(state))return;
 nativeBackground=state.monitorBackground;
 covered=!state.visible;
 syncVisibility();
}

function subscribe(registration:Promise<()=>void>):void{
 void registration.then(unlisten=>{
  if(signal.aborted)unlisten();
  else signal.addEventListener('abort',unlisten,{once:true});
 }).catch(()=>{});
}

setupDesktopFrame('米家监控');
window.addEventListener('monitor-exit',exit,{signal});
window.addEventListener('desktop-window-state',event=>{
 minimized=!!(event as CustomEvent<{minimized:boolean}>).detail.minimized;
 syncVisibility();
},{signal});
document.addEventListener('visibilitychange',syncVisibility,{signal});
document.addEventListener('keydown',event=>{
 if(event.key!=='Escape')return;
 event.preventDefault();event.stopImmediatePropagation();
 if(wall.dismissPopup()||wall.leaveTileFullscreen())return;
 if(!document.fullscreenElement&&nativeFullscreen())void setNativeFullscreen(false).catch(()=>{});
 else wall.handleEscape();
},{signal,capture:true});

if(isTauri()){
 const label=getCurrentWindow().label;
 subscribe(listenResourceState(label,acceptResources));
 subscribe(listen<{fullscreen:boolean;minimized:boolean;visible:boolean}>('desktop-native-state',({payload})=>{
  adoptFullscreen(payload.fullscreen);
  minimized=payload.minimized||!payload.visible;
  syncVisibility();
 },{target:label}));
 subscribe(listen<string>('desktop-monitor-focus-camera',({payload})=>wall.focusDevice(payload),{target:label}));
 void invoke<ResourceState>('desktop_resource_snapshot').then(acceptResources).catch(()=>{});
 showStatus('正在读取摄像头…');
 void load();
}else showStatus('请在桌面客户端中打开监控');

const refresh=setInterval(syncVisibility,REFRESH_MS);
window.addEventListener('pagehide',()=>{lifetime.abort();clearInterval(refresh);wall.close();},{once:true});
