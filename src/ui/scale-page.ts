import {icon} from '../icons';
import {dateKey} from '../history';
import {missingReadingText} from '../logic';
import {
  customScaleRange,scaleDay,scaleEarliest,scaleMetrics,scalePeriods,scaleValue,
  type ScaleHistoryState,type ScaleMeasurement,type ScaleMember,type ScaleMetric,
} from '../scale-history';
import type {AccountProfile,Device} from '../types';
import {cameraDatePicker} from './camera-date-picker';
import {deviceWait} from './device-loading';
import {bindDialogFocus} from './dialog-focus';
import {dismissOnBackdrop} from './dialog-dismiss';
import {button,element} from './dom';
import {actionFooter,footerButton} from './action-footer';
import {dropdownSelect} from './dropdown';
import {scaleWeightChart} from './history-chart';
import {scaleAvatar} from './scale-assets';
import './scale-page.css';

type ScaleAccount={id:string;profile:AccountProfile};
const overviewTrendLimit=8;
const overviewMetrics=['bmi','bodyFat','muscle'] as const;
const historyMetrics:ScaleMetric[]=['weight','bodyFat','muscleRate'];
const reportMetrics:Exclude<ScaleMetric,'weight'>[]=[
  'bmi','bodyFat','muscle','muscleRate','water','protein','boneMass','skeletalMuscle',
  'visceralFat','basalMetabolism','bodyAge','heartRate',
];
const reading=new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2});
const weight=new Intl.NumberFormat('zh-CN',{minimumFractionDigits:1,maximumFractionDigits:2,useGrouping:false});
const dateTime=new Intl.DateTimeFormat('zh-CN',{
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
});

function measuredAt(record:ScaleMeasurement):HTMLTimeElement {
  const time=element('time','scale-time',dateTime.format(record.timeMs));
  time.dateTime=new Date(record.timeMs).toISOString();
  return time;
}

function availableMetrics(record:ScaleMeasurement,keys:readonly ScaleMetric[]):ScaleMetric[] {
  return keys.filter(key=>Number.isFinite(scaleValue(record,key)));
}

function metrics(record:ScaleMeasurement,keys:readonly ScaleMetric[],className:string,showMissing=false):HTMLDListElement {
  const values=element('dl',className);
  for(const key of keys){
    const value=scaleValue(record,key);
    const present=value!==undefined&&Number.isFinite(value);
    if(!present&&!showMissing)continue;
    const [label,unit]=metricInfo(key);
    const item=element('div','scale-metric',element('dt','reading-summary-label',label),
      element('dd',present?'reading-summary-value':'reading-summary-value reading-unavailable',
        present?reading.format(value):missingReadingText,present&&unit?element('small','scale-unit',unit):null));
    item.dataset.scaleMetric=key;
    values.append(item);
  }
  return values;
}

function projectSummary(summary:HTMLElement,record:ScaleMeasurement,state:ScaleHistoryState):void {
  const weightOnly=!state.compositionSupported;
  const values=metrics(record,weightOnly?['weight']:overviewMetrics,'reading-summary-grid scale-summary-metrics',true);
  values.style.setProperty('--reading-columns',String(values.childElementCount));
  const open=button('查看报告','button scale-report-open',()=>state.showReport(record));
  open.dataset.focusKey='scale-report-open';
  open.disabled=state.loading;
  summary.dataset.summaryType=weightOnly?'weight':'composition';
  summary.replaceChildren(...(weightOnly?[element('h3','reading-summary-title','称重记录'),values,open]:[values,open]));
}

function reportContent(record:ScaleMeasurement):HTMLElement {
  const bodyWeight=metrics(record,['weight'],'reading-summary-grid');
  const readings=metrics(record,reportMetrics,'scale-report');
  return element('div','scale-report-content',
    element('section','native-card reading-summary-card scale-report-summary',bodyWeight,measuredAt(record)),
    readings.childElementCount?readings:undefined);
}

function memberName(member:ScaleMember,account?:ScaleAccount):string {
  return member.id===account?.id?account.profile.displayName||member.name:member.name;
}

function memberAvatar(member:ScaleMember,account?:ScaleAccount):HTMLImageElement {
  return scaleAvatar(member.icon,member.id===account?.id?account.profile.avatarUrl:undefined);
}

function memberPicker(state:ScaleHistoryState,account?:ScaleAccount,overview=false):HTMLElement|undefined {
  const member=state.activeMember;
  if(!member)return;
  if(!overview&&state.members.length===1)return element('span','scale-member-name',memberName(member,account));
  const choice=dropdownSelect({label:'称重成员',className:'scale-member',
    options:state.members.map(item=>({value:item.id,label:memberName(item,account)})),value:member.id,
    change:id=>state.select(id)});
  choice.dataset.focusKey='scale-member';
  if(overview){
    choice.classList.add('scale-member-strip');
    const avatar=element('span','scale-member-portrait',memberAvatar(member,account),
      element('span','scale-member-badge',icon('refresh')));
    choice.replaceChildren(avatar,element('span','scale-member-copy',choice.querySelector('.dropdown-value'),
      element('small','','点击更换使用者')));
  }
  return choice;
}

function weightDisplay(kg:number):HTMLElement {
  const [whole,fraction]=weight.format(kg).split('.');
  return element('div','scale-weight',
    element('strong','',whole,element('span','scale-weight-fraction','.'+fraction)),
    element('small','scale-weight-unit','kg'));
}

function entry(label:string,kind:'history'|'pending',open:()=>void):HTMLButtonElement {
  const item=button('','native-card scale-entry',open);
  item.append(element('span','scale-entry-icon',icon(kind==='history'?'clock':'records')),
    element('strong','',label));
  return item;
}

function emptyState(label='暂无内容',artwork?:()=>HTMLElement):HTMLElement {
  return element('div','scale-empty',
    artwork?artwork():element('span','scale-empty-mark',icon('records')),element('p','scale-empty-label',label));
}

function comparison(record:ScaleMeasurement,previous?:ScaleMeasurement):HTMLElement {
  const line=element('p','scale-weight-change');
  const bmi=record.metrics.bmi;
  if(bmi!=null&&record.adultBmi){
    const band=bmi<18.5?'偏低':bmi<24?'标准':bmi<28?'偏高':'过高';
    line.append(element('span','',band));
  }
  if(previous){
    const days=scaleDay(record.timeMs)-scaleDay(previous.timeMs);
    const reference=days>0?`相比${days}日前`:'相比上次';
    const delta=Math.round((record.weight-previous.weight)*100)/100;
    line.append(element('span','',reference+(delta===0?'持平':(delta>0?'上升':'下降')+reading.format(Math.abs(delta))+'kg')));
  }
  return line;
}

function overviewContent(state:ScaleHistoryState,artwork:()=>HTMLElement,account?:ScaleAccount):HTMLElement {
  const content=element('div','scale-overview-content');
  const member=memberPicker(state,account,true);
  if(member)content.append(member);
  const current=state.selectedPoint(state.recent);
  const summary=current?element('section','native-card reading-summary-card scale-body-summary'):undefined;
  if(current&&summary){
    const hero=element('section','scale-hero');
    hero.setAttribute('aria-live','polite');
    const project=(record:ScaleMeasurement)=>{
      state.choosePoint(record);
      const previous=state.recent[state.recent.indexOf(record)+1];
      hero.replaceChildren(weightDisplay(record.weight),measuredAt(record),comparison(record,previous));
      projectSummary(summary,record,state);
    };
    project(current);
    content.append(hero);
    const trend=state.recent.slice(0,overviewTrendLimit);
    if(new Set(trend.map(record=>record.timeMs)).size>1){
      content.append(element('section','scale-trend scale-overview-trend',scaleWeightChart(trend,'weight',current,project,'overview')));
    }
  }else if(state.latestWeight!==undefined){
    content.append(element('section','scale-hero',
      element('h3','scale-reading-label','设备读数'),weightDisplay(state.latestWeight)));
  }else if(state.loading)content.append(deviceWait(undefined,'称重数据'));
  else{
    const message=state.error?'暂时无法读取称重数据':state.source==='unavailable'?'此型号暂无可读取的称重数据':
      state.source==='deviceReading'?'暂无体重读数':state.report?.omitted?'暂无可用的测量记录':'暂无测量记录';
    const empty=emptyState(message,artwork);
    if(state.error){
      const retry=button('重试','button button-secondary',()=>state.refresh());
      retry.dataset.focusKey='scale-refresh';
      empty.append(retry);
    }
    content.append(empty);
  }
  if(state.error&&current)content.append(element('p','scale-record-error','称重记录刷新失败'));
  const history=state.historyAvailable?entry('历史数据','history',()=>state.show('history')):undefined;
  if(history)history.disabled=state.loading;
  const pending=state.pendingSupported?entry('待领数据','pending',()=>state.show('pending')):undefined;
  if(pending)pending.disabled=state.loading||!state.activeMember;
  if(history||pending){
    const entries=element('nav','scale-entries',history,pending);
    entries.setAttribute('aria-label','称重数据');
    content.append(entries);
  }
  if(summary)content.append(summary);
  return content;
}

const dateText=(time:number)=>dateKey(new Date(time)).replaceAll('-','/');
const rangeText=(state:ScaleHistoryState)=>dateText(state.range.start)+' – '+dateText(state.range.end);

function rangePicker(anchor:HTMLElement,state:ScaleHistoryState):void {
  const today=dateKey(new Date()),minimum=dateKey(new Date(scaleEarliest));
  const start=dateKey(new Date(state.range.start)),end=dateKey(new Date(state.range.end));
  cameraDatePicker(anchor,start,first=>{
    cameraDatePicker(anchor,first>end?first:end,last=>{
      const range=customScaleRange(first,last);
      if(range)state.applyRange(range);
    },first,{title:'选择结束日期',today});
  },minimum,{title:'选择开始日期',today});
}

const metricInfo=(metric:ScaleMetric):readonly [string,string]=>metric==='weight'?['体重','kg']:scaleMetrics[metric];

function scaleDialog(anchor:HTMLButtonElement,title:string,content:HTMLElement,className:string,
  {restore,cancelLabel}:{restore?:()=>void;cancelLabel?:string}={}):HTMLDialogElement|undefined {
  const page=anchor.closest('.page-scale');
  if(!page)return;
  const dialog=element('dialog','scale-dialog '+className);
  const close=()=>dialog.close();
  dialog.setAttribute('aria-label',title);
  dialog.append(element('header','scale-dialog-header',element('h2','',title),
    cancelLabel?null:button('','page-icon-button',close,'close')),content);
  if(cancelLabel)dialog.append(button(cancelLabel,'button scale-secondary scale-dialog-cancel',close));
  dialog.addEventListener('close',()=>{
    restore?.();
    dialog.remove();
    if(anchor.isConnected)anchor.focus({preventScroll:true});
  },{once:true});
  dismissOnBackdrop(dialog,close);
  dialog.addEventListener('keydown',event=>{
    if(event.key==='Tab')event.stopPropagation();
  });
  page.append(dialog);
  dialog.showModal();
  bindDialogFocus(dialog,close);
  return dialog;
}

function historyMetric(state:ScaleHistoryState,metric:ScaleMetric,records:ScaleMeasurement[]):HTMLElement {
  const [label,unit]=metricInfo(metric);
  const section=element('section','scale-history-metric',element('h3','',label));
  section.dataset.metric=metric;
  const rows=records.filter(row=>scaleValue(row,metric)!=null);
  let selected=state.selectedPoint(rows,metric);
  if(!selected){
    section.append(element('div','scale-history-number','--',element('small','scale-unit',unit)),emptyState(state.error?'暂时无法读取历史数据':'暂无内容'));
    return section;
  }
  const number=element('strong'),time=measuredAt(selected);
  const open=button('','scale-history-value',()=>{if(selected)state.showReport(selected);});
  open.dataset.focusKey='scale-reading-'+metric;
  open.disabled=state.loading;
  open.append(element('div','scale-history-number',number,element('small','scale-unit',unit)),time,icon('chevron'));
  const select=(row:ScaleMeasurement)=>{
    selected=row;
    state.choosePoint(row,metric);
    number.textContent=reading.format(scaleValue(row,metric)!);
    time.textContent=dateTime.format(row.timeMs);
    time.dateTime=new Date(row.timeMs).toISOString();
    open.setAttribute('aria-label',label+' '+number.textContent+unit+'，查看测量报告');
  };
  select(selected);
  section.append(open);
  if(rows.length>1&&rows[0].timeMs!==rows.at(-1)!.timeMs){
    const chart=scaleWeightChart(rows,metric,selected,select);
    const expand=button('','scale-chart-expand',()=>{
      const slot=chart.parentElement!;
      scaleDialog(expand,label+'趋势',chart,'scale-chart-dialog',{restore:()=>slot.append(chart)});
    },'fullscreen');
    expand.setAttribute('aria-label','放大'+label+'趋势');
    section.append(element('div','scale-history-chart',expand,chart));
  }
  return section;
}

function trendChanges(state:ScaleHistoryState,records:ScaleMeasurement[]):HTMLElement|undefined {
  if(!records.length||!state.report||state.report.nextBefore!==null||state.report.omitted)return;
  const deltas=element('dl','scale-trend-changes');
  for(const metric of historyMetrics){
    const rows=records.filter(row=>scaleValue(row,metric)!=null);
    if(rows.length<2||rows[0].timeMs===rows.at(-1)!.timeMs)continue;
    const [label,unit]=metricInfo(metric);
    const delta=Math.round((scaleValue(rows[0],metric)!-scaleValue(rows.at(-1)!,metric)!)*100)/100;
    deltas.append(element('div','',element('dt','',label+'变化'),element('dd','',
      (delta>0?'+':'')+reading.format(delta),element('small','scale-unit',unit))));
  }
  if(!deltas.childElementCount)return;
  const days=scaleDay(state.range.end)-scaleDay(state.range.start)+1;
  return element('section','scale-change-summary',element('h3','','趋势变化'),
    element('p','',days+'天的身体数据变化'),deltas);
}

function historyContent(state:ScaleHistoryState):HTMLElement {
  const tabs=element('nav','scale-periods');
  tabs.setAttribute('aria-label','历史日期范围');
  const date=button(rangeText(state),'scale-range-date',()=>rangePicker(date,state),'chevron');
  date.dataset.focusKey='scale-range';
  for(const [days,label] of scalePeriods){
    const tab=button(label,'scale-period',()=>state.setPeriod(days));
    tab.setAttribute('aria-pressed',String(state.period===days));
    tab.dataset.focusKey='scale-period-'+days;
    tabs.append(tab);
  }
  const custom=button('自定义','scale-period',()=>rangePicker(custom,state));
  custom.setAttribute('aria-pressed',String(state.period==='custom'));
  custom.dataset.focusKey='scale-period-custom';
  tabs.append(custom);

  const content=element('div','scale-history-content',tabs,date);
  const rows=state.report?.records??[];
  if(state.loading&&!state.report){content.append(deviceWait(undefined,'历史数据'));return content;}
  for(const metric of historyMetrics){
    const hasReadings=rows.some(row=>scaleValue(row,metric)!=null)||!state.error&&state.recent.some(row=>scaleValue(row,metric)!=null);
    if(metric==='weight'||hasReadings)content.append(historyMetric(state,metric,rows));
  }
  const changes=trendChanges(state,rows);
  if(changes)content.append(changes);
  const extra=reportMetrics.filter(metric=>!historyMetrics.includes(metric)&&rows.some(row=>scaleValue(row,metric)!=null));
  if(extra.length){
    const other=element('details','scale-other-metrics',element('summary','','其他指标'));
    const renderMetrics=()=>{
      if(other.open&&other.childElementCount===1)for(const metric of extra)other.append(historyMetric(state,metric,rows));
    };
    other.open=state.otherMetricsOpen;
    renderMetrics();
    other.addEventListener('toggle',()=>{
      if(!other.isConnected)return;
      state.otherMetricsOpen=other.open;
      renderMetrics();
    });
    content.append(other);
  }
  if(state.report?.nextBefore!=null){
    const more=button('加载更早记录','button scale-report-open',()=>state.next());
    more.dataset.focusKey='scale-next';
    more.disabled=state.loading;
    content.append(more);
  }
  return content;
}

function pagination(state:ScaleHistoryState):HTMLElement|undefined {
  if(!state.page&&state.report?.nextBefore==null)return;
  const previous=button('上一页','button button-small button-secondary',()=>state.previous());
  const next=button('更早记录','button button-small button-secondary',()=>state.next());
  previous.disabled=state.loading||state.page===0;
  next.disabled=state.loading||state.report?.nextBefore==null;
  previous.dataset.focusKey='scale-previous';
  next.dataset.focusKey='scale-next';
  return element('nav','scale-pagination',previous,element('span','','第 '+(state.page+1)+' 页'),next);
}

const monthKey=(time:number)=>dateKey(new Date(time)).slice(0,7);
const clockTime=new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});

function recordMonthPicker(state:ScaleHistoryState,first?:ScaleMeasurement):HTMLElement {
  const options=[{value:'',label:'最新记录'}];
  const cursor=new Date(),earliest=new Date(scaleEarliest);
  cursor.setDate(1);
  const minimum=monthKey(earliest.getTime());
  for(let month=monthKey(cursor.getTime());month>=minimum;month=monthKey(cursor.getTime())){
    options.push({value:month,label:month.replace('-','/')});
    cursor.setMonth(cursor.getMonth()-1);
  }
  const selected=state.recordsMonth??monthKey(first?.timeMs??Date.now());
  const choice=dropdownSelect({label:'跳转到月份',className:'scale-record-month',value:selected,options,change:value=>state.jumpToMonth(value)});
  choice.disabled=!state.historyAvailable||state.source==='memberCloud'&&!state.activeMember;
  choice.dataset.focusKey='scale-record-month';
  return choice;
}

function recordList(state:ScaleHistoryState,pending:boolean):HTMLElement {
  const heading=element('header','scale-list-header',element('h2','scale-list-title',pending?'待认领数据':'全部记录'));
  const content=element('div','scale-record-list',heading);
  const rows=state.report?.records??[];
  if(!pending)heading.append(recordMonthPicker(state,rows[0]));
  if(state.mutationError&&!state.loading){
    const error=element('p','scale-record-error',state.mutationError.message||'暂时无法处理所选记录。');
    error.setAttribute('role','alert');
    content.append(error);
  }
  let lastGroup:string|undefined;
  const today=scaleDay(Date.now());
  for(const row of rows){
    const daysAgo=today-scaleDay(row.timeMs);
    const group=pending?(daysAgo===0?'今天':daysAgo===1?'昨天':'更多'):dateText(row.timeMs);
    if(group!==lastGroup){content.append(element('h3','scale-record-group',group));lastGroup=group;}
    const value=element('strong','scale-record-weight','体重 '+weight.format(row.weight)+(pending?' kg':'kg'));
    const time=measuredAt(row);
    if(!pending)time.textContent=clockTime.format(row.timeMs);
    const copy=element('span','scale-record-copy',value,time);
    if(pending){
      const check=element('input','scale-record-check');
      check.type='checkbox';
      check.checked=state.selectedKeys.has(row.key);
      check.disabled=state.loading||!state.editable;
      check.setAttribute('aria-label','选择 '+dateTime.format(row.timeMs)+' '+value.textContent);
      check.dataset.focusKey='scale-select-'+row.key;
      check.addEventListener('change',()=>state.selectRecord(row.key,check.checked));
      content.append(element('label','scale-record-row',copy,check));
    }else {
      const item=button('','scale-record-row',()=>state.showReport(row));
      item.disabled=state.loading;
      item.dataset.focusKey='scale-record-'+row.key;
      item.append(copy,icon('chevron'));
      content.append(item);
    }
  }
  if(state.loading&&!state.report)content.append(deviceWait(undefined,'称重记录'));
  else if(!rows.length){
    if(state.error)content.append(emptyState('暂时无法读取称重记录'));
    else if(!pending)content.append(emptyState('暂无内容'));
    else if(state.report?.nextBefore===null)content.append(element('p','scale-list-end','没有更多数据了'));
  }
  const pager=pagination(state);
  if(pager)content.append(pager);
  return content;
}

function claimPicker(anchor:HTMLButtonElement,state:ScaleHistoryState,account?:ScaleAccount):void {
  const members=state.claimMembers;
  if(state.loading||!state.selectedKeys.size||!members.length)return;
  const list=element('div','scale-claim-members');
  for(const member of members){
    const choose=button('','scale-claim-member',()=>{
      dialog?.close();
      void state.mutateSelection('claim',member.id);
    });
    choose.append(memberAvatar(member,account),element('span','scale-claim-name',memberName(member,account)));
    list.append(choose);
  }
  const dialog=scaleDialog(anchor,'选择用户',list,'scale-claim-dialog',{cancelLabel:'取消'});
}

function confirmSelection(anchor:HTMLElement,state:ScaleHistoryState):void {
  const host=anchor.closest('.device-page');
  if(!host||!state.editable||!state.selectedKeys.size)return;
  const close=()=>{overlay.remove();if(anchor.isConnected)anchor.focus();};
  const selected=state.selectedKeys.size;
  const title='删除选中的 '+selected+' 条记录？';
  const cancel=footerButton('取消',close);
  const confirm=footerButton('确定',()=>{close();void state.mutateSelection('remove');},'primary');
  const dialog=element('section','scale-confirm-card',element('h3','',title),actionFooter('',cancel,confirm));
  const overlay=element('div','scale-confirm-overlay',dialog);
  dialog.setAttribute('role','dialog');
  dialog.setAttribute('aria-modal','true');
  dialog.setAttribute('aria-label',title);
  dismissOnBackdrop(overlay,close);
  host.append(overlay);
  bindDialogFocus(dialog,close);
}

export function scalePage(device:Device,state:ScaleHistoryState,artwork:()=>HTMLElement,close:()=>void,account?:ScaleAccount):HTMLElement {
  const view=state.view;
  const report=state.reportRecord;
  const title=view==='overview'?device.name:view==='history'?'历史数据':view==='records'?'全部记录':
    view==='pending'?'待认领数据':report&&availableMetrics(report,reportMetrics).length?'测量报告':'称重记录';
  const back=button('','page-icon-button',()=>{if(!state.back())close();},'back');
  back.setAttribute('aria-label','返回');
  const refresh=state.supported&&state.error&&view!=='report'&&view!=='overview'?button('','page-icon-button',()=>state.refresh(),'refresh'):undefined;
  if(refresh){
    refresh.setAttribute('aria-label','刷新称重记录');
    refresh.dataset.focusKey='scale-refresh';
    refresh.disabled=state.loading;
  }
  const heading=view==='pending'||view==='records'?undefined:view==='history'?
    memberPicker(state,account)??element('h2','',title):element('h2','',title);
  const subtitle=view==='overview'?element('p','scale-header-subtitle',device.online?'设备在线':'设备离线'):null;
  const header=element('header','device-page-header',back,element('div','device-page-title',heading,subtitle),refresh);
  const content=view==='overview'?overviewContent(state,artwork,account):view==='history'?historyContent(state):
    view==='report'&&report?reportContent(report):recordList(state,view==='pending');
  const body=element('div','device-page-scroll scale-content',content);
  body.setAttribute('aria-busy',String(state.loading));
  const page=element('section','device-page page-scale scale-view-'+view,header,body);
  page.setAttribute('aria-label',title);
  page.dataset.presentationTemplate='scale';
  page.dataset.scaleView=view;
  if(view==='history')page.append(actionFooter('scale-footer',footerButton('全部记录',()=>state.showRecords(),'primary')));
  if(view==='pending'){
    const remove=footerButton('删除',()=>confirmSelection(remove,state));
    const claim=footerButton('认领',()=>claimPicker(claim,state,account),'primary');
    remove.disabled=!state.editable||state.loading||!state.selectedKeys.size;
    claim.disabled=remove.disabled||!state.claimMembers.length;
    claim.classList.add('action-white-text');
    claim.setAttribute('aria-haspopup','dialog');
    page.append(actionFooter('scale-footer',remove,claim));
  }
  return page;
}
