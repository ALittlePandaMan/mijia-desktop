import type {AppError, CountdownChange, CountdownChangeResult, CountdownView, TimerReport} from './types';

export interface CountdownDraft {on:boolean;key:string;hours:number;minutes:number}

/** APK 14891 getAttrForTimer rounds the remaining scene duration up to minutes. */
export function countdownDuration(view:CountdownView|undefined,now=Date.now()/1000):{hours:number;minutes:number}|undefined {
  if(!view)return;
  if(view.active){
    if(!view.dueAt||view.dueAt<=now)return;
    const minutes=Math.ceil((view.dueAt-now)/60);
    return {hours:Math.floor(minutes/60),minutes:minutes%60};
  }
  if(view.hours!==null&&view.minutes!==null)return {hours:view.hours,minutes:view.minutes};
}

export function durationProblem(hours:number|null,minutes:number|null):string|undefined {
  if(hours===null||minutes===null||!Number.isInteger(hours)||!Number.isInteger(minutes)||hours<0||hours>23||minutes<0||minutes>59||hours===0&&minutes===0) {
    return '延迟时间必须为1分钟至23小时59分钟。';
  }
}

export function countdownReason(report:TimerReport|undefined,view:CountdownView|undefined,now=Date.now()/1000):string|undefined {
  if(!report||!view||view.active===null)return '倒计时状态尚未确认，请先重新读取。';
  if(report.writeReason||view.writeReason)return report.writeReason??view.writeReason??undefined;
  if(view.active&&(!view.key||!view.dueAt))return '倒计时记录无法安全修改，请重新读取。';
  if(view.active&&view.dueAt!==null&&view.dueAt<=now)return '倒计时已到期，请重新读取。';
}

function reject(message:string,kind='invalidInput'):never {
  throw {kind,message,retryable:kind==='timerConflict'} satisfies AppError;
}

/** Snapshot keys are preconditions, never permission to edit a newer scene. */
export function countdownToggle(report:TimerReport|undefined,on:boolean,now=Date.now()/1000):CountdownChange {
  const view=report?.countdowns.find(item=>item.on===on);
  const reason=countdownReason(report,view,now);if(reason)reject(reason);
  if(!view)reject('未读取倒计时状态。');
  if(view.active&&view.key)return {operation:'cancel',on,key:view.key};
  const problem=durationProblem(view.hours,view.minutes);if(problem)reject(problem);
  return {operation:'set',on,key:view.key,hours:view.hours!,minutes:view.minutes!};
}

export function countdownUpdate(report:TimerReport|undefined,draft:CountdownDraft,now=Date.now()/1000):CountdownChange {
  const view=report?.countdowns.find(item=>item.on===draft.on);
  const reason=countdownReason(report,view,now);if(reason)reject(reason);
  if(!view?.active||view.key!==draft.key)reject('倒计时记录已经变化，请重新读取。','timerConflict');
  const problem=durationProblem(draft.hours,draft.minutes);if(problem)reject(problem);
  return {operation:'set',on:draft.on,key:draft.key,hours:draft.hours,minutes:draft.minutes};
}

/** A preference failure does not undo an independently confirmed scene. */
export function countdownReport(result:CountdownChangeResult,did:string,model:string):TimerReport {
  if(!result.sceneVerified)reject(result.message,'timerWriteUncertain');
  if(!result.report||result.report.did!==did||result.report.model!==model) {
    reject('倒计时回读与当前设备不匹配，请重新读取，勿重复创建。','timerWriteUncertain');
  }
  return result.report;
}
