import type { AppError, LightSettingsChange, LightSettingsReport, LightSettingsResult, LightSettingsSlot } from './types';

export type LightSettingsKind='modes'|'flow';
export type LightSettingsDraft={kind:'slot';index:number;baseline:string;brightness:number;color:number;temperaturePercent:number;tab:'color'|'temperature'}|{kind:'speed';baseline:number;value:number};
const integer=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=min&&value<=max;

export function settingsSlot(report:LightSettingsReport|undefined,kind:LightSettingsKind,index:number):LightSettingsSlot|undefined{
  const slots=(kind==='modes'?report?.slots:report?.flowSlots)?.filter(slot=>slot.index===index);
  if(!integer(index,0,3)||slots?.length!==1)return;
  const slot=slots[0];
  if(slot.reason||!slot.revision||!/^[a-f0-9]{64}$/.test(slot.revision)||!integer(slot.brightness,0,100)||!integer(slot.color,0,0xffffff))return;
  if(kind==='modes'&&(!integer(slot.temperaturePercent,0,100)||!['color','temperature'].includes(slot.tab)))return;
  if(kind==='flow'&&(slot.tab!=='color'||slot.temperaturePercent!==null))return;
  return slot;
}

export function settingsDraft(report:LightSettingsReport|undefined,kind:LightSettingsKind,index:number|'speed'):LightSettingsDraft{
  if(index==='speed'){
    if(kind!=='flow'||report?.speed.reason||!integer(report?.speed.value,0,100))throw Error('流光速度尚未成功读取。');
    return{kind:'speed',baseline:report.speed.value,value:report.speed.value};
  }
  const slot=settingsSlot(report,kind,index);if(!slot)throw Error('模式槽位尚未成功读取。');
  return{kind:'slot',index,baseline:slot.revision!,brightness:slot.brightness!,color:slot.color!,temperaturePercent:slot.temperaturePercent??0,tab:slot.tab};
}

export function settingsChange(kind:LightSettingsKind,draft:LightSettingsDraft):LightSettingsChange{
  if(draft.kind==='speed'){
    if(kind!=='flow'||!integer(draft.baseline,0,100)||!integer(draft.value,2,100))throw Error('请选择200–10000ms之间的流光速度。');
    return{operation:'setSpeed',baseline:draft.baseline,value:draft.value};
  }
  if(!integer(draft.index,0,3)||!/^[a-f0-9]{64}$/.test(draft.baseline)||!integer(draft.brightness,kind==='flow'?1:0,100)||!integer(draft.color,0,0xffffff))throw Error('模式草稿无效，请重新打开。');
  if(kind==='flow')return{operation:'saveFlow',index:draft.index,baseline:draft.baseline,brightness:draft.brightness,color:draft.color};
  if(!integer(draft.temperaturePercent,0,100)||!['color','temperature'].includes(draft.tab))throw Error('模式色温或页签无效。');
  return{operation:'saveMode',index:draft.index,baseline:draft.baseline,brightness:draft.brightness,color:draft.color,temperaturePercent:draft.temperaturePercent,tab:draft.tab};
}

export function flowSpeed(percent:number):number{
  if(!Number.isFinite(percent)||percent<0||percent>100)throw Error('流光速度位置无效。');
  return Math.trunc(percent/100*98+2);
}
export function flowSpeedPosition(value:number):number{
  if(!integer(value,0,100))throw Error('流光速度不可用。');
  return Math.max(0,Math.min(100,Math.trunc((value-2)/98*100)));
}

export function settingsMatch(report:LightSettingsReport,change:LightSettingsChange):boolean{
  if(change.operation==='setSpeed')return!report.speed.reason&&report.speed.value===change.value;
  const slot=settingsSlot(report,change.operation==='saveMode'?'modes':'flow',change.index);
  return!!slot&&slot.brightness===change.brightness&&slot.color===change.color&&(change.operation==='saveFlow'||slot.temperaturePercent===change.temperaturePercent&&slot.tab===change.tab);
}

/** One mutation, then query-only reconciliation. Confirmed values and display
 * intent remain separate; cancel invalidates any late account-bound result. */
export class LightSettingsOperation{
  phase:'sending'|'uncertain'|'confirmed'|'rejected'='sending';
  report:LightSettingsReport;
  error:AppError|undefined;
  readonly change:LightSettingsChange;
  private alive=true;
  private started=false;
  private flight:Promise<void>|undefined;
  constructor(change:LightSettingsChange,report:LightSettingsReport,
    private submit:(change:LightSettingsChange)=>Promise<LightSettingsResult>,
    private query:(change:LightSettingsChange)=>Promise<LightSettingsResult>,private changed:()=>void,
    private wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
    this.change=structuredClone(change);this.report=structuredClone(report);
  }
  get pending():boolean{return this.phase==='sending'||this.phase==='uncertain';}
  cancel():void{this.alive=false;}
  private accept(result:LightSettingsResult):void{
    if(!this.alive||!this.pending)return;
    if(result.report){
      if(result.report.did!==this.report.did||result.report.model!==this.report.model){this.phase='uncertain';this.error={kind:'protocol',message:'设置回读与当前设备不匹配，仍待确认。',retryable:true};return;}
      this.report=result.report;
    }
    if(result.status==='confirmed'&&result.report&&settingsMatch(result.report,this.change)){this.phase='confirmed';this.error=undefined;}
    else if(result.status==='rejected'){this.phase='rejected';this.error={kind:'lightSettingsRejected',message:result.message,retryable:true};}
    else{this.phase='uncertain';this.error=undefined;}
  }
  private failure(error:unknown,queryOnly=false):void{
    if(!this.alive||!this.pending)return;
    const e=error as AppError;
    if(!queryOnly&&['invalidInput','invalidValue','permissionDenied','unsupported','authExpired','staleContext','lightSettingsConflict','unconfirmed','busy','offline'].includes(e.kind)){
      this.phase='rejected';this.error=e;
    }else{this.phase='uncertain';this.error=undefined;}
  }
  async refresh():Promise<void>{
    if(!this.alive||!this.pending||this.phase==='sending')return;
    if(this.flight)return this.flight;
    const flight=(async()=>{try{this.accept(await this.query(this.change));}catch(error){this.failure(error,true);}finally{this.flight=undefined;if(this.alive)this.changed();}})();
    this.flight=flight;return flight;
  }
  async start():Promise<void>{
    if(this.started||!this.alive)return;this.started=true;this.changed();
    try{this.accept(await this.submit(this.change));}catch(error){this.failure(error);}
    if(!this.alive)return;this.changed();
    for(const delay of [1000,2500,5000]){
      if(!this.alive||!this.pending)return;await this.wait(delay);if(!this.alive||!this.pending)return;await this.refresh();
    }
  }
}
