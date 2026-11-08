import type { EChartsType } from 'echarts/core';
import { historyExtremes, historySlotDescription, type HistorySlot } from '../history';
import { element } from './dom';
import type { HistorySelection } from '../types';
import type { EnergyReport } from '../types';
import { energySlots } from '../energy';
import { releaseSvgChartPointer } from './chart-pointer';

const charts = new Set<EChartsType>();
const resizeCleanups = new Map<EChartsType, () => void>();
function applyChartAppearance(chart:EChartsType):void {
  if(chart.isDisposed()||!chart.getDom().isConnected)return;
  const style=getComputedStyle(chart.getDom()),text=style.getPropertyValue('--chart-text').trim(),grid=style.getPropertyValue('--chart-grid').trim();
  chart.setOption({animation:false,textStyle:{color:text},
    tooltip:{backgroundColor:style.getPropertyValue('--chart-tip').trim(),borderColor:grid,textStyle:{color:text}},
    xAxis:{axisLabel:{color:text},axisLine:{lineStyle:{color:grid}},splitLine:{lineStyle:{color:grid}}},
    yAxis:{axisLabel:{color:text},axisLine:{lineStyle:{color:grid}},splitLine:{lineStyle:{color:grid}}}
  },{lazyUpdate:true});
}
const themeChanged=()=>{for(const chart of charts)applyChartAppearance(chart);};
window.addEventListener('appearance-change',themeChanged);
window.addEventListener('pagehide',()=>{window.removeEventListener('appearance-change',themeChanged);disposeHistoryCharts();},{once:true});
// Reserve the same logical space outside the axes on sensor overview/detail.
const sensorTextInset=23;
// containLabel reserves font advance widths; SVG glyph ink at fractional page
// zoom extends slightly beyond that box. Keep the visual label edges aligned.
const sensorChartPadding = { right: sensorTextInset+2, bottom: 24 };
/** The first time label straddles the plot's left edge. Reserve its half-width
 * so its outer edge matches the Y-axis labels' outer edge on the right. */
function sensorChartLeft(host:HTMLElement,firstLabel:string):number{
 const context=host.ownerDocument.createElement('canvas').getContext('2d');
 if(!context)return sensorTextInset+15;
 context.font=`11.25px ${getComputedStyle(host).fontFamily}`;
 return sensorTextInset+Math.ceil(context.measureText(firstLabel).width/2);
}
function trackChart(chart:EChartsType):void {
  charts.add(chart);let frame:number|undefined;
  queueMicrotask(()=>applyChartAppearance(chart));
  const observer=new ResizeObserver(()=>{if(frame!==undefined)cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=undefined;if(!chart.isDisposed()&&chart.getDom().isConnected)chart.resize();});});
  observer.observe(chart.getDom());resizeCleanups.set(chart,()=>{observer.disconnect();if(frame!==undefined)cancelAnimationFrame(frame);});
}
function disposeChart(chart:EChartsType):void {resizeCleanups.get(chart)?.();resizeCleanups.delete(chart);releaseSvgChartPointer(chart);chart.dispose();charts.delete(chart);}
export function disposeHistoryCharts(): void { for (const chart of charts) disposeChart(chart); }

export function energyChart(report:EnergyReport):HTMLElement {
  const slots=energySlots(report),sum=slots.reduce((total,slot)=>total+(slot.value??0),0);
  const section=element('section','energy-chart-section',element('h3','','电量'));
  const value=element('strong','',sum.toFixed(1)),label=element('span','energy-chart-label','总计 电量');
  section.append(element('div','energy-chart-value',value,element('small','','度')),label);
  const plot=element('div','energy-chart');plot.dataset.energyChart='true';plot.dataset.slots=String(slots.length);plot.dataset.points=String(slots.filter(slot=>slot.value!==null).length);
  plot.setAttribute('role','img');plot.setAttribute('aria-label',`用电统计，共${slots.filter(slot=>slot.value!==null).length}个周期有云端记录，已取得记录合计${sum.toFixed(1)}度。`);
  section.append(plot);
  queueMicrotask(()=>{void(async()=>{
    if(!plot.isConnected)return;const{initHistoryChart,historyFontReady}=await import('./history-engine');await historyFontReady(plot);if(!plot.isConnected)return;
    const chart=initHistoryChart(plot);trackChart(chart);
    const format=(time:number)=>{const date=new Date(time*1000);return report.selection.period==='year'?`${date.getFullYear()}/${String(date.getMonth()+1).padStart(2,'0')}`:`${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')}`;};
    chart.setOption({animation:false,grid:{left:27,right:27,top:20,bottom:20,containLabel:true,outerBoundsMode:'none'},
      tooltip:{trigger:'axis',showContent:false,renderMode:'richText',axisPointer:{type:'shadow'}},
      xAxis:{type:'category',data:slots.map(slot=>format(slot.time)),axisLine:{show:false},axisTick:{show:false},axisLabel:{interval:report.selection.period==='week'?0:report.selection.period==='month'?9:1,showMinLabel:true,showMaxLabel:true,color:'#999',fontSize:11.25}},
      yAxis:{type:'value',position:'right',splitNumber:2,axisLabel:{color:'#999',fontSize:11.25},axisLine:{show:false},axisTick:{show:false},splitLine:{lineStyle:{color:'#ededed',type:'dashed'}}},
      series:[{type:'bar',data:slots.map(slot=>slot.value),barMaxWidth:24,itemStyle:{color:'#5894fb',opacity:.3,borderRadius:[5,5,0,0]},emphasis:{itemStyle:{color:'#356ccc',opacity:1}}}]
    });
    const select=(index:number)=>{const slot=slots[index];if(!slot)return;section.dataset.selectedIndex=String(index);value.textContent=slot.value===null?'--':slot.value.toFixed(1);label.textContent=`${format(slot.time)} 电量`;};
    chart.on('updateAxisPointer',(event:unknown)=>{if(event&&typeof event==='object'){const index=Number((event as {axesInfo?:{value?:unknown}[]}).axesInfo?.[0]?.value);if(Number.isInteger(index))select(index);}});
    chart.on('click',(event:{dataIndex?:number})=>{if(event.dataIndex!==undefined)select(event.dataIndex);});
    plot.dataset.rendered='true';
  })().catch(()=>{for(const chart of charts)if(chart.getDom()===plot)disposeChart(chart);if(plot.isConnected){plot.dataset.rendered='error';plot.textContent='统计图表暂时无法显示，请重试。';}});});
  return section;
}

export function historyChart(slots: HistorySlot[], unit: string, precision: number): HTMLElement {
  const host = element('div', 'sensor-history-chart');
  const extremes = historyExtremes(slots);
  host.dataset.historyChart = unit === '%' ? 'humidity' : 'temperature';
  host.dataset.points = String(extremes?.count ?? 0);
  host.dataset.carriedPoints = String(slots.filter(slot=>slot.origin==='carried').length);
  host.dataset.minimum = String(extremes?.min ?? ''); host.dataset.maximum = String(extremes?.max ?? '');
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', extremes ? `云端${unit === '%' ? '湿度' : '温度'}历史，${extremes.count}个小时有实测记录，${host.dataset.carriedPoints}个小时延续此前记录，最高${extremes.max.toFixed(precision)}${unit}，最低${extremes.min.toFixed(precision)}${unit}。两路缺测处不连线。` : '暂无云端历史记录');
  queueMicrotask(() => { void (async () => {
    if (!host.isConnected || !extremes) return;
    const { initHistoryChart,historyFontReady } = await import('./history-engine');
    await historyFontReady(host);
    if (!host.isConnected) return;
    const chart = initHistoryChart(host); trackChart(chart);
    const label = (time: number) => `${String(new Date(time * 1000).getHours()).padStart(2, '0')}:00`;
    chart.setOption({
      animation: false, richInheritPlainLabel: false,
      grid: { top: '15%', left: sensorChartLeft(host,label(slots[0].time)), ...sensorChartPadding, containLabel: true, outerBoundsMode: 'none' },
      tooltip: { trigger: 'axis', renderMode:'richText', formatter:(params:unknown)=>{
        const first=Array.isArray(params)?params[0]:params;
        const index=Number(first&&typeof first==='object'?(first as {dataIndex?:number}).dataIndex:NaN);
        const slot=slots[index];return slot?`${label(slot.time)}\n${historySlotDescription(slot,unit,precision)}`:'';
      } },
      xAxis: { type: 'category', boundaryGap: false, data: slots.map(slot => label(slot.time)), axisLabel: { interval: 5, showMinLabel:true, showMaxLabel:true, hideOverlap:true, color: '#b2b2b2', fontSize: 11.25 }, axisLine: { lineStyle: { color: '#f3f3f3', type: 'dashed' } }, axisTick: { show: false } },
      yAxis: { type: 'value', position: 'right', scale: true, splitNumber: 3,
        ...(unit === '%' ? { min: (value: { min: number }) => Math.max(0, Math.floor(value.min / 10) * 10), max: (value: { max: number }) => Math.min(100, Math.ceil(value.max / 10) * 10) } : {}),
        axisLabel: { color: '#b2b2b2', fontSize: 11.25, formatter: `{value}${unit}`, hideOverlap: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: '#ededed', type: 'dashed' } } },
      series: [{ type: 'line', data: slots.map(slot => slot.high === null ? null : Number(slot.high.toFixed(precision))), connectNulls: false, showSymbol: false, smooth: false,
        lineStyle: { width: 2, color: '#45b4ff' }, itemStyle: { color: '#45b4ff' },
        areaStyle: { opacity: .8, color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(169,220,255,.2)' }, { offset: .8678, color: 'rgba(69,180,255,0)' }] } },
        markPoint: { silent: true, symbol: 'circle', symbolSize: 10, itemStyle: { color: '#cbdce2' }, label: { show: true, color: '#fff', fontSize: 11.25, position: 'top', distance: 4, backgroundColor: '#45b4ff', borderRadius: 12, padding: [3, 8], formatter: (params: { value: unknown }) => Number(params.value).toFixed(precision) }, data: [{ type: 'max' }, { type: 'min' }] } }],
    });
    host.dataset.rendered = 'true';
  })().catch(() => {
    for (const chart of charts) if (chart.getDom() === host) disposeChart(chart);
    if (host.isConnected) { host.dataset.rendered = 'error'; host.classList.add('sensor-history-placeholder'); host.textContent = '图表暂时无法显示，请重新打开设备。'; }
  }); });
  return host;
}

export function historyDetailChart(slots: HistorySlot[], selection: HistorySelection, unit: string, precision: number): HTMLElement {
  const section=element('section','history-detail-channel');
  const both=selection.period!=='day';
  const fields=both?['high','low'] as const:['high'] as const;
  section.append(element('h3','',unit==='%'?'湿度':'温度'),element('div','history-detail-legend',...fields.map(field=>element('span',field==='high'?'legend-high':'legend-low',element('i'),field==='high'?'最高':'最低'))));
  const valueRow=element('div','history-detail-values');
  const outputs=fields.map(field=>{
    const value=element('strong','','--');const time=element('span','history-detail-time','--');
    valueRow.append(element('div','history-detail-reading',element('div','',value,element('small','',`(${unit})`)),time));
    return {field,value,time};
  });
  const plot=element('div','history-detail-plot');
  plot.dataset.historyDetailChart=unit==='%'?'humidity':'temperature';
  plot.dataset.points=String(slots.filter(slot=>slot.high!==null||slot.low!==null).length);
  plot.dataset.measuredPoints=String(slots.filter(slot=>slot.high!==null&&slot.origin!=='carried').length);
  plot.dataset.carriedPoints=String(slots.filter(slot=>slot.origin==='carried').length);
  plot.dataset.slots=String(slots.length);plot.dataset.series=String(fields.length);
  plot.setAttribute('role','img');plot.setAttribute('aria-label',`云端${unit==='%'?'湿度':'温度'}历史，缺测处不连线。`);
  const timeLabel=(time:number):string=>{
    const date=new Date(time*1000), month=String(date.getMonth()+1).padStart(2,'0'),day=String(date.getDate()).padStart(2,'0');
    return selection.period==='day'?`${String(date.getHours()).padStart(2,'0')}:00`:selection.period==='month'?`${month}/${day}`:`${date.getFullYear()}/${month}`;
  };
  const select=(index:number):void=>{
    const slot=slots[index];if(!slot)return;
    section.dataset.selectedIndex=String(index);
    for(const output of outputs){const value=slot[output.field];output.value.textContent=value===null?'--':value.toFixed(precision);output.time.textContent=value===null?'--':timeLabel(slot.time);output.value.setAttribute('aria-description',historySlotDescription(slot,unit,precision));}
  };
  let last=-1;for(let index=slots.length-1;index>=0;index--)if(fields.some(field=>slots[index][field]!==null)){last=index;break;}
  if(last>=0)select(last);
  section.append(valueRow,plot);
  queueMicrotask(()=>{void(async()=>{
    if(!plot.isConnected||last<0)return;
    const {initHistoryChart,historyFontReady}=await import('./history-engine');await historyFontReady(plot);if(!plot.isConnected)return;
    const chart=initHistoryChart(plot);trackChart(chart);
    chart.setOption({animation:false,richInheritPlainLabel:false,
      grid:{left:27,top:20,...sensorChartPadding,containLabel:true,outerBoundsMode:'none'},
      tooltip:{trigger:'axis',showContent:false,renderMode:'richText',axisPointer:{type:'line',lineStyle:{color:'#ddd',type:'solid'}}},
      xAxis:{type:'category',boundaryGap:true,data:slots.map(slot=>timeLabel(slot.time)),axisLabel:{interval:5,color:'#b2b2b2',fontSize:11.25},axisLine:{show:false},axisTick:{show:false}},
      yAxis:{type:'value',position:'right',scale:true,splitNumber:3,axisLabel:{color:'#b2b2b2',fontSize:11.25,formatter:`{value}${unit}`},axisLine:{show:false},axisTick:{show:false},splitLine:{lineStyle:{color:'#ededed',type:'dashed'}}},
      series:fields.map((field,index)=>({type:'line',data:slots.map(slot=>slot[field]===null?null:Number(slot[field]!.toFixed(precision))),connectNulls:false,smooth:false,symbol:'circle',symbolSize:2,showSymbol:true,
        itemStyle:{color:index?'#89d0ff':'#44b4ff'},lineStyle:{width:2,color:index?'#89d0ff':'#44b4ff',shadowColor:index?'#89d0ff':'#44b4ff',shadowOffsetY:2,shadowBlur:6},
        areaStyle:{origin:'start',color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'#dff2ff'},{offset:.8678,color:'rgba(223,242,255,0)'}]}},emphasis:{scale:6,itemStyle:{borderColor:'#fff',borderWidth:2}}
      }))});
    const highlight=(index:number)=>{select(index);chart.dispatchAction({type:'downplay'});fields.forEach((_,seriesIndex)=>chart.dispatchAction({type:'highlight',seriesIndex,dataIndex:index}));};
    chart.on('updateAxisPointer',(event:unknown)=>{if(!event||typeof event!=='object')return;const index=Number((event as {axesInfo?:{value?:unknown}[]}).axesInfo?.[0]?.value);if(Number.isInteger(index)&&index>=0&&index<slots.length)highlight(index);});
    chart.on('click',(event:{dataIndex?:number})=>{if(event.dataIndex!==undefined)highlight(event.dataIndex);});
    highlight(last);plot.dataset.rendered='true';
  })().catch(()=>{for(const chart of charts)if(chart.getDom()===plot)disposeChart(chart);if(plot.isConnected){plot.dataset.rendered='error';plot.textContent='图表暂时无法显示，请重试。';}});});
  return section;
}
