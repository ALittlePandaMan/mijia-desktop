import type {AppError,ControlResult,DeviceContext,DevicePanel} from './types';
import {normalizeError} from './logic';
import {dispenserModel} from './dispenser';
export type CheckOperation='start'|'cup'|'heat'|'stop';
export interface CheckChange{operation:CheckOperation;expected:number[]}
export interface CheckRecord{time:number;statuses:number[]}
export interface CheckRecords{did:string;records:CheckRecord[];rejected:number;truncated:boolean}
export const checkTitles=['Wi-Fi通信检测','进水温度传感器检测','管壁温度传感器检测','出水温度传感器检测','电源板与显示板通信检测','液位传感器检测','杯体检测','水泵电流','加热检测'];
export function checkState(panel:DevicePanel):number[]|undefined{
 if(panel.model!==dispenserModel||panel.unsupportedReason)return;
 const services=panel.services.filter(s=>s.siid===7&&s.name==='self-check');if(services.length!==1)return;
 const rows=services[0].properties.filter(p=>p.piid===2&&p.name==='self-check-results'&&p.format==='string'&&p.access.includes('read')&&!p.unsupportedReason);
 const prop=rows[0];if(rows.length!==1||prop.code!==0||typeof prop.value!=='string'||prop.value.length>32)return;
 const bits=prop.value.split(',');if(bits.length>9||bits.some(x=>x!==''&&!/^[0-4]$/.test(x)))return;
 return [...bits.map(x=>x===''?0:Number(x)),...Array(9-bits.length).fill(0)];
}
export function checkPhase(values:number[]):'idle'|'auto'|'cup'|'heat'|'report'{if(values.length!==9)return'idle';if(values.includes(3)||values.every(v=>v===1||v===2))return'report';if(values[7]!==0||values[8]!==0)return'heat';if(values[6]!==0)return'cup';return values.some(v=>v!==0)?'auto':'idle';}
export function checkSupported(panel:DevicePanel):boolean{const service=panel.services.filter(s=>s.siid===7&&s.name==='self-check');if(panel.model!==dispenserModel||panel.unsupportedReason||service.length!==1)return false;const p=service[0].properties.filter(v=>v.siid===7&&v.piid===1&&v.name==='self-check-items'&&v.format==='uint8'&&!v.unsupportedReason);if(p.length!==1||!Array.from({length:9},(_,i)=>i+1).every(i=>p[0].valueList?.some(v=>v.value===i)))return false;return [1,2].every(i=>{const a=service[0].actions.filter(v=>v.siid===7&&v.aiid===i&&v.name===(i===1?'start-check':'stop-check')&&!v.unsupportedReason);return a.length===1&&!a[0].out.length&&JSON.stringify(a[0].in)===JSON.stringify(i===1?[1]:[]);});}
export function checkNext(values:number[]):CheckOperation|undefined{const done=(v:number)=>v===1||v===2;if(values.length!==9)return;if(values.every(v=>v===0))return'start';if(values.slice(0,6).every(done)&&values.slice(6).every(v=>v===0))return'cup';if(values.slice(0,7).every(done)&&values.slice(7).every(v=>v===0))return'heat';}
export function checkTarget(values:number[],operation:CheckOperation):boolean{return values.length===9&&(operation==='start'?values[0]!==0:operation==='cup'?values[6]!==0:operation==='heat'?values[7]!==0||values[8]!==0:values.every(v=>v===0));}
const identity=(c:DeviceContext)=>JSON.stringify([c.homeId,c.generation,c.did]);
export class DispenserSelfCheck {
 private context='';private key='';private timer?:ReturnType<typeof setTimeout>;private clock=0;private receipts=new Map<string,{change:CheckChange;pending:boolean;message:string}>();
 checked=false;confirming=false;records?:CheckRecords;recordsLoading=false;recordsError?:AppError;selected?:CheckRecord;
 get version(){return this.clock;}get pending(){return !!this.receipts.get(this.key)?.pending;}get blocked(){return this.receipts.has(this.key);}get message(){return this.receipts.get(this.key)?.message??'';}
 constructor(private transport:{run:(c:DeviceContext,v:CheckChange)=>Promise<ControlResult>;confirm:(c:DeviceContext,v:CheckChange)=>Promise<ControlResult>;history:(c:DeviceContext)=>Promise<CheckRecords>},private changed:()=>void,private accept:(c:DeviceContext,p:DevicePanel)=>void,private failed:(e:AppError)=>void){}
 bind(c:DeviceContext,scope:string){const key=JSON.stringify([scope,c.homeId,c.did]);if(identity(c)!==this.context||key!==this.key){if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.checked=false;this.confirming=false;this.records=undefined;this.selected=undefined;this.recordsError=undefined;this.recordsLoading=false;}this.context=identity(c);this.key=key;if(this.receipts.has(key)&&!this.pending)this.schedule(c);}
 close(){if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.context='';this.checked=false;this.confirming=false;this.records=undefined;this.selected=undefined;this.recordsError=undefined;this.recordsLoading=false;}
 async run(c:DeviceContext,operation:CheckOperation,expected:number[]):Promise<boolean>{if(this.blocked||identity(c)!==this.context)return false;const key=this.key,context=this.context,receipt={change:{operation,expected:[...expected]},pending:false,message:'正在等待设备状态回读…'};this.receipts.set(key,receipt);return this.execute(c,key,context,receipt,false);}
 private async execute(c:DeviceContext,key:string,context:string,receipt:{change:CheckChange;pending:boolean;message:string},query:boolean):Promise<boolean>{
  if(receipt.pending)return false;receipt.pending=true;this.clock++;this.changed();
  try{const result=await(query?this.transport.confirm(c,receipt.change):this.transport.run(c,receipt.change));const actual=checkState(result.panel);if(result.panel.did!==c.did||!actual)throw Error('自检状态与设备不匹配。');if(key===this.key&&context===this.context){this.clock++;this.accept(c,result.panel);}if(result.verified&&checkTarget(actual,receipt.change.operation)){this.receipts.delete(key);if(key===this.key&&context===this.context&&receipt.change.operation==='stop')this.selected={time:0,statuses:[...receipt.change.expected]};return key===this.key&&context===this.context;}receipt.message=result.verified?'设备回读没有匹配目标阶段，继续查询。':result.message;}
  catch(e){const error=normalizeError(e);receipt.message=error.message;if(!['network','protocol','busy','offline','staleContext'].includes(error.kind)&&!query)this.receipts.delete(key);if(key===this.key&&context===this.context)this.failed(error);}
  finally{receipt.pending=false;if(key===this.key&&context===this.context){this.changed();if(this.receipts.has(key))this.schedule(c);}}return false;
 }
 private schedule(c:DeviceContext){if(this.timer)clearTimeout(this.timer);const key=this.key,context=this.context;this.timer=setTimeout(()=>{this.timer=undefined;const receipt=this.receipts.get(key);if(receipt&&key===this.key&&context===this.context&&!receipt.pending)void this.execute(c,key,context,receipt,true);},5000);}
 async loadHistory(c:DeviceContext){if(this.recordsLoading||identity(c)!==this.context)return;const current=this.context,key=this.key;this.recordsLoading=true;this.recordsError=undefined;this.changed();try{const r=await this.transport.history(c);if(current!==this.context||key!==this.key)return;if(r.did!==c.did||r.records.some(x=>x.statuses.length!==9||x.statuses.some(s=>!Number.isInteger(s)||s<0||s>4)))throw Error('自检记录与当前设备不匹配。');this.records=r;}catch(e){if(current===this.context&&key===this.key){this.recordsError=normalizeError(e);this.failed(this.recordsError);}}finally{if(current===this.context&&key===this.key){this.recordsLoading=false;this.changed();}}}
}
