import type {AppError,DeviceContext,Json} from './types';
import {sameContext,normalizeError} from './logic';
import {cameraDate} from './camera-browser';
export interface DeviceEventRecord {id:string;time:number;role:string;label:string;arguments:{name:string;label:string;value:Json;display:string}[]}
export interface DeviceEventPage {did:string;date:string;records:DeviceEventRecord[];nextCursor:string|null;complete:boolean;errors:string[];rejected:number}
export class DeviceEventsState {
 open=false;date=cameraDate(Date.now()/1000);records:DeviceEventRecord[]=[];error:AppError|undefined;loading=false;nextCursor:string|null=null;complete=false;
 private context:DeviceContext|undefined;private scope='';private ticket=0;
 constructor(private read:(c:DeviceContext,date:string,cursor:string|null)=>Promise<DeviceEventPage>,private changed:()=>void){}
 bind(c:DeviceContext|undefined,scope:string){if(!sameContext(c,this.context)||scope!==this.scope){this.close();this.context=c?{...c}:undefined;this.scope=scope;this.records=[];this.date=cameraDate(Date.now()/1000);this.nextCursor=null;this.error=undefined;}}
 close(){this.ticket++;this.open=false;this.loading=false;}
 async load(date=this.date,more=false){
  if(!this.context||more&&(!this.nextCursor||this.loading))return;
  const context={...this.context},token=++this.ticket,cursor=more?this.nextCursor:null;
  this.open=true;this.date=date;this.loading=true;this.error=undefined;if(!more){this.records=[];this.nextCursor=null;this.complete=false;}this.changed();
  try{const page=await this.read(context,date,cursor);if(token!==this.ticket||!sameContext(context,this.context))return;
   if(page.did!==context.did||page.date!==date||!Array.isArray(page.records)||page.records.some(r=>!r.id||!Number.isSafeInteger(r.time)||r.time<0||typeof r.role!=='string'||!Array.isArray(r.arguments)))throw Error('设备记录与当前查询不匹配。');
   this.records=[...new Map([...(more?this.records:[]),...page.records].map(r=>[r.id,r])).values()].sort((a,b)=>b.time-a.time||a.id.localeCompare(b.id));this.nextCursor=page.nextCursor;this.complete=page.complete;
   if(page.errors.length)this.error={kind:'cloud',message:page.errors[0],retryable:true};
  }catch(e){if(token===this.ticket)this.error=normalizeError(e);}finally{if(token===this.ticket){this.loading=false;this.changed();}}
 }
}
