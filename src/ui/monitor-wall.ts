import {monitorGridView} from './camera-control-view';
import {api} from '../api';
import {nativeFullscreen} from '../desktop-fullscreen';
import {isTauri} from '@tauri-apps/api/core';
import {MonitorConnection,monitorEligible,type MonitorContext,type MonitorRow,type MonitorTransport} from '../monitor';
import {monitorPresets,monitorPresetGrid,monitorPresetKey,monitorPresetLimit,readMonitorPreset,writeMonitorPreset,type MonitorPreset} from '../monitor-layout';
import type {Device,HomeSnapshot} from '../types';
import {button,element} from './dom';
import {Tile} from './monitor-tile';
import {dismissOnBackdrop,dismissOutsideMenu} from './dialog-dismiss';
import {dropdownMenu} from './dropdown';
import './monitor-wall.css';
import {selectedMonitorMembers,type MonitorCatalog} from '../monitor-catalog';
type WallScope=Pick<MonitorContext,'allHomes'|'memberHomes'|'homeNames'>;
type WallSelection={snapshot:HomeSnapshot;excluded:readonly string[];scope?:WallScope;account?:string};

let windowTransition=Promise.resolve();
export function settleMonitorWindow():Promise<void>{return windowTransition;}
function monitorWindow(enabled:boolean,error:(e:unknown)=>void){if(isTauri())windowTransition=windowTransition.catch(()=>{}).then(()=>api.monitorWindow(enabled)).catch(error);}


export class MonitorWall {
 readonly root=element('main','monitor-wall');private grid=monitorGridView();private empty=element('div','monitor-empty','当前家庭暂无可显示的摄像头');
 private tiles=new Map<string,Tile>();private connection:MonitorConnection;private key='';private context?:MonitorContext;private paused=false;private presentationHidden=false;private enabled=false;private hoverTimer?:ReturnType<typeof setTimeout>;private observer:ResizeObserver;
 private detail?:{tile:Tile;revision:number;leaseId:string;root:HTMLDialogElement;closing?:boolean};private detailEpoch=0;private detailOpening=false;private detailClosing:Promise<void>=Promise.resolve();
 private selection?:WallSelection;
 private groupKey='';private order:string[]=[];private qualities=new Map<string,string>();
 private page=0;private pageCount=0;private pageSize=1;
 private presetKey?:string;private preferredPreset?:MonitorPreset;private maxPreset:MonitorPreset=1;private preset:MonitorPreset=1;
 private deferredRoster=false;
 private fullscreenTile?:{tile:Tile;events:AbortController};
 private splitMenu?:{node:HTMLElement;returnTo:HTMLElement;x:number;y:number;cleanup:()=>void};
 private previous=button('上一页','monitor-page-button',()=>this.showPage(this.page-1));
 private next=button('下一页','monitor-page-button',()=>this.showPage(this.page+1));
 private pageLabel=element('span','monitor-page-number');
 private pagination=element('nav','monitor-pagination',this.previous,this.pageLabel,this.next);
 constructor(private exit:()=>void,private error:(error:unknown)=>void,transport:MonitorTransport={create:api.createMonitor,read:api.readMonitor,retry:api.retryMonitor,stop:api.stopMonitor,command:api.monitorCommand,screenshot:api.monitorScreenshot,detailOpen:api.monitorDetailOpen,detailCommand:api.monitorDetailCommand,microphone:api.monitorMicrophone,detailClose:api.monitorDetailClose}){
  this.connection=new MonitorConnection(transport,rows=>this.apply(rows),error=>this.error(error));
  this.root.append(this.grid,this.empty,this.pagination);this.root.setAttribute('aria-label','监控模式');
  this.root.tabIndex=0;
  this.pagination.setAttribute('aria-label','监控分页');this.pagination.hidden=true;
  this.pageLabel.setAttribute('aria-live','polite');
  this.root.addEventListener('pointermove',e=>{if(e.clientY<60)this.reveal();});
  this.root.addEventListener('contextmenu',event=>{
   if((event.target as Element).closest('.monitor-detail'))return;
   event.preventDefault();this.openSplitMenu(event.clientX,event.clientY,event.target as HTMLElement);
  });
  this.root.addEventListener('keydown',event=>{
   if(event.key!=='ContextMenu'&&!(event.shiftKey&&event.key==='F10'))return;
   const target=event.target as HTMLElement;
   if(target.closest('.monitor-detail,.monitor-split-menu'))return;
   event.preventDefault();const box=target.getBoundingClientRect();this.openSplitMenu(box.left+12,box.top+12,target);
  });
  this.observer=new ResizeObserver(()=>this.layout());
 }
 get active():boolean{return this.enabled;}
 get blocksSuspension():boolean{return this.detailOpening||!!this.detail?.closing||[...this.tiles.values()].some(tile=>tile.blocksSuspension);}
 updateAll(view:MonitorCatalog):void {
  const members=selectedMonitorMembers(view);if(!members.length){this.close();return;}
  const memberHomes=Object.fromEntries(members.map(({home,device})=>[device.did,home.id]));
  const homeNames=Object.fromEntries(members.map(({home})=>[home.id,home.name]));
  this.update({homeId:members[0].home.id,generation:view.generation,devices:members.map(m=>m.device)},[],{allHomes:true,memberHomes,homeNames},view.scope);
 }
 update(snapshot:HomeSnapshot,excluded:readonly string[],scope?:WallScope,account?:string):void {
  this.selection={snapshot,excluded,scope,account};
  const excludedIds=new Set(excluded),byId=new Map(snapshot.devices.filter(d=>monitorEligible(d)&&!excludedIds.has(d.did)).map(device=>[device.did,device]));
  const homeId=scope?.allHomes?null:snapshot.homeId;
  const groupKey=JSON.stringify([account,homeId,snapshot.generation]),newGroup=groupKey!==this.groupKey;
  if(newGroup){
   this.closeSplitMenu();this.groupKey=groupKey;this.order=[];this.qualities.clear();this.page=0;
   this.presetKey=monitorPresetKey(account,homeId);this.preferredPreset=readMonitorPreset(this.presetKey);
  }
  const seen=new Set(this.order);
  const order=[...this.order.filter(did=>byId.has(did)),...[...byId.keys()].filter(did=>!seen.has(did))];
  const maxPreset=monitorPresetLimit(order.length),preset=this.preferredPreset&&this.preferredPreset<=maxPreset?this.preferredPreset:maxPreset;
  const pageSize=preset,pageCount=Math.ceil(order.length/pageSize);
  const anchor=order.indexOf(this.tiles.keys().next().value??'');
  const page=Math.min(this.pageSize!==pageSize&&!newGroup?Math.floor((anchor>=0?anchor:this.page*this.pageSize)/pageSize):this.page,Math.max(0,pageCount-1));
  const visible=order.slice(page*pageSize,(page+1)*pageSize);
  const devices=visible.map(did=>byId.get(did)!);
  const key=JSON.stringify([groupKey,devices.map(d=>[d.did,d.model,!!d.sharedReadOnly,scope?.memberHomes?.[d.did]])]);
  // A roster refresh may add or reorder pages while a tile owns active media work.
  // Defer that change unless a current device or its authorized route was removed.
  if(!newGroup&&this.key!==key&&this.pageBusy()&&[...this.tiles.values()].every(tile=>
   byId.get(tile.device.did)?.model===tile.device.model&&!!byId.get(tile.device.did)?.sharedReadOnly===!!tile.device.sharedReadOnly&&
   scope?.memberHomes?.[tile.device.did]===this.context?.memberHomes?.[tile.device.did])){
   this.deferredRoster=true;return;
  }
  this.deferredRoster=false;
  if(maxPreset!==this.maxPreset||order.length===0)this.closeSplitMenu(true);
  this.order=order;this.maxPreset=maxPreset;this.preset=preset;this.pageSize=pageSize;this.pageCount=pageCount;this.page=page;
  if(!this.enabled)monitorWindow(true,this.error);this.enabled=true;document.body.classList.add('monitor-mode');this.empty.hidden=devices.length>0;
  this.observer.observe(this.root);
  if(this.key!==key){
   this.leaveTileFullscreen();this.closeDetail(true);this.connection.close();for(const tile of this.tiles.values())tile.dispose();this.tiles.clear();this.grid.replaceChildren();this.key=key;this.context={homeId:snapshot.homeId,generation:snapshot.generation,...scope};
   for(const device of devices)this.addTile(device);
   if(devices.length){
    for(const tile of this.tiles.values())tile.setResourcePaused(this.paused,this.presentationHidden);
    this.connection.setPollingPaused(this.paused);
    this.connection.open(this.context,devices.map(d=>d.did));
   }
   this.reveal();
  }else for(const device of devices){const tile=this.tiles.get(device.did);if(tile)tile.device=device;}
  this.updatePagination();this.updateSplitMenu();this.layout();
 }
 private pageBusy():boolean{return this.detailOpening||!!this.detail||[...this.tiles.values()].some(tile=>tile.protectedWork);}
 private refreshSelection():void{
  const plan=this.selection;if(plan)this.update(plan.snapshot,plan.excluded,plan.scope,plan.account);
 }
 private resumeRoster():void{if(this.deferredRoster&&!this.paused&&!this.pageBusy())this.refreshSelection();}
 private splitPage(preset:MonitorPreset):number{return Math.floor(this.page*this.pageSize/preset);}
 private splitBlocked(preset:MonitorPreset):boolean{
  if(!this.pageBusy())return false;
  const start=this.splitPage(preset)*preset,visible=this.order.slice(start,start+preset);
  return visible.length!==this.tiles.size||visible.some(did=>!this.tiles.has(did));
 }
 private openSplitMenu(x:number,y:number,target:HTMLElement):void{
  if(!this.enabled||!this.order.length||this.paused||this.detail||this.detailOpening||this.fullscreenTile||
   document.fullscreenElement&&!document.fullscreenElement.contains(this.root))return;
  const returnTo=target.closest<HTMLElement>('.monitor-tile')??this.root;
  this.dismissPopup();
  const node=dropdownMenu({label:'分屏',className:'monitor-split-menu',selection:true,
   items:monitorPresets.filter(value=>value<=this.maxPreset).map(value=>({value:String(value),label:`${value} 路`,selected:value===this.preset,disabled:this.splitBlocked(value)})),
   choose:value=>{const preset=monitorPresets.find(p=>String(p)===value);if(preset)this.chooseSplit(preset);},dismiss:()=>this.closeSplitMenu(true)});
  const heading=element('div','monitor-split-heading','分屏');heading.setAttribute('aria-hidden','true');node.prepend(heading);
  node.addEventListener('focusin',event=>(event.target as HTMLElement).scrollIntoView({block:'nearest'}));
  this.root.append(node);
  this.splitMenu={node,returnTo,x,y,cleanup:dismissOutsideMenu(node,node,()=>this.closeSplitMenu())};
  this.positionSplitMenu();
  node.querySelector<HTMLButtonElement>('[aria-checked=true]')?.focus({preventScroll:true});
 }
 private positionSplitMenu():void{
  if(!this.splitMenu)return;
  const {node,x,y}=this.splitMenu;
  const bounds=this.root.getBoundingClientRect();
  node.style.maxHeight=`${Math.max(0,bounds.height-12)}px`;
  const box=node.getBoundingClientRect();
  node.style.left=`${Math.max(bounds.left+6,Math.min(x,bounds.right-box.width-6))}px`;
  node.style.top=`${Math.max(bounds.top+6,Math.min(y,bounds.bottom-box.height-6))}px`;
 }
 private chooseSplit(preset:MonitorPreset):void{
  if(!this.splitMenu||this.paused||preset>this.maxPreset||this.splitBlocked(preset))return;
  const {returnTo}=this.splitMenu;this.closeSplitMenu();
  this.preferredPreset=preset;writeMonitorPreset(this.presetKey,preset);this.refreshSelection();
  (returnTo.isConnected?returnTo:this.root).focus({preventScroll:true});
 }
 private updateSplitMenu():void{
  const node=this.splitMenu?.node;if(!node)return;
  for(const option of node.querySelectorAll<HTMLButtonElement>('button')){
   const preset=monitorPresets.find(p=>String(p)===option.value)!;
   if(option.getAttribute('aria-checked')!==String(preset===this.preset)){this.closeSplitMenu(true);return;}
   const disabled=this.splitBlocked(preset);
   if(disabled&&document.activeElement===option)node.querySelector<HTMLButtonElement>('[aria-checked=true]')?.focus({preventScroll:true});
   if(option.disabled!==disabled)option.disabled=disabled;
  }
 }
 private closeSplitMenu(restoreFocus=false):boolean{
  const menu=this.splitMenu;if(!menu)return false;
  this.splitMenu=undefined;menu.cleanup();menu.node.remove();
  if(restoreFocus)(menu.returnTo.isConnected?menu.returnTo:this.root).focus({preventScroll:true});
  return true;
 }
 private showPage(page:number):void{
  const plan=this.selection;
  if(!plan||this.paused||this.fullscreenTile||this.pageBusy()||page<0||page>=this.pageCount||page===this.page)return;
  const focus=this.root.contains(document.activeElement);
  this.page=page;this.refreshSelection();
  if(focus)(this.next.disabled?this.previous:this.next).focus({preventScroll:true});
 }
 private updatePagination():void{
  const hidden=this.pageCount<2||!!this.fullscreenTile;
  if(this.pagination.hidden!==hidden)this.pagination.hidden=hidden;
  if(hidden)return;
  const busy=this.paused||this.pageBusy(),label=`${this.page+1} / ${this.pageCount}`;
  if(this.pageLabel.textContent!==label)this.pageLabel.textContent=label;
  const previous=busy||this.page===0,next=busy||this.page+1===this.pageCount;
  if(this.previous.disabled!==previous)this.previous.disabled=previous;
  if(this.next.disabled!==next)this.next.disabled=next;
 }
 private apply(rows:MonitorRow[]):void {if(!this.enabled)return;for(const row of rows){if(this.paused&&this.tiles.get(row.did)?.resourceIsPaused)continue;if(this.detail?.tile.device.did===row.did&&(row.revision!==this.detail.revision||['error','offline','closed'].includes(row.state)&&this.detail.tile.root.dataset.state!==row.state))this.closeDetail(true);this.tiles.get(row.did)?.update(row);}this.resumeRoster();this.updatePagination();this.updateSplitMenu();}
 private toggleFullscreenInWall(tile:Tile):boolean{
  if(this.fullscreenTile?.tile===tile)return this.leaveTileFullscreen();
  // Keep the existing outer fullscreen owner when inspecting a single tile.
  if(!nativeFullscreen()&&!document.fullscreenElement?.contains(this.root))return false;
  const events=new AbortController();
  const checkOuter=()=>{if(!nativeFullscreen()&&!document.fullscreenElement?.contains(this.root))this.leaveTileFullscreen();};
  window.addEventListener('desktop-fullscreen-state',checkOuter,{signal:events.signal});
  document.addEventListener('fullscreenchange',checkOuter,{signal:events.signal});
  this.closeSplitMenu();this.fullscreenTile={tile,events};this.root.classList.add('monitor-single-fullscreen');
  for(const other of this.tiles.values())other.root.inert=other!==tile;
  tile.setWallFullscreen(true);this.updatePagination();return true;
 }
 leaveTileFullscreen():boolean{
  const fullscreen=this.fullscreenTile;if(!fullscreen)return false;
  this.fullscreenTile=undefined;fullscreen.events.abort();this.root.classList.remove('monitor-single-fullscreen');
  for(const other of this.tiles.values())other.root.inert=false;
  fullscreen.tile.setWallFullscreen(false);this.updatePagination();return true;
 }
 private addTile(device:Device):void {
  const home=this.context?.memberHomes?.[device.did]??this.context?.homeId;
  const qualityKey=JSON.stringify([home,device.did,device.model]);
  const tile:Tile=new Tile(device,()=>this.connection.retry(device.did),()=>this.connection.decoderFailed(device.did),{
   initialQuality:this.qualities.get(qualityKey),
   fullscreenInWall:()=>this.toggleFullscreenInWall(tile),
   rememberQuality:quality=>{this.qualities.set(qualityKey,quality);},
   command:(revision,operation)=>this.connection.command(device.did,revision,operation),
   screenshot:(revision,png)=>this.connection.screenshot(device.did,revision,png),
   context:this.context?{homeId:this.context.memberHomes?.[device.did]??this.context.homeId,generation:this.context.generation,did:device.did}:undefined,
   label:this.context?.allHomes?`${device.name} · ${this.context.homeNames?.[this.context.memberHomes?.[device.did]??'']} · ${device.roomName||'未分配房间'}`:undefined,
   open:()=>{if(this.detail?.tile===tile)void this.closeDetail();else void this.openDetail(tile);},
   detailCommand:(revision,operation)=>{const d=this.detail;if(!d||d.tile!==tile||d.revision!==revision)throw Error('详情连接已关闭。');return this.connection.detailCommand(device.did,revision,d.leaseId,operation);},
   microphone:(revision,packet):Promise<void>=>{
    const d=this.detail;if(d&&d.tile===tile){if(d.revision!==revision)throw Error('对讲连接已关闭。');return this.connection.microphone(device.did,revision,d.leaseId,packet);}
    return this.connection.microphone(device.did,revision,null,packet);
   },
   beforeTalk:async()=>{await Promise.all([...this.tiles.values()].filter(other=>other!==tile).map(other=>other.page.stopTalk()));},
  });this.tiles.set(device.did,tile);this.grid.append(tile.root);
 }
 private layoutFrame?:number;
 private layout():void {
  if(this.layoutFrame!==undefined)return;
  this.layoutFrame=requestAnimationFrame(()=>{
   this.layoutFrame=undefined;if(!this.enabled)return;
   const grid=monitorPresetGrid(this.preset);
   const bounds=this.root.getBoundingClientRect(),gap=1,horizontalGap=(grid.columns-1)*gap,verticalGap=(grid.rows-1)*gap;
   const tileWidth=Math.max(0,Math.min((bounds.width-horizontalGap)/grid.columns,(bounds.height-verticalGap)/grid.rows*16/9));
   const width=tileWidth*grid.columns+horizontalGap,height=tileWidth*9/16*grid.rows+verticalGap;
   this.grid.style.width=`${width}px`;this.grid.style.height=`${height}px`;this.grid.style.gridTemplateColumns=`repeat(${grid.columns},minmax(0,1fr))`;this.grid.style.gridTemplateRows=`repeat(${grid.rows},minmax(0,1fr))`;
   this.root.dataset.columns=String(grid.columns);this.root.dataset.rows=String(grid.rows);
   const required=grid.columns*grid.rows-this.tiles.size,blanks=[...this.grid.querySelectorAll('.monitor-blank')];
   for(const blank of blanks.slice(required))blank.remove();
   for(let i=blanks.length;i<required;i++){const blank=element('div','monitor-blank');blank.setAttribute('aria-hidden','true');this.grid.append(blank);}
   this.positionSplitMenu();
  });
 }
 private async openDetail(tile:Tile):Promise<void>{
  if(!this.enabled||this.paused||this.fullscreenTile||document.fullscreenElement===tile.root||this.detail||this.detailOpening)return;this.closeSplitMenu();this.detailOpening=true;
  const epoch=++this.detailEpoch,revision=tile.routeRevision;
  try{await this.detailClosing;if(epoch!==this.detailEpoch||!this.enabled)return;const lease=await this.connection.detailOpen(tile.device.did,revision);if(epoch!==this.detailEpoch||!this.enabled||tile.routeRevision!==revision){void this.connection.detailClose(tile.device.did,revision,lease.leaseId).catch(()=>{});return;}
   const root=document.createElement('dialog');root.className='monitor-detail';root.setAttribute('aria-label',tile.device.name+'设备详情');root.addEventListener('cancel',e=>{e.preventDefault();this.handleEscape();});dismissOnBackdrop(root,()=>{if(this.detail?.root===root&&!tile.page.dismissPopup())void this.closeDetail();});root.append(tile.takeView());this.detail={tile,revision,leaseId:lease.leaseId,root};this.root.append(root);root.showModal();tile.page.activatePower(true);root.querySelector<HTMLButtonElement>('.page-icon-button')?.focus();
  }catch(error){if(epoch===this.detailEpoch)this.error(error);}finally{this.detailOpening=false;}
 }
 private async closeDetail(force=false):Promise<void>{
  ++this.detailEpoch;const d=this.detail;if(!d)return;
  if(!force){if(d.closing)return;d.closing=true;try{await d.tile.page.leaveDetail();}catch(error){this.error(error);}if(this.detail!==d)return;}
  this.detail=undefined;d.root.close();d.tile.returnView();d.root.remove();d.tile.root.focus({preventScroll:true});this.detailClosing=this.connection.detailClose(d.tile.device.did,d.revision,d.leaseId).catch(()=>{});
 }

 reveal():void {if(this.hoverTimer!==undefined)clearTimeout(this.hoverTimer);document.body.classList.add('monitor-controls-visible');this.hoverTimer=setTimeout(()=>{document.body.classList.remove('monitor-controls-visible');},2200);}
 setPaused(paused:boolean,presentationHidden=false):void {
  if(!paused&&!this.paused&&presentationHidden===this.presentationHidden)return;
  this.paused=paused;this.presentationHidden=presentationHidden;if(!this.enabled)return;
  if(paused){
   this.closeSplitMenu();
   for(const tile of this.tiles.values())tile.setResourcePaused(true);
   this.connection.setPollingPaused(!this.detailOpening&&[...this.tiles.values()].every(t=>t.resourceIsPaused));
   if(this.layoutFrame!==undefined)cancelAnimationFrame(this.layoutFrame);this.layoutFrame=undefined;
  }else{
   for(const tile of this.tiles.values())tile.setResourcePaused(false,presentationHidden);
   this.connection.setPollingPaused(false);
   this.resumeRoster();
   this.layout();
  }
  this.updatePagination();
 }
 dismissPopup():boolean{return this.closeSplitMenu(true)||(this.detail?this.detail.tile.page.dismissPopup():[...this.tiles.values()].some(tile=>tile.dismissOverlay()));}
 handleEscape():void {if(this.dismissPopup()||this.leaveTileFullscreen())return;if(document.fullscreenElement){void document.exitFullscreen().catch(this.error);}else if(this.detail){void this.closeDetail();}else this.exit();}
 close():void {
  this.closeSplitMenu();this.leaveTileFullscreen();this.deferredRoster=false;
  if(this.layoutFrame!==undefined)cancelAnimationFrame(this.layoutFrame);this.layoutFrame=undefined;
  if(this.enabled)monitorWindow(false,this.error);this.enabled=false;void this.closeDetail(true);this.connection.close();for(const tile of this.tiles.values())tile.dispose();this.tiles.clear();this.grid.replaceChildren();this.observer.disconnect();this.key='';this.context=undefined;
  if(this.hoverTimer!==undefined)clearTimeout(this.hoverTimer);this.hoverTimer=undefined;document.body.classList.remove('monitor-mode','monitor-controls-visible');
  this.selection=undefined;this.groupKey='';this.order=[];this.qualities.clear();this.page=0;this.pageCount=0;this.pageSize=1;this.pagination.hidden=true;
 }
}
