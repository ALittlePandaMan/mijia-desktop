import {dismissOnBackdrop} from './dialog-dismiss';
import type {AppError,DevicePanel,TimerReport} from '../types';
import {countdownDuration,countdownReason,durationProblem,type CountdownDraft} from '../countdown';
import {countdownText,durationText} from '../timers';
import {propertyReading,switchServices} from '../panel-layout';
import {icon} from '../icons';
import {button,element} from './dom';
import type {CountdownIntent} from '../countdown-operation';
import {deviceWait} from './device-loading';

interface CountdownCardProps {
  data?:TimerReport;panel?:DevicePanel;loading:boolean;error?:AppError;busy:boolean;message?:string;
  pending?:CountdownIntent;
  artwork?:()=>HTMLElement;
  toggle:(on:boolean)=>void;edit:(on:boolean)=>void;retry:()=>void;
}
export function delayCards(props:CountdownCardProps):HTMLElement {
  const {data,panel,loading,error,busy}=props;
  const group=element('div','outlet-delay-group');
  if(loading&&!data){group.append(deviceWait(props.artwork,'倒计时'));return group;}
  const reading=propertyReading(switchServices(panel)[0]?.properties.find(prop=>prop.name==='on'&&prop.format==='bool'));
  // Reported power selects display direction only. Scene permissions and real
  // scene readback determine whether countdown controls are available.
  const directions=typeof reading.value==='boolean'?[!reading.value]:[false,true];
  for(const on of directions){
    const view=data?.countdowns.find(item=>item.on===on),label=on?'延时开启':'延时关闭';
    const reason=countdownReason(data,view)??(!view?.active?durationProblem(view?.hours??null,view?.minutes??null):undefined);
    const pending=props.pending?.on===on?props.pending:undefined;
    const active=pending?.active??view?.active;
    const disabled=loading||busy||!!props.pending||!!reason;
    const remaining=pending?.active&&pending.hours!==undefined&&pending.minutes!==undefined?{hours:pending.hours,minutes:pending.minutes}:countdownDuration(view);
    const timeText=active&&remaining?`${remaining.hours?`${remaining.hours}小时`:''}${remaining.minutes?`${remaining.minutes}分钟`:''}`:durationText(view);
    const card=element('section','native-card outlet-delay-card');card.dataset.direction=on?'on':'off';card.setAttribute('aria-busy',String(busy||!!pending));
    const toggle=button('',`outlet-delay-toggle${active===true?' checked':''}`,()=>props.toggle(on));
    toggle.setAttribute('role','switch');toggle.setAttribute('aria-label',label);toggle.setAttribute('aria-checked',active==null?'mixed':String(active));toggle.disabled=disabled;toggle.setAttribute('aria-description',pending?'目标已显示，正在核对云端记录':reason??'');
    if(pending){toggle.dataset.pending=pending.phase;toggle.setAttribute('aria-busy','true');card.dataset.pending=pending.phase;}
    const time=button('','outlet-delay-time',()=>props.edit(on));time.setAttribute('aria-label',`设置${label}时间`);time.disabled=disabled||active!==true;
    time.setAttribute('aria-description',reason??(view?.active?'':'启用倒计时后可调整延迟时间。'));
    time.append(element('span','','延迟时间'),element('span','outlet-delay-duration',timeText,icon('chevron','outlet-delay-arrow original-right-chevron')));
    const clock=element('span','outlet-delay-icon',icon('clock'));
    card.append(element('div','outlet-delay-heading',clock,element('span','',label),toggle),time);
    const description=error?error.message:pending?pending.phase==='sending'?'目标已显示，正在提交并核对云端倒计时':'目标待确认，正在重新查询云端记录':busy?'正在提交并核对云端倒计时…':loading?'正在读取云端倒计时…':`${countdownText(view)}${reading.source==='reported'?' · 电源依据最近上报':''}`;
    card.setAttribute('aria-description',description);card.setAttribute('aria-description',description);
    card.dataset.countdownState=pending?pending.phase:loading?'loading':view?.active===true?'active':view?.active===false?'inactive':'unknown';
    group.append(card);
  }
  if(props.message){group.setAttribute('aria-description',props.message);group.setAttribute('aria-description',props.message);}
  if(error){group.setAttribute('aria-description',error.message);group.dataset.operationError=error.kind;}
  return group;
}

interface DurationDialogProps {draft:CountdownDraft;update:(draft:CountdownDraft)=>void;close:()=>void;save:()=>void}
/** APK 17285 -> 14630: time24 + isTimePeriod, independent of native cron UI. */
export function durationDialog(props:DurationDialogProps):HTMLElement {
  const {draft}=props;
  const overlay=element('div','countdown-modal-backdrop'),dialog=element('section','countdown-dialog');
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','countdown-duration-title');
  const title=element('h3','','延迟时间');title.id='countdown-duration-title';
  const subtitle=element('p','countdown-subtitle',`${draft.hours?`${draft.hours}小时`:''}${draft.minutes?`${draft.minutes}分钟`:''}`||'0分钟');
  const wheels=element('div','countdown-wheels');
  for(const [field,count,value,label] of [['hours',24,draft.hours,'小时'],['minutes',60,draft.minutes,'分钟']] as const){
    const wheel=element('div','countdown-wheel');wheel.setAttribute('role','spinbutton');wheel.tabIndex=0;
    wheel.setAttribute('aria-label',label);wheel.setAttribute('aria-valuemin','0');wheel.setAttribute('aria-valuemax',String(count-1));wheel.setAttribute('aria-valuenow',String(value));
    const choose=(next:number)=>{props.update({...draft,[field]:(next+count)%count});document.querySelector<HTMLElement>(`.countdown-wheel[aria-label="${label}"]`)?.focus({preventScroll:true});};
    for(let offset=-2;offset<=2;offset++){
      const number=(value+offset+count)%count,row=button(String(number).padStart(2,'0'),`countdown-wheel-number${offset===0?' selected':''}`,()=>choose(number));row.tabIndex=-1;row.setAttribute('aria-label',`${number}${label}`);
      if(offset===0)row.append(element('small','',label));wheel.append(row);
    }
    wheel.addEventListener('wheel',event=>{event.preventDefault();if(event.deltaY)choose(value+(event.deltaY>0?1:-1));},{passive:false});
    wheel.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();choose(event.key==='Home'?0:event.key==='End'?count-1:value+(event.key==='ArrowDown'?1:-1));}});wheels.append(wheel);
  }
  const save=button('确定','countdown-save',props.save),problem=durationProblem(draft.hours,draft.minutes);save.disabled=!!problem;save.setAttribute('aria-description',problem??'');
  dialog.append(element('header','countdown-dialog-heading',title,subtitle),wheels,element('div','countdown-dialog-actions',button('取消','countdown-cancel',props.close),save));
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const stops=[...dialog.querySelectorAll<HTMLElement>('[tabindex="0"],button:not([disabled]):not([tabindex="-1"])')],first=stops[0],last=stops.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  dismissOnBackdrop(overlay,props.close);overlay.append(dialog);return overlay;
}
