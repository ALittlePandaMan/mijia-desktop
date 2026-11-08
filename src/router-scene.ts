import type {AppError,DeviceContext} from './types';
import {normalizeError,sameContext} from './logic';
import {routerModel} from './router';
export const sceneKinds=['speedtest','browserlite','video','filedown','game'] as const;
export type SceneKind=typeof sceneKinds[number];
export const sceneNames:Record<SceneKind,string>={speedtest:'宽带测速',browserlite:'网页体验',video:'视频体验',filedown:'文件下载',game:'游戏体验'};
export interface SceneRow {kind:SceneKind;id:string|null;name:string;time:string|null;metrics:{label:string;value:string}[]}
export interface SceneChange {requestId:string;baseline:string;selected:SceneKind[]}
export interface SceneReport {did:string;model:string;revision:string;selected:SceneKind[];durationMinutes:number;startEnabled:boolean;finished:boolean;percent:number|null;rows:SceneRow[];fingerprint:string;reason:string|null;receipt:{requestId:string;baseline:string;stage:string;selected:SceneKind[];observedRunning?:boolean}|null}
export interface SceneHistory {did:string;kind:SceneKind;days:number;page:number;totalPages:number;rows:SceneRow[]}
interface Transport {read:(c:DeviceContext)=>Promise<SceneReport>;history:(c:DeviceContext,kind:SceneKind,days:number,page:number)=>Promise<SceneHistory>;detail:(c:DeviceContext,kind:SceneKind,id:string)=>Promise<SceneRow>;start:(c:DeviceContext,change:SceneChange)=>Promise<SceneReport>;stop:(c:DeviceContext)=>Promise<SceneReport>}
export class RouterSceneState {
 report?:SceneReport;history?:SceneHistory;detail?:SceneRow;selected:SceneKind[]=[];kind:SceneKind='speedtest';days=3;page=1;
 tab:'manual'|'history'='manual';loading=false;historyLoading=false;detailLoading=false;pending=false;error?:AppError;historyError?:AppError;detailError?:AppError;modal:'start'|'stop'|'detail'|null=null;
 private context?:DeviceContext;private scope='';private epoch=0;private historyEpoch=0;private detailEpoch=0;private timer?:ReturnType<typeof setTimeout>;private change?:SceneChange;
 constructor(private api:Transport,private changed:()=>void,private failed:(e:AppError)=>void){}
 bind(c:DeviceContext,scope:string):void{if(!sameContext(c,this.context)||scope!==this.scope){this.close();this.context={...c};this.scope=scope;}}
 close():void{++this.epoch;++this.historyEpoch;++this.detailEpoch;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.context=undefined;this.report=this.history=this.detail=undefined;this.selected=[];this.kind='speedtest';this.days=3;this.page=1;this.tab='manual';this.loading=this.historyLoading=this.detailLoading=this.pending=false;this.modal=null;this.error=this.historyError=this.detailError=undefined;this.change=undefined;}
 get stage():string{return this.report?.receipt?.stage??(this.report&&!this.report.startEnabled&&!this.report.finished?'running':'idle');}
 get active():boolean{return ['starting','running','unconfirmed','stopping','configuring'].includes(this.stage);}
 get blocked():boolean{return this.loading||this.pending||!this.report||!!this.report.reason||!this.report.startEnabled||this.active;}
 get message():string{if(this.stage==='stopped'&&this.report?.receipt?.observedRunning===false)return '路由器当前未在测速。';return ({unconfirmed:'设备未返回测速进度，尚不能确认已启动。请在手机米家检查测速服务；不会自动重发。',starting:'开始请求已发送，正在确认测速状态…',running:'正在测速',stopping:'停止请求已发送，正在确认…',configuring:'测速项目尚未确认，正在查询，不会重复发送。',configured:'测速项目已确认，请点击开始测速继续。',complete:'本次测速已完成',stopped:'测速已停止'})[this.stage]??'';}
 private accept(r:SceneReport,c:DeviceContext):void {
  if(r.did!==c.did||r.model!==routerModel||!/^[a-f\d]{64}$/.test(r.revision)||!/^[a-f\d]{64}$/.test(r.fingerprint)||!Array.isArray(r.selected)||r.selected.some(k=>!sceneKinds.includes(k))||new Set(r.selected).size!==r.selected.length||!Number.isFinite(r.durationMinutes)||r.durationMinutes<0||r.percent!==null&&(!Number.isFinite(r.percent)||r.percent<0||r.percent>100)||!Array.isArray(r.rows)||r.receipt&&!['configuring','configured','starting','running','unconfirmed','stopping','complete','stopped'].includes(r.receipt.stage))throw {kind:'protocol',message:'测速状态与当前路由器不匹配。',retryable:false};
  if(!this.report||r.receipt&&!['complete','stopped'].includes(r.receipt.stage)){this.selected=[...(r.receipt&&!['complete','stopped'].includes(r.receipt.stage)?r.receipt.selected:r.selected)];}
  this.report=r;
 }
 private poll():void{if(this.timer)clearTimeout(this.timer);this.timer=undefined;if(this.active&&!this.loading&&!this.pending){const epoch=this.epoch;this.timer=setTimeout(()=>{this.timer=undefined;if(epoch===this.epoch)void this.read();},this.stage==='unconfirmed'?15000:4000);}}
 async read():Promise<void>{if(!this.context||this.loading||this.pending)return;const c={...this.context},epoch=this.epoch;this.loading=true;this.changed();try{const r=await this.api.read(c);if(epoch!==this.epoch)return;this.accept(r,c);this.error=undefined;}catch(e){if(epoch===this.epoch){this.error=normalizeError(e);this.failed(this.error);}}finally{if(epoch===this.epoch){this.loading=false;this.changed();this.poll();}}}
 toggle(kind:SceneKind):void{if(this.blocked||this.stage==='configured')return;this.selected=this.selected.includes(kind)?this.selected.filter(k=>k!==kind):[...this.selected,kind];this.changed();}
 show(tab:'manual'|'history'):void{this.tab=tab;this.dismiss();if(tab==='history')void this.loadHistory();this.changed();}
 selectHistory(kind:SceneKind,days:number,page=1):void{this.kind=kind;this.days=days;this.page=page;void this.loadHistory();}
 async loadHistory():Promise<void>{if(!this.context)return;const c={...this.context},epoch=this.epoch,n=++this.historyEpoch,{kind,days,page}=this;this.history=undefined;this.historyError=undefined;this.historyLoading=true;this.changed();try{const r=await this.api.history(c,kind,days,page);if(epoch!==this.epoch||n!==this.historyEpoch)return;if(r.did!==c.did||r.kind!==kind||r.days!==days||r.page!==page||!Array.isArray(r.rows)||!Number.isInteger(r.totalPages)||r.totalPages<0)throw{kind:'protocol',message:'测速记录格式无效。',retryable:false};this.history=r;}catch(e){if(epoch===this.epoch&&n===this.historyEpoch){this.historyError=normalizeError(e);this.failed(this.historyError);}}finally{if(epoch===this.epoch&&n===this.historyEpoch){this.historyLoading=false;this.changed();}}}
 async openDetail(row:SceneRow):Promise<void>{if(!this.context||!row.id)return;const c={...this.context},epoch=this.epoch,n=++this.detailEpoch;this.detail=undefined;this.detailError=undefined;this.modal='detail';this.detailLoading=true;this.changed();try{const r=await this.api.detail(c,row.kind,row.id);if(epoch!==this.epoch||n!==this.detailEpoch)return;if(r.kind!==row.kind)throw{kind:'protocol',message:'测速详情格式无效。',retryable:false};this.detail={...r,name:row.name,time:row.time};}catch(e){if(epoch===this.epoch&&n===this.detailEpoch){this.detailError=normalizeError(e);this.failed(this.detailError);}}finally{if(epoch===this.epoch&&n===this.detailEpoch){this.detailLoading=false;this.changed();}}}
 request(kind:'start'|'stop'):void{if(this.pending||!this.report||this.report.reason)return;if(kind==='start'&&(this.blocked||!this.selected.length))return;if(kind==='stop'&&(!this.active&&this.stage!=='configured'||this.stage==='stopping'))return;this.modal=kind;this.changed();}
 dismiss():void{++this.detailEpoch;this.detailLoading=false;this.modal=null;this.changed();}
 async confirm():Promise<void>{if(!this.context||this.pending||!this.report||!['start','stop'].includes(this.modal??''))return;const op=this.modal,c={...this.context},epoch=this.epoch;this.modal=null;this.pending=true;this.error=undefined;this.changed();try{
  if(op==='start'){
   if(this.stage==='configured'&&this.report.receipt){this.change={requestId:this.report.receipt.requestId,baseline:this.report.receipt.baseline,selected:[...this.report.receipt.selected]};}
   else this.change={requestId:crypto.randomUUID(),baseline:this.report.revision,selected:[...this.selected]};
  }
  const r=op==='start'?await this.api.start(c,this.change!):await this.api.stop(c);if(epoch!==this.epoch)return;this.accept(r,c);
 }catch(e){if(epoch===this.epoch){this.error=normalizeError(e);this.failed(this.error);}}finally{if(epoch===this.epoch){this.pending=false;this.changed();void this.read();}}}
}
