import {button,element} from './ui/dom';
import {renderCameraWeek} from './ui/camera-week';
import {cameraDatePicker,dismissCameraDatePicker} from './ui/camera-date-picker';
import {deviceWait} from './ui/device-loading';
import {officialIcon} from './icons';
import type {CameraClip} from './camera-types';
import {cameraDate,cameraDayStart,cameraHour} from './camera-time';

export {cameraDate} from './camera-time';
const clipKey=(clip:CameraClip)=>`${clip.channel}:${clip.start}`;
/** SD dates, time ruler and hourly album use only entries from this camera's index. */
export class CameraBrowser{
 readonly root=element('section','camera-playback-browser');
 readonly list=element('div','camera-clip-list');
 private date={value:cameraDate(Date.now()/1000)};
 private dayTitle=button('今天','camera-day-title',()=>this.toggleWeek());
 private week=element('div','camera-week');
 private channelTabs=element('div','camera-channel-tabs');private sourceClips:CameraClip[]=[];private channel=0;
 private ruler=element('div','camera-time-ruler');
 private tracks=element('div','camera-time-tracks');
 private timeline=element('div','camera-time-axis');
 private center=element('span','camera-time-center');
 private notice=element('div','camera-browser-notice');
 private all=button('全部回看视频','camera-all-clips',()=>this.showAlbum(true));
 private dayPicker:HTMLElement;private albumToolbar:HTMLElement;private albumStamp=element('p','camera-album-stamp');
 private previous:HTMLButtonElement;private next:HTMLButtonElement;
 private clips:CameraClip[]=[];private selected?:CameraClip;private cursor=Date.now()/1000;private pointer?:{x:number;cursor:number};
 private thumbnails=new Map<string,string>();private album=false;
 constructor(private play:(clip:CameraClip,offset?:number)=>void,private changed:(album:boolean)=>void=()=>{},private empty:()=>void=()=>{},private covers:(clips:CameraClip[])=>void=()=>{}){
  this.root.hidden=true;
  this.previous=button('','camera-day-arrow',()=>this.shift(-1));this.next=button('','camera-day-arrow',()=>this.shift(1));
  this.previous.append(officialIcon('camera:day-next'));this.next.append(officialIcon('camera:day-next'));
  this.previous.setAttribute('aria-label','前一天');this.next.setAttribute('aria-label','后一天');
  this.dayPicker=element('div','camera-day-picker',this.previous,this.dayTitle,this.next);
  const calendar=button('','camera-album-calendar',()=>{const min=this.clips.length?cameraDate(this.clips[0].start):cameraDate(Date.now()/1000);cameraDatePicker(calendar,this.date.value,value=>this.selectDate(value),min);});calendar.append(officialIcon('camera:calendar'));calendar.setAttribute('aria-label','选择回看日期');
  this.albumToolbar=element('div','camera-album-toolbar',element('h3','','全部视频'),element('div','camera-album-date-control',calendar));
  this.week.hidden=this.list.hidden=this.albumToolbar.hidden=this.albumStamp.hidden=true;this.all.setAttribute('aria-expanded','false');this.dayTitle.setAttribute('aria-expanded','false');
  this.timeline.tabIndex=0;this.timeline.setAttribute('role','slider');this.timeline.setAttribute('aria-label','回看时间轴');
  this.timeline.append(this.ruler,this.tracks,this.center);
  this.timeline.addEventListener('pointerdown',e=>{if(e.button!==0)return;this.pointer={x:e.clientX,cursor:this.cursor};this.timeline.setPointerCapture(e.pointerId);this.timeline.dataset.interacting='true';});
  this.timeline.addEventListener('pointermove',e=>{if(!this.pointer)return;this.cursor=this.bound(this.pointer.cursor-(e.clientX-this.pointer.x)/Math.max(1,this.timeline.getBoundingClientRect().width)*7200);this.paint();});
  const finish=(e:PointerEvent)=>{if(!this.pointer)return;this.pointer=undefined;delete this.timeline.dataset.interacting;if(this.timeline.hasPointerCapture(e.pointerId))this.timeline.releasePointerCapture(e.pointerId);if(e.type!=='pointercancel')this.seekCursor();};this.timeline.addEventListener('pointerup',finish);this.timeline.addEventListener('pointercancel',finish);
  this.timeline.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Enter'].includes(e.key))return;e.preventDefault();if(e.key!=='Enter'){this.cursor=this.bound(this.cursor+(e.key==='ArrowLeft'?-60:60));this.paint();}this.seekCursor();});
  this.channelTabs.hidden=true;this.root.append(this.channelTabs,this.dayPicker,this.week,this.timeline,this.albumToolbar,this.albumStamp,this.notice,this.list,this.all);
 }
 closeAlbum():boolean{if(!this.album)return false;this.showAlbum(false);return true;}
 private showAlbum(open:boolean):void{this.album=open;this.root.dataset.album=String(open);this.list.hidden=this.albumToolbar.hidden=this.albumStamp.hidden=!open;this.dayPicker.hidden=this.timeline.hidden=this.all.hidden=open;if(open){this.week.hidden=true;this.render();}else dismissCameraDatePicker(this.root.closest('.device-page')??this.root);this.all.setAttribute('aria-expanded',String(open));this.dayTitle.setAttribute('aria-expanded',String(!this.week.hidden));this.changed(open);}
 private toggleWeek():void{this.week.hidden=!this.week.hidden;this.dayTitle.setAttribute('aria-expanded',String(!this.week.hidden));}
 loading():void{this.showAlbum(false);this.week.hidden=true;this.clips=[];this.sourceClips=[];this.channelTabs.hidden=true;this.channelTabs.replaceChildren();this.channel=0;this.selected=undefined;this.thumbnails.clear();this.date.value=cameraDate(Date.now()/1000);this.notice.replaceChildren(deviceWait(undefined,'存储卡录像'));this.list.replaceChildren();this.paint();}
 failure():void{this.notice.textContent='存储卡录像读取失败，请重试。';}
 update(clips:CameraClip[]):void{this.sourceClips=[...clips].sort((a,b)=>a.start-b.start);if(!clips.some(c=>c.channel===this.channel))this.channel=clips[0]?.channel??0;this.selectChannel(this.channel,false);}
 private selectChannel(channel:number,play:boolean):void{this.channel=channel;this.clips=this.sourceClips.filter(c=>c.channel===channel);const channels=[...new Set(this.sourceClips.map(c=>c.channel))].sort((a,b)=>a-b);this.channelTabs.hidden=channels.length<2;this.channelTabs.replaceChildren(...channels.map((c,i)=>{const b=button(`镜头${i+1}`,'',()=>this.selectChannel(c,true));b.setAttribute('aria-pressed',String(c===channel));return b;}));this.render();if(play){const clip=this.dayClips().at(-1);if(clip)this.play(clip);else this.empty();}}
 latestClip(date:string):CameraClip|undefined{return this.clips.filter(c=>cameraDate(c.start)===date).at(-1);}
 position(clip:CameraClip,offset:number):void{if(clip.channel!==this.channel)this.selectChannel(clip.channel,false);this.selected=clip;if(!this.pointer&&!this.album){this.cursor=clip.start+offset;const key=cameraDate(this.cursor);if(key!==this.date.value){this.date.value=key;this.render();}else this.paint();}}
 hasThumbnail(clip:CameraClip):boolean{return this.thumbnails.has(clipKey(clip));}
 thumbnailUnavailable(clip:CameraClip):void{const preview=this.list.querySelector<HTMLElement>('[data-cover-key="'+clipKey(clip)+'"]');if(preview&&!preview.querySelector('img')){preview.setAttribute('aria-busy','false');preview.title='暂时无法读取封面，仍可点击播放录像';}}
 thumbnail(clip:CameraClip,data:string):void{this.thumbnails.set(clipKey(clip),data);while(this.thumbnails.size>72)this.thumbnails.delete(this.thumbnails.keys().next().value!);const preview=this.list.querySelector<HTMLElement>(`[data-cover-key="${clipKey(clip)}"]`);if(preview&&!preview.querySelector('img')){const image=element('img');image.src=data;image.alt='';preview.prepend(image);preview.removeAttribute('aria-busy');}}
 private bound(time:number):number{const day=cameraDayStart(this.date.value);return Math.max(day,Math.min(time,day+86400-1,Date.now()/1000));}
 private shift(days:number):void{const key=cameraDate(cameraDayStart(this.date.value)+days*86400+12*3600);if(key>cameraDate(Date.now()/1000))return;this.selectDate(key);}
 private selectDate(value:string):void{if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value>cameraDate(Date.now()/1000))return;this.date.value=value;const clips=this.dayClips(),clip=clips.at(-1);this.cursor=clip?clip.start:cameraDayStart(value)+12*3600;this.render();if(!this.album){if(clip)this.play(clip);else this.empty();}}
 private dayClips():CameraClip[]{return this.clips.filter(c=>cameraDate(c.start)===this.date.value);}
 private seekCursor():void{const clip=this.clips.find(c=>this.cursor>=c.start&&this.cursor<c.start+c.duration);if(clip){this.notice.textContent='';this.play(clip,Math.floor(this.cursor-clip.start));}else this.notice.textContent='此时间没有存储卡录像。';}
 private render():void{
  const date=this.date.value,dayClips=this.dayClips(),today=cameraDate(Date.now()/1000);this.dayTitle.textContent=date===today?'今天':date.replace(/-/g,'/');this.next.disabled=date>=today;
  this.albumStamp.textContent=`${date.replace(/-(\d{2})-(\d{2})$/,(_,m,d)=>`年${Number(m)}月${Number(d)}日`)}${date===today?' | 今天':''}`;
  const available=new Set(this.clips.map(c=>cameraDate(c.start)));
  renderCameraWeek(this.week,date,key=>this.selectDate(key),{available});
  // The original album groups the SD index into hours, rather than thousands of minute rows.
  const hours=new Map<number,CameraClip[]>();for(const clip of dayClips){const hour=cameraHour(clip.start);const entries=hours.get(hour)??[];entries.push(clip);hours.set(hour,entries);}
  const covers:CameraClip[]=[];
  this.list.replaceChildren(...[...hours].sort(([a],[b])=>b-a).map(([hour,clips])=>{const clip=clips[0],b=button('','camera-clip-row',()=>{this.showAlbum(false);this.play(clip);}),preview=element('span','camera-clip-preview');preview.dataset.coverKey=clipKey(clip);const cached=clips.map(c=>this.thumbnails.get(clipKey(c))).find(Boolean);if(cached){const img=element('img');img.src=cached;img.alt='';preview.append(img);}else{covers.push(clip);preview.setAttribute('aria-busy','true');}preview.append(officialIcon('camera:album-video'));b.append(preview,element('span','camera-clip-time',`${String(hour).padStart(2,'0')}:00`));b.dataset.clipCount=String(clips.length);b.setAttribute('aria-label',`${date} ${hour}时，${clips.length}段录像`);b.setAttribute('aria-pressed',String(clips.some(c=>clipKey(c)===(this.selected&&clipKey(this.selected)))));return b;}));
  if(this.album)this.covers(covers);
  this.notice.textContent=dayClips.length?'':'此日期没有存储卡录像。';this.all.disabled=!dayClips.length;this.paint();
 }
 private paint():void{
  this.ruler.replaceChildren();this.tracks.replaceChildren();const left=this.cursor-3600,right=this.cursor+3600;
  for(let time=Math.ceil(left/1800)*1800;time<right;time+=1800){const tick=element('span','camera-time-tick',new Date(time*1000).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}));tick.style.left=`${(time-left)/72}%`;this.ruler.append(tick);}
  for(const c of this.clips){if(c.start+c.duration<=left||c.start>=right)continue;const segment=element('span',`camera-recorded-segment${c.event?' event':''}`);segment.style.left=`${Math.max(0,(c.start-left)/72)}%`;segment.style.width=`${(Math.min(right,c.start+c.duration)-Math.max(left,c.start))/72}%`;this.tracks.append(segment);}
  this.timeline.setAttribute('aria-valuetext',new Date(this.cursor*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}));
 }
}
