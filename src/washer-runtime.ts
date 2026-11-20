import type {AppError,ControlResult,DeviceContext,DevicePanel,Json} from './types';

export interface WasherRuntimeControl {key:string;label:string;kind:'action'|'property';siid:number;piid:number|null;aiid:number|null;value:Json;enabled:boolean;reason:string|null;confirmation:string|null}
export interface WasherRuntimeSnapshot {state:string;active:boolean;mode:number|null;stage:string|null;remainingMinutes:number|null;reservationMinutes:number|null;weighing:boolean;hasDrying:boolean;cleaning:boolean;locked:boolean|null;steps:{id:number;label:string;progress:'done'|'current'|'pending'}[];controls:WasherRuntimeControl[]}

/** A visible estimate is tied to the last live reading, not subsequent renders. */
export function washerFinishTime(minutes:number|null,readAt?:number):string|undefined{
 if(minutes===null||!Number.isFinite(minutes)||minutes<=0||!readAt)return;
 const at=new Date(readAt+minutes*60_000),today=new Date(readAt);
 return `${at.toDateString()!==today.toDateString()?'次日 ':''}${String(at.getHours()).padStart(2,'0')}:${String(at.getMinutes()).padStart(2,'0')}`;
}
export function washerStageLabel(label:string):string{return label==='洗涤'?'主洗':label;}
export function washerHomeStatus(runtime:WasherRuntimeSnapshot):string{
 if(runtime.cleaning)return '风道清洁中';
 if(runtime.state==='paused')return '暂停中';
 if(runtime.state==='delay')return '预约中';
 if(runtime.state==='completed')return '已完成';
 if(runtime.weighing)return '称重中';
 const current=runtime.steps.find(step=>step.progress==='current');
 return current?`${washerStageLabel(current.label)}中`:'工作中';
}
interface Transport {action:(context:DeviceContext,siid:number,aiid:number,inputs:Json[])=>Promise<ControlResult>;write:(context:DeviceContext,siid:number,piid:number,value:Json)=>Promise<ControlResult>;read:(context:DeviceContext)=>Promise<DevicePanel>}
interface Receipt {pending:boolean;message:string;control:WasherRuntimeControl;revision:number;timer?:ReturnType<typeof setTimeout>}
const identity=(context:DeviceContext)=>JSON.stringify([context.homeId,context.generation,context.did]);
const failure=(e:unknown):AppError=>e&&typeof e==='object'&&'kind'in e&&'message'in e?e as AppError:{kind:'unknown',message:e instanceof Error?e.message:'设备状态暂未确认。',retryable:true};
/** Local predictions never become transport baselines. Explicit inputs queue once;
 * old receipts cannot remove a newer task or a separate child-lock setting. */
export class WasherRuntimeCommands {
 private records=new Map<string,Receipt>();private active='';private context='';private tail=Promise.resolve();private clock=0;
 constructor(private transport:Transport,private changed:()=>void,private accept:(context:DeviceContext,panel:DevicePanel)=>void,private failed:(error:AppError)=>void){}
 bind(context:DeviceContext,scope:string):void{const next=JSON.stringify([scope,context.homeId,context.generation,context.did])+':';if(next!==this.active)this.close();this.active=next;this.context=identity(context);}
 close():void{for(const receipt of this.records.values())clearTimeout(receipt.timer);this.records.clear();this.active='';this.context='';}
 private entries(){return [...this.records].filter(([key])=>key.startsWith(this.active));}
 get pending():boolean{return this.entries().some(([,r])=>r.pending);}
 get blocked():boolean{return false;}
 get message():string{return '';}
 display(panel:DevicePanel):DevicePanel{
  if(!panel.washerRuntime)return panel;
  let runtime={...panel.washerRuntime};
  for(const [,receipt]of this.entries().sort((a,b)=>a[1].revision-b[1].revision)){
   const control=receipt.control,state=({pause:'paused',resume:'busy',stop:'idle',off:'off',cancel:'idle'}as Record<string,string>)[control.key]??runtime.state;
   const controls=runtime.controls.map(c=>{
    if(c.key==='lock'&&control.key==='lock')return{...c,value:!Boolean(control.value)};
    const next=c.key==='pause'&&state==='paused'?'resume':c.key==='resume'&&state==='busy'?'pause':undefined;
    if(!next)return c;
    const action=panel.services.find(s=>s.name==='washer')?.actions.find(a=>a.name===(next==='pause'?'pause':'start-wash'));
    return action?{...c,key:next,label:next==='pause'?'暂停':'继续',aiid:action.aiid,siid:action.siid}:c;
   });
   runtime={...runtime,state,active:!['off','idle'].includes(state),locked:control.key==='lock'?Boolean(control.value):runtime.locked,controls};
  }
  return{...panel,washerRuntime:runtime};
 }
 async execute(context:DeviceContext,control:WasherRuntimeControl):Promise<void>{
  if(!control.enabled||this.context!==identity(context))return;
  const active=this.active,key=active+(control.key==='lock'?'lock':'task'),identityAtStart=this.context,receipt:Receipt={pending:true,message:'',control:{...control},revision:++this.clock};
  clearTimeout(this.records.get(key)?.timer);receipt.timer=setTimeout(()=>{if(this.records.get(key)===receipt){this.records.delete(key);this.changed();}},30000);this.records.set(key,receipt);this.changed();const current=()=>this.active===active&&this.context===identityAtStart;
  try{
   const result=await this.queue(async()=>{
    if(!current())throw {kind:'staleContext',message:'设备已经切换。'};
    // A queued value superseded before dispatch is never sent.
    if(this.records.get(key)!==receipt)return undefined;
    if(control.kind==='action'&&control.aiid!==null)return this.transport.action(context,control.siid,control.aiid,[]);
    if(control.kind==='property'&&control.piid!==null)return this.transport.write(context,control.siid,control.piid,control.value);
    throw Error('此控制映射暂不可用。');
   });
   if(!result||this.records.get(key)!==receipt||!current())return;
   if(result.panel.did!==context.did)throw Error('设备返回的标识不匹配，请重新读取。');
   this.accept(context,result.panel);if(result.verified){clearTimeout(receipt.timer);this.records.delete(key);}
  }catch(error){if(this.records.get(key)===receipt&&current()){clearTimeout(receipt.timer);this.records.delete(key);this.failed(failure(error));}}
  finally{receipt.pending=false;this.changed();}
 }
 private queue<T>(send:()=>Promise<T>):Promise<T>{const task=this.tail.then(send);this.tail=task.then(()=>{},()=>{});return task;}
 async refresh(context:DeviceContext):Promise<void>{
  if(this.context!==identity(context))return;
  const active=this.active,version=this.clock;
  try{const panel=await this.transport.read(context);if(this.active!==active||this.context!==identity(context)||version!==this.clock)return;if(panel.did!==context.did)throw Error('设备返回的标识不匹配。');
   for(const[key,r]of this.entries())if(!r.pending){const runtime=panel.washerRuntime,expected=({pause:'paused',resume:'busy',stop:'idle',off:'off',cancel:'idle'}as Record<string,string>)[r.control.key],matches=r.control.key==='lock'?runtime?.locked===Boolean(r.control.value):runtime?.state===expected;if(matches){clearTimeout(r.timer);this.records.delete(key);}}this.accept(context,panel);
  }catch(error){if(this.active===active&&this.context===identity(context))this.failed(failure(error));}
  finally{this.changed();}
 }
}
