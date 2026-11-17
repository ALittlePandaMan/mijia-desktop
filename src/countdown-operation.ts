import type {AppError,CountdownChange,CountdownChangeResult,TimerReport} from './types';

export interface CountdownIntent {
  on:boolean;active:boolean;hours?:number;minutes?:number;phase:'sending'|'uncertain';
}

/** Display intent is separate from cloud records. A lost response is queried,
 * never resubmitted; a context change disposes all later observations. */
export class CountdownOperation {
  phase:'sending'|'uncertain'|'confirmed'|'rejected'='sending';
  report:TimerReport;
  error?:AppError;
  private alive=true;
  private started=false;
  private startedAt:number;
  private mismatch='';
  private mismatches=0;
  private readPromise?:Promise<void>;
  constructor(readonly change:CountdownChange,report:TimerReport,
    private submit:(change:CountdownChange)=>Promise<CountdownChangeResult>,
    private read:()=>Promise<TimerReport>,private changed:()=>void,
    private wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
    private now:()=>number=()=>Date.now()/1000){
    this.report=report;this.startedAt=now();
  }
  get pending():boolean{return this.phase==='sending'||this.phase==='uncertain';}
  get intent():CountdownIntent|undefined {
    if(!this.pending)return;
    return {on:this.change.on,active:this.change.operation==='set',phase:this.phase as 'sending'|'uncertain',...(this.change.operation==='set'?{hours:this.change.hours,minutes:this.change.minutes}:{})};
  }
  cancel():void{this.alive=false;}
  private valid(report:TimerReport):boolean{return report.did===this.report.did&&report.model===this.report.model;}
  private observe(report:TimerReport):void{
    if(!this.alive||!this.pending||!this.valid(report))return;
    this.report=report;
    const view=report.countdowns.find(item=>item.on===this.change.on);
    if(!view||view.active===null){this.mismatches=0;return;}
    const seconds=this.change.operation==='set'?(this.change.hours*60+this.change.minutes)*60:0;
    const matches=this.change.operation==='cancel'?view.active===false:
      view.active===true&&!!view.key&&(!this.change.key||view.key===this.change.key)&&view.dueAt!==null&&
      view.dueAt>=this.startedAt+seconds-5&&view.dueAt<=this.now()+seconds+5;
    if(matches){this.phase='confirmed';this.error=undefined;return;}
    const signature=JSON.stringify([view.active,view.key,view.dueAt]);
    this.mismatches=signature===this.mismatch?this.mismatches+1:1;this.mismatch=signature;
    if(this.mismatches>=3){this.phase='rejected';this.error={kind:'timerNotApplied',message:'倒计时未生效，已恢复云端确认的状态。',retryable:true};}
  }
  async refresh():Promise<void>{
    if(!this.alive||!this.pending||this.phase==='sending')return;
    if(this.readPromise)return this.readPromise;
    this.readPromise=(async()=>{try{const report=await Promise.resolve().then(()=>this.read());if(this.alive)this.observe(report);}catch{this.mismatches=0;}finally{this.readPromise=undefined;if(this.alive)this.changed();}})();
    return this.readPromise;
  }
  async start():Promise<void>{
    if(this.started||!this.alive)return;
    this.started=true;this.changed();
    try{
      const result=await this.submit(this.change);if(!this.alive)return;
      // A transport success flag cannot turn the displayed target into a record.
      if(result.sceneVerified&&result.report&&this.valid(result.report))this.observe(result.report);
    }catch(error){
      if(!this.alive)return;
      const failure=error as AppError;
      if(['invalidInput','invalidValue','permissionDenied','unsupported','authExpired','staleContext'].includes(failure?.kind)){
        this.phase='rejected';this.error=failure;this.changed();return;
      }
    }
    if(!this.pending){this.changed();return;}
    this.phase='uncertain';this.changed();
    for(const delay of [1000,2500,5000,10000]){
      await this.wait(delay);if(!this.alive||!this.pending)return;
      await this.refresh();if(!this.alive||!this.pending)return;
    }
    // Still unknown: keep the target marked uncertain and prevent another
    // schedule mutation. A later read or reopening the page can reconcile it.
  }
}
