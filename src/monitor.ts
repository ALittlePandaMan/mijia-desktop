import type {AppError,Device} from './types';
import type {CameraEvent,CameraFeatures,CameraReply,SavedCameraMedia,CameraOperation} from './camera-types';
import {normalizeError} from './logic';
import {cloudDoorbellProfile} from './camera-profiles';
export interface MonitorContext {homeId:string;generation:number}
export interface MonitorTimings {cloudStartMs?:number|null;cloudReadyMs?:number|null;connectStartMs?:number|null;connectedMs?:number|null;authenticatedMs?:number|null;firstPacketMs?:number|null;route?:string|null}
export interface MonitorRow {did:string;revision:number;state:string;events:CameraEvent[];error?:AppError|null;timings?:MonitorTimings|null;qualities?:CameraFeatures['qualities'];features?:CameraFeatures;diagnostics?:{queuedBytes:number;peakBytes:number;recoveries:number}}
export type MonitorOperation={kind:'quality';quality:string}|{kind:'record';enabled:boolean;width?:number;height?:number;lensId?:number;atTimestamp?:number;mediaGeneration?:number};
export interface MonitorDetail {leaseId:string;features:CameraFeatures}
export interface MonitorTransport {
 detailOpen?:(c:MonitorContext,id:string,did:string,revision:number)=>Promise<MonitorDetail>;
 detailCommand?:(c:MonitorContext,id:string,did:string,revision:number,leaseId:string,operation:CameraOperation)=>Promise<CameraReply>;
 microphone?:(c:MonitorContext,id:string,did:string,revision:number,leaseId:string,packet:string)=>Promise<void>;
 detailClose?:(c:MonitorContext,id:string,did:string,revision:number,leaseId:string)=>Promise<void>;
 create:(c:MonitorContext,dids:string[])=>Promise<string>;
 read:(c:MonitorContext,id:string)=>Promise<MonitorRow[]>;
 retry:(c:MonitorContext,id:string,did:string)=>Promise<void>;
 stop:(c:MonitorContext,id:string)=>Promise<void>;
 command?:(c:MonitorContext,id:string,did:string,revision:number,operation:MonitorOperation)=>Promise<CameraReply>;
 screenshot?:(c:MonitorContext,id:string,did:string,revision:number,png:string)=>Promise<SavedCameraMedia|null>;
}
export function monitorEligible(device:Device):boolean {
 const category=device.specType?.split(':')[3];
 return !cloudDoorbellProfile(device.model)&&!['video-doorbell','doorbell'].includes(category??'')&&!device.model.includes('.cateye.')&&(category==='camera'||device.model.includes('.camera.'));
}
export function monitorGrid(count:number,width:number,height:number):{columns:number;rows:number}{
 if(count<1)return{columns:1,rows:1};
 let best={columns:1,rows:count,score:Infinity,empty:Infinity};
 for(let columns=1;columns<=count;columns++){
  const rows=Math.ceil(count/columns),empty=columns*rows-count;
  const score=Math.abs(Math.log((Math.max(1,width-columns+1)/columns)/(Math.max(1,height-rows+1)/rows)/(16/9)))+empty/(columns*rows);
  if(score<best.score-1e-9||Math.abs(score-best.score)<1e-9&&(empty<best.empty||empty===best.empty&&columns<best.columns))best={columns,rows,score,empty};
 }
 return {columns:best.columns,rows:best.rows};
}
export function monitorRetryDelay(error:AppError|undefined,state:string,attempt:number):number|undefined {
 if(state==='closed')return 30000;
 if(state!=='error'||error&&(!error.retryable||['unsupported','videoUnsupported','videoProtocolUnsupported','videoAuthRejected','forbidden','permission','permissionDenied','readOnly','authExpired'].includes(error.kind)))return undefined;
 return [2000,5000,10000,30000][Math.min(Math.max(0,attempt),3)];
}

/** Group ownership survives rendering. Every asynchronous result is scoped to
 * one epoch; a late create is explicitly stopped without touching a newer group. */
export class MonitorConnection {
 private epoch=0;private context?:MonitorContext;private id?:string;private timer?:ReturnType<typeof setTimeout>;
 private starting?:Promise<string>;private retries=new Map<string,ReturnType<typeof setTimeout>>();private attempts=new Map<string,number>();private retrying=new Set<string>();private revisions=new Map<string,number>();
 private stopped:Promise<unknown>=Promise.resolve();private decoderFailures=new Set<string>();private readFailures=0;
 constructor(private transport:MonitorTransport,private rows:(rows:MonitorRow[])=>void,private error:(error:unknown)=>void){}
 open(context:MonitorContext,dids:string[],attempt=0):void {
  this.close();const epoch=this.epoch;this.context={...context};
  void this.stopped.then(async()=>{
   if(epoch!==this.epoch)return;
   try {
    const opening=this.transport.create(context,dids);this.starting=opening;const id=await opening;
    if(this.starting===opening)this.starting=undefined;
    if(epoch!==this.epoch){return;}
    this.id=id;void this.poll(context,id,epoch);
   }catch(error){if(epoch===this.epoch){this.starting=undefined;this.error(error);const delay=monitorRetryDelay(normalizeError(error),'error',attempt);if(delay!==undefined)this.timer=setTimeout(()=>{if(epoch===this.epoch)this.open(context,dids,attempt+1);},delay);}}
  });
 }
 private async poll(context:MonitorContext,id:string,epoch:number):Promise<void>{
  try {
   const rows=await this.transport.read(context,id);if(epoch!==this.epoch)return;this.readFailures=0;
   const fresh=rows.filter(row=>{const previous=this.revisions.get(row.did)??-1;if(row.revision<previous)return false;if(row.revision>previous)this.decoderFailures.delete(row.did);this.revisions.set(row.did,row.revision);return true;});
   this.rows(fresh);
   for(const row of fresh){
    if(row.state==='live'&&!this.decoderFailures.has(row.did)){this.attempts.delete(row.did);this.cancelRetry(row.did);}
    else if(row.state==='offline'||['connecting','waiting-frame'].includes(row.state)&&!this.decoderFailures.has(row.did)){this.cancelRetry(row.did);}
    else {const delay=monitorRetryDelay(row.error??undefined,row.state,this.attempts.get(row.did)??0);if(delay!==undefined&&!this.retries.has(row.did)&&!this.retrying.has(row.did))this.retries.set(row.did,setTimeout(()=>{this.retries.delete(row.did);this.retry(row.did);},delay));}
   }
   if(epoch===this.epoch)this.timer=setTimeout(()=>void this.poll(context,id,epoch),100);
  }catch(error){if(epoch===this.epoch){this.error(error);const delay=monitorRetryDelay(normalizeError(error),'error',this.readFailures++);if(delay!==undefined)this.timer=setTimeout(()=>void this.poll(context,id,epoch),delay);}}
 }
 retry(did:string):void {
  if(!this.context||!this.id||this.retrying.has(did))return;
  this.cancelRetry(did);const context=this.context,id=this.id,epoch=this.epoch;this.retrying.add(did);this.attempts.set(did,(this.attempts.get(did)??0)+1);
  void this.transport.retry(context,id,did).catch(error=>{if(epoch===this.epoch){this.error(error);const delay=monitorRetryDelay(normalizeError(error),'error',this.attempts.get(did)??0);if(delay!==undefined&&!this.retries.has(did))this.retries.set(did,setTimeout(()=>{this.retries.delete(did);this.retry(did);},delay));}}).finally(()=>{if(epoch===this.epoch)this.retrying.delete(did);});
 }
 decoderFailed(did:string):void {
  if(!this.context||!this.id||this.decoderFailures.has(did))return;
  this.decoderFailures.add(did);this.cancelRetry(did);
  this.retries.set(did,setTimeout(()=>{this.retries.delete(did);this.retry(did);},monitorRetryDelay(undefined,'error',this.attempts.get(did)??0)!));
 }
 private cancelRetry(did:string):void{const timer=this.retries.get(did);if(timer!==undefined)clearTimeout(timer);this.retries.delete(did);}
 private async action<T>(did:string,revision:number,run:(c:MonitorContext,id:string)=>Promise<T>):Promise<T>{
  const c=this.context,id=this.id,epoch=this.epoch;
  const current=()=>epoch===this.epoch&&this.revisions.get(did)===revision;
  if(!c||!id||!current())throw {kind:'staleContext',message:'视频会话已改变。',retryable:false};
  const result=await run(c,id);
  if(!current())throw {kind:'staleContext',message:'视频会话已改变。',retryable:false};
  return result;
 }
 command(did:string,revision:number,operation:MonitorOperation):Promise<CameraReply>{return this.action(did,revision,(c,id)=>{if(!this.transport.command)throw {kind:'unsupported',message:'当前连接不支持此操作。',retryable:false};return this.transport.command(c,id,did,revision,operation);});}
 screenshot(did:string,revision:number,png:string):Promise<SavedCameraMedia|null>{return this.action(did,revision,(c,id)=>{if(!this.transport.screenshot)throw {kind:'unsupported',message:'当前连接不支持截图。',retryable:false};return this.transport.screenshot(c,id,did,revision,png);});}
 detailOpen(did:string,revision:number):Promise<MonitorDetail>{return this.action(did,revision,(c,id)=>{if(!this.transport.detailOpen)throw Error('当前连接不支持设备详情。');return this.transport.detailOpen(c,id,did,revision);});}
 detailCommand(did:string,revision:number,leaseId:string,operation:CameraOperation):Promise<CameraReply>{return this.action(did,revision,(c,id)=>{if(!this.transport.detailCommand)throw Error('详情连接已关闭。');return this.transport.detailCommand(c,id,did,revision,leaseId,operation);});}
 microphone(did:string,revision:number,leaseId:string,packet:string):Promise<void>{return this.action(did,revision,(c,id)=>{if(!this.transport.microphone)throw Error('对讲连接已关闭。');return this.transport.microphone(c,id,did,revision,leaseId,packet);});}
 detailClose(did:string,revision:number,leaseId:string):Promise<void>{return this.action(did,revision,(c,id)=>this.transport.detailClose?.(c,id,did,revision,leaseId)??Promise.resolve());}
 close():void {
  ++this.epoch;if(this.timer!==undefined)clearTimeout(this.timer);this.timer=undefined;
  for(const did of this.retries.keys())this.cancelRetry(did);
  this.attempts.clear();this.retrying.clear();this.revisions.clear();this.decoderFailures.clear();this.readFailures=0;
  const c=this.context,id=this.id,opening=this.starting;this.context=undefined;this.id=undefined;this.starting=undefined;
  const closing=c?(id?this.transport.stop(c,id):opening?.then(id=>this.transport.stop(c,id))):undefined;
  if(closing)this.stopped=Promise.resolve(closing).catch(()=>{});
 }
}
