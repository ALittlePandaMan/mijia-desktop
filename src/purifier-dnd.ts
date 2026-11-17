import type {AppError,DeviceContext} from './types';
import {DeviceOpening} from './device-opening';
import {ReportOperations} from './report-operations';
export interface PurifierDndReport {did:string;fetchedAt:number;current:boolean|null;enabled:boolean|null;allDay:boolean|null;startTime:string;endTime:string;revision:string;canEdit:boolean;reason:string|null;warnings:string[]}
export interface PurifierDndChange {revision:string;enabled:boolean;allDay:boolean;startTime:string;endTime:string}
export interface PurifierDndResult {verified:boolean;message:string;report:PurifierDndReport|null}
interface Transport {read:(c:DeviceContext)=>Promise<PurifierDndReport>;save:(c:DeviceContext,change:PurifierDndChange)=>Promise<PurifierDndResult>}
const identity=(c:DeviceContext)=>JSON.stringify([c.homeId,c.generation,c.did]);
export const validDndTime=(s:string):boolean=>/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const dndMatches=(r:PurifierDndReport,c:PurifierDndChange):boolean=>r.enabled===c.enabled&&(!c.enabled||r.allDay===c.allDay)&&r.current===(c.enabled&&c.allDay)&&r.startTime===c.startTime&&r.endTime===c.endTime;
/** Settings project immediately; current DND activity remains a device reading. */
export class PurifierDnd {
 private state:ReportOperations<PurifierDndReport,PurifierDndChange>;private context='';private clock=0;private localError?:AppError;
 picker:{kind:'start'|'end';hour:number;minute:number}|undefined;
 readonly opening=new DeviceOpening(()=>this.changed());
 constructor(transport:Transport,private changed:()=>void,failed:(e:AppError)=>void){this.state=new ReportOperations({read:transport.read,send:async(c,r,i)=>{const result=await transport.save(c,{...i,revision:r.revision});return{report:result.report??r,confirmed:result.verified};},validate:(r,c)=>{if(r.did!==c.did)throw Error('勿扰设置与当前设备不匹配。');},key:()=>'schedule',project:(r,i)=>({...r,enabled:i.enabled,allDay:i.allDay,startTime:i.startTime,endTime:i.endTime}),matches:dndMatches,allowed:r=>r.canEdit&&r.enabled!==null&&r.allDay!==null},changed,failed);}
 bind(c:DeviceContext,scope:string){this.context=identity(c);this.localError=undefined;this.state.bind(c,scope);}
 close(){this.context='';this.picker=undefined;this.localError=undefined;this.opening.cancel();this.state.close();}
 get report(){return this.state.report;}get actual(){return this.state.actual;}get error(){return this.localError??this.state.error;}get loading(){return this.state.loading;}
 get pending(){return this.state.pending;}get blocked(){return !!this.state.error;}get uncertain(){return this.state.uncertain;}get operationVersion(){return this.state.version+this.clock;}get message(){return this.state.message;}
 get canEdit(){return !!this.report?.canEdit&&!this.loading&&!this.error;}
 adopt(){this.state.adopt();}
 async read(c:DeviceContext){if(identity(c)!==this.context)return;this.localError=undefined;await this.state.read();}
 async save(c:DeviceContext,update:Partial<Omit<PurifierDndChange,'revision'>>):Promise<boolean>{const r=this.report;if(identity(c)!==this.context||!r||!this.canEdit||r.enabled===null||r.allDay===null)return false;const change:PurifierDndChange={revision:r.revision,enabled:r.enabled,allDay:r.allDay,startTime:r.startTime,endTime:r.endTime,...update};if(!validDndTime(change.startTime)||!validDndTime(change.endTime)||change.startTime===change.endTime){this.localError={kind:'invalid',message:'开始时间和结束时间不能相同。',retryable:true};this.changed();return false;}this.clock++;void this.state.change(change);return true;}
}
