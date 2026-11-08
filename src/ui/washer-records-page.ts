import {officialIcon} from '../icons';
import {deviceSurfaces} from './device-surfaces';
import type { DevicePanel, EnergySelection } from '../types';
import type { WasherConfigReport, WasherProgram } from '../washer';
import { washerFields, washerFieldText } from '../washer';
import { washerLogSlots, washerRecordTime, type WasherRecordDetail, type WasherRecords, type WasherRecordRow } from '../washer-records';
import { dateKey, parseDateKey } from '../history';
import { energyDateText } from '../energy';
import { button, element } from './dom';
import { icon } from '../icons';
import { calendarPicker } from './history-detail';
import { washerGlyph } from './washer-page';
import {deviceWait} from './device-loading';

interface Props {
 state:WasherRecords;programs:WasherProgram[];config?:WasherConfigReport;panel:DevicePanel;artwork?:()=>HTMLElement;
 back:()=>void;select:(selection:EnergySelection)=>void;more:()=>void;retry:()=>void;bucket:(index:number)=>void;open:(row:WasherRecordRow)=>void;retryDetail:()=>void;changed:()=>void;
}
function detailParameters(props:Props,detail:WasherRecordDetail):{label:string;value:string}[]{
 const program=props.programs.find(p=>p.value===detail.entry.mode);if(!program||!props.config)return[];
 const raw=detail.parameters,map:Record<string,string>={temperature:'waterTemperature',rinsh:'rinseTimes',speed:'spinSpeed',soak:'soakTime',night:'nightWash',sterilization:'steam',highWaterLevel:'highWater',pleasedWash:'freeWashTime',mainWash:'freeWashTime',regularDry:'dryingTime'};
 const values:Record<string,number|boolean>={};for(const [name,key]of Object.entries(map))if(raw[key]!==undefined)values[name]=raw[key];
 if(typeof raw.dryingLevel==='number')values.dry=raw.dryingLevel===1&&typeof raw.dryingDegree==='number'&&raw.dryingDegree>0?1+raw.dryingDegree/10:raw.dryingLevel===2&&typeof raw.dryingTime==='number'&&raw.dryingTime>0?raw.dryingTime:raw.dryingLevel;
 if(typeof raw.shakeTime==='number')values.shakeTime=raw.shakeTime/60;
 return washerFields(props.config,program,props.panel,{program:program.name,values}).filter(f=>!f.hidden).map(field=>({label:field.label,value:washerFieldText(field)}));
}
/** Vector bars/text remain sharp through page zoom and monitor scaling. */
function chart(state:WasherRecords,select:(index:number)=>void):HTMLElement {
 const report=state.chartReport!,slots=washerLogSlots(report),section=element('section','washer-record-chart',element('h3','','洗衣次数'));
 const selected=state.selectedBucket===undefined?undefined:slots[state.selectedBucket];
 const total=selected?selected.value:report.buckets.reduce((sum,b)=>sum+b.value,0);
 section.append(element('div','washer-record-total',element('strong','',total===null?'--':String(total)),element('span','','次')));
 const NS='http://www.w3.org/2000/svg',svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 360 164');svg.setAttribute('role','group');svg.setAttribute('aria-label',`洗衣次数统计，${report.buckets.length}个周期有云端记录`);
 const add=(tag:string,attrs:Record<string,string>,text?:string)=>{const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;svg.append(n);return n;};
 const max=Math.max(1,...slots.map(b=>b.value??0)),step=312/Math.max(slots.length,1),bar=Math.min(22,step*.6);
 for(const [index,bucket]of slots.entries()){
  const x=20+step*(index+.5),height=(bucket.value??0)/max*100,active=state.selectedBucket===index;
  const d=new Date(bucket.endTime),label=report.range.aggregation==='month'?`${d.getFullYear()}年${d.getMonth()+1}月`:`${d.getMonth()+1}月${d.getDate()}日`;
  const hit=add('rect',{x:String(x-step/2),y:'0',width:String(step),height:'122',fill:active?'#5894fb12':'transparent',role:'button',tabindex:'0','aria-label':`${label}，${bucket.value===null?'暂无记录':bucket.value+'次'}`,'aria-pressed':String(active),'data-slot-index':String(index)});
  hit.addEventListener('click',()=>select(index));hit.addEventListener('keydown',event=>{if(event instanceof KeyboardEvent&&['Enter',' '].includes(event.key)){event.preventDefault();select(index);}});
  add('rect',{x:String(x-bar/2),y:String(120-height),width:String(bar),height:String(height),rx:'3',fill:active?'#356ccc':'#5a96fb','pointer-events':'none'});
  if(slots.length<=12||index===0||index===slots.length-1||index%10===0)add('text',{x:String(x),y:'145','text-anchor':'middle',fill:'var(--chart-text,#999)','font-size':'10'},report.range.aggregation==='month'?`${d.getMonth()+1}月`:`${d.getMonth()+1}/${d.getDate()}`);
  if(bucket.value&&slots.length<=12)add('text',{x:String(x),y:String(112-height),'text-anchor':'middle',fill:'#555','font-size':'11','pointer-events':'none'},String(bucket.value));
 }
 add('path',{d:'M14 120H346',stroke:'var(--chart-grid,#eee)',fill:'none'});section.append(svg);return section;
}
export function washerRecordsPage(props:Props):HTMLElement {
 const state=props.state,stage=element('div','device-stage'),page=element('section','device-page page-washer washer-subpage page-washer-records'),scroll=element('div','device-page-scroll washer-record-content');
 const selected=state.selected,title=selected?'洗衣详情':'洗衣记录',back=button('','page-icon-button',props.back,'back');back.setAttribute('aria-label',selected?'返回洗衣记录':'返回洗衣机');
 page.dataset.recordsLoading=String(state.loading);page.dataset.recordDetailLoading=String(state.detailLoading);
 page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',title))));
 if(selected){
  const entry=selected.entry,program=props.programs.find(p=>p.value===entry.mode);
  scroll.append(element('div','washer-record-detail-heading',washerGlyph(program?.name??'mix'),element('h3','',program?.title??`程序 ${entry.mode}`),element('p','',washerRecordTime(entry))));
  if(state.detailLoading)scroll.append(deviceWait(props.artwork,'洗衣记录'));
  else if(state.detailError)scroll.append(element('div','washer-record-placeholder',state.detailError.message));
  else if(state.detail){const rows=element('section','native-card washer-record-detail-parameters');for(const field of detailParameters(props,state.detail))rows.append(element('div','washer-record-detail-row',element('span','',field.label),element('span','',field.value)));if(!rows.childNodes.length)rows.append(element('div','washer-record-placeholder','此记录未保存程序参数'));scroll.append(rows);}
 }else{
  const tabs=element('div','history-detail-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','洗衣记录周期');
  for(const[period,label]of[['week','周'],['month','月'],['year','年']]as const){const tab=button(label,period===state.selection.period?'selected':'',()=>props.select({period,date:dateKey(new Date())}));tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(period===state.selection.period));tabs.append(tab);}scroll.append(tabs);
  const label=energyDateText(undefined,state.selection);
  if(state.selection.period==='year')scroll.append(element('div','energy-date-static',label));
  else {const date=button(label,'history-detail-date',()=>{const d=parseDateKey(state.selection.date);state.picker={month:new Date(d.getFullYear(),d.getMonth(),1),panel:state.selection.period==='month'?'month':'day'};props.changed();});date.setAttribute('aria-label','选择洗衣记录日期');date.append(officialIcon('calendar:dropdown','history-date-arrow'));scroll.append(date);}
  if(state.chartReport){scroll.append(chart(state,props.bucket));const frequent=element('section','washer-record-frequent',element('h3','','常用洗涤程序')),items=element('div','native-card washer-record-frequent-items');
   for(const mode of state.chartReport.frequentModes){const p=props.programs.find(p=>p.value===mode);items.append(element('span','',washerGlyph(p?.name??'mix'),element('span','',p?.title??`程序 ${mode}`)));}if(!items.childNodes.length)items.append(element('span','','暂无记录'));frequent.append(items);scroll.append(frequent);
  }
  const records=element('section','washer-record-list',element('h3','','洗护记录'));
  for(const row of state.rows){const p=props.programs.find(p=>p.value===row.entry.mode),item=button('','washer-record-row',()=>props.open(row));item.append(element('span','',element('strong','',p?.title??`程序 ${row.entry.mode}`),element('small','',washerRecordTime(row.entry))),icon('chevron'));records.append(item);}scroll.append(records);
  if(state.loading)scroll.append(deviceWait(props.artwork,'洗衣记录'));
  else if(state.error)scroll.append(element('div','washer-record-placeholder',state.error.message));
  else if(!state.rows.length)scroll.append(element('div','washer-record-placeholder','暂无洗衣记录'));
  else if(state.report?.nextId&&state.rows.length<1000)scroll.append(button('加载更多','washer-record-load-more',props.more));
 }
 page.append(scroll);if(state.picker&&!selected)page.append(calendarPicker({date:state.selection.date,period:state.selection.period==='month'?'month':'day',picker:state.picker,select:date=>props.select({...state.selection,date}),showPicker:picker=>{state.picker=picker;props.changed();}}));
 stage.append(page);return deviceSurfaces(stage);
}
