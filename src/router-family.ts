import type {AppError,DeviceContext} from './types';import {normalizeError,sameContext} from './logic';import {routerModel} from './router';
export type FamilyId=string|number;
export interface FamilyTime {id:FamilyId|null;start:number;end:number;enable:number[];deleted:boolean}
export interface FamilyApp {name:string;enable:boolean}
export interface FamilyCategory {className:string;enable:boolean;timeQuota:number;apps:FamilyApp[]}
export interface FamilyUser {userId:FamilyId;name:string;icon:string;devices:string[]}
export interface FamilyProfile {user:FamilyUser;times:FamilyTime[];urls:string[];apps:FamilyCategory[]}
export interface FamilyClient {mac:string;name:string;online:boolean|null;connection:number|null;icon:string|null;owner:FamilyId|null;ownerName:string|null;eventTime?:number|null}
export interface FamilyReport {did:string;model:string;mac:string;revision:string;supported:boolean;writeReason:string|null;users:FamilyUser[];current:FamilyProfile|null;clients:FamilyClient[];apps:FamilyCategory[];labels:Record<string,string>;icons:Record<string,string>}
export interface FamilyDraft {userId:FamilyId|null;name:string;icon:string;devices:string[];times:FamilyTime[];urls:string[];apps:FamilyCategory[]}
export type FamilyOperation={kind:'save';draft:FamilyDraft}|{kind:'delete';userId:FamilyId};
export interface FamilyChange {baseline:string;mac:string;operation:FamilyOperation}
export interface FamilyRead {report:FamilyReport;pending:FamilyChange|null}
export interface FamilyOutcome {status:'confirmed'|'uncertain';message:string;report:FamilyReport|null}
interface Transport {read:(c:DeviceContext,mac:string)=>Promise<FamilyRead>;save:(c:DeviceContext,u:FamilyChange)=>Promise<FamilyOutcome>;confirm:(c:DeviceContext,u:FamilyChange)=>Promise<FamilyOutcome>}
export const familyNames=['儿子','女儿','爸爸','妈妈','爷爷','奶奶','姥爷','姥姥','哥哥','姐姐','保姆'];
export const familyDays=['周一','周二','周三','周四','周五','周六','周日'];
export function familyNameValid(name:string):boolean{let n=0;for(let i=0;i<name.length;i++){const c=name.charCodeAt(i);n+=c>=1&&c<=0x7e||c>=0xff60&&c<=0xff9f?1:2;}return !!name.trim()&&n<=12&&!/[\x00-\x1f\x7f]/.test(name);}
export function familyUrlValid(s:string):boolean{return !!s&&s.length<=512&&/^[\x21-\x7e]+$/.test(s)&&!/-|_|!|@|#|\$|%|\^|&|\*|\(|\)|\+|=|<|>|\?|\/|\\|\||~|`|"|'|\{|\}|\[|\]/.test(s);}
export function familyTime(start:number,end:number,days:number[]):FamilyTime{return{id:null,start,end:end<=start?end+1440:end,enable:Array.from({length:7},(_,i)=>days.includes(i)?1:0),deleted:false};}
export function familyClock(minutes:number):string{const value=minutes%1440;return`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;}
export function familyRange(t:FamilyTime):string{return`${familyClock(t.start)} - ${t.end>=1440?'次日':''}${familyClock(t.end)}`;}
const sameId=(a:FamilyId|null|undefined,b:FamilyId|null|undefined)=>a!=null&&b!=null&&String(a)===String(b);
const sameList=(a:string[],b:string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
function sameConfig(p:FamilyProfile,d:FamilyDraft):boolean{const times=(a:FamilyTime[])=>a.filter(t=>!t.deleted).map(t=>JSON.stringify([t.start,t.end,t.enable])).sort(),apps=(a:FamilyCategory[])=>a.map(c=>JSON.stringify([c.className,c.enable,c.timeQuota,c.apps.map(a=>JSON.stringify([a.name,a.enable])).sort()])).sort();return p.user.name===d.name&&p.user.icon===d.icon&&sameList(p.user.devices.map(s=>s.toLowerCase()),d.devices.map(s=>s.toLowerCase()))&&sameList(p.urls,d.urls)&&sameList(times(p.times),times(d.times))&&sameList(apps(p.apps),apps(d.apps));}
export function familyMatches(r:FamilyReport,u:FamilyChange):boolean{if(!r.supported||r.writeReason||r.mac.toLowerCase()!==u.mac.toLowerCase())return false;const op=u.operation;return op.kind==='delete'?!r.users.some(v=>sameId(v.userId,op.userId)):!!r.current&&(op.draft.userId===null||sameId(r.current.user.userId,op.draft.userId))&&sameConfig(r.current,op.draft);}
export type FamilyView='main'|'devices'|'names'|'time'|'apps';
export type FamilyModal={kind:'name';icon:string;value:string}|{kind:'url';value:string}|{kind:'repeat';value:number[]}|{kind:'clock';which:'start'|'end';hour:number;minute:number}|{kind:'quota';index:number;value:number}|{kind:'removeTime';index:number}|{kind:'delete'}|{kind:'more'};
export class RouterFamilyState {
 report?:FamilyReport;draft?:FamilyDraft;error?:AppError;message='';loading=false;pending=false;blocked=false;view:FamilyView='main';modal?:FamilyModal;selectedDevices=new Set<string>();appsDraft?:FamilyCategory[];expanded=new Set<string>();timeDraft?:{index:number|null;value:FamilyTime};
 private epoch=0;private context?:DeviceContext;private scope='';private mac='';private baseline='';private unresolved?:FamilyChange;private timer?:ReturnType<typeof setTimeout>;
 constructor(private api:Transport,private changed:()=>void,private failed:(e:AppError)=>void,private accepted:()=>void=()=>{}){}
 bind(c:DeviceContext,scope:string,mac:string):void{if(!sameContext(c,this.context)||scope!==this.scope||mac.toLowerCase()!==this.mac.toLowerCase()){this.close();this.context={...c};this.scope=scope;this.mac=mac;}}
 close():void{++this.epoch;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.context=undefined;this.report=this.draft=undefined;this.error=undefined;this.message='';this.loading=this.pending=this.blocked=false;this.view='main';this.modal=undefined;this.selectedDevices.clear();this.appsDraft=undefined;this.timeDraft=undefined;this.expanded.clear();this.baseline='';this.unresolved=undefined;}
 get canEdit():boolean{return !!this.report?.supported&&!this.report.writeReason&&!this.loading&&!this.pending&&!this.blocked&&!this.error;}
 get canSubmit():boolean{const d=this.draft;return this.canEdit&&!!d&&familyNameValid(d.name)&&d.devices.length>0&&d.devices.length<=10;}
 get modalOpen():boolean{return !!this.modal;}
 names():void{if(!this.canEdit)return;this.view='names';this.message='';this.changed();}
 dismiss():void{if(!this.pending){this.modal=undefined;this.changed();}}
 deleteDialog():void{if(this.canEdit){this.modal={kind:'delete'};this.changed();}}
 expand(name:string):void{this.expanded.has(name)?this.expanded.delete(name):this.expanded.add(name);this.changed();}
 repeatDay(day:number):void{if(this.modal?.kind!=='repeat')return;const d=this.modal;d.value=d.value.includes(day)?d.value.filter(v=>v!==day):[...d.value,day];this.changed();}
 private valid(r:FamilyReport,c:DeviceContext):void{if(r.did!==c.did||r.model!==routerModel||r.mac.toLowerCase()!==this.mac.toLowerCase()||!/^[a-f\d]{64}$/.test(r.revision)||typeof r.supported!=='boolean'||!Array.isArray(r.users)||r.users.length>8||!Array.isArray(r.clients)||r.clients.length>4176||!Array.isArray(r.apps)||r.apps.length>64||r.current!==null&&!r.users.some(u=>sameId(u.userId,r.current!.user.userId)))throw{kind:'protocol',message:'家人上网保护返回与当前路由器不匹配。',retryable:false};}
 async read(c:DeviceContext):Promise<void>{if(this.loading||this.pending||this.draft||this.unresolved||!sameContext(c,this.context))return;const epoch=this.epoch,current=()=>epoch===this.epoch&&sameContext(c,this.context);this.loading=true;this.changed();try{const result=await this.api.read({...c},this.mac);if(!current())return;this.valid(result.report,c);this.report=result.report;this.baseline=result.report.revision;this.error=undefined;this.unresolved=result.pending??undefined;this.blocked=!!this.unresolved;if(this.unresolved){if(this.unresolved.operation.kind==='save')this.draft=structuredClone(this.unresolved.operation.draft);this.message='上次家人设置尚未确认，正在查询当前配置。';this.schedule();}}catch(e){if(current()){this.error=normalizeError(e);this.failed(this.error);}}finally{if(current()){this.loading=false;this.changed();}}}
 start():void{if(!this.report||this.loading)return;if(!this.draft){const p=this.report.current;this.baseline=this.report.revision;this.draft=p?{userId:p.user.userId,name:p.user.name,icon:p.user.icon,devices:[...p.user.devices],times:structuredClone(p.times),urls:[...p.urls],apps:structuredClone(p.apps)}:{userId:null,name:'',icon:'0',devices:[this.mac.toLowerCase()],times:[],urls:[],apps:structuredClone(this.report.apps)};}this.view='main';this.changed();}
 back():boolean{if(this.modal){this.modal=undefined;this.changed();return true;}if(this.view!=='main'){this.view='main';this.appsDraft=undefined;this.timeDraft=undefined;this.selectedDevices.clear();this.changed();return true;}return false;}
 leave():void{if(!this.pending&&!this.blocked){this.draft=undefined;this.view='main';this.modal=undefined;}}
 chooseName(index:number):void{if(!this.canEdit||!this.draft)return;this.draft.name=familyNames[index];this.draft.icon=String(index);this.changed();}
 name(icon:string,value=''):void{if(!this.canEdit)return;this.modal={kind:'name',icon,value};this.message='';this.changed();}
 saveName():void{const m=this.modal;if(m?.kind!=='name'||!this.draft||!this.canEdit)return;if(!familyNameValid(m.value)){this.message='家人名称不能为空，最多6个汉字或12个英文字符。';this.changed();return;}this.draft.name=m.value;this.draft.icon=m.icon;this.modal=undefined;this.view='main';this.changed();}
 devices():void{if(!this.canEdit||!this.draft)return;this.selectedDevices=new Set(this.draft.devices.map(s=>s.toLowerCase()));this.view='devices';this.changed();}
 toggleDevice(mac:string):void{const c=this.report?.clients.find(c=>c.mac===mac),d=this.draft;if(!this.canEdit||!d||!c||c.owner!==null&&!sameId(c.owner,d.userId))return;if(this.selectedDevices.has(mac))this.selectedDevices.delete(mac);else if(this.selectedDevices.size<10)this.selectedDevices.add(mac);else this.message='最多可以添加10个设备。';this.changed();}
 saveDevices():void{if(!this.draft||!this.canEdit)return;this.draft.devices=[...this.selectedDevices];this.view='main';this.changed();}
 removeDevice(mac:string):void{if(!this.canEdit||!this.draft)return;this.draft.devices=this.draft.devices.filter(m=>m!==mac);this.changed();}
 url():void{if(!this.canEdit)return;this.modal={kind:'url',value:''};this.message='';this.changed();}
 saveUrl():void{const m=this.modal,d=this.draft;if(m?.kind!=='url'||!d||!this.canEdit)return;if(!familyUrlValid(m.value)||d.urls.includes(m.value)){this.message='包含不合法字符或重复网址，建议检查输入。';this.changed();return;}d.urls.push(m.value);this.modal=undefined;this.changed();}
 removeUrl(index:number):void{if(!this.canEdit||!this.draft)return;this.draft.urls.splice(index,1);this.changed();}
 time(index:number|null=null):void{if(!this.canEdit||!this.draft)return;if(index===null&&this.draft.times.filter(t=>!t.deleted).length>=4){this.message='最多可以添加4个不可用时段。';this.changed();return;}this.timeDraft={index,value:index===null?familyTime(0,480,[0,1,2,3,4]):structuredClone(this.draft.times[index])};this.view='time';this.changed();}
 saveTime():void{if(!this.canEdit||!this.draft||!this.timeDraft)return;const {index,value}=this.timeDraft;if(index===null)this.draft.times.push(value);else this.draft.times[index]=value;this.timeDraft=undefined;this.view='main';this.changed();}
 clock(which:'start'|'end'):void{const t=this.timeDraft?.value;if(!t)return;const v=t[which]%1440;this.modal={kind:'clock',which,hour:Math.floor(v/60),minute:v%60};this.changed();}
 saveClock():void{const m=this.modal,t=this.timeDraft?.value;if(m?.kind!=='clock'||!t)return;const value=m.hour*60+m.minute;if(m.which==='start'){t.start=value;t.end=t.end%1440<=value?t.end%1440+1440:t.end%1440;}else t.end=value<=t.start?value+1440:value;this.modal=undefined;this.changed();}
 repeat():void{if(!this.timeDraft)return;this.modal={kind:'repeat',value:this.timeDraft.value.enable.flatMap((v,i)=>v?[i]:[])};this.changed();}
 saveRepeat():void{if(this.modal?.kind!=='repeat'||!this.timeDraft)return;const values=this.modal.value;this.timeDraft.value.enable=familyDays.map((_,i)=>values.includes(i)?1:0);this.modal=undefined;this.changed();}
 removeTime(index:number):void{if(!this.canEdit)return;this.modal={kind:'removeTime',index};this.changed();}
 confirmRemoveTime():void{if(this.modal?.kind!=='removeTime'||!this.draft||!this.canEdit)return;const index=this.modal.index,t=this.draft.times[index];if(t.id===null)this.draft.times.splice(index,1);else t.deleted=true;this.modal=undefined;this.changed();}
 apps(expanded?:string):void{if(!this.canEdit||!this.draft)return;this.appsDraft=structuredClone(this.draft.apps);this.expanded=new Set(expanded?[expanded]:[]);this.view='apps';this.changed();}
 toggleCategory(index:number):void{const c=this.appsDraft?.[index];if(!c||!this.canEdit)return;c.enable=!c.enable;if(c.enable)this.modal={kind:'quota',index,value:c.timeQuota};this.changed();}
 toggleApp(index:number,app:number):void{const a=this.appsDraft?.[index]?.apps[app];if(!a||!this.canEdit)return;a.enable=!a.enable;this.changed();}
 quota(index:number):void{const c=this.appsDraft?.[index];if(!c?.enable)return;this.modal={kind:'quota',index,value:c.timeQuota};this.changed();}
 saveQuota():void{if(this.modal?.kind!=='quota'||!this.appsDraft)return;this.appsDraft[this.modal.index].timeQuota=this.modal.value;this.modal=undefined;this.changed();}
 saveApps():void{if(!this.canEdit||!this.draft||!this.appsDraft)return;for(const c of this.appsDraft)if(c.apps.length&&c.apps.every(a=>!a.enable))c.enable=false;this.draft.apps=this.appsDraft;this.appsDraft=undefined;this.view='main';this.changed();}
 more():void{if(this.canEdit&&this.draft?.userId!==null)this.modal={kind:'more'};this.changed();}
 async removeProfile():Promise<void>{if(!this.canEdit||this.draft?.userId==null)return;const userId=this.draft.userId;this.modal=undefined;await this.save({kind:'delete',userId});}
 async commit():Promise<void>{if(!this.canSubmit||!this.draft)return;await this.save({kind:'save',draft:structuredClone(this.draft)});}
 private async save(operation:FamilyOperation):Promise<void>{if(!this.canEdit||!this.context)return;const u={baseline:this.baseline,mac:this.mac,operation};this.unresolved=u;await this.submit({...this.context},u,false);}
 private async submit(c:DeviceContext,u:FamilyChange,query:boolean):Promise<void>{const epoch=this.epoch,current=()=>epoch===this.epoch&&sameContext(c,this.context);this.pending=true;this.blocked=true;this.changed();try{const result=await(query?this.api.confirm(c,u):this.api.save(c,u));if(!current())return;if(result.report)this.valid(result.report,c);if(result.report)this.report=result.report;const done=result.status==='confirmed'&&!!result.report&&familyMatches(result.report,u);this.error=undefined;this.message=done?result.message:'家人设置尚未回读确认，只会继续查询，不会重复发送。';if(done){this.unresolved=undefined;this.blocked=false;this.draft=undefined;this.accepted();}}catch(e){if(!current())return;this.error=normalizeError(e);this.message=this.error.message;this.failed(this.error);if(query&&this.error.kind==='familyNoPending'){this.unresolved=undefined;this.blocked=false;this.draft=undefined;this.error=undefined;}else if(!query&&!['network','protocol','busy','staleContext','offline'].includes(this.error.kind)){this.unresolved=undefined;this.blocked=false;}}finally{if(current()){this.pending=false;this.changed();if(this.unresolved)this.schedule();else if(query&&!this.draft)void this.read(c);}}}
 private schedule():void{if(this.timer)clearTimeout(this.timer);const epoch=this.epoch;this.timer=setTimeout(()=>{if(epoch===this.epoch&&this.context&&this.unresolved&&!this.pending)void this.submit({...this.context},this.unresolved,true);},5000);}
}
