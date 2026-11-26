import type {AppError,ControlResult,DeviceContext,DevicePanel,Json} from './types';
import {washerReportedProgramLabel,type WasherProgram} from './washer';

export interface WasherRuntimeControl {key:string;label:string;kind:'action'|'property';siid:number;piid:number|null;aiid:number|null;value:Json;enabled:boolean;reason:string|null;confirmation:string|null}
export interface WasherRuntimeSnapshot {state:string;active:boolean;serviceId?:number;mode:number|null;modeLabel?:string;stage:string|null;phaseLabel?:string;remainingMinutes:number|null;reservationMinutes:number|null;weighing:boolean;hasDrying:boolean;cleaning:boolean;locked:boolean|null;steps:{id:number;label:string;progress:'done'|'current'|'pending'}[];controls:WasherRuntimeControl[]}

export const washerProgramsLocked=(runtime?:WasherRuntimeSnapshot|null):boolean=>!!runtime&&(runtime.cleaning||['busy','paused','delay','fault'].includes(runtime.state));

/** A visible estimate is tied to the last live reading, not subsequent renders. */
export function washerFinishTime(minutes:number|null,readAt?:number):string|undefined{
 if(minutes===null||!Number.isFinite(minutes)||minutes<=0||!readAt||!Number.isFinite(readAt))return;
 const at=new Date(readAt+minutes*60_000),today=new Date(readAt);
 if(!Number.isFinite(at.getTime()))return;
 const day=(date:Date)=>Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());
 const days=(day(at)-day(today))/86_400_000;
 const prefix=days===1?'次日 ':days>1?`${at.getMonth()+1}月${at.getDate()}日 `:'';
 return `${prefix}${String(at.getHours()).padStart(2,'0')}:${String(at.getMinutes()).padStart(2,'0')}`;
}
export function washerStageLabel(label:string):string{return label==='洗涤'?'主洗':label;}
export function washerHomeStatus(runtime:WasherRuntimeSnapshot):string{
 if(runtime.cleaning)return '风道清洁中';
 if(runtime.state==='paused')return '暂停中';
 if(runtime.state==='delay')return '预约中';
 if(runtime.state==='completed')return '已完成';
 if(runtime.weighing)return '称重中';
 const current=runtime.steps.find(step=>step.progress==='current');
 const phase=current?.label??runtime.phaseLabel;
 return phase?`${washerStageLabel(phase)}中`:'工作中';
}
export function washerRuntimeMode(runtime:WasherRuntimeSnapshot,programs:WasherProgram[]):string|undefined {
 if(runtime.cleaning)return '风道清洁';
 const title=programs.find(program=>program.value===runtime.mode)?.title;
 return title??washerReportedProgramLabel(runtime.modeLabel);
}
export function washerRuntimeControls(runtime:WasherRuntimeSnapshot):WasherRuntimeControl[]{
 return runtime.controls.filter(control=>control.key!=='lock');
}
export function washerRuntimeHasDetail(runtime:WasherRuntimeSnapshot,readOnly:boolean):boolean{
 return runtime.active&&(['busy','paused'].includes(runtime.state)||runtime.steps.length>0||!readOnly&&washerRuntimeControls(runtime).length>0);
}
export function washerRuntimeFinish(runtime:WasherRuntimeSnapshot,readAt?:number):string|undefined{
 if(runtime.state==='delay')return washerFinishTime(runtime.reservationMinutes,readAt);
 if(runtime.state==='busy'&&!runtime.weighing)return washerFinishTime(runtime.remainingMinutes,readAt);
}

interface Transport {action:(context:DeviceContext,siid:number,aiid:number,inputs:Json[],intent?:string)=>Promise<ControlResult>;write:(context:DeviceContext,siid:number,piid:number,value:Json)=>Promise<ControlResult>;read:(context:DeviceContext,expectedState?:string,intent?:string)=>Promise<DevicePanel>}
interface Receipt {
 pending:boolean; started:boolean; submitted:boolean; invalid:boolean; deadline:number;
 control:WasherRuntimeControl; intent?:string; revision:number; previous?:Receipt;
 timer?:ReturnType<typeof setTimeout>; retry?:ReturnType<typeof setTimeout>;
}
const identity=(context:DeviceContext)=>JSON.stringify([context.homeId,context.generation,context.did]);
const failure=(e:unknown):AppError=>e&&typeof e==='object'&&'kind'in e&&'message'in e?e as AppError:{kind:'unknown',message:e instanceof Error?e.message:'设备状态暂未确认。',retryable:true};
const targetState:Record<string,string>={pause:'paused',resume:'busy',stop:'idle',off:'off',cancel:'idle'};
function liveControlValue(control:WasherRuntimeControl,panel:DevicePanel):Json|undefined{
 const property=panel.services.find(s=>s.siid===control.siid)?.properties.find(p=>p.piid===control.piid);
 return property?.code===0?property.value:undefined;
}
function matches(control:WasherRuntimeControl,runtime:WasherRuntimeSnapshot,panel:DevicePanel):boolean{
 if(control.key==='lock')return runtime.locked===Boolean(control.value);
 if(control.key==='stop')return !runtime.cleaning&&['idle','off','completed'].includes(runtime.state);
 if(control.key==='cancel'||control.key==='off')return ['idle','off'].includes(runtime.state)&&liveControlValue(control,panel)===false;
 return runtime.state===targetState[control.key];
}
/** Local predictions never become transport baselines. Explicit inputs queue once;
 * old receipts cannot remove a newer task or a separate child-lock setting. */
export class WasherRuntimeCommands {
 private records=new Map<string,Receipt>();private active='';private context='';private model?:string;
 private tail=Promise.resolve();private clock=0;private generation=0;
 constructor(private transport:Transport,private changed:()=>void,private accept:(context:DeviceContext,panel:DevicePanel)=>void,private failed:(error:AppError)=>void){}
 bind(context:DeviceContext,scope:string,model?:string):void{
  const next=JSON.stringify([scope,identity(context),model]);if(next!==this.active)this.close();
  this.active=next;this.context=identity(context);this.model=model;
 }
 close():void{
  for(const receipt of this.records.values())this.clear(receipt);
  this.records.clear();this.active='';this.context='';this.model=undefined;this.generation++;this.tail=Promise.resolve();
 }
 get pending():boolean{return [...this.records.values()].some(receipt=>receipt.pending);}
 get projecting():boolean{return [...this.records.keys()].some(key=>key==='task'||key.startsWith('task:'));}
 get version():number{return this.clock;}
 get blocked():boolean{return false;}
 get message():string{return '';}
 private clear(receipt:Receipt):void{clearTimeout(receipt.timer);clearTimeout(receipt.retry);}
 private discard(key:string,receipt:Receipt):void{
  this.clear(receipt);
  if(this.records.get(key)===receipt){this.records.delete(key);this.clock++;this.changed();}
 }
 display(panel:DevicePanel):DevicePanel{
  if(!panel.washerRuntime)return panel;
  let runtime={...panel.washerRuntime};
  for(const receipt of [...this.records.values()].sort((a,b)=>a.revision-b.revision)){
   const control=receipt.control,state=targetState[control.key]??runtime.state;
   if(panel.washerDrums?.length&&control.siid!==runtime.serviceId)continue;
   const active=!['off','idle','unknown','fault'].includes(state);
   const controls=active?runtime.controls.flatMap(c=>{
    if(c.key==='lock'&&control.key==='lock')return[{...c,value:!Boolean(control.value)}];
    const next=c.key==='pause'&&state==='paused'?'resume':c.key==='resume'&&state==='busy'?'pause':undefined;
    if(!next)return[c];
    const service=panel.services.find(s=>s.siid===c.siid&&s.name==='washer');
    const alternatives=service?.actions.filter(a=>a.name===(next==='pause'?'pause':'start-wash')&&a.siid===c.siid&&!a.in.length&&!a.unsupportedReason);
    const action=alternatives?.length===1?alternatives[0]:undefined;
    if(!action||!service||service.actions.filter(a=>a.aiid===action.aiid).length!==1)return[];
    const status=service.properties.find(p=>p.name==='status');
    if(status&&!status.valueList?.some(v=>(next==='pause'?/^(pause|paused|暂停|暂停中)$/i:/^(busy|running|working|工作中|运行中)$/i).test(v.description.trim())))return[];
    return[{...c,key:next,label:next==='pause'?'暂停':'继续',aiid:action.aiid}];
   }):[];
   runtime={...runtime,state,active,steps:active?runtime.steps:[],locked:control.key==='lock'?Boolean(control.value):runtime.locked,controls};
  }
  const power=panel.services.find(service=>service.siid===runtime.serviceId)?.properties.find(property=>property.name==='on');
  if(power?.code===0&&power.value===false&&!runtime.cleaning&&runtime.state!=='completed'){
   runtime={...runtime,state:'off',active:false,steps:[],controls:[]};
  }
  const locked=panel.services.some(service=>(service.name==='physical-controls-locked'||service.siid===runtime.serviceId)&&
   service.properties.some(property=>['physical-controls-locked','child-lock'].includes(property.name)&&property.code===0&&property.value===true));
  if(locked)runtime={...runtime,locked:true,controls:runtime.controls.map(control=>control.key==='lock'?control:{...control,enabled:false})};
  return{...panel,washerRuntime:runtime};
 }
 async execute(context:DeviceContext,control:WasherRuntimeControl,drum=false):Promise<void>{
  if(!control.enabled||this.context!==identity(context))return;
  const generation=this.generation,key=control.key==='lock'?'lock':drum?`task:${control.siid}`:'task',previous=this.records.get(key);
  if(previous&&previous.control.key===control.key&&previous.control.value===control.value)return;
  if(previous)this.clear(previous);
  const receipt:Receipt={pending:true,started:false,submitted:false,invalid:false,deadline:Date.now()+30000,control:{...control},
   intent:control.kind==='action'?crypto.randomUUID():undefined,revision:++this.clock,previous:key==='lock'?undefined:previous};
  receipt.timer=setTimeout(()=>{receipt.invalid=true;this.discard(key,receipt);},30000);
  this.records.set(key,receipt);this.changed();
  const current=()=>this.generation===generation;
  try{
   const result=await this.queue(async()=>{
    if(!current()||receipt.deadline<=Date.now())return;
    if(receipt.previous&&(receipt.previous.invalid||!receipt.previous.submitted))throw Error('前序操作未提交。');
    if(key==='lock'&&this.records.get(key)!==receipt)return;
    receipt.previous=undefined;
    receipt.started=true;
    let result:ControlResult;
    if(control.kind==='action'&&control.aiid!==null)result=await this.transport.action(context,control.siid,control.aiid,[],receipt.intent);
    else if(control.kind==='property'&&control.piid!==null)result=await this.transport.write(context,control.siid,control.piid,control.value);
    else throw Error('此控制映射暂不可用。');
    if(receipt.deadline<=Date.now())throw Error('提交超时。');
    this.checkPanel(context,result.panel);
    receipt.submitted=true;
    return result;
   });
   if(!result||!current()||this.records.get(key)!==receipt)return;
   if(result.verified){this.accept(context,result.panel);this.discard(key,receipt);}
   else void this.confirm(context,key,receipt,generation);
  }catch(error){
   receipt.invalid=true;
   if(current()&&this.records.get(key)===receipt){this.discard(key,receipt);this.failed(failure(error));}
  }finally{receipt.pending=false;if(current())this.changed();}
 }
 private queue<T>(send:()=>Promise<T>):Promise<T>{const task=this.tail.then(send);this.tail=task.then(()=>{},()=>{});return task;}
 private checkPanel(context:DeviceContext,panel:DevicePanel):void{
  if(panel.did!==context.did||this.model&&this.model!==panel.model)throw Error('设备返回的标识不匹配。');
 }
 private async confirm(context:DeviceContext,key:string,receipt:Receipt,generation:number):Promise<void>{
  const current=()=>this.generation===generation&&this.records.get(key)===receipt;
  if(!current())return;
  try{
   const panel=await this.transport.read(context,targetState[receipt.control.key],receipt.intent);
   if(!current())return;
   this.checkPanel(context,panel);
   const runtime=key.startsWith('task:')?panel.washerDrums?.find(snapshot=>snapshot.serviceId===receipt.control.siid):panel.washerRuntime;
   if(!runtime||runtime.state==='unknown')throw Error('洗涤状态未读到。');
   const control=receipt.control;
   if(['cancel','off'].includes(control.key)&&typeof liveControlValue(control,panel)!=='boolean')throw Error('电源状态未读到。');
   const cleanTime=panel.services.find(s=>s.name==='dryer-channel-clean')?.properties.find(p=>p.name==='clean-lefttime');
   if(control.key==='stop'&&cleanTime&&(cleanTime.code!==0||typeof cleanTime.value!=='number'))throw Error('清洁状态未读到。');
   this.clock++;
   this.accept(context,panel);
   if(matches(receipt.control,runtime,panel))this.discard(key,receipt);
   else{
    receipt.retry=setTimeout(()=>void this.confirm(context,key,receipt,generation),2000);
    this.changed();
   }
  }catch(error){
   if(this.generation!==generation)return;
   const latest=this.records.get(key);
   if(latest===receipt||latest?.previous===receipt&&!latest.started){
    receipt.invalid=true;
    this.discard(key,latest);
    this.failed(failure(error));
   }
  }
 }
 async refresh(context:DeviceContext):Promise<void>{
  if(this.context!==identity(context))return;
  const generation=this.generation,version=this.clock;
  try{
   const panel=await this.transport.read(context);
   if(this.generation!==generation||version!==this.clock)return;
   this.checkPanel(context,panel);this.clock++;this.accept(context,panel);
  }catch(error){if(this.generation===generation&&version===this.clock)this.failed(failure(error));}
  finally{if(this.generation===generation)this.changed();}
 }
}
