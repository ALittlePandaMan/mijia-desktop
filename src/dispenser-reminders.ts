import {ReportOperations} from './report-operations';
import type {AppError,DeviceContext} from './types';import {DeviceOpening} from './device-opening';import {normalizeError} from './logic';
export type DrinkRepeat='notSelected'|'once'|'everyDay'|'workday'|'freeday'|'custom';
export type ReminderDraft={kind:'point';time:string;repeat:DrinkRepeat;weekdays:number[]}|{kind:'period';startTime:string;endTime:string;intervalHours:number};
export interface ReminderRow{key:string;enabled:boolean;draft:ReminderDraft}
export interface ReminderPush{value:boolean|null;source:string;canEdit:boolean;reason:string|null}
export interface ReminderReport{did:string;fetchedAt:number;revision:string;cycle:number|null;cycleCanEdit:boolean;cycleReason:string|null;cleanFinish:ReminderPush;lackWater:ReminderPush;reminders:ReminderRow[];canEditSchedules:boolean;scheduleReason:string|null;active:{enabled:boolean|null;intervalHours:number|null;orphaned:boolean;canStop:boolean};warnings:string[]}
export type ReminderUpdate={operation:'push';field:'cleanFinish'|'lackWater';enabled:boolean}|{operation:'cycle';value:number}|{operation:'save';key:string|null;draft:ReminderDraft}|{operation:'toggle';key:string;enabled:boolean}|{operation:'delete';key:string}|{operation:'stopActive'};
export type ReminderChange=ReminderUpdate&{revision:string};
export interface ReminderResult{verified:boolean;message:string;report:ReminderReport|null}
export type ReminderPicker={kind:'cycle';value:number}|{kind:'type';value:'point'|'period'}|{kind:'repeat';value:DrinkRepeat}|{kind:'weekdays';value:number[]}|{kind:'clock';field:'time'|'startTime'|'endTime';hour:number;minute:number}|{kind:'interval';value:number};
export interface ReminderView{page:'settings'|'list'|'edit';draft?:ReminderDraft;key?:string;revision?:string;picker?:ReminderPicker;confirmation?:'save'|'delete'|'stopActive';validation?:string}
export const repeatLabel:Record<DrinkRepeat,string>={notSelected:'未选中',once:'仅一次',everyDay:'每天',workday:'法定工作日',freeday:'法定节假日',custom:'自定义'};
export const weekdayLabel=(days:number[])=>days.map(d=>['周日','周一','周二','周三','周四','周五','周六'][d]).join('、');
export const reminderTitle=(draft:ReminderDraft)=>draft.kind==='point'?draft.time:`${draft.startTime}-${draft.endTime}`;
export const reminderSubtitle=(draft:ReminderDraft)=>draft.kind==='period'?`每隔${draft.intervalHours}小时提醒`:draft.repeat==='custom'?weekdayLabel(draft.weekdays):repeatLabel[draft.repeat];
const validClock=(s:string)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(s),minutes=(s:string)=>{const[h,m]=s.split(':').map(Number);return h*60+m;};
export function reminderDraftError(d:ReminderDraft):string|undefined{if(d.kind==='point'){if(!['once','everyDay','workday','freeday','custom'].includes(d.repeat))return'请选择重复类型';if(!validClock(d.time))return'请设置提醒时间';if(d.repeat==='custom'&&(!d.weekdays.length||d.weekdays.some(n=>!Number.isInteger(n)||n<0||n>6)||new Set(d.weekdays).size!==d.weekdays.length))return'请选择星期';}else{if(!validClock(d.startTime))return'请设置开始时间';if(!validClock(d.endTime))return'请设置结束时间';const duration=(minutes(d.endTime)-minutes(d.startTime)+1440)%1440;if(!duration)return'开始和结束时间不能相同';if(!Number.isFinite(d.intervalHours)||d.intervalHours<.5||d.intervalHours>12||d.intervalHours*2%1)return'请选择0.5至12小时的提醒间隔';if(duration<d.intervalHours*60)return'提醒间隔不能大于所选时段';}}
const identity=(c:DeviceContext)=>JSON.stringify([c.homeId,c.generation,c.did]);
function canRecover(r:ReminderReport,c:ReminderUpdate):boolean{switch(c.operation){case'push':return r[c.field].canEdit;case'cycle':return r.cycleCanEdit;case'stopActive':return r.active.enabled!==null;default:return r.canEditSchedules;}}
export function reminderMatches(r:ReminderReport,c:ReminderUpdate,before:ReminderReport):boolean{
 const sameDraft=(a:ReminderDraft,b:ReminderDraft)=>a.kind===b.kind&&(a.kind==='point'&&b.kind==='point'?a.time===b.time&&a.repeat===b.repeat&&[...a.weekdays].sort().join() === [...b.weekdays].sort().join():a.kind==='period'&&b.kind==='period'&&a.startTime===b.startTime&&a.endTime===b.endTime&&a.intervalHours===b.intervalHours);
 switch(c.operation){case'push':return r[c.field].source==='cloud'&&r[c.field].value===c.enabled;case'cycle':return r.cycle===c.value;case'stopActive':return r.active.enabled===false&&r.active.intervalHours!==null;default:if(!r.canEditSchedules||r.warnings.length)return false;
  if(c.operation==='delete')return !r.reminders.some(x=>x.key===c.key);
  if(c.operation==='toggle')return r.reminders.some(x=>x.key===c.key&&x.enabled===c.enabled);
  return r.reminders.filter(x=>x.enabled&&sameDraft(x.draft,c.draft)&&(c.key?x.key===c.key:!before.reminders.some(old=>old.key===x.key))).length===1;
 }
}
export class DispenserReminders{
 private raw:ReminderReport|undefined;private settings:ReportOperations<ReminderReport,ReminderUpdate>;
 get report(){return this.settings.report??this.raw;}set report(r:ReminderReport|undefined){this.raw=r;if(r)this.settings.observe(r);}
 error:AppError|undefined;loading=false;readonly opening=new DeviceOpening(()=>this.changed());private clock=0;get version(){return this.clock+this.settings.version;}private key='';private context='';private scope='';private receipts=new Map<string,{pending:boolean;message:string;change:ReminderUpdate}>();
 constructor(private transport:{read:(c:DeviceContext)=>Promise<ReminderReport>;save:(c:DeviceContext,v:ReminderChange)=>Promise<ReminderResult>},private changed:()=>void,private failed:(e:AppError)=>void){this.settings=new ReportOperations({read:transport.read,send:async(c,r,i)=>{const result=await transport.save(c,{...i,revision:r.revision});return{report:result.report??r,confirmed:result.verified};},validate:(r,c)=>{if(r.did!==c.did)throw Error('提醒设置与当前设备不匹配。');},key:i=>i.operation==='push'?i.field:i.operation==='toggle'?i.key:i.operation,project:(r,i)=>i.operation==='push'?{...r,[i.field]:{...r[i.field],value:i.enabled}}:i.operation==='cycle'?{...r,cycle:i.value}:i.operation==='toggle'?{...r,reminders:r.reminders.map(v=>v.key===i.key?{...v,enabled:i.enabled}:v)}:r,matches:(r,i)=>reminderMatches(r,i,r),allowed:(r,i)=>i.operation==='push'?r[i.field].canEdit:i.operation==='cycle'?r.cycleCanEdit:i.operation==='toggle'&&r.canEditSchedules,accepted:(_c,r)=>{this.raw=r;}},changed,failed);}
 bind(c:DeviceContext,scope:string){if(identity(c)!==this.context||scope!==this.scope){this.close();this.context=identity(c);this.scope=scope;this.key=JSON.stringify([scope,c.homeId,c.did]);this.settings.bind(c,scope);}}
 close(){this.clock++;this.context='';this.report=undefined;this.error=undefined;this.loading=false;this.opening.cancel();this.settings.close();}
 get pending(){return!!this.receipts.get(this.key)?.pending||this.settings.pending;}get blocked(){return this.receipts.has(this.key)||!!this.settings.error;}get uncertain(){return this.settings.uncertain;}adopt(){this.settings.adopt();}get message(){return this.receipts.get(this.key)?.message??this.settings.message;}
 async read(c:DeviceContext):Promise<void>{if(identity(c)!==this.context||this.loading||this.receipts.get(this.key)?.pending)return;const version=++this.clock,key=this.key,context=this.context;this.loading=true;this.error=undefined;if(!this.report)this.opening.begin();this.changed();
  try{const report=await this.transport.read(c);if(version!==this.clock||key!==this.key||context!==this.context)return;if(report.did!==c.did)throw Error('提醒设置与当前设备不匹配。');this.report=report;const receipt=this.receipts.get(key);if(receipt&&canRecover(report,receipt.change))this.receipts.delete(key);}
  catch(e){if(version===this.clock&&key===this.key&&context===this.context){this.error=normalizeError(e);this.failed(this.error);}}
  finally{if(version===this.clock&&key===this.key&&context===this.context){this.loading=false;this.opening.ready();this.changed();}}
 }
 async save(c:DeviceContext,update:ReminderUpdate,revision=this.report?.revision):Promise<boolean>{if(identity(c)!==this.context||!revision||this.blocked||this.loading||this.error||!this.report)return false;if(update.operation==='save'&&reminderDraftError(update.draft))return false;
  if(['push','cycle','toggle'].includes(update.operation)){void this.settings.change(structuredClone(update));return true;}if(this.settings.pending)return false;
  const key=this.key,context=this.context,version=++this.clock,change=structuredClone(update),before=structuredClone(this.report),receipt={pending:true,message:'正在确认提醒设置…',change};this.receipts.set(key,receipt);this.opening.begin();this.changed();
  try{const result=await this.transport.save(c,{...change,revision});if(result.report&&result.report.did!==c.did)throw Error('提醒回读与当前设备不匹配。');if(version===this.clock&&key===this.key&&context===this.context&&result.report)this.report=result.report;if(result.verified&&result.report&&reminderMatches(result.report,change,before)){this.receipts.delete(key);return version===this.clock&&key===this.key&&context===this.context;}receipt.message=result.verified?'回读状态与目标不一致，请重新读取；未重复发送。':result.message;}
  catch(e){receipt.message=normalizeError(e).message;if(version===this.clock&&key===this.key&&context===this.context)this.failed(normalizeError(e));}
  finally{receipt.pending=false;if(version===this.clock&&key===this.key&&context===this.context)this.opening.ready();this.changed();}return false;
 }
}
