import {api} from '../api';
import {isTauri} from '@tauri-apps/api/core';
import {MonitorConnection,monitorEligible,monitorGrid,type MonitorContext,type MonitorRow,type MonitorTransport} from '../monitor';
import type {Device,HomeSnapshot} from '../types';
import {element} from './dom';
import {Tile} from './monitor-tile';
import {dismissOnBackdrop} from './dialog-dismiss';
import './monitor-wall.css';

let windowTransition=Promise.resolve();
function monitorWindow(enabled:boolean,error:(e:unknown)=>void){if(isTauri())windowTransition=windowTransition.catch(()=>{}).then(()=>api.monitorWindow(enabled)).catch(error);}


export class MonitorWall {
 readonly root=element('main','monitor-wall');private grid=element('div','monitor-grid');private empty=element('div','monitor-empty','当前家庭暂无可显示的摄像头');
 private tiles=new Map<string,Tile>();private connection:MonitorConnection;private key='';private context?:MonitorContext;private paused=false;private enabled=false;private hoverTimer?:ReturnType<typeof setTimeout>;private observer:ResizeObserver;
 private detail?:{tile:Tile;revision:number;leaseId:string;root:HTMLDialogElement;closing?:boolean};private detailEpoch=0;private detailOpening=false;private detailClosing:Promise<void>=Promise.resolve();
 constructor(private exit:()=>void,private error:(error:unknown)=>void,transport:MonitorTransport={create:api.createMonitor,read:api.readMonitor,retry:api.retryMonitor,stop:api.stopMonitor,command:api.monitorCommand,screenshot:api.monitorScreenshot,detailOpen:api.monitorDetailOpen,detailCommand:api.monitorDetailCommand,microphone:api.monitorMicrophone,detailClose:api.monitorDetailClose}){
  this.connection=new MonitorConnection(transport,rows=>this.apply(rows),error=>this.error(error));
  this.root.append(this.grid,this.empty);this.root.setAttribute('aria-label','监控模式');
  this.root.addEventListener('pointermove',e=>{if(e.clientY<60)this.reveal();});
  this.observer=new ResizeObserver(()=>this.layout());
 }
 get active():boolean{return this.enabled;}
 update(snapshot:HomeSnapshot,excluded:readonly string[]):void {
  const selected=snapshot.devices.filter(d=>monitorEligible(d)&&!excluded.includes(d.did));
  const sameHome=this.context?.homeId===snapshot.homeId&&this.context?.generation===snapshot.generation;
  const prior=sameHome?[...this.tiles.keys()]:[];
  const devices=[...prior.flatMap(did=>{const device=selected.find(d=>d.did===did);return device?[device]:[];}),...selected.filter(d=>!prior.includes(d.did))];
  const key=JSON.stringify([snapshot.homeId,snapshot.generation,devices.map(d=>[d.did,d.model])]);
  if(!this.enabled)monitorWindow(true,this.error);this.enabled=true;document.body.classList.add('monitor-mode');this.empty.hidden=devices.length>0;
  this.observer.observe(this.root);
  if(this.key!==key){
   this.closeDetail(true);this.connection.close();for(const tile of this.tiles.values())tile.dispose();this.tiles.clear();this.grid.replaceChildren();this.key=key;this.context={homeId:snapshot.homeId,generation:snapshot.generation};
   for(const device of devices)this.addTile(device);
   if(!this.paused&&devices.length)this.connection.open(this.context,devices.map(d=>d.did));
   this.reveal();
  }else for(const device of devices){const tile=this.tiles.get(device.did);if(tile)tile.device=device;}
  this.layout();
 }
 private apply(rows:MonitorRow[]):void {if(!this.enabled||this.paused)return;for(const row of rows){if(this.detail?.tile.device.did===row.did&&(row.revision!==this.detail.revision||['error','offline','closed'].includes(row.state)&&this.detail.tile.root.dataset.state!==row.state))this.closeDetail(true);this.tiles.get(row.did)?.update(row);}}
 private addTile(device:Device):void {const tile=new Tile(device,()=>this.connection.retry(device.did),()=>this.connection.decoderFailed(device.did),{command:(revision,operation)=>this.connection.command(device.did,revision,operation),screenshot:(revision,png)=>this.connection.screenshot(device.did,revision,png),context:this.context?{...this.context,did:device.did}:undefined,open:()=>{if(this.detail?.tile===tile)void this.closeDetail();else void this.openDetail(tile);},detailCommand:(revision,operation)=>{const d=this.detail;if(!d||d.tile!==tile||d.revision!==revision)throw Error('详情连接已关闭。');return this.connection.detailCommand(device.did,revision,d.leaseId,operation);},microphone:(revision,packet)=>{const d=this.detail;if(!d||d.tile!==tile||d.revision!==revision)throw Error('对讲连接已关闭。');return this.connection.microphone(device.did,revision,d.leaseId,packet);}});this.tiles.set(device.did,tile);this.grid.append(tile.root);}
 private layoutFrame?:number;
 private layout():void {
  if(this.layoutFrame!==undefined)return;
  this.layoutFrame=requestAnimationFrame(()=>{
   this.layoutFrame=undefined;if(!this.enabled)return;
   const bounds=this.root.getBoundingClientRect(),width=Math.min(bounds.width,bounds.height*16/9),height=width*9/16,grid=monitorGrid(this.tiles.size,width,height);
   this.grid.style.width=`${width}px`;this.grid.style.height=`${height}px`;this.grid.style.gridTemplateColumns=`repeat(${grid.columns},minmax(0,1fr))`;this.grid.style.gridTemplateRows=`repeat(${grid.rows},minmax(0,1fr))`;
   this.root.dataset.columns=String(grid.columns);this.root.dataset.rows=String(grid.rows);
   const required=grid.columns*grid.rows-this.tiles.size,blanks=[...this.grid.querySelectorAll('.monitor-blank')];
   for(const blank of blanks.slice(required))blank.remove();
   for(let i=blanks.length;i<required;i++)this.grid.append(element('div','monitor-blank'));
  });
 }
 private async openDetail(tile:Tile):Promise<void>{
  if(!this.enabled||this.paused||document.fullscreenElement===tile.root||this.detail||this.detailOpening)return;this.detailOpening=true;
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
 setPaused(paused:boolean):void {
  if(this.paused===paused)return;this.paused=paused;if(!this.enabled)return;
  void this.closeDetail(true);this.connection.close();for(const tile of this.tiles.values())tile.dispose();const devices=[...this.tiles.values()].map(t=>t.device);this.tiles.clear();this.grid.replaceChildren();
  for(const device of devices)this.addTile(device);
  this.layout();
  if(!paused&&this.context&&devices.length)this.connection.open(this.context,devices.map(d=>d.did));
 }
 handleEscape():void {if(document.fullscreenElement){void document.exitFullscreen().catch(this.error);}else if(this.detail){if(!this.detail.tile.page.dismissPopup())void this.closeDetail();}else if(![...this.tiles.values()].some(tile=>tile.dismissOverlay()))this.exit();}
 close():void {
  if(this.layoutFrame!==undefined)cancelAnimationFrame(this.layoutFrame);this.layoutFrame=undefined;
  if(this.enabled)monitorWindow(false,this.error);this.enabled=false;void this.closeDetail(true);this.connection.close();for(const tile of this.tiles.values())tile.dispose();this.tiles.clear();this.grid.replaceChildren();this.observer.disconnect();this.key='';this.context=undefined;
  if(this.hoverTimer!==undefined)clearTimeout(this.hoverTimer);this.hoverTimer=undefined;document.body.classList.remove('monitor-mode','monitor-controls-visible');
 }
}
