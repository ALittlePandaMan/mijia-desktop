import profile from './fryer-profile.json';
import type {DeviceContext,AppError} from './types';
import {ReportOperations} from './report-operations';
export const fryerModel=profile.model;
export const fryerModes=profile.pageOrder.map(id=>profile.modes.find(m=>m.mode===id)!);
export type FryerMode=typeof profile.modes[number];
export interface FryerSnapshot {did:string;model:string;fetchedAt:number;revision:string;status:number;fault:number;mode:number;minutes:number;temperature:number;leftMinutes:number;autoKeepWarm:boolean;keepWarm:boolean|null;recipeId:string|null;reservationMinutes:number|null;clockAt?:number;clockSeconds?:number;reservationFinishAt?:number}
export type FryerChange={operation:'start';mode:number;minutes:number;temperature:number;keepWarm:boolean;finishAt:number|null}|{operation:'adjust';minutes:number;temperature:number;keepWarm:boolean}|{operation:'pause'|'resume'|'stop'};
export interface FryerDraft {mode:number;minutes:number;temperature:number;keepWarm:boolean}
export interface FryerView {draft?:FryerDraft;picker?:'temperature'|'time'|'reservation';confirmation?:'stop'}
export const fryerMode=(id:number)=>profile.modes.find(m=>m.mode===id);
export const fryerCooking=(status:number)=>[4,13,14,15,16].includes(status);
export const fryerActive=(status:number)=>[2,3,4,5,8,9,10,11,13,14,15,16,17].includes(status);
export function fryerRange(m:FryerMode,temperature:number){return {temperature:m.temperatureRange,minutes:[1,m.mode===0&&temperature>=80?60:m.maxMinutes,1]};}
export function fryerDraft(m:FryerMode,r?:FryerSnapshot):FryerDraft{return {mode:m.mode,minutes:m.minutes,temperature:m.temperature,keepWarm:m.keepWarm&&m.temperature>80&&(r?.autoKeepWarm??false)};}
export function fryerSettingsProblem(d:FryerDraft,r?:FryerSnapshot,now=Date.now()/1000):string|undefined {
 const m=fryerMode(d.mode);if(!m)return'此模式尚未适配。';const range=fryerRange(m,d.temperature),t=range.temperature;
 if(!Number.isInteger(d.temperature)||d.temperature<t[0]||d.temperature>t[1]||(d.temperature-t[0])%t[2])return'请选择此模式支持的温度。';
 if(!Number.isInteger(d.minutes)||d.minutes<1||d.minutes>range.minutes[1])return'请选择此模式支持的烹饪时间。';
 if(d.keepWarm&&(!m.keepWarm||d.temperature<=80||r!==undefined&&!r.autoKeepWarm))return'当前模式不支持自动保温。';
 if(r&&fryerActive(r.status)&&r.mode===d.mode&&fryerRemaining(r,now)+(d.minutes-r.minutes)*60<=0)return'新总时长必须大于已运行时长。';
}
export function fryerRemaining(r:FryerSnapshot,now=Date.now()/1000):number{return Math.max(0,(r.clockSeconds??r.leftMinutes*60)-(fryerCooking(r.status)?Math.max(0,now-(r.clockAt??r.fetchedAt)):0));}
export function fryerFinish(r:FryerSnapshot,_now=Date.now()/1000):number|undefined {
 if(fryerCooking(r.status))return (r.clockAt??r.fetchedAt)+(r.clockSeconds??r.leftMinutes*60);
 if(r.status===3&&r.reservationMinutes!==null)return r.reservationFinishAt??r.fetchedAt+(r.reservationMinutes+r.minutes)*60;
}
/** Minute-only device readings must not move the finish time five seconds
 * forward on every poll. Preserve the clock within one quantization interval;
 * a materially different device reading establishes a fresh anchor. */
export function anchorFryerClock(previous:FryerSnapshot|undefined,r:FryerSnapshot):FryerSnapshot {
 let seconds=r.leftMinutes*60,end=r.status===3&&r.reservationMinutes!==null?r.fetchedAt+(r.reservationMinutes+r.minutes)*60:undefined;
 if(previous&&previous.did===r.did&&previous.mode===r.mode&&previous.recipeId===r.recipeId){
  const delta=(r.minutes-previous.minutes)*60;
  if(fryerCooking(previous.status)&&fryerCooking(r.status)){const expected=fryerRemaining(previous,r.fetchedAt)+delta;if(Math.abs(expected-seconds)<=60)seconds=Math.max(0,expected);}
  if(previous.status===3&&r.status===3&&end!==undefined){const expected=(fryerFinish(previous,previous.fetchedAt)??end)+delta;if(Math.abs(expected-end)<=60)end=expected;}
 }
 return {...r,clockAt:r.fetchedAt,clockSeconds:seconds,reservationFinishAt:end};
}
export function fryerClock(at:number,now=Date.now()/1000,withToday=false):string {
 const d=new Date(at*1000),today=new Date(now*1000),tomorrow=new Date(today);tomorrow.setDate(tomorrow.getDate()+1);
 const same=(a:Date,b:Date)=>a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();
 return `${same(d,today)?(withToday?'今天 ':''):same(d,tomorrow)?'明天 ':`${d.getMonth()+1}月${d.getDate()}日 `}${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
export function fryerReservationProblem(at:number,minutes:number,now=Date.now()/1000):string|undefined {if(!Number.isFinite(at)||at<now+minutes*60)return'完成时间须预留完整烹饪时长。';if(at>now+86400)return'预约时间不能超过24小时。';}
export function fryerStatus(r:FryerSnapshot):string {
 if(r.fault)return'设备故障';if(fryerCooking(r.status))return'烹饪中…';
 return ({0:'待机',1:'待机',2:'已暂停',3:'预约中',5:'预热中…',6:'烹饪完成',8:'预热已暂停',9:'抽锅暂停',10:'保温中',11:'保温已暂停',12:'保温完成',17:'请检查水箱',18:'自检中'} as Record<number,string>)[r.status]??'设备状态';
}
export function projectFryer(r:FryerSnapshot,c:FryerChange,at=Date.now()/1000):FryerSnapshot {
 if(c.operation==='adjust'){const delta=(c.minutes-r.minutes)*60;return {...r,minutes:c.minutes,temperature:c.temperature,keepWarm:c.keepWarm,leftMinutes:Math.max(0,r.leftMinutes+c.minutes-r.minutes),clockSeconds:r.clockSeconds===undefined?undefined:Math.max(0,r.clockSeconds+delta),reservationFinishAt:r.reservationFinishAt===undefined?undefined:r.reservationFinishAt+delta};}
 if(c.operation==='start')return {...r,mode:c.mode,recipeId:`M${c.mode}`,minutes:c.minutes,temperature:c.temperature,keepWarm:c.keepWarm,leftMinutes:c.minutes,status:c.finishAt?3:4,fetchedAt:at,clockAt:at,clockSeconds:c.minutes*60,reservationFinishAt:c.finishAt??undefined,reservationMinutes:c.finishAt?Math.max(0,Math.ceil((c.finishAt-at)/60)-c.minutes):0};
 if(c.operation==='pause')return {...r,leftMinutes:fryerRemaining(r,at)/60,clockSeconds:fryerRemaining(r,at),clockAt:at,fetchedAt:at,status:2};
 if(c.operation==='resume')return {...r,fetchedAt:at,clockAt:at,status:4};
 return {...r,status:1,leftMinutes:0,reservationMinutes:0};
}
export function fryerMatches(r:FryerSnapshot,c:FryerChange):boolean {
 if(c.operation==='start'){const wait=c.finishAt!==null?Math.max(0,Math.ceil((c.finishAt-r.fetchedAt)/60)-c.minutes):0;return r.mode===c.mode&&r.recipeId===`M${c.mode}`&&r.minutes===c.minutes&&r.temperature===c.temperature&&r.keepWarm===c.keepWarm&&(wait>1?r.status===3&&r.reservationMinutes!==null&&Math.abs(r.reservationMinutes-wait)<=1:c.finishAt!==null?r.status===3||fryerCooking(r.status):fryerCooking(r.status));}
 if(c.operation==='adjust')return r.minutes===c.minutes&&r.temperature===c.temperature&&r.keepWarm===c.keepWarm;
 return c.operation==='pause'?r.status===2:c.operation==='resume'?fryerCooking(r.status):!fryerActive(r.status);
}
export class FryerState {
 private state:ReportOperations<FryerSnapshot,FryerChange&{requestedAt:number}>;private tick?:ReturnType<typeof setInterval>;private zeroKey='';private clock?:FryerSnapshot;private clockIdentity='';private zeroReadAt=0;
 constructor(api:{read:(c:DeviceContext)=>Promise<FryerSnapshot>;change:(c:DeviceContext,baseline:string,change:FryerChange)=>Promise<{report:FryerSnapshot;confirmed:boolean}>},private changed:()=>void,failed:(e:AppError)=>void){
  this.state=new ReportOperations<FryerSnapshot,FryerChange&{requestedAt:number}>({read:api.read,send:(c,r,i)=>{const {requestedAt:_,...change}=i;return api.change(c,r.revision,change);},validate:(r,c)=>{if(r.did!==c.did||r.model!==fryerModel||!r.revision||!Number.isFinite(r.fetchedAt)||![r.minutes,r.temperature,r.leftMinutes,r.mode,r.status,r.fault].every(Number.isFinite))throw Error('炸锅状态与当前设备不匹配。');},key:i=>i.operation==='adjust'?'settings':'task',supersedes:i=>i.operation==='stop'?['settings']:[],project:(r,c)=>projectFryer(this.withClock(r),c,c.requestedAt),matches:fryerMatches,accepted:(_c,r)=>{this.clock=anchorFryerClock(this.clock,r);},interval:5000},changed,failed);
 }
 private withClock(r:FryerSnapshot):FryerSnapshot{return r.clockAt!==undefined||!this.clock||r.did!==this.clock.did||r.fetchedAt!==this.clock.fetchedAt||r.revision!==this.clock.revision?r:{...r,clockAt:this.clock.clockAt,clockSeconds:this.clock.clockSeconds,reservationFinishAt:this.clock.reservationFinishAt};}
 get report(){const r=this.state.report;return r?this.withClock(r):undefined;}get actual(){return this.state.actual;}get error(){return this.state.error;}get pending(){return this.state.pending;}get sending(){return this.state.sending;}get taskPending(){return this.state.intents.some(i=>i.operation!=='adjust');}get loading(){return this.state.loading;}
 bind(c:DeviceContext,scope:string){const identity=JSON.stringify([scope,c]);if(identity!==this.clockIdentity){this.clockIdentity=identity;this.clock=undefined;this.zeroKey='';}this.state.bind(c,scope);clearInterval(this.tick);this.tick=setInterval(()=>{const r=this.report;if(!r)return;const finish=fryerFinish(r);if(finish!==undefined&&finish<=Date.now()/1000){const key=`${r.revision}:${r.fetchedAt}`;if(this.zeroKey!==key&&Date.now()-this.zeroReadAt>=5000){this.zeroKey=key;this.zeroReadAt=Date.now();void this.read();}}this.changed();},1000);}
 close(){clearInterval(this.tick);this.tick=undefined;this.clock=undefined;this.state.close();}read(){return this.state.read();}
 change(c:FryerChange){return this.state.change({...c,requestedAt:Date.now()/1000});}
}
