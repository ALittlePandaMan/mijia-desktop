import type {AppError,DeviceContext} from './types';
import {normalizeError,sameContext} from './logic';
import {routerModel} from './router';
export interface InternetValues {mode:string;autoDns:boolean;dns1:string;dns2:string;account:string;password:string;ip:string;mask:string;gateway:string}
export interface InternetNetwork {ipv4:string;gateway4:string;ipv6:string[];gateway6:string}
export interface InternetReport {did:string;model:string;revision:string;values:InternetValues;networks:InternetNetwork[];moreInfo:boolean;ipv6Mode:string|null;ipv6Supported?:boolean;portAuto:boolean|null;portVisible:boolean;dualWan:boolean|null;localAvailable:boolean;writeReason:string|null;warnings:string[]}
export interface InternetChange {baseline:string;values:InternetValues}
export interface InternetRead {report:InternetReport;pending:InternetChange|null}
export interface InternetOutcome {status:'confirmed'|'uncertain';report:InternetReport|null;message:string}
export const internetLabels:Record<string,string>={dhcp:'动态IP上网',pppoe:'宽带上网',static:'静态IP上网',wire:'有线中继',wifi:'无线中继',l2tp:'L2TP',pptp:'PPTP',dslite:'DS-Lite',v6plus:'V6 Plus',ocn:'MAP-E (OCN)'};
export function emptyInternet(mode:string):InternetValues{return{mode,autoDns:mode!=='static',dns1:'',dns2:'',account:'',password:'',ip:'',mask:'',gateway:''};}
export function internetMatches(a:InternetValues,b:InternetValues):boolean{
 if(a.mode!==b.mode)return false;
 if(b.mode==='dhcp')return a.autoDns===b.autoDns&&(b.autoDns||a.dns1===b.dns1&&a.dns2===b.dns2);
 if(b.mode==='pppoe')return a.account===b.account.trim()&&a.password===b.password;
 if(b.mode==='static')return a.ip===b.ip&&a.mask===b.mask&&a.gateway===b.gateway&&a.dns1===b.dns1&&a.dns2===b.dns2;
 return false;
}
const ipv4=(s:string)=>/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(s)&&s.split('.').every(v=>Number(v)<=255);
export function internetProblem(v:InternetValues):string|undefined{
 if(!['dhcp','pppoe','static'].includes(v.mode))return'不支持此上网模式。';
 if([v.dns1,v.dns2,v.account,v.password,v.ip,v.mask,v.gateway].some(s=>s.length>1024||/[\x00-\x1f\x7f]/.test(s)))return'上网设置包含无效输入。';
 if(v.mode==='pppoe'){if(!v.account.trim()||!v.password)return'请输入宽带账号和密码。';return;}
 if(v.mode==='static'&&![v.ip,v.mask,v.gateway].every(ipv4))return'IP地址、子网掩码或网关不合法。';
 if(v.mode==='static'||!v.autoDns){if(!ipv4(v.dns1))return'DNS1为空或不合法。';if(v.dns2&&!ipv4(v.dns2))return'DNS2不合法。';}
}
interface Transport {read:(c:DeviceContext)=>Promise<InternetRead>;save:(c:DeviceContext,v:InternetChange)=>Promise<InternetOutcome>;confirm:(c:DeviceContext,v:InternetChange)=>Promise<InternetOutcome>}
export class RouterInternetState {
 report?:InternetReport;draft?:InternetValues;editor?:string;networkInfo=false;picker?:'mode'|'dns';notice='';message='';loading=false;pending=false;blocked=false;confirming=false;success=false;passwordVisible=false;error?:AppError;
 private context?:DeviceContext;private scope='';private epoch=0;private unresolved?:InternetChange;private timer?:ReturnType<typeof setTimeout>;
 constructor(private api:Transport,private changed:()=>void,private failed:(e:AppError)=>void){}
 bind(c:DeviceContext,scope:string):void{if(!sameContext(c,this.context)||scope!==this.scope){this.close();this.context={...c};this.scope=scope;}}
 close():void{++this.epoch;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.context=undefined;this.report=undefined;this.draft=undefined;this.editor=undefined;this.networkInfo=false;this.picker=undefined;this.notice='';this.message='';this.loading=false;this.pending=false;this.blocked=false;this.confirming=false;this.success=false;this.passwordVisible=false;this.error=undefined;this.unresolved=undefined;}
 get canEdit():boolean{return !!this.report&&this.report.localAvailable&&!this.report.writeReason&&!this.loading&&!this.pending&&!this.blocked&&!this.success;}
 get dirty():boolean{return !!this.draft&&!!this.report&&!internetMatches(this.report.values,this.draft);}
 get modalOpen():boolean{return !!this.picker||this.confirming||this.success;}
 open(mode:string):void{
  if(!this.report||this.pending||this.blocked)return;
  if(!this.canEdit){this.notice=this.report.writeReason||'请连接当前路由器的网络后再进行设置。';this.changed();return;}
  if(!['dhcp','pppoe','static'].includes(mode)){this.notice='此上网模式的设置页面尚未适配。';this.changed();return;}
  this.editor=mode;this.draft=mode===this.report.values.mode?{...this.report.values}:emptyInternet(mode);this.picker=undefined;this.passwordVisible=false;this.message='';this.changed();
 }
 switchMode():void{if(!this.canEdit){this.open(this.report?.values.mode??'dhcp');return;}this.picker='mode';this.changed();}
 edit(field:keyof InternetValues,value:string|boolean):void{if(!this.canEdit||!this.draft||field==='mode')return;Object.assign(this.draft,{[field]:typeof value==='string'&&field!=='password'?value.trim():value});this.message='';}
 autoDns(auto:boolean):void{this.edit('autoDns',auto);this.picker=undefined;this.changed();}
 back():boolean{if(this.confirming){this.confirming=false;}else if(this.success){this.success=false;this.editor=undefined;this.draft=undefined;}else if(this.notice){this.notice='';}else if(this.picker){this.picker=undefined;}else if(this.editor){this.editor=undefined;this.draft=undefined;this.message='';}else if(this.networkInfo){this.networkInfo=false;}else return false;this.changed();return true;}
 private valid(r:InternetReport,c:DeviceContext):void{if(r.did!==c.did||r.model!==routerModel||!/^[a-f0-9]{64}$/.test(r.revision)||!r.values||!Array.isArray(r.networks))throw{kind:'protocol',message:'上网设置与当前路由器不匹配。',retryable:false};}
 async read(c:DeviceContext):Promise<void>{
  if(this.loading||this.pending||!sameContext(c,this.context))return;const epoch=this.epoch,current=()=>epoch===this.epoch&&sameContext(c,this.context);this.loading=true;this.changed();
  try{const r=await this.api.read({...c});if(!current())return;this.valid(r.report,c);this.report=r.report;this.unresolved=r.pending??undefined;this.blocked=!!this.unresolved;this.error=undefined;this.message=r.pending?'上次上网设置尚未确认，正在查询实际状态。':'';}
  catch(e){if(current()){this.error=normalizeError(e);this.failed(this.error);}}
  finally{if(current()){this.loading=false;this.changed();if(this.unresolved)this.schedule(c);}}
 }
 async save(c:DeviceContext,confirmed=false):Promise<void>{
  if(!this.canEdit||!this.report||!this.draft||!sameContext(c,this.context))return;
  if(!this.dirty){this.back();return;}const problem=internetProblem(this.draft);if(problem){this.message=problem;this.changed();return;}
  if(!confirmed){this.confirming=true;this.changed();return;}
  this.confirming=false;this.unresolved={baseline:this.report.revision,values:{...this.draft}};await this.submit(c,this.unresolved,false);
 }
 private async submit(c:DeviceContext,change:InternetChange,query:boolean):Promise<void>{
  if(!sameContext(c,this.context))return;const epoch=this.epoch,current=()=>epoch===this.epoch&&sameContext(c,this.context);this.pending=true;this.blocked=true;this.changed();
  try{const r=await(query?this.api.confirm({...c},change):this.api.save({...c},change));if(!current())return;if(r.report){this.valid(r.report,c);this.report=r.report;}this.error=undefined;this.message=r.message;
   if(r.status==='confirmed'&&r.report&&internetMatches(r.report.values,change.values)){this.unresolved=undefined;this.draft={...r.report.values};this.blocked=false;this.success=true;}
  }catch(e){if(!current())return;this.error=normalizeError(e);this.failed(this.error);this.message=this.error.message;if(!['network','protocol','busy','offline','staleContext'].includes(this.error.kind)){this.unresolved=undefined;this.blocked=this.error.kind==='conflict';}}
  finally{if(current()){this.pending=false;this.changed();if(this.unresolved)this.schedule(c);}}
 }
 private schedule(c:DeviceContext):void{if(this.timer)clearTimeout(this.timer);const epoch=this.epoch;this.timer=setTimeout(()=>{this.timer=undefined;if(epoch===this.epoch&&sameContext(c,this.context)&&this.unresolved&&!this.pending)void this.submit(c,this.unresolved,true);},5000);}
}
