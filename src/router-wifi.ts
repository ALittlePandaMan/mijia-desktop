import type {AppError,DeviceContext,RouterWifiChange,RouterWifiNames,RouterWifiRead,RouterWifiReport,RouterWifiResult,RouterWifiValues} from './types';
import {normalizeError,sameContext} from './logic';
import {routerModel} from './router';
interface Transport {read:(c:DeviceContext)=>Promise<RouterWifiRead>;save:(c:DeviceContext,v:RouterWifiChange)=>Promise<RouterWifiResult>;confirm:(c:DeviceContext,v:RouterWifiChange)=>Promise<RouterWifiResult>}
const copy=(v:RouterWifiValues):RouterWifiValues=>({merged:v.merged,bands:v.bands.map(b=>({...b})),...(v.enabled?{enabled:[...v.enabled]}:{})});
export function wifiMatches(r:RouterWifiReport,v:RouterWifiValues):boolean{return (!v.enabled||v.enabled.length===2&&v.enabled.every((on,i)=>on===r.enabled[i]))&&r.values.merged===v.merged&&r.values.bands.length===v.bands.length&&r.values.bands.every((b,i)=>v.merged&&i===1||b.ssid===v.bands[i].ssid&&(!r.encrypted[i]||b.password===v.bands[i].password));}
export function wifiProblem(r:RouterWifiReport,v:RouterWifiValues):string|undefined {
 if(r.writeReason)return r.writeReason;
 if(v.bands.length!==2||v.merged!==r.values.merged&&!r.canMerge)return'当前频段配置不可修改。';
 if(v.enabled&&(v.enabled.length!==2||v.enabled.some(on=>typeof on!=='boolean')))return'频段开关无效。';
 const weighted=(s:string)=>s.split('').reduce((n,c)=>n+(c.charCodeAt(0)<=128?1:3),0);
 for(const[b,i]of v.bands.map((b,i)=>[b,i]as const)){
  if(!(v.enabled?.[i]??r.enabled[i])&&(b.ssid!==r.values.bands[i].ssid||b.password!==r.values.bands[i].password))return'未开启的Wi-Fi频段不可编辑名称和密码。';
  if(v.merged&&i===1&&b.ssid===r.values.bands[i].ssid&&b.password===r.values.bands[i].password)continue;
  const deniedSsid=r.specialCharacters?'':'[]［］`｀;；|｜$＄＆&\\{}｛｝＼（）';
  if(!b.ssid.trim()||weighted(b.ssid)>(i===0?28:31)||/[\x00-\x1f\x7f]/.test(b.ssid))return'Wi-Fi名称为空、过长或含无效字符。';
  if([...b.ssid].some(c=>deniedSsid.includes(c)||((c.codePointAt(0)??0)>=0x1f000&&(c.codePointAt(0)??0)<=0x1ffff)||['\ufe0f','\u200d'].includes(c)))return'Wi-Fi名称包含非法字符。';
  if(!r.encrypted[i]){if(b.password!==r.values.bands[i].password)return'无加密网络不可修改密码。';continue;}
  const denied=r.specialCharacters?'[]；｜｛｝｀＼！？。，（）、＆＄':'[]［］`｀;；|｜$＄＆&\\{}｛｝＼！？。，（）、';
  if(b.password.trim().length<8||b.password.length>63||/[^\x20-\x7e]/.test(b.password)||[...b.password].some(c=>denied.includes(c))||b.password.includes('...'))return'Wi-Fi密码需为8至63位且不含禁用字符。';
 }
}
export class RouterWifiState {
 report?:RouterWifiReport;draft?:RouterWifiValues;loading=false;pending=false;blocked=false;confirming=false;success=false;error?:AppError;message='';
 private epoch=0;private context?:DeviceContext;private scope='';private unresolved?:RouterWifiChange;private timer?:ReturnType<typeof setTimeout>;private checkingExternal=false;
 constructor(private api:Transport,private changed:()=>void,private failed:(e:AppError)=>void){}
 bind(c:DeviceContext,scope:string):void{if(!sameContext(c,this.context)||scope!==this.scope){this.close();this.context={...c};this.scope=scope;}}
 close():void{++this.epoch;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.context=undefined;this.report=undefined;this.draft=undefined;this.unresolved=undefined;this.loading=false;this.pending=false;this.blocked=false;this.confirming=false;this.success=false;this.error=undefined;this.message='';this.checkingExternal=false;}
 get canEdit():boolean{return !!this.report&&!!this.draft&&!this.report.writeReason&&!this.pending&&!this.blocked&&!this.loading&&!this.success;}
 get dirty():boolean{return !!this.report&&!!this.draft&&!wifiMatches(this.report,this.draft);}
 editBand(index:number,field:keyof RouterWifiNames,value:string):void{if(!this.canEdit||!this.draft||!this.report||!(this.draft.enabled?.[index]??this.report.enabled[index])||field==='password'&&!this.report.encrypted[index])return;this.draft.bands[index][field]=value;this.message='';}
 editAdvancedPassword(index:number,value:string):void{if(!this.canEdit||!this.draft?.bands[index])return;if(this.draft.merged)for(const b of this.draft.bands)b.password=value;else this.draft.bands[index].password=value;}
 toggleBand(index:number):void{if(!this.canEdit||!this.draft||!this.report||index<0||index>1)return;const values=[...(this.draft.enabled??this.report.enabled)],affected=this.draft.merged?[0,1]:[index];if(values[index]&&(affected.some(i=>this.report!.protection?.protectedBands.includes(i))||this.report.protection?.state==='unavailable')){this.message=this.report.protection?.reason??'当前电脑正在使用此频段，不能在桌面关闭。';this.changed();return;}const next=!values[index];for(const i of affected)values[i]=next;this.draft.enabled=values;this.message='';this.changed();}
 merge():void{if(!this.canEdit||!this.report?.canMerge||!this.draft)return;this.draft.merged=!this.draft.merged;if(!this.draft.merged)this.draft.bands[1].ssid=this.draft.bands[0].ssid+'_5G';this.changed();}
 adoptAdvanced(c:DeviceContext,r:RouterWifiReport,confirmed=false):void{
  if(!sameContext(c,this.context)||this.loading||this.pending||this.unresolved)return;this.valid(r,c);
  if(confirmed){this.report=r;this.draft=copy(r.values);this.checkingExternal=false;this.blocked=false;this.error=undefined;this.changed();return;}
  const old=this.report?.values,desired=this.draft?copy(this.draft):copy(r.values),next=copy(r.values);
  if(old){
   for(const[i,b]of desired.bands.entries())for(const field of ['ssid','password']as const){if(b[field]!==old.bands[i][field]){if(r.values.bands[i][field]!==old.bands[i][field]&&r.values.bands[i][field]!==b[field]){this.blocked=true;this.error={kind:'conflict',message:'Wi-Fi配置与草稿同时发生变化，请返回后重新进入。',retryable:false};this.message=this.error.message;this.changed();return;}next.bands[i][field]=b[field];}}
   if(desired.merged!==old.merged)next.merged=desired.merged;
  }
  this.report=r;this.draft=next;this.checkingExternal=false;this.blocked=false;this.error=undefined;this.changed();
 }
 private valid(r:RouterWifiReport,c:DeviceContext):void{if(r.did!==c.did||r.model!==routerModel||!/^[a-f0-9]{64}$/.test(r.revision)||r.values.bands.length!==2||r.enabled.length!==2||r.encrypted.length!==2)throw{kind:'protocol',message:'Wi-Fi设置与当前路由器不匹配。',retryable:false};}
 async read(c:DeviceContext):Promise<void>{
  if(this.loading||this.pending||!sameContext(c,this.context))return;
  const epoch=this.epoch,current=()=>epoch===this.epoch&&sameContext(c,this.context);this.loading=true;this.changed();
  try{const r=await this.api.read({...c});if(!current())return;this.valid(r.report,c);this.report=r.report;this.unresolved=r.pending??undefined;this.checkingExternal=!!r.externalPending;this.blocked=!!r.pending||this.checkingExternal;this.draft=copy(r.pending?.values??r.report.values);this.error=undefined;this.message=r.pending?'上次Wi-Fi设置尚未确认，正在查询实际状态。':this.checkingExternal?'上次高级设置尚未确认，正在查询实际状态。':'';this.success=false;}
  catch(e){if(current()){this.error=normalizeError(e);this.failed(this.error);}}
  finally{if(current()){this.loading=false;this.changed();if(this.unresolved||this.checkingExternal)this.schedule(c);}}
 }
 async save(c:DeviceContext,confirmed=false):Promise<boolean>{
  if(!this.canEdit||!this.report||!this.draft||!sameContext(c,this.context))return false;
  if(!this.dirty)return true;
  const problem=wifiProblem(this.report,this.draft);if(problem){this.message=problem;this.changed();return false;}
  if(!confirmed){this.confirming=true;this.changed();return false;}
  this.confirming=false;this.unresolved={baseline:this.report.revision,values:copy(this.draft)};return this.submit(c,this.unresolved,false);
 }
 private async submit(c:DeviceContext,change:RouterWifiChange,query:boolean):Promise<boolean>{
  const epoch=this.epoch,current=()=>epoch===this.epoch&&sameContext(c,this.context);this.pending=true;this.blocked=true;this.changed();
  try{const r=await(query?this.api.confirm({...c},change):this.api.save({...c},change));if(!current())return false;if(r.report){this.valid(r.report,c);this.report=r.report;}this.error=undefined;this.message=r.message;
   if(r.status==='confirmed'&&r.report&&wifiMatches(r.report,change.values)){this.draft=copy(r.report.values);this.unresolved=undefined;this.blocked=false;this.success=true;return true;}
  }catch(e){if(!current())return false;this.error=normalizeError(e);this.failed(this.error);this.message=this.error.message;if(!['network','protocol','busy','offline','staleContext'].includes(this.error.kind)){this.unresolved=undefined;this.blocked=this.error.kind==='conflict';}}
  finally{if(current()){this.pending=false;this.changed();if(this.unresolved)this.schedule(c);}}
  return false;
 }
 private schedule(c:DeviceContext):void{if(this.timer)clearTimeout(this.timer);const epoch=this.epoch;this.timer=setTimeout(()=>{this.timer=undefined;if(epoch===this.epoch&&sameContext(c,this.context)&&!this.pending){if(this.unresolved)void this.submit(c,this.unresolved,true);else if(this.checkingExternal)void this.read(c);}},5000);}
}
