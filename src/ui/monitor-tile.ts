import {CameraPlayer} from '../camera-page';
import {api} from '../api';
import {cameraQualityOptions,cameraQualityLabel,cameraQualityButtonLabel} from '../camera-quality';
import {deviceSurfaces} from './device-surfaces';
import type {DeviceContext} from '../types';
import type {CameraEvent,CameraOperation} from '../camera-types';
import type {MonitorRow,MonitorOperation} from '../monitor';
import type {CameraFeatures,CameraReply,SavedCameraMedia} from '../camera-types';
import {normalizeError} from '../logic';
import {officialIcon} from '../icons';
import {cameraOutlineIcon} from './camera-outline-icons';
import type {Device} from '../types';
import {button,element} from './dom';
export interface MonitorTileActions {
 command:(revision:number,operation:MonitorOperation)=>Promise<CameraReply>;
 screenshot:(revision:number,png:string)=>Promise<SavedCameraMedia|null>;
 open:()=>void;
 context?:DeviceContext;
 detailCommand?:(revision:number,operation:CameraOperation)=>Promise<CameraReply>;
 microphone?:(revision:number,packet:string)=>Promise<void>;
}
export class Tile {
 private openedAt=performance.now();private firstFrameMs?:number;
 readonly root=element('section','monitor-tile');readonly video:HTMLVideoElement;readonly page:CameraPlayer;private viewKey='';private events:CameraEvent[]=[];private features?:CameraFeatures;private poster?:HTMLImageElement;
 private label=element('span','monitor-name');private state=element('div','monitor-state');private spinner=element('i','monitor-spinner');private text=element('span');private retry:HTMLButtonElement;
 private revision=-1;private frame?:number;private failed=false;private disposed=false;
 private tools=element('div','monitor-tile-tools');private qualityMenu=element('div','monitor-quality-menu');private recordingMark=element('span','monitor-recording-mark','正在录制');
 private recoveryQuality?:string;private qualityRecoveries=0;private pendingQuality?:string;private qualityWriting=false;private quality='sd';private qualities:CameraFeatures['qualities']=[];private recording=false;private busy=false;private actionEpoch=0;
 private fullscreenButton=this.tool('画面全屏','fullscreen',()=>{void this.fullscreen();});
 private shotButton=this.tool('截图','snapshot',()=>{void this.snapshot();});
 private recordButton=this.tool('开始录像','record',()=>{void this.record();});
 private qualityButton=button('流畅','monitor-tile-button monitor-quality-button',()=>{this.renderQuality();this.qualityMenu.hidden=!this.qualityMenu.hidden;if(!this.qualityMenu.hidden)this.qualityMenu.querySelector<HTMLButtonElement>('[aria-checked=true]')?.focus();});
 constructor(public device:Device,private reconnect:()=>void,private decoderFailed:()=>void,private actions:MonitorTileActions){
  this.page=new CameraPlayer(()=>this.actions.open(),{
   monitor:true,cameraFeatures:async()=>this.features??{qualities:this.qualities,listen:false,talk:false,ptz:false,playback:false},
   startCamera:async()=>String(this.revision),stopCamera:async()=>{},readCamera:async()=>this.events.splice(0),
   cameraCommand:async(_c,_id,operation)=>{
    let reply:CameraReply|undefined;try{reply=operation.kind==='quality'||operation.kind==='record'?await this.actions.command(this.revision,operation):await this.actions.detailCommand?.(this.revision,operation);}catch(error){if(operation.kind==='quality'&&normalizeError(error).kind==='cameraQualityUncertain'){this.qualityRecoveries=0;this.recoverQuality(operation.quality);}throw error;}
    if(!reply)throw {kind:'staleContext',message:'请重新打开设备详情。',retryable:false};
    if(reply.state!=='cancelled'){if(operation.kind==='quality')this.quality=operation.quality;if(operation.kind==='record')this.recording=operation.enabled;this.page.syncControls(this.quality,this.recording,operation.kind==='record'&&operation.enabled?operation.lensId:undefined);this.updateButtons();}
    return reply;
   },cameraMicrophone:async(_c,_id,packet)=>{if(!this.actions.microphone)throw Error('对讲连接已关闭。');await this.actions.microphone(this.revision,packet);},
   cameraScreenshot:(_c,_id,png)=>this.actions.screenshot(this.revision,png),
  },()=>this.fail());this.video=this.page.video;
  this.root.dataset.did=device.did;this.label.textContent=device.name;this.video.muted=true;this.video.autoplay=true;this.video.playsInline=true;this.video.setAttribute('aria-label',device.name+'实时画面');
  this.retry=button('重新连接','monitor-retry',()=>{if(this.root.dataset.state==='closed')void this.wakeCamera();else reconnect();});this.state.append(this.spinner,this.text,this.retry);
  this.qualityButton.title='切换画质';this.qualityButton.setAttribute('aria-label','切换画质');this.qualityButton.setAttribute('aria-expanded','false');this.qualityButton.setAttribute('aria-haspopup','menu');
  this.tools.setAttribute('aria-label','摄像头工具');this.tools.append(this.fullscreenButton,this.shotButton,this.recordButton,this.qualityButton);
  this.qualityMenu.hidden=true;this.qualityMenu.setAttribute('role','menu');this.qualityMenu.setAttribute('aria-label','视频画质');this.recordingMark.hidden=true;
  this.root.tabIndex=0;this.root.setAttribute('aria-label',device.name+'，双击打开设备详情');
  this.root.append(deviceSurfaces(this.page.stage),this.label,this.state,this.recordingMark,this.tools,this.qualityMenu);
  this.root.addEventListener('dblclick',event=>{if(document.fullscreenElement===this.root||(event.target as Element).closest('button,.monitor-quality-menu'))return;event.preventDefault();this.actions.open();});
  this.root.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target===this.root&&document.fullscreenElement!==this.root){event.preventDefault();this.actions.open();}else if(event.key==='Escape'&&!this.qualityMenu.hidden){event.preventDefault();event.stopPropagation();this.hideQuality();this.qualityButton.focus();}});
  this.root.addEventListener('pointerleave',()=>{if(!this.qualityMenu.contains(document.activeElement))this.hideQuality();});
  this.root.addEventListener('pointerdown',event=>{if(!(event.target as Element).closest('.monitor-tile-tools,.monitor-quality-menu'))this.hideQuality();});
  this.root.addEventListener('focusout',event=>{if(!this.root.contains(event.relatedTarget as Node|null))this.hideQuality();});
  document.addEventListener('fullscreenchange',this.fullscreenChanged);
  this.page.stage.addEventListener('camera-recording-state',event=>{const detail=(event as CustomEvent<{recording:boolean;text:string}>).detail;this.recording=detail.recording;this.recordingMark.textContent=detail.text;this.updateButtons();});
  this.page.stage.addEventListener('camera-recording-saved',()=>this.showNotice('录像已保存到设置中的“录制”文件夹'));
  this.page.stage.addEventListener('camera-frame',()=>{if(!this.disposed){this.firstFrameMs??=performance.now()-this.openedAt;this.root.dataset.firstFrameMs=this.firstFrameMs.toFixed(1);this.root.dataset.playing='true';const video=this.page.primaryVideo;this.root.dataset.videoWidth=String(video.videoWidth);this.root.dataset.videoHeight=String(video.videoHeight);this.state.hidden=true;this.updateButtons();}});this.status(device.online?'connecting':'offline');
  this.updateButtons();
 }
 private tool(label:string,glyph:string,run:()=>void):HTMLButtonElement{const b=button('','monitor-tile-button',run);b.append(['snapshot','record','fullscreen'].includes(glyph)?cameraOutlineIcon(glyph as 'snapshot'|'record'|'fullscreen'):officialIcon('camera:'+glyph));b.title=label;b.setAttribute('aria-label',label);return b;}
 private fullscreenChanged=()=>{const full=document.fullscreenElement===this.root;this.fullscreenButton.setAttribute('aria-label',full?'退出画面全屏':'画面全屏');this.fullscreenButton.title=full?'退出画面全屏':'画面全屏';this.fullscreenButton.setAttribute('aria-pressed',String(full));};
 private async fullscreen():Promise<void>{try{if(document.fullscreenElement===this.root)await document.exitFullscreen();else await this.root.requestFullscreen();}catch(error){if(!this.disposed)this.showNotice(normalizeError(error).message);}}
 private hideQuality():void{this.qualityMenu.hidden=true;this.qualityButton.setAttribute('aria-expanded','false');}
 dismissOverlay():boolean{if(this.qualityMenu.hidden)return false;this.hideQuality();this.qualityButton.focus();return true;}
 private qualityLabel(id:string):string{return cameraQualityLabel(this.qualities,id,id===this.page.controls.quality?this.page.qualityResolution:undefined);}
 private updateButtons():void{
  if(!this.qualityWriting){const label=cameraQualityButtonLabel(this.qualities,this.quality),span=this.qualityButton.querySelector('span');if(span){if(span.textContent!==label)span.textContent=label;}else this.qualityButton.replaceChildren(element('span','',label));const title=`切换画质：${label}`;if(this.qualityButton.title!==title)this.qualityButton.title=title;if(this.qualityButton.getAttribute('aria-label')!==title)this.qualityButton.setAttribute('aria-label',title);}
  if(!this.qualityMenu.hidden)for(const choice of this.qualityMenu.querySelectorAll<HTMLButtonElement>('[data-quality]')){const id=choice.dataset.quality!,label=this.qualityLabel(id),span=choice.querySelector('span');if(span&&span.textContent!==label)span.textContent=label;}
  if(this.retry)this.retry.disabled=this.busy||this.root.dataset.state==='closed'&&!!this.device.sharedReadOnly;
  const ready=this.root.dataset.playing==='true'&&!this.failed;
  this.shotButton.disabled=this.busy||!ready;this.recordButton.disabled=this.busy||this.qualityWriting||!this.recording&&!ready;this.qualityButton.disabled=this.busy||this.recording||!ready||!this.qualities.length;
  if(this.recordButton.dataset.recording!==String(this.recording)){const glyph=this.recording?officialIcon('camera:recording'):cameraOutlineIcon('record');if(this.recording)glyph.setAttribute('viewBox','4 4 24 24');this.recordButton.replaceChildren(glyph);}
  this.recordButton.setAttribute('aria-label',this.recording?'结束录像':'开始录像');this.recordButton.title=this.recording?'结束录像':'开始录像';this.recordButton.setAttribute('aria-pressed',String(this.recording));this.recordButton.dataset.recording=String(this.recording);this.recordingMark.hidden=!this.recording;
 }
 private showNotice(message:string):void{this.root.setAttribute('aria-description',message);}
 private async perform(run:()=>Promise<void>):Promise<void>{if(this.busy||this.disposed)return;const epoch=++this.actionEpoch;this.busy=true;this.updateButtons();try{await run();}catch(error){if(epoch===this.actionEpoch&&!this.disposed)this.showNotice(normalizeError(error).message);}finally{if(epoch===this.actionEpoch&&!this.disposed){this.busy=false;this.updateButtons();}}}
 private async wakeCamera():Promise<void>{const context=this.actions.context;if(!context)return;await this.perform(async()=>{const state=await api.cameraPower(context);if(!state.writable||state.awake===null)throw Error(state.reason??'当前不能唤醒此摄像机。');await api.changeCameraPower(context,true,state.awake);});}
 private async snapshot():Promise<void>{if(!this.page.hasDecodedVideo)return;const epoch=this.actionEpoch+1,revision=this.revision;await this.perform(async()=>{const file=await this.actions.screenshot(revision,this.page.screenshotPixels());if(epoch===this.actionEpoch&&!this.disposed&&file)this.showNotice('截图已保存');});}
 private async record():Promise<void>{
  const video=this.page.primaryVideo,enabled=!this.recording;
  if(enabled&&video.readyState<2||this.busy||this.disposed||this.qualityWriting)return;
  const operation:MonitorOperation=enabled?{kind:'record',enabled:true,width:video.videoWidth,height:video.videoHeight,lensId:this.page.primaryLensId,...this.page.recordingPoint}:{kind:'record',enabled:false,...this.page.recordingPoint};
  const revision=this.revision,epoch=this.actionEpoch+1,release=this.page.holdRecordingChange();
  try{await this.perform(async()=>{const reply=await this.actions.command(revision,operation);if(epoch!==this.actionEpoch||this.disposed)return;if(reply.state!=='cancelled'){this.recording=enabled;this.page.syncControls(this.quality,this.recording,operation.enabled?operation.lensId:undefined);if(reply.file)this.showNotice('录像已保存');}});}
  finally{release();}
 }
 private renderQuality():void{this.qualityMenu.replaceChildren();this.qualityButton.setAttribute('aria-expanded',String(this.qualityMenu.hidden));for(const q of cameraQualityOptions(this.qualities,this.page.qualityResolution,this.page.controls.quality===this.quality?this.quality:undefined)){const choice=button('','',()=>{if(q.available)void this.changeQuality(q.id);});choice.append(element('span','',q.label));choice.disabled=!q.available;choice.setAttribute('role','menuitemradio');choice.setAttribute('aria-checked',String(q.available&&q.id===this.quality));choice.dataset.quality=q.id;choice.dataset.qualityMode=q.mode;this.qualityMenu.append(choice);}}
 private async changeQuality(quality:string,recovering=false):Promise<void>{
  if(!recovering)this.qualityRecoveries=0;
  this.hideQuality();if(this.recording||!this.qualities.some(q=>q.id===quality))return;
  this.pendingQuality=quality;this.qualityButton.replaceChildren(element('span','',cameraQualityButtonLabel(this.qualities,quality)));
  if(this.qualityWriting)return;this.qualityWriting=true;const epoch=this.actionEpoch,revision=this.revision;this.qualityButton.setAttribute('aria-busy','true');this.updateButtons();
  try{while(this.pendingQuality!==undefined&&epoch===this.actionEpoch&&!this.disposed){const next=this.pendingQuality;this.pendingQuality=undefined;if(next===this.quality)continue;try{await this.actions.command(revision,{kind:'quality',quality:next});if(epoch!==this.actionEpoch)return;this.quality=next;this.page.syncControls(this.quality,this.recording);}catch(error){if(epoch===this.actionEpoch){if(normalizeError(error).kind==='cameraQualityUncertain'&&this.recoverQuality(this.pendingQuality??next)){this.pendingQuality=undefined;break;}this.showNotice(normalizeError(error).message);}}}}
  finally{if(epoch===this.actionEpoch){this.qualityWriting=false;this.qualityButton.setAttribute('aria-busy','false');this.qualityButton.replaceChildren(element('span','',cameraQualityButtonLabel(this.qualities,this.quality)));this.updateButtons();}}
 }

 private recoverQuality(quality:string):boolean{if(this.qualityRecoveries>=1)return false;this.qualityRecoveries++;this.recoveryQuality=quality;this.reconnect();return true;}
 get routeRevision():number{return this.revision;}
 get isBorrowed():boolean{return !!this.poster;}
 takeView():HTMLElement {
  if(!this.poster){const image=document.createElement('img');image.className='monitor-last-frame';image.alt='';if(this.page.hasDecodedVideo)try{image.src='data:image/png;base64,'+this.page.screenshotPixels();}catch{/* Retain black placeholder when no frame is available. */}this.poster=image;this.root.prepend(image);}
  this.page.setMonitorPresentation(false);this.page.syncControls(this.quality,this.recording);return this.page.stage;
 }
 returnView():void{this.page.activatePower(false);this.page.setMonitorPresentation(true);if(this.disposed)return;this.root.prepend(this.page.stage);this.poster?.remove();this.poster=undefined;this.quality=this.page.controls.quality;this.recording=this.page.controls.recording;this.updateButtons();}
 update(row:MonitorRow):void {
  if(this.disposed||row.revision<this.revision)return;
  if(row.revision>this.revision){++this.actionEpoch;this.busy=false;this.qualityWriting=false;this.pendingQuality=undefined;this.recording=false;this.hideQuality();this.quality='sd';this.disposePlayer();this.page.dispose();this.revision=row.revision;this.failed=false;this.root.dataset.decodedFrames='0';}
  if(row.qualities)this.qualities=row.qualities;if(row.features){this.features=row.features;this.page.applyFeatures(row.features);}
  this.label.textContent=this.device.name;this.root.dataset.revision=String(row.revision);this.root.dataset.state=row.state;
  if(row.timings)this.root.dataset.startupTimings=JSON.stringify(row.timings);
  const unavailable=['offline','closed','error'].includes(row.state),context=this.actions.context??{homeId:'monitor',generation:1,did:this.device.did};
  const viewKey=JSON.stringify([this.revision,this.device.name,this.device.online,unavailable]);if(this.viewKey!==viewKey){this.viewKey=viewKey;this.page.update(context,this.device,{loading:unavailable});}this.page.syncControls(this.quality,this.recording);
  if(unavailable){this.disposePlayer();this.page.unavailable(row.state);this.status(row.state);return;}
  if(this.failed)return;
  for(const event of row.events){if(event.file||event.state==='recording-stopped')this.recording=false;if(event.state==='recording')this.recording=true;if(event.state==='operation-error'&&event.error)this.showNotice(event.error.message);if(this.page.controls.mode!=='cloud'||!event.data)this.events.push(event);}
  if(this.frame===undefined)this.watch();
  if(this.root.dataset.playing!=='true')this.status('connecting');this.updateButtons();
 }
 private watch():void{this.frame=this.video.requestVideoFrameCallback((_time,metadata)=>{this.frame=undefined;if(this.disposed)return;this.firstFrameMs??=performance.now()-this.openedAt;this.root.dataset.firstFrameMs=this.firstFrameMs.toFixed(1);this.root.dataset.playing='true';this.root.dataset.decodedFrames=String(metadata.presentedFrames);this.root.dataset.videoWidth=String(this.video.videoWidth);this.root.dataset.videoHeight=String(this.video.videoHeight);this.state.hidden=true;this.updateButtons();if(this.recoveryQuality&&!this.qualityWriting){const quality=this.recoveryQuality;this.recoveryQuality=undefined;void this.changeQuality(quality,true);}this.watch();});}
 private status(state:string):void {
  this.state.hidden=false;this.spinner.hidden=state!=='connecting';this.retry.hidden=!['error','closed'].includes(state);
  this.text.textContent=state==='offline'?'摄像机离线':state==='closed'?'摄像机休眠中':state==='error'?'无法连接':'';
  this.retry.textContent=state==='closed'?'唤醒摄像机':'重新连接';
  this.root.dataset.state=state;
  if(['offline','closed','error'].includes(state)){++this.actionEpoch;this.busy=false;this.qualityWriting=false;this.pendingQuality=undefined;this.recording=false;this.hideQuality();}this.updateButtons();
 }
 private fail():void {if(this.disposed||this.failed)return;this.failed=true;this.disposePlayer();this.status('error');this.root.dataset.decoderFailed='true';this.decoderFailed();}
 private disposePlayer():void{this.viewKey='';if(this.frame!==undefined)this.video.cancelVideoFrameCallback(this.frame);this.frame=undefined;this.events=[];this.page.stop();delete this.root.dataset.playing;}

 dispose():void{this.disposed=true;++this.actionEpoch;document.removeEventListener('fullscreenchange',this.fullscreenChanged);if(document.fullscreenElement===this.root)void document.exitFullscreen().catch(()=>{});this.disposePlayer();this.page.dispose();this.poster?.remove();this.root.remove();}
}
