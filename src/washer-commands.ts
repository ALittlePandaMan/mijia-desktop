import type {AppError,DeviceContext,DevicePanel} from './types';
import type {WasherDraft} from './washer';

export interface WasherProgramInput {program:string;values:Record<string,number|boolean>;reservationAt:number|null}
export interface WasherProgramPreview {estimatedMinutes:number;canStart:boolean;reason:string|null;requestId:string|null;panel:DevicePanel}
export interface WasherCommandResult {status:'confirmed'|'notStarted'|'uncertain';phase:'power'|'parameters'|'start';message:string;panel:DevicePanel|null}
interface Transport {
 preview:(context:DeviceContext,draft:WasherProgramInput)=>Promise<WasherProgramPreview>;
 start:(context:DeviceContext,requestId:string,draft:WasherProgramInput)=>Promise<WasherCommandResult>;
 confirm:(context:DeviceContext,requestId:string)=>Promise<WasherCommandResult>;
}
const key=(context:DeviceContext)=>JSON.stringify([context.homeId,context.generation,context.did]);
const input=(draft:WasherDraft,reservationAt:number|null):WasherProgramInput=>({program:draft.program,values:{...draft.values},reservationAt});
const signature=(draft:WasherProgramInput)=>JSON.stringify([draft.program,Object.entries(draft.values).sort(([a],[b])=>a.localeCompare(b)),draft.reservationAt]);
const failure=(error:unknown):AppError=>error&&typeof error==='object'&&'kind'in error&&'message'in error?error as AppError:{kind:'unknown',message:error instanceof Error?error.message:'暂时无法读取洗衣机。',retryable:true};

/** Local drafts never write. A submitted request retains its identity until an
 * explicit read confirms it; changing UI context invalidates late replies. */
export class WasherCommands {
 preview:WasherProgramPreview|undefined;
 loading=false;
 pending=false;
 requestId:string|undefined;
 result:WasherCommandResult|undefined;
 error:string|undefined;
 reservationAt:number|null=null;
 private contextKey='';
 private draftKey='';
 private version=0;
 private timer:ReturnType<typeof setTimeout>|undefined;
 constructor(private transport:Transport,private changed:()=>void,private accept:(panel:DevicePanel)=>void,private failed:(error:AppError)=>void,private id:()=>string=()=>crypto.randomUUID()){}
 get locked():boolean{return this.pending||!!this.requestId;}
 get canStart():boolean{return !this.locked&&!this.loading&&!!this.preview?.canStart;}
 reset():void{clearTimeout(this.timer);this.timer=undefined;this.version++;this.contextKey='';this.draftKey='';this.preview=undefined;this.loading=false;this.pending=false;this.requestId=undefined;this.result=undefined;this.error=undefined;this.reservationAt=null;}
 edit(context:DeviceContext,draft:WasherDraft):void{
  if(this.locked)return;
  const version=this.prepare(context,draft);this.timer=setTimeout(()=>{this.timer=undefined;void this.load(context,draft,version);},250);this.changed();
 }
 async refresh(context:DeviceContext,draft:WasherDraft):Promise<void>{if(this.pending)return;if(this.requestId){await this.confirm(context,draft);return;}const version=this.prepare(context,draft);this.changed();await this.load(context,draft,version);}
 private prepare(context:DeviceContext,draft:WasherDraft):number{
  clearTimeout(this.timer);this.timer=undefined;if(this.contextKey&&this.contextKey!==key(context))this.reset();
  this.contextKey=key(context);this.draftKey=signature(input(draft,this.reservationAt));this.preview=undefined;this.loading=true;this.error=undefined;this.result=undefined;return ++this.version;
 }
 private current(context:DeviceContext,version:number):boolean{return version===this.version&&this.contextKey===key(context);}
 private async load(context:DeviceContext,draft:WasherDraft,version:number):Promise<void>{
  const wire=input(draft,this.reservationAt);
  try{const report=await this.transport.preview(context,wire);if(!this.current(context,version))return;if(report.panel.did!==context.did)throw Error('洗衣机预览与当前设备不匹配。');this.preview=report;if(report.requestId)this.requestId=report.requestId;}
  catch(error){if(this.current(context,version)){const e=failure(error);this.error=e.message;this.failed(e);}}
  finally{if(this.current(context,version)){this.loading=false;this.changed();}}
 }
 async start(context:DeviceContext,draft:WasherDraft):Promise<void>{
  const wire=input(draft,this.reservationAt);if(!this.canStart||this.contextKey!==key(context)||this.draftKey!==signature(wire))return;
  const version=++this.version,requestId=this.id();clearTimeout(this.timer);this.pending=true;this.requestId=requestId;this.result=undefined;this.error=undefined;this.changed();
  try{const result=await this.transport.start(context,requestId,wire);if(this.current(context,version))this.receive(context,result);}
  catch(error){if(this.current(context,version)){const e=failure(error);this.error=e.message;this.failed(e);}}
  finally{if(this.current(context,version)){this.pending=false;this.changed();}}
 }
 private receive(context:DeviceContext,result:WasherCommandResult):void{
  if(result.panel&&result.panel.did!==context.did)throw Error('洗衣机回复与当前设备不匹配。');
  this.result=result;this.preview=undefined;if(result.panel)this.accept(result.panel);
  if(result.status!=='uncertain')this.requestId=undefined;
 }
 async confirm(context:DeviceContext,draft:WasherDraft):Promise<void>{
  if(!this.requestId||this.pending||this.contextKey!==key(context))return;
  const requestId=this.requestId,version=++this.version;this.pending=true;this.error=undefined;this.changed();let refresh=false;
  try{const result=await this.transport.confirm(context,requestId);if(this.current(context,version)){this.receive(context,result);refresh=result.status==='notStarted';}}
  catch(error){if(this.current(context,version)){const e=failure(error);this.error=e.message;this.failed(e);if(e.kind==='commandNotFound'){this.requestId=undefined;refresh=true;}}}
  finally{if(this.current(context,version)){this.pending=false;if(refresh)await this.refresh(context,draft);else this.changed();}}
 }
}
