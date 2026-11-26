import './fryer-page.css';
import {dismissOnBackdrop} from './dialog-dismiss';
import {button,element} from './dom';
import {purifierWheel} from './purifier-wheel';

interface Props {
 durationMinutes?:number;
 earliestAt:number;
 blocked:boolean;
 problem:(at:number)=>string|undefined;
 submit:(at:number)=>void;
 close:()=>void;
}

export function trapWheelDialog(dialog:HTMLElement,close:()=>void):void {
 dialog.tabIndex=-1;
 dialog.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
  if(event.key!=='Tab')return;
  const items=[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]),input:not(:disabled),[role="listbox"]')];
  if(event.shiftKey&&(document.activeElement===dialog||document.activeElement===items[0])){
   event.preventDefault();items.at(-1)?.focus();
  }else if(!event.shiftKey&&document.activeElement===items.at(-1)){
   event.preventDefault();items[0]?.focus();
  }
 });
 queueMicrotask(()=>{if(dialog.isConnected)dialog.focus();});
}

export function reservationPicker(props:Props):HTMLElement {
 const overlay=element('div','fryer-backdrop');
 const dialog=element('section','fryer-dialog');
 dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','预约完成时间');
 const title=element('h3'),subtitle=element('p','fryer-reservation-start');
 dialog.append(title,subtitle);
 const today=new Date(),initial=new Date(Math.ceil(props.earliestAt/60)*60_000);
 let day=initial.toDateString()===today.toDateString()?0:1,hour=initial.getHours(),minute=initial.getMinutes();
 const pad=(value:number)=>String(value).padStart(2,'0');
 const clock=(seconds:number)=>{
  const date=new Date(seconds*1000);
  return `${date.toDateString()===today.toDateString()?'今天':'明天'} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
 };
 const at=()=>{
  const date=new Date(today);date.setDate(date.getDate()+day);date.setHours(hour,minute,0,0);
  return date.getTime()/1000;
 };
 const confirm=button('确定','primary',()=>{
  const end=at();
  if(!props.blocked&&!props.problem(end))props.submit(end);
 });
 const update=()=>{
  const end=at(),problem=props.problem(end);
  title.textContent=problem??`预计${clock(end)} 完成`;
  subtitle.textContent=!problem&&props.durationMinutes!==undefined?`开始时间${clock(end-props.durationMinutes*60)}`:'';
  confirm.disabled=!!problem||props.blocked;
 };
 const days=purifierWheel('日期',[0,1],day,value=>{day=value;update();},value=>value?'明天':'今天');
 const hours=purifierWheel('时',Array.from({length:24},(_,i)=>i),hour,value=>{hour=value;update();},value=>`${pad(value)}时`);
 const minutes=purifierWheel('分',Array.from({length:60},(_,i)=>i),minute,value=>{minute=value;update();},value=>`${pad(value)}分`);
 dialog.append(element('div','fryer-wheels fryer-reservation-wheels',days.node,hours.node,minutes.node),
  element('footer','',button('取消','',props.close),confirm));
 update();dismissOnBackdrop(overlay,props.close);overlay.append(dialog);trapWheelDialog(dialog,props.close);
 return overlay;
}
