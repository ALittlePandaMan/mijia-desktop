import {dismissOnBackdrop} from './dialog-dismiss';
import {durationProblem,type CountdownDraft} from '../countdown';
import {button,element} from './dom';

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
