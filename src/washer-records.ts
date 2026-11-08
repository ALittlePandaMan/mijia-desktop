import type { AppError, DeviceContext, EnergySelection } from './types';
import { dateKey, parseDateKey, selectableDate } from './history';
import { normalizeError } from './logic';

export interface WasherLogRange {startTime:number;endTime:number;aggregation:'day'|'month'}
export interface WasherLogEntry {id:string;mode:number;startTime:number;endTime:number}
export interface WasherLogBucket {startTime:number;endTime:number;value:number}
export interface WasherRecordReport {did:string;range:WasherLogRange;fetchedAt:number;buckets:WasherLogBucket[];frequentModes:number[];logs:WasherLogEntry[];nextId:string|null}
export interface WasherRecordDetail {did:string;entry:WasherLogEntry;parameters:Record<string,number|boolean>}
export interface WasherRecordRow {entry:WasherLogEntry;cursor:string|null}
export interface WasherLogSlot {startTime:number;endTime:number;value:number|null}
export function washerRecordTime(entry:WasherLogEntry):string {
 const start=new Date(entry.startTime),end=new Date(entry.endTime),minutes=(d:Date)=>String(d.getMinutes()).padStart(2,'0');
 return `${start.getFullYear()}.${start.getMonth()+1}.${start.getDate()} ${start.getHours()}:${minutes(start)}-${end.getHours()}:${minutes(end)}`;
}
export interface WasherRecordTransport {
 records:(context:DeviceContext,range:WasherLogRange,cursor:string|null)=>Promise<WasherRecordReport>;
 detail:(context:DeviceContext,range:WasherLogRange,cursor:string|null,recordId:string)=>Promise<WasherRecordDetail>;
}
/** Same standard PageCharts week/monthByDay/yearByMonth calendar contract as
 * the verified outlet page: 7 days, current 30 days, rolling 12 months. */
export function washerLogRange(selection:EnergySelection,now=new Date()):WasherLogRange {
 const at=parseDateKey(selection.date);if(!selectableDate(at,selection.period==='month'?'month':'day',now)||selection.period==='year'&&dateKey(at)!==dateKey(now))throw Error('请选择有效的记录日期。');
 const today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),month=new Date(at.getFullYear(),at.getMonth(),1),last=new Date(at.getFullYear(),at.getMonth()+1,0);
 let first:Date,end:Date;
 if(selection.period==='week'){first=new Date(at.getFullYear(),at.getMonth(),at.getDate()-6);end=at;}
 else if(selection.period==='month'){
  if(month.getTime()===new Date(today.getFullYear(),today.getMonth(),1).getTime()&&today.getDate()!==last.getDate()){first=new Date(today.getFullYear(),today.getMonth(),today.getDate()-29);end=today;}
  else{first=month;end=last;}
 }else{first=new Date(today.getFullYear(),today.getMonth()-11,1);end=today;}
 return{startTime:first.getTime(),endTime:new Date(end.getFullYear(),end.getMonth(),end.getDate(),23,59,59).getTime(),aggregation:selection.period==='year'?'month':'day'};
}
const sameRange=(a:WasherLogRange,b:WasherLogRange)=>a.startTime===b.startTime&&a.endTime===b.endTime&&a.aggregation===b.aggregation;
const contextKey=(c:DeviceContext)=>JSON.stringify([c.homeId,c.generation,c.did]);
/** Preserve empty dates/months; a missing cloud bucket is not a measured zero. */
export function washerLogSlots(report:WasherRecordReport):WasherLogSlot[]{
 const monthly=report.range.aggregation==='month',slots:WasherLogSlot[]=[],first=new Date(report.range.startTime);
 const key=(time:number)=>{const d=new Date(time);return monthly?`${d.getFullYear()}-${d.getMonth()}`:dateKey(d);};
 for(let d=new Date(first);d.getTime()<=report.range.endTime&&slots.length<367;){
  const next=monthly?new Date(d.getFullYear(),d.getMonth()+1,1):new Date(d.getFullYear(),d.getMonth(),d.getDate()+1);
  slots.push({startTime:d.getTime(),endTime:Math.min(next.getTime()-1000,report.range.endTime),value:null});d=next;
 }
 const byDate=new Map(slots.map(slot=>[key(slot.endTime),slot]));
 for(const bucket of report.buckets){const slot=byDate.get(key(bucket.endTime));if(slot)slot.value=bucket.value;}
 return slots;
}

/** Response ownership and local navigation are independent of device writes. */
export class WasherRecords {
 selection:EnergySelection={period:'week',date:dateKey(new Date())};
 report:WasherRecordReport|undefined;chartReport:WasherRecordReport|undefined;selectedBucket:number|undefined;rows:WasherRecordRow[]=[];loading=false;error:AppError|undefined;
 selected:WasherRecordRow|undefined;detail:WasherRecordDetail|undefined;detailLoading=false;detailError:AppError|undefined;
 picker:import('./ui/history-detail').HistoryDetailView['picker']=undefined;
 private version=0;private detailVersion=0;private context='';private focus:WasherLogRange|undefined;
 constructor(private transport:WasherRecordTransport,private changed:()=>void,private failure:(error:AppError)=>void){}
 reset():void {this.version++;this.detailVersion++;this.context='';this.report=undefined;this.chartReport=undefined;this.selectedBucket=undefined;this.focus=undefined;this.rows=[];this.loading=false;this.error=undefined;this.closeDetail(false);this.picker=undefined;this.selection={period:'week',date:dateKey(new Date())};}
 async load(context:DeviceContext,selection=this.selection,append=false,focus?:WasherLogRange):Promise<void>{
  if(append&&(this.loading||!this.report?.nextId||this.rows.length>=1000))return;
  let range:WasherLogRange;
  try{range=append?this.report!.range:focus??washerLogRange(selection);}catch(error){this.version++;this.loading=false;this.error=normalizeError(error);this.failure(this.error);this.changed();return;}
  const key=contextKey(context),cursor=append?this.report!.nextId:null;
  if(append&&(key!==this.context||selection.period!==this.selection.period||selection.date!==this.selection.date))return;
  if(!append){this.focus=focus;if(!focus){this.chartReport=undefined;this.selectedBucket=undefined;}}
  const version=++this.version;this.context=key;this.selection={...selection};this.picker=undefined;this.closeDetail(false);this.error=undefined;this.loading=true;
  if(!append){this.report=undefined;this.rows=[];}this.changed();
  try{
   const report=await this.transport.records(context,range,cursor);if(version!==this.version||key!==this.context)return;
   if(report.did!==context.did||!sameRange(report.range,range)||report.nextId!==null&&report.nextId===cursor)throw Error('洗衣记录与当前设备或日期不匹配。');
   const known=new Set(this.rows.map(row=>row.entry.id));for(const entry of report.logs)if(!known.has(entry.id)){this.rows.push({entry,cursor});known.add(entry.id);}
   this.report=report;
   if(!this.focus&&!append)this.chartReport=report;
  }catch(error){if(version===this.version&&key===this.context){this.error=normalizeError(error);this.failure(this.error);}}
  finally{if(version===this.version&&key===this.context){this.loading=false;this.changed();}}
 }
 async retry(context:DeviceContext):Promise<void>{return this.load(context,this.selection,false,this.focus);}
 async selectBucket(context:DeviceContext,index:number):Promise<void>{
  if(contextKey(context)!==this.context||!this.chartReport)return;
  if(this.selectedBucket===index){this.selectedBucket=undefined;return this.load(context);}
  const slot=washerLogSlots(this.chartReport)[index];if(!slot)return;
  this.selectedBucket=index;return this.load(context,this.selection,false,{startTime:slot.startTime,endTime:slot.endTime,aggregation:this.chartReport.range.aggregation});
 }
 closeDetail(notify=true):void {this.detailVersion++;this.selected=undefined;this.detail=undefined;this.detailLoading=false;this.detailError=undefined;if(notify)this.changed();}
 async openDetail(context:DeviceContext,row:WasherRecordRow):Promise<void>{
  const key=contextKey(context);if(key!==this.context||!this.report||!this.rows.includes(row))return;
  const version=++this.detailVersion,range={...this.report.range};this.selected=row;this.detail=undefined;this.detailError=undefined;this.detailLoading=true;this.changed();
  try{
   const detail=await this.transport.detail(context,range,row.cursor,row.entry.id);if(version!==this.detailVersion||key!==this.context)return;
   if(detail.did!==context.did||detail.entry.id!==row.entry.id||detail.entry.mode!==row.entry.mode)throw Error('洗衣记录详情与当前记录不匹配。');this.detail=detail;
  }catch(error){if(version===this.detailVersion&&key===this.context){this.detailError=normalizeError(error);this.failure(this.detailError);}}
  finally{if(version===this.detailVersion&&key===this.context){this.detailLoading=false;this.changed();}}
 }
}
