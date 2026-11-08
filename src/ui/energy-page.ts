import {deviceSurfaces} from './device-surfaces';
import type { AppError,DevicePanel,EnergyPeriod,EnergyReport,EnergySelection } from '../types';
import { dateKey,parseDateKey } from '../history';
import { energyDateText,outletPowerDivisor } from '../energy';
import { findProperty,propertyReading } from '../panel-layout';
import { reportedTime } from '../logic';
import { button,element } from './dom';
import {icon,officialIcon} from '../icons';
import { calendarPicker,type HistoryDetailView } from './history-detail';
import { energyChart } from './history-chart';
import {deviceWait} from './device-loading';

export interface EnergyView {
  selection:EnergySelection;data?:EnergyReport;loading:boolean;error?:AppError;panel?:DevicePanel;artwork?:()=>HTMLElement;
  picker:HistoryDetailView['picker'];showPicker:HistoryDetailView['showPicker'];select:(selection:EnergySelection)=>void;back:()=>void;
}
const metric=(value:number|null|undefined,label:string,precision=1)=>element('div','energy-metric',element('strong','',value==null?'--':value.toFixed(precision)),element('span','',label));
function boundMetric(view:HTMLElement,property:ReturnType<typeof findProperty>):HTMLElement{
 if(property){view.dataset.control='Status';view.dataset.siid=String(property.siid);view.dataset.piid=String(property.piid);view.dataset.propertyName=property.name;view.dataset.readingSource=propertyReading(property).source;}
 return view;
}
export function powerReading(panel:DevicePanel|undefined):{value:number|null;source:string}{
  const prop=findProperty(panel,['power-consumption'],['electric-power']),reading=propertyReading(prop);
  return {value:prop?.unit==='watt'&&typeof reading.value==='number'&&Number.isFinite(reading.value)&&reading.value>=0?reading.value/outletPowerDivisor(panel?.model??''):null,source:reading.source==='reported'&&prop?`功率为云端记录 · ${reportedTime(prop)}`:reading.source==='live'?'功率为本次直接读取':'功率尚未读取'};
}
export function energyEntrance(report:EnergyReport|undefined,panel:DevicePanel|undefined,open:(()=>void)|undefined,loading:boolean):HTMLElement {
  const power=powerReading(panel),card=open?button('','native-card outlet-energy-card',open):element('section','native-card outlet-energy-card');
  card.setAttribute('aria-label',open?'查看用电信息':'用电信息');
  const consumption=findProperty(panel,['power-consumption'],['power-consumption']);
  const powerProperty=findProperty(panel,['power-consumption'],['electric-power']),powerMetric=boundMetric(metric(power.value,'当前功率(W)'),powerProperty);
  // Every metering outlet uses the same three slots. A live counter's reset
  // semantics cannot be assumed to mean all-time energy or a daily statistic.
  const metrics=[metric(report?.summary.today,'今日用电(度)'),metric(report?.summary.month,'近一月用电(度)'),powerMetric];
  if(consumption)for(const view of metrics.slice(0,2))boundMetric(view,consumption);
  if(!open)for(const view of metrics.slice(0,2))view.setAttribute('aria-description','此型号的云端用电统计协议尚未核实。');
  const values=element('div','energy-card-metrics',...metrics);values.style.setProperty('--energy-metric-count',String(metrics.length));
  card.append(element('div','energy-card-title',element('span','','用电信息'),open?icon('chevron','energy-card-arrow'):null),values);
  card.dataset.historyAvailable=String(!!open);
  card.setAttribute('aria-description',loading?'正在读取云端统计…':power.source);
  card.dataset.energyLoading=String(loading);card.setAttribute('aria-description',(card.getAttribute('aria-description')??''));return card;
}
export function renderEnergyPage(props:EnergyView):HTMLElement{
  const stage=element('div','device-stage'),page=element('section','device-page page-history-detail page-energy');
  const back=button('','page-icon-button',props.back,'back');back.setAttribute('aria-label','返回插座控制');page.append(element('header','device-page-header',back));
  const body=element('div','device-page-scroll history-detail-content',element('h1','history-detail-title','用电信息'));
  const summary=props.data?.summary,power=powerReading(props.panel);
  const stats=element('section','energy-summary',element('div','energy-summary-pair first-pair',metric(power.value,'当前功率(w)'),metric(summary?.today,'今日用电(度)')),element('div','energy-summary-pair',metric(summary?.month,'近一月用电(度)'),metric(summary?.yesterday,'昨日用电(度)')));
  const count=metric(summary?.switches,'今日开关次数',0);if(summary?.switchesMore)count.querySelector('strong')!.textContent='>20';stats.append(count);body.append(stats,element('div','energy-separator'));
  const tabs=element('div','history-detail-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','用电周期');
  for(const [period,label]of[['week','周'],['month','月'],['year','年']]as [EnergyPeriod,string][]){const tab=button(label,period===props.selection.period?'selected':'',()=>{if(period!==props.selection.period)props.select({period,date:dateKey(new Date())});});tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(period===props.selection.period));tabs.append(tab);}body.append(tabs);
  const dateText=energyDateText(props.data,props.selection);
  if(props.selection.period==='year')body.append(element('div','energy-date-static',dateText));
  else {const date=button(dateText,'history-detail-date energy-date',()=>{const date=parseDateKey(props.selection.date);props.showPicker({month:new Date(date.getFullYear(),date.getMonth(),1),panel:props.selection.period==='month'?'month':'day'});});date.append(officialIcon('calendar:dropdown','history-date-arrow'));date.setAttribute('aria-label',props.selection.period==='week'?'选择统计结束日期':'选择统计月份');body.append(date);}
  const content=element('div','energy-chart-content');content.dataset.energyState=props.loading?'loading':props.error||props.data?.error?'error':'loaded';content.dataset.period=props.selection.period;content.dataset.date=props.selection.date;
  const error=props.error??props.data?.error;
  if(props.loading&&!props.data)content.append(deviceWait(props.artwork,'电量统计'));
  else if(error||!props.data?.points.length){content.append(element('h3','','电量'),element('div','energy-placeholder',error?.message??(props.data?.complete===false?'统计记录未完整读取，请重试。':'暂无云端统计记录')));if(error?.retryable||!error&&props.data?.complete===false)content.append(button('重试','history-detail-retry',()=>props.select({...props.selection})));}
  else content.append(energyChart(props.data));body.append(content);
  page.setAttribute('aria-description',`${power.source}；用电统计来自小米云，缺测保留空白。`);page.setAttribute('aria-description',(page.getAttribute('aria-description')??''));
  for(const warning of props.data?.warnings??[])body.append(element('p','sensor-history-warning',warning));
  page.append(body);
  if(props.picker)page.append(calendarPicker({date:props.selection.date,period:props.selection.period==='month'?'month':'day',picker:props.picker,select:date=>props.select({...props.selection,date}),showPicker:props.showPicker}));
  stage.append(page);return deviceSurfaces(stage);
}
