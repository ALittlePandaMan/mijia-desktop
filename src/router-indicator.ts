import type {AppError,DeviceContext,RouterIndicatorChange,RouterIndicatorRead,RouterIndicatorReport,RouterIndicatorResult,RouterIndicatorValues} from './types';
import {normalizeError,sameContext} from './logic';
import {routerModel} from './router';
interface Transport {read:(c:DeviceContext)=>Promise<RouterIndicatorRead>;save:(c:DeviceContext,u:RouterIndicatorChange)=>Promise<RouterIndicatorResult>;confirm:(c:DeviceContext,u:RouterIndicatorChange)=>Promise<RouterIndicatorResult>}
export function routerIndicatorProblem(value:RouterIndicatorValues):string|undefined {
 const time=(s:string)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
 if(value.openTime&&!time(value.openTime)||value.closeTime&&!time(value.closeTime)||value.timerOn&&(!time(value.openTime)||!time(value.closeTime)||value.openTime===value.closeTime))return'请设置有效且不同的开启、关闭时间。';
}
export class RouterIndicatorState {
 report?:RouterIndicatorReport;draft?:RouterIndicatorValues;error?:AppError;message='';loading=false;pending=false;blocked=false;confirmOff=false;
 picker?:{field:'openTime'|'closeTime';hour:number;minute:number};
 private epoch=0;private scope='';private context?:DeviceContext;private unresolved?:RouterIndicatorChange;private timer?:ReturnType<typeof setTimeout>;
 constructor(private api:Transport,private changed:()=>void,private failed:(error:AppError)=>void){}
 bind(c:DeviceContext,scope:string):void{if(!sameContext(c,this.context)||scope!==this.scope){this.close();this.context={...c};this.scope=scope;}}
 close():void{++this.epoch;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.context=undefined;this.report=undefined;this.draft=undefined;this.error=undefined;this.message='';this.pending=false;this.blocked=false;this.loading=false;this.unresolved=undefined;this.picker=undefined;this.confirmOff=false;}
 get canEdit():boolean{return !!this.report&&!!this.draft&&!this.pending&&!this.blocked&&!this.loading;}
 get dirty():boolean{return !!this.report&&!!this.draft&&JSON.stringify(this.report.values)!==JSON.stringify(this.draft);}
 edit(change:Partial<RouterIndicatorValues>):void{if(!this.canEdit||!this.draft)return;this.draft={...this.draft,...change};if(change.timerOn===true){this.draft.openTime='08:00';this.draft.closeTime='00:00';}this.changed();}
 private valid(report:RouterIndicatorReport,c:DeviceContext):void{if(report.did!==c.did||report.model!==routerModel||!/^[a-f0-9]{64}$/.test(report.revision))throw{kind:'protocol',message:'指示灯设置与当前设备不匹配。',retryable:false};}
 async read(c:DeviceContext):Promise<void>{
  if(this.loading||this.pending||!sameContext(c,this.context))return;
  const epoch=this.epoch,current=()=>epoch===this.epoch&&sameContext(c,this.context);this.loading=true;this.changed();
  try{const result=await this.api.read({...c});if(!current())return;this.valid(result.report,c);this.report=result.report;this.error=undefined;this.unresolved=result.pending??undefined;this.blocked=!!result.pending;this.draft={...(result.pending?.values??result.report.values)};this.message=result.pending?'上次设置尚未确认，正在查询实际状态。':'';}
  catch(e){if(current()){this.error=normalizeError(e);this.failed(this.error);}}
  finally{if(current()){this.loading=false;this.changed();if(this.unresolved)this.schedule(c);}}
 }
 async save(c:DeviceContext,confirmedOff=false):Promise<boolean>{
  if(!this.canEdit||!this.report||!this.draft||!sameContext(c,this.context))return false;
  if(!this.dirty)return true;
  const problem=routerIndicatorProblem(this.draft);if(problem){this.message=problem;this.changed();return false;}
  if(!this.draft.on&&this.report.values.on&&!confirmedOff){this.confirmOff=true;this.changed();return false;}
  const change={baseline:this.report.revision,values:{...this.draft}};this.confirmOff=false;this.unresolved=change;return this.submit(c,change,false);
 }
 private async submit(c:DeviceContext,change:RouterIndicatorChange,readOnly:boolean):Promise<boolean>{
  const epoch=this.epoch,current=()=>epoch===this.epoch&&sameContext(c,this.context);this.pending=true;this.blocked=true;this.changed();
  try{
   const result=await(readOnly?this.api.confirm({...c},change):this.api.save({...c},change));if(!current())return false;
   if(result.report){this.valid(result.report,c);this.report=result.report;}
   this.message=result.message;this.error=undefined;
   if(result.status==='confirmed'&&result.report&&JSON.stringify(result.report.values)===JSON.stringify(change.values)){this.draft={...result.report.values};this.unresolved=undefined;this.blocked=false;return true;}
  }catch(e){if(!current())return false;this.error=normalizeError(e);this.failed(this.error);if(!['network','protocol','busy','staleContext'].includes(this.error.kind)){this.unresolved=undefined;this.blocked=this.error.kind==='conflict';}this.message=this.error.message;}
  finally{if(current()){this.pending=false;this.changed();if(this.unresolved)this.schedule(c);}}
  return false;
 }
 private schedule(c:DeviceContext):void{if(this.timer)clearTimeout(this.timer);const epoch=this.epoch;this.timer=setTimeout(()=>{this.timer=undefined;if(epoch===this.epoch&&sameContext(c,this.context)&&this.unresolved&&!this.pending)void this.submit(c,this.unresolved,true);},2000);}
}
