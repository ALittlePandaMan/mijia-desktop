import type {AppError,DeviceContext} from './types';
import {normalizeError,sameContext} from './logic';
export const scaleModel='yunmai.scales.ms103';
export const isScale=(model:string):boolean=>model===scaleModel;
export const oldestScaleTime=1640966400000;
export interface ScaleMember{accountId:string;name:string;icon:string;master:boolean;canEdit:boolean;sex:number|null;birth:number|null;height:number|null;revision:string}
export interface ScaleRecord{key:string;time:number;timeMs:number;weight:number;bodyFat:number|null;bmi:number|null;muscle:number|null;heartRate:number|null;metrics:Record<string,number>}
export interface ScaleReport{did:string;model:string;members:ScaleMember[];accountId:string|null;records:ScaleRecord[];fetchedAt:number;nextBefore:number|null;omittedRecords:number;canWrite:boolean}
export interface ScaleQuery{accountId:string|null;before?:number|null;start?:number|null;end?:number|null;summary?:boolean;unclaimed?:boolean}
export interface ScaleDraft{name:string;sex:number;birth:number;height:number;icon:number}
export interface ScaleRecordRef{key:string;timeMs:number}
export type ScaleChange={kind:'saveMember';accountId:string|null;baseline:string|null;draft:ScaleDraft}|{kind:'removeMember';accountId:string;baseline:string}|{kind:'claim'|'deleteUnclaimed'|'deleteRecords';accountId:string;records:ScaleRecordRef[]};
export interface ScaleChanged{confirmed:boolean;message:string;completed:number}
export type ScaleView='home'|'history'|'records'|'unclaimed'|'members'|'report';
export type ScaleMetric='weight'|'bodyFat'|'muscle'|'bmi';
interface ScaleSource{history:(c:DeviceContext,q:ScaleQuery)=>Promise<ScaleReport>;change:(c:DeviceContext,change:ScaleChange)=>Promise<ScaleChanged>}
export function scaleRange(days:number):{start:number;end:number}{const end=new Date();end.setHours(23,59,59,999);const start=new Date(end);start.setDate(start.getDate()-days+1);start.setHours(0,0,0,0);return{start:Math.max(oldestScaleTime,start.getTime()),end:end.getTime()};}
/** Bounded in-memory views. Device/account changes invalidate every late result. */
export class ScaleState{
 report?:ScaleReport;history?:ScaleReport;unclaimed?:ScaleReport;members:ScaleMember[]=[];accountId:string|null=null;
 view:ScaleView='home';metric:ScaleMetric='weight';selected?:ScaleRecord;homeIndex=0;
 range=scaleRange(7);rangeDays=7;error?:AppError;pageError?:AppError;message='';loading=false;pageLoading?:'history'|'unclaimed';writing=false;
 private context?:DeviceContext;private scope='';private epoch=0;private readEpoch=0;private pageEpoch=0;private homeFlight='';
 constructor(private source:ScaleSource,private changed:()=>void,private failed:(e:AppError)=>void){}
 bind(c:DeviceContext,scope:string):void{if(!sameContext(c,this.context)||scope!==this.scope){this.close();this.context={...c};this.scope=scope;}}
 close():void{++this.epoch;++this.readEpoch;++this.pageEpoch;this.context=undefined;this.report=this.history=this.unclaimed=undefined;this.members=[];this.accountId=null;this.view='home';this.selected=undefined;this.homeIndex=0;this.error=this.pageError=undefined;this.message='';this.loading=this.writing=false;this.pageLoading=undefined;this.homeFlight='';this.range=scaleRange(7);this.rangeDays=7;this.metric='weight';}
 private accept(r:ScaleReport,c:DeviceContext,account:string|null):void{if(r.did!==c.did||r.model!==scaleModel||account!==null&&r.accountId!==account||r.records.length>20||r.members.length>32||r.accountId!==null&&!r.members.some(m=>m.accountId===r.accountId)||r.records.some(v=>!Number.isFinite(v.timeMs)||!Number.isFinite(v.weight)||v.weight<=0||v.key.length!==64))throw Error('称重数据与当前设备或成员不匹配。');}
 async read(accountId=this.accountId):Promise<void>{
  if(!this.context||accountId!==null&&this.members.length>0&&!this.members.some(m=>m.accountId===accountId))return;
  const key=JSON.stringify([this.context,accountId]);if(this.homeFlight===key)return;
  const switched=accountId!==this.accountId;if(switched){this.report=this.history=this.unclaimed=undefined;this.selected=undefined;this.homeIndex=0;++this.pageEpoch;this.pageLoading=undefined;}
  const c={...this.context},epoch=this.epoch,read=++this.readEpoch,current=()=>epoch===this.epoch&&read===this.readEpoch&&sameContext(c,this.context);
  this.homeFlight=key;this.accountId=accountId;this.loading=true;this.error=undefined;this.changed();
  try{const r=await this.source.history(c,{accountId,summary:true});if(!current())return;this.accept(r,c,accountId);this.report=r;this.members=r.members;this.accountId=r.accountId;this.homeIndex=Math.min(this.homeIndex,Math.max(0,r.records.length-1));}
  catch(e){if(current()){this.error=normalizeError(e);this.failed(this.error);}}
  finally{if(current()){this.loading=false;this.homeFlight='';this.changed();}}
 }
 async select(account:string):Promise<void>{if(this.writing||account===this.accountId)return;const view=this.view;await this.read(account);if(this.accountId!==account)return;if(view==='report')this.view='home';if(view==='history'||view==='records')await this.loadHistory(false,true);else if(view==='unclaimed')await this.loadUnclaimed(false,true);this.changed();}
 navigate(view:ScaleView,record?:ScaleRecord):void{if(this.view!==view){++this.pageEpoch;this.pageLoading=undefined;this.pageError=undefined;}this.view=view;if(record)this.selected=record;this.changed();if(view==='history'||view==='records')void this.loadHistory();if(view==='unclaimed')void this.loadUnclaimed();}
 chooseHome(index:number):void{if(!this.report?.records[index])return;this.homeIndex=index;this.changed();}
 async setRange(start:number,end:number,days=0):Promise<void>{if(start<oldestScaleTime||start>end||end>Date.now()+86400000)return;this.range={start,end};this.rangeDays=days;this.history=undefined;++this.pageEpoch;this.pageLoading=undefined;this.changed();await this.loadHistory(false,true);}
 async preset(days:number):Promise<void>{const r=scaleRange(days);await this.setRange(r.start,r.end,days);}
 loadHistory(more=false,force=false):Promise<void>{return this.page('history',more,force);}
 loadUnclaimed(more=false,force=false):Promise<void>{return this.page('unclaimed',more,force);}
 private async page(kind:'history'|'unclaimed',more:boolean,force:boolean):Promise<void>{
  if(!this.context||!this.accountId||this.pageLoading===kind)return;const previous=this[kind];if(!force&&!more&&previous)return;if(more&&(!previous?.nextBefore||previous.records.length>=200))return;
  const c={...this.context},account=this.accountId,epoch=this.epoch,page=++this.pageEpoch,current=()=>epoch===this.epoch&&page===this.pageEpoch&&sameContext(c,this.context)&&this.accountId===account;
  this.pageLoading=kind;this.pageError=undefined;this.changed();
  try{const r=await this.source.history(c,{accountId:account,before:more?previous!.nextBefore:null,start:kind==='history'?this.range.start:null,end:kind==='history'?this.range.end:null,unclaimed:kind==='unclaimed'});if(!current())return;this.accept(r,c,account);const seen=new Set<string>(),records=(more&&previous?[...previous.records,...r.records]:r.records).filter(v=>!seen.has(v.key)&&!!seen.add(v.key));this[kind]={...r,records:records.slice(0,200),omittedRecords:r.omittedRecords+(more?previous?.omittedRecords??0:0)};this.members=r.members;}
  catch(e){if(current()){this.pageError=normalizeError(e);this.failed(this.pageError);}}
  finally{if(current()){this.pageLoading=undefined;this.changed();}}
 }
 async refresh():Promise<void>{if(this.writing)return;this.message='';if(this.view==='unclaimed')await this.loadUnclaimed(false,true);else if(this.view==='history'||this.view==='records')await this.loadHistory(false,true);else await this.read();}
 async mutate(change:ScaleChange):Promise<boolean>{
  if(!this.context||this.writing||!this.report?.canWrite)return false;const c={...this.context},epoch=this.epoch,current=()=>epoch===this.epoch&&sameContext(c,this.context);this.writing=true;this.message='';this.changed();let confirmed=false;
  try{const r=await this.source.change(c,change);if(!current())return false;confirmed=r.confirmed;this.message=r.message;
   if(current()){const selected=change.kind==='removeMember'&&change.accountId===this.accountId?null:this.accountId;this.history=this.unclaimed=undefined;await this.read(selected);if(!current())return false;if(this.view==='unclaimed')await this.loadUnclaimed(false,true);else if(this.view==='history'||this.view==='records')await this.loadHistory(false,true);}}
  catch(e){if(current()){const error=normalizeError(e);this.message=error.message;this.failed(error);}}
  finally{if(current()){this.writing=false;this.changed();}}
  return confirmed;
 }
}
