import {dismissOnBackdrop} from './dialog-dismiss';
import {officialIcon} from '../icons';
import { calendarDates, dateKey, parseDateKey, selectableDate } from '../history';
import { button, element } from './dom';

export interface CalendarPickerState { month:Date;panel:'day'|'month' }

export interface CalendarPickerView {
  date:string;period:'day'|'month';picker:CalendarPickerState;
  select:(date:string)=>void;showPicker:(picker:CalendarPickerState|undefined)=>void;
}
export function calendarPicker(props: CalendarPickerView): HTMLElement {
  const month=props.picker!.month,period=props.picker!.panel;
  const selected=parseDateKey(props.date),today=new Date();
  const overlay=element('div','history-picker-overlay');
  const dialog=element('section',`history-date-picker picker-${period}`);dialog.tabIndex=-1;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',period==='day'?'选择日期':'选择月份');
  const close=()=>props.showPicker(undefined);
  dismissOnBackdrop(overlay,close);
  dialog.append(element('h2','',period==='day'?'选择日期':'选择月份'));
  const heading=element('div','history-picker-heading');
  for(const direction of [-1,1]){
    const target=period==='day'?new Date(month.getFullYear(),month.getMonth()+direction,1):new Date(month.getFullYear()+direction,0,1);
    const nav=button('',`history-picker-nav ${direction<0?'previous':'next'}`,()=>props.showPicker({month:target,panel:period}));nav.append(officialIcon('chevron'));nav.setAttribute('aria-label',`${direction<0?'上一':'下一'}${period==='day'?'月':'年'}`);
    nav.disabled=period==='day'?!selectableDate(target,'month',today):target.getFullYear()<today.getFullYear()-1||target.getFullYear()>today.getFullYear();
    if(direction<0){
      const label=period==='day'?button(`${month.getFullYear()}/${String(month.getMonth()+1).padStart(2,'0')}`,'history-picker-middle',()=>props.showPicker({month,panel:'month'})):element('span','',String(month.getFullYear()));
      if(period==='day')label.setAttribute('aria-label','按月份选择日期');heading.append(nav,label);
    }else heading.append(nav);
  }
  dialog.append(heading);
  if(period==='day')dialog.append(element('div','history-picker-week',...['日','一','二','三','四','五','六'].map(day=>element('span','',day))));
  const grid=element('div',`history-picker-grid grid-${period}`);
  const dates=period==='day'?calendarDates(month):Array.from({length:12},(_,index)=>new Date(month.getFullYear(),index,1));
  for(const date of dates){
    const isSelected=period==='day'?dateKey(date)===dateKey(selected):date.getFullYear()===selected.getFullYear()&&date.getMonth()===selected.getMonth();
    const cell=button(String(period==='day'?date.getDate():date.getMonth()+1),`${isSelected?'selected':''}${period==='day'&&date.getMonth()!==month.getMonth()?' adjacent':''}`,()=>{
      if(period==='month'&&props.period==='day')props.showPicker({month:date,panel:'day'});
      else props.select(dateKey(date));
    });
    cell.disabled=!selectableDate(date,period,today);cell.setAttribute('aria-label',period==='day'?dateKey(date):`${date.getFullYear()}年${date.getMonth()+1}月`);cell.setAttribute('aria-pressed',String(isSelected));
    if(dateKey(date)===dateKey(today))cell.setAttribute('aria-current','date');grid.append(cell);
  }
  dialog.append(grid,button('取消','history-picker-cancel',close));
  dialog.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.stopPropagation();close();}
    if(event.key==='Tab'){
      const buttons=[...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if(event.shiftKey&&(document.activeElement===buttons[0]||document.activeElement===dialog)){event.preventDefault();buttons.at(-1)?.focus();}
      else if(!event.shiftKey&&document.activeElement===buttons.at(-1)){event.preventDefault();buttons[0]?.focus();}
    }
  });
  queueMicrotask(()=>{if(dialog.isConnected)dialog.focus();});
  overlay.append(dialog);return overlay;
}
