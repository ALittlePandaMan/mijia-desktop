import type {AppError,DeviceContext,RouterAdvancedChange,RouterAdvancedField,RouterAdvancedOutcome,RouterAdvancedRead,RouterAdvancedReport,RouterDfsChallenge,RouterRadioValues,RouterWifiReport,RouterWifiValues} from './types';
import {normalizeError,sameContext} from './logic';import {routerModel} from './router';import {wifiMatches,wifiProblem,type RouterWifiState} from './router-wifi';
import {linkedRadioEdit,mergeRadioDraft,radioMatches,radioProblem,radioValues,type RadioField} from './router-radio';
interface Transport {read:(c:DeviceContext)=>Promise<RouterAdvancedRead>;save:(c:DeviceContext,u:RouterAdvancedChange)=>Promise<RouterAdvancedOutcome>;confirm:(c:DeviceContext,u:RouterAdvancedChange)=>Promise<RouterAdvancedOutcome>;dfs:(c:DeviceContext,id:string,proceed:boolean)=>Promise<RouterAdvancedOutcome>}
const fields:RouterAdvancedField[]=['mlo','muMimo','wifi5','relay','aiot','channelAdj'];
export function advancedMatches(r:RouterAdvancedReport,c:RouterAdvancedChange):boolean{return(c.field==='configuration'||r.switches.find(s=>s.field===c.field)?.value===c.on)&&(!c.wifi||wifiMatches(r.wifi,c.wifi.values))&&(!c.bands||radioMatches(r,c.bands));}
export function advancedChecked(r:RouterAdvancedReport|undefined,f:RouterAdvancedField,draft?:RouterWifiValues):boolean|null{const s=r?.switches.find(s=>s.field===f);if(!s||s.value===null)return null;if(f==='mlo'&&(!(draft??r?.wifi.values)?.merged||r?.switches.find(s=>s.field==='wifi5')?.value===true))return false;return s.value;}
export class RouterAdvancedState {
 report?:RouterAdvancedReport;error?:AppError;loading=false;pending=false;blocked=false;configPending=false;message='';confirmation?:RouterAdvancedChange;wpa3?:RouterAdvancedChange;dfs?:RouterDfsChallenge;success=false;
 frequency=0;frequencySelection=0;frequencyPicker=false;radioDraft?:RouterRadioValues[];radioPicker?:{field:RadioField;selected:string|number};localNotice='';
 private epoch=0;private context?:DeviceContext;private scope='';private unresolved?:RouterAdvancedChange;private timer?:ReturnType<typeof setTimeout>;private toast?:ReturnType<typeof setTimeout>;private needsRead=false;private draftConflict=false;private syncNoticed=false;private waitingUntil=0;private waitTick?:ReturnType<typeof setTimeout>;
 private showIntent=true;
 get displayReport():RouterAdvancedReport|undefined{const r=this.report,u=this.unresolved;if(!r||!u||!this.showIntent)return r;return {...r,switches:r.switches.map(s=>s.field===u.field?{...s,value:u.on}:s),bands:r.bands.map((b,i)=>({...b,...u.bands?.[i]})),wifi:u.wifi?{...r.wifi,values:structuredClone(u.wifi.values)}:r.wifi};}
 adoptDeviceState():void{this.showIntent=false;this.message='已采用设备状态，原操作仍在后台核验';this.changed();}
 constructor(private api:Transport,private changed:()=>void,private failed:(e:AppError)=>void,private adopt:(c:DeviceContext,r:RouterWifiReport,confirmed?:boolean)=>void){}
 bind(c:DeviceContext,scope:string):void{if(!sameContext(c,this.context)||scope!==this.scope){this.close();this.context={...c};this.scope=scope;}}
 close():void{++this.epoch;if(this.timer)clearTimeout(this.timer);if(this.toast)clearTimeout(this.toast);if(this.waitTick)clearTimeout(this.waitTick);this.waitTick=undefined;this.waitingUntil=0;this.timer=undefined;this.toast=undefined;this.context=undefined;this.report=undefined;this.error=undefined;this.loading=false;this.pending=false;this.blocked=false;this.configPending=false;this.message='';this.confirmation=undefined;this.wpa3=undefined;this.dfs=undefined;this.success=false;this.unresolved=undefined;this.frequency=0;this.frequencySelection=0;this.frequencyPicker=false;this.radioPicker=undefined;this.radioDraft=undefined;this.localNotice='';this.needsRead=false;this.draftConflict=false;this.syncNoticed=false;}
 get canEdit():boolean{return !!this.report&&!this.loading&&!this.pending&&!this.blocked&&!this.configPending&&!this.draftConflict&&!this.success;}
 get canEditRadio():boolean{return this.canEdit&&!!this.radioDraft&&!this.report?.radio.writeReason;}
 get radioDirty():boolean{return !!this.report&&!!this.radioDraft&&!radioMatches(this.report,this.radioDraft);}
 get modalOpen():boolean{return !!(this.confirmation||this.wpa3||this.dfs||this.success||this.frequencyPicker||this.radioPicker||this.localNotice);}
 private valid(r:RouterAdvancedReport,c:DeviceContext):void{if(r.did!==c.did||r.model!==routerModel||r.wifi.did!==c.did||r.wifi.model!==routerModel||!/^[a-f0-9]{64}$/.test(r.revision)||!/^[a-f0-9]{64}$/.test(r.wifi.revision)||r.switches.length!==fields.length||r.switches.some(s=>!fields.includes(s.field))||new Set(r.switches.map(s=>s.field)).size!==r.switches.length||!r.radio||!Array.isArray(r.radio.encryptions)||r.bands.some(b=>!Array.isArray(b.channels)))throw{kind:'protocol',message:'高级设置与当前路由器不匹配。',retryable:false};}
 get waitingSeconds():number{return Math.max(0,Math.ceil((this.waitingUntil-Date.now())/1000));}
 private challenge(d:RouterDfsChallenge|null|undefined):RouterDfsChallenge|undefined{if(!d)return;if((!d.waiting&&!/^[a-f0-9-]{36}$/.test(d.id))||!Number.isInteger(d.seconds)||d.seconds<=0)throw{kind:'protocol',message:'DFS确认数据无效。',retryable:false};return d;}
 private setDfs(d:RouterDfsChallenge|undefined,c:DeviceContext):void{if(this.waitTick)clearTimeout(this.waitTick);this.waitTick=undefined;this.dfs=d;this.waitingUntil=d?.waiting?Date.now()+d.seconds*1000:0;if(d?.waiting){const epoch=this.epoch,tick=()=>{if(epoch!==this.epoch||!sameContext(c,this.context)||!this.dfs?.waiting)return;this.changed();if(this.waitingSeconds>0)this.waitTick=setTimeout(tick,1000);};this.waitTick=setTimeout(tick,1000);}}
 private accept(r:RouterAdvancedReport):void{const old=this.report;this.report=r;if(old&&this.radioDraft){const result=mergeRadioDraft(old,r,this.radioDraft);this.radioDraft=result.bands;if(result.conflict){this.draftConflict=true;this.error={kind:'conflict',message:'频段配置和草稿同时发生变化，请返回后重新进入。',retryable:false};}}else this.radioDraft=radioValues(r);}
 async read(c:DeviceContext):Promise<void>{
  if(this.loading||this.pending||!sameContext(c,this.context))return;const epoch=this.epoch,current=()=>epoch===this.epoch&&sameContext(c,this.context);this.loading=true;this.changed();
  try{const result=await this.api.read({...c});if(!current())return;this.valid(result.report,c);this.error=undefined;this.accept(result.report);this.configPending=result.configPending;this.unresolved=result.pending??undefined;this.showIntent=true;this.blocked=!!result.pending;this.setDfs(this.challenge(result.dfs),c);this.needsRead=false;if(result.pending?.bands)this.radioDraft=structuredClone(result.pending.bands);if(!result.pending&&!result.configPending)this.adopt(c,result.report.wifi);this.message=result.pending||result.configPending?'上次Wi-Fi设置尚未确认，正在查询实际状态。':'';}
  catch(e){if(current()){this.error=normalizeError(e);this.needsRead=this.error.kind!=='authExpired';this.failed(this.error);}}
  finally{if(current()){this.loading=false;this.changed();if((!this.dfs||this.dfs.waiting)&&(this.unresolved||this.configPending||this.needsRead))this.schedule(c);}}
 }
 editRadio(wifi:RouterWifiState,field:keyof RouterRadioValues,value:string|number|boolean):void{
  if(!this.canEditRadio||!this.report||!this.radioDraft||!wifi.draft)return;const b=this.radioDraft[this.frequency];
  if(field==='on'&&!this.report.radio.canSwitch)return;
  if(field==='on'&&value===false&&(wifi.draft.merged?!!this.report.radio.connection?.protectedBands.length:this.report.radio.connection?.protectedBands.includes(this.frequency))){this.localNotice='当前电脑连接的Wi-Fi无法关闭，否则应用将与路由器失去联系。';this.changed();return;}
  if(field==='on'&&value===false&&this.report.radio.relayBand!==null&&(wifi.draft.merged||this.report.radio.relayBand===this.frequency)){this.localNotice='关闭Wi-Fi会造成路由器上不了网，请勿关闭。';this.changed();return;}
  if((field==='channel'||field==='bandwidth')&&(!this.report.radio.channelVisible||this.frequency===0&&this.report.switches.find(s=>s.field==='channelAdj')?.value))return;
  if(b[field]===value)return;const result=linkedRadioEdit(this.report,this.radioDraft,this.frequency,field,value,wifi.draft.merged);this.radioDraft=result.bands;this.message='';
  if(result.adjusted)this.localNotice=field==='bandwidth'?'当前信道不支持将要切换的频宽，系统已自动选择可用的信道。':'当前频宽不支持将要切换的信道，系统已自动选择可用的频宽。';else if(result.synchronized&&field!=='encryption'&&!this.syncNoticed){this.localNotice='多频合一开启时，该设置项的状态将同步至其他频段。';this.syncNoticed=true;}this.changed();
 }
 editPassword(wifi:RouterWifiState,value:string):void{if(this.canEditRadio&&wifi.draft)wifi.editAdvancedPassword(this.frequency,value);}
 prepareSave(c:DeviceContext,wifi:RouterWifiState):boolean{
  if(!this.canEditRadio||!wifi.canEdit||!this.report||!this.radioDraft||!wifi.draft||!wifi.report||!sameContext(c,this.context))return false;if(!this.radioDirty&&!wifi.dirty)return true;
  const problem=radioProblem(this.report,this.radioDraft,wifi.draft);if(problem){this.notice(problem);return false;}
  const change:RouterAdvancedChange={field:'configuration',on:false,baseline:this.report.revision,wifi:{baseline:wifi.report.revision,values:structuredClone(wifi.draft)},bands:structuredClone(this.radioDraft)};
  if(this.radioDraft.some(b=>['ccmp','psk2+ccmp'].includes(b.encryption)))this.wpa3=change;else this.confirmation=change;this.changed();return false;
 }
 continueWpa3():void{if(!this.wpa3)return;this.confirmation=this.wpa3;this.wpa3=undefined;this.changed();}
 async request(c:DeviceContext,field:RouterAdvancedField,wifi:RouterWifiState):Promise<boolean>{
  if(!this.canEdit||!this.report||!sameContext(c,this.context))return false;const item=this.report.switches.find(s=>s.field===field),checked=advancedChecked(this.report,field,wifi.draft);if(!item?.supported||item.value===null||checked===null)return false;
  const on=!checked;let config:RouterAdvancedChange['wifi'];let bands:RouterAdvancedChange['bands'];
  if(field==='mlo'&&on){
   if(!wifi.canEdit||!wifi.report||!wifi.draft)return false;const compatibility=this.report.switches.find(s=>s.field==='wifi5');if(!compatibility||compatibility.mode===null){this.notice('Wi-Fi模式尚未读取。');return false;}if(compatibility.value){this.notice('检测到已开启Wi-Fi 5兼容模式，无法打开MLO开关。');return false;}if(!wifi.draft.merged){this.notice('检测到未开启Wi-Fi多频合一，无法打开MLO开关。');return false;}
   const problem=this.radioDraft?radioProblem(this.report,this.radioDraft,wifi.draft):wifiProblem(wifi.report,wifi.draft);if(problem){this.notice(problem);return false;}config={baseline:wifi.report.revision,values:structuredClone(wifi.draft)};bands=this.radioDraft?structuredClone(this.radioDraft):undefined;
  }
  const change:RouterAdvancedChange={field,on,baseline:this.report.revision,...(config?{wifi:config,bands}:{})};if(field==='muMimo'||field==='wifi5'||field==='mlo'&&!on){this.confirmation=change;this.changed();return false;}return this.send(c,change,false);
 }
 cancel():void{this.confirmation=undefined;this.wpa3=undefined;this.changed();}
 async confirm(c:DeviceContext):Promise<boolean>{if(!this.confirmation||!this.canEdit||!sameContext(c,this.context))return false;const change=this.confirmation;this.confirmation=undefined;return this.send(c,change,false);}
 async respondDfs(c:DeviceContext,proceed:boolean):Promise<boolean>{if(!this.dfs||this.dfs.waiting||!this.unresolved||this.pending||!sameContext(c,this.context))return false;const id=this.dfs.id,change=this.unresolved;this.dfs=undefined;return this.send(c,change,false,{id,proceed});}
 private async send(c:DeviceContext,change:RouterAdvancedChange,query:boolean,dfs?:{id:string;proceed:boolean}):Promise<boolean>{
  const epoch=this.epoch,current=()=>epoch===this.epoch&&sameContext(c,this.context);if(!query)this.showIntent=true;this.pending=true;this.blocked=true;this.unresolved=change;this.changed();
  try{const result=await(dfs?this.api.dfs({...c},dfs.id,dfs.proceed):query?this.api.confirm({...c},change):this.api.save({...c},change));if(!current())return false;this.setDfs(undefined,c);this.error=undefined;if(result.report){this.valid(result.report,c);this.accept(result.report);}
   if(result.status==='confirmed'&&result.report&&advancedMatches(result.report,change)){this.unresolved=undefined;this.dfs=undefined;this.blocked=false;this.configPending=false;this.adopt(c,result.report.wifi,!!change.wifi);if(change.field==='configuration')this.success=true;this.notice(this.draftConflict?'设置已回读，但频段草稿有冲突，请返回后重新进入。':result.message||'设置成功');return true;}
   if(result.status==='dfsRequired'||result.status==='waiting'){this.setDfs(this.challenge(result.dfs),c);if(!this.dfs)throw{kind:'protocol',message:'缺少DFS确认数据。',retryable:false};this.message='';return false;}
   if(result.status==='rejected'){this.unresolved=undefined;this.dfs=undefined;this.blocked=!result.report;this.needsRead=!result.report;if(result.report)this.adopt(c,result.report.wifi);this.message=result.message;return false;}this.message=result.message||'实际状态尚未确认，正在继续查询。';
  }catch(e){if(!current())return false;this.error=normalizeError(e);this.failed(this.error);this.message=this.error.message;if(!['network','protocol','busy','offline','staleContext'].includes(this.error.kind)){this.unresolved=undefined;this.blocked=true;this.needsRead=this.error.kind!=='authExpired';}}
  finally{if(current()){this.pending=false;this.changed();if((!this.dfs||this.dfs.waiting)&&(this.unresolved||this.needsRead))this.schedule(c);}}return false;
 }
 private notice(message:string):void{if(this.toast)clearTimeout(this.toast);this.message=message;const epoch=this.epoch;this.toast=setTimeout(()=>{if(epoch===this.epoch&&!this.pending&&!this.blocked){this.message='';this.changed();}},3000);this.changed();}
 private schedule(c:DeviceContext):void{if(this.timer)clearTimeout(this.timer);const epoch=this.epoch;this.timer=setTimeout(()=>{this.timer=undefined;if(epoch!==this.epoch||!sameContext(c,this.context)||this.pending||this.dfs&&!this.dfs.waiting)return;if(this.unresolved)void this.send(c,this.unresolved,true);else if(this.configPending||this.needsRead)void this.read(c);},this.dfs?.waiting&&this.waitingSeconds>0?Math.max(1000,Math.min(30000,this.waitingSeconds*1000)):5000);}
}
