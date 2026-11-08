import {deviceSurfaces} from './device-surfaces';
import {officialIcon} from '../icons';
import { calendarDates, dateKey, sensorHistorySlots, parseDateKey, selectableDate } from '../history';
import type { AppError, HistoryPeriod, HistorySelection, SensorHistory } from '../types';
import { button, element } from './dom';
import { historyDetailChart } from './history-chart';
import {deviceWait} from './device-loading';

export interface HistoryDetailView {
  selection: HistorySelection; data?: SensorHistory; loading: boolean; error?: AppError;
  picker?: { month: Date; panel: 'day'|'month' }; select: (selection: HistorySelection)=>void;
  showPicker: (picker: HistoryDetailView['picker'])=>void; back: ()=>void; retry: ()=>void;artwork?:()=>HTMLElement;
}

export function renderHistoryDetail(props: HistoryDetailView): HTMLElement {
  const stage=element('div','device-stage');
  const page=element('section','device-page page-history-detail');page.setAttribute('aria-label','温湿度历史数据');
  const back=button('','page-icon-button',props.back,'back');back.setAttribute('aria-label','返回温湿度设备');
  page.append(element('header','device-page-header',back));
  const body=element('div','device-page-scroll history-detail-content',element('h1','history-detail-title','历史数据'));
  const tabs=element('div','history-detail-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','历史周期');
  for(const [period,label] of [['day','日'],['month','月'],['year','年']] as [HistoryPeriod,string][]){
    const tab=button(label,props.selection.period===period?'selected':'',()=>{if(period!==props.selection.period)props.select({period,date:dateKey(new Date())});});
    tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(period===props.selection.period));tabs.append(tab);
  }
  body.append(tabs);
  const date=parseDateKey(props.selection.date);
  if(props.selection.period!=='year'){
    const dateButton=button(`${props.selection.period==='day'?date.getMonth()+1:date.getFullYear()}/${props.selection.period==='day'?String(date.getDate()).padStart(2,'0'):String(date.getMonth()+1).padStart(2,'0')}`,'history-detail-date',()=>props.showPicker({month:new Date(date.getFullYear(),date.getMonth(),1),panel:props.selection.period==='month'?'month':'day'}));
    dateButton.append(officialIcon('calendar:dropdown','history-date-arrow'));dateButton.setAttribute('aria-label',props.selection.period==='day'?'选择日期':'选择月份');dateButton.setAttribute('aria-expanded',String(!!props.picker));body.append(dateButton);
  }
  const charts=element('div',`history-detail-channels${props.selection.period==='year'?' without-date':''}`);
  charts.dataset.historyState=props.loading?'loading':props.error?'error':'loaded';charts.dataset.period=props.selection.period;charts.dataset.date=props.selection.date;
  const displayedHistory=sensorHistorySlots(props.data,props.selection);
  if(props.loading&&!props.data)charts.append(deviceWait(props.artwork,'历史数据'));
  else for(const [name,unit,precision] of [['temperature','℃',1],['humidity','%',0]] as const){
    const channel=props.data?.channels.find(channel=>channel.name===name);
    const slots=displayedHistory[name];
    const message=props.error?.message??channel?.error??(!slots.some(slot=>slot.high!==null||slot.low!==null)?'暂无云端记录':undefined);
    if(message){
      const placeholder=element('section','history-detail-channel',element('h3','',name==='temperature'?'温度':'湿度'),element('div','history-detail-status',message));
      if((props.error||channel?.error)&&!props.loading&&props.error?.retryable!==false)placeholder.append(button('重试','history-detail-retry',props.retry));
      charts.append(placeholder);
    }else charts.append(historyDetailChart(slots,props.selection,unit,precision));
  }
  charts.setAttribute('aria-description','云端历史；两路同时缺测保留空白。');body.append(charts);
  for(const warning of props.data?.warnings??[])body.append(element('p','sensor-history-warning',warning));
  page.append(body);if(props.picker)page.append(calendarPicker({date:props.selection.date,period:props.selection.period==='month'?'month':'day',picker:props.picker,select:date=>props.select({...props.selection,date}),showPicker:props.showPicker}));stage.append(page);return deviceSurfaces(stage);
}

export interface CalendarPickerView {
  date:string;period:'day'|'month';picker:NonNullable<HistoryDetailView['picker']>;
  select:(date:string)=>void;showPicker:HistoryDetailView['showPicker'];
}
export function calendarPicker(props: CalendarPickerView): HTMLElement {
  const month=props.picker!.month,period=props.picker!.panel;
  const selected=parseDateKey(props.date),today=new Date();
  const overlay=element('div','history-picker-overlay');
  const dialog=element('section',`history-date-picker picker-${period}`);dialog.tabIndex=-1;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',period==='day'?'选择日期':'选择月份');
  const close=()=>props.showPicker(undefined);
  overlay.addEventListener('click',event=>{if(event.target===overlay)close();});
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
