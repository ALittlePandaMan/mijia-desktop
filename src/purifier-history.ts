import type {AppError,DeviceContext} from './types';
import {dateKey} from './history';
import {normalizeError} from './logic';
import {DeviceOpening} from './device-opening';
export interface WaterRecord{id:string;time:number;seconds:number;volumeMl:number;tds:number[]}
export interface WaterRecordPage{did:string;fetchedAt:number;start:number;end:number;nextBefore:number|null;records:WaterRecord[];ignoredZero:number;rejected:number;warnings:string[]}
export interface WaterSelection{period:'week'|'month'|'year';date:string}
export type WaterQuery={scope:'latest';before:number|null}|{scope:'day'|'month';date:string;before:number|null};
export interface WaterStatistics{did:string;fetchedAt:number;selection:WaterSelection;start:number;end:number;points:{time:number;label:string;volumeMl:number|null}[];totalMl:number|null;weekTotalMl?:number|null;warnings:string[]}
export interface WaterTransport{records:(context:DeviceContext,query:WaterQuery)=>Promise<WaterRecordPage>;statistics:(context:DeviceContext,selection:WaterSelection)=>Promise<WaterStatistics>}
export function waterQuantity(ml:number|null|undefined):{value:string;unit:string}{return ml==null?{value:'--',unit:'L'}:ml>999900?{value:(ml/1e6).toFixed(2),unit:'m³'}:{value:(ml/1000).toFixed(2),unit:'L'};}
export function waterDuration(seconds:number):string{const d=Math.floor(seconds/86400),h=Math.floor(seconds%86400/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return `${d?`${d}天`:''}${d||h?`${h}时`:''}${d||h||m?`${m}分`:''}${s}秒`;}
const contextKey=(c:DeviceContext)=>JSON.stringify([c.homeId,c.generation,c.did]);
const sameSelection=(a:WaterSelection,b:WaterSelection)=>a.period===b.period&&a.date===b.date;
const queryKey=(q:WaterQuery)=>[q.scope,'date'in q?q.date:null];
export class PurifierHistory {
 records:WaterRecordPage|undefined;statistics:WaterStatistics|undefined;recordError:AppError|undefined;statisticsError:AppError|undefined;
 recordsLoading=false;statisticsLoading=false;selectedRecord='';selectedTime:number|undefined;visibleRecords=60;
 recordOpening=new DeviceOpening(()=>this.changed());statisticsOpening=new DeviceOpening(()=>this.changed());
 selection:WaterSelection={period:'week',date:dateKey(new Date())};query:WaterQuery={scope:'latest',before:null};
 private context='';private scope='';private recordVersion=0;private statsVersion=0;
 private recordCache=new Map<string,WaterRecordPage>();private statsCache=new Map<string,WaterStatistics>();
 constructor(private transport:WaterTransport,private changed:()=>void,private failed:(e:AppError)=>void){}
 bind(context:DeviceContext,scope:string):void{const key=contextKey(context);if(this.context!==key||this.scope!==scope){this.close();this.context=key;this.scope=scope;this.records=undefined;this.statistics=undefined;this.recordError=undefined;this.statisticsError=undefined;this.selectedRecord='';this.selectedTime=undefined;this.visibleRecords=60;}}
 close():void{this.recordVersion++;this.statsVersion++;this.recordsLoading=false;this.statisticsLoading=false;this.recordOpening.cancel();this.statisticsOpening.cancel();}
 private cacheKey(kind:string,value:unknown):string{return JSON.stringify([this.scope,this.context,kind,value]);}
 private trim<T>(cache:Map<string,T>):void{if(cache.size>16)cache.delete(cache.keys().next().value!);}
 async loadRecords(context:DeviceContext,query:WaterQuery={scope:'latest',before:null},force=false):Promise<void>{
  if(contextKey(context)!==this.context)return;
  const base={...query,before:null},same=JSON.stringify(queryKey(base))===JSON.stringify(queryKey(this.query)),more=query.before!==null;
  if(this.recordsLoading&&same)return;
  const version=++this.recordVersion,id=this.context,key=this.cacheKey('records',queryKey(base));this.query={...query};this.recordError=undefined;
  if(!same){this.records=undefined;this.selectedRecord='';this.visibleRecords=60;}
  const cached=this.recordCache.get(key);if(!more&&!force&&cached&&Date.now()/1000-cached.fetchedAt<180){this.records=cached;this.selectedRecord=cached.records[0]?.id??'';this.recordsLoading=false;this.recordOpening.cancel();this.changed();return;}
  this.recordsLoading=true;if(!this.records)this.recordOpening.begin();this.changed();
  try{const page=await this.transport.records(context,query);if(version!==this.recordVersion||id!==this.context)return;if(page.did!==context.did)throw Error('制水记录返回的设备不匹配。');
   if(more&&page.nextBefore!==null&&page.nextBefore>=query.before!)throw Error('制水记录分页未能继续，请重新读取。');
   const previous=more?this.records:undefined,rows=new Map([...(previous?.records??[]),...page.records].map(row=>[row.id,row]));
   this.records={...page,end:previous?.end??page.end,records:[...rows.values()].sort((a,b)=>b.time-a.time||a.id.localeCompare(b.id)),warnings:[...new Set([...(previous?.warnings??[]),...page.warnings])]};
   if(!this.records.records.some(r=>r.id===this.selectedRecord))this.selectedRecord=this.records.records[0]?.id??'';
   this.recordCache.set(key,this.records);this.trim(this.recordCache);
  }catch(e){if(version===this.recordVersion&&id===this.context){this.recordError=normalizeError(e);this.failed(this.recordError);}}
  finally{if(version===this.recordVersion&&id===this.context){this.recordsLoading=false;this.recordOpening.ready();this.changed();}}
 }
 async loadStatistics(context:DeviceContext,selection:WaterSelection,force=false):Promise<void>{
  if(contextKey(context)!==this.context)return;const same=sameSelection(this.selection,selection);if(this.statisticsLoading&&same)return;
  const version=++this.statsVersion,id=this.context,key=this.cacheKey('statistics',[selection.period,selection.date]);this.selection={...selection};this.statisticsError=undefined;if(!same){this.statistics=undefined;this.selectedTime=undefined;this.recordVersion++;this.recordsLoading=false;this.recordOpening.cancel();this.records=undefined;this.recordError=undefined;this.selectedRecord='';this.visibleRecords=60;}
  const cached=this.statsCache.get(key);if(!force&&cached&&Date.now()/1000-cached.fetchedAt<180){this.statistics=cached;this.statisticsLoading=false;this.statisticsOpening.cancel();this.defaultBucket();this.changed();return;}
  this.statisticsLoading=true;if(!this.statistics)this.statisticsOpening.begin();this.changed();
  try{const report=await this.transport.statistics(context,selection);if(version!==this.statsVersion||id!==this.context)return;if(report.did!==context.did||!sameSelection(report.selection,selection))throw Error('用水统计与当前设备或日期不匹配。');this.statistics=report;this.statsCache.set(key,report);this.trim(this.statsCache);this.defaultBucket();}
  catch(e){if(version===this.statsVersion&&id===this.context){this.statisticsError=normalizeError(e);this.failed(this.statisticsError);}}
  finally{if(version===this.statsVersion&&id===this.context){this.statisticsLoading=false;this.statisticsOpening.ready();this.changed();}}
 }
 private defaultBucket():void{if(this.selectedTime!==undefined)return;const selected=this.selection.date;this.selectedTime=this.statistics?.points.find(p=>this.selection.period==='year'?dateKey(new Date(p.time*1000)).slice(0,7)===selected.slice(0,7):dateKey(new Date(p.time*1000))===selected)?.time;}
 chooseRecord(id:string):void{if(this.records?.records.some(r=>r.id===id)){this.selectedRecord=id;this.changed();}}
 showMore(context:DeviceContext):void{if(this.recordsLoading)return;if(this.visibleRecords<(this.records?.records.length??0)){this.visibleRecords+=60;this.changed();}else if(this.records?.nextBefore!==null&&this.records?.nextBefore!==undefined)void this.loadRecords(context,{...this.query,before:this.records.nextBefore});}
 chooseBucket(context:DeviceContext,time:number):void{if(!this.statistics?.points.some(p=>p.time===time)||time>Date.now()/1000||time<new Date(2023,0,1).getTime()/1000)return;this.selectedTime=time;this.changed();void this.loadRecords(context,{scope:this.selection.period==='year'?'month':'day',date:dateKey(new Date(time*1000)),before:null});}
}
