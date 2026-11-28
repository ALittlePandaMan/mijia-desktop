import {hasMediaFrame,mediaView} from '../media-surface';
import {dismissOutsideMenu} from './dialog-dismiss';
import {monitorTool,renderMonitorQuality} from './camera-control-view';
import {CameraPlayer,type CameraFrameNotice} from '../camera-page';
import {api} from '../api';
import {cameraQualityOptions} from '../camera-quality';
import {deviceSurfaces} from './device-surfaces';
import type {DeviceContext} from '../types';
import type {CameraEvent,CameraOperation} from '../camera-types';
import type {MonitorRow,MonitorOperation} from '../monitor';
import type {CameraFeatures,CameraReply,SavedCameraMedia} from '../camera-types';
import {normalizeError} from '../logic';
import {DECODER_WAITING} from '../playback-error';
import {cameraOutlineIcon,type CameraOutlineIcon} from './camera-outline-icons';
import {cameraSoundIcon} from './camera-sound-icons';
import {showCameraMediaSaved,clearCameraMediaToast} from './camera-media-toast';
import {cameraTalkingStatus} from './camera-talking-status';
import type {Device} from '../types';
import {button,element} from './dom';
export interface MonitorTileActions {
 label?:string;
 fullscreenInWall:()=>boolean;
 initialQuality?:string;
 rememberQuality?:(quality:string)=>void;
 command:(revision:number,operation:MonitorOperation)=>Promise<CameraReply>;
 screenshot:(revision:number,png:string)=>Promise<SavedCameraMedia|null>;
 open:()=>void;
 context?:DeviceContext;
 detailCommand?:(revision:number,operation:CameraOperation)=>Promise<CameraReply>;
 microphone?:(revision:number,packet:string)=>Promise<void>;
 beforeTalk?:()=>Promise<void>;
}
export class Tile {
 private readonly openedAt=performance.now();
 readonly root=element('section','monitor-tile');readonly page:CameraPlayer;private viewKey='';private events:CameraEvent[]=[];private features?:CameraFeatures;private poster?:HTMLImageElement;
 private label=element('span','monitor-name');private state=element('div','monitor-state');private spinner=element('i','monitor-spinner');private text=element('span');private retry:HTMLButtonElement;
 private footer=element('div','monitor-tile-footer');
 private revision=-1;private failed=false;private disposed=false;
 private tools=element('div','monitor-tile-tools camera-toolbar-motion');private qualityMenu=element('div','monitor-quality-menu');private recordingMark=element('span','monitor-recording-mark','正在录制');
 private closeQualityListeners?:()=>void;
 private talkingMark=cameraTalkingStatus('monitor-talking-mark');
 private recoveryQuality?:string;private qualityRecoveries=0;private pendingQuality?:string;private qualityWriting=false;private quality='sd';private qualities:CameraFeatures['qualities']=[];private recording=false;private busy=false;private actionEpoch=0;
 get blocksSuspension():boolean{return this.resourcePaused?this.protectedWork:this.recording||this.busy||this.qualityWriting||this.page.blocksSuspension;}
 private resourcePaused=false;
 private playingElsewhere=false;
 get resourceIsPaused():boolean{return this.resourcePaused;}
 get protectedWork():boolean{return this.recording||this.busy||this.qualityWriting||this.page.controls.mode!=='live'||this.page.protectedWork;}
 setResourcePaused(paused:boolean,presentationHidden=false):boolean{
  this.page.setMonitorHidden(paused||presentationHidden);
  if(paused&&this.protectedWork)return false;
  if(this.resourcePaused===paused)return this.resourcePaused;
  this.resourcePaused=paused;
  if(paused){this.events=[];delete this.root.dataset.playing;this.hideQuality();}
  this.page.setMonitorPreviewPaused(paused);
  return paused;
 }
 private fullscreenButton=this.tool('画面全屏','fullscreen',()=>{void this.fullscreen();});
 private shotButton=this.tool('截图','snapshot',()=>{void this.snapshot();});
 private recordButton=this.tool('开始录像','record',()=>{void this.record();});
 private soundButton=this.tool('打开声音','muted',()=>{void this.page.toggleSound();});
 private talkButton=this.tool('开始通话','microphone',()=>{void this.page.toggleTalk();});
 private talkGlyph=element('span','camera-talk-glyph');
 private qualityButton=button('流畅','monitor-tile-button monitor-quality-button',()=>{if(!this.qualityMenu.hidden){this.hideQuality();return;}this.qualityMenu.hidden=false;this.renderQuality();this.closeQualityListeners=dismissOutsideMenu(this.tools,this.qualityMenu,()=>this.hideQuality());this.qualityMenu.querySelector<HTMLButtonElement>('[aria-checked=true]')?.focus();});
 constructor(public device:Device,private reconnect:()=>void,private decoderFailed:()=>void,private actions:MonitorTileActions){
  this.recoveryQuality=actions.initialQuality;
  this.page=new CameraPlayer(()=>this.actions.open(),{
   monitor:true,cameraPower:api.cameraPower,changeCameraPower:api.changeCameraPower,
   cameraAuxiliary:api.cameraAuxiliary,changeCameraAuxiliary:api.changeCameraAuxiliary,
   cameraCare:api.cameraCare,cameraCareVideo:api.cameraCareVideo,
   cameraCareThumbnail:api.cameraCareThumbnail,saveCloudVideo:api.saveCloudVideo,
   cameraFeatures:async()=>this.features??{qualities:this.qualities,listen:false,talk:false,ptz:false,playback:false},
   startCamera:async()=>String(this.revision),stopCamera:async()=>{},readCamera:async()=>this.events.splice(0),
   cameraCommand:async(_c,_id,operation)=>{
    const revision=Number(_id);
    if(revision!==this.revision||this.disposed)throw Error('摄像机会话已改变。');
    if(operation.kind==='talk'&&operation.enabled){
     const {talkEpoch}=this.page.audioControls;
     await this.actions.beforeTalk?.();
     const current=this.page.audioControls;
     if(!current.talkPending||current.talkEpoch!==talkEpoch||revision!==this.revision||this.disposed)throw Error('通话已取消。');
    }
    const tileCommand=operation.kind==='quality'||operation.kind==='record'||!this.isBorrowed&&(operation.kind==='listen'||operation.kind==='talk');
    let reply:CameraReply|undefined;try{reply=tileCommand?await (operation.kind==='quality'?this.sendQuality(revision,operation.quality):this.actions.command(revision,operation as MonitorOperation)):await this.actions.detailCommand?.(revision,operation);}catch(error){if(operation.kind==='quality'&&normalizeError(error).kind==='cameraQualityUncertain'){this.qualityRecoveries=0;this.recoverQuality(operation.quality);}throw error;}
    if(revision!==this.revision||this.disposed)throw Error('摄像机会话已改变。');
    if(!reply)throw {kind:'staleContext',message:'请重新打开设备详情。',retryable:false};
    if(reply.state!=='cancelled'){if(operation.kind==='quality')this.rememberQuality(operation.quality);if(operation.kind==='record')this.recording=operation.enabled;this.page.syncControls(this.quality,this.recording,operation.kind==='record'&&operation.enabled?operation.lensId:undefined);this.updateButtons();}
    return reply;
   },cameraMicrophone:async(_c,id,packet)=>{
    const revision=Number(id);
    if(revision!==this.revision||this.disposed||!this.actions.microphone)throw Error('对讲连接已关闭。');
    await this.actions.microphone(revision,packet);
   },
   cameraScreenshot:(_c,_id,png)=>this.actions.screenshot(this.revision,png),
  },()=>this.fail());
  this.root.dataset.did=device.did;this.label.textContent=actions.label??device.name;this.page.video.setAttribute('aria-label',device.name+'实时画面');
  this.retry=button('重新连接','monitor-retry',()=>{void this.retryConnection();});this.state.append(this.spinner,this.text,this.retry);
  this.qualityButton.setAttribute('aria-description','切换画质');this.qualityButton.setAttribute('aria-label','切换画质');this.qualityButton.setAttribute('aria-expanded','false');this.qualityButton.setAttribute('aria-haspopup','menu');
  this.soundButton.classList.add('monitor-audio-button');this.talkButton.classList.add('monitor-audio-button');this.talkGlyph.append(...this.talkButton.childNodes);this.talkButton.append(this.talkGlyph);
  this.tools.setAttribute('role','toolbar');this.tools.setAttribute('aria-label','摄像头工具');this.tools.append(this.fullscreenButton,this.shotButton,this.recordButton,this.soundButton,this.talkButton,this.qualityButton);
  this.qualityMenu.hidden=true;this.qualityMenu.setAttribute('role','menu');this.qualityMenu.setAttribute('aria-label','视频画质');this.recordingMark.hidden=true;
  this.root.tabIndex=0;this.root.setAttribute('aria-label',device.name+'，双击打开设备详情');
  this.footer.append(this.label,this.tools);this.root.append(deviceSurfaces(this.page.stage),this.footer,this.state,this.recordingMark,this.talkingMark,this.qualityMenu);
  this.root.addEventListener('dblclick',event=>{if(this.isFullscreen||(event.target as Element).closest('button,.monitor-quality-menu'))return;event.preventDefault();this.actions.open();});
  this.root.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target===this.root&&!this.isFullscreen){event.preventDefault();this.actions.open();}else if(event.key==='Escape'&&!this.qualityMenu.hidden){event.preventDefault();event.stopPropagation();this.hideQuality();this.qualityButton.focus();}});
  this.root.addEventListener('pointerleave',()=>{if(!this.qualityMenu.contains(document.activeElement))this.hideQuality();});
  this.root.addEventListener('pointerdown',event=>{if(!(event.target as Element).closest('.monitor-tile-tools,.monitor-quality-menu'))this.hideQuality();});
  this.root.addEventListener('focusout',event=>{if(!this.root.contains(event.relatedTarget as Node|null))this.hideQuality();});
  document.addEventListener('fullscreenchange',this.fullscreenChanged);
  this.page.stage.addEventListener('camera-recording-state',event=>{const detail=(event as CustomEvent<{recording:boolean;text:string}>).detail;this.recording=detail.recording;this.recordingMark.textContent=detail.text;this.updateButtons();});
  this.page.stage.addEventListener('camera-recording-saved',event=>this.mediaSaved((event as CustomEvent<SavedCameraMedia>).detail));
  this.page.stage.addEventListener('camera-audio-state',()=>this.updateAudioButtons());
  this.page.stage.addEventListener('camera-frame',event=>this.onFrame((event as CustomEvent<CameraFrameNotice>).detail));
  this.status(device.online?'connecting':'offline');
  this.updateButtons();
 }
 private tool(label:string,glyph:CameraOutlineIcon,run:()=>void):HTMLButtonElement{return monitorTool(label,glyph,run);}
 private get isFullscreen():boolean{return document.fullscreenElement===this.root||this.root.hasAttribute('data-wall-fullscreen');}
 private fullscreenChanged=()=>{const full=this.isFullscreen;this.fullscreenButton.setAttribute('aria-label',full?'退出画面全屏':'画面全屏');this.fullscreenButton.setAttribute('aria-description',full?'退出画面全屏':'画面全屏');this.fullscreenButton.setAttribute('aria-pressed',String(full));};
 setWallFullscreen(value:boolean):void{this.root.toggleAttribute('data-wall-fullscreen',value);this.fullscreenChanged();}
 private async fullscreen():Promise<void>{try{if(document.fullscreenElement===this.root)await document.exitFullscreen();else if(!this.actions.fullscreenInWall())await this.root.requestFullscreen();}catch(error){if(!this.disposed)this.showNotice(normalizeError(error).message);}}
 private hideQuality():void{this.closeQualityListeners?.();this.closeQualityListeners=undefined;this.qualityMenu.hidden=true;this.qualityButton.setAttribute('aria-expanded','false');}
 dismissOverlay():boolean{if(this.qualityMenu.hidden)return false;this.hideQuality();this.qualityButton.focus();return true;}
 private updateButtons():void{
  this.updateAudioButtons();
  if(!this.qualityWriting){const label=this.page.qualityButtonLabel(this.quality),span=this.qualityButton.querySelector('span');if(span){if(span.textContent!==label)span.textContent=label;}else this.qualityButton.replaceChildren(element('span','',label));const title=`切换画质：${label}`;if((this.qualityButton.getAttribute('aria-description')??'')!==title)this.qualityButton.setAttribute('aria-description',title);if(this.qualityButton.getAttribute('aria-label')!==title)this.qualityButton.setAttribute('aria-label',title);}
  if(!this.qualityMenu.hidden){
   const options=cameraQualityOptions(this.page.qualityProfiles,this.page.qualitySizes()),choices=[...this.qualityMenu.querySelectorAll<HTMLButtonElement>('[data-quality]')];
   if(options.length!==choices.length||options.some((q,i)=>q.id!==choices[i]?.dataset.quality)){this.renderQuality();}
   else for(const [i,choice]of choices.entries()){const q=options[i],span=choice.querySelector('span');if(span&&span.textContent!==q.label)span.textContent=q.label;choice.setAttribute('aria-checked',String(q.id===this.quality||q.aliases.includes(this.quality)));}
  }
  if(this.retry)this.retry.disabled=this.busy||this.root.dataset.state==='closed'&&!!this.device.sharedReadOnly;
  const ready=this.root.dataset.playing==='true'&&!this.failed;
  this.shotButton.disabled=this.busy||!ready||!this.page.hasDecodedVideo;this.recordButton.disabled=this.busy||this.qualityWriting||!this.recording&&(!ready||!hasMediaFrame(this.page.primaryVideo));this.qualityButton.disabled=this.busy||this.recording||!ready||!this.qualities.length;
  if(this.recordButton.dataset.recording!==String(this.recording))this.recordButton.replaceChildren(cameraOutlineIcon(this.recording?'stop':'record'));
  this.recordButton.setAttribute('aria-label',this.recording?'结束录像':'开始录像');this.recordButton.setAttribute('aria-description',this.recording?'结束录像':'开始录像');this.recordButton.setAttribute('aria-pressed',String(this.recording));this.recordButton.dataset.recording=String(this.recording);this.recordingMark.hidden=!this.recording;
 }
 private updateAudioButtons():void{
  if(!this.page)return;const state=this.page.audioControls;
  this.talkingMark.hidden=!state.talking||state.talkPending;
  const sound=state.listening?'on':'off';if(this.soundButton.dataset.sound!==sound){this.soundButton.dataset.sound=sound;this.soundButton.replaceChildren(cameraSoundIcon(state.listening));}
  this.soundButton.disabled=state.soundDisabled;this.soundButton.setAttribute('aria-busy',String(state.soundPending));this.soundButton.setAttribute('aria-pressed',String(state.listening));this.soundButton.setAttribute('aria-description',state.listening?'关闭声音':'打开声音');this.soundButton.setAttribute('aria-label',(this.soundButton.getAttribute('aria-description')??''));
  const talk=state.talking?'on':'off';if(this.talkButton.dataset.talk!==talk){this.talkButton.dataset.talk=talk;this.talkGlyph.replaceChildren(cameraOutlineIcon('microphone'));}
  this.talkButton.disabled=state.talkDisabled;this.talkButton.setAttribute('aria-busy',String(state.talkPending));this.talkButton.setAttribute('aria-pressed',String(state.talking));this.talkButton.setAttribute('aria-description',state.talkLabel);this.talkButton.setAttribute('aria-label',state.talkLabel);this.talkButton.classList.toggle('is-speaking',state.speaking);
 }
 private showNotice(message:string):void{this.root.setAttribute('aria-description',message);}
 private mediaSaved(file:SavedCameraMedia):void{this.showNotice(file.kind==='screenshot'?'截图已保存':'录像已保存');showCameraMediaSaved(this.root,file);}
 private async perform(run:()=>Promise<void>):Promise<void>{if(this.busy||this.disposed)return;const epoch=++this.actionEpoch;this.busy=true;this.updateButtons();try{await run();}catch(error){if(epoch===this.actionEpoch&&!this.disposed)this.showNotice(normalizeError(error).message);}finally{if(epoch===this.actionEpoch&&!this.disposed){this.busy=false;this.updateButtons();}}}
 private async wakeCamera():Promise<void>{const context=this.actions.context;if(!context)return;await this.perform(async()=>{const state=await api.cameraPower(context);if(!state.writable||state.awake===null)throw Error(state.reason??'当前不能唤醒此摄像机。');await api.changeCameraPower(context,true,state.awake);});}
 private async snapshot():Promise<void>{if(!this.page.hasDecodedVideo)return;const epoch=this.actionEpoch+1,revision=this.revision;await this.perform(async()=>{const file=await this.actions.screenshot(revision,this.page.screenshotPixels());if(epoch===this.actionEpoch&&!this.disposed&&file)this.mediaSaved(file);});}
 private async record():Promise<void>{
  const video=this.page.primaryVideo,enabled=!this.recording;
  if(enabled&&!hasMediaFrame(video)||this.busy||this.disposed||this.qualityWriting)return;
  const operation:MonitorOperation=enabled?{kind:'record',enabled:true,width:mediaView(video).videoWidth,height:mediaView(video).videoHeight,lensId:this.page.primaryLensId,...this.page.recordingPoint}:{kind:'record',enabled:false,...this.page.recordingPoint};
  const revision=this.revision,epoch=this.actionEpoch+1,release=this.page.holdRecordingChange();
  try{await this.perform(async()=>{const reply=await this.actions.command(revision,operation);if(epoch!==this.actionEpoch||this.disposed)return;if(reply.state!=='cancelled'){this.recording=enabled;this.page.syncControls(this.quality,this.recording,operation.enabled?operation.lensId:undefined);if(reply.file)this.mediaSaved(reply.file);}});}
  finally{release();}
 }
 private renderQuality():void{
  this.qualityButton.setAttribute('aria-expanded',String(!this.qualityMenu.hidden));
  renderMonitorQuality(this.qualityMenu,this.page.qualityProfiles,this.quality,id=>{void this.changeQuality(id);},this.page.qualitySizes());
 }
 private sendQuality(revision:number,quality:string):Promise<CameraReply>{
  return this.actions.command(revision,{kind:'quality',quality});
 }
 private rememberQuality(quality:string):void{this.quality=quality;this.actions.rememberQuality?.(quality);}
 private async changeQuality(quality:string,recovering=false):Promise<void>{
  if(!recovering)this.qualityRecoveries=0;
  this.hideQuality();if(this.recording||!this.qualities.some(q=>q.id===quality))return;
  this.pendingQuality=quality;this.qualityButton.replaceChildren(element('span','',this.page.qualityButtonLabel(quality)));
  if(this.qualityWriting)return;this.qualityWriting=true;const epoch=this.actionEpoch,revision=this.revision;this.qualityButton.setAttribute('aria-busy','true');this.updateButtons();
  try{while(this.pendingQuality!==undefined&&epoch===this.actionEpoch&&!this.disposed){const next=this.pendingQuality;this.pendingQuality=undefined;if(next===this.quality)continue;this.page.beginQualityChange(next);try{const reply=await this.sendQuality(revision,next);if(epoch!==this.actionEpoch)return;if(reply.state==='cancelled'){this.page.cancelQualityChange();continue;}this.rememberQuality(next);this.page.syncControls(this.quality,this.recording);}catch(error){if(epoch===this.actionEpoch){this.page.cancelQualityChange();if(normalizeError(error).kind==='cameraQualityUncertain'&&this.recoverQuality(this.pendingQuality??next)){this.pendingQuality=undefined;break;}this.showNotice(normalizeError(error).message);}}}}
  finally{if(epoch===this.actionEpoch){this.qualityWriting=false;this.qualityButton.setAttribute('aria-busy','false');this.qualityButton.replaceChildren(element('span','',this.page.qualityButtonLabel(this.quality)));this.updateButtons();}}
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
  if(this.resourcePaused)return;
  if(this.disposed||row.revision<this.revision)return;
  if(row.revision>this.revision){++this.actionEpoch;this.busy=false;this.qualityWriting=false;this.pendingQuality=undefined;this.recording=false;this.hideQuality();this.disposePlayer();this.page.dispose();this.revision=row.revision;this.failed=false;delete this.root.dataset.decoderFailed;this.root.dataset.decodedFrames='0';}
  if(row.qualities)this.qualities=row.qualities;if(row.features){this.features=row.features;this.page.applyFeatures(row.features);}
   this.label.textContent=this.actions.label??this.device.name;this.root.dataset.revision=String(row.revision);this.root.dataset.state=row.state;
  if(row.timings)this.root.dataset.startupTimings=JSON.stringify(row.timings);
  const unavailable=['offline','closed','error'].includes(row.state),context=this.actions.context??{homeId:'monitor',generation:1,did:this.device.did};
  const viewKey=JSON.stringify([this.revision,this.device.name,this.device.online,unavailable]);if(this.viewKey!==viewKey){this.viewKey=viewKey;this.page.update(context,this.device,{loading:unavailable});}this.page.syncControls(this.quality,this.recording);
  if(unavailable){this.disposePlayer();this.page.unavailable(row.state);this.status(row.state,row.error?.kind==='cameraInUse');return;}
  if(this.failed)return;
  const cloud=this.page.controls.mode==='cloud';
  if(cloud)this.events.length=0;
  for(const event of row.events){
   if(event.file)this.mediaSaved(event.file);
   if(event.file||event.state==='recording-stopped')this.recording=false;
   if(event.state==='recording')this.recording=true;
   if(event.state==='operation-error'&&event.error)this.showNotice(event.error.message);
   if(!cloud)this.events.push(event);
  }
  if(this.root.dataset.playing!=='true')this.status('connecting');this.updateButtons();
 }
 private onFrame({lensId,count}:CameraFrameNotice):void{
  if(this.disposed||this.failed||this.resourcePaused)return;
  const data=this.root.dataset,ready=data.playing==='true';
  data.firstFrameMs??=(performance.now()-this.openedAt).toFixed(1);
  const view=mediaView(this.page.primaryVideo),width=String(view.videoWidth),height=String(view.videoHeight);
  const changed=data.videoWidth!==width||data.videoHeight!==height;
  if(changed){data.videoWidth=width;data.videoHeight=height;}
  if(lensId===this.page.primaryLensId)data.decodedFrames=String(count);
  if(!ready){data.playing='true';this.state.hidden=true;}
  if(!ready||changed)this.updateButtons();
  if(this.recoveryQuality&&!this.qualityWriting){const quality=this.recoveryQuality;this.recoveryQuality=undefined;void this.changeQuality(quality,true);}
 }
 private async retryConnection():Promise<void>{
  if(this.root.dataset.state==='closed'){await this.wakeCamera();return;}
  if(this.playingElsewhere&&this.actions.context){
   const revision=this.revision;
   if(await api.focusCameraView(this.actions.context).catch(()=>false)||this.disposed||this.revision!==revision)return;
  }
  this.reconnect();
 }
 private status(state:string,playingElsewhere=false):void {
  this.playingElsewhere=playingElsewhere;
  this.state.hidden=false;this.spinner.hidden=state!=='connecting';this.retry.hidden=!['error','closed'].includes(state);
  this.text.textContent=playingElsewhere?'摄像机正在另一个窗口播放':state==='offline'?'摄像机离线':state==='closed'?'摄像机休眠中':state==='error'?'无法连接':this.page.waitingForDecoder?DECODER_WAITING:'';
  this.retry.textContent=playingElsewhere?'查看播放窗口':state==='closed'?'唤醒摄像机':'重新连接';
  this.root.dataset.state=state;
  if(['offline','closed','error'].includes(state)){++this.actionEpoch;this.busy=false;this.qualityWriting=false;this.pendingQuality=undefined;this.recording=false;this.hideQuality();}this.updateButtons();
 }
 private fail():void {if(this.disposed||this.failed)return;this.failed=true;this.disposePlayer();this.status('error');this.root.dataset.decoderFailed='true';this.decoderFailed();}
 private disposePlayer():void{this.viewKey='';this.events=[];this.page.stop();delete this.root.dataset.playing;}

 dispose():void{this.disposed=true;++this.actionEpoch;this.hideQuality();clearCameraMediaToast(this.root);document.removeEventListener('fullscreenchange',this.fullscreenChanged);if(document.fullscreenElement===this.root)void document.exitFullscreen().catch(()=>{});this.disposePlayer();this.page.dispose();this.poster?.remove();this.root.remove();}
}
