import type {AppError,ControlResult,DeviceContext,DevicePanel,Json} from './types';

export interface WasherRuntimeControl {key:string;label:string;kind:'action'|'property';siid:number;piid:number|null;aiid:number|null;value:Json;enabled:boolean;reason:string|null;confirmation:string|null}
export interface WasherRuntimeSnapshot {state:string;active:boolean;mode:number|null;stage:string|null;remainingMinutes:number|null;reservationMinutes:number|null;weighing:boolean;hasDrying:boolean;cleaning:boolean;locked:boolean|null;steps:{id:number;label:string;progress:'done'|'current'|'pending'}[];controls:WasherRuntimeControl[]}
interface Transport {action:(context:DeviceContext,siid:number,aiid:number,inputs:Json[])=>Promise<ControlResult>;write:(context:DeviceContext,siid:number,piid:number,value:Json)=>Promise<ControlResult>;read:(context:DeviceContext)=>Promise<DevicePanel>}
interface Receipt {pending:boolean;message:string}
const identity=(context:DeviceContext)=>JSON.stringify([context.homeId,context.generation,context.did]);
const failure=(e:unknown):AppError=>e&&typeof e==='object'&&'kind'in e&&'message'in e?e as AppError:{kind:'unknown',message:e instanceof Error?e.message:'设备状态暂未确认。',retryable:true};
/** One send per explicit UI operation. Uncertain receipts survive closing and
 * reopening the device; only an explicit read unlocks another operation. */
export class WasherRuntimeCommands {
 private records=new Map<string,Receipt>();private active='';private context='';private notice='';
 constructor(private transport:Transport,private changed:()=>void,private accept:(context:DeviceContext,panel:DevicePanel)=>void,private failed:(error:AppError)=>void){}
 bind(context:DeviceContext,scope:string):void{const key=JSON.stringify([scope,context.homeId,context.did]);if(this.active!==key){this.active=key;this.notice='';}this.context=identity(context);}
 get pending():boolean{return !!this.records.get(this.active)?.pending;}
 get blocked():boolean{return this.records.has(this.active);}
 get message():string{return this.records.get(this.active)?.message??this.notice;}
 async execute(context:DeviceContext,control:WasherRuntimeControl):Promise<void>{
  if(!control.enabled||this.blocked||this.context!==identity(context))return;
  const key=this.active,identityAtStart=this.context,receipt:Receipt={pending:true,message:`正在${control.label}…`};this.records.set(key,receipt);this.notice='';this.changed();
  try{
   let result:ControlResult;
   if(control.kind==='action'&&control.aiid!==null)result=await this.transport.action(context,control.siid,control.aiid,[]);
   else if(control.kind==='property'&&control.piid!==null)result=await this.transport.write(context,control.siid,control.piid,control.value);
   else throw Error('此控制映射暂不可用。');
   if(result.panel.did!==context.did)throw Error('设备返回的标识不匹配，请重新读取。');
   if(this.records.get(key)!==receipt)return;
   receipt.message=result.message;
   if(this.active===key&&this.context===identityAtStart)this.accept(context,result.panel);
   if(result.verified){this.records.delete(key);if(this.active===key&&this.context===identityAtStart)this.notice=result.message;}
  }catch(error){if(this.records.get(key)===receipt){const e=failure(error);receipt.message=e.message;if(this.active===key&&this.context===identityAtStart)this.failed(e);}}
  finally{receipt.pending=false;this.changed();}
 }
 async refresh(context:DeviceContext):Promise<void>{
  if(this.pending||this.context!==identity(context))return;
  const key=this.active,identityAtStart=this.context,receipt:Receipt={pending:true,message:''};this.records.set(key,receipt);this.changed();
  try{const panel=await this.transport.read(context);if(panel.did!==context.did)throw Error('设备返回的标识不匹配。');if(this.records.get(key)!==receipt)return;this.records.delete(key);if(this.active===key&&this.context===identityAtStart){this.accept(context,panel);this.notice='已重新读取当前设备状态。';}}
  catch(error){if(this.records.get(key)===receipt){const e=failure(error);receipt.message=e.message;if(this.active===key&&this.context===identityAtStart)this.failed(e);}}
  finally{receipt.pending=false;this.changed();}
 }
}
