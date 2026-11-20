import type {AppError,DeviceContext} from './types';
import {dateKey} from './history';import {normalizeError} from './logic';import {DeviceOpening} from './device-opening';
export type DrinkSelection={period:'week'|'month'|'year';date:string};
export interface DrinkRecord{id:string;time:number;seconds:number;volumeMl:number;temperature:number}
export interface DrinkRecords{did:string;fetchedAt:number;start:number;end:number;nextBefore:number|null;records:DrinkRecord[];ignoredZero:number;rejected:number;warnings:string[]}
export interface DrinkStatistics{did:string;fetchedAt:number;selection:DrinkSelection;start:number;end:number;points:{time:number;label:string;volumeMl:number|null}[];totalMl:number|null;warnings:string[]}
interface Transport{records:(context:DeviceContext,before:number|null)=>Promise<DrinkRecords>;statistics:(context:DeviceContext,selection:DrinkSelection)=>Promise<DrinkStatistics>}
const key=(c:DeviceContext)=>JSON.stringify([c.homeId,c.generation,c.did]);const selectionKey=(s:DrinkSelection)=>JSON.stringify([s.period,s.date]);
export function drinkMinimum(now=new Date()):string{const year=now.getFullYear()-1,month=now.getMonth();return dateKey(new Date(year,month,Math.min(now.getDate(),new Date(year,month+1,0).getDate())));}
export class DispenserHistory{
 records:DrinkRecords|undefined;statistics:DrinkStatistics|undefined;recordError:AppError|undefined;statisticsError:AppError|undefined;recordsLoading=false;statisticsLoading=false;visible=20;selectedTime:number|undefined;
 selection:DrinkSelection={period:'week',date:dateKey(new Date())};recordOpening=new DeviceOpening(()=>this.changed());statisticsOpening=new DeviceOpening(()=>this.changed());
 private context='';private account='';private recordVersion=0;private statisticsVersion=0;private recordCache=new Map<string,DrinkRecords>();private statsCache=new Map<string,DrinkStatistics>();
 constructor(private transport:Transport,private changed:()=>void,private failed:(e:AppError)=>void){}
 bind(context:DeviceContext,account:string):void{const k=key(context);if(k!==this.context||account!==this.account){this.close();this.context=k;this.account=account;this.records=undefined;this.statistics=undefined;this.recordError=undefined;this.statisticsError=undefined;this.visible=20;this.selectedTime=undefined;this.selection={period:'week',date:dateKey(new Date())};}}
 close():void{this.recordVersion++;this.statisticsVersion++;this.recordsLoading=false;this.statisticsLoading=false;this.recordOpening.cancel();this.statisticsOpening.cancel();}
 private cache(kind:string,selection=''):string{return JSON.stringify([this.account,this.context,kind,selection]);}
 private trim<T>(cache:Map<string,T>):void{if(cache.size>16)cache.delete(cache.keys().next().value!);}
 async loadRecords(context:DeviceContext,before:number|null=null,force=false):Promise<void>{
  if(key(context)!==this.context||this.recordsLoading)return;const version=++this.recordVersion,identity=this.context,cache=this.cache('records');this.recordError=undefined;
  const cached=this.recordCache.get(cache);if(before===null&&!force&&cached&&Date.now()/1000-cached.fetchedAt<180){this.records=cached;this.recordOpening.cancel();this.changed();return;}
  this.recordsLoading=true;if(!this.records)this.recordOpening.begin();this.changed();
  try{const page=await this.transport.records(context,before);if(version!==this.recordVersion||identity!==this.context)return;if(page.did!==context.did||before!==null&&page.nextBefore!==null&&page.nextBefore>=before)throw Error('取水记录身份或分页游标不匹配，请重新读取。');
   const previous=before!==null?this.records:undefined,rows=new Map([...(previous?.records??[]),...page.records].map(r=>[r.id,r]));this.records={...page,end:previous?.end??page.end,records:[...rows.values()].sort((a,b)=>b.time-a.time||a.id.localeCompare(b.id)),warnings:[...new Set([...(previous?.warnings??[]),...page.warnings])]};this.recordCache.set(cache,this.records);this.trim(this.recordCache);
  }catch(e){if(version===this.recordVersion&&identity===this.context){this.recordError=normalizeError(e);this.failed(this.recordError);}}
  finally{if(version===this.recordVersion&&identity===this.context){this.recordsLoading=false;this.recordOpening.ready();this.changed();}}
 }
 async loadStatistics(context:DeviceContext,selection:DrinkSelection,force=false):Promise<void>{
  if(key(context)!==this.context)return;const same=selectionKey(selection)===selectionKey(this.selection);if(same&&this.statisticsLoading)return;const version=++this.statisticsVersion,identity=this.context,cache=this.cache('stats',selectionKey(selection));this.selection={...selection};this.statisticsError=undefined;
  if(!same){this.statistics=undefined;this.selectedTime=undefined;}const cached=this.statsCache.get(cache);if(!force&&cached&&Date.now()/1000-cached.fetchedAt<180){this.statistics=cached;this.statisticsLoading=false;this.statisticsOpening.cancel();this.defaultBucket();this.changed();return;}
  this.statisticsLoading=true;if(!this.statistics)this.statisticsOpening.begin();this.changed();
  try{const report=await this.transport.statistics(context,selection);if(version!==this.statisticsVersion||identity!==this.context)return;if(report.did!==context.did||selectionKey(report.selection)!==selectionKey(selection))throw Error('饮水统计与当前设备或日期不匹配。');this.statistics=report;this.statsCache.set(cache,report);this.trim(this.statsCache);this.defaultBucket();}
  catch(e){if(version===this.statisticsVersion&&identity===this.context){this.statisticsError=normalizeError(e);this.failed(this.statisticsError);}}
  finally{if(version===this.statisticsVersion&&identity===this.context){this.statisticsLoading=false;this.statisticsOpening.ready();this.changed();}}
 }
 private defaultBucket():void{if(this.selectedTime!==undefined)return;this.selectedTime=this.statistics?.points.find(p=>dateKey(new Date(p.time*1000)).slice(0,this.selection.period==='year'?7:10)===this.selection.date.slice(0,this.selection.period==='year'?7:10))?.time;}
 choose(time:number):void{if(this.statistics?.points.some(p=>p.time===time)&&time<=Date.now()/1000){this.selectedTime=time;this.changed();}}
 more(context:DeviceContext):void{if(this.recordsLoading)return;if(this.visible<(this.records?.records.length??0)){this.visible+=20;this.changed();}else if(this.records?.nextBefore!=null)void this.loadRecords(context,this.records.nextBefore);}
}
