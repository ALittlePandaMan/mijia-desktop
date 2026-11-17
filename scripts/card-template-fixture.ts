import '../src/style.css';import '../src/theme.css';import '../src/ui/app-font.css';import '../src/ui/home-card.css';import '../src/ui/widget.css';
import {devices,presentations,shortcut as baseShortcut} from './card-template-data';
import {IdentityIndex} from '../src/identity-index';import {CardPress} from '../src/ui/card-press';import {DeviceDrag} from '../src/ui/device-drag';import {sizeDeviceGrid} from '../src/ui/device-grid';import {applyCardMetrics} from '../src/ui/card-metrics';
import {updateHomeShortcut} from '../src/ui/home-shortcut';
import {captionStatuses} from './card-caption-data';
import {PropertyOperations} from '../src/property-operations';
import {projectCardStatus} from '../src/home-card-display';
import type {CardControlChange,CardControlResult,HomeCardPresentation,HomeCardEntry,SwitchGroupResult,Json} from '../src/types';import type {CardSize} from '../src/card-size';
const captionMode=new URLSearchParams(location.search).has('captions'),localFirst=new URLSearchParams(location.search).has('local')||captionMode;
const groupCard:HomeCardEntry={did:'g',kind:'power',selected:false,enabled:true,visible:true,highlight:false,reason:null,binding:{siid:2,piid:1},action:'on',cardType:1,group:{id:'mock-normal-only',revision:1,members:[{id:'2:1',selected:false},{id:'3:1',selected:true}]}};
if(localFirst)devices.push({did:'g',name:'客厅开关',model:'mock.switch',specType:'urn:miot-spec-v2:device:switch:mock:1',online:true,roomId:'mock-room',roomName:'客厅'});
const shortcut=(id:string)=>id==='g'?groupCard:baseShortcut(id);
if(captionMode){for(const p of presentations.values()){for(const c of p.controls)c.fieldId=c.id==='power'?'2:1':c.id==='sweep'?'2:1':c.id==='charge'?'3:1':c.id==='motor'?'2:1':'2:2';for(const effect of p.projections??[])effect.effects=[{fieldId:p.controls.find(c=>c.id===effect.controlId)!.fieldId!,value:effect.controlId==='sweep'?effect.value==='vacuum:start-sweep'?1:2:effect.value}];}}
const desktop=new URLSearchParams(location.search).has('desktop'),root=document.querySelector<HTMLElement>('#app')!,grid=root.querySelector<HTMLElement>('.device-grid')!;
const style=document.createElement('style');style.textContent=`body{margin:0;background:#80b8d1}.home-screen{padding:24px}.device-grid{display:grid;gap:12px;align-content:start}.device-card h3,.device-room{margin:0}.widget-placement{position:absolute}.device-drag-ghost{position:fixed!important;z-index:100;pointer-events:none}.device-drag-slot{border:2px solid white;border-radius:20px;box-sizing:border-box}`;document.head.append(style);
let revision=1,opens=0,legacyWrites=0,drags=0,delay=0,failNext=false,owner:any;const writes:{did:string;change:CardControlChange}[]=[],reads:string[][]=[],regions=new Map<string,any>(),sizes:Record<string,CardSize>=Object.fromEntries(devices.map(d=>[d.did,'large']));
let cloudLag=2000,groupFailures:string[]=[];const executed:{did:string;controlId:string;value:Json}[]=[],groupWrites:{groupId:string;on:boolean;requestId:string}[]=[],tails=new Map<string,Promise<unknown>>(),controlIntents=new Map<string,CardControlResult>();
const readFailures=new Set<string>();
const serial=<T>(id:string,work:()=>Promise<T>)=>{const task=(tails.get(id)??Promise.resolve()).catch(()=>{}).then(work);tails.set(id,task);return task;};
const callbacks=new Map<number,Function>(),listeners=new Map<string,number>();let callbackId=0;const status=(did:string)=>captionMode?structuredClone(captionStatuses.get(did)??{did,text:'设备已连接'}):{did,text:'设备已连接'};
const emit=(event:string,payload:unknown)=>callbacks.get(listeners.get(event)!)?.({event,payload,id:listeners.get(event)});
const frame=()=>({revision:++revision,reset:true,viewport:{monitor:'one',width:innerWidth,height:innerHeight,scale:1},cards:devices.map((d,i)=>({view:{id:d.did,homeId:'mock-home',revision,device:d,card:shortcut(d.did)??null,status:status(d.did),presentation:presentations.get(d.did)??null,controlIntent:controlIntents.get(d.did),pending:null,error:null,geometry:{size:sizes[d.did],monitor:'one',x:24+(i%2)*512,y:24+Math.floor(i/2)*212,width:240}},x:24+(i%2)*512,y:24+Math.floor(i/2)*212,width:sizes[d.did]==='large'?492:240,height:sizes[d.did]==='small'?90:192,baseWidth:240,z:i+1,interactive:true})),removed:[],hints:[]});
async function command(did:string,change:CardControlChange):Promise<CardControlResult>{
 if(localFirst){const p=presentations.get(did)!;if(change.confirmOnly){if(readFailures.has(did))throw{kind:'network',message:'mock read failure'};const c=p.controls.find(c=>c.id===change.controlId)!,verified=c.kind==='action'?change.value==='vacuum:start-sweep'?c.value==='vacuum:pause-sweeping':c.value==='vacuum:start-sweep':c.value===change.value;return{homeId:'mock-home',did,controlId:change.controlId,requestId:change.requestId,verified,actual:verified?change.value:null,message:'',presentation:structuredClone(p),card:shortcut(did)??null,status:status(did)};}
  writes.push({did,change:structuredClone(change)});return serial(did,async()=>{await new Promise(r=>setTimeout(r,delay));if(failNext){failNext=false;throw{kind:'invalidValue',message:'mock rejection'};}executed.push({did,controlId:change.controlId,value:change.value});const result:CardControlResult={homeId:'mock-home',did,controlId:change.controlId,requestId:change.requestId,sequence:++revision,submitted:true,target:change.value,verified:false,actual:null,message:'',presentation:null,card:null,status:null};controlIntents.set(did,result);
   setTimeout(()=>{const c=p.controls.find(c=>c.id===change.controlId)!;if(c.kind==='action'){c.value=change.value==='vacuum:start-sweep'?'vacuum:pause-sweeping':'vacuum:start-sweep';c.label=c.value==='vacuum:start-sweep'?'开始清扫':'暂停';}else c.value=change.value;if(c.id==='power')for(const child of p.controls)if(child.id!==c.id)child.enabled=change.value===true;p.revision=++revision;updateStatus(did,change.controlId,change.value);if(desktop)emit('desktop-widget-host-state',frame());else owner.templateSession(devices.find(d=>d.did===did)).accept(structuredClone(p));},cloudLag);
   if(desktop)emit('desktop-widget-host-state',frame());return result;
  });
 }
 const p=presentations.get(did)!;if(!change.confirmOnly){writes.push({did,change:structuredClone(change)});await new Promise(r=>setTimeout(r,delay));if(failNext){failNext=false;throw{kind:'invalidValue',message:'模拟设备拒绝了此值'};}const c=p.controls.find(c=>c.id===change.controlId)!;
  if(c.kind==='action'){c.label=c.label==='开始清扫'?'暂停':'开始清扫';c.value=c.value==='vacuum:start-sweep'?'vacuum:pause-sweeping':'vacuum:start-sweep';}else c.value=change.value;
  if(c.id==='power')for(const child of p.controls)if(child.id!==c.id){child.enabled=c.value===true;child.reason=child.enabled?null:'设备关闭';}
  p.revision=++revision;
 }
 const result:CardControlResult={homeId:'mock-home',did,controlId:change.controlId,requestId:change.requestId,verified:true,actual:change.value,message:'模拟回读确认',presentation:structuredClone(p),card:shortcut(did)??null,status:status(did)};
 if(desktop)emit('desktop-widget-host-state',frame());return result;
}
async function groupCommand(groupId:string,on:boolean,requestId:string,confirmOnly=false):Promise<SwitchGroupResult>{if(confirmOnly){if(readFailures.has('g'))throw{kind:'network',message:'mock group read failure'};return{homeId:'mock-home',requestId,sequence:0,target:on,card:{...structuredClone(groupCard),group:{...structuredClone(groupCard.group!),revision:++revision,readStartedAt:Date.now()}},failed:[],readback:true};}groupWrites.push({groupId,on,requestId});return serial('g',async()=>{await new Promise(r=>setTimeout(r,delay));const before=structuredClone(groupCard),failed=[...groupFailures];const result:SwitchGroupResult={homeId:'mock-home',requestId,sequence:++revision,target:on,card:before,failed};setTimeout(()=>{for(const m of groupCard.group!.members)if(!failed.includes(m.id))m.selected=on;groupCard.group!.revision=++revision;groupCard.selected=groupCard.group!.members.every(m=>m.selected===true);if(captionMode){for(const m of groupCard.group!.members)updateStatus('g',m.id,m.selected);}if(desktop)emit('desktop-widget-host-state',frame());else owner.homeCardChanged();},cloudLag);return result;});}
Object.assign(window,{isTauri:true,__TAURI_INTERNALS__:{metadata:{currentWindow:{label:desktop?'widget-host-fixture':'main'},currentWebview:{label:desktop?'widget-host-fixture':'main'}},transformCallback(fn:Function){const id=++callbackId;callbacks.set(id,fn);return id;},unregisterCallback(id:number){callbacks.delete(id);},invoke(name:string,args:any={}){
 if(name==='home_card_presentations'){reads.push(args.ids);return Promise.resolve(args.ids.map((id:string)=>presentations.get(id)).filter(Boolean).map((p:HomeCardPresentation)=>structuredClone(p)));}
 if(name==='home_card_control')return command(args.did,args.change);
 if(name==='switch_group_control'||name==='desktop_widget_switch_group')return groupCommand(args.groupId,args.on,args.requestId,args.confirmOnly);
 if(!desktop)return new Promise(()=>{});
 if(name==='plugin:event|listen'){listeners.set(args.event,args.handler);return Promise.resolve(args.handler);}
 if(name==='plugin:event|unlisten')return Promise.resolve();
 if(name==='desktop_widget_snapshot')return Promise.resolve(frame());
 if(name==='desktop_widget_viewport')return Promise.resolve({monitor:'one',width:innerWidth,height:innerHeight,scale:1});
 if(name==='desktop_resource_snapshot')return Promise.resolve({version:1,revision:1,visible:true,refreshMs:30000});
 if(name==='desktop_widget_regions'){regions.set(args.widgetId,args);return Promise.resolve();}
 if(name==='desktop_widget_card_control')return command(args.widgetId,args.change);
 if(name==='desktop_widget_open'){opens++;return Promise.resolve();}
 if(name==='desktop_widget_control'){legacyWrites++;return Promise.resolve({verified:true,actual:args.intent,card:shortcut(args.widgetId),message:'模拟'});}
 return Promise.resolve();
}}});
if(desktop){document.documentElement.classList.add('desktop-widget-document');root.replaceChildren();await import('../src/widget-host');}
else{
 const {App}=await import('../src/main');owner=Object.create(App.prototype);
 const drag=new DeviceDrag({begin:()=>{drags++;owner.arrangement={dragging:true,selected:new Set()};return true;},preview:()=>{},ended:()=>{if(owner.arrangement?.dragging)owner.arrangement=undefined;owner.updateCardPresentationViews();}});
 Object.assign(owner,{root,snapshot:{homeId:'mock-home',generation:1,devices},session:{loggedIn:true,userId:'mock',region:'cn'},homeEpoch:1,selectedHomeId:'mock-home',renderedHomeId:'mock-home',roomId:'*',workPaused:false,deviceIndex:new IdentityIndex(),homeCardBindings:new WeakMap(),cardPress:new CardPress(),drag,sceneDrag:{active:false},preferences:{view:{cardSizes:sizes,dragLocked:false},pendingCount:0},homeCardOps:{get:()=>undefined},homeCards:{homeId:'mock-home',generation:1,cards:devices.map(d=>shortcut(d.did)).filter(Boolean),statuses:devices.map(d=>status(d.did))},displayedHomeCard:(d:any)=>shortcut(d.did),deviceCardCaption:()=> '客厅 | 设备已连接',deviceArtwork:()=>{const art=document.createElement('span');art.className='device-artwork';art.innerHTML='<svg class="device-product-image" viewBox="0 0 48 48"><rect x="6" y="6" width="36" height="36" rx="5" fill="#b8c6ce"/></svg>';return art;},openPanel:()=>{opens++;},activateHomeCard:()=>{legacyWrites++;},homeCardChanged:()=>owner.updateCardPresentationViews()});
 owner.updateArrangementChrome=()=>owner.updateCardPresentationViews();
 if(captionMode){owner.currentHome=()=>undefined;owner.deviceCardCaption=App.prototype['deviceCardCaption'];owner.propertyOps=new PropertyOperations(()=>new Promise(()=>{}),()=>new Promise(()=>{}),()=>owner.homeCardChanged());}
 if(localFirst){owner.displayedHomeCard=(d:any)=>{const raw=shortcut(d.did);return raw?.group?owner.switchGroupSession(raw).display:raw;};owner.activateHomeCard=(d:any,intent:any)=>{if(d.did==='g')App.prototype['activateHomeCard'].call(owner,d,intent);else legacyWrites++;};owner.homeCardChanged=()=>{owner.updateCardPresentationViews();const old=grid.querySelector('[data-device-id=g] .device-status');if(old)updateHomeShortcut(old,devices.find(d=>d.did==='g')!,owner.displayedHomeCard(devices.find(d=>d.did==='g')),false,intent=>owner.activateHomeCard(devices.find(d=>d.did==='g'),intent));};}
 for(const d of devices)grid.append(owner.renderDeviceCard(d));sizeDeviceGrid(grid);window.addEventListener('resize',()=>sizeDeviceGrid(grid));document.querySelector('.desktop-titlebar')?.remove();
}
function updateStatus(did:string,controlId:string,value:Json){if(!captionMode)return;const model=captionStatuses.get(did);const fieldId=did==='g'?controlId:presentations.get(did)?.controls.find(c=>c.id===controlId)?.fieldId,field=model?.fields?.find(f=>f.id===fieldId);if(!model||!field)return;const raw=did==='d'?(value==='vacuum:start-sweep'?1:2):value;field.value=raw;field.live=true;const display=projectCardStatus({...model,fields:model.fields?.map(f=>({...f,writable:true}))},[{fieldId:field.id,value:raw,order:1,effect:did==='d'}]);field.text=field.visible?(field.format.kind==='boolean'?raw?'开':'关':field.format.kind==='enum'?field.format.options.find(o=>o.value===raw)?.text??'':`${raw}${field.format.unit}`):'';model.text=display??model.text;model.revision=++revision;model.readStartedAt=Date.now();if(!desktop&&owner){owner.homeCards.statuses=devices.map(d=>status(d.did));owner.updateCardPresentationViews();}}
const card=(id:string)=>root.querySelector<HTMLElement>(`[data-device-id="${id}"]`)!;
Object.assign(window,{templateFixture:{
 snapshot:()=>({desktop,opens,legacyWrites,drags,writes,reads,executed,groupWrites,regions:[...regions].map(([id,r])=>({id,...r})),cards:devices.map(d=>{const n=card(d.did),r=n?.getBoundingClientRect();return{id:d.did,size:n?.dataset.cardSize,template:n?.classList.contains('has-card-template'),width:r?.width,height:r?.height,controls:n?.querySelectorAll('.card-control').length};})}),
 setSize(id:string,size:CardSize){sizes[id]=size;if(desktop)emit('desktop-widget-host-state',frame());else owner.updateHomeCardSizes();},
 setEditing(editing:boolean){if(!desktop){owner.arrangement=editing?{selected:new Set()}:undefined;owner.updateCardPresentationViews();owner.scheduleCardPresentations();}},
 setDelay(ms:number){delay=ms;},
 setCloudLag(ms:number){cloudLag=ms;},
 failReads(id:string,on=true){if(on)readFailures.add(id);else readFailures.delete(id);},
 emitReadFailure(id:string,fieldId:string,sequence:number){const event={homeId:'mock-home',userId:'mock',region:'cn',dids:[id],fields:[{id:fieldId,sequence}]};if(desktop)emit('ui-control-readback-failed',event);else owner.acceptUiReadbackFailure(event);},
 detailWrite(id:string,fieldId:string,value:Json){if(desktop)throw Error('main only');const [siid,piid]=fieldId.split(':').map(Number),key=JSON.stringify([id,siid,piid]);owner.propertyOps.write(key,value,captionStatuses.get(id)?.fields?.find(f=>f.id===fieldId)?.value??null);owner.homeCardChanged();},
 setGroupFailures(ids:string[]){groupFailures=ids;},
 failNextWrite(){failNext=true;},
 setUnavailable(id:string,reason:string){const p=presentations.get(id)!;p.revision=++revision;for(const c of p.controls){c.enabled=false;c.reason=reason;}if(desktop)emit('desktop-widget-host-state',frame());else{owner.templateSession(devices.find(d=>d.did===id)).accept(structuredClone(p));owner.updateCardPresentationViews();}},
 setValue(id:string,controlId:string,value:Json){const p=presentations.get(id)!;p.controls.find(c=>c.id===controlId)!.value=value;if(controlId==='power')for(const c of p.controls)if(c.id!=='power')c.enabled=value===true;p.revision=++revision;if(desktop)emit('desktop-widget-host-state',frame());else{owner.templateSession(devices.find(d=>d.did===id)).accept(structuredClone(p));owner.updateCardPresentationViews();}},
 compact(id:string){for(const d of devices)if(d.did!==id)card(d.did).style.display='none';const n=card(id);grid.style.display='block';Object.assign(n.style,{width:'252px',height:'96px'});applyCardMetrics(n,120,96,'large');},
 overflow(id:string){const p=presentations.get(id)!;p.controls.find(c=>c.kind==='choices')!.options=Array.from({length:8},(_,i)=>({label:`模式${i}`,value:i}));p.revision=++revision;if(desktop)emit('desktop-widget-host-state',frame());else{owner.templateSession(devices.find(d=>d.did===id)).accept(structuredClone(p));owner.updateCardPresentationViews();}},
 flush(){if(desktop)emit('desktop-widget-host-state',frame());else owner.scheduleCardPresentations(true);},
}});
