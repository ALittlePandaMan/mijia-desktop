import {api} from './api';
import {cameraDate} from './camera-browser';
import {officialIcon,icon} from './icons';
import {cameraDatePicker} from './ui/camera-date-picker';
import {button,element} from './ui/dom';
import {deviceWait} from './ui/device-loading';
import type {DeviceContext} from './types';
export interface CareEvent {id:string;time:number;kind:string;duration:number;thumbnailAvailable:boolean;playbackAvailable:boolean}
export interface CareReport {events:CareEvent[];reason?:string}
export function careDateLabel(date:string,now=Date.now()):string {
 const [year,month,day]=date.split('-').map(Number),today=cameraDate(now/1000),yesterday=cameraDate(now/1000-86400);
 return `${month}月${day}日${date===today?' | 今天':date===yesterday?' | 昨天':year!==Number(today.slice(0,4))?` | ${year}年`:''}`;
}
/** The event browser owns bounded thumbnail work, never cloud credentials. */
export class CameraCare {
 readonly root=element('section','camera-care-browser');
 private list=element('div','camera-care-list');private toolbar=element('div','camera-care-toolbar');
 private context?:DeviceContext;private date='';private events:CareEvent[]=[];private epoch=0;private filter='全部事件';private active='';private playing=false;
 private images=new Map<string,string>();private requested=new Set<string>();private observer?:IntersectionObserver;private queue:{event:CareEvent;image:HTMLImageElement}[]=[];private workers=0;
 constructor(private read:(date:string)=>void,private play:(event:CareEvent)=>void){this.root.append(this.toolbar,this.list);}
 clear():void{++this.epoch;this.context=undefined;this.events=[];this.queue=[];this.images.clear();this.requested.clear();this.observer?.disconnect();this.active='';this.playing=false;this.filter='全部事件';this.list.replaceChildren();}
 loading(context:DeviceContext,date:string):void {this.clear();this.context={...context};this.date=date;this.renderToolbar();this.list.replaceChildren(deviceWait(undefined,'事件记录'));}
 failure(message:string):void{this.list.replaceChildren(element('p','camera-browser-notice',message),button('重试','camera-care-retry',()=>this.read(this.date)));}
 update(report:CareReport):void{this.events=report.events;this.renderToolbar();this.renderList();if(report.reason)this.list.append(element('p','camera-browser-notice',report.reason));}
 select(id:string,playing:boolean):void {this.active=id;this.playing=playing;for(const row of this.list.querySelectorAll<HTMLElement>('[data-care-event]')){const selected=row.dataset.careEvent===id;row.classList.toggle('selected',selected);row.setAttribute('aria-pressed',String(selected));const badge=row.querySelector<HTMLElement>('.camera-care-playing');if(badge){badge.hidden=!selected;badge.textContent=playing?'播放中':'已暂停';}}}
 private renderToolbar():void {
  const input=element('input');input.type='date';input.value=this.date;input.max=cameraDate(Date.now()/1000);input.min=cameraDate(Date.now()/1000-30*86400);input.className='camera-care-date-input';input.setAttribute('aria-label','看家助手日期');input.addEventListener('change',()=>{if(input.value)this.read(input.value);});
  const date=button('','camera-care-date-button',()=>{cameraDatePicker(date,this.date,value=>this.read(value));});date.append(element('span','',careDateLabel(this.date)),icon('chevron'));
  const options=element('div','camera-care-filter-options');options.hidden=true;options.setAttribute('role','menu');for(const name of ['全部事件',...new Set(this.events.map(e=>e.kind))]){const choice=button(name,'',()=>{this.filter=name;this.renderToolbar();this.renderList();});choice.setAttribute('role','menuitemradio');choice.setAttribute('aria-checked',String(name===this.filter));options.append(choice);}
  const menu=button('','camera-care-filter-menu',()=>{options.hidden=!options.hidden;menu.setAttribute('aria-expanded',String(!options.hidden));});menu.append(careFilterIcon());menu.setAttribute('aria-label','筛选事件类型');menu.setAttribute('aria-expanded','false');
  this.toolbar.replaceChildren(element('div','camera-care-date',date,input),element('div','camera-care-filters',menu,options));
 }
 private renderList():void {
  this.observer?.disconnect();for(const job of this.queue)this.requested.delete(job.event.id);this.queue=[];this.list.replaceChildren();
  this.observer=typeof IntersectionObserver==='undefined'?undefined:new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting){const image=entry.target as HTMLImageElement,event=this.events.find(e=>e.id===image.dataset.eventId);if(event)this.enqueue(event,image);this.observer?.unobserve(image);}}},{root:this.root,rootMargin:'160px'});
  const filtered=this.events.filter(e=>this.filter==='全部事件'||e.kind===this.filter);
  for(const event of filtered){
   const glyph=event.kind==='画面变动'?'camera:care-object':/声/.test(event.kind)?'camera:care-sound':'camera:care-motion',mark=element('span','camera-care-event-mark',officialIcon(glyph));
   const image=element('img');image.alt='';image.dataset.eventId=event.id;image.decoding='async';
   const badge=element('span','camera-care-playing','播放中');badge.hidden=true;
   const thumbnail=element('span','camera-care-thumbnail',image,badge);
   if(event.thumbnailAvailable){if(this.images.has(event.id)){image.src=this.images.get(event.id)!;}else if(this.observer)this.observer.observe(image);else this.enqueue(event,image);}
   const time=new Date(event.time*1000).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false});
   const row=button('','camera-care-event',()=>{if(event.playbackAvailable)this.play(event);});row.dataset.careEvent=event.id;row.setAttribute('aria-label',`${event.kind} ${time}`);row.disabled=!event.playbackAvailable;
   row.append(mark,element('span','camera-care-event-text',element('strong','',event.kind),element('span','',time)),thumbnail);this.list.append(row);
  }
  if(!filtered.length)this.list.append(element('p','camera-browser-notice',this.events.length?'没有此类型的事件。':'此日期没有云端事件记录。'));
  this.select(this.active,this.playing);
 }
 private enqueue(event:CareEvent,image:HTMLImageElement):void{if(this.requested.has(event.id))return;this.requested.add(event.id);this.queue.push({event,image});this.pump();}
 private pump():void {
  while(this.workers<3&&this.queue.length&&this.context){const job=this.queue.shift()!,context={...this.context},epoch=this.epoch,date=this.date;++this.workers;
   void api.cameraCareThumbnail(context,date,job.event.id).then(src=>{if(epoch!==this.epoch||!src.startsWith('data:image/'))return;if(this.images.size>=100)this.images.delete(this.images.keys().next().value!);this.images.set(job.event.id,src);for(const image of this.list.querySelectorAll<HTMLImageElement>('img[data-event-id]'))if(image.dataset.eventId===job.event.id)image.src=src;}).catch(()=>{if(epoch===this.epoch)job.image.classList.add('unavailable');}).finally(()=>{--this.workers;this.pump();});
  }
 }
}

/** Three offset lines, matching the original compact event-list filter glyph. */
export function careFilterIcon():SVGSVGElement{const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');svg.dataset.iconName='camera:care-filter-list';const path=document.createElementNS(ns,'path');path.setAttribute('d','M7 7h10M7 12h7M7 17h10');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','2');path.setAttribute('stroke-linecap','round');svg.append(path);return svg;}
