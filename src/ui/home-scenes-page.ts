import type {EChartsType} from 'echarts/core';
import {HomeScenesState,environmentSeries,sceneControlAvailable,sceneRooms,thermometer,type SceneRoom,type EnvironmentMetric} from '../home-scenes';
import type {HomeScene} from '../home-scenes';
import {visibleSceneShortcuts,type SceneShortcutLayout} from '../scene-shortcut-preferences';
import {sceneRoomColumns} from '../home-scene-layout';
import {deviceColumnCount,DEVICE_GRID_GAP} from '../home-grid';
import {sizeDeviceGrid} from './device-grid';
import type {Device,HomeCardEntry,HomeCardIntent,Room} from '../types';
import {icon,officialIcon} from '../icons';
import {button,element} from './dom';
import {releaseSvgChartPointer} from './chart-pointer';
import './home-scenes-page.css';
import {curveEntranceOptions} from './curve-motion';

export interface SceneShortcutOptions {
 layout?:SceneShortcutLayout;order?:string[];arranging?:boolean;selected?:ReadonlySet<string>;
 activate?:(scene:HomeScene)=>void;bind?:(card:HTMLElement,scene:HomeScene)=>void;add?:()=>void;
}
export function sizeSceneShortcuts(host:HTMLElement):void{
 if(!host.isConnected||!host.clientWidth)return;
 const deviceGrid=host.parentElement?.querySelector<HTMLElement>('.device-grid');
 if(deviceGrid)sizeDeviceGrid(deviceGrid);
 const layout=deviceGrid?getComputedStyle(deviceGrid):undefined;
 // Reuse resolved tracks to preserve the device grid's fractional-pixel spacing.
 host.style.setProperty('--scene-shortcut-tracks',layout?.gridTemplateColumns??`repeat(${deviceColumnCount(innerWidth)},minmax(0,1fr))`);
 host.style.setProperty('--scene-shortcut-gap',layout?.gap??`${DEVICE_GRID_GAP}px`);
}
export function sceneShortcuts(state:HomeScenesState,roomId:string,options:SceneShortcutOptions={}):HTMLElement {
 const host=element('section','scene-shortcuts');host.setAttribute('aria-label','一键执行');
 queueMicrotask(()=>sizeSceneShortcuts(host));
 host.classList.toggle('scene-shortcuts-arranging',!!options.arranging);
 const scenes=visibleSceneShortcuts(state.scenes,roomId,options.layout);
 if(options.order){const ranks=new Map(options.order.map((id,i)=>[id,i]));scenes.sort((a,b)=>(ranks.get(a.id)??Infinity)-(ranks.get(b.id)??Infinity));}
 if(!scenes.length&&(roomId==='*'||roomId==='@scenes')&&!options.arranging){host.hidden=true;return host;}
 if(state.loading&&!state.scenes.length)host.append(element('span','scene-loading','正在获取任务…'));
 if(state.error){const retry=button('重新获取任务','scene-retry',()=>{void state.load(true);},'refresh');retry.setAttribute('aria-description',state.error.message);host.append(retry);}
 for(const scene of scenes){
  const status=state.taskStates.get(scene.id),control=element('article','scene-task'),entrance=button('','scene-task-open',()=>{});entrance.dataset.focusKey=`scene-task-${scene.id}`;control.dataset.sceneId=scene.id;entrance.setAttribute('aria-label',scene.name);entrance.disabled=false;entrance.setAttribute('aria-busy',String(!options.arranging&&!!status?.pending));control.addEventListener('click',()=>{if(!entrance.disabled)options.activate?options.activate(scene):void state.run(scene);});
  const art=element('span','scene-task-icon');art.append(icon('play'));
  if(scene.icon){const image=element('img');image.src=scene.icon;image.alt='';image.referrerPolicy='no-referrer';image.addEventListener('error',()=>image.remove(),{once:true});image.addEventListener('load',()=>art.classList.add('has-image'),{once:true});art.append(image);}
  const selected=element('span','scene-task-selected',officialIcon('home:selected'));selected.setAttribute('aria-hidden','true');
  entrance.append(art,element('span','scene-task-name',scene.name),selected);control.append(entrance);
  if(options.arranging)entrance.setAttribute('aria-pressed',String(!!options.selected?.has(scene.id)));
  control.classList.toggle('arrange-selected',!!options.selected?.has(scene.id));options.bind?.(control,scene);
  host.append(control);
 }
 if(options.arranging&&options.add){const add=button('添加自动化','scene-add',options.add,'plus');add.style.order='100000';host.append(add);}
 host.hidden=!host.children.length;return host;
}
export interface ScenePageInput {devices:Device[];rooms:Room[];cards:HomeCardEntry[];state:HomeScenesState}
interface EnvironmentChart {drawn?:boolean;metric:EnvironmentMetric;plot:HTMLElement;legend:HTMLElement;chart?:EChartsType;observer?:ResizeObserver;initializing?:boolean}
export class HomeScenesView {
 private root?:HTMLElement;private input?:ScenePageInput;private structure='';private updates:(()=>void)[]=[];
 private devicesById=new Map<string,Device>();private cardsById=new Map<string,HomeCardEntry>();
 private charts:EnvironmentChart[]=[];private gridObserver?:ResizeObserver;private version=0;private environmentRevision=-1;private environmentLoading=false;
 private appearance=()=>{for(const entry of this.charts)this.styleChart(entry);};
 dispose(){++this.version;this.gridObserver?.disconnect();this.gridObserver=undefined;window.removeEventListener('appearance-change',this.appearance);for(const entry of this.charts){entry.observer?.disconnect();if(entry.chart){releaseSvgChartPointer(entry.chart);entry.chart.dispose();}}this.charts=[];this.root=undefined;this.updates=[];this.environmentRevision=-1;this.input=undefined;this.devicesById.clear();this.cardsById.clear();}
 private acceptInput(input:ScenePageInput){this.input=input;this.devicesById.clear();this.cardsById.clear();for(const d of input.devices)if(!this.devicesById.has(d.did))this.devicesById.set(d.did,d);for(const c of input.cards)if(!this.cardsById.has(c.did))this.cardsById.set(c.did,c);}
 render(input:ScenePageInput):HTMLElement {
  const {state,devices,rooms,cards}=input,lighting=sceneRooms(devices,rooms,cards,'light'),curtains=sceneRooms(devices,rooms,cards,'curtain');
  const structure=JSON.stringify([lighting,curtains].map(groups=>groups.map(g=>[g.id,g.name,g.devices.map(d=>d.did)]))).concat(JSON.stringify(devices.filter(thermometer).map(d=>[d.did,d.roomId,d.roomName])));
  if(this.root?.isConnected&&structure===this.structure){this.acceptInput(input);for(const update of this.updates)update();this.updateEnvironment();return this.root;}
  this.dispose();this.acceptInput(input);this.structure=structure;const root=element('div','scene-dashboard');this.root=root;
  if(lighting.length)root.append(this.controlSection('照明',lighting,'light'));
  if(curtains.length)root.append(this.controlSection('遮阳',curtains,'curtain'));
  if(devices.some(thermometer))root.append(this.environment());
  if(!lighting.length&&!curtains.length&&!devices.some(thermometer)){root.classList.add('is-empty');root.append(element('div','scene-empty','暂无灯光、窗帘或温湿度计'));}
  if(state.roomMessage){const message=element('p','scene-control-status',state.roomMessage);message.setAttribute('role','status');root.append(message);}
  for(const update of this.updates)update();this.updateEnvironment();window.addEventListener('appearance-change',this.appearance);
  const version=this.version;
  queueMicrotask(()=>{if(version!==this.version||!root.isConnected)return;
   const update=(grid:HTMLElement)=>{const gap=parseFloat(getComputedStyle(grid).columnGap);grid.style.setProperty('--scene-room-columns',String(sceneRoomColumns(grid.clientWidth,gap)));};
   this.gridObserver=new ResizeObserver(entries=>{for(const entry of entries)update(entry.target as HTMLElement);});
   for(const grid of root.querySelectorAll<HTMLElement>('.scene-room-grid')){update(grid);this.gridObserver.observe(grid);}
  });
  return root;
 }
 private controlSection(title:string,groups:SceneRoom[],kind:'light'|'curtain'):HTMLElement{
  const section=element('section','scene-section'),header=element('div','scene-section-heading',element('h2','',title));
  const controls=kind==='light'?[['on','全开','light-all-on'],['off','全关','light-all-off']] as const:[['open','打开','curtain-open'],['pause','暂停','scene:curtain-pause'],['close','关闭','curtain-close']] as const;
  const make=(devices:Device[],label:string,intent:HomeCardIntent,iconName:typeof controls[number][2],small=false)=>{
   const targets=()=>devices.flatMap(d=>{const current=this.devicesById.get(d.did);return current?[current]:[];});
   const control=button(small?'':label,small?'scene-all-button':'scene-room-control',()=>{const {state,cards}=this.input!;state.control(targets(),intent,cards);});control.prepend(officialIcon(iconName==='scene:curtain-pause'?iconName:'scene:'+iconName));control.setAttribute('aria-label',small?`全屋${kind==='light'?'灯光':'窗帘'}${label}`:label);
   this.updates.push(()=>{control.disabled=!targets().some(d=>sceneControlAvailable(d,this.cardsById.get(d.did),intent));});return control;
  };
  const all=groups.flatMap(g=>g.devices),global=element('div','scene-section-actions');
  for(const [intent,label,iconName] of controls)if(intent!=='pause')global.append(make(all,label,intent,iconName,true));header.append(global);section.append(header);
  const grid=element('div','scene-room-grid');
  for(const group of groups){
   const caption=element('p','scene-room-caption'),card=element('article',`scene-room-card scene-room-${kind}`,element('h3','',group.name),caption);card.dataset.sceneRoom=group.id;
   this.updates.push(()=>{const targets=group.devices.flatMap(d=>{const current=this.devicesById.get(d.did);return current?[current]:[];}),active=targets.map(d=>this.cardsById.get(d.did)?.selected),known=active.every(v=>typeof v==='boolean');
    const text=kind==='light'?(!known?'':active.every(Boolean)?'灯全开着':active.every(v=>v===false)?'灯全关着':`${active.filter(Boolean).length} 盏灯开着`):(!known?'':active.every(Boolean)?'窗帘开着':active.every(v=>v===false)?'窗帘已关闭':'部分窗帘打开');
    if(caption.textContent!==text)caption.textContent=text;card.classList.toggle('is-active',kind==='light'&&targets.some(d=>d.online&&this.cardsById.get(d.did)?.selected===true));
   });
   const buttons=element('div','scene-room-actions');for(const[intent,label,iconName]of controls){const control=make(group.devices,label,intent,iconName);control.setAttribute('aria-label',`${group.name}${kind==='light'?'灯光':'窗帘'}${label}`);control.dataset.focusKey=`scene-${kind}-${group.id}-${intent}`;buttons.append(control);}card.append(buttons);grid.append(card);
  }
  section.append(grid);return section;
 }
 private environment():HTMLElement {
  const section=element('section','scene-section scene-environment');section.append(element('div','scene-section-heading',element('h2','','环境')));
  const panel=element('div','scene-environment-panel');
  for(const metric of ['temperature','humidity'] as const){const label=metric==='temperature'?'温度':'湿度',legend=element('div','scene-chart-legend'),plot=element('div','scene-environment-chart');plot.setAttribute('role','img');plot.setAttribute('aria-label',`各房间近24小时${label}变化`);plot.dataset.metric=metric;
   const area=element('article','scene-environment-detail',element('div','scene-chart-heading',element('h3','scene-chart-title',label),legend),plot);panel.append(area);this.charts.push({metric,plot,legend});
  }section.append(panel);return section;
 }
 private updateEnvironment():void{
  const {state}=this.input!;if(this.environmentRevision===state.environmentRevision&&this.environmentLoading===state.environmentLoading)return;
  this.environmentRevision=state.environmentRevision;this.environmentLoading=state.environmentLoading;
  for(const entry of this.charts){this.updateLegend(entry);if(entry.chart)this.updateChart(entry);else this.initializeChart(entry);}
 }
 private readings(){const {state,devices}=this.input!;return devices.filter(thermometer).map(d=>state.environment.get(d.did)).filter(r=>r!==undefined);}
 private roomName(device:Device){return device.roomName||this.input!.rooms.find(room=>room.id===device.roomId)?.name||'未分配';}
 private colors=['#5999fc','#23b9f4','#926ffc','#8b9eae','#32bca4','#ec9e53','#e6759b','#7485d9'];
 private updateLegend(entry:EnvironmentChart):void{
  entry.legend.replaceChildren();this.readings().forEach((r,i)=>{const dot=element('i');dot.style.background=this.colors[i%this.colors.length];entry.legend.append(element('span','scene-legend-item',dot,element('span','',this.roomName(r.device),element('strong','',r[entry.metric]===null?'--':`${r[entry.metric]!.toFixed(entry.metric==='temperature'?1:0)}${entry.metric==='temperature'?'°':'%'}`))));});
 }
 private initializeChart(entry:EnvironmentChart):void{
  if(entry.initializing)return;
  if(!this.readings().some(r=>environmentSeries(r.history,entry.metric).some(p=>p[1]!==null))){entry.plot.replaceChildren(element('div','scene-chart-empty',this.input!.state.environmentLoading?'正在获取环境数据…':'暂无历史记录'));return;}
  entry.initializing=true;const version=this.version;
  queueMicrotask(()=>{void(async()=>{try{const{initHistoryChart,historyFontReady}=await import('./history-engine');await historyFontReady(entry.plot);if(version!==this.version||!entry.plot.isConnected)return;
   entry.plot.replaceChildren();entry.chart=initHistoryChart(entry.plot);this.updateChart(entry);
   entry.observer=new ResizeObserver(()=>{const chart=entry.chart;if(chart&&!chart.isDisposed()&&entry.plot.isConnected){const {clientWidth:width,clientHeight:height}=chart.getDom();if(Math.abs(chart.getWidth()-width)>.5||Math.abs(chart.getHeight()-height)>.5)chart.resize();}});entry.observer.observe(entry.plot);
  }finally{entry.initializing=false;}})();});
 }
 private updateChart(entry:EnvironmentChart):void{
  const chart=entry.chart;if(!chart)return;const readings=this.readings(),metric=entry.metric,series=readings.map((r,i)=>({id:r.device.did,name:this.roomName(r.device),type:'line',showSymbol:false,connectNulls:false,smooth:.25,lineStyle:{width:2,color:this.colors[i%this.colors.length]},itemStyle:{color:this.colors[i%this.colors.length]},data:environmentSeries(r.history,metric)}));
  const histories=readings.map(r=>r.history).filter(h=>h!==undefined);
  const style=getComputedStyle(entry.plot),color=style.getPropertyValue('--chart-text').trim()||'#8c99a2',line=style.getPropertyValue('--chart-grid').trim()||'#dbe4e9';
  chart.setOption({...curveEntranceOptions(!entry.drawn),grid:{left:16,right:46,top:16,bottom:28},tooltip:{trigger:'axis',renderMode:'richText',confine:true,backgroundColor:style.getPropertyValue('--chart-tip').trim(),borderColor:line,textStyle:{color}},xAxis:{type:'time',...(histories.length?{min:Math.min(...histories.map(h=>h.start))*1000,max:Math.max(...histories.map(h=>h.end))*1000}:{}),axisLine:{show:false},axisTick:{show:false},axisLabel:{fontSize:11,color,formatter:(v:number)=>new Date(v).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})},splitLine:{show:false}},yAxis:{type:'value',position:'right',scale:true,splitNumber:3,axisLine:{show:false},axisTick:{show:false},axisLabel:{fontSize:11,color,formatter:`{value}${metric==='temperature'?'°':'%'}`},splitLine:{lineStyle:{type:'dashed',color:line}}},series},{notMerge:true});entry.drawn=true;
 }
 private styleChart(entry:EnvironmentChart):void{
  const chart=entry.chart;if(!chart||chart.isDisposed())return;const style=getComputedStyle(entry.plot),color=style.getPropertyValue('--chart-text').trim()||'#8c99a2',line=style.getPropertyValue('--chart-grid').trim()||'#dbe4e9';chart.setOption({tooltip:{backgroundColor:style.getPropertyValue('--chart-tip').trim(),borderColor:line,textStyle:{color}},xAxis:{axisLabel:{color}},yAxis:{axisLabel:{color},splitLine:{lineStyle:{color:line}}}});
 }
}
