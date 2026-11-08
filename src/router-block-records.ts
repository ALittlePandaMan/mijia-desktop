import type {AppError,DeviceContext} from './types';
import {normalizeError,sameContext} from './logic';
import {routerModel} from './router';
export interface BlockRecord {eventId:number;name:string|null;mac:string|null;count:number;timestamp:number|null}
export interface BlockRecordsReport {did:string;model:string;fetchedAt:number;items:BlockRecord[]}
export interface BlockGroup {key:string;day:string;month:string;relative:string;items:BlockRecord[]}
export function blockDescription(item:BlockRecord):string {
 const wifi=[1001,1002,1005].includes(item.eventId),smart=[1001,1002,1003,1004].includes(item.eventId);
 return `${wifi?'尝试连接WiFi':'尝试登录路由器后台'} | ${smart?'智能拦截':'黑名单拦截'} ${item.count}次`;
}
export function blockGroups(items:BlockRecord[],now=Date.now()):BlockGroup[] {
 const groups:BlockGroup[]=[],dateKey=(date:Date)=>`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
 const today=dateKey(new Date(now)),yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);
 for(const item of items){const date=item.timestamp===null?undefined:new Date(item.timestamp),key=date?dateKey(date):'unknown';let group=groups.find(g=>g.key===key);if(!group){group={key,day:date?String(date.getDate()).padStart(2,'0'):'日期未知',month:date?`${date.getMonth()+1}月`:'',relative:date?key===today?'今天':key===dateKey(yesterday)?'昨天':'':'',items:[]};groups.push(group);}group.items.push(item);}
 return groups;
}
export class RouterBlockRecordsState {
 report?:BlockRecordsReport;error?:AppError;loading=false;
 private epoch=0;private context?:DeviceContext;private scope='';
 constructor(private read:(c:DeviceContext)=>Promise<BlockRecordsReport>,private changed:()=>void,private failed:(e:AppError)=>void){}
 bind(c:DeviceContext,scope:string):void{if(!sameContext(c,this.context)||scope!==this.scope){this.close();this.context={...c};this.scope=scope;}}
 close():void{++this.epoch;this.context=undefined;this.report=undefined;this.error=undefined;this.loading=false;}
 async load(c:DeviceContext):Promise<void>{if(this.loading||!sameContext(c,this.context))return;const epoch=this.epoch,current=()=>epoch===this.epoch&&sameContext(c,this.context);this.loading=true;this.changed();try{const r=await this.read({...c});if(!current())return;if(r.did!==c.did||r.model!==routerModel||!Array.isArray(r.items)||r.items.length>50||r.items.some(i=>!Number.isSafeInteger(i.eventId)||i.eventId<=0||!Number.isSafeInteger(i.count)||i.count<0||i.timestamp!==null&&(!Number.isSafeInteger(i.timestamp)||i.timestamp<0||i.timestamp>8640000000000000)||i.name!==null&&typeof i.name!=='string'||i.mac!==null&&typeof i.mac!=='string'))throw{kind:'protocol',message:'拦截记录返回与当前路由器不匹配。',retryable:false};this.report=r;this.error=undefined;}catch(e){if(current()){this.report=undefined;this.error=normalizeError(e);this.failed(this.error);}}finally{if(current()){this.loading=false;this.changed();}}}
}
