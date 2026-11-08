import {icon} from '../icons';
import {deviceSurfaces} from './device-surfaces';
import type {PurifierHistory,WaterRecord,WaterStatistics,WaterSelection} from '../purifier-history';
import {waterQuantity,waterDuration} from '../purifier-history';
import {dateKey,parseDateKey} from '../history';
import {element,button} from './dom';
import {deviceWait} from './device-loading';
import {purifierCalendar,openPurifierCalendar,type PurifierCalendar} from './purifier-calendar';
interface Props{mode:'tds'|'statistics';state:PurifierHistory;artwork:()=>HTMLElement;back:()=>void;more:()=>void;record:(id:string)=>void;select:(selection:WaterSelection)=>void;bucket:(time:number)=>void;retry:()=>void;picker:PurifierCalendar|undefined;showPicker:(picker:PurifierCalendar|undefined)=>void}
const svgNS='http://www.w3.org/2000/svg';
function svgNode<K extends keyof SVGElementTagNameMap>(tag:K,attrs:Record<string,string|number>={},text?:string):SVGElementTagNameMap[K]{const n=document.createElementNS(svgNS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;}
const clock=(time:number)=>new Date(time*1000).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
const stamp=(time:number)=>{const d=new Date(time*1000);return `${dateKey(d)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;};
export function purifierHistoryPage(p:Props):HTMLElement{
 const stage=element('div','device-stage'),page=element('section',`device-page page-purifier-history purifier-history-${p.mode}`),header=element('header','device-page-header'),back=button('','page-icon-button',p.back,'back');back.setAttribute('aria-label','返回净水器');header.append(back);page.append(header);stage.append(page);
 const s=p.state;
 if(p.mode==='tds'){
  const body=element('div','purifier-tds-body',element('h1','purifier-history-title','TDS水质'));page.append(body);
  if(s.recordOpening.waiting){if(s.recordOpening.showing)body.append(deviceWait(p.artwork,'米家净水器'));return deviceSurfaces(stage);}
  const selected=s.records?.records.find(r=>r.id===s.selectedRecord);
  if(selected)body.append(tdsChart(selected));
  const list=element('div','device-page-scroll purifier-history-records');list.setAttribute('aria-label','制水记录');
  for(const r of s.records?.records.slice(0,s.visibleRecords)??[]){const row=button('','purifier-tds-record',()=>p.record(r.id));row.dataset.focusKey=`purifier-record-${r.id}`;row.classList.toggle('selected',r.id===s.selectedRecord);row.setAttribute('aria-pressed',String(r.id===s.selectedRecord));row.append(icon('chevron','purifier-record-chevron original-right-chevron'),element('strong','',stamp(r.time)),element('p','',recordDescription(r)));list.append(row);}
  appendRecordState(list,p);body.append(list);
 }else{
  const body=element('div','device-page-scroll purifier-statistics-body',element('h1','purifier-history-title','用水详情'));
  const tabs=element('div','purifier-stat-tabs');for(const[period,label]of [['week','周'],['month','月'],['year','年']]as const){const b=button(label,period===s.selection.period?'selected':'',()=>p.select({...s.selection,period}));b.dataset.focusKey=`purifier-period-${period}`;b.setAttribute('aria-pressed',String(period===s.selection.period));tabs.append(b);}body.append(tabs);
  const dates=button(rangeText(s.statistics,s.selection),'purifier-stat-date',()=>p.showPicker(openPurifierCalendar(s.selection)));dates.append(icon('chevron'));body.append(dates);
  if(s.statisticsOpening.waiting){if(s.statisticsOpening.showing)body.append(deviceWait(p.artwork,'米家净水器'));page.append(body);return deviceSurfaces(stage);}
  if(s.statistics){const q=waterQuantity(s.statistics.totalMl);body.append(element('div','purifier-stat-total',element('p','',element('strong','',q.value),element('span','',q.unit)),element('p','purifier-stat-subtitle',`当${{week:'周',month:'月',year:'年'}[s.selection.period]}直饮水生成量`)));body.append(barChart(s.statistics,s.selectedTime,p.bucket));for(const w of s.statistics.warnings)body.append(element('p','sensor-history-warning',w));}
  if(s.statisticsError){const alert=element('p','purifier-error',s.statisticsError.message);alert.setAttribute('role','alert');body.append(alert);}
  body.append(element('h2','purifier-record-heading','制水记录'));
  const records=element('div','purifier-stat-records');let day='';
  for(const r of s.records?.records.slice(0,s.visibleRecords)??[]){const key=dateKey(new Date(r.time*1000));if(key!==day){day=key;records.append(element('h3','',key));}records.append(element('div','purifier-stat-record',element('strong','',clock(r.time)),element('p','',recordDescription(r))));}appendRecordState(records,p);body.append(records);page.append(body);
  if(p.picker)page.append(purifierCalendar(s.selection,p.picker,p.showPicker,date=>p.select({...s.selection,date})));
 }
 return deviceSurfaces(stage);
}
function recordDescription(r:WaterRecord):string{const amount=waterQuantity(r.volumeMl);return `放水约${waterDuration(r.seconds)}，生成直饮水${amount.value}${amount.unit}`;}
function appendRecordState(parent:HTMLElement,p:Props):void{
 const s=p.state;if(s.recordsLoading){if(s.recordOpening.showing||s.records)parent.append(deviceWait(p.artwork,'米家净水器'));}
 else if(s.recordError){const error=element('p','purifier-error',s.recordError.message);error.setAttribute('role','alert');parent.append(error);}
 else if(s.records&&!s.records.records.length)parent.append(element('p','purifier-history-empty',p.mode==='tds'?'暂无TDS记录':'暂无制水记录'));
 for(const warning of s.records?.warnings??[])parent.append(element('p','sensor-history-warning',warning));
 if(!s.recordsLoading&&s.records&&(s.visibleRecords<s.records.records.length||s.records.nextBefore!==null))parent.append(button('加载更多','purifier-read',p.more));
}
function rangeText(report:WaterStatistics|undefined,selection:WaterSelection):string{
 const d=parseDateKey(selection.date);if(selection.period==='month')return `${d.getFullYear()}年${d.getMonth()+1}月`;if(selection.period==='year')return `${d.getFullYear()}年`;
 if(report){const a=new Date(report.start*1000),b=new Date(report.end*1000);return `${a.getMonth()+1}月${a.getDate()}日-${b.getMonth()+1}月${b.getDate()}日`;}return selection.date;
}
function tdsChart(record:WaterRecord):HTMLElement{
 const container=element('div','purifier-tds-chart'),svg=svgNode('svg',{viewBox:'0 0 405 180',preserveAspectRatio:'none','aria-label':'本次制水中直饮水TDS变化曲线',role:'img'});
 const values=record.tds;
 if(values.length){const max=Math.max(1,...values),points=values.map((v,i)=>({x:values.length===1?202.5:i*405/(values.length-1),y:145-v/max*55}));
  const defs=svgNode('defs'),gradient=svgNode('linearGradient',{id:'purifier-tds-fill',x1:0,y1:0,x2:0,y2:1});gradient.append(svgNode('stop',{offset:0,'stop-color':'#13bde4','stop-opacity':'.2'}),svgNode('stop',{offset:1,'stop-color':'#13bde4','stop-opacity':'0'}));defs.append(gradient);svg.append(defs);
  if(points.length>1){let line=`M${points[0].x},${points[0].y}`;for(let i=0;i<points.length-1;i++){const a=points[Math.max(0,i-1)],b=points[i],c=points[i+1],d=points[Math.min(points.length-1,i+2)];line+=` C${b.x+(c.x-a.x)/6},${b.y+(c.y-a.y)/6} ${c.x-(d.x-b.x)/6},${c.y-(d.y-b.y)/6} ${c.x},${c.y}`;}svg.append(svgNode('path',{d:`${line} L405,180 L0,180 Z`,fill:'url(#purifier-tds-fill)'}),svgNode('path',{d:line,fill:'none',stroke:'#13bde4','stroke-width':1.6,'vector-effect':'non-scaling-stroke'}));}
  else svg.append(svgNode('circle',{cx:points[0].x,cy:points[0].y,r:3,fill:'#13bde4'}));
 }
 container.append(element('p','purifier-tds-value',values.length?`${values.at(-1)}mg/L`:'未上报TDS采样'),svg,element('div','purifier-tds-times',element('span','',clock(record.time-record.seconds)),element('span','','*本次制水中直饮水TDS变化曲线'),element('span','',clock(record.time))));return container;
}
function barChart(report:WaterStatistics,selected:number|undefined,choose:(time:number)=>void):HTMLElement{
 const box=element('div','purifier-stat-chart'),svg=svgNode('svg',{viewBox:'0 0 405 248',role:'group','aria-label':'直饮水生成量柱状图'}),points=report.points,maximum=Math.max(1,...points.map(p=>p.volumeMl??0)),left=26,right=348,top=88,bottom=212,width=(right-left)/Math.max(1,points.length);
 for(let i=0;i<3;i++){const y=top+(bottom-top)*i/2;svg.append(svgNode('line',{x1:left,x2:right,y1:y,y2:y,stroke:'var(--chart-grid,#e9e9e9)','stroke-dasharray':'4 6','stroke-width':.7}));const q=waterQuantity(Math.round(maximum*(1-i/2)));svg.append(svgNode('text',{x:398,y:y+4,fill:'var(--chart-text,#aaa)','font-size':10,'text-anchor':'end'},`${q.value}${q.unit}`));}
 points.forEach((p,index)=>{const x=left+(index+.5)*width,h=(p.volumeMl??0)/maximum*(bottom-top),future=p.time>Date.now()/1000||p.time<new Date(2023,0,1).getTime()/1000;
  const hit=svgNode('rect',{x:left+index*width,y:top,width,height:bottom-top+22,fill:'transparent'});if(!future){hit.setAttribute('tabindex','0');hit.setAttribute('role','button');hit.dataset.focusKey=`purifier-bucket-${p.time}`;hit.setAttribute('aria-label',`${p.label}，${p.volumeMl===null?'暂无统计':`${waterQuantity(p.volumeMl).value}${waterQuantity(p.volumeMl).unit}`}`);hit.addEventListener('click',()=>choose(p.time));hit.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(p.time);}});}svg.append(hit,svgNode('rect',{x:x-width*.22,y:bottom-h,width:width*.44,height:h,rx:3,fill:p.time===selected?'#10bde4':'#c5e9fe','pointer-events':'none'}));
  if(report.selection.period!=='month'||index%4===3)svg.append(svgNode('text',{x,y:232,'text-anchor':'middle',fill:future?'var(--chart-text,#ccc)':'var(--chart-text,#888)','font-size':10,'pointer-events':'none'},p.label));
  if(p.time===selected){const q=waterQuantity(p.volumeMl),cx=Math.max(64,Math.min(320,x));svg.append(svgNode('line',{x1:x,x2:x,y1:65,y2:bottom,stroke:'var(--chart-grid,#e5e5e5)','stroke-width':.8,'pointer-events':'none'}),svgNode('rect',{x:cx-52,y:8,width:104,height:58,rx:14,fill:'var(--surface-subtle,#f5f5f5)','pointer-events':'none'}),svgNode('text',{x:cx,y:36,'text-anchor':'middle','font-size':25,fill:'var(--text-primary,#111)','pointer-events':'none'},`${q.value}${q.unit}`),svgNode('text',{x:cx,y:54,'text-anchor':'middle','font-size':12,fill:'var(--chart-text,#999)','pointer-events':'none'},report.selection.period==='year'?'当月生成量':'当天生成量'));}
 });box.append(svg);return box;
}
