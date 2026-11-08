import {deviceWait} from './device-loading';
import './doorbell-page.css';
import {cameraDatePicker} from './camera-date-picker';
import {cameraDate} from '../camera-browser';
import {filteredDoorbellEvents,type DoorbellState,type DoorbellFilter} from '../doorbell';
import type {Device} from '../types';
import {officialIcon} from '../icons';
import {button,element} from './dom';
const filters:readonly[DoorbellFilter,string][]=[['Default','全部事件'],['Bell','有人按门铃'],['Stay','有人逗留'],['Pass','有人经过']];
/** Original mi3iot HomePage 10163: dates, explicit live entry and cloud events. */
export function doorbellPage(p:{device:Device;state:DoorbellState;battery?:number;back:()=>void;live:()=>void}):HTMLElement{
 const s=p.state,r=s.report,stage=element('div','device-stage'),page=element('section','device-page page-doorbell'),body=element('div','device-page-scroll doorbell-content');stage.append(page);
 page.dataset.presentationTemplate='doorbell-cloud';page.dataset.storage='cloud';page.dataset.cloudReady=String(!!r);page.setAttribute('aria-busy',String(s.loading));
 const back=button('','page-icon-button',p.back,'back');back.setAttribute('aria-label','返回家庭');const title=element('div','device-page-title',element('h2','',p.device.name));if(p.battery!==undefined)title.append(element('p','doorbell-battery',`电量${p.battery}%`));page.append(element('header','device-page-header',back,title),body);
 const today=cameraDate(Date.now()/1000),oldest=s.oldestDate;
 const stamp=element('div','doorbell-date-stamp',element('span','',`${Number(s.date.slice(5,7))}月${s.date.slice(8)}日${s.date===today?' 今天':''}`));
 const calendar=button('','doorbell-calendar',()=>cameraDatePicker(calendar,s.date,value=>{void s.read(value)},oldest));calendar.append(officialIcon('camera:calendar'));calendar.setAttribute('aria-label','选择云端事件日期');stamp.append(calendar);
 const week=element('div','doorbell-week');week.setAttribute('aria-label','云端事件日期');
 const anchor=new Date((s.date<cameraDate(Date.now()/1000-6*86400)?s.date:today)+'T12:00:00');for(let n=-6;n<=0;n++){const d=new Date(anchor);d.setDate(d.getDate()+n);const key=cameraDate(d.getTime()/1000),b=button('','doorbell-day',()=>{void s.read(key)});b.append(element('span','','周'+'日一二三四五六'[d.getDay()]),element('strong','',String(d.getDate())));b.setAttribute('aria-label',key);b.setAttribute('aria-pressed',String(key===s.date));b.disabled=key<oldest;week.append(b);}body.append(stamp,week);
 if(s.date===today){const live=button('','doorbell-live-entry',p.live);live.append(officialIcon('doorbell:live'),element('div','',element('strong','','实时画面'),element('span','','查看当下门口的画面')));body.append(live);}
 const select=element('select');select.setAttribute('aria-label','筛选云端事件');for(const[value,label]of filters){const o=element('option','',label);o.value=value;o.selected=s.filter===value;select.append(o);}select.addEventListener('change',()=>s.select(select.value as DoorbellFilter));const filter=element('div','doorbell-filter',select,officialIcon('doorbell:filter'));body.append(filter);
 const list=element('div','doorbell-event-list');list.setAttribute('aria-live','polite');body.append(list);
 if(s.loading){list.append(deviceWait(undefined,'云端事件'));return stage;}
 if(s.error){list.append(element('div','doorbell-empty',officialIcon('doorbell:empty'),element('p','',s.error.message),button('重试','doorbell-retry',()=>{void s.read()})));return stage;}
 const events=filteredDoorbellEvents(r,s.filter);
 if(!events.length)list.append(element('div','doorbell-empty',officialIcon('doorbell:empty'),element('p','',s.filter==='Default'?'这一天很安静，没有事件':'没有对应事件记录')));
 for(const e of events){
  const type=e.type.split(':'),role=type.includes('Bell')?'bell':type.includes('Stay')?'stay':type.includes('Pass')?'pass':'detect',row=button('','doorbell-event',()=>s.play(e.id));row.disabled=!r?.playbackAvailable||e.playbackAvailable===false;row.setAttribute('aria-label',`${e.kind}，${new Date(e.time*1000).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`);if(row.disabled)row.setAttribute('aria-description',r?.reason??'');
  const preview=element('span','doorbell-event-preview'),image=element('img');image.alt='';image.decoding='async';preview.append(image);void s.thumbnail(e.id).then(src=>{if(src&&image.isConnected)image.src=src;});
  row.append(officialIcon('doorbell:'+role),element('div','doorbell-event-copy',element('strong','',e.kind),element('span','',new Date(e.time*1000).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}))),preview);list.append(row);
 }
 if(r&&!r.complete)list.append(element('p','doorbell-status','当前仅显示已取回的事件。'));return stage;
}
