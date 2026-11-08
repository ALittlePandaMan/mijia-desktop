import type {Device} from '../types';
import type {VacuumState,VacuumChange,VacuumReport} from '../vacuum';
import {operationFeedback} from './operation-feedback';
import {vacuumSettingsLocked} from '../vacuum';
import {vacuumIcon} from '../vacuum-icons';
import {icon} from '../icons';
import {button,element} from './dom';
import {deviceLoading} from './device-loading';
import './vacuum-page.css';
import {vacuumMap} from './vacuum-map';
import {VacuumMapViewport} from '../vacuum-map-view';
const fixtureViews=new WeakMap<object,VacuumMapViewport>();
function viewport(s:VacuumState):VacuumMapViewport{if(s.viewport)return s.viewport;let v=fixtureViews.get(s);if(!v){v=new VacuumMapViewport();fixtureViews.set(s,v);}return v;}
const modes=[{label:'只扫地',value:2,key:'sweep'},{label:'扫拖同步',value:0,key:'both'},{label:'只拖地',value:1,key:'mop'},{label:'先扫后拖',value:3,key:'after'}];
const suctions=[{label:'安静',value:0,key:'quiet'},{label:'标准',value:1,key:'standard'},{label:'强力',value:2,key:'medium'},{label:'超强',value:3,key:'strong'}];
const waters=[{label:'小',value:-5,key:'mophumidity1'},{label:'标准',value:-10,key:'mophumidity2'},{label:'大',value:-15,key:'mophumidity3'},{label:'手动',value:1,key:'mop_manual'}];
function status(r:VacuumReport){return({1:'清洁中',2:'待机中',3:'已暂停',4:'设备需要检查',5:'返回基座中',6:'充电中',7:'拖地中',8:'烘干拖布中',9:'清洗拖布中',10:'返回清洗中',11:'正在建图',12:'扫拖中',13:'充电完成',14:'设备升级中',15:'局部清洁中',16:'基座复位中',17:'安装拖布中',18:'拆卸拖布中',19:'基座自检中',20:'补水中',21:'拖布清洗已暂停',22:'集尘中',23:'遥控清洁中',24:'智能充电中',25:'复拖中'}as Record<number,string>)[r.status]??'设备在线';}
/** Exact d103cn control surface; the native adapter supplies actual map cells. */
export function vacuumPage(o:{device:Device;state:VacuumState;back:()=>void}):HTMLElement{
 const s=o.state,r=s.report,stage=element('div','device-stage'),page=element('section','device-page page-vacuum device-surfaces'),body=element('div','device-page-scroll vacuum-content');
 const back=button('','page-icon-button',o.back,'back');back.setAttribute('aria-label','返回家庭');const title=element('div','device-page-title',element('h2','',o.device.name));if(r)title.append(element('span','vacuum-status',status(r)));page.append(element('header','device-page-header',back,title),body);stage.append(page);page.setAttribute('aria-busy',String(s.loading||s.pending));
 if(s.error&&!r){const feedback=element('div','vacuum-feedback',element('p','',s.error.message));feedback.setAttribute('role','status');if(!s.pending&&!s.loading)feedback.append(button('重新读取','button button-secondary',()=>void s.read()));body.append(feedback);}
 if(!r){body.append(deviceLoading(undefined,o.device.name));return stage;}
 const disabled=!o.device.online||!!o.device.sharedReadOnly||s.loading||!!s.error||r.childLock||[11,14,16,19].includes(r.status);
 if(r.map)body.append(vacuumMap(r.map,viewport(s),()=>s.redraw?.()));else body.append(element('div','vacuum-map vacuum-map-empty',s.loading?'':r.mapReason??'地图暂未读取到。'));
 const send=(c:VacuumChange)=>void s.change(c);
 const action=(label:string,key:string,callback:()=>void)=>{const b=button('','vacuum-main-action',()=>{if(!b.disabled)callback();});b.append(vacuumIcon(key),element('span','',label));b.disabled=disabled;return b;};
 const base=action(r.inStation?'基座':'回基座',r.inStation?'icon_left_station':'icon_left_back_station',()=>s.showStation(true));base.dataset.vacuumAction='base';if(r.inStation)base.append(icon('chevron','vacuum-base-arrow'));
 const cleaning=action(r.cleaning?'暂停':r.paused?'继续清洁':'开始清洁',r.cleaning?'pause':r.paused?'continue_clean':'start_clean',()=>send({operation:r.cleaning?'pause':'start'}));cleaning.dataset.vacuumAction=r.cleaning?'pause':'start';if(!r.cleaning&&(r.washStation!==0||r.dustStatus===1))cleaning.disabled=true;
 if(s.pendingAction){cleaning.disabled=true;base.disabled=true;}body.append(element('div','vacuum-main-actions',base,cleaning));if(s.message)body.append(operationFeedback(s.actionMessage??s.message,s.uncertain?()=>s.adopt():undefined));
 const settingsLocked=vacuumSettingsLocked(s.actual??r)||!!s.pendingAction,card=element('section','vacuum-settings-card');card.setAttribute('aria-label','清洁设置');card.dataset.settingsLocked=String(settingsLocked);if(settingsLocked)card.setAttribute('aria-description','清扫中，暂不可调整清洁设置');body.append(card);
 const group=(label:string,current:string,choices:{label:string;value:number;key:string}[],selected:(value:number)=>boolean,art:(key:string,on:boolean)=>string,operation:'mode'|'suction'|'water',extraDisabled=false)=>{
  const section=element('section','vacuum-setting-group',element('h3','',label,element('span','',current))),options=element('div','vacuum-options');options.setAttribute('role','group');options.setAttribute('aria-label',label);
  for(const choice of choices){const on=selected(choice.value),b=button('','vacuum-choice',()=>{if(b.disabled)return;if(operation==='water'&&choice.key==='mop_manual')s.showManual(true);else send({operation,value:choice.value});});b.append(vacuumIcon(art(choice.key,on)),element('span','',choice.label));b.disabled=disabled||settingsLocked||extraDisabled;if(settingsLocked)b.setAttribute('aria-describedby','vacuum-settings-note');b.setAttribute('aria-pressed',String(on));b.dataset.vacuumOperation=operation;b.dataset.vacuumValue=String(choice.value);options.append(b);}
  section.append(options);card.append(section);
 };
 group('模式',modes.find(m=>m.value===r.mode)!.label,modes,v=>v===r.mode,(key,on)=>`mode-${key}-${on?'sel':'normal'}`,'mode');
 group('吸力',suctions.find(m=>m.value===r.suction)!.label,suctions,v=>v===r.suction,(key,on)=>`${key}-${on?'select':'normal'}`,'suction',r.mode===1);
 group('拖布水量',r.water>0?`手动 ${r.water}`:waters.find(m=>m.value===r.water)!.label,waters,v=>v===1?r.water>0:v===r.water,(key,on)=>`${key}-${on?'select':'normal'}`,'water',r.mode===2);
 if(s.stationOpen){
  const dialog=element('section','vacuum-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','基座');dialog.append(element('h3','','基座'));
  const row=(label:string,key:string,change:VacuumChange,unavailable=false)=>{const b=action(label,key,()=>send(change));b.classList.add('vacuum-station-action');b.disabled=disabled||unavailable;b.dataset.vacuumAction=change.operation;dialog.append(b);};
  if(!r.inStation){dialog.append(element('p','vacuum-dialog-note',r.cleaning?'结束当前清洁并返回基座。':'返回基座充电。'));row('返回基座','icon_left_back_station',{operation:'dock'});}
  else{row(r.washStation===1||r.washStation===4?'停止清洗拖布':'清洗拖布','icon_wash_rag',{operation:'wash',on:![1,4].includes(r.washStation)},r.dustStatus===1||![0,1,4].includes(r.washStation));row(r.washStation===2?'停止烘干':'烘干拖布','icon_dry_mop',{operation:'dry',on:r.washStation!==2},![0,2].includes(r.washStation)||r.dustStatus===1);row(r.dustStatus===1?'集尘中':'集尘','icon_collect_dust',{operation:'collect'},r.dustEnable!==1||r.dustStatus===1||r.washStation!==0);}
  dialog.append(button('关闭','vacuum-dialog-close',()=>s.showStation(false)));const overlay=element('div','vacuum-dialog-overlay',dialog);overlay.addEventListener('click',e=>{if(e.target===overlay)s.showStation(false);});page.append(overlay);
 }
 if(s.manualOpen&&!settingsLocked){
  const dialog=element('section','vacuum-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','手动拖布水量');const value=element('output','',String(s.manualWater??(r.water>0?r.water:10))),slider=element('input','vacuum-water-slider');slider.type='range';slider.min='1';slider.max='15';slider.step='1';slider.value=value.value;slider.dataset.focusKey='vacuum-manual-water';slider.setAttribute('aria-label','拖布水量');slider.disabled=disabled;slider.addEventListener('input',()=>{value.value=slider.value;s.setManualWater(Number(slider.value));});
  slider.addEventListener('pointerdown',e=>{if(slider.disabled||e.button!==0)return;slider.setPointerCapture(e.pointerId);dialog.dataset.interacting='true';});for(const event of['pointerup','pointercancel','lostpointercapture'])slider.addEventListener(event,()=>{if(dialog.dataset.interacting){delete dialog.dataset.interacting;s.redraw?.();}});
  const save=button('确定','button button-primary',()=>{if(!save.disabled){s.showManual(false);send({operation:'water',value:Number(slider.value)});}});save.disabled=disabled;dialog.append(element('h3','','拖布水量',value),slider,element('div','vacuum-water-scale','1',element('span','','15')),element('footer','',button('取消','button button-secondary',()=>s.showManual(false)),save));page.append(element('div','vacuum-dialog-overlay',dialog));
 }
 return stage;
}
