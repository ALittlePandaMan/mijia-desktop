import './ui/widget-base.css';
import './theme.css';
import './ui/home-card-motion.css';
import './ui/widget.css';
import {invoke} from '@tauri-apps/api/core';
import {backgroundWork,ResourceRevisions,setVisualWorkPaused,type ResourceState} from './background-work';
import {listenResourceState} from './resource-events';
import {HostFrames} from './host-frames';
import {listen} from '@tauri-apps/api/event';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {desktopWidgets,widgetSizeAvailable,externalIntentSupersedes,type WidgetView,type HostCard,type HostFrame} from './desktop-widgets';
import {deviceCardView} from './ui/device-card-view';
import {deviceArtwork,deviceArtworkKey} from './ui/device-artwork';
import {cardCaption,cardDisplay,cardReportedIntent,cardActive} from './home-cards';
import {confirmGroupCaption,projectCardStatus,retainConfirmedStatus} from './home-card-display';
import type {DisplayIntent} from './local-display-intent';
import {updateHomeShortcut} from './ui/home-shortcut';
import {element,button} from './ui/dom';
import {CardPress} from './ui/card-press';
import {cardSize} from './card-size';
import {cardSizeMenu,cardMenuKeys,showLargeCardChoice} from './ui/card-size-menu';
import {applyCardMetrics,cancelCardMetrics} from './ui/card-metrics';
import {WidgetDrag} from './ui/widget-drag';
import {PropertyOperations} from './property-operations';
import {CardControlSession} from './card-control-session';
import {SwitchGroupSession} from './switch-group-session';
import type {UiSubmission,UiReadbackFailure} from './ui-control-events';
import {updateCardControls,cancelCardControls} from './ui/card-controls';
import type {HomeCardIntent} from './types';

const root=document.querySelector<HTMLElement>('#app')!,hostLabel=getCurrentWindow().label;
const cards=new Map<string,LiveCard>();let disposed=false,revision=-1,frame=0,queue=new HostFrames(),menu:HTMLElement|undefined;
const hintsLayer=element('div','widget-grid-hints');hintsLayer.setAttribute('aria-hidden','true');root.append(hintsLayer);
let previewColorKey='';let hintKey='';const hintNodes=new Map<string,HTMLElement>();
const resourceRevisions=new ResourceRevisions();let resource:ResourceState={version:1,revision:0,visible:true,refreshMs:30000};
let viewportTimer:ReturnType<typeof setTimeout>|undefined,viewportBusy=false,viewportKey='';
let viewportDirty=false;
const syncViewport=()=>{
 if(disposed)return;
 viewportDirty=true;clearTimeout(viewportTimer);
 viewportTimer=setTimeout(()=>{
  if(disposed||viewportBusy)return;
  viewportDirty=false;viewportBusy=true;
  void desktopWidgets.viewport(innerWidth,motion.matches,Math.max(0,revision)).then(v=>{if(v&&Math.abs(innerWidth-v.width)>1.25)viewportDirty=true;}).catch(()=>{}).finally(()=>{
   viewportBusy=false;if(viewportDirty)syncViewport();
  });
 },70);
};
window.addEventListener('resize',syncViewport);
const report=(error:unknown)=>{root.setAttribute('aria-description',(error as {message?:string})?.message??'操作暂不可用');};
const closeMenu=()=>{if(!menu)return;menu.remove();menu=undefined;void desktopWidgets.menu(null).catch(()=>{});};

class LiveCard {
 gesture(phase:string,kind:'move'='move',sequence?:number){
  if(sequence!==undefined&&sequence<this.sequence)return;
  if(phase==='started'&&this.kind===kind&&sequence!==undefined&&sequence===this.sequence)return;
  if(sequence!==undefined)this.sequence=sequence;
  if(phase==='started'){
   if(kind==='move'&&this.resizeAnimation){const at=this.resizeAnimation.currentTime;this.resizeAnimation.pause();this.resizeAnimation.currentTime=at;this.resizeFrozen=true;}
   this.kind=kind;if(!this.drag.active)this.drag.native(phase,kind);
  }else{
   const prior=this.kind??kind;this.kind=undefined;
   if(this.drag.active||phase==='tap')this.drag.native(phase,prior);
   // Move-only frames use the native hit target and need no DOM measurement.
   if(this.regionBusy)this.invalidateRegions();
  }
  if(this.card){this.templateControls.setActive(this.shown&&this.interactive&&!this.view?.error&&cardSize(this.view?.geometry.size)==='large'&&!this.gesturing);updateCardControls(this.card,this.templateControls.presentation,(id,value)=>this.templateControls.write(id,value),this.interactive&&!this.gesturing&&!this.view?.error);}
 }
 get gesturing(){return this.kind!==undefined||this.preview;}
 get geometry(){return this.view?.geometry;}
 readbackFailure(event:UiReadbackFailure){const view=this.view;if(view?.homeId!==event.homeId||!view.device||!event.dids.includes(view.device.did))return;for(const field of event.fields){this.templateControls.rejectNative(field.id,field.sequence);this.switchGroup.rejectNative(field.id,field.sequence);if(`${view.card?.binding.siid}:${view.card?.binding.piid}`===field.id)this.operations.rejectNative(view.device.did,field.sequence);}}
 submission(event:UiSubmission):void{const view=this.view;if(!view?.device||view.homeId!==event.homeId||!event.dids.includes(view.device.did))return;this.templateControls.reflect(event.controlIds,event.value,event.sequence);if(view.card?.group)this.switchGroup.reflect(`${event.siid}:${event.piid}`,event.value===true||event.value===1,event.sequence);else if(view.card?.binding.siid===event.siid&&view.card.binding.piid===event.piid)this.operations.reflect(view.device.did,event.value===true||event.value===1?'on':'off',cardReportedIntent(view.card),event.sequence);}
 private preview=false;
 private sequence=-1;private kind?:'move';private x=0;private y=0;
 private surface=element('div','widget-surface');
 reduceMotion(){if(this.resizeAnimation){this.resizeAnimation.cancel();this.resizeAnimation=undefined;this.invalidateRegions();}if(this.card)cancelCardMetrics(this.card);this.drag.reduceMotion();}
 invalidateRegions(){++this.regionEpoch;this.regionKey='';this.regionAttempts=0;clearTimeout(this.regionRetry);this.regionRetry=undefined;this.scheduleRegions();}
 readonly root=element('div','widget-placement');private card?:HTMLElement;private view?:WidgetView;private interactive=false;
 private shown=true;private regionFrame=0;private regionKey='';private regionRetry:ReturnType<typeof setTimeout>|undefined;private regionAttempts=0;
 private dead=false;private regionBusy=false;private regionDirty=false;private regionEpoch=0;private z?:number;private contentScale?:number;
 private baseWidth=240;private width=0;private height=0;private size?:string;private resizeAnimation?:Animation;private resizeFrozen=false;
 setShown(shown:boolean):void{if(shown===this.shown)return;this.shown=shown;this.switchGroup?.setActive(shown);this.templateControls?.setActive(shown&&this.interactive);setVisualWorkPaused(this.root,!shown);if(shown)this.render();else this.reduceMotion();}
 private press=new CardPress();private drag:WidgetDrag;private operations:PropertyOperations;private templateControls:CardControlSession;
 private switchGroup:SwitchGroupSession;
 constructor(readonly id:string){
  this.root.dataset.widgetId=id;this.drag=new WidgetDrag(id);
  const request=async(_key:string,value:unknown,confirm=false)=>{const r=await desktopWidgets.control(value as HomeCardIntent,confirm,undefined,id);return{outcome:r.verified?'confirmed' as const:'pending' as const,actual:r.actual??undefined,message:r.message};};
  this.operations=new PropertyOperations((k,v)=>request(k,v),(k,v)=>request(k,v,true),()=>this.render());root.append(this.root);
  this.switchGroup=new SwitchGroupSession((groupId,on,requestId,confirmOnly)=>desktopWidgets.switchGroup(this.id,groupId,on,requestId,confirmOnly),()=>this.render(),card=>{
   if(this.view)this.view={...this.view,card,status:confirmGroupCaption(this.view.status??undefined,card)??null};
  });
  this.templateControls=new CardControlSession(change=>desktopWidgets.cardControl(this.id,change),()=>this.render());
 }
 private applyMetrics(card:HTMLElement,size:ReturnType<typeof cardSize>,animate=false){
  const scale=this.contentScale??1;
  applyCardMetrics(card,this.baseWidth,this.baseWidth*.8,size,animate,{width:this.width/scale,height:this.height/scale});
 }
 update(next:HostCard):void{
  const oldWidth=this.width,oldHeight=this.height,size=cardSize(next.view.geometry.size);this.preview=!!next.preview;
  if(next.gesture)this.gesture('started',next.gesture.kind,next.gesture.sequence);
  else if(next.gesture===null&&this.kind)this.gesture('ended');
  const dimensionsChanged=oldWidth!==next.width||oldHeight!==next.height,sizeChanged=this.size!==size;
  const animate=dimensionsChanged&&!!this.card&&!next.preview&&this.kind!=='move'&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
  const from=animate?(this.resizeAnimation?this.root.getBoundingClientRect():{x:this.x,y:this.y,width:oldWidth,height:oldHeight}):undefined;
  if(this.resizeFrozen){this.resizeFrozen=false;this.resizeAnimation?.cancel();this.resizeAnimation=undefined;this.invalidateRegions();}
  if(this.x!==next.x||this.y!==next.y||this.z===undefined){
   this.x=next.x;this.y=next.y;this.root.style.transform=`translate3d(${next.x}px,${next.y}px,0)`;
  }
  if(this.z!==next.z){this.z=next.z;this.root.style.zIndex=String(next.z);}
  const scale=next.contentScale??1,scaleChanged=this.contentScale!==scale;
  if(scaleChanged){this.contentScale=scale;Object.assign(this.surface.style,{width:`${100/scale}%`,height:`${100/scale}%`,transform:`scale(${scale})`});}
  if(dimensionsChanged){
   this.width=next.width;this.height=next.height;this.resizeAnimation?.cancel();this.resizeAnimation=undefined;
   Object.assign(this.root.style,{width:`${next.width}px`,height:`${next.height}px`});
   if(from){
    const animation=this.root.animate([{transform:`translate3d(${from.x}px,${from.y}px,0)`,width:`${from.width}px`,height:`${from.height}px`},{transform:`translate3d(${next.x}px,${next.y}px,0)`,width:`${next.width}px`,height:`${next.height}px`}],{duration:300,easing:'cubic-bezier(.2,0,0,1)'});this.resizeAnimation=animation;
    const regions=()=>{if(this.resizeAnimation!==animation)return;this.scheduleRegions();requestAnimationFrame(regions);};requestAnimationFrame(regions);
    void animation.finished.then(()=>{if(this.resizeAnimation===animation){this.resizeAnimation=undefined;this.invalidateRegions();}}).catch(()=>{});
   }
  }
  const baseWidth=next.baseWidth??next.view.geometry.width,metricsChanged=baseWidth!==this.baseWidth||sizeChanged||dimensionsChanged;
  this.size=size;this.baseWidth=baseWidth;
  if(this.card&&(metricsChanged||scaleChanged)){if(sizeChanged)this.card.dataset.cardSize=size;this.applyMetrics(this.card,size,!next.preview&&(dimensionsChanged||sizeChanged));}
  if(dimensionsChanged)this.root.classList.toggle('widget-compact',next.height<48);
  const interactiveChanged=this.interactive!==next.interactive;
  if(interactiveChanged||!this.view){this.interactive=next.interactive;this.root.classList.toggle('widget-mirror',!next.interactive);this.root.inert=!next.interactive;this.invalidateRegions();}
  else if(metricsChanged||scaleChanged)this.scheduleRegions();
  if(this.view&&next.view.revision<=this.view.revision&&!interactiveChanged){this.view={...this.view,geometry:next.view.geometry};return;}
  if(next.view.device&&next.view.pending&&externalIntentSupersedes(`${hostLabel}:${this.id}`,next.view.origin,next.view.pending,this.operations.get(next.view.device.did)?.target))this.operations.cancel(next.view.device.did,false);
  const previous=this.view?.status;
  const observed=next.view.status?retainConfirmedStatus(previous??undefined,next.view.status):next.view.status;
  const group=next.view.groupIntent;
  this.view={...next.view,status:(group?.readback?confirmGroupCaption(observed??undefined,group.card):observed)??null};
  const device=next.view.device,error=next.view.error;
  const readable=!!device?.online&&!['authExpired','staleContext','permissionDenied'].includes(error?.kind??'');
  this.templateControls.setAccess(readable&&!device?.sharedReadOnly,readable);
  if(next.view.presentationStale)this.templateControls.unavailable();
  else if(next.view.presentation||size==='large')this.templateControls.accept(next.view.presentation??undefined);
  if(next.view.controlIntent)this.templateControls.receive(next.view.controlIntent);if(next.view.groupIntent){this.switchGroup.accept(next.view.groupIntent.card,false);this.switchGroup.receive(next.view.groupIntent);}this.render();
 }
 private scheduleRegions(){
  if(this.dead||!this.shown||!this.interactive)return;
  this.regionDirty=true;
  if(this.regionFrame||this.regionBusy)return;
  this.regionFrame=requestAnimationFrame(()=>{this.regionFrame=0;this.regionDirty=false;if(!this.card||!this.shown||!this.interactive||this.dead)return;
   const box=this.card.getBoundingClientRect();if(!box.width||!box.height)return;
   const regions:{kind:string;x:number;y:number;width:number;height:number}[]=[{kind:'body',x:0,y:0,width:box.width,height:box.height}];
   for(const node of this.card.querySelectorAll<HTMLElement>('.device-card-top > .device-shortcut,.card-control')){if(node.closest('[hidden]'))continue;const r=node.getBoundingClientRect(),x=Math.max(0,r.x-box.x),y=Math.max(0,r.y-box.y);if(r.width&&r.height)regions.push({kind:'control',x,y,width:Math.max(0,Math.min(r.width,box.width-x)),height:Math.max(0,Math.min(r.height,box.height-y))});}
   const presentation=this.root.getBoundingClientRect();const key=JSON.stringify([regions,presentation.x,presentation.y,presentation.width,presentation.height]);if(key===this.regionKey)return;
   const epoch=this.regionEpoch;
   this.regionBusy=true;
   void desktopWidgets.regions(this.id,box.width,box.height,regions,{x:presentation.x,y:presentation.y,width:presentation.width,height:presentation.height}).then(()=>{
    if(!this.dead&&epoch===this.regionEpoch){this.regionKey=key;this.regionAttempts=0;}
   }).catch(()=>{
    if(this.dead||epoch!==this.regionEpoch)return;
    this.regionKey='';if(this.regionAttempts++<10){clearTimeout(this.regionRetry);this.regionRetry=setTimeout(()=>this.scheduleRegions(),100);}
   }).finally(()=>{this.regionBusy=false;if(this.regionDirty)this.scheduleRegions();});
  });
 }
 private activate=(intent:HomeCardIntent)=>{closeMenu();const view=this.view,raw=view?.card;if(this.interactive&&view?.device&&!view.error&&raw?.enabled){if(raw.group){this.switchGroup.write(intent==='on');return;}this.operations.write(view.device.did,intent,cardReportedIntent(raw));}};
 private caption(view:WidgetView):string{const device=view.device!;const intents:DisplayIntent[]=[...this.switchGroup.displayIntents,...this.templateControls.confirmedCaption(view.status?.revision),...this.templateControls.displayIntents];const op=this.operations.get(device.did),binding=view.card?.binding;if(op?.pending&&binding&&['on','off'].includes(String(op.target)))intents.push({fieldId:`${binding.siid}:${binding.piid}`,value:op.target==='on',order:op.displayOrder??0});return cardCaption(device,device.roomName,view.status?[view.status]:[],projectCardStatus(view.status??undefined,intents));}
 private render():void{
  if(!this.shown)return;
  const view=this.view;if(!view?.device){if(!this.card)this.root.replaceChildren(element('div','widget-unavailable',view?.error?.message??'正在加载设备'));else{this.card.classList.add('offline');const control=this.card.querySelector<HTMLButtonElement>('.device-shortcut');if(control)control.disabled=true;updateCardControls(this.card,undefined,()=>{},false);const caption=this.card.querySelector('.device-room');if(caption)caption.textContent='设备暂不可用';}return;}
  const device=view.device,raw=view.card??undefined,op=this.operations.display(device.did,raw?cardReportedIntent(raw):undefined);
  this.templateControls.setActive(this.shown&&this.interactive&&!view.error&&cardSize(view.geometry.size)==='large'&&!this.gesturing);
  if(raw?.group)this.switchGroup.accept(raw);
  let shortcut=raw?.group?this.switchGroup.display:raw?cardDisplay(raw,device,(op.phase?op.value:view.pending??op.value),!!op.phase||!!view.pending):undefined;
  if(shortcut&&(view.error||!this.interactive))shortcut={...shortcut,enabled:false};
  const pending=!!this.operations.get(device.did)?.pending||!!view.pending;
  if(!this.card||this.card.dataset.deviceId!==device.did){
   this.drag.dispose();this.press.clear();this.card=deviceCardView({device,shortcut,pending,artwork:deviceArtwork(device),caption:this.caption(view),selected:false,open:()=>{if(this.interactive&&!this.drag.suppressOpen&&!menu)void desktopWidgets.open(this.id).catch(report);},activate:this.activate});
   this.press.bind(this.card,device.did);this.drag.bind(this.card,report);if(this.kind)this.drag.native('started',this.kind);
   this.surface.replaceChildren(this.card);this.root.replaceChildren(this.surface);
  }else{
   const heading=this.card.querySelector('h3');if(heading&&heading.textContent!==device.name)heading.textContent=device.name;
   const art=this.card.querySelector<HTMLElement>('.device-artwork');if(art&&art.dataset.artworkKey!==deviceArtworkKey(device))art.replaceWith(deviceArtwork(device));
   const caption=this.card.querySelector('.device-room'),text=view.error?'设备暂不可用':this.caption(view);if(caption&&caption.textContent!==text)caption.textContent=text;
   this.card.classList.toggle('is-active',cardActive(shortcut,device));this.card.classList.toggle('offline',!device.online);
   const old=this.card.querySelector('.device-status');if(old)updateHomeShortcut(old,device,shortcut,pending,this.activate);
  }
  const size=cardSize(view.geometry.size);this.card.dataset.cardSize=size;updateCardControls(this.card,this.templateControls.presentation,(id,value)=>this.templateControls.write(id,value),this.interactive&&!this.gesturing&&!view.error);this.applyMetrics(this.card,size);this.scheduleRegions();
  if(view.error)this.card.setAttribute('aria-description',view.error.message);else this.card.removeAttribute('aria-description');
 }
 dispose(){this.dead=true;this.shown=false;++this.regionEpoch;clearTimeout(this.regionRetry);cancelAnimationFrame(this.regionFrame);this.resizeAnimation?.cancel();if(this.card){cancelCardMetrics(this.card);cancelCardControls(this.card);}this.switchGroup.dispose();this.templateControls.dispose();this.operations.reset();this.drag.dispose();this.press.clear();this.root.remove();}
}

function apply(next:HostFrame){
 const dragged=next.cards.find(c=>c.gesture?.kind==='move');if(dragged&&previewColorKey!==`${dragged.view.id}:${dragged.gesture?.sequence}`){previewColorKey=`${dragged.view.id}:${dragged.gesture?.sequence}`;const node=cards.get(dragged.view.id)?.root.querySelector('.device-card');if(node)hintsLayer.style.setProperty('--drop-color',getComputedStyle(node).backgroundColor);}
 if(next.revision<revision)return;revision=next.revision;
 const hk=JSON.stringify(next.hints??[]);if(hk!==hintKey){
  hintKey=hk;const keep=new Set<string>();
  for(const h of next.hints??[]){
   const key=JSON.stringify([h.x,h.y,h.width,h.height]);keep.add(key);let node=hintNodes.get(key);
   if(!node){node=element('div','widget-grid-hint');Object.assign(node.style,{left:`${h.x}px`,top:`${h.y}px`,width:`${h.width}px`,height:`${h.height}px`});hintNodes.set(key,node);hintsLayer.append(node);}
   node.className=`widget-grid-hint ${h.state}`;
  }
  for(const[key,node]of hintNodes)if(!keep.has(key)){node.remove();hintNodes.delete(key);}
 }

 const key=JSON.stringify(next.viewport);if(viewportKey!==key||next.reset){viewportKey=key;const c=next.viewport.clip;root.style.clipPath=c?`inset(${c.y}px ${Math.max(0,next.viewport.width-c.x-c.width)}px ${Math.max(0,next.viewport.height-c.y-c.height)}px ${c.x}px)`:'none';syncViewport();}
 if(next.reset){const keep=new Set(next.cards.map(c=>c.view.id));for(const[id,card]of cards)if(!keep.has(id)){card.dispose();cards.delete(id);}}
 for(const id of next.removed){cards.get(id)?.dispose();cards.delete(id);}
 if(next.reset&&!next.cards.length)closeMenu();
 for(const card of next.cards){let live=cards.get(card.view.id);if(!live){live=new LiveCard(card.view.id);cards.set(card.view.id,live);}live.setShown(!!card.gesture||!!card.preview||(resource.visible&&(resource.visibleCards?.includes(card.view.id)??true)));live.update(card);if(next.reset)live.invalidateRegions();}
}
function accept(next:HostFrame){if(!queue.push(next)||frame)return;frame=requestAnimationFrame(()=>{frame=0;const pending=queue.drain();if(pending)apply(pending);});}
function acceptResources(state:ResourceState){if(!resourceRevisions.accept(state))return;resource=state;backgroundWork.setPaused(!state.visible);const visible=state.visibleCards&&new Set(state.visibleCards);for(const[id,card]of cards)card.setShown(card.gesturing||(state.visible&&(!visible||visible.has(id))));}
function placeMenu(x:number,y:number){
 if(!menu)return;const rect=menu.getBoundingClientRect();menu.style.left=`${Math.max(4,Math.min(x,innerWidth-rect.width-4))}px`;menu.style.top=`${Math.max(4,Math.min(y,innerHeight-rect.height-4))}px`;
 const box=menu.getBoundingClientRect();void desktopWidgets.menu({x:box.x,y:box.y,width:box.width,height:box.height}).catch(report);
}
root.addEventListener('contextmenu',event=>{
 const placement=(event.target as Element).closest<HTMLElement>('.widget-placement');if(!placement||placement.inert)return;
 event.preventDefault();closeMenu();const id=placement.dataset.widgetId!,live=cards.get(id);if(!live||live.gesturing)return;
 const frame=live.geometry;if(!frame)return;
 const choices=cardSizeMenu(cardSize(frame.size),size=>{
  if(size===cardSize(frame.size)){closeMenu();return;}
  const active=menu;if(!active)return;const enabled=[...active.querySelectorAll<HTMLButtonElement>('button')].filter(b=>!b.disabled);enabled.forEach(b=>b.disabled=true);
  void desktopWidgets.resize(id,size).then(()=>{if(menu===active)closeMenu();}).catch(error=>{if(menu!==active)return;report(error);active.querySelector('[role=alert]')?.remove();const message=element('small','settings-error',(error as {message?:string})?.message??'卡片尺寸未能保存');message.setAttribute('role','alert');active.append(message);enabled.forEach(b=>b.disabled=false);placeMenu(event.clientX,event.clientY);});
 },size=>widgetSizeAvailable(frame,size,[...cards.values()].filter(c=>c!==live).flatMap(c=>c.geometry?[c.geometry]:[])));
 const remove=button('取消固定','account-menu-item widget-unpin-menu-item',()=>{closeMenu();void desktopWidgets.unpin(id).catch(report);});remove.setAttribute('role','menuitem');
 menu=element('div','widget-menu device-context-menu',choices,remove);menu.setAttribute('role','menu');menu.setAttribute('aria-label','设备选项');
 menu.addEventListener('pointerdown',e=>e.stopPropagation());menu.addEventListener('click',e=>e.stopPropagation());cardMenuKeys(menu,closeMenu);root.append(menu);placeMenu(event.clientX,event.clientY);menu.querySelector<HTMLButtonElement>('button:not(:disabled):not([hidden])')?.focus({preventScroll:true});
 const active=menu;
 if(cardSize(frame.size)!=='large')void desktopWidgets.largeAvailable(id).then(available=>{
  if(menu!==active||cards.get(id)!==live||live.geometry?.size!==frame.size)return;
  showLargeCardChoice(active,available);placeMenu(event.clientX,event.clientY);
 }).catch(()=>{});
});
root.addEventListener('keydown',event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){const placement=(event.target as Element).closest<HTMLElement>('.widget-placement');if(!placement)return;event.preventDefault();const box=placement.getBoundingClientRect();placement.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:box.x+box.width/2,clientY:box.y+box.height/2}));}});
document.addEventListener('pointerdown',e=>{if(menu&&!menu.contains(e.target as Node))closeMenu();},{capture:true});
const motion=matchMedia('(prefers-reduced-motion: reduce)'),motionChanged=()=>{if(motion.matches)for(const card of cards.values())card.reduceMotion();syncViewport();};motion.addEventListener('change',motionChanged);
const unlisten=await listen<HostFrame>('desktop-widget-host-state',event=>accept(event.payload));
const unmenu=await listen('desktop-widget-menu-dismiss',closeMenu);
const unsubmit=await listen<UiSubmission>('ui-control-submitted',event=>{for(const card of cards.values())card.submission(event.payload);});
const unreadback=await listen<UiReadbackFailure>('ui-control-readback-failed',event=>{for(const card of cards.values())card.readbackFailure(event.payload);});
const ungesture=await listen<{widgetId:string;phase:string;kind?:'move';sequence?:number}>('desktop-widget-gesture',event=>cards.get(event.payload.widgetId)?.gesture(event.payload.phase,event.payload.kind,event.payload.sequence));

const unresources=await listenResourceState(hostLabel,acceptResources);
void invoke<ResourceState>('desktop_resource_snapshot').then(acceptResources).catch(()=>{});
for(let attempt=0;attempt<40&&!disposed;attempt++){try{accept(await desktopWidgets.snapshot());syncViewport();break;}catch{await new Promise(resolve=>setTimeout(resolve,200));}}
window.addEventListener('pagehide',()=>{disposed=true;motion.removeEventListener('change',motionChanged);cancelAnimationFrame(frame);clearTimeout(viewportTimer);window.removeEventListener('resize',syncViewport);unlisten();unmenu();unsubmit();unreadback();ungesture();unresources();for(const card of cards.values())card.dispose();cards.clear();},{once:true});
