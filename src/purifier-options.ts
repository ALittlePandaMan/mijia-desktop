import type {AppError,DeviceContext} from './types';
export interface PurifierOptionsReport {did:string;fetchedAt:number;filterFlushingSupported:boolean|null;supportReason:string|null;flushing:boolean|null;pushEnabled:boolean|null;pushSource:'cloud'|'vendorDefault'|'unknown';canSetPush:boolean;pushReason:string|null;revision:string}
export interface PurifierPushChange {revision:string;enabled:boolean}
export interface PurifierPushResult {verified:boolean;message:string;report:PurifierOptionsReport|null}
interface Transport {read:(c:DeviceContext)=>Promise<PurifierOptionsReport>;save:(c:DeviceContext,change:PurifierPushChange)=>Promise<PurifierPushResult>}
const identity=(c:DeviceContext)=>JSON.stringify([c.homeId,c.generation,c.did]);
const failure=(e:unknown):AppError=>e&&typeof e==='object'&&'message'in e?e as AppError:{kind:'unknown',message:'冲洗提醒状态尚未确认，请重新读取。',retryable:true};
export class PurifierOptions {
 report:PurifierOptionsReport|undefined;error:AppError|undefined;loading=false;
 private receipts=new Map<string,{pending:boolean;message:string}>();private key='';private context='';private scope='';private version=0;
 constructor(private transport:Transport,private changed:()=>void,private failed:(e:AppError)=>void){}
 bind(c:DeviceContext,scope:string):void{const id=identity(c);if(id!==this.context||scope!==this.scope){this.close();this.context=id;this.scope=scope;this.key=JSON.stringify([scope,c.homeId,c.did]);}}
 close():void{this.version++;this.report=undefined;this.loading=false;this.error=undefined;}
 get pending():boolean{return !!this.receipts.get(this.key)?.pending;}
 get blocked():boolean{return this.receipts.has(this.key);}
 get message():string{return this.receipts.get(this.key)?.message??'';}
 get canSetPush():boolean{return !!this.report?.canSetPush&&!this.blocked&&!this.loading&&!this.error;}
 async read(c:DeviceContext):Promise<void>{
  if(this.context!==identity(c)||this.loading||this.pending)return;
  const version=++this.version,id=this.context,key=this.key;this.loading=true;this.error=undefined;this.changed();
  try{const report=await this.transport.read(c);if(version!==this.version||id!==this.context)return;if(report.did!==c.did)throw Error('冲洗设置与当前设备不匹配。');this.report=report;if(typeof report.pushEnabled==='boolean')this.receipts.delete(key);}
  catch(e){if(version===this.version&&id===this.context){this.error=failure(e);this.failed(this.error);}}
  finally{if(version===this.version&&id===this.context){this.loading=false;this.changed();}}
 }
 async save(c:DeviceContext,enabled:boolean):Promise<boolean>{
  const r=this.report;if(!r||!this.canSetPush||identity(c)!==this.context)return false;if(enabled===r.pushEnabled)return true;
  const key=this.key,id=this.context,version=++this.version,receipt={pending:true,message:''};this.receipts.set(key,receipt);this.changed();
  try{const result=await this.transport.save(c,{revision:r.revision,enabled});if(result.report&&result.report.did!==c.did)throw Error('冲洗设置与当前设备不匹配。');
   if(this.key===key&&this.context===id&&this.version===version&&result.report)this.report=result.report;
   if(result.verified&&result.report?.pushSource==='cloud'&&result.report.pushEnabled===enabled){this.receipts.delete(key);return this.key===key&&this.context===id&&version===this.version;}
   receipt.message=result.verified?'回读提醒设置与目标不一致，请重新读取。':result.message;
  }catch(e){receipt.message=failure(e).message;if(this.context===id&&this.key===key&&version===this.version)this.failed(failure(e));}
  finally{receipt.pending=false;this.changed();}return false;
 }
}
