import {api} from './api';
import {officialIcon} from './icons';
import {normalizeError,sameContext} from './logic';
import {button,element} from './ui/dom';
import {deviceWait} from './ui/device-loading';
import type {Device,DeviceContext} from './types';
import type {DoorbellEvent} from './doorbell';
import './camera-player.css';
import {CloudVideoControls} from './ui/cloud-video-controls';
import './ui/doorbell-player.css';
type Media={data:string;duration:number};
/** Cloud playback owns one video independently of the battery-device live transport. */
export class DoorbellPlayer {
 readonly stage=element('div','device-stage');
 private page=element('section','device-page page-doorbell-player');private body=element('div','device-page-scroll doorbell-player-content');
 private title=element('h2');private caption=element('p','doorbell-player-caption');private viewport=element('div','doorbell-player-viewport');private video=element('video');
 private overlay=element('div','doorbell-player-overlay');private loading=deviceWait(undefined,'云端录像');private message=element('p');private retry=button('重试','doorbell-player-retry',()=>{if(this.context&&this.device&&this.event)void this.load(this.context,this.date,this.event);});
 private list=element('div','doorbell-detail-list');private eventsKey='';private controls=new CloudVideoControls(this.video,this.viewport,message=>this.page.setAttribute('aria-description',message),async()=>{if(this.context&&this.event)return api.saveCloudVideo(this.context,this.date,this.event.id);});
 private context?:DeviceContext;private device?:Device;private event?:DoorbellEvent;private date='';private key='';private epoch=0;private url?:string;private pending=false;
 constructor(back:()=>void,private read:(c:DeviceContext,date:string,id:string)=>Promise<Media>=api.cameraCareVideo){
  const backButton=button('','page-icon-button',back,'back');backButton.setAttribute('aria-label','返回门铃事件');
  this.page.dataset.storage='cloud';this.page.dataset.presentationTemplate='doorbell-cloud-playback';
  this.video.playsInline=true;this.video.muted=true;this.video.preload='metadata';this.video.setAttribute('aria-label','门铃云录像');
  this.overlay.setAttribute('role','status');this.overlay.append(this.loading,this.message,this.retry);this.viewport.append(this.video,this.overlay,this.controls.root,this.controls.top);
  this.body.append(this.viewport,this.caption,this.list);this.page.append(element('header','device-page-header',backButton,element('div','device-page-title',this.title)),this.body);this.stage.append(this.page);
  for(const name of ['loadedmetadata','loadeddata','play','pause','timeupdate','ended'] as const)this.video.addEventListener(name,()=>{if(!this.key)return;if(this.video.videoWidth>0)this.viewport.style.aspectRatio=`${this.video.videoWidth}/${this.video.videoHeight}`;if(this.video.readyState>=2&&!this.video.error){this.pending=false;this.overlay.hidden=true;}this.updateControls();});
  this.video.addEventListener('error',()=>{if(this.key&&this.video.error)this.failure('当前视频暂时无法播放，请重试。');});this.updateControls();
 }
 update(context:DeviceContext,device:Device,date:string,event:DoorbellEvent,events:DoorbellEvent[]=[event],thumbnail?:(id:string)=>Promise<string|undefined>,select?:(id:string)=>void):HTMLElement{
  const key=JSON.stringify([context.homeId,context.generation,context.did,date,event.id]);this.title.textContent='视频详情';this.caption.textContent=`${date.slice(0,4)}年${Number(date.slice(5,7))}月${Number(date.slice(8))}日`;
  if(key!==this.key){this.dispose();this.key=key;this.context={...context};this.device=device;this.date=date;this.event=event;void this.load(context,date,event);}
  const listKey=JSON.stringify(events.map(e=>[e.id,e.kind,e.time]));if(listKey!==this.eventsKey){this.eventsKey=listKey;this.list.replaceChildren();for(const item of events){const row=button('','doorbell-detail-event',()=>{if(select)select(item.id);});row.dataset.doorbellEvent=item.id;row.disabled=item.playbackAvailable===false;const stay=item.type.split(':').includes('Stay'),preview=element('span','doorbell-detail-thumbnail'),image=element('img'),badge=element('span','doorbell-detail-playing','播放中');image.alt='';preview.append(image,badge);if(thumbnail)void thumbnail(item.id).then(src=>{if(src&&image.isConnected)image.src=src;});row.append(officialIcon('doorbell:'+(stay?'stay':item.type.split(':').includes('Bell')?'bell':'pass')),element('span','doorbell-detail-copy',element('strong','',item.kind),element('span','',new Date(item.time*1000).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}))),preview);this.list.append(row);}}this.updateControls();return this.stage;
 }
 dispose():void{if(!this.key&&!this.url)return;++this.epoch;this.key='';this.context=undefined;this.event=undefined;this.video.pause();this.video.removeAttribute('src');this.video.load();if(this.url)URL.revokeObjectURL(this.url);this.url=undefined;this.pending=false;this.eventsKey='';this.list.replaceChildren();}
 private async load(context:DeviceContext,date:string,event:DoorbellEvent):Promise<void>{
  const epoch=++this.epoch;this.pending=true;this.video.pause();if(this.url){URL.revokeObjectURL(this.url);this.url=undefined;}this.video.removeAttribute('src');this.video.load();this.video.muted=true;this.overlay.hidden=false;this.loading.hidden=false;this.message.textContent='';this.retry.hidden=true;this.page.dataset.mediaState='loading';this.updateControls();
  try{const media=await this.read({...context},date,event.id);if(epoch!==this.epoch||!sameContext(context,this.context))return;
   if(!Number.isFinite(media.duration)||media.duration<=0||typeof media.data!=='string'||media.data.length>68*1024*1024)throw Error('云端录像数据无效。');
   const bytes=Uint8Array.from(atob(media.data),c=>c.charCodeAt(0));if(bytes.length<16||String.fromCharCode(...bytes.subarray(4,8))!=='ftyp')throw Error('云端录像格式无效。');
   this.url=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));this.video.playbackRate=1;this.video.src=this.url;this.video.load();await this.video.play();if(epoch===this.epoch)this.updateControls();
  }catch(error){if(epoch===this.epoch)this.failure(normalizeError(error).message);}
 }
 private failure(message:string):void{this.pending=false;this.loading.hidden=true;this.message.textContent=message;this.overlay.hidden=false;this.retry.hidden=false;this.page.dataset.mediaState='error';this.updateControls();}
 private updateControls():void{
  this.controls.update();const ready=!!this.key&&!this.pending&&this.video.readyState>=2&&!this.video.error;
  if(ready)this.page.dataset.mediaState=this.video.ended?'ended':this.video.paused?'paused':'playing';this.page.dataset.paused=String(this.video.paused);
  for(const row of this.list.querySelectorAll<HTMLElement>('[data-doorbell-event]')){const active=row.dataset.doorbellEvent===this.event?.id;row.classList.toggle('selected',active);row.setAttribute('aria-pressed',String(active));const badge=row.querySelector<HTMLElement>('.doorbell-detail-playing');if(badge){badge.hidden=!active;badge.textContent=this.video.paused?'已暂停':'播放中';}}
 }
}
