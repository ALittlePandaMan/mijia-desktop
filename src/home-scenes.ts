import type {AppError,Device,DeviceContext,DevicePanel,HomeCardEntry,HomeCardIntent,HomeSnapshot,Room,SensorHistory} from './types';
import {miotCategory,propertyReading} from './panel-layout';
import {normalizeError} from './logic';

export interface HomeScene {id:string;name:string;roomIds:string[];icon:string|null;common:boolean}
export interface HomeSceneReport {homeId:string;generation:number;scenes:HomeScene[]}
export interface SceneRoom {id:string;name:string;devices:Device[]}
export type EnvironmentMetric='temperature'|'humidity';
export interface EnvironmentReading {device:Device;temperature:number|null;humidity:number|null;history?:SensorHistory;error?:AppError}
export function thermometer(device:Device):boolean {
 return miotCategory(device.specType)==='temperature-humidity-sensor'||['miaomiaoce.sensor_ht.t1','miaomiaoce.sensor_ht.t2'].includes(device.model);
}
export function sceneRooms(devices:readonly Device[],rooms:readonly Room[],cards:readonly HomeCardEntry[],kind:'light'|'curtain'):SceneRoom[]{
 const byCard=new Map<string,HomeCardEntry>();for(const card of cards)if(!byCard.has(card.did))byCard.set(card.did,card);
 const targets=devices.filter(device=>{
  const category=miotCategory(device.specType),card=byCard.get(device.did);
  if(card?.modeAllowed===false)return false;
  return kind==='curtain'?category==='curtain'||card?.kind==='curtain':
    ['light','light-group','switch','relay','control-panel'].includes(category??'')&&card?.kind!=='curtain';
 });
 const known=new Set(rooms.map(r=>r.id)),groups=new Map<string,Device[]>();
 for(const device of targets){const key=known.has(device.roomId)?device.roomId:'?',group=groups.get(key)??[];group.push(device);groups.set(key,group);}
 return [...rooms,{id:'?',name:'未分配'}].flatMap(room=>{const devices=groups.get(room.id);return devices?.length?[{...room,devices}]:[];});
}
export function sceneControlAvailable(device:Device,card:HomeCardEntry|undefined,intent:HomeCardIntent):boolean{
 const kind=intent==='on'||intent==='off'?'power':'curtain';
 return device.online&&!device.sharedReadOnly&&card?.did===device.did&&card.kind===kind&&card.enabled&&card.modeAllowed!==false;
}
export function sceneShortcutGroups(scenes:readonly HomeScene[],rooms:readonly Room[]):{id:string;name:string;scenes:HomeScene[]}[]{
 const known=new Set(rooms.map(room=>room.id)),groups=new Map<string,HomeScene[]>(),global:HomeScene[]=[],unassigned:HomeScene[]=[];
 for(const scene of scenes){
  if(!scene.roomIds.length){global.push(scene);continue;}
  let matched=false;
  for(const id of new Set(scene.roomIds)){if(!known.has(id))continue;matched=true;const group=groups.get(id)??[];group.push(scene);groups.set(id,group);}
  if(!matched)unassigned.push(scene);
 }
 return [{id:'@home',name:'全屋',scenes:global},...rooms.map(room=>({...room,scenes:groups.get(room.id)??[]})),{id:'@unassigned',name:'未分配',scenes:unassigned}].filter(group=>group.scenes.length>0);
}
export function latestEnvironment(panel:DevicePanel,metric:EnvironmentMetric):number|null {
 const names=metric==='humidity'?['relative-humidity','humidity']:['temperature'];
 const properties=panel.services.filter(s=>s.name==='temperature-humidity-sensor').flatMap(s=>s.properties).filter(p=>names.includes(p.name)&&p.access.includes('read'));
 if(properties.length!==1)return null;
 const value=propertyReading(properties[0]).value;
 return typeof value==='number'&&Number.isFinite(value)&&(metric==='humidity'?value>=0&&value<=100:value>=-80&&value<=100)?value:null;
}
export function environmentSeries(history:SensorHistory|undefined,metric:EnvironmentMetric):[number,number|null][]{
 const channel=history?.channels.find(c=>c.name===metric);if(!channel)return [];
 const interval=60*60*1000,buckets=new Map<number,{sum:number;count:number}>();
 for(const point of channel.points){
  if(!Number.isFinite(point.time))continue;
  const time=Math.floor(point.time*1000/interval)*interval,bucket=buckets.get(time)??{sum:0,count:0};
  if(Number.isFinite(point.high)&&Number.isFinite(point.low)&&point.low<=point.high){bucket.sum+=(point.high+point.low)/2;++bucket.count;}
  buckets.set(time,bucket);
 }
 const ordered=[...buckets].sort((a,b)=>a[0]-b[0]);if(!ordered.length)return [];
 const first=ordered[0][0],last=ordered.at(-1)![0];
 const end=Number.isFinite(history?.end)?Math.floor(history!.end*1000/interval)*interval:last;
 const start=Math.max(first,Number.isFinite(history?.start)?Math.floor(history!.start*1000/interval)*interval:first,end-31*24*interval);
 const series:[number,number|null][]=[];let prior:number|null=null;
 for(const [time,bucket]of ordered){if(time>=start)break;if(bucket.count)prior=Number((bucket.sum/bucket.count).toFixed(1));}
 for(let time=start;time<=end;time+=interval){
  const bucket=buckets.get(time);if(bucket?.count)prior=Number((bucket.sum/bucket.count).toFixed(1));
  series.push([time,prior]);
 }
 return series;
}
export interface SceneTransport {
 list:(homeId:string,generation:number)=>Promise<HomeSceneReport>;
 run:(homeId:string,generation:number,sceneId:string,requestId:string)=>Promise<void>;
 panel:(context:DeviceContext)=>Promise<DevicePanel>;
 history:(context:DeviceContext)=>Promise<SensorHistory>;
 /** Queue an optimistic device intent synchronously, using the same controller as its card. */
 write:(device:Device,intent:HomeCardIntent)=>void;
 refresh:()=>Promise<void>;
}
export class HomeScenesState {
 private epoch=0;private context?:Pick<HomeSnapshot,'homeId'|'generation'>;private listRead?:Promise<void>;private listAt=0;private environmentHour=-1;private environmentRead?:Promise<void>;private environmentTimer?:ReturnType<typeof setTimeout>;private environmentDevices:readonly Device[]=[];
 scenes:HomeScene[]=[];loading=false;error?:AppError;environmentLoading=false;environment=new Map<string,EnvironmentReading>();environmentRevision=0;
 taskStates=new Map<string,{pending:boolean;sent?:boolean;error?:AppError}>();private taskTickets=new Map<string,Set<string>>();roomMessage?:string;
 constructor(private transport:SceneTransport,private changed:()=>void,private sessionError:(error:AppError)=>void){}
 get pending(){return [...this.taskStates.values()].some(s=>s.pending);}
 private resourcePaused=false;
 setResourcePaused(paused:boolean):void{if(this.resourcePaused===paused)return;this.resourcePaused=paused;clearTimeout(this.environmentTimer);this.environmentTimer=undefined;if(!paused&&this.environmentDevices.length)void this.loadEnvironment(this.environmentDevices);}
 reset(){++this.epoch;clearTimeout(this.environmentTimer);this.environmentTimer=undefined;this.environmentDevices=[];this.context=undefined;this.listRead=undefined;this.environmentRead=undefined;this.listAt=0;this.environmentHour=-1;this.scenes=[];this.loading=false;this.error=undefined;this.environmentLoading=false;this.environment.clear();++this.environmentRevision;this.taskStates.clear();this.taskTickets.clear();this.roomMessage=undefined;}
 connect(snapshot:Pick<HomeSnapshot,'homeId'|'generation'>){if(this.context?.homeId===snapshot.homeId&&this.context.generation===snapshot.generation)return;this.reset();this.context={homeId:snapshot.homeId,generation:snapshot.generation};}
 async load(force=false):Promise<void>{
  if(!this.context||this.resourcePaused&&!force)return;if(this.listRead)return this.listRead;if(!force&&Date.now()-this.listAt<60000)return;
  const context={...this.context},epoch=this.epoch;this.loading=true;this.error=undefined;this.changed();
  const run=async()=>{try{const report=await this.transport.list(context.homeId,context.generation);if(epoch!==this.epoch)return;if(report.homeId!==context.homeId||report.generation!==context.generation)throw {kind:'staleContext',message:'家庭已切换，请刷新后重试。',retryable:false};this.scenes=report.scenes;this.listAt=Date.now();}catch(error){if(epoch===this.epoch){this.error=normalizeError(error);this.sessionError(this.error);}}finally{if(epoch===this.epoch){this.loading=false;this.listRead=undefined;this.changed();}}};
  return this.listRead=run();
 }
 async run(scene:HomeScene):Promise<void>{
  if(!this.context||!this.scenes.some(s=>s.id===scene.id))return;
  const context={...this.context},epoch=this.epoch,ticket=crypto.randomUUID(),tickets=this.taskTickets.get(scene.id)??new Set<string>();
  tickets.add(ticket);this.taskTickets.set(scene.id,tickets);this.taskStates.set(scene.id,{pending:true});
  // Every deliberate click has its own nonce. Acknowledgements never gate another click.
  try{await this.transport.run(context.homeId,context.generation,scene.id,ticket);if(epoch!==this.epoch)return;this.taskStates.set(scene.id,{pending:true,sent:true});void this.transport.refresh();}
  catch(error){if(epoch!==this.epoch)return;const e=normalizeError(error);this.taskStates.set(scene.id,{pending:true,error:e});this.sessionError(e);}
  finally{if(epoch===this.epoch){tickets.delete(ticket);this.taskStates.set(scene.id,{...this.taskStates.get(scene.id),pending:tickets.size>0});if(!tickets.size)this.taskTickets.delete(scene.id);}}
 }
 control(devices:readonly Device[],intent:HomeCardIntent,cards:readonly HomeCardEntry[]):void{
  if(!this.context)return;
  const byId=new Map<string,HomeCardEntry>();
  for(const card of cards)if(!byId.has(card.did))byId.set(card.did,card);
  const targets=devices.filter(d=>sceneControlAvailable(d,byId.get(d.did),intent));if(!targets.length)return;
  const epoch=this.epoch;this.roomMessage=undefined;
  for(const device of targets){if(epoch!==this.epoch)break;this.transport.write(device,intent);}
 }
 private scheduleEnvironment():void{
  clearTimeout(this.environmentTimer);this.environmentTimer=undefined;
  if(this.resourcePaused||!this.context||!this.environmentDevices.length)return;
  const hour=3600000,delay=(Math.floor(Date.now()/hour)+1)*hour-Date.now();
  this.environmentTimer=setTimeout(()=>{this.environmentTimer=undefined;void this.loadEnvironment(this.environmentDevices);},delay);
 }
 async loadEnvironment(devices:readonly Device[]):Promise<void>{
  if(!this.context)return;this.environmentDevices=devices.filter(thermometer);if(this.resourcePaused)return;
  if(this.environmentRead)return this.environmentRead;
  const hour=Math.floor(Date.now()/3600000);if(this.environmentHour===hour){this.scheduleEnvironment();return;}
  this.environmentHour=hour;
  const targets=this.environmentDevices,context={...this.context},epoch=this.epoch;this.environmentLoading=true;if(!this.environment.size)this.changed();let cursor=0;
  const readings=new Map<string,EnvironmentReading>();
  const worker=async()=>{while(cursor<targets.length&&epoch===this.epoch&&!this.resourcePaused){const device=targets[cursor++],c={...context,did:device.did};const [panel,history]=await Promise.allSettled([this.transport.panel(c),this.transport.history(c)]);if(epoch!==this.epoch)return;
   const reading:EnvironmentReading={device,temperature:panel.status==='fulfilled'?latestEnvironment(panel.value,'temperature'):null,humidity:panel.status==='fulfilled'?latestEnvironment(panel.value,'humidity'):null};
   if(history.status==='fulfilled'&&history.value.did===device.did)reading.history=history.value;else if(history.status==='rejected')reading.error=normalizeError(history.reason);
   if(panel.status==='rejected'){const error=normalizeError(panel.reason);if(error.kind==='authExpired')this.sessionError(error);}
   // Keep a last successful reading when one channel temporarily fails.
   const previous=this.environment.get(device.did);
   if(panel.status==='rejected'&&previous){reading.temperature=previous.temperature;reading.humidity=previous.humidity;}
   if(!reading.history&&previous?.history)reading.history=previous.history;
   readings.set(device.did,reading);
  }};
  const run=async()=>{try{await Promise.all([worker(),worker(),worker()]);}finally{if(epoch===this.epoch){if(this.resourcePaused){this.environmentHour=-1;for(const[id,old]of this.environment)if(!readings.has(id))readings.set(id,old);}this.environment=readings;this.environmentLoading=false;this.environmentRead=undefined;++this.environmentRevision;this.scheduleEnvironment();this.changed();}}};return this.environmentRead=run();
 }
}
