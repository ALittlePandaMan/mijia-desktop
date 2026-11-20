import type {AppError,ControlResult,DeviceContext,DevicePanel,Property} from './types';
import {DeviceOpening} from './device-opening';
import {ReportOperations,panelReadback,panelDisplay} from './report-operations';
import {PositionMotion} from './position-motion';
export const airerModel='hyd.airer.1s';
export type AirerIntent='up'|'pause'|'down';
export interface AirerLiftChange {intent:AirerIntent;expectedStatus:number}
export interface AirerNight {enabled:boolean;startHour:number;startMinute:number;endHour:number;endMinute:number;brightness:number}
export interface AirerNightChange {expected:AirerNight;target:AirerNight}
export interface AirerView {page:'home'|'night'|'compatibility';draft?:AirerNightChange;picker?:{kind:'start'|'end';hour:number;minute:number}}
export function airerProperty(p:DevicePanel,siid:number,piid:number,name:string,format:string):Property|undefined{if(p.model!==airerModel||p.unsupportedReason)return;const rows=p.services.flatMap(s=>s.siid===siid?s.properties:[]).filter(p=>p.siid===siid&&p.piid===piid&&p.name===name&&p.format===format&&!p.unsupportedReason);return rows.length===1?rows[0]:undefined;}
export function airerNumber(p:DevicePanel,siid:number,piid:number,name:string,format='uint8'):number|undefined{const v=airerProperty(p,siid,piid,name,format);return v?.code===0&&v.access.includes('read')&&typeof v.value==='number'&&Number.isInteger(v.value)?v.value:undefined;}
export function airerStatus(p:DevicePanel):number|undefined{const v=airerNumber(p,2,4,'status');return v!==undefined&&v>=0&&v<=4?v:undefined;}
export function airerProfile(p:DevicePanel):boolean{return !!airerProperty(p,2,2,'motor-control','uint8')&&p.services.some(s=>s.siid===2&&s.name==='airer');}
export function airerNight(p:DevicePanel):AirerNight|undefined{const raw=['start-time-hour','start-time-min','end-time-hour','end-time-min','nightlight-switch','brightness'].map((name,i)=>airerNumber(p,4,i+1,name));if(raw.some(v=>v===undefined))return;const[sh,sm,eh,em,on,brightness]=raw as number[];if(sh<0||sh>23||eh<0||eh>23||sm<0||sm>59||em<0||em>59||on<0||on>1||brightness<1||brightness>100)return;return{enabled:on===1,startHour:sh,startMinute:sm,endHour:eh,endMinute:em,brightness};}
export function airerNightReason(n:AirerNight):string|undefined{const start=n.startHour*60+n.startMinute,end=n.endHour*60+n.endMinute;if(![n.startHour,n.startMinute,n.endHour,n.endMinute,n.brightness].every(Number.isInteger)||n.startHour<17||n.startHour>23||!(n.endHour>=17&&n.endHour<=23||n.endHour>=0&&n.endHour<=8)||n.startMinute<0||n.startMinute>59||n.endMinute<0||n.endMinute>59||n.endHour===8&&n.endMinute!==0||n.brightness<1||n.brightness>100)return'请选择17:00以后开始、当晚或次日08:00以前结束的有效时段。';if(n.enabled&&(start===end||n.endHour>=17&&start>end))return'开始时间应早于结束时间，且不能相同。';}
export function airerLiftReason(p:DevicePanel,intent:AirerIntent):string|undefined{
 const motor=airerProperty(p,2,2,'motor-control','uint8'),target=intent==='up'?1:intent==='down'?2:0;
 if(!motor?.access.includes('write')||motor.valueList&&!motor.valueList.some(v=>v.value===target))return'此型号的升降绑定尚未确认。';
 if(airerStatus(p)===undefined)return'请先读取当前升降状态。';
 if(intent==='pause')return;
 const position=airerNumber(p,4,11,'current-position'),upper=airerNumber(p,4,7,'upper-limit','int8'),lower=airerNumber(p,4,8,'lower-limit');
 if(position===undefined||position<0||position>100||upper===undefined||upper<0||upper>49||lower===undefined||lower<51||lower>100)return'请先读取晾杆位置与上下限位。';
}
export function airerLiftMatches(p:DevicePanel,intent:AirerIntent):boolean{
 const s=airerStatus(p);
 if(intent==='pause')return s===0||s===3||s===4;
 if(intent==='up'&&s===1||intent==='down'&&s===2)return true;
 const position=airerNumber(p,4,11,'current-position');
 if(position===undefined||position<0||position>100)return false;
 const upper=airerNumber(p,4,7,'upper-limit','int8'),lower=airerNumber(p,4,8,'lower-limit');
 return intent==='up'?s===0&&upper!==undefined&&upper>=0&&upper<=49&&position<=upper:s===4&&lower!==undefined&&lower>=51&&lower<=100&&position>=lower;
}
const sameNight=(a:AirerNight|undefined,b:AirerNight)=>!!a&&Object.keys(b).every(key=>a[key as keyof AirerNight]===b[key as keyof AirerNight]);
const id=(c:DeviceContext)=>JSON.stringify([c.homeId,c.generation,c.did]);
interface Transport {lift:(c:DeviceContext,change:AirerLiftChange)=>Promise<ControlResult>;night:(c:DeviceContext,change:AirerNightChange)=>Promise<ControlResult>;read:(c:DeviceContext)=>Promise<DevicePanel>}
// No travel-time property is exposed by this model; this duration belongs only to the illustration.
const previewJourneySeconds=8;
type AirerChange={kind:'lift';change:AirerLiftChange}|{kind:'night';change:AirerNightChange};
export class AirerCommands{
 private state:ReportOperations<DevicePanel,AirerChange>;private context='';private lastPanel?:DevicePanel;private motionPanel?:DevicePanel;private motionKey='';private localIntent?:AirerIntent;private verifying=false;readonly motion=new PositionMotion();readonly opening=new DeviceOpening(()=>this.changed());
 constructor(transport:Transport,private changed:()=>void,accept:(c:DeviceContext,p:DevicePanel)=>void,failed:(e:AppError)=>void){this.state=new ReportOperations({read:transport.read,accepted:accept,send:async(c,r,i)=>{let result:ControlResult;if(i.kind==='lift'){const status=airerStatus(r);if(status===undefined)throw{kind:'unavailable',message:'晾衣机状态尚未读取。'};result=await transport.lift(c,{...i.change,expectedStatus:status});}else{const actual=airerNight(r);if(!actual)throw{kind:'unavailable',message:'夜灯设置尚未读取。'};result=await transport.night(c,{...i.change,expected:actual});}return{report:result.panel,confirmed:result.verified};},validate:(p,c)=>{if(p.did!==c.did||!airerProfile(p))throw Error('回读与当前晾衣机不匹配。');},key:i=>i.kind,project:(r,i)=>{if(i.kind==='lift')return r;const n=i.change.target,values=[n.startHour,n.startMinute,n.endHour,n.endMinute,n.enabled?1:0,n.brightness];return{...r,services:r.services.map(s=>s.siid===4?{...s,properties:s.properties.map(p=>p.piid>=1&&p.piid<=6?{...p,value:values[p.piid-1]}:p)}:s)};},matches:(r,i)=>i.kind==='lift'?airerLiftMatches(r,i.change.intent):sameNight(airerNight(r),i.change.target)},()=>{this.observeMotion();changed();},failed);}
 get version(){return this.state.version;}get pending(){return this.state.pending;}get blocked(){return !this.state.actual&&!!this.state.error;}get uncertain(){return this.state.uncertain;}get pendingIntent(){const i=this.state.intents.find(i=>i.kind==='lift');return this.localIntent??(i?.kind==='lift'?i.change.intent:undefined);}
 get message(){return this.pendingIntent?({up:'正在上升…',down:'正在下降…',pause:'正在暂停…'}as const)[this.pendingIntent]:this.state.message;}
 bind(c:DeviceContext,scope:string){const key=JSON.stringify([scope,c.homeId,c.generation,c.did]);if(this.context===id(c)&&this.motionKey===key)return;this.context=id(c);if(key!==this.motionKey){this.motion.reset();this.localIntent=undefined;this.motionKey=key;}this.state.bind(c,scope);if(this.state.actual)void this.state.read();}close(){this.context='';this.state.close();this.motion.detach();this.opening.cancel();this.lastPanel=undefined;}
 display(p:DevicePanel){if(p!==this.lastPanel){this.lastPanel=p;this.state.seed(panelReadback(p));}this.observeMotion();const view=panelDisplay(this.state.report??p,p);return{...view,services:view.services.map(s=>s.siid===3?(p.services.find(q=>q.siid===3)??s):s)};}
 private observeMotion(){const p=this.state.actual;if(!p)return;const fresh=p!==this.motionPanel;this.motionPanel=p;const position=airerNumber(p,4,11,'current-position'),status=airerStatus(p),operation=this.state.operation('lift');if(this.localIntent&&operation?.outcome==='rejected'&&!operation.pending){if(position!==undefined)this.motion.reconcile(position,true);this.localIntent=undefined;}else if(this.localIntent&&(fresh||operation?.outcome==='confirmed')&&!this.motion.moving&&!operation?.pending&&status!==1&&status!==2&&position!==undefined){this.localIntent=undefined;this.motion.reconcile(position);}this.motion.update(this.motionKey,{position,status,target:status===1?airerNumber(p,4,7,'upper-limit','int8'):status===2?airerNumber(p,4,8,'lower-limit'):position,journey:previewJourneySeconds});}
 async verifyMotion(){if(this.verifying||!this.context||!this.localIntent||this.motion.moving)return;const context=this.context,generation=this.motion.generation;this.verifying=true;try{await this.state.read();if(context!==this.context||generation!==this.motion.generation||this.motion.moving)return;const p=this.state.actual,status=p&&airerStatus(p),position=p&&airerNumber(p,4,11,'current-position');if(position!==undefined&&status!==1&&status!==2&&(!this.state.operation('lift')?.pending||p&&this.localIntent&&airerLiftMatches(p,this.localIntent))){this.localIntent=undefined;this.motion.reconcile(position);this.changed();}}finally{this.verifying=false;}}
 adopt(){this.state.adopt();this.changed();}
 async lift(c:DeviceContext,change:AirerLiftChange):Promise<boolean>{if(id(c)!==this.context)return false;const copy={...change};if(!this.state.actual)await this.state.read();if(id(c)!==this.context||!this.state.actual||airerLiftReason(this.state.actual,copy.intent))return false;const p=this.state.actual;if(this.localIntent!==copy.intent||!this.motion.local){if(copy.intent==='pause')this.motion.pause();else this.motion.start(this.motionKey,{position:airerNumber(p,4,11,'current-position'),target:copy.intent==='up'?airerNumber(p,4,7,'upper-limit','int8'):airerNumber(p,4,8,'lower-limit'),journey:previewJourneySeconds});this.localIntent=copy.intent;}void this.state.change({kind:'lift',change:copy});return true;}
 async night(c:DeviceContext,change:AirerNightChange):Promise<boolean>{if(id(c)!==this.context)return false;const copy=structuredClone(change);if(!this.state.actual)await this.state.read();void this.state.change({kind:'night',change:copy});return true;}
 async refresh(c:DeviceContext):Promise<boolean>{if(id(c)!==this.context)return false;await this.state.read();return !this.state.error;}
}
