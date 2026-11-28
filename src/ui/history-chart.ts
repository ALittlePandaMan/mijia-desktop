import {backgroundWork} from '../background-work';
import type { EChartsType } from 'echarts/core';
import { historyExtremes, historySlotDescription, type HistorySlot } from '../history';
import { element } from './dom';
import type { EnergyReport } from '../types';
import {scaleMetrics,scaleValue,type ScaleMeasurement,type ScaleMetric} from '../scale-history';
import { energySlots } from '../energy';
import { releaseSvgChartPointer } from './chart-pointer';
import {claimCurveEntrance,curveEntranceOptions} from './curve-motion';

const charts = new Set<EChartsType>();
let resourceCleanup:(()=>void)|undefined;
const resizeCleanups = new Map<EChartsType, () => void>();
function applyChartAppearance(chart:EChartsType):void {
  if(chart.isDisposed()||!chart.getDom().isConnected)return;
  const style=getComputedStyle(chart.getDom()),text=style.getPropertyValue('--chart-text').trim(),grid=style.getPropertyValue('--chart-grid').trim();
  chart.setOption({textStyle:{color:text},
    tooltip:{backgroundColor:style.getPropertyValue('--chart-tip').trim(),borderColor:grid,textStyle:{color:text}},
    xAxis:{axisLabel:{color:text},axisLine:{lineStyle:{color:grid}},splitLine:{lineStyle:{color:grid}}},
    yAxis:{axisLabel:{color:text},axisLine:{lineStyle:{color:grid}},splitLine:{lineStyle:{color:grid}}}
  },{lazyUpdate:true});
}
const themeChanged=()=>{if(!backgroundWork.paused)for(const chart of charts)applyChartAppearance(chart);};
const pageHidden=()=>disposeHistoryCharts();
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
  if(!charts.size){window.addEventListener('appearance-change',themeChanged);window.addEventListener('pagehide',pageHidden);resourceCleanup=backgroundWork.subscribe(paused=>{for(const c of charts){if(c.isDisposed())continue;if(paused)c.getZr().animation.pause();else{c.getZr().animation.resume();if(c.getDom().isConnected){c.resize();applyChartAppearance(c);}}}});}
  charts.add(chart);let frame:number|undefined;
  applyChartAppearance(chart);
  const observer=new ResizeObserver(()=>{if(backgroundWork.paused)return;if(frame!==undefined)cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{frame=undefined;if(!chart.isDisposed()&&chart.getDom().isConnected){const host=chart.getDom();if(Math.abs(chart.getWidth()-host.clientWidth)>.5||Math.abs(chart.getHeight()-host.clientHeight)>.5)chart.resize();}});});
  observer.observe(chart.getDom());resizeCleanups.set(chart,()=>{observer.disconnect();if(frame!==undefined)cancelAnimationFrame(frame);});
}
function disposeChart(chart:EChartsType):void {resizeCleanups.get(chart)?.();resizeCleanups.delete(chart);releaseSvgChartPointer(chart);chart.dispose();charts.delete(chart);if(!charts.size){window.removeEventListener('appearance-change',themeChanged);window.removeEventListener('pagehide',pageHidden);resourceCleanup?.();resourceCleanup=undefined;}}
export function disposeHistoryCharts(scope?: ParentNode): void {
  for (const chart of charts) if (!scope || scope.contains(chart.getDom())) disposeChart(chart);
}

// The overview shows recent weights against a few whole-kilogram grid lines.
function overviewWeightAxis(weights:readonly number[]) {
  const low=Math.min(...weights),high=Math.max(...weights);
  const roughStep=Math.max(1,(high-low)/1.5);
  const magnitude=10**Math.floor(Math.log10(roughStep));
  const interval=([1,2,5,10].find(step=>step*magnitude>=roughStep)??10)*magnitude;
  return {interval,min:Math.max(0,Math.floor((low-interval/2)/interval)*interval),
    max:Math.ceil((high+interval/2)/interval)*interval};
}

export function scaleWeightChart(records:readonly ScaleMeasurement[],metric:ScaleMetric,
  selected:ScaleMeasurement,select:(record:ScaleMeasurement)=>void,view:'history'|'overview'='history'):HTMLElement {
  const plot=element('div','scale-weight-chart');
  const [label,unit]=metric==='weight'?['体重','kg']:scaleMetrics[metric];
  plot.tabIndex=0;
  plot.dataset.focusKey='scale-trend-'+metric;
  plot.setAttribute('role','group');
  plot.setAttribute('aria-label',`${label}趋势，使用方向键选择记录`);
  const overview=view==='overview';
  const rows=records.slice().reverse();
  const points=rows.map((record,index)=>[overview?index:record.timeMs,scaleValue(record,metric)!]);
  let index=Math.max(0,rows.indexOf(selected));
  const first=new Date(rows[0].timeMs),last=new Date(rows.at(-1)!.timeMs);
  const sameDay=first.toDateString()===last.toDateString();
  const axisLabel=new Intl.DateTimeFormat('zh-CN',sameDay
    ? {hour:'2-digit',minute:'2-digit',hourCycle:'h23'}
    : {month:'2-digit',day:'2-digit'});
  const moment=new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  queueMicrotask(()=>{void(async()=>{
    if(!plot.isConnected)return;
    const {initHistoryChart,historyFontReady}=await import('./history-engine');
    await historyFontReady(plot);
    if(!plot.isConnected)return;
    const chart=initHistoryChart(plot);
    const style=getComputedStyle(plot);
    const accent=style.getPropertyValue('--scale-accent').trim();
    const surface=style.getPropertyValue('--surface-card').trim()||'#fff';
    const gridColor=style.getPropertyValue('--chart-grid').trim();
    const labelSize=parseFloat(style.fontSize);
    const u=overview?labelSize/10:1;
    const weightAxis=overview?overviewWeightAxis(rows.map(row=>row.weight)):undefined;
    const labelInset=weightAxis?Math.max(28*u,String(weightAxis.max).length*labelSize*.68+9*u):0;
    trackChart(chart);
    const marker=()=>[{coord:points[index]}];
    const guide=()=>[{xAxis:points[index][0]}];
    chart.setOption({
      animation:false,
      grid:overview?{left:'1%',right:labelInset,top:8*u,bottom:19*u,outerBoundsMode:'none'}:
        {left:5,right:7,top:12,bottom:3,containLabel:true,outerBoundsMode:'none'},
      xAxis:overview?{type:'category',data:rows.map(row=>row.key),boundaryGap:false,
        axisLine:{show:false},axisTick:{show:false},splitLine:{show:false},
        axisLabel:{fontSize:labelSize,margin:8*u,hideOverlap:true,showMinLabel:true,showMaxLabel:true,
          alignMinLabel:'left',formatter:(_key:string,i:number)=>axisLabel.format(rows[i].timeMs)}}:
        {type:'time',min:first.getTime(),max:last.getTime(),splitNumber:5,minInterval:sameDay?60_000:86_400_000,
        axisLine:{show:false},axisTick:{show:false},splitLine:{show:false},
        axisLabel:{showMinLabel:true,showMaxLabel:true,hideOverlap:true,fontSize:labelSize,margin:9,
          alignMinLabel:'left',alignMaxLabel:'right',
          formatter:(time:number)=>time===first.getTime()||time===last.getTime()?axisLabel.format(time):''}},
      yAxis:{type:'value',scale:true,position:'right',splitNumber:3,...weightAxis,
        axisLabel:{margin:6*u,fontSize:labelSize},
        axisLine:{show:false},axisTick:{show:false},splitLine:{lineStyle:{type:'dashed'}}},
      tooltip:{trigger:'axis',renderMode:'richText',formatter:(params:unknown)=>{
        const row=Array.isArray(params)?rows[params[0]?.dataIndex]:undefined;
        return row?`${moment.format(row.timeMs)}\n${scaleValue(row,metric)}${unit?' '+unit:''}`:'';
      }},
      series:[{id:'scale-trend',type:'line',data:points,symbol:'circle',symbolSize:3*u,showAllSymbol:true,
        smooth:overview?false:.28,smoothMonotone:'x',
        lineStyle:{color:accent,width:2*u},itemStyle:{color:accent},
        areaStyle:{opacity:.16,color:{type:'linear',x:0,y:0,x2:0,y2:1,
          colorStops:[{offset:0,color:accent},{offset:1,color:'rgba(8,200,192,0)'}]}},
        markLine:{silent:true,z:1,symbol:'none',label:{show:false},
          lineStyle:{color:gridColor,width:u,type:'solid'},data:guide()},
        markPoint:{silent:true,z:5,symbol:'circle',symbolSize:12*u,label:{show:false},
          itemStyle:{color:accent,borderColor:surface,borderWidth:2},
          data:marker()}}],
    });
    const choose=(next:number)=>{
      if(next===index||next<0||next>=rows.length)return;
      index=next;
      chart.setOption({series:[{id:'scale-trend',markPoint:{data:marker()},markLine:{data:guide()}}]});
      select(rows[index]);
    };
    plot.addEventListener('click',event=>{
      if(chart.isDisposed())return;
      const rect=plot.getBoundingClientRect();
      const pixel=[(event.clientX-rect.left)*chart.getWidth()/rect.width,(event.clientY-rect.top)*chart.getHeight()/rect.height];
      if(!chart.containPixel('grid',pixel))return;
      const target=Number(chart.convertFromPixel({xAxisIndex:0},pixel[0]));
      if(!Number.isFinite(target))return;
      if(overview){choose(Math.round(target));return;}
      let nearest=0;
      for(let offset=1;offset<rows.length;offset++){
        if(Math.abs(rows[offset].timeMs-target)<Math.abs(rows[nearest].timeMs-target))nearest=offset;
      }
      choose(nearest);
    });
    plot.addEventListener('keydown',event=>{
      const next=event.key==='ArrowLeft'?index-1:event.key==='ArrowRight'?index+1:
        event.key==='Home'?0:event.key==='End'?rows.length-1:undefined;
      if(next===undefined||chart.isDisposed())return;
      event.preventDefault();
      choose(next);
    });
    plot.dataset.rendered='true';
  })().catch(()=>{
    for(const chart of charts)if(chart.getDom()===plot)disposeChart(chart);
    if(plot.isConnected)plot.textContent='趋势图暂时无法显示';
  });});
  return plot;
}

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

export function sensorHistoryEntry(title:string, content:HTMLElement):HTMLElement {
  const heading = element('header','sensor-history-heading',element('h3','',title));
  heading.setAttribute('aria-description','云端历史');
  return element('section','sensor-history-entry',heading,content);
}

export function historyChart(slots: HistorySlot[], unit: string, precision: number): HTMLElement {
  const host = element('div', 'sensor-history-chart');
  const extremes = historyExtremes(slots);
  host.dataset.historyChart = unit === '%' ? 'humidity' : 'temperature';
  host.dataset.points = String(extremes?.count ?? 0);
  host.dataset.carriedPoints = String(slots.filter(slot=>slot.origin==='carried').length);
  host.dataset.minimum = String(extremes?.min ?? ''); host.dataset.maximum = String(extremes?.max ?? '');
  host.setAttribute('role', 'img');
  host.setAttribute('aria-label', extremes ? `云端${unit === '%' ? '湿度' : '温度'}历史，${extremes.count}个小时有实测记录，${host.dataset.carriedPoints}个小时延续此前记录，最高${extremes.max.toFixed(precision)}${unit}，最低${extremes.min.toFixed(precision)}${unit}。缺失小时延续此前记录。` : '暂无云端历史记录');
  queueMicrotask(() => { void (async () => {
    if (!host.isConnected || !extremes) return;
    const { initHistoryChart,historyFontReady } = await import('./history-engine');
    await historyFontReady(host);
    if (!host.isConnected) return;
    const chart = initHistoryChart(host); trackChart(chart);
    const label = (time: number) => `${String(new Date(time * 1000).getHours()).padStart(2, '0')}:00`;
    chart.setOption({
      ...curveEntranceOptions(claimCurveEntrance(`overview/${unit}`)), richInheritPlainLabel: false,
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
