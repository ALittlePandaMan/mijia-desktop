import type { CountdownView,Device,DevicePanel,TimerDraft,TimerEntry,TimerMode } from './types';
import { switchServices } from './panel-layout';

export function timersSupported(device:Device,panel:DevicePanel|undefined):boolean {
  const props=switchServices(panel).flatMap(service=>service.properties).filter(prop=>prop.name==='on'&&prop.format==='bool'&&prop.access.includes('read'));
  return device.model==='cuco.plug.v3'&&device.did===panel?.did&&device.model===panel.model&&!device.controlServiceId&&!panel.unsupportedReason&&!!panel.specType?.startsWith('urn:miot-spec-v2:device:outlet:')&&props.length===1;
}
export function countdownText(view:CountdownView|undefined,now=Date.now()/1000):string {
  if(!view)return '未读取';
  if(view.active===null)return '状态未知';
  if(view.active&&view.dueAt){
    const minutes=Math.ceil((view.dueAt-now)/60);
    if(minutes<=0)return '已到期，待重新读取';
    return `${Math.floor(minutes/60)?`${Math.floor(minutes/60)}小时`:''}${minutes%60?`${minutes%60}分钟`:''}后${view.on?'开启':'关闭'}`;
  }
  return '未启用';
}
export function durationText(view:CountdownView|undefined):string {
  if(!view||view.hours===null||view.minutes===null)return '未读取';
  const text=`${view.hours?`${view.hours}小时`:''}${view.minutes?`${view.minutes}分钟`:''}`;
  return `${text}${view.durationSource==='default'?'（默认）':''}`;
}
export function timerDraft(entry:TimerEntry|undefined,mode:TimerMode='period'):TimerDraft {
  if(entry)return {key:entry.key,mode:entry.endTime?'period':entry.on?'on':'off',onTime:entry.on?entry.time.slice(0,5):null,offTime:entry.endTime?.slice(0,5)??(!entry.on?entry.time.slice(0,5):null),weekdays:[...entry.weekdays],enabled:entry.enabled};
  return {key:null,mode,onTime:null,offTime:null,weekdays:[],enabled:true};
}
export function timerDraftProblem(draft:TimerDraft):string|undefined {
  const valid=(time:string|null)=>!!time&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
  if(draft.mode!=='off'&&!valid(draft.onTime)||draft.mode!=='on'&&!valid(draft.offTime))return '请设置定时时间。';
  if(draft.mode==='period'&&draft.onTime===draft.offTime)return '开启与关闭时间不能相同。';
  if(new Set(draft.weekdays).size!==draft.weekdays.length||draft.weekdays.some(day=>!Number.isInteger(day)||day<0||day>6))return '重复星期无效。';
  return undefined;
}
export function repeatText(days:number[]):string {
  if(!days.length)return '执行一次';if(new Set(days).size===7)return '每天';
  return [1,2,3,4,5,6,0].filter(day=>days.includes(day)).map(day=>['周日','周一','周二','周三','周四','周五','周六'][day]).join('、');
}
export function timerTimeSubtitle(draft:TimerDraft,on:boolean,hour:number,minute:number,now=Date.now()):string {
  const text=`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;if(draft.weekdays.length)return text;
  const date=new Date(now+8*3600*1000),current=date.getUTCHours()*60+date.getUTCMinutes(),target=hour*60+minute;
  const start=draft.mode==='period'&&!on&&draft.onTime?Number(draft.onTime.slice(0,2))*60+Number(draft.onTime.slice(3)):target;
  const day=(start<=current?1:0)+(draft.mode==='period'&&!on&&target<start?1:0);
  return `${['今天','明天','后天'][day]} ${text}`;
}
