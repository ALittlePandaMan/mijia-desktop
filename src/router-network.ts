import type {AppError,DeviceContext} from './types';
import {normalizeError,sameContext} from './logic';
import {routerModel} from './router';
export type NetworkKind='ports'|'ipv6';
export interface PortValues {auto:boolean;wanPort:number}
export interface Ipv6Values {mode:string;autoDns:boolean;dns1:string;dns2:string;autoSync:boolean;account:string;password:string}
export type NetworkValues={kind:'ports';value:PortValues}|{kind:'ipv6';value:Ipv6Values};
export interface NetworkPort {id:number;index:string;label:string;speed:string;service:string;selectable:boolean}
export interface NetworkReport {did:string;model:string;revision:string;values:NetworkValues;ports:NetworkPort[];modes:string[];localAvailable:boolean;offWarning:boolean;writeReason:string|null}
export interface NetworkChange {baseline:string;values:NetworkValues}
export interface NetworkPending {id:string;change:NetworkChange;feedbackRequired:boolean}
export interface NetworkRead {report:NetworkReport;pending:NetworkPending|null;externalPending:boolean}
export interface NetworkOutcome {status:'confirmed'|'uncertain'|'feedbackRequired';report:NetworkReport|null;message:string;feedbackId:string|null}
export const ipv6Labels:Record<string,string>={native:'自动',pi_relay:'Passthrough',off:'不启用',dhcpv6:'DHCPv6',pppoev6:'PPPoEv6'};
const copy=<T>(v:T):T=>structuredClone(v);
const sameIp=(a:string,b:string)=>{const x=normalizedIpv6(a);return !!x&&x===normalizedIpv6(b);};
export function normalizedIpv6(value:string):string|undefined{try{if(!value||!value.includes(':')||/[\[\]\/\s%]/.test(value))return;return new URL('http://['+value+']/').hostname;}catch{return;}}
export function networkMatches(a:NetworkValues,b:NetworkValues):boolean{
 if(a.kind==='ports'&&b.kind==='ports')return a.value.auto===b.value.auto&&(b.value.auto||a.value.wanPort===b.value.wanPort);
 if(a.kind!=='ipv6'||b.kind!=='ipv6')return false;const x=a.value,y=b.value;
 return x.mode===y.mode&&(!['dhcpv6','pppoev6'].includes(y.mode)||x.autoDns===y.autoDns&&(y.autoDns||sameIp(x.dns1,y.dns1)&&(x.dns2===''&&y.dns2===''||sameIp(x.dns2,y.dns2))))&&(y.mode!=='pppoev6'||x.autoSync===y.autoSync&&(y.autoSync||x.account===y.account&&x.password===y.password));
}
export function networkProblem(r:NetworkReport,v:NetworkValues):string|undefined{
 if(v.kind!==r.values.kind)return'网络设置类型与当前页面不匹配。';
 if(v.kind==='ports'){if(!v.value.auto&&!r.ports.some(p=>p.id===v.value.wanPort&&p.selectable))return'此网口被其他服务占用，不能设为WAN口。';return;}
 const d=v.value;if(!r.modes.includes(d.mode))return'当前能力未提供此IPv6类型。';
 if([d.dns1,d.dns2,d.account,d.password].some(s=>s.length>1024||/[\x00-\x1f\x7f]/.test(s)))return'IPv6输入无效。';
 if(['dhcpv6','pppoev6'].includes(d.mode)&&!d.autoDns){if(!normalizedIpv6(d.dns1))return'主DNS不能为空且须为IPv6地址。';if(d.dns2&&!normalizedIpv6(d.dns2))return'次DNS须为IPv6地址。';}
 if(d.mode==='pppoev6'&&!d.autoSync&&(!d.account.trim()||!d.password))return'请输入IPv6宽带账号和密码。';
}
interface Transport {read:(c:DeviceContext,kind:NetworkKind)=>Promise<NetworkRead>;save:(c:DeviceContext,v:NetworkChange)=>Promise<NetworkOutcome>;confirm:(c:DeviceContext,v:NetworkChange)=>Promise<NetworkOutcome>;ack:(c:DeviceContext,id:string)=>Promise<NetworkRead>}
export class RouterNetworkState {
 kind:NetworkKind='ports';report?:NetworkReport;draft?:NetworkValues;loading=false;pending=false;blocked=false;confirming=false;picker=false;selectedMode='';feedbackId?:string;feedbackOpen=false;message='';error?:AppError;private previousAuto=false;
 private context?:DeviceContext;private scope='';private epoch=0;private unresolved?:NetworkChange;private external=false;private timer?:ReturnType<typeof setTimeout>;
 constructor(private api:Transport,private changed:()=>void,private failed:(e:AppError)=>void){}
 bind(c:DeviceContext,scope:string,kind:NetworkKind):void{if(!sameContext(c,this.context)||scope!==this.scope||this.kind!==kind){this.close();this.context={...c};this.scope=scope;this.kind=kind;}}
 close():void{++this.epoch;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.context=undefined;this.report=undefined;this.draft=undefined;this.unresolved=undefined;this.external=false;this.loading=false;this.pending=false;this.blocked=false;this.confirming=false;this.picker=false;this.feedbackId=undefined;this.feedbackOpen=false;this.message='';this.error=undefined;}
 get canEdit():boolean{return !!this.report&&!!this.draft&&!this.report.writeReason&&!this.loading&&!this.pending&&!this.blocked;}
 get dirty():boolean{return !!this.report&&!!this.draft&&!networkMatches(this.report.values,this.draft);}
 get modalOpen():boolean{return this.picker||this.confirming||this.feedbackOpen;}
 openPicker():void{if(!this.canEdit||!this.draft)return;this.picker=true;if(this.draft.kind==='ports')this.previousAuto=this.draft.value.auto;else this.selectedMode=this.draft.value.mode;this.changed();}
 choosePortMode(auto:boolean):void{if(!this.canEdit||this.draft?.kind!=='ports'||this.report?.values.kind!=='ports')return;this.draft.value.auto=auto;this.draft.value.wanPort=this.report.values.value.wanPort;this.picker=false;this.message='';if(auto&&!this.report.values.value.auto)this.confirming=true;this.changed();}
 choosePort(id:number):void{if(!this.canEdit||this.draft?.kind!=='ports'||this.draft.value.auto||!this.report?.ports.some(p=>p.id===id&&p.selectable))return;this.draft.value.wanPort=id;this.message='';this.changed();}
 chooseIpv6():void{if(!this.canEdit||this.draft?.kind!=='ipv6'||!this.report?.modes.includes(this.selectedMode))return;this.draft.value.mode=this.selectedMode;this.picker=false;this.message='';this.changed();}
 editIpv6(field:keyof Ipv6Values,value:string|boolean):void{if(!this.canEdit||this.draft?.kind!=='ipv6'||field==='mode')return;Object.assign(this.draft.value,{[field]:typeof value==='string'&&field!=='password'?value.trim():value});this.message='';}
 toggleIpv6(field:'autoDns'|'autoSync'):void{if(this.draft?.kind!=='ipv6')return;this.editIpv6(field,!this.draft.value[field]);this.changed();}
 cancel():void{if(this.confirming&&this.draft?.kind==='ports'){this.draft.value.auto=this.previousAuto;if(this.previousAuto&&this.report?.values.kind==='ports')this.draft.value.wanPort=this.report.values.value.wanPort;}this.confirming=false;this.picker=false;this.feedbackOpen=false;this.changed();}
 private valid(r:NetworkReport,c:DeviceContext):void{if(r.did!==c.did||r.model!==routerModel||r.values.kind!==this.kind||!/^[a-f0-9]{64}$/.test(r.revision))throw{kind:'protocol',message:'网络设置与当前路由器不匹配。',retryable:false};}
 async read(c:DeviceContext):Promise<void>{
  if(this.loading||this.pending||!sameContext(c,this.context))return;const epoch=this.epoch,current=()=>epoch===this.epoch&&sameContext(c,this.context);this.loading=true;this.changed();
  try{const r=await this.api.read({...c},this.kind);if(!current())return;this.valid(r.report,c);this.report=r.report;this.unresolved=r.pending?.change;this.external=r.externalPending;this.blocked=!!r.pending||r.externalPending;this.feedbackId=r.pending?.feedbackRequired?r.pending.id:undefined;this.feedbackOpen=!!this.feedbackId;this.draft=copy(r.pending?.change.values??r.report.values);this.error=undefined;this.message=this.feedbackId?'IPv6主配置已回读，局域网IPv6参数无法独立回读，请核实终端IPv6网络效果。':r.pending?'上次网络设置尚未确认，正在查询实际状态。':r.externalPending?'另一项网络设置仍未确认，请先返回原页面核实。':'';}
  catch(e){if(current()){this.error=normalizeError(e);this.failed(this.error);}}
  finally{if(current()){this.loading=false;this.changed();if(!this.feedbackId&&(this.unresolved||this.external))this.schedule(c);}}
 }
 async save(c:DeviceContext,confirmed=false):Promise<boolean>{
  if(!this.canEdit||!this.report||!this.draft||!sameContext(c,this.context))return false;if(!this.dirty)return true;
  const problem=networkProblem(this.report,this.draft);if(problem){this.message=problem;this.changed();return false;}
  if(!confirmed&&(this.kind==='ports'||this.draft.kind==='ipv6'&&this.draft.value.mode==='off'&&this.report.offWarning)){this.confirming=true;this.changed();return false;}
  this.confirming=false;this.unresolved={baseline:this.report.revision,values:copy(this.draft)};return this.submit(c,this.unresolved,false);
 }
 private async submit(c:DeviceContext,change:NetworkChange,query:boolean):Promise<boolean>{
  const epoch=this.epoch,current=()=>epoch===this.epoch&&sameContext(c,this.context);this.pending=true;this.blocked=true;this.changed();
  try{const r=await(query?this.api.confirm({...c},change):this.api.save({...c},change));if(!current())return false;if(r.report){this.valid(r.report,c);this.report=r.report;}this.error=undefined;this.message=r.message;
   if(r.status==='confirmed'&&r.report&&networkMatches(r.report.values,change.values)){this.unresolved=undefined;this.draft=copy(r.report.values);this.blocked=false;return true;}
   if(r.status==='feedbackRequired'&&r.report&&r.feedbackId&&networkMatches(r.report.values,change.values)){this.feedbackId=r.feedbackId;this.feedbackOpen=true;}
  }catch(e){if(!current())return false;this.error=normalizeError(e);this.failed(this.error);this.message=this.error.message;if(!['network','protocol','busy','offline','staleContext'].includes(this.error.kind)){this.unresolved=undefined;this.blocked=this.error.kind==='conflict';}}
  finally{if(current()){this.pending=false;this.changed();if(this.unresolved&&!this.feedbackId)this.schedule(c);}}
  return false;
 }
 async acknowledge(c:DeviceContext):Promise<boolean>{
  if(!this.feedbackId||this.pending||!sameContext(c,this.context))return false;const epoch=this.epoch;this.pending=true;this.changed();
  try{const r=await this.api.ack({...c},this.feedbackId);if(epoch!==this.epoch||!sameContext(c,this.context))return false;this.valid(r.report,c);if(r.pending||r.externalPending||!this.unresolved||!networkMatches(r.report.values,this.unresolved.values))return false;this.report=r.report;this.draft=copy(r.report.values);this.feedbackId=undefined;this.feedbackOpen=false;this.unresolved=undefined;this.blocked=false;this.message='已结束本次终端反馈核实。';return true;}
  catch(e){if(epoch===this.epoch){this.error=normalizeError(e);this.failed(this.error);}}
  finally{if(epoch===this.epoch){this.pending=false;this.changed();}}return false;
 }
 private schedule(c:DeviceContext):void{if(this.timer)clearTimeout(this.timer);const epoch=this.epoch;this.timer=setTimeout(()=>{this.timer=undefined;if(epoch!==this.epoch||!sameContext(c,this.context)||this.pending)return;if(this.unresolved)void this.submit(c,this.unresolved,true);else if(this.external)void this.read(c);},5000);}
}
