import {icon} from '../icons';
import type {WaterSelection} from '../purifier-history';
import {calendarDates,dateKey,parseDateKey} from '../history';
import {button,element} from './dom';

// Vendor v39 11903: a local draft, 12 year/month cells, releaseYear=2023.
// Confirm advances year → month → day until the requested selector is reached.
export interface PurifierCalendar {date:string;panel:'day'|'month'|'year';yearEnd:number}
export function openPurifierCalendar(selection:WaterSelection):PurifierCalendar{return{date:selection.date,panel:selection.period==='week'?'day':selection.period,yearEnd:parseDateKey(selection.date).getFullYear()};}
export function purifierCalendar(selection:WaterSelection,state:PurifierCalendar,change:(next:PurifierCalendar|undefined)=>void,select:(date:string)=>void):HTMLElement{
 const selected=parseDateKey(state.date),today=new Date(),year=selected.getFullYear(),month=selected.getMonth(),origin=selection.period==='week'?'day':selection.period;
 const overlay=element('div','history-picker-overlay'),dialog=element('section',`history-date-picker purifier-calendar picker-${state.panel}`),close=()=>change(undefined);
 const labels={day:'选择日期',month:'选择月份',year:'选择年份'};dialog.tabIndex=-1;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',labels[state.panel]);
 overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
 dialog.append(element('h2','',labels[state.panel]));
 const heading=element('div','history-picker-heading');
 const withDate=(y:number,m:number,day=selected.getDate())=>dateKey(new Date(y,m,Math.min(day,new Date(y,m+1,0).getDate())));
 const navigate=(direction:number)=>{
  if(state.panel==='year')change({...state,yearEnd:direction<0?state.yearEnd-12:Math.min(today.getFullYear(),state.yearEnd+12)});
  else change({...state,date:state.panel==='month'?withDate(year+direction,month):withDate(year,month+direction)});
 };
 const previous=button('','history-picker-nav previous',()=>navigate(-1)),next=button('','history-picker-nav next',()=>navigate(1));
 previous.append(icon('chevron'));next.append(icon('chevron'));previous.setAttribute('aria-label',state.panel==='day'?'上一月':state.panel==='month'?'上一年':'上一组年份');next.setAttribute('aria-label',state.panel==='day'?'下一月':state.panel==='month'?'下一年':'下一组年份');
 previous.disabled=state.panel==='year'?state.yearEnd-11<=2023:state.panel==='month'?year<=2023:year===2023&&month===0;
 next.disabled=state.panel==='year'?state.yearEnd>=today.getFullYear():state.panel==='month'?year>=today.getFullYear():year===today.getFullYear()&&month>=today.getMonth();
 const title=button(state.panel==='year'?`${state.yearEnd-11} / ${state.yearEnd}`:state.panel==='month'?`${year}年`:`${year}/${String(month+1).padStart(2,'0')}`,'history-picker-middle',()=>change({...state,panel:state.panel==='day'?'month':'year',yearEnd:year}));title.disabled=state.panel==='year';title.setAttribute('aria-label',state.panel==='day'?'按月份选择日期':'按年份选择日期');heading.append(previous,title,next);dialog.append(heading);
 if(state.panel==='day')dialog.append(element('div','history-picker-week',...['日','一','二','三','四','五','六'].map(day=>element('span','',day))));
 const grid=element('div',`history-picker-grid purifier-calendar-grid grid-${state.panel}`);
 const dates=state.panel==='day'?calendarDates(selected):Array.from({length:12},(_,i)=>state.panel==='month'?new Date(year,i,1):new Date(state.yearEnd-11+i,0,1));
 for(const date of dates){
  const y=date.getFullYear(),m=date.getMonth(),isSelected=state.panel==='year'?y===year:state.panel==='month'?m===month&&y===year:dateKey(date)===state.date;
  const label=state.panel==='day'?dateKey(date):state.panel==='month'?`${y}年${m+1}月`:`${y}年`;
  const cell=button(state.panel==='day'?String(date.getDate()):state.panel==='month'?`${m+1}月`:`${y}年`,`${isSelected?'selected':''}${state.panel==='day'&&m!==month?' adjacent':''}`,()=>change({...state,date:state.panel==='day'?dateKey(date):withDate(y,state.panel==='year'?month:m)}));
  cell.disabled=y<2023||(state.panel==='year'?y>today.getFullYear():state.panel==='month'?y>today.getFullYear()||y===today.getFullYear()&&m>today.getMonth():date>today);cell.setAttribute('aria-label',label);cell.setAttribute('aria-pressed',String(isSelected));grid.append(cell);
 }
 const confirm=button('确定','',()=>{if(state.panel!==origin)change({...state,panel:state.panel==='year'?'month':'day'});else select(origin==='month'?dateKey(new Date(year,month,1)):origin==='year'&&selected>today?dateKey(today):state.date);});
 confirm.disabled=year<2023||(state.panel==='year'?year>today.getFullYear():state.panel==='month'?year>today.getFullYear()||year===today.getFullYear()&&month>today.getMonth():selected>today);
 dialog.append(grid,element('footer','purifier-calendar-actions',button('取消','history-picker-cancel',close),confirm));
 dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();}if(event.key==='Tab'){const buttons=[...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];if(event.shiftKey&&(document.activeElement===buttons[0]||document.activeElement===dialog)){event.preventDefault();buttons.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===buttons.at(-1)){event.preventDefault();buttons[0]?.focus();}}});
 queueMicrotask(()=>{if(dialog.isConnected)dialog.focus();});overlay.append(dialog);return overlay;
}
