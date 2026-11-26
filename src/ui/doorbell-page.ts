import {dropdownSelect} from './dropdown';
import {renderCameraWeek} from './camera-week';
import {deviceWait} from './device-loading';
import './doorbell-page.css';
import {cameraDatePicker} from './camera-date-picker';
import {cameraDate} from '../camera-time';
import {filteredDoorbellEvents,type DoorbellState,type DoorbellFilter} from '../doorbell';
import type {Device} from '../types';
import {officialIcon} from '../icons';
import {button,element} from './dom';
const filters:readonly[DoorbellFilter,string][]=[['Default','全部事件'],['Bell','有人按门铃'],['Stay','有人逗留'],['Pass','有人经过']];
export function doorbellDates(date:string,oldest:string,choose:(date:string)=>void):readonly [HTMLElement,HTMLElement]{
 const today=cameraDate(Date.now()/1000);
 const stamp=element('div','doorbell-date-stamp',element('span','',`${Number(date.slice(5,7))}月${date.slice(8)}日${date===today?' 今天':''}`));
 const calendar=button('','doorbell-calendar',()=>cameraDatePicker(calendar,date,choose,oldest));
 calendar.append(officialIcon('camera:calendar'));calendar.setAttribute('aria-label','选择云端事件日期');stamp.append(calendar);
 const week=element('div','doorbell-week');week.setAttribute('aria-label','云端事件日期');
 renderCameraWeek(week,date,choose,{oldest});
 return [stamp,week];
}
/** Original mi3iot HomePage 10163: dates, explicit live entry and cloud events. */
export function doorbellPage(p:{device:Device;state:DoorbellState;battery?:number;back:()=>void;live:()=>void}):HTMLElement{
 const s=p.state,r=s.report,stage=element('div','device-stage'),page=element('section','device-page page-doorbell'),body=element('div','device-page-scroll doorbell-content');stage.append(page);
 page.dataset.presentationTemplate='doorbell-cloud';page.dataset.storage='cloud';page.dataset.cloudReady=String(!!r);page.setAttribute('aria-busy',String(s.loading));
 const back=button('','page-icon-button',p.back,'back');back.setAttribute('aria-label','返回家庭');const title=element('div','device-page-title',element('h2','',p.device.name));if(p.battery!==undefined)title.append(element('p','doorbell-battery',`电量${p.battery}%`));page.append(element('header','device-page-header',back,title),body);
 const today=cameraDate(Date.now()/1000);
 body.append(...doorbellDates(s.date,s.oldestDate,date=>{void s.read(date);}));
 if(s.date===today){const live=button('','doorbell-live-entry',p.live);live.append(officialIcon('doorbell:live'),element('div','',element('strong','','实时画面'),element('span','','查看当下门口的画面')));body.append(live);}
 const select=dropdownSelect({label:'筛选云端事件',options:filters.map(([value,label])=>({value,label})),value:s.filter,change:value=>s.select(value as DoorbellFilter)});const filter=element('div','doorbell-filter',select);body.append(filter);
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
 return stage;
}
