import '../src/style.css';import '../src/theme.css';import '../src/ui/app-font.css';import '../src/ui/home-card.css';import '../src/ui/widget.css';
import {devices,presentations,shortcut as baseShortcut} from './card-template-data';
import {IdentityIndex} from '../src/identity-index';import {CardPress} from '../src/ui/card-press';import {DeviceDrag} from '../src/ui/device-drag';import {sizeDeviceGrid} from '../src/ui/device-grid';import {applyCardMetrics} from '../src/ui/card-metrics';
import {updateHomeShortcut} from '../src/ui/home-shortcut';
import {captionStatuses} from './card-caption-data';
import {PropertyOperations} from '../src/property-operations';
import {projectCardStatus} from '../src/home-card-display';
import {deviceSurfaces} from '../src/ui/device-surfaces';
import {renderControl} from '../src/ui/controls';
import type {CardControlChange,CardControlResult,CurtainOpening,HomeCardPresentation,HomeCardEntry,SwitchGroupResult,Json,Device,Property} from '../src/types';
import {CARD_GAP,cardDimensions,packCards,type CardSize} from '../src/card-size';
const captionMode=new URLSearchParams(location.search).has('captions'),localFirst=new URLSearchParams(location.search).has('local')||captionMode;
if(new URLSearchParams(location.search).has('missing-first')){
 const brightness=presentations.get('a')?.controls.find(c=>c.id==='brightness');
 if(brightness){brightness.value=null;brightness.enabled=false;}
}
const groupCard:HomeCardEntry={did:'g',kind:'power',selected:false,enabled:true,visible:true,highlight:false,reason:null,binding:{siid:2,piid:1},action:'on',cardType:1,group:{id:'mock-normal-only',revision:1,members:[{id:'2:1',selected:false},{id:'3:1',selected:true}]}};
if(localFirst)devices.push({did:'g',name:'客厅开关',model:'mock.switch',specType:'urn:miot-spec-v2:device:switch:mock:1',online:true,roomId:'mock-room',roomName:'客厅'});
const curtainPositionMode=new URLSearchParams(location.search).get('curtain-position');
const curtainOpening:CurtainOpening=curtainPositionMode==='left'?'single-left':curtainPositionMode==='right'?'single-right':'double';
if(curtainPositionMode)presentations.set('a',{did:'a',templateId:'curtain-position-only',revision:1,headerControl:null,rows:[['position']],controls:[{id:'position',kind:'slider',appearance:'curtain-position',curtainOpening,label:'目标位置',value:50,enabled:true,reason:null,options:[],range:{min:0,max:100,step:5,unit:'%'}}]});
const shortcut=(id:string):HomeCardEntry|undefined=>id==='g'?groupCard:curtainPositionMode&&(id==='a'||id==='e')?{...baseShortcut(id)!,kind:'curtain',action:'close',highlight:false}:baseShortcut(id);
if(captionMode){for(const p of presentations.values()){for(const c of p.controls)c.fieldId=c.id==='power'?'2:1':c.id==='sweep'?'2:1':c.id==='charge'?'3:1':c.id==='motor'?'2:1':'2:2';for(const effect of p.projections??[])effect.effects=[{fieldId:p.controls.find(c=>c.id===effect.controlId)!.fieldId!,value:effect.controlId==='sweep'?effect.value==='vacuum:start-sweep'?1:2:effect.value}];}}
const desktop=new URLSearchParams(location.search).has('desktop'),mixed=new URLSearchParams(location.search).has('mixed'),root=document.querySelector<HTMLElement>('#app')!,grid=root.querySelector<HTMLElement>('.device-grid')!;
const style=document.createElement('style');style.textContent=`body{margin:0;background:#80b8d1}.home-screen{padding:24px}.device-grid{display:grid;gap:12px;align-content:start}.device-card h3,.device-room{margin:0}.widget-placement{position:absolute}.device-drag-ghost{position:fixed!important;z-index:100;pointer-events:none}.device-drag-slot{border:2px solid white;border-radius:20px;box-sizing:border-box}`;document.head.append(style);
let revision=1,opens=0,legacyWrites=0,drags=0,delay=0,failNext=false,owner:any;const writes:{did:string;change:CardControlChange}[]=[],reads:string[][]=[],regions=new Map<string,any>(),sizes:Record<string,CardSize>=Object.fromEntries(devices.map(d=>[d.did,'large']));
if(mixed)Object.assign(sizes,{b:'medium',c:'small',e:'small',f:'small'});
let cloudLag=2000,groupFailures:string[]=[];const executed:{did:string;controlId:string;value:Json}[]=[],groupWrites:{groupId:string;on:boolean;requestId:string}[]=[],tails=new Map<string,Promise<unknown>>(),controlIntents=new Map<string,CardControlResult>(),stateReads:string[][]=[];
let frozenState:unknown,previousState:unknown;
const readFailures=new Set<string>();
const detailWrites:{name:string;value:Json}[]=[],invocations:string[]=[];
const passiveFailures=new Set<string>();
let hostScale=1,temperatureWidth=492;
const serial=<T>(id:string,work:()=>Promise<T>)=>{const task=(tails.get(id)??Promise.resolve()).catch(()=>{}).then(work);tails.set(id,task);return task;};
const callbacks=new Map<number,Function>(),listeners=new Map<string,number>();let callbackId=0;const status=(did:string)=>captionMode?structuredClone(captionStatuses.get(did)??{did,text:'设备已连接'}):{did,text:'设备已连接'};
const emit=(event:string,payload:unknown)=>callbacks.get(listeners.get(event)!)?.({event,payload,id:listeners.get(event)});
const frame=()=>{
 const slots=mixed?packCards(devices.map(d=>d.did),sizes,4):undefined;
 const baseWidth=mixed?180:240,baseHeight=baseWidth*.8;
 return {revision:++revision,reset:true,viewport:{monitor:'one',width:innerWidth,height:innerHeight,scale:1},cards:devices.map((d,i)=>{
  const size=sizes[d.did],slot=slots?.[i];
  const x=slot?24+slot.column*(baseWidth+CARD_GAP)*hostScale:24+(i%2)*512;
  const y=slot?24+slot.row*(baseHeight+CARD_GAP)/2*hostScale:24+Math.floor(i/2)*212;
  const dimensions=cardDimensions(baseWidth,baseHeight,size);
  const width=slot?dimensions.width*hostScale:size==='large'?(d.did==='b'?temperatureWidth:492):240;
  const height=dimensions.height*hostScale;
  return {view:{id:d.did,homeId:'mock-home',revision,device:d,card:shortcut(d.did)??null,status:status(d.did),presentation:presentations.get(d.did)??null,presentationStale:passiveFailures.has(d.did),controlIntent:controlIntents.get(d.did),pending:null,error:null,geometry:{size,monitor:'one',x,y,width:baseWidth}},x,y,width,height,contentScale:hostScale,baseWidth,z:i+1,interactive:true};
 }),removed:[],hints:[]};
};
async function command(did:string,change:CardControlChange):Promise<CardControlResult>{
 if(localFirst){const p=presentations.get(did)!;
  if(change.confirmOnly){
   if(readFailures.has(did))throw{kind:'network',message:'mock read failure'};
   const control=structuredClone(p.controls.find(c=>c.id===change.controlId)!);
   const action=control.kind==='action';
   const expected=change.value==='vacuum:start-sweep'?'vacuum:pause-sweeping':'vacuum:start-sweep';
   const verified=control.value===(action?expected:change.value);
   const reading=captionStatuses.get(did)?.fields?.find(field=>field.id===control.fieldId)?.value??control.value;
   return {
    homeId:'mock-home',did,controlId:change.controlId,requestId:change.requestId,verified,
    actual:verified?change.value:action?null:control.value,message:'',presentation:null,card:null,status:null,
    confirmation:{templateId:p.templateId,revision:++revision,observedAt:Date.now(),control,reading},
   };
  }
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
 invocations.push(name);
 if(name==='home_card_presentations'){reads.push(args.ids);return Promise.resolve(args.ids.filter((did:string)=>!passiveFailures.has(did)).map((did:string)=>({did,revision:presentations.get(did)?.revision??revision,presentation:structuredClone(presentations.get(did)??null)})));}
 if(name==='home_cards'){
  const ids=(args.ids??devices.map(device=>device.did)) as string[];stateReads.push(ids);
  const saved=frozenState;frozenState=undefined;
  if(saved)return Promise.resolve(saved);
  return Promise.resolve(structuredClone({homeId:'mock-home',generation:1,cards:ids.map(shortcut).filter(Boolean),statuses:ids.map(status)}));
 }
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
 const {App}=await import('../src/main');const {api}=await import('../src/api');owner=Object.create(App.prototype);owner.transport=api;
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
 snapshot:()=>({desktop,opens,legacyWrites,drags,writes,reads,stateReads,executed,groupWrites,regions:[...regions].map(([id,r])=>({id,...r})),cards:devices.map(d=>{const n=card(d.did),r=n?.getBoundingClientRect();return{id:d.did,size:n?.dataset.cardSize,template:n?.classList.contains('has-card-template'),width:r?.width,height:r?.height,controls:n?.querySelectorAll('.card-control').length};})}),
 externalSwitch(on:boolean){
  const fields=captionStatuses.get('g')?.fields;if(!fields)throw Error('caption fixture required');
  if(!desktop)previousState=structuredClone({homeId:'mock-home',generation:1,cards:[groupCard],statuses:[status('g')]});
  for(const member of groupCard.group!.members){member.selected=on;const field=fields.find(item=>item.id===member.id)!;field.value=on;field.text=on?'开':'关';}
  groupCard.selected=on;groupCard.highlight=on;groupCard.action=on?'off':'on';
  groupCard.group!.revision=++revision;groupCard.group!.readStartedAt=Date.now();
  const caption=captionStatuses.get('g')!;caption.revision=revision;caption.text=fields.filter(item=>item.visible).map(item=>item.text).join(' ');
  if(desktop)emit('desktop-widget-host-state',frame());
  else{
   owner.homeCardOps={get:()=>undefined,pendingCount:0,version:0};owner.scenes={};owner.updateHomeScenes=()=>{};owner.monitorWall={active:false};owner.stateDelay=10_000;owner.stateCursor=0;
   owner.scheduleVisibleState();
  }
 },
 async staleSwitch(){if(!desktop){frozenState=previousState;await owner.loadHomeCards(['g']);}},
 setSize(id:string,size:CardSize){sizes[id]=size;if(desktop)emit('desktop-widget-host-state',frame());else owner.updateHomeCardSizes();},
 setEditing(editing:boolean){if(!desktop){owner.arrangement=editing?{selected:new Set()}:undefined;root.classList.toggle('is-arranging',editing);owner.updateCardPresentationViews();owner.scheduleCardPresentations();}},
 setDelay(ms:number){delay=ms;},
 detail(profile:'climate'|'white'|'group'|'rgb'|'rgb-only'|'brightness'|'power'|'invalid-rgb',readonly=false,powered=true){
  if(desktop)throw Error('main only');
  const climate=profile==='climate',category=climate?'air-conditioner':'light',specType=`urn:miot-spec-v2:device:${category}:0000A001:fixture:1`;
  const device:Device={...devices[0],did:'detail-fixture',specType,model:profile==='group'?'mijia.light.group3':'fixture.device.mock',sharedReadOnly:readonly};
  const p=(piid:number,name:string,format:string,value:Json,unit?:string,valueRange?:number[]):Property=>({siid:2,piid,name,description:name,format,value,unit,valueRange,access:['read','write'],code:0});
  const properties=[p(1,'on','bool',powered)];
  if(climate){
   const options=(piid:number,name:string,index:number,labels:string[])=>({...p(piid,name,'uint8',index),valueList:labels.map((description,value)=>({description,value}))});
   properties.push(p(2,'target-temperature','float',23,'celsius',[16,30,.5]),options(3,'mode',0,['Cool','Heat','Auto','Fan','Dry']),options(4,'fan-level',1,['Auto','Low','Medium','High']));
  }
  else{
   if(profile!=='power')properties.push(p(2,'brightness','uint8',45,'percentage',[1,100,1]));
   if(['white','group','rgb','invalid-rgb'].includes(profile))properties.push(p(3,'color-temperature','uint16',4000,'kelvin',[2700,6500,1]));
   if(['rgb','rgb-only','invalid-rgb'].includes(profile))properties.push(p(4,'color','uint32',0xff0000,'rgb',[0,profile==='invalid-rgb'?65535:0xffffff,1]));
   properties.push({...p(5,'mode','uint8',0),valueList:[{value:0,description:'Color'},{value:2,description:'Scene'}]});
  }
  owner.context={homeId:'mock-home',generation:1,did:device.did};owner.panelEpoch=(owner.panelEpoch??0)+1;owner.render=()=>{};owner.lightTabs=new Map();
  owner.panel={did:device.did,model:device.model,specType,services:[{siid:2,name:category,description:category,properties,actions:[]}]};
  owner.setBoundProperty=(property:Property,value:Json)=>{detailWrites.push({name:property.name,value});};
  root.querySelector('#template-detail')?.remove();
  const detail=document.createElement('section');detail.id='template-detail';detail.className=`device-page ${climate?'page-air-conditioner':'page-light'}${profile.startsWith('rgb')?' page-yeelight-strip':''}`;
  detail.append(climate?owner.renderAirConditionerPage(device):owner.renderLightPage(device,profile==='group'));root.append(deviceSurfaces(detail));
 },
 curtainDetail(){
  const property:Property={siid:2,piid:4,name:'target-position',description:'目标位置',format:'uint8',value:50,unit:'percentage',valueRange:[0,100,5],access:['read','write'],code:0};
  const control=renderControl({name:'Slider',props:{property,label:'窗帘开合',unit:'%',theme:'curtain'}},{device:devices[0],busy:false,write:(_,value)=>detailWrites.push({name:property.name,value}),error:error=>{throw error;}});
  control.id='curtain-detail-fixture';root.append(control);
 },
 detailTrace:()=>({writes:structuredClone(detailWrites),invocations:[...invocations]}),
 failPassive(id:string,on=true){if(on)passiveFailures.add(id);else{passiveFailures.delete(id);presentations.get(id)!.revision=++revision;}if(desktop)emit('desktop-widget-host-state',frame());else owner.scheduleCardPresentations(true);},
 projectHost(scale:number,width:number){hostScale=scale;temperatureWidth=width;emit('desktop-widget-host-state',frame());},
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
