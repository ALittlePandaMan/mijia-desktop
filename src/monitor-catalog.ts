import type {Device,Home} from './types';
import {api} from './api';
export interface MonitorHousehold{home:Home;devices:Device[];excludedDeviceIds:string[];error?:{message:string}|null}
export interface MonitorCatalog{scope:string;generation:number;allHomes:boolean;homes:MonitorHousehold[];incomplete:boolean}
export function selectedMonitorMembers(view:MonitorCatalog):{home:Home;device:Device}[]{
 const seen=new Set<string>();return view.homes.filter(h=>!h.error).flatMap(h=>h.devices.filter(d=>!h.excludedDeviceIds.includes(d.did)).map(device=>({home:h.home,device}))).filter(({device})=>{if(seen.has(device.did))return false;seen.add(device.did);return true;});
}
export class MonitorCatalogController{
 data?:MonitorCatalog;loading=false;pending=0;error='';private scope:string|null=null;private epoch=0;private version=0;private flight?:Promise<void>;private queue=Promise.resolve();
 constructor(private changed:()=>void,private transport={load:api.monitorCatalog,change:api.changeMonitorSelection}){}
 setAccount(scope:string|null):void{if(scope===this.scope)return;this.scope=scope;++this.epoch;++this.version;this.data=undefined;this.flight=undefined;this.loading=false;this.pending=0;this.error='';}
 load(force=false):Promise<void>{
  if(!this.scope)return Promise.resolve();if(this.flight)return this.flight;
  const epoch=this.epoch,version=this.version,scope=this.scope;this.loading=true;this.error='';
  const flight=this.transport.load(force).then(data=>{if(epoch===this.epoch&&version===this.version&&data.scope===scope)this.data=data;}).catch(()=>{if(epoch===this.epoch)this.error='摄像头列表读取失败，请重试';}).finally(()=>{if(epoch===this.epoch){this.loading=false;if(this.flight===flight)this.flight=undefined;this.changed();}});
  this.flight=flight;this.changed();return flight;
 }
 select(homeId:string,did:string,excluded:boolean):void{
  if(!this.data||!this.scope)return;const before=structuredClone(this.data),epoch=this.epoch,version=++this.version,scope=this.scope;
  const home=this.data.homes.find(h=>h.home.id===homeId);if(!home||!home.devices.some(d=>d.did===did))return;
  home.excludedDeviceIds=excluded?[...new Set([...home.excludedDeviceIds,did])]:home.excludedDeviceIds.filter(id=>id!==did);++this.pending;this.error='';this.changed();
  this.queue=this.queue.catch(()=>{}).then(async()=>{if(epoch!==this.epoch)return;try{const data=await this.transport.change(scope,homeId,did,excluded);if(epoch===this.epoch&&version===this.version&&data.scope===scope)this.data=data;}catch{if(epoch===this.epoch&&version===this.version){this.data=before;try{const confirmed=await this.transport.load(false);if(epoch===this.epoch&&version===this.version&&confirmed.scope===scope)this.data=confirmed;}catch{/* Keep the last display until an explicit retry. */}this.error='监控选择保存失败，请重试';}}finally{if(epoch===this.epoch){--this.pending;this.changed();}}});
 }
}
