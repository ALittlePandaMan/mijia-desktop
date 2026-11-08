import type {AppError,DeviceContext,DevicePanel} from './types';
import {normalizeError,sameContext} from './logic';
import {cameraDate} from './camera-browser';
import {propertyReading} from './panel-layout';
import {cloudDoorbellProfile} from './camera-profiles';
export const cloudDoorbellModel='madv.cateye.mi3iot';
export function isCloudDoorbell(model:string):boolean{return !!cloudDoorbellProfile(model);}
export function doorbellBattery(panel:DevicePanel|undefined):number|undefined{const p=panel?.services.flatMap(s=>s.properties).find(p=>p.name==='battery-level'),r=p&&propertyReading(p);return r?.source==='live'&&typeof r.value==='number'&&r.value>=0&&r.value<=100?r.value:undefined;}
export interface DoorbellEvent{id:string;time:number;kind:string;type:string;duration:number|null;thumbnailAvailable?:boolean;playbackAvailable?:boolean}
export interface DoorbellCloudReport{date:string;events:DoorbellEvent[];complete:boolean;retentionDays:number|null;availableFrom:number|null;playbackAvailable:boolean;reason:string}
export type DoorbellFilter='Default'|'Bell'|'Stay'|'Pass';
export function filteredDoorbellEvents(report:DoorbellCloudReport|undefined,filter:DoorbellFilter):DoorbellEvent[]{return (report?.events??[]).filter(e=>filter==='Default'||e.type.split(':').includes(filter));}
export class DoorbellState{
 report?:DoorbellCloudReport;error?:AppError;loading=false;date=cameraDate(Date.now()/1000);filter:DoorbellFilter='Default';view:'events'|'live'|'cloud'='events';selectedEvent?:DoorbellEvent;
 private context?:DeviceContext;private scope='';private epoch=0;private availableFrom:number|null=null;
 get oldestDate():string{return cameraDate(this.availableFrom??Date.now()/1000-31*86400);}
 private images=new Map<string,Promise<string|undefined>>();private queue:{run:()=>void;cancel:()=>void}[]=[];private workers=0;
 constructor(private readReport:(c:DeviceContext,date:string)=>Promise<DoorbellCloudReport>,private changed:()=>void,private failed:(e:AppError)=>void,private readThumbnail?:(c:DeviceContext,date:string,id:string)=>Promise<string>){}
 bind(c:DeviceContext,scope:string):void{if(!sameContext(c,this.context)||scope!==this.scope){this.close();this.context={...c};this.scope=scope;}}
 close():void{++this.epoch;this.clearImages();this.context=undefined;this.loading=false;this.report=undefined;this.availableFrom=null;this.error=undefined;this.date=cameraDate(Date.now()/1000);this.filter='Default';this.view='events';this.selectedEvent=undefined;}
 async read(date=this.date):Promise<void>{
  if(!this.context||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>cameraDate(Date.now()/1000))return;
  const c={...this.context},epoch=++this.epoch,current=()=>epoch===this.epoch&&sameContext(c,this.context);this.clearImages();this.date=date;this.loading=true;this.report=undefined;this.error=undefined;this.selectedEvent=undefined;this.view='events';this.changed();
  try{const r=await this.readReport(c,date);if(!current())return;
   if(r.date!==date||!Array.isArray(r.events)||r.events.some(e=>!e.id||!Number.isFinite(e.time)||typeof e.kind!=='string'||typeof e.type!=='string'||e.duration!==null&&(!Number.isFinite(e.duration)||e.duration<0)))throw Error('云端事件与所选日期不匹配。');
   this.report=r;if(r.availableFrom!==null&&Number.isFinite(r.availableFrom))this.availableFrom=r.availableFrom;
  }catch(e){if(current()){this.error=normalizeError(e);this.failed(this.error);}}
  finally{if(current()){this.loading=false;this.changed();}}
 }
 select(filter:DoorbellFilter):void{this.filter=filter;this.changed();}
 play(id:string):void{const event=this.report?.events.find(e=>e.id===id);if(this.loading||!this.report?.playbackAvailable||!event||event.playbackAvailable===false)return;this.selectedEvent=event;this.view='cloud';this.changed();}
 thumbnail(id:string):Promise<string|undefined>{
  const event=this.report?.events.find(e=>e.id===id);if(!this.context||!this.readThumbnail||!event?.thumbnailAvailable)return Promise.resolve(undefined);
  const cached=this.images.get(id);if(cached)return cached;
  const c={...this.context},epoch=this.epoch,date=this.date;let resolve!:(src:string|undefined)=>void;const result=new Promise<string|undefined>(r=>{resolve=r;});this.images.set(id,result);
  this.queue.push({cancel:()=>resolve(undefined),run:()=>{++this.workers;void this.readThumbnail!(c,date,id).then(src=>resolve(epoch===this.epoch&&sameContext(c,this.context)&&src.startsWith('data:image/')?src:undefined),()=>resolve(undefined)).finally(()=>{--this.workers;this.pump();});}});this.pump();return result;
 }
 private pump():void{while(this.workers<3&&this.queue.length)this.queue.shift()!.run();}
 private clearImages():void{for(const task of this.queue)task.cancel();this.queue=[];this.images.clear();}
}
