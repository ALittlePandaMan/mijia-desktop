import {hasMediaFrame,mediaSource,mediaView,requestMediaFrame,cancelMediaFrame,setMediaContext,setMediaInset,softwareSurface} from './media-surface';
import {CloudVideoSequence} from './cloud-video-sequence';
import {dismissCameraDatePicker} from './ui/camera-date-picker';
import {PropertyOperations} from './property-operations';
import {nativeVideoPlayer,loadVideoEngine,nativeVideoSupported,type NativeVideoPlayer} from './native-video';
import {DECODER_WAITING,playbackMessage} from './playback-error';
import {dismissOnBackdrop} from './ui/dialog-dismiss';
import {CameraFrameWatchdog} from './camera-frame-watchdog';
import {CameraLensPlayer,captureCameraLayout,captureCameraLens} from './camera-lens-player';
import {CameraMediaGate} from './camera-media-gate';
import {decodeCameraPacket} from './camera-packet';
import {CameraReplayBuffer,replayBufferedAhead} from './camera-replay-buffer';
import {CameraFrameClock,type CameraRecordingPoint} from './camera-frame-clock';
import {primaryCameraLens,rememberCameraLens} from './camera-lens-preferences';
import type {api} from './api';
import{button,element}from './ui/dom';
import{icon,officialIcon}from './icons';
import{normalizeError,sameContext}from './logic';
import{capabilityProperty}from './device-capabilities';
import{booleanValue}from './panel-layout';
import{CameraAudio}from './camera-audio';
import{CameraBrowser}from './camera-browser';
import {cameraDate} from './camera-time';
import{CameraCare,type CareEvent}from './camera-care';
import{rememberCameraQuality,rememberedCameraQuality,cameraQualityOptions,cameraQualityButtonLabel,type CameraQualitySizes}from './camera-quality';
import {CameraQualityReadings} from './camera-quality-readings';
import {cameraIcon,cameraTool as tool,cameraReplaySeek,cameraReplayTimeline,layoutCameraLenses,paintReplayPause,paintReplayRate,renderCameraQualityDialog} from './ui/camera-control-view';
import{isCloudDoorbell}from './doorbell';
import type{Device,DeviceContext,DevicePanel,Property}from './types';
import {CAMERA_READ_BATCH} from './camera-types';
import type{CameraFeatures,CameraOperation,CameraClip,CameraPower,CameraAuxSnapshot,CameraEvent,SavedCameraMedia}from './camera-types';
export type CameraSource=Pick<typeof api,'cameraFeatures'|'startCamera'|'stopCamera'|'readCamera'|'cameraCommand'|'cameraMicrophone'|'cameraScreenshot'|
 'cameraPower'|'changeCameraPower'|'cameraAuxiliary'|'changeCameraAuxiliary'|
 'cameraCare'|'cameraCareVideo'|'cameraCareThumbnail'|'saveCloudVideo'>&Partial<Pick<typeof api,'focusCameraView'>>&{monitor?:boolean};
import './camera-player.css';
import {CloudVideoControls} from './ui/cloud-video-controls';
import {CameraLiveToolbar} from './ui/camera-live-toolbar';
import {cameraFillLightIcon} from './ui/camera-fill-light';
import {cameraStatusIcon} from './ui/camera-status-icons';
import {cameraOutlineIcon} from './ui/camera-outline-icons';
import {cameraSoundIcon} from './ui/camera-sound-icons';
import {showCameraMediaSaved,clearCameraMediaToast} from './ui/camera-media-toast';
import {cameraTalkingStatus} from './ui/camera-talking-status';
export {cameraPageEligible} from './camera-eligibility';
export interface CameraPageData{panel?:DevicePanel;loading?:boolean;cached?:boolean;busy?:boolean;error?:string;power?:(property:Property,value:boolean)=>Promise<void>}
export interface CameraFrameNotice{lensId:number;count:number}
type CameraView='live'|'playback'|'care';
/** One owner keeps video, overlays and audio alive across state polling. */
export class CameraPlayer{
 private frames=new CameraFrameWatchdog(()=>{if(this.browserView==='live'&&!this.clip&&!this.cloudEvent&&!this.player?.waitingForDecoder)this.failPrimary('此镜头暂未返回画面');});
 private model='';private lastPower?:boolean;private externalError?:string;
 readonly stage=element('div','device-stage');
 readonly video=document.createElement('video');private state=element('p','camera-state');private name=element('h2');
 private receiveRate=element('span','camera-receive-rate','0 KB/S');private nameBlock=element('div','camera-device-name',this.name,this.receiveRate);
 private viewport=element('div','camera-video-viewport');private overlay=element('div','camera-video-overlay');private dots=element('span','camera-connect-dots',element('i'),element('i'),element('i'));
 private lensDeck=element('div','camera-lens-deck');private secondary?:CameraLensPlayer;private selectedLens=0;private lensChoiceVersion=0;private lensPreferenceKey='';private monitorPresentation=false;
 private swap=button('','camera-lens-swap',()=>this.swapLens());
 private secondaryTools?:CameraLiveToolbar;
 private primaryLiveQuality?:string;
 private qualityReadings=new CameraQualityReadings();
 private liveActions=element('div','camera-live-actions camera-toolbar-motion');private outsideTools=element('div','camera-tool-actions');private controlsDual?:boolean;
 private recordingLens?:number;
 private recordingPending=0;private mediaGate=new CameraMediaGate();private primaryMediaKey?:string;private replayBuffer=new CameraReplayBuffer();private replayTimer?:ReturnType<typeof setInterval>;
 private frameClock=new CameraFrameClock();private lastRecordingPoint:CameraRecordingPoint={};
 private recordingBadge=element('div','camera-recording-status');private recordingSince=0;private recordingTimer?:ReturnType<typeof setInterval>;private savedRecordingId='';
 private talkingBadge=cameraTalkingStatus();
 private auxiliary?:CameraAuxSnapshot;private auxiliaryBusy=false;private auxiliarySettling=false;
 private auxiliaryVersion=0;private qualityReturn?:HTMLButtonElement;
 private qualityHost?:HTMLElement;
 private alarmButton=tool('警报','warning',()=>{void this.changeAuxiliary('alarm');});private lightButton=tool('补光灯','light',()=>{void this.changeAuxiliary('light');});
 private playingElsewhere=false;
 private retry=button('重新连接','camera-retry',()=>{void this.retryConnection();});
 private powerButton=tool('休眠摄像机','power',()=>{void this.changePower();});private soundButton=tool('打开声音','volume-off',()=>{void this.toggleSound();});
 private wake=button('唤醒摄像机','camera-retry camera-wake',()=>{void this.changePower(true);});
 private powerSnapshot?:CameraPower;private powerTimer?:ReturnType<typeof setTimeout>;private powerEpoch=0;private powerActive=false;private powerReading=false;private powerReadVersion=0;private auxiliaryReadVersion=0;
 private qualityButton=button('高清','camera-icon-button camera-quality-button',()=>this.openQuality(this.qualityButton));
 private talkButton=tool('开始通话','microphone',()=>{void this.toggleTalk();});private shotButton=tool('截图','camera',()=>{void this.snapshot(this.dualLive()?0:undefined);});private recordButton=tool('开始录像','video',()=>{void this.toggleRecord(this.dualLive()?0:undefined);});private ptzButton=tool('云台控制','ptz',()=>{this.ptzPanel.hidden=!this.ptzPanel.hidden;this.ptzButton.setAttribute('aria-pressed',String(!this.ptzPanel.hidden));});
 private talkGlyph=element('span','camera-talk-glyph');private speaking=false;
 private secondaryShot=tool('截图','camera',()=>{if(this.secondary)void this.snapshot(this.secondary.lensId);});private secondaryRecord=tool('开始录像','video',()=>{if(this.secondary)void this.toggleRecord(this.secondary.lensId);});
 private fullscreenButton=tool('全屏','fullscreen',()=>this.toggleLensFullscreen(this.viewport));
 private replayShot=tool('回看截图','camera',()=>{void this.snapshot();});private replaySound=tool('打开声音','volume-off',()=>{void this.toggleSound();});
 private replayRecord=tool('开始回看录像','video',()=>{void this.toggleRecord();});
 private replayFullscreen=tool('回看全屏','fullscreen',()=>this.toggleLensFullscreen(this.viewport));
 private playbackRate=1;private rateButton=button('','camera-playback-rate',()=>{void this.cycleRate();});
 private playbackButton=button('回看','camera-playback-entry',()=>{void this.openPlayback();},'play');
 private careButton=button('看家助手','camera-care-entry camera-playback-entry',()=>{void this.openCare();},'shield');
 private qualityPanel=element('div','camera-quality-modal');private ptzPanel=element('div','camera-ptz-panel');private browser=new CameraBrowser((clip,offset)=>{void this.selectClip(clip,offset);},album=>this.albumChanged(album),()=>this.clearPlayback(),clips=>this.loadAlbumThumbnails(clips));private playbackPanel=this.browser.root;private care=new CameraCare(date=>{void this.openCare(date);},event=>{void this.playCare(event);},(c,date,id)=>this.source.cameraCareThumbnail(c,date,id));private carePanel=this.care.root;private careEpoch=0;private careDate='';private cloudEvent?:CareEvent;
 private albumAbort?:AbortController;private albumTask?:Promise<void>;private albumRestore?:{clip:CameraClip;offset:number;speed:number;paused:boolean};private pendingClip?:{clip:CameraClip;offset:number;speed:number;paused:boolean};private clipTask?:Promise<void>;private albumRate?:number;private clipSelection=0;private previewFrame?:{key:string;resolve:()=>void};
 private cloudSequence=new CloudVideoSequence(this.video,message=>this.cloudFailure(message),waiting=>this.setState(waiting?'decoder-wait':'waiting-frame',waiting?DECODER_WAITING:'等待画面…'));private cloudControls=new CloudVideoControls(this.video,this.viewport,message=>{this.setMessage(message);},async()=>{if(this.context&&this.cloudEvent)return this.source.saveCloudVideo(this.context,this.careDate,this.cloudEvent.id);},this.cloudSequence,message=>this.cloudFailure(message));
 private headerTitle=element('div','device-page-title');private browserView:CameraView='live';
 private diagnostic='';
 private clip?:CameraClip;private playbackTask?:Promise<void>;private replayEmpty=false;
 private replayResult?:'ended'|'failed';
 private replayRecoveryOffset?:number;
 private seek=cameraReplaySeek(seconds=>{if(this.clip)void this.selectClip(this.clip,seconds);});private playbackPause=button('','camera-replay-pause',()=>{void this.togglePlayback();});private thumbnailKey='';
 private player?:NativeVideoPlayer;private context?:DeviceContext;private data:CameraPageData={};private features?:CameraFeatures;private featureLoad?:Promise<CameraFeatures|undefined>;private session?:string;private epoch=0;private timer?:ReturnType<typeof setTimeout>;
 private powerOps=new PropertyOperations((_key,value)=>this.powerRequest(value===true,false),(_key,value)=>this.powerRequest(value===true,true),()=>{if(this.powerValue()===false&&this.busy){this.stop();this.setState('stopped','摄像机休眠中');}this.updateButtons();});
 private auxiliaryOps=new PropertyOperations((key,value)=>this.auxiliaryRequest(key as 'alarm'|'light',value===true,false),(key,value)=>this.auxiliaryRequest(key as 'alarm'|'light',value===true,true),()=>this.updateAuxiliary());
 private get powerChanging(){return this.powerOps.pendingCount>0;}
 private qualityOps=new PropertyOperations((_key,value)=>this.submitQuality(String(value)),async()=>({outcome:'pending',message:'画质切换待确认'}),()=>{this.renderQuality();this.updateButtons();});
 private frameRequest?:number;private busy=false;private online=false;private stopping?:Promise<void>;private starting?:Promise<string>;private autoAttempted=false;private operation=false;private listening=false;private soundPending=false;private soundEpoch=0;private soundTask?:Promise<void>;private talking=false;private recording=false;private audio=new CameraAudio();private quality='auto';private mounted=false;
 constructor(private back:()=>void,private source:CameraSource,private failed:()=>void=()=>{}){
  this.viewport.tabIndex=0;this.viewport.setAttribute('aria-label','摄像机视频及播放工具');
  this.receiveRate.setAttribute('aria-description','当前视频会话的实际接收速率，双镜头合计，含音频和传输封装；不是带宽测速。');
  this.monitorPresentation=!!source.monitor;this.lensDeck.append(this.viewport);this.swap.hidden=true;this.swap.setAttribute('aria-label','切换主副镜头');for(const event of ['dblclick','pointerdown','click']as const)this.swap.addEventListener(event,e=>e.stopPropagation());
  this.alarmButton.replaceChildren(officialIcon('camera:alarm'));this.lightButton.replaceChildren(cameraFillLightIcon());this.alarmButton.hidden=this.lightButton.hidden=true;
  setMediaContext(this.video,()=>this.context);
  mediaView(this.video).muted=true;this.video.autoplay=true;this.video.playsInline=true;this.video.setAttribute('aria-label','摄像机实时画面');
  this.retry.hidden=this.wake.hidden=true;this.overlay.append(this.dots,this.state,this.retry,this.wake);this.state.setAttribute('role','status');
  this.liveActions.append(this.powerButton,this.soundButton,this.qualityButton,this.fullscreenButton);this.viewport.append(this.video,this.overlay,this.liveActions);
  const page=element('section','device-page page-camera');page.dataset.presentationTemplate='camera';
  const backButton=tool('返回家庭','back',()=>{if(this.browser.closeAlbum())return;if(this.browserView!=='live'){void this.returnLive();}else this.back();});backButton.className='page-icon-button';
  this.talkGlyph.append(...this.talkButton.childNodes);this.talkButton.replaceChildren(this.talkGlyph);
  const tools=this.outsideTools;tools.append(this.talkButton,this.shotButton,this.recordButton,this.alarmButton,this.lightButton,this.ptzButton);
  this.playbackButton.querySelector('svg')?.replaceWith(cameraIcon('play'));this.careButton.querySelector('svg')?.replaceWith(officialIcon('camera:ai'));this.playbackButton.append(icon('chevron','camera-entry-arrow'));
  this.qualityPanel.hidden=this.ptzPanel.hidden=true;
  this.qualityButton.setAttribute('aria-haspopup','dialog');this.qualityButton.setAttribute('aria-expanded','false');
  dismissOnBackdrop(this.qualityPanel,()=>this.closeQuality());this.qualityPanel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.closeQuality();}});
  const pad=element('div','camera-ptz-pad',officialIcon('camera:ptz-pad'));for(const[d,label]of[['up','向上'],['left','向左'],['right','向右'],['down','向下']]as const){const b=button('','camera-ptz-direction',()=>{b.setAttribute('aria-busy','true');b.classList.add('is-sending');this.setMessage('正在转动云台…');void this.command({kind:'ptz',direction:d}).finally(()=>{b.setAttribute('aria-busy','false');b.classList.remove('is-sending');});});b.dataset.direction=d;b.setAttribute('aria-label',label);pad.append(b);}
  this.ptzPanel.append(pad);
  this.seek.hidden=true;
  const replayRecord=this.replayRecord;
  this.replayShot.replaceChildren(cameraOutlineIcon('snapshot'));replayRecord.replaceChildren(cameraOutlineIcon('record'));
  const rate=this.rateButton;this.renderRate();
  this.renderPlaybackToggle();this.viewport.append(this.playbackPause,cameraReplayTimeline(this.seek,this.replayShot,replayRecord,rate,this.replaySound,this.replayFullscreen));
  this.viewport.append(this.cloudControls.root,this.cloudControls.top);
  this.qualityHost=page;page.append(element('header','device-page-header',backButton,this.headerTitle),element('div','device-page-scroll device-controls-region',element('div','camera-live-card',this.lensDeck,tools),this.ptzPanel,element('div','camera-page-footer',this.playbackButton,this.careButton),this.playbackPanel,this.carePanel),this.qualityPanel);this.stage.append(page);
  this.video.addEventListener('loadedmetadata',()=>this.updateVideoAspect());
  for(const event of ['play','pause'])this.video.addEventListener(event,()=>{if(!this.operation)this.syncCloudSelection();});

  this.video.addEventListener('ended',()=>{
   if(this.cloudEvent&&this.cloudSequence.ended){this.clipPaused=true;this.renderPlaybackToggle();this.care.select(this.cloudEvent.id,false);}
   if(this.clip&&!this.switchingMedia&&!this.operation&&mediaView(this.video).ended)this.finishReplay();
  });
  this.video.addEventListener('timeupdate',()=>{if(this.clip&&!this.pendingClip&&this.stage.dataset.cameraAlbum!=='true'&&!this.seek.matches(':active')){const offset=this.replayPosition();this.seek.value=String(offset);this.browser.position(this.clip,offset);}});
  this.showView('live');this.updateButtons();
 }
 get primaryLensId():number{return this.selectedLens;}
 get qualityProfiles():CameraFeatures['qualities']{return this.features?.qualities??[];}
 qualitySizes(lensId=this.selectedLens):CameraQualitySizes{return this.qualityReadings.sizes(lensId);}
 qualityButtonLabel(id=this.quality):string{return cameraQualityButtonLabel(this.qualityProfiles,id,this.qualitySizes());}
 beginQualityChange(quality:string):void{this.qualityReadings.begin(quality);this.updateQualityLabels();}
 cancelQualityChange():void{this.qualityReadings.cancel();this.updateQualityLabels();}
 private get displayedQuality():string{const value=this.qualityOps.display('quality',this.quality).value;return typeof value==='string'?value:this.quality;}
 private updateQualityLabels():void{
  const label=this.qualityButtonLabel(this.displayedQuality),span=this.qualityButton.querySelector('span');
  if(span){if(span.textContent!==label)span.textContent=label;}else this.qualityButton.replaceChildren(element('span','',label));
  const title=`切换画质：${label}`;if((this.qualityButton.getAttribute('aria-description')??'')!==title)this.qualityButton.setAttribute('aria-description',title);if(this.qualityButton.getAttribute('aria-label')!==title)this.qualityButton.setAttribute('aria-label',title);
  if(!this.qualityPanel.hidden){
   const lens=this.qualityReturn&&this.secondaryTools?.root.contains(this.qualityReturn)?this.secondary?.lensId??0:0;
   const options=cameraQualityOptions(this.qualityProfiles,this.qualitySizes(lens)),choices=[...this.qualityPanel.querySelectorAll<HTMLButtonElement>('[data-quality]')];
   if(options.length!==choices.length||options.some((q,i)=>q.id!==choices[i]?.dataset.quality)){
    this.renderQuality();
   }else for(const [i,choice]of choices.entries()){const q=options[i],reading=choice.querySelector('span'),checked=q.id===this.displayedQuality||q.aliases.includes(this.displayedQuality);if(reading&&reading.textContent!==q.label)reading.textContent=q.label;choice.setAttribute('aria-checked',String(checked));choice.setAttribute('aria-pressed',String(checked));}
  }
  this.secondaryTools?.sync();
 }
 get recordingPoint():CameraRecordingPoint{return this.pointForLens(this.recordingLens??this.selectedLens);}
 private videoForLens(id:number):HTMLVideoElement|undefined{return id===0?this.video:this.secondary?.lensId===id?this.secondary.video:undefined;}
 private pointForLens(id:number):CameraRecordingPoint{if(!this.clip&&this.secondary?.lensId===id)return this.secondary.recordingPoint;return mediaView(this.video).readyState>=2?{...this.lastRecordingPoint,...this.frameClock.at(mediaView(this.video).currentTime)}:this.lastRecordingPoint;}
 private dualLive():boolean{return !!this.secondary&&this.browserView==='live'&&!this.clip&&!this.cloudEvent;}
 private arrangeControls(dual:boolean):void{
  if(this.controlsDual===dual)return;this.controlsDual=dual;this.stage.dataset.dualControls=String(dual);
  const focused=document.activeElement instanceof HTMLElement&&(this.liveActions.contains(document.activeElement)||this.outsideTools.contains(document.activeElement))?document.activeElement:undefined;
  this.liveActions.replaceChildren(...(dual?[this.powerButton,this.shotButton,this.recordButton,this.qualityButton,this.fullscreenButton]:[this.powerButton,this.soundButton,this.qualityButton,this.fullscreenButton]));
  this.outsideTools.replaceChildren(...(dual?[this.talkButton,this.soundButton,this.alarmButton,this.lightButton,this.ptzButton]:[this.talkButton,this.shotButton,this.recordButton,this.alarmButton,this.lightButton,this.ptzButton]));
  this.liveActions.style.setProperty('--camera-live-tools',dual?'5':'4');if(focused?.isConnected)focused.focus({preventScroll:true});
  this.renderSoundIcons();
  for(const b of [this.shotButton,this.recordButton,this.secondaryShot,this.secondaryRecord])delete b.dataset.mediaIcon;
 }
 get primaryVideo():HTMLVideoElement{return this.secondary&&this.dualLive()&&this.selectedLens===this.secondary.lensId?this.secondary.video:this.video;}
 get hasDecodedVideo():boolean{return hasMediaFrame(this.video)||hasMediaFrame(this.secondary?.video);}
 private toggleLensFullscreen(viewport:HTMLElement):void{void(document.fullscreenElement===viewport?document.exitFullscreen():viewport.requestFullscreen()).catch(e=>this.showError(e));}
 private leaveLensFullscreen():void{const current=document.fullscreenElement;if(current&&(current===this.viewport||current===this.secondary?.viewport))void document.exitFullscreen().catch(()=>{});}
 screenshotPixels():string{return captureCameraLayout(this.lensDeck,this.secondary?[this.video,this.secondary.video]:[this.video]);}
 setMonitorPresentation(enabled:boolean):void{this.monitorPresentation=enabled;this.renderLenses();}
 holdRecordingChange():()=>void{const epoch=this.epoch;this.recordingPending++;this.updateButtons();let released=false;return()=>{if(released)return;released=true;if(epoch===this.epoch){this.recordingPending=Math.max(0,this.recordingPending-1);this.updateButtons();}};}
 private renderLenses():void{
  const dual=this.dualLive();this.arrangeControls(dual);
  const inset=this.selectedLens===0?this.secondary?.video:this.video;
  const size=inset&&mediaView(inset);
  layoutCameraLenses(this.lensDeck,this.viewport,this.secondary?.viewport,{dual,pip:this.monitorPresentation,selected:this.selectedLens,secondaryId:this.secondary?.lensId,
   insetRatio:size&&size.videoWidth>0&&size.videoHeight>0?`${size.videoWidth}/${size.videoHeight}`:undefined});
  this.swap.hidden=!dual||!this.monitorPresentation;this.swap.disabled=this.recording||this.operation||this.recordingPending>0;
  const owner=this.recordingLens??this.selectedLens,target=!this.clip&&!this.cloudEvent&&this.secondary&&owner===this.secondary.lensId?this.secondary.viewport:this.viewport;
  if(this.recordingBadge.parentElement!==target)target.append(this.recordingBadge);
  this.recordingBadge.hidden=!this.recording;
  const full=document.fullscreenElement;
  const optionalInset=dual&&this.monitorPresentation;
  const recordingLens=this.recording||this.recordingPending||this.operation&&this.recordingLens!==undefined?owner:undefined;
  const canWait=(lensId:number,viewport:HTMLElement)=>optionalInset&&this.selectedLens!==lensId&&recordingLens!==lensId&&full!==viewport;
  setMediaInset(this.video,canWait(0,this.viewport));
  if(this.secondary)setMediaInset(this.secondary.video,canWait(this.secondary.lensId,this.secondary.viewport));
  const talkTarget=full===this.viewport||full===this.secondary?.viewport?full:this.secondary&&this.selectedLens===this.secondary.lensId?this.secondary.viewport:this.viewport;
  if(talkTarget&&this.talkingBadge.parentElement!==talkTarget)talkTarget.append(this.talkingBadge);
  this.talkingBadge.hidden=!this.talking||this.talkPending;
 }
 private configureLenses():void{
  const lens=this.features?.lenses?.find(l=>l.id!==0);
  if(this.secondary?.lensId!==lens?.id){this.secondary?.dispose();this.secondary?.viewport.remove();this.secondary=undefined;
   this.secondaryTools=undefined;
   if(lens){this.secondary=new CameraLensPlayer(lens.id,stats=>{if(!this.clip&&!this.cloudEvent&&this.stage.dataset.videoMode==='live')this.qualityReadings.observe(lens.id,stats,String(this.secondary?.streamRevision??-1),this.secondary?.liveQuality);this.updateQualityLabels();this.stage.dispatchEvent(new CustomEvent<CameraFrameNotice>('camera-frame',{detail:{lensId:lens.id,count:stats.count}}));},message=>{this.updateQualityLabels();this.setMessage(message);});this.secondary.setPresentationHidden(this.monitorHidden);setMediaContext(this.secondary.video,()=>this.context);this.secondary.video.setAttribute('aria-label',lens.label+'实时画面');this.secondary.viewport.tabIndex=0;this.secondary.viewport.setAttribute('aria-label',lens.label+'视频及播放工具');this.secondaryTools=new CameraLiveToolbar([
    {source:this.powerButton,press:()=>{void this.changePower();}},
    {node:this.secondaryShot},
    {node:this.secondaryRecord},
    {source:this.qualityButton,press:()=>this.openQuality(this.secondaryTools?.root.querySelector<HTMLButtonElement>('.camera-quality-button')??this.qualityButton)},
    {source:this.fullscreenButton,press:()=>{if(this.secondary)this.toggleLensFullscreen(this.secondary.viewport);}},
   ]);for(const event of ['loadeddata','emptied'])this.secondary.video.addEventListener(event,()=>this.updateMediaButtons(!!this.session&&this.busy&&!this.stopping));this.secondaryTools.root.style.setProperty('--camera-live-tools','5');this.secondary.viewport.append(this.secondaryTools.root);this.lensDeck.append(this.secondary.viewport);}
  }
  this.lensDeck.append(this.swap);this.renderLenses();
  const context=this.context,key=context?JSON.stringify([context.homeId,context.generation,context.did,this.features?.lenses?.map(l=>l.id)]):'';
  if(context&&this.secondary&&key!==this.lensPreferenceKey){this.lensPreferenceKey=key;const version=this.lensChoiceVersion;
   void primaryCameraLens(context,this.features?.lenses?.map(l=>l.id)??[0]).then(id=>{if(sameContext(context,this.context)&&version===this.lensChoiceVersion&&!this.recording&&!this.recordingPending){this.selectedLens=id;this.renderLenses();}}).catch(e=>this.showError(e));
  }
 }
 private swapLens():void{if(!this.monitorPresentation||!this.secondary||this.recording||this.operation||this.recordingPending||this.browserView!=='live')return;this.selectedLens=this.selectedLens===0?this.secondary.lensId:0;++this.lensChoiceVersion;this.renderLenses();if(this.context)void rememberCameraLens({...this.context},this.selectedLens).catch(e=>this.showError(e));}
 private failPrimary(message:string):void{
  if(this.clip){
   if(this.replayResult)return;
   const offset=this.replayPosition();
   this.cancelPlaybackSelection();this.finishReplay(message);
   this.releaseDecoder();this.clipOffset=offset;this.updateButtons();
   return;
  }
  if(!this.secondary||this.cloudEvent){this.fail(message);return;}
  this.frames.reset();this.updateQualityLabels();this.setState('error',message);this.retry.hidden=true;
  this.stage.dispatchEvent(new CustomEvent('camera-lens-unavailable',{detail:{lensId:0}}));
 }
 unavailable(state:string):void{const message=state==='closed'?'摄像机休眠中':state==='offline'?'摄像机离线':'无法连接';this.secondary?.unavailable(message);this.updateQualityLabels();this.setState(state==='error'?'error':'stopped',message);this.retry.disabled=state!=='error';}
 activatePower(active:boolean):void{if(this.powerActive===active)return;this.powerActive=active;this.powerOps.setActive(active);this.auxiliaryOps.setActive(active);++this.powerEpoch;this.powerReading=false;if(this.powerTimer)clearTimeout(this.powerTimer);this.powerTimer=undefined;if(active)void this.refreshPower();}
 private async refreshPower():Promise<void>{
  const context=this.context;if(!context||!this.powerActive||this.backgrounded||!this.stage.isConnected||isCloudDoorbell(this.model)||this.powerReading)return;
  const epoch=++this.powerEpoch,powerVersion=this.powerOps.version;this.powerReading=true;
  try{const state=await this.source.cameraPower(context);if(epoch===this.powerEpoch&&sameContext(context,this.context)&&this.powerActive){if(!this.powerChanging){this.powerReadVersion=powerVersion;this.acceptPower(state);}}if(this.powerActive&&epoch===this.powerEpoch&&!this.auxiliaryBusy){const version=this.auxiliaryVersion,readVersion=this.auxiliaryOps.version,auxiliary=await this.source.cameraAuxiliary(context);if(epoch===this.powerEpoch&&version===this.auxiliaryVersion&&!this.auxiliaryBusy&&sameContext(context,this.context)){this.auxiliary=auxiliary;this.auxiliaryReadVersion=readVersion;this.auxiliarySettling=false;this.updateAuxiliary();}}}
  catch(error){if(epoch===this.powerEpoch&&!this.powerSnapshot)this.setMessage(normalizeError(error).message);}
  finally{if(epoch===this.powerEpoch){this.powerReading=false;if(this.powerActive&&!this.backgrounded&&this.stage.isConnected)this.powerTimer=setTimeout(()=>{this.powerTimer=undefined;void this.refreshPower();},5000);}}
 }
 private acceptPower(state:CameraPower):void{
  const previous=this.powerSnapshot?.awake;this.powerSnapshot=state;
  if(this.powerValue()===false){if(this.busy)this.stop();this.setState('stopped','摄像机休眠中');}
  else if(this.powerValue()===true&&state.awake===true&&previous===false){this.autoAttempted=false;if(!this.source.monitor&&this.online&&!this.data.loading)void this.start();}
  this.updateButtons();
 }
 private updateAuxiliary():void{
  for(const kind of ['alarm','light']as const){
   const raw=this.auxiliary?.[kind],value=this.auxiliaryOps.display(kind,raw?.active??undefined,this.auxiliaryReadVersion).value,control=raw?{...raw,active:typeof value==='boolean'?value:raw.active}:undefined,b=kind==='alarm'?this.alarmButton:this.lightButton;
   b.hidden=!control?.supported;b.disabled=!control?.writable||control.active===null||!this.online||this.powerValue()===false;
   b.setAttribute('aria-pressed',String(control?.active===true));b.setAttribute('aria-busy',String(this.auxiliaryBusy||this.auxiliarySettling));
   b.setAttribute('aria-label',kind==='alarm'?(control?.active?'停止警报':'启动警报'):(control?.active?'关闭补光灯':'打开补光灯'));
  }
  this.outsideTools.style.setProperty('--camera-tools',String(isCloudDoorbell(this.model)?2:(this.dualLive()?3:4)+Number(!!this.auxiliary?.alarm.supported)+Number(!!this.auxiliary?.light.supported)));this.updateStatusIcons();
 }
 private updateStatusIcons():void{
  for(const [b,kind,active]of [[this.talkButton,'talk',this.talking],[this.lightButton,'light',this.lightButton.getAttribute('aria-pressed')==='true'],[this.alarmButton,'alarm',this.alarmButton.getAttribute('aria-pressed')==='true']]as const){
   const state=active?kind:'off';if(b.dataset.statusIcon===state)continue;b.dataset.statusIcon=state;
   const glyph=active?cameraStatusIcon(kind):kind==='light'?cameraFillLightIcon():officialIcon(kind==='talk'?'camera:microphone':'camera:alarm');
   if(kind==='talk')this.talkGlyph.replaceChildren(glyph);else b.replaceChildren(glyph);
  }
 }
 private updateTalkActivity():void{
  const speaking=this.talking&&this.audio.microphoneActive&&this.audio.microphoneSpeaking;
  if(speaking===this.speaking)return;this.speaking=speaking;this.talkButton.classList.toggle('is-speaking',speaking);this.emitAudioState();
 }
 private renderSoundIcons():void{
  for(const [b,outside]of [[this.soundButton,this.dualLive()],[this.replaySound,false]]as const){
   const kind=this.listening?'sound':'muted',key=`${outside?'outside':'inside'}-${kind}`;
   if(b.dataset.soundIcon!==key){b.dataset.soundIcon=key;b.replaceChildren(cameraSoundIcon(this.listening,outside));}
   b.setAttribute('aria-description',this.listening?'关闭声音':'打开声音');b.setAttribute('aria-label',(b.getAttribute('aria-description')??''));b.setAttribute('aria-pressed',String(this.listening));
  }
  this.emitAudioState();
 }
 private async auxiliaryRequest(kind:'alarm'|'light',on:boolean,read:boolean){
  const context=this.context,version=this.auxiliaryOps.version,expected=this.auxiliary?.[kind].active;
  if(!context||expected===null||expected===undefined)throw {kind:'staleContext',message:'摄像头状态尚未读取。'};
  const result=read?{report:await this.source.cameraAuxiliary(context),confirmed:false}:await this.source.changeCameraAuxiliary(context,kind,on,expected);
  if(context!==this.context)throw {kind:'staleContext',message:'摄像头已经切换。'};
  this.auxiliary=result.report;this.auxiliaryReadVersion=version;this.updateAuxiliary();
  return{outcome:result.report[kind].active===on?'confirmed' as const:'pending' as const,actual:result.report[kind].active??undefined,message:''};
 }
 private async changeAuxiliary(kind:'alarm'|'light'):Promise<void>{
  const control=this.auxiliary?.[kind],value=this.auxiliaryOps.display(kind,control?.active??undefined,this.auxiliaryReadVersion).value;
  if(!this.context||!control?.writable||typeof value!=='boolean'||!this.online||this.powerValue()===false)return;
  ++this.auxiliaryVersion;this.auxiliaryOps.write(kind,!value,control.active??value);
 }

 private placeQualityPanel():void{
  const full=document.fullscreenElement,host=full===this.viewport||full===this.secondary?.viewport?full:this.qualityHost;
  if(host&&this.qualityPanel.parentElement!==host)host.append(this.qualityPanel);
  this.qualityPanel.classList.toggle('camera-quality-fullscreen',host===full);
 }
 private closeQuality(focus=true):void{this.qualityPanel.hidden=true;this.qualityButton.setAttribute('aria-expanded','false');this.qualityReturn?.setAttribute('aria-expanded','false');if(focus)(this.qualityReturn??this.qualityButton).focus({preventScroll:true});}
 private fullscreenChanged=()=>{const open=!this.qualityPanel.hidden;this.closeQuality(false);this.placeQualityPanel();this.renderLenses();if(open&&(this.qualityReturn??this.qualityButton).isConnected)(this.qualityReturn??this.qualityButton).focus({preventScroll:true});};
 private openQuality(anchor:HTMLButtonElement):void{const open=this.qualityPanel.hidden;this.qualityReturn=anchor;this.placeQualityPanel();this.renderQuality();this.qualityPanel.hidden=!open;this.qualityButton.setAttribute('aria-expanded',String(open));anchor.setAttribute('aria-expanded',String(open));if(open)this.qualityPanel.querySelector<HTMLButtonElement>('[aria-checked=true]')?.focus();}
 get controls(){return {recording:this.recording,quality:this.quality,mode:this.cloudEvent?'cloud':this.clip||this.replayEmpty?'playback':'live'};}
 get waitingForDecoder():boolean{return !!(this.dualLive()&&this.selectedLens===this.secondary?.lensId?this.secondary?.waitingForDecoder:this.player?.waitingForDecoder);}
 get acceleratedReplay():boolean{return !!this.clip&&this.playbackRate>1&&!this.replayResult;}
 private get recordingOrTalking():boolean{return this.recording||this.recordingPending>0||this.talking||this.talkPending;}
 get protectedWork():boolean{return this.recordingOrTalking||this.operation||this.listening||this.soundPending||!!this.starting||!!this.stopping||this.busy&&!this.session&&!this.cloudEvent||!mediaView(this.video).muted&&!mediaView(this.video).paused||this.cloudControls.blocksSuspension||this.powerOps.pendingCount>0||this.auxiliaryOps.pendingCount>0||this.qualityOps.pendingCount>0;}
 get blocksSuspension():boolean{return this.protectedWork||!this.resourceResume&&(!!this.session||this.busy);}
 get audioControls(){return {listening:this.listening,soundPending:this.soundPending,talking:this.talking,talkPending:this.talkPending,talkEpoch:this.talkEpoch,speaking:this.speaking,soundDisabled:this.soundButton.disabled,talkDisabled:this.talkButton.disabled,talkLabel:this.talkButton.getAttribute('aria-label')??'开始通话'};}
 private emitAudioState():void{this.stage.dispatchEvent(new CustomEvent('camera-audio-state'));}
 async stopTalk():Promise<void>{if(this.talking||this.talkPending)await this.endTalk();}
 syncControls(quality:string,recording:boolean,lensId?:number):void{const ownerChanged=recording&&lensId!==undefined&&this.recordingLens!==lensId;if(this.quality===quality&&this.recording===recording&&!ownerChanged)return;if(this.quality!==quality){this.qualityReadings.confirm(quality);this.quality=quality;this.renderQuality();}if(ownerChanged)this.recordingLens=lensId;this.setRecording(recording);}
 private recordingClock():string{const seconds=Math.floor(Math.max(0,performance.now()-this.recordingSince)/1000);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
 private updateRecordingBadge():void{this.recordingBadge.textContent=`正在录制 ${this.recordingClock()}`;this.recordingBadge.hidden=!this.recording;this.stage.dispatchEvent(new CustomEvent('camera-recording-state',{detail:{recording:this.recording,text:this.recordingBadge.textContent}}));}
 private setRecording(active:boolean,file?:SavedCameraMedia):void{
  if(active)this.recordingLens??=this.clip?.channel??this.selectedLens;
  else{this.recordingLens=undefined;}
  if(this.recording!==active){this.recording=active;if(this.recordingTimer)clearInterval(this.recordingTimer);this.recordingTimer=undefined;if(active){this.recordingSince=performance.now();if(!this.backgrounded)this.recordingTimer=setInterval(()=>this.updateRecordingBadge(),1000);}const glyph=officialIcon(active?'camera:recording':'camera:replay-record');if(active)glyph.setAttribute('viewBox','4 4 24 24');this.replayRecord.replaceChildren(glyph);this.replayRecord.setAttribute('aria-description',active?'结束录制':'开始回看录像');}
  this.updateRecordingBadge();this.updateButtons();
  if(file&&file.id!==this.savedRecordingId){this.savedRecordingId=file.id;this.showRecordingNotice(`录像已保存：${file.fileName}`,file);showCameraMediaSaved(this.stage,file);this.stage.dispatchEvent(new CustomEvent('camera-recording-saved',{detail:file}));}
 }
 private showRecordingNotice(message:string,_file?:SavedCameraMedia):void{this.setMessage(message);}
 async leaveDetail():Promise<void>{
  ++this.talkEpoch;this.audio.stopMicrophone();if(this.talking||this.talkPending)await this.endTalk();
  await this.soundTask;
  if(this.listening)await this.toggleSound();
  const deadline=performance.now()+30000;while(this.operation&&!this.cloudEvent&&performance.now()<deadline)await new Promise(r=>setTimeout(r,25));
  if(this.clip||this.cloudEvent||this.browserView!=='live')await this.returnLive();
  this.ptzPanel.hidden=this.qualityPanel.hidden=true;
 }
 dismissPopup():boolean{if(dismissCameraDatePicker(this.stage)||this.care.dismissFilter())return true;if(!this.qualityPanel.hidden){this.closeQuality();return true;}if(!this.ptzPanel.hidden){this.ptzPanel.hidden=true;this.ptzButton.setAttribute('aria-pressed','false');this.ptzButton.focus({preventScroll:true});return true;}return false;}
 retryStream():void{this.autoAttempted=false;this.stop();}
 private switchingMedia=false;private modeTimer?:ReturnType<typeof setTimeout>;private mediaEpoch=0;private clipOffset=0;private clipPaused=false;private replayIntent=0;private talkEpoch=0;private talkPending=false;private talkRequested=false;
 private talkRevision?:number;
 private lastTalkStop=0;
 private blur=()=>{if(this.talking||this.talkPending&&this.audio.microphoneActive){this.setMessage('窗口失去焦点，通话已结束。');void this.endTalk();}};
 update(context:DeviceContext,device:Device,data:CameraPageData={}):HTMLElement{
  // Overlap the feature download with independent panel/feature reads. No stream is opened here.
  if(!sameContext(this.context,context))void loadVideoEngine().catch(()=>{});
  const changed=!sameContext(this.context,context);if(changed){this.selectedLens=0;this.lensPreferenceKey='';++this.lensChoiceVersion;this.auxiliary=undefined;this.auxiliarySettling=false;this.auxiliaryBusy=false;++this.auxiliaryVersion;this.secondaryTools=undefined;this.qualityReturn=undefined;this.secondary?.dispose();this.secondary?.viewport.remove();this.secondary=undefined;this.activatePower(false);this.powerSnapshot=undefined;this.powerOps.reset();this.auxiliaryOps.reset();this.stop();this.care.clear();this.context={...context};this.model=device.model;this.thumbnailKey='';this.lastPower=undefined;this.externalError=undefined;this.features=undefined;this.featureLoad=undefined;this.autoAttempted=false;this.quality=this.source.monitor?'sd':rememberedCameraQuality(context,device.model);this.qualityReadings.bind(context,device.model);this.qualityReadings.reset(this.quality);this.primaryMediaKey=undefined;this.switchingMedia=false;this.clip=undefined;this.ptzPanel.hidden=this.qualityPanel.hidden=true;this.showView('live');this.setMessage('');
   void this.loadFeatures(context);
  }
  if(!this.mounted){window.addEventListener('blur',this.blur);document.addEventListener('fullscreenchange',this.fullscreenChanged);this.mounted=true;}
  this.data=data;this.online=device.online;this.name.textContent=device.name;
  const doorbell=isCloudDoorbell(this.model);if(changed)this.viewport.style.aspectRatio=doorbell?'4/3':'';this.stage.classList.toggle('doorbell-live',doorbell);this.stage.querySelector<HTMLElement>('.device-page')!.dataset.presentationTemplate=doorbell?'doorbell-live':'camera';
  for(const b of [this.powerButton,this.ptzButton,this.playbackButton,this.careButton,this.talkButton,this.qualityButton])b.hidden=doorbell;
  this.stage.querySelector<HTMLElement>('.camera-page-footer')!.hidden=doorbell;
  this.stage.querySelector<HTMLButtonElement>('.page-icon-button')!.setAttribute('aria-label',doorbell?'返回门铃':'返回家庭');if(doorbell)this.name.textContent='实时画面';
  if(data.error!==this.externalError){if(data.error)this.setMessage(data.error);else if(this.diagnostic===this.externalError)this.setMessage('');this.externalError=data.error;}
  const power=this.powerValue();if(this.lastPower===false&&power===true)this.autoAttempted=false;this.lastPower=power;if(!this.cloudEvent&&(!this.online||power===false)){if(this.busy)this.stop();this.setState('stopped',!this.online?'摄像机离线':'摄像机休眠中');}
  if(!this.source.monitor&&!isCloudDoorbell(this.model))queueMicrotask(()=>{if(this.stage.isConnected&&sameContext(this.context,context))this.activatePower(true);});
  this.updateButtons();
  const guard=import.meta.env.DEV?(window as Window&{__MIJIA_UI_TEST_GUARD?:{allowCameraAutoplay?:boolean}}).__MIJIA_UI_TEST_GUARD:undefined;
  if(!this.backgrounded&&!this.autoAttempted&&!data.loading&&this.online&&power!==false&&(!guard||guard.allowCameraAutoplay||this.source.monitor)){this.autoAttempted=true;queueMicrotask(()=>{if(this.stage.isConnected&&sameContext(this.context,context))void this.start();});}
  return this.stage;
 }
 private powerProperty():Property|undefined{return isCloudDoorbell(this.model)?undefined:capabilityProperty(this.data.panel,'camera-control.on');}
 private powerValue():boolean|undefined{const value=this.powerOps.display('power',this.powerSnapshot?this.powerSnapshot.awake??undefined:booleanValue(this.powerProperty()),this.powerReadVersion).value;return typeof value==='boolean'?value:undefined;}
 private updateMediaButtons(active:boolean):void{
  const dual=this.dualLive();
  for(const [record,shot,lensId]of [[this.recordButton,this.shotButton,0],[this.secondaryRecord,this.secondaryShot,this.secondary?.lensId]]as const){
   const recording=this.recording&&(!dual||lensId===this.recordingLens);
   const style=recording?'recording':dual?'outline':'solid';if(record.dataset.mediaIcon!==style){const glyph=recording?officialIcon('camera:recording'):dual?cameraOutlineIcon('record'):officialIcon('camera:record');if(recording)glyph.setAttribute('viewBox','4 4 24 24');record.replaceChildren(glyph);record.dataset.mediaIcon=style;}record.dataset.recording=String(recording);
   const shotStyle=dual?'outline':'solid';if(shot.dataset.mediaIcon!==shotStyle){shot.replaceChildren(dual?cameraOutlineIcon('snapshot'):officialIcon('camera:snapshot'));shot.dataset.mediaIcon=shotStyle;}
   record.setAttribute('aria-description',recording?'结束录像':'开始录像');record.setAttribute('aria-label',(record.getAttribute('aria-description')??''));record.setAttribute('aria-pressed',String(recording));
   if(dual&&lensId!==undefined){const ready=hasMediaFrame(this.videoForLens(lensId)),other=this.recording&&!recording;
    shot.disabled=!active||!ready||this.operation;
    record.disabled=!active||this.operation||this.recordingPending>0||other||!this.recording&&!ready;
   }
  }
 }
 private updateButtons():void{
  const active=!!this.session&&this.busy&&!this.stopping,power=this.powerValue();
  const powerAllowed=!!this.data.power||!!this.powerSnapshot?.writable,powerDisabled=!this.online||!powerAllowed||power===undefined;
  this.powerButton.disabled=powerDisabled;this.powerButton.setAttribute('aria-label',power===false?'唤醒摄像机':'休眠摄像机');this.powerButton.setAttribute('aria-description',this.powerButton.getAttribute('aria-label')!);this.powerButton.setAttribute('aria-pressed',String(power===true));this.powerButton.setAttribute('aria-busy',String(this.powerChanging));
  this.wake.hidden=power!==false;this.wake.disabled=powerDisabled;
  this.soundButton.disabled=this.soundPending||(this.cloudEvent?mediaView(this.video).playbackRate:this.clip?this.playbackRate:1)!==1||!this.cloudEvent&&(!active||!this.features?.listen);this.soundButton.setAttribute('aria-busy',String(this.soundPending));this.qualityButton.disabled=!active||!this.features?.qualities.length||this.recording||!!this.clip;
  this.talkButton.disabled=!active||!this.features?.talk||!!this.clip||this.operation&&!this.talkPending&&!this.talking;this.shotButton.disabled=!active||!this.hasDecodedVideo||this.operation;this.recordButton.disabled=!active||this.operation||this.recordingPending>0||(!this.recording&&(!hasMediaFrame(this.primaryVideo)||!!this.clip));this.ptzButton.disabled=!active||!this.features?.ptz||!!this.clip;this.playbackButton.disabled=!active||!this.features?.playback||this.recordingOrTalking||this.operation;
  this.careButton.disabled=!this.context||this.recordingOrTalking||this.features?.care!==true;
  for(const direction of this.ptzPanel.querySelectorAll<HTMLButtonElement>('.camera-ptz-direction'))direction.disabled=this.ptzButton.disabled;
  this.replayShot.disabled=!this.clip||!active||mediaView(this.video).readyState<2||this.operation;
  this.replaySound.disabled=!this.clip||this.soundButton.disabled;this.replayFullscreen.disabled=!this.clip;
  this.seek.disabled=!this.clip||this.operation||this.recording||this.recordingPending>0;
  this.replayRecord.disabled=!active||!this.clip||this.operation||this.recordingPending>0||(!this.recording&&(mediaView(this.video).readyState<2||this.clipPaused));this.replayRecord.setAttribute('aria-label',this.recording?'结束回看录像':'开始回看录像');this.replayRecord.setAttribute('aria-pressed',String(this.recording));
  this.playbackPanel.inert=this.recording||this.recordingPending>0||this.recordingLens!==undefined;
  this.rateButton.disabled=!active||!this.clip||this.operation||this.recording||this.soundPending;
  this.playbackPause.disabled=(!active||!this.clip)&&!this.cloudEvent||mediaView(this.video).readyState<2||this.operation||this.recording;this.stage.dataset.playbackPaused=String(this.clipPaused);
  this.talkButton.setAttribute('aria-pressed',String(this.talking));this.talkButton.setAttribute('aria-label',this.talkPending?'正在建立通话，点击取消':this.talking?'结束通话':'开始通话');this.talkButton.setAttribute('aria-description',this.talkButton.getAttribute('aria-label')!);this.talkButton.dataset.pending=String(this.talkPending);
  this.updateTalkActivity();this.renderLenses();this.updateAuxiliary();this.updateMediaButtons(active);
  this.retry.disabled=this.cloudEvent?this.operation:!!this.stopping||!this.online;
  this.updateQualityLabels();
  this.emitAudioState();
 }
 private setState(state:string,message:string):void{this.stage.dataset.videoState=state;this.state.textContent=['connecting','waiting-frame'].includes(state)||message==='已停止'?'':message;this.overlay.setAttribute('aria-label',message);this.overlay.hidden=state==='playing';this.dots.hidden=!['connecting','waiting-frame','decoder-wait'].includes(state);this.retry.textContent=this.cloudEvent||this.browserView==='playback'?'重试':'重新连接';this.retry.hidden=this.cloudEvent?state!=='error':!['error','stopped'].includes(state)||this.powerValue()===false||!this.online;}
 private setMessage(message:string):void{this.diagnostic=message;this.stage.setAttribute('aria-description',message);}
 private showError(error:unknown):void{const issue=normalizeError(error);if(issue.kind==='cameraOperationRejected')return;this.setMessage(issue.message);}
 private cancelPlaybackSelection():void{
  this.albumAbort?.abort();this.albumRestore=this.pendingClip=undefined;this.albumRate=undefined;++this.clipSelection;
  this.replayResult=undefined;this.replayRecoveryOffset=undefined;
  clearTimeout(this.modeTimer);this.modeTimer=undefined;
 }
 private clearPlayback():void{
  this.cancelPlaybackSelection();
  if(!this.replayEmpty){
   this.replayEmpty=true;this.clip=undefined;this.clipOffset=0;this.clipPaused=true;
   this.switchingMedia=false;this.mediaGate.reset();this.primaryMediaKey=undefined;
   this.frames.reset();this.replayBuffer.reset();this.frameClock.reset();this.lastRecordingPoint={};
   clearInterval(this.replayTimer);this.replayTimer=undefined;
   this.releaseDecoder();this.audio.clearPlayback();
   this.syncReplayAudio(true);
   this.seek.max=this.seek.value='0';this.renderPlaybackToggle();
  }
  this.stage.dataset.videoMode='playback';
  this.setState('stopped','此日期没有存储卡录像。');this.updateButtons();
 }
 private cleanup():void{
  this.cancelPlaybackSelection();
  this.clipTask=this.albumTask=this.playbackTask=undefined;
  clearCameraMediaToast(this.stage);this.closeQuality(false);
  // Stop explicitly enabled audio before discarding the shared monitor player.
  // Use the captured session so a late result cannot affect a replacement route.
  if(this.context&&this.session){const c={...this.context},s=this.session;
   if(this.talkRequested)void this.source.cameraCommand(c,s,{kind:'talk',enabled:false}).catch(()=>{});
   if(this.listening||this.soundPending)void this.source.cameraCommand(c,s,{kind:'listen',enabled:false}).catch(()=>{});
  }
  this.receiveRate.textContent='0 KB/S';this.qualityReadings.reset(this.quality);
  this.frames.reset();this.secondary?.reset();this.frameClock.reset();this.lastRecordingPoint={};this.mediaGate.reset();this.primaryMediaKey=undefined;this.replayBuffer.reset();this.recordingPending=0;if(this.replayTimer)clearInterval(this.replayTimer);this.replayTimer=undefined;
  this.qualityOps.reset();
  ++this.epoch;if(this.timer)clearTimeout(this.timer);this.timer=undefined;
  ++this.soundEpoch;this.soundPending=false;this.soundTask=undefined;this.audio.dispose();++this.talkEpoch;this.talkPending=this.talkRequested=false;this.talkRevision=undefined;this.lastTalkStop=0;this.clipPaused=false;this.cloudEvent=undefined;mediaView(this.video).muted=true;this.cloudSequence.dispose();this.video.controls=false;this.talking=this.listening=false;this.setRecording(false);this.playbackRate=1;mediaView(this.video).playbackRate=1;this.renderRate();delete this.stage.dataset.playbackRate;this.renderSoundIcons();this.stage.dataset.audioFrames='0';delete this.stage.dataset.audioCodec;
  const session=this.session,context=this.context;this.session=undefined;this.primaryLiveQuality=undefined;this.monitorFreshLenses=undefined;
  const closing=context?(session?this.source.stopCamera(context,session):this.starting?.then(id=>this.source.stopCamera(context,id))):undefined;
  if(closing){this.stopping=closing;void closing.then(()=>{if(this.stopping===closing){this.stopping=undefined;this.updateButtons();}},()=>{if(this.stopping===closing){this.stopping=undefined;this.updateButtons();}});}
  this.releaseDecoder();this.busy=false;this.operation=false;this.updateButtons();
 }
 private backgrounded=false;
 private monitorHidden=false;
 setMonitorHidden(hidden:boolean):void {
  if(this.monitorHidden===hidden)return;
  this.monitorHidden=hidden;
  this.secondary?.setPresentationHidden(hidden);
  // WebView2 can stop delivering painted-frame callbacks while occluded.
  // Stream/decoder errors still follow the normal retry path.
  if(hidden)this.frames.reset();
  else if(!this.monitorPreviewPaused&&this.session&&!this.clip&&!this.cloudEvent&&!this.player?.waitingForDecoder)this.frames.data();
 }
 private monitorPreviewPaused=false;
 private monitorPreviewVersion=0;
 private monitorFreshLenses?:Set<number>;
 setMonitorPreviewPaused(paused:boolean):void {
  if(!this.source.monitor||this.monitorPreviewPaused===paused)return;
  this.monitorPreviewPaused=paused;++this.monitorPreviewVersion;
  if(paused){
   this.backgroundPause();
   if(this.timer)clearTimeout(this.timer);this.timer=undefined;
   this.frames.reset();this.primaryLiveQuality=undefined;
   this.qualityReadings.reset(this.quality);this.primaryMediaKey=undefined;this.secondary?.reset();
   this.releaseDecoder();this.monitorFreshLenses=new Set();
  }else{
   this.backgroundResume();
   if(this.context&&this.session){if(!this.monitorHidden)this.frames.data();this.watchFrames(this.epoch);void this.poll(this.context,this.session,this.epoch);}
  }
 }
 private resourceResume?:{kind:'live'|'clip'|'cloud';context:DeviceContext;clip?:CameraClip;offset:number;speed:number;paused:boolean};
 backgroundPause():void{
  if(!this.backgrounded){++this.powerEpoch;this.powerReading=false;if(this.powerTimer)clearTimeout(this.powerTimer);this.powerTimer=undefined;}
  this.backgrounded=true;this.care.setResourcePaused(true);this.albumAbort?.abort();if(this.recordingTimer)clearInterval(this.recordingTimer);this.recordingTimer=undefined;
  if(this.source.monitor&&this.monitorPreviewPaused)return;
  if(this.resourceResume||this.protectedWork||!this.context||!this.session&&!this.cloudEvent)return;
  const restore={kind:this.cloudEvent?'cloud' as const:this.clip?'clip' as const:'live' as const,context:{...this.context},clip:this.clip,offset:this.clip?this.replayPosition():mediaView(this.video).currentTime,speed:this.cloudEvent?mediaView(this.video).playbackRate:this.playbackRate,paused:this.cloudEvent?mediaView(this.video).paused:this.clipPaused};
  this.resourceResume=restore;
  if(restore.kind==='cloud'){this.cloudSequence.suspend();this.frames.reset();if(this.frameRequest!==undefined)cancelMediaFrame(this.video,this.frameRequest);this.frameRequest=undefined;}
  else{this.cleanup();this.autoAttempted=false;}
 }
 backgroundResume():void{
  const wasBackground=this.backgrounded;this.backgrounded=false;this.care.setResourcePaused(false);if(wasBackground&&this.powerActive)void this.refreshPower();if(this.recording&&!this.recordingTimer){this.recordingTimer=setInterval(()=>this.updateRecordingBadge(),1000);this.updateRecordingBadge();}const restore=this.resourceResume;this.resourceResume=undefined;
  if(!restore||!sameContext(restore.context,this.context)||!this.online)return;
  if(restore.kind==='cloud'){if(!this.cloudSequence.resourceSuspended){mediaView(this.video).playbackRate=restore.speed;if(!restore.paused)void this.cloudSequence.play().catch(e=>{if(e?.name!=='AbortError')this.cloudFailure(normalizeError(e).message);});this.watchFrames(this.epoch);return;}const epoch=this.epoch;void this.cloudSequence.resume().then(()=>{if(epoch===this.epoch&&!this.backgrounded)this.watchFrames(epoch);}).catch(e=>{if(epoch===this.epoch&&e?.name!=='AbortError')this.cloudFailure(normalizeError(e).message);});return;}
  if(this.source.monitor&&restore.kind==='live'){this.autoAttempted=false;return;}
  this.autoAttempted=true;void(async()=>{await this.start();if(restore.kind==='clip'&&restore.clip&&sameContext(restore.context,this.context)&&!this.backgrounded)await this.playClip(restore.clip,restore.offset,restore.speed,restore.paused);})().catch(e=>this.showError(e));
 }
 stop():void{++this.careEpoch;this.cleanup();if(!this.replayEmpty)this.setState('stopped','已停止');}
 private releaseDecoder():void {
  ++this.mediaEpoch;
  if(this.frameRequest!==undefined)cancelMediaFrame(this.video,this.frameRequest);
  this.frameRequest=undefined;
  this.player?.destroy();this.player=undefined;
  this.video.loop=false;this.video.removeAttribute('src');this.video.load();
 }
 dispose():void{this.resourceResume=undefined;this.backgrounded=false;this.monitorPreviewPaused=false;++this.monitorPreviewVersion;this.leaveLensFullscreen();this.activatePower(false);this.stop();if(this.qualityHost)this.qualityHost.append(this.qualityPanel);this.secondary?.dispose();this.secondary?.viewport.remove();this.secondary=undefined;this.secondaryTools=undefined;this.qualityReturn=undefined;++this.auxiliaryVersion;this.auxiliaryBusy=false;this.care.clear();this.context=undefined;this.featureLoad=undefined;this.autoAttempted=false;window.removeEventListener('blur',this.blur);document.removeEventListener('fullscreenchange',this.fullscreenChanged);this.mounted=false;}
 private fail(message:string):void{this.cleanup();this.setState('error',message);this.failed();}
 private attachPlayer(epoch:number):void{
  this.releaseDecoder();const media=this.mediaEpoch;
  this.frames.reset();this.updateQualityLabels();this.replayBuffer.reset();this.frameClock.reset();
  this.video.autoplay=!this.clip;this.video.playbackRate=this.video.defaultPlaybackRate=this.clip?this.playbackRate:1;
  const current=()=>epoch===this.epoch&&media===this.mediaEpoch;
  const player=nativeVideoPlayer(this.video,kind=>{if(current())this.failPrimary(playbackMessage(kind));},!this.clip,waiting=>{
   if(!current())return;
   if(waiting){
    this.frames.reset();clearTimeout(this.modeTimer);this.modeTimer=undefined;
    this.setState('decoder-wait',DECODER_WAITING);
   }else{
    this.setState('waiting-frame','等待画面…');
    if(this.clip&&this.replayTimer!==undefined)this.armPlaybackFrameTimeout();
    else if(!this.clip&&!this.monitorHidden)this.frames.data();
   }
   this.updateMediaButtons(!!this.session&&this.busy&&!this.stopping);
  });
  if(epoch!==this.epoch||media!==this.mediaEpoch){player.destroy();return;}
  this.player=player;this.watchFrames(epoch);
 }
 private loadFeatures(context:DeviceContext):Promise<CameraFeatures|undefined>{
  if(this.featureLoad)return this.featureLoad;
  const request=this.source.cameraFeatures(context).then(features=>{
   if(this.featureLoad===request&&sameContext(context,this.context))this.applyFeatures(features);
   return features;
  }).catch(error=>{
   if(this.featureLoad===request&&sameContext(context,this.context)){
    this.featureLoad=undefined;this.showError(error);
   }
   return undefined;
  });
  return this.featureLoad=request;
 }
 private async retryConnection():Promise<void>{
  if(this.browserView==='care'&&this.cloudEvent){await this.playCare(this.cloudEvent,true);return;}
  if(this.browserView==='playback'){await this.retryPlayback();return;}
  const context=this.context,epoch=this.epoch;
  if(this.playingElsewhere&&context&&this.source.focusCameraView){
   if(await this.source.focusCameraView(context).catch(()=>false)||epoch!==this.epoch)return;
  }
  await this.start();
 }
 private streamFailure(error:unknown,allowRenewal:boolean):void{
  const failure=normalizeError(error);
  this.fail(failure.message);
  this.playingElsewhere=failure.kind==='cameraInUse'&&!!this.source.focusCameraView;
  if(this.playingElsewhere)this.retry.textContent='查看播放窗口';
  if(allowRenewal&&failure.kind==='monitorSessionRenewed'){
   const epoch=this.epoch;
   this.timer=setTimeout(()=>{if(epoch===this.epoch)void this.start(false);},1000);
  }
 }
 private async start(allowRenewal=true):Promise<void>{
  if(!this.context||this.busy||!this.online||this.powerValue()===false)return;if(this.stopping){try{await this.stopping;}catch{return;}if(!this.context||this.busy)return;}
  this.cleanup();this.playingElsewhere=false;this.primaryMediaKey=undefined;this.switchingMedia=false;this.clip=undefined;this.renderLenses();this.stage.dataset.videoMode=this.replayEmpty?'playback':'live';const context={...this.context},epoch=this.epoch;
  this.busy=true;this.updateButtons();if(!this.replayEmpty)this.setState('connecting','正在连接摄像机…');this.stage.dataset.decodedFrames='0';
  try{
   await loadVideoEngine();if(epoch!==this.epoch||!sameContext(context,this.context))return;
   if(!nativeVideoSupported())throw Error('当前系统视频组件 不支持 MediaSource 视频播放。');
   const features=this.features??await this.loadFeatures(context);
   if(epoch!==this.epoch||!sameContext(context,this.context))return;
   const quality=features?.qualities.some(q=>q.id===this.quality)?this.quality:'auto';
   const opening=this.source.startCamera(context,quality);this.starting=opening;const session=await opening;if(this.starting===opening)this.starting=undefined;
   if(epoch!==this.epoch){if(!this.stopping)void this.source.stopCamera(context,session).catch(()=>{});return;}this.session=session;this.updateButtons();
   void this.poll(context,session,epoch);
  }catch(error){if(epoch===this.epoch){this.starting=undefined;this.streamFailure(error,allowRenewal);}}
 }
 private updateVideoAspect():void{
  const {videoWidth,videoHeight}=mediaView(this.video);if(!videoWidth||!videoHeight)return;
  const aspect=`${videoWidth} / ${videoHeight}`;if(this.viewport.style.aspectRatio!==aspect)this.viewport.style.aspectRatio=aspect;
 }
 private watchFrames(epoch:number):void{
  if(this.replayEmpty)return;
  const media=this.mediaEpoch;
  this.frameRequest=requestMediaFrame(this.video,(_time,metadata)=>{
   if(epoch!==this.epoch||this.monitorPreviewPaused)return;
   if(media!==this.mediaEpoch){this.watchFrames(epoch);return;}
   const view=mediaView(this.video),width=String(view.videoWidth),height=String(view.videoHeight);
   const sizeChanged=this.stage.dataset.videoWidth!==width||this.stage.dataset.videoHeight!==height;
   if(sizeChanged){this.stage.dataset.videoWidth=width;this.stage.dataset.videoHeight=height;this.updateVideoAspect();}
   let qualityChanged=false;
   if(!this.clip&&!this.cloudEvent&&this.stage.dataset.videoMode==='live'){
    qualityChanged=this.qualityReadings.observe(0,metadata,this.primaryMediaKey??'initial',this.primaryLiveQuality);
   }
   if(this.clip)this.replayBuffer.frame(metadata.mediaTime);
   this.lastRecordingPoint=this.frameClock.at(view.currentTime);this.frames.frame();
   this.stage.dataset.decodedFrames=String(metadata.presentedFrames);
   let readyChanged=false;
   if(!this.switchingMedia&&!this.replayResult&&(this.browserView==='live'||this.browserView==='care'||!!this.clip||!!this.cloudEvent)){
    if(this.modeTimer)clearTimeout(this.modeTimer);this.modeTimer=undefined;
    readyChanged=this.stage.dataset.videoState!=='playing';
    if(readyChanged)this.setState('playing',this.cloudEvent?'云端录像':this.clip?'存储卡回看':'实时画面');
    if(this.cloudEvent)this.care.select(this.cloudEvent.id,!this.clipPaused&&!view.paused);
    this.captureClipThumbnail();
   }
   if(readyChanged||sizeChanged)this.updateButtons();else if(qualityChanged)this.updateQualityLabels();
   this.stage.dispatchEvent(new CustomEvent<CameraFrameNotice>('camera-frame',{detail:{lensId:0,count:metadata.presentedFrames}}));
   this.watchFrames(epoch);
  });
 }
 private consumeEvents(events:CameraEvent[],epoch:number):void{
  for(const event of events){
   if(event.state==='throughput'){const bytes=event.receiveBytesPerSecond;if(bytes!==undefined&&Number.isFinite(bytes)&&bytes>=0){const rate=bytes/1024;this.receiveRate.textContent=`${rate>=10?Math.round(rate):Number(rate.toFixed(1))} KB/S`;}continue;}
   if(event.state==='talk-stopped'){
    const revision=event.talkRevision;
    if(revision!==undefined)this.lastTalkStop=Math.max(this.lastTalkStop,revision);
    if(this.talking&&!this.talkPending&&revision===this.talkRevision){
     this.talkRequested=false;
     void this.endTalk();
     this.setMessage('摄像头已结束通话，请重新开启。');
    }
    continue;
   }
   if(event.state==='audio'&&this.stage.dataset.cameraAlbum==='true')continue;
   const media=['media','audio','lens-unavailable','playback-preview-limit'].includes(event.state);
   if(media){if(this.replayEmpty||this.replayResult)continue;if(this.mediaGate.transitioning){this.mediaGate.hold(event);continue;}if(!this.mediaGate.accept(event))continue;}
   if(event.state==='playback-preview-limit'){
    if(this.clip)this.replayBuffer.halted=true;
    continue;
   }
   const lens=event.lensId??0,secondary=this.secondary,other=secondary?.lensId===lens;
   if(event.state==='lens-unavailable'){
    if(!this.clip&&!this.cloudEvent){
     const message=event.error?.message??'此镜头暂时没有画面';
     if(other&&this.dualLive())secondary.unavailable(message);
     else if(lens===0)this.failPrimary(message);
     this.updateQualityLabels();
    }
    continue;
   }
   if(event.state==='recording'){this.setRecording(true);continue;}if(event.state==='recording-stopped'){this.setRecording(false,event.file);continue;}
   if(event.error){if(event.state==='operation-error'){if(event.file||['recordingCodecChanged','recordingLimit','recordingBackpressure','mediaSaveFailed','recordingEmpty'].includes(event.error.kind)){this.setRecording(false,event.file);this.showRecordingNotice(event.error.message,event.file);}this.showError(event.error);this.updateButtons();continue;}this.fail(event.error.message);return;}
   if(event.state==='stopped'){this.stop();return;}
   if(event.state==='waiting-frame'&&!this.replayEmpty&&!this.player?.waitingForDecoder)this.setState('waiting-frame','等待首帧…');
   if(event.file)this.setRecording(false,event.file);
   if(!event.data||this.cloudEvent)continue;
   if(event.state==='audio'){
    if((this.listening||this.soundPending)&&(!this.clip||this.playbackRate===1&&!this.replayBuffer.halted))this.audio.receive(event,()=>{
     this.stage.dataset.audioCodec=event.codec;
     this.stage.dataset.audioFrames=String(this.audio.decoded);
    });
    continue;
   }
   if(event.state!=='media')continue;
   if(this.monitorFreshLenses&&!this.monitorFreshLenses.has(lens)){
    if(!event.keyframe)continue;
    this.monitorFreshLenses.add(lens);
   }
   // A list or album can be open while the device is still sending live video.
   if(!this.clip&&other){
    if(this.dualLive()){
     const playing=secondary.playing;
     secondary.feed(event);
     if(playing&&!secondary.playing)this.updateQualityLabels();
    }
    continue;
   }
   if(this.clip?event.lensId!==undefined&&lens!==this.clip.channel:lens!==0)continue;
   const key=this.mediaGate.decoderKey(event);
   const changed=key!==this.primaryMediaKey;
   if(changed){if(event.keyframe===false)continue;this.primaryMediaKey=key;this.attachPlayer(epoch);}
   if(epoch!==this.epoch)return;
   if(!this.player)continue;
   this.primaryLiveQuality=event.liveQuality;
   if(this.clip&&!this.replayBuffer.append(event,mediaView(this.video).currentTime))continue;
   this.frameClock.observe(event,mediaView(this.video).currentTime,!!this.clip);this.stage.dataset.videoCodec=event.codec;if(!this.clip&&!this.monitorHidden&&!this.player.waitingForDecoder)this.frames.data();
   this.player.feed(decodeCameraPacket(event.data).buffer,event.keyframe);
   if(changed&&(!this.clip||!this.clipPaused&&!this.operation))void this.player?.play().catch(()=>{});
  }
 }
 private async poll(context:DeviceContext,session:string,epoch:number):Promise<void>{
  if(this.monitorPreviewPaused)return;
  const version=this.monitorPreviewVersion,current=()=>epoch===this.epoch&&version===this.monitorPreviewVersion;
  try{
   const events=await this.source.readCamera(context,session);
   if(!current())return;
   this.consumeEvents(events,epoch);
   if(!current())return;
   const catchUp=this.acceleratedReplay&&events.length>=CAMERA_READ_BATCH;
   this.timer=setTimeout(()=>{void this.poll(context,session,epoch);},catchUp?0:40);
  }
  catch(error){if(current())this.streamFailure(error,this.browserView==='live');}
 }
 private async command(operation:CameraOperation,propagate=false,clearMessage=true,current=()=>true){
  if(!this.context||!this.session)return;
  const context={...this.context},session=this.session;
  const valid=()=>session===this.session&&sameContext(context,this.context)&&current();
  try{
   const reply=await this.source.cameraCommand(context,session,operation);
   if(!valid())return;
   if(clearMessage&&!this.data.error)this.setMessage('');
   if(reply.features)this.applyFeatures(reply.features);
   return reply;
  }catch(error){
   if(valid())this.showError(error);
   if(propagate)throw error;
  }
 }
 private async powerRequest(awake:boolean,read:boolean){
  const context=this.context,version=this.powerOps.version;if(!context)throw {kind:'staleContext',message:'摄像头已经关闭。'};
  let state:CameraPower;
  if(read)state=await this.source.cameraPower(context);
  else{const property=this.powerProperty();if(this.data.power&&property){await this.data.power(property,awake);return{outcome:'pending' as const,message:''};}
   const expected=this.powerSnapshot?.awake??booleanValue(property);if(typeof expected!=='boolean')throw {kind:'unavailable',message:'摄像头状态尚未读取。'};
   const result=await this.source.changeCameraPower(context,awake,expected);state=result.report;
  }
  if(context!==this.context)throw {kind:'staleContext',message:'摄像头已经切换。'};
  this.powerReadVersion=version;this.acceptPower(state);
  return{outcome:state.awake===awake?'confirmed' as const:'pending' as const,actual:state.awake??undefined,message:''};
 }
 private async changePower(desired?:boolean):Promise<void>{
  const value=this.powerValue();if(typeof value!=='boolean'||!this.context||!this.online)return;
  const awake=desired??!value;if(awake===value)return;this.powerOps.write('power',awake,this.powerSnapshot?.awake??value);
 }

 toggleSound():Promise<void>{if(this.soundTask)return this.soundTask;if(this.soundButton.disabled)return Promise.resolve();const task=this.changeSound();this.soundTask=task;void task.finally(()=>{if(this.soundTask===task)this.soundTask=undefined;});return task;}
 private async changeSound():Promise<void>{
  const enabled=!this.listening;if(this.cloudEvent){if(mediaView(this.video).playbackRate!==1)return;mediaView(this.video).muted=!enabled;this.listening=enabled;this.renderSoundIcons();return;}

  const epoch=++this.soundEpoch,session=this.session,context=this.context,current=()=>epoch===this.soundEpoch&&session===this.session&&sameContext(context,this.context);
  let requested=false;
  this.soundPending=true;this.updateButtons();
  try{
   const output=this.audio.listen(enabled).then(()=>{
    if(enabled&&this.clipPaused&&current())this.syncReplayAudio(true);
   });
   if(!enabled){this.listening=false;this.renderSoundIcons();}
   // Audio and the acknowledgement arrive independently. Consume packets while
   // opening and confirm the UI only after the local output has accepted a frame.
   requested=true;
   const [,result]=await Promise.all([output,this.command({kind:'listen',enabled},true,true,()=>current()&&this.soundPending)]);
   if(!current())return;
   if(!result||result.state!==(enabled?'listening':'muted'))throw Error('声音切换未完成。');
   if(enabled){
    await this.audio.waitForOutput();
    if(current()){this.listening=true;this.renderSoundIcons();}
   }
  }
  catch(e){if(current()){this.audio.closeListening();this.listening=false;this.renderSoundIcons();this.showError(e);if(enabled&&requested)void this.command({kind:'listen',enabled:false},false,false,current);}}
  finally{if(current()){this.soundPending=false;this.updateButtons();this.secondaryTools?.sync();}}
 }
 async toggleTalk():Promise<void>{
  if(this.talking||this.talkPending){await this.endTalk();return;}if(this.talkButton.disabled||!this.context||!this.session||!this.features?.talkFormat)return;
  const context={...this.context},session=this.session,attempt=++this.talkEpoch,current=()=>attempt===this.talkEpoch&&sameContext(context,this.context)&&session===this.session;
  this.talkPending=true;this.operation=true;this.setMessage('正在申请麦克风权限并准备音频…');this.updateButtons();
  try{
   await this.audio.startMicrophone(this.features.talkFormat.sampleRate,packet=>current()&&this.talking?this.source.cameraMicrophone(context,session,packet):Promise.resolve(),message=>{if(current()){this.setMessage(message);void this.endTalk();}},this.features.talkFormat.codec,()=>{if(current())this.updateTalkActivity();});
   if(!current())return;if(!this.audio.microphoneActive)throw Error('麦克风未能启动，请检查录音设备和权限。');
   this.setMessage('正在等待摄像头确认通话…');this.talkRequested=true;const reply=await this.command({kind:'talk',enabled:true},true,false,current);
   if(!current())return;
   if(reply?.state!=='talking')throw Error('摄像头未建立通话，请重试。');
   if(reply.talkRevision!==undefined&&reply.talkRevision<=this.lastTalkStop){
    this.talkRequested=false;
    throw Error('摄像头已结束通话，请重新开启。');
   }
   this.talkRevision=reply.talkRevision;
   this.talking=true;this.setMessage('通话中');
  }catch(error){if(current()){this.setMessage(normalizeError(error).message);await this.endTalk();}}
  finally{if(current()){this.talkPending=false;this.operation=false;this.updateButtons();}}
 }
 private async endTalk():Promise<void>{
  const requested=this.talkRequested;
  const attempt=++this.talkEpoch;
  if(this.talkPending)this.operation=false;
  this.talkPending=this.talkRequested=false;
  this.talkRevision=undefined;
  this.audio.stopMicrophone();this.talking=false;
  if(/^(通话中|正在申请麦克风|正在等待摄像头确认通话)/.test(this.diagnostic))this.setMessage('');
  this.updateButtons();
  if(requested)await this.command({kind:'talk',enabled:false},false,false,()=>attempt===this.talkEpoch);
 }
 private async snapshot(lensId?:number):Promise<void>{
  const video=lensId===undefined?undefined:this.videoForLens(lensId);
  if(!this.context||!this.session||this.operation||(lensId===undefined?!this.hasDecodedVideo:!hasMediaFrame(video)))return;
  const context={...this.context},session=this.session;this.operation=true;this.updateButtons();
  try{const file=await this.source.cameraScreenshot(context,session,video?captureCameraLens(video):this.screenshotPixels());if(file&&sameContext(context,this.context)&&session===this.session){this.setMessage(`截图已保存：${file.fileName}`);showCameraMediaSaved(this.stage,file);}}
  catch(e){if(sameContext(context,this.context))this.showError(e);}
  finally{if(sameContext(context,this.context)&&session===this.session){this.operation=false;this.updateButtons();}}
 }
 private async toggleRecord(requestedLens?:number):Promise<void>{
  if(this.clip&&!this.recording&&this.clipPaused)return;
  if(this.operation||this.recordingPending)return;
  if(this.recording&&requestedLens!==undefined&&requestedLens!==this.recordingLens)return;
  if(this.clip&&!this.recording&&this.playbackRate!==1){
   const epoch=this.epoch,clip=this.clip;
   await this.playClip(clip,this.replayPosition(),1);
   if(epoch!==this.epoch||this.clip!==clip)return;
   const release=this.holdRecordingChange(),deadline=performance.now()+8000;
   try{while(epoch===this.epoch&&mediaView(this.video).readyState<2&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));}
   finally{release();}
   if(epoch!==this.epoch||this.clip!==clip||mediaView(this.video).readyState<2||this.clipPaused){this.showRecordingNotice('尚未取得可录制的1倍回看画面。');return;}
  }
  const enabled=!this.recording,lensId=enabled?(this.clip?.channel??requestedLens??this.selectedLens):(this.recordingLens??this.selectedLens),video=this.clip?this.video:this.videoForLens(lensId);
  if(!this.context||!this.session||!video||enabled&&!hasMediaFrame(video))return;
  const context=this.context,session=this.session,point=this.pointForLens(lensId);if(enabled){this.recordingLens=lensId;}this.operation=true;this.updateButtons();
  if(!enabled)this.showRecordingNotice('正在保存录像…');
  try{const reply=await this.command(enabled?{kind:'record',enabled:true,width:mediaView(video).videoWidth,height:mediaView(video).videoHeight,lensId,...point}:{kind:'record',enabled:false,...point},true);if(reply&&reply.state!=='cancelled')this.setRecording(reply.state==='recording',reply.file);}
  catch(error){if(sameContext(context,this.context))this.showRecordingNotice(normalizeError(error).message);}
  finally{if(sameContext(context,this.context)&&session===this.session){if(!this.recording)this.recordingLens=undefined;this.operation=false;this.updateButtons();}}
 }
 applyFeatures(features:CameraFeatures):void{if(JSON.stringify(this.features)===JSON.stringify(features))return;if(!features.talk&&(this.talking||this.talkPending))void this.endTalk();this.features=features;this.configureLenses();if(!features.qualities.some(q=>q.id===this.quality)){this.quality='auto';this.qualityReadings.reset(this.quality);}this.renderQuality();this.updateButtons();}
 private renderQuality():void{
  this.qualityButton.setAttribute('aria-busy',String(this.qualityOps.pendingCount>0));
  const lens=this.qualityReturn&&this.secondaryTools?.root.contains(this.qualityReturn)?this.secondary?.lensId??0:0;
  renderCameraQualityDialog(this.qualityPanel,this.qualityProfiles,this.displayedQuality,id=>{void this.changeQuality(id);},this.qualitySizes(lens));
  this.updateQualityLabels();
 }
 private async changeQuality(quality:string):Promise<void>{if(this.operation&&!this.qualityOps.pendingCount||!this.session||!this.features?.qualities.some(q=>q.id===quality))return;this.closeQuality();this.setMessage('正在切换画质…');this.qualityOps.write('quality',quality,this.quality);}
 private async submitQuality(quality:string){const context=this.context,session=this.session,epoch=this.epoch;if(!context||!session)throw{kind:'staleContext',message:'视频会话已关闭。'};this.operation=true;this.beginQualityChange(quality);this.updateButtons();try{const reply=await this.command({kind:'quality',quality},true);if(epoch!==this.epoch||session!==this.session||!sameContext(context,this.context)||!reply)throw{kind:'staleContext',message:'视频会话已改变。'};this.qualityReadings.confirm(quality);this.quality=quality;if(!this.source.monitor)rememberCameraQuality(context,this.model,quality);this.setState('waiting-frame','正在切换画质…');void mediaView(this.video).play().catch(()=>{});return{outcome:'confirmed' as const,actual:quality,message:'画质设置已接受，正在等待画面'};}catch(error){if(epoch===this.epoch&&session===this.session)this.cancelQualityChange();if(!this.source.monitor&&normalizeError(error).kind==='cameraQualityUncertain'&&sameContext(context,this.context)){this.cleanup();this.quality=quality;this.renderQuality();await this.start();if(this.session)rememberCameraQuality(context,this.model,quality);return {outcome:'confirmed' as const,actual:quality,message:''};}throw error;}finally{if(epoch===this.epoch&&session===this.session){this.operation=false;this.updateButtons();}}}

 private showView(view:CameraView):void{
  const leavingLive=this.browserView==='live'&&view!=='live';
  if(this.browserView==='playback'&&view!=='playback'){this.cancelPlaybackSelection();this.replayEmpty=false;}
  if(this.browserView==='care'&&view!=='care')this.care.clear();
  this.browserView=view;this.stage.dataset.cameraView=view;
  if(leavingLive)this.secondary?.reset();
  this.playbackPanel.hidden=view!=='playback';this.carePanel.hidden=view!=='care';
  if(view!=='playback')delete this.stage.dataset.cameraAlbum;
  if(view==='live'){
   if(this.nameBlock.parentElement!==this.headerTitle)this.headerTitle.replaceChildren(this.nameBlock);
  }else this.headerTitle.replaceChildren(element('span','',view==='playback'?'microSD卡':'看家助手'));
  this.renderLenses();
 }
 private async openPlayback():Promise<void>{
  if(isCloudDoorbell(this.model)||!this.session||!this.features?.playback||this.operation||this.recordingOrTalking)return;
  const attempt=++this.careEpoch,current=()=>attempt===this.careEpoch&&this.browserView==='playback';
  this.showView('playback');this.ptzPanel.hidden=this.qualityPanel.hidden=true;
  this.stage.querySelector('.device-page-scroll')?.scrollTo(0,0);this.browser.loading();
  this.setState('waiting-frame','正在读取存储卡录像…');
  const reply=await this.command({kind:'recordings'},false,false,current);
  if(!current())return;
  if(!reply?.clips){this.browser.failure();this.setState('error','存储卡录像读取失败。');return;}
  this.browser.update(reply.clips);
  const latest=this.browser.latestClip();
  if(latest)void this.selectClip(latest,Math.max(0,latest.duration-30));
  else this.clearPlayback();
 }
 private async retryPlayback():Promise<void>{
  if(this.operation)return;
  if(this.session&&this.clip){await this.selectClip(this.clip,this.replayPosition());return;}
  const context=this.context;
  if(!this.session)await this.start();
  if(this.browserView==='playback'&&sameContext(context,this.context))await this.openPlayback();
 }
 private async openCare(date=cameraDate(Date.now()/1000)):Promise<void>{
  if(!this.context||!this.features?.care||this.recordingOrTalking)return;
  const context={...this.context};
  if(this.browserView!=='care'&&(this.clip||this.replayEmpty)){
   await this.returnLive();
   if(!sameContext(context,this.context)||this.browserView==='playback'||this.recordingOrTalking)return;
  }
  if(this.cloudEvent&&this.careDate!==date){this.cleanup();this.setState('stopped','选择事件查看录像。');this.retry.hidden=true;}
  const attempt=++this.careEpoch;this.careDate=date;this.showView('care');this.ptzPanel.hidden=this.qualityPanel.hidden=true;
  this.care.loading(context,date);this.stage.querySelector('.device-page-scroll')?.scrollTo(0,0);
  try{const result=await this.source.cameraCare(context,date);if(attempt!==this.careEpoch||!sameContext(context,this.context))return;this.care.update(result);}
  catch(error){if(attempt===this.careEpoch&&sameContext(context,this.context))this.care.failure(normalizeError(error).message);}
 }
 private cloudFailure(message:string):void{
  if(this.browserView!=='care'||!this.cloudEvent)return;
  if(this.frameRequest!==undefined)cancelMediaFrame(this.video,this.frameRequest);
  this.frameRequest=undefined;this.cloudSequence.dispose();this.operation=false;this.clipPaused=true;
  this.setState('error',message);this.care.select(this.cloudEvent.id,false);this.updateButtons();
 }
 private async playCare(event:CareEvent,retry=false):Promise<void>{
  if(!this.context||this.recordingOrTalking||this.operation&&!this.cloudEvent||!event.playbackAvailable)return;
  if(this.cloudEvent?.id===event.id&&!retry){if(this.operation)return;if(this.cloudSequence.active){await this.togglePlayback();return;}}
  const context={...this.context},date=this.careDate,attempt=this.careEpoch;
  this.cleanup();this.cloudEvent=event;this.video.autoplay=false;this.clip=undefined;this.operation=true;this.busy=true;this.stage.dataset.videoMode='cloud';this.renderPlaybackToggle();this.setState('waiting-frame','正在读取云端录像…');this.care.select(event.id,false);this.updateButtons();
  const epoch=this.epoch;
  try{
   const report=await this.source.cameraCareVideo(context,date,event.id);
   if(attempt!==this.careEpoch||epoch!==this.epoch||!sameContext(context,this.context)||this.browserView!=='care'){report.close();return;}
   this.watchFrames(epoch);await this.cloudSequence.load(report,true);if(attempt!==this.careEpoch||epoch!==this.epoch||!sameContext(context,this.context))return;
   this.operation=false;this.syncCloudSelection();this.updateButtons();
  }catch(error){if((error as {name?:string}|null)?.name!=='AbortError'&&attempt===this.careEpoch&&epoch===this.epoch&&sameContext(context,this.context))this.cloudFailure(normalizeError(error).message);}
 }
 private syncCloudSelection():void{
  if(!this.cloudEvent||!this.cloudSequence.active)return;
  this.clipPaused=mediaView(this.video).paused;
  this.renderPlaybackToggle();this.care.select(this.cloudEvent.id,!this.clipPaused);
 }
 private renderRate():void{paintReplayRate(this.rateButton,this.playbackRate);}
 private replayPosition(time=mediaView(this.video).currentTime):number{
  if(!this.clip)return 0;
  // Both the MSE remuxer and the compatibility decoder use a zero-based playback clock.
  const position=this.clipOffset+time;
  return Math.max(0,Math.min(this.clip.duration-1,position));
 }
 private muteReplaySound():void{
  if(!this.listening&&!this.soundPending)return;
  ++this.soundEpoch;this.soundTask=undefined;
  this.audio.closeListening();this.listening=this.soundPending=false;
  if(this.context&&this.session)void this.source.cameraCommand({...this.context},this.session,{kind:'listen',enabled:false}).catch(()=>{});
  this.renderSoundIcons();
 }
 private syncReplayAudio(paused:boolean):void{
  const intent=++this.replayIntent,epoch=this.epoch,selection=this.clipSelection,sound=this.soundEpoch;
  const output=paused?this.audio.pausePlayback():this.audio.resumePlayback();
  void output.catch(error=>{
   if(epoch!==this.epoch||selection!==this.clipSelection||intent!==this.replayIntent||sound!==this.soundEpoch||
      !this.listening&&!this.soundPending)return;
   this.muteReplaySound();
   this.updateButtons();
   this.showError(error);
  });
 }
 private async cycleRate():Promise<void>{
  if(!this.clip||this.operation||this.recording||this.soundPending)return;
  const rates=[.5,1,2,4],previous=this.playbackRate,next=rates[(rates.indexOf(previous)+1)%rates.length],epoch=this.epoch,clip=this.clip;
  // Keep the decoder, buffered frames, paused state and source clock in place.
  const changeTransport=(previous>1)!==(next>1);
  this.playbackRate=mediaView(this.video).playbackRate=next;this.renderRate();this.stage.dataset.playbackRate=String(next);
  if(!changeTransport){if(next!==1)this.muteReplaySound();this.updateButtons();return;}
  this.operation=true;this.updateButtons();
  const current=()=>epoch===this.epoch&&this.clip===clip;
  try{
   const reply=await this.command({kind:'playbackSpeed',speed:next>1?4:1},false,false,current);
   if(current()){
    if(reply?.state!=='speed-set'){
     this.playbackRate=mediaView(this.video).playbackRate=previous;
     this.renderRate();this.stage.dataset.playbackRate=String(previous);
    }else if(next!==1)this.muteReplaySound();
   }
  }finally{
   if(epoch===this.epoch){this.operation=false;this.updateButtons();}
  }
 }
 private async bufferPlayback(speed:number,current:()=>boolean,remaining:number):Promise<void>{
  if(speed===1||softwareSurface(this.video))return;
  mediaView(this.video).pause();
  const target=Math.min(speed*1.5,Math.max(.5,remaining*.6)),deadline=performance.now()+10000;
  while(current()&&performance.now()<deadline){
   const view=mediaView(this.video);
   const ahead=replayBufferedAhead(view);
   if(this.player?.waitingForDecoder||softwareSurface(this.video)||ahead>=target||this.replayBuffer.halted&&ahead>0)return;
   await new Promise(r=>setTimeout(r,100));
  }
 }
 private async refillPlayback(now=performance.now()):Promise<void>{
  if(!this.clip||this.replayResult||this.pendingClip||this.clipPaused||this.operation||this.recording||this.recordingPending||this.stage.dataset.videoState!=='playing'||
    this.backgrounded||this.monitorHidden||document.hidden||!this.stage.isConnected||this.stage.dataset.cameraAlbum==='true'){
   this.replayBuffer.resetProgress();return;
  }
  const view=mediaView(this.video),displayed=this.replayBuffer.displayedTime(view.currentTime);
  const stalled=this.replayBuffer.stalled(displayed,now);
  const displayedOffset=this.replayPosition(displayed);
  const offset=stalled?displayedOffset:this.replayPosition(view.currentTime);
  if(view.ended||stalled&&offset>=this.clip.duration-1){this.finishReplay();return;}
  if(offset>=this.clip.duration-1)return;
  if(this.replayRecoveryOffset!==undefined&&displayedOffset>=this.replayRecoveryOffset+1)this.replayRecoveryOffset=undefined;
  if(!stalled&&!this.replayBuffer.needsRefill(view,!!softwareSurface(this.video)))return;
  if(this.replayRecoveryOffset!==undefined){
   if(stalled)this.finishReplay('存储卡回看中断，请重试。');
   return;
  }
  // The previous playback request succeeded. Resume this clip at the last
  // position, on its existing camera session, and require progress before another retry.
  this.replayRecoveryOffset=offset;
  this.replayBuffer.resetProgress();
  await this.playClip(this.clip,offset,this.playbackRate);
 }
 private finishReplay(error?:string):void{
  if(!this.clip||this.replayResult)return;
  this.replayResult=error?'failed':'ended';
  this.switchingMedia=false;this.mediaGate.reset();
  clearInterval(this.replayTimer);this.replayTimer=undefined;
  clearTimeout(this.modeTimer);this.modeTimer=undefined;
  this.pausePlayback();
  if(error)this.setState('error',error);
  this.updateButtons();
 }
 private playClip(clip:CameraClip,offset=0,speed=this.playbackRate,paused=false,thumbnail=false):Promise<void>{
  if(!this.session||this.operation||this.recording||this.recordingPending)return Promise.resolve();
  const task=this.loadPlayback(clip,offset,speed,paused,thumbnail);
  this.playbackTask=task;
  return task.finally(()=>{if(this.playbackTask===task)this.playbackTask=undefined;});
 }
 private async loadPlayback(clip:CameraClip,offset:number,speed:number,paused:boolean,thumbnail:boolean):Promise<void>{
  const epoch=this.epoch,selection=this.clipSelection,current=()=>epoch===this.epoch&&selection===this.clipSelection;
  clearTimeout(this.modeTimer);this.modeTimer=undefined;
  clearInterval(this.replayTimer);this.replayTimer=undefined;
  this.operation=true;
  let loaded=false;
  try{
   this.replayEmpty=false;this.replayResult=undefined;
   this.switchingMedia=true;this.clipPaused=paused;this.clip=clip;this.playbackRate=speed;this.primaryMediaKey=undefined;
   this.clipOffset=Math.max(0,Math.min(Number.isFinite(offset)?Math.floor(offset):0,clip.duration-1));
   this.renderRate();this.renderLenses();this.setState('waiting-frame','正在读取存储卡录像…');
   this.mediaGate.begin();this.releaseDecoder();this.audio.clearPlayback();this.audio.setPlaybackBuffered(true);
   this.syncReplayAudio(paused||thumbnail);
   this.updateButtons();
   const reply=await this.command({kind:'playback',start:clip.start,offset:this.clipOffset,channel:clip.channel,speed:speed>1?4:1},false,true,current);
   if(!current())return;
   this.switchingMedia=false;
   if(reply){
    this.consumeEvents(this.mediaGate.commit(reply.streamRevision),epoch);
    if(!current())return;
    await this.bufferPlayback(speed,current,clip.duration-this.clipOffset);
    if(!current())return;
    loaded=true;
   }
   if(loaded){
    const view=mediaView(this.video);view.playbackRate=speed;
    if(speed!==1)this.muteReplaySound();
    this.stage.dataset.videoMode='playback';this.stage.dataset.playbackRate=String(speed);
    this.seek.max=String(clip.duration);this.seek.value=String(this.clipOffset);this.renderPlaybackToggle();
    if(!thumbnail)this.browser.position(clip,this.clipOffset);
    const playback=this.player;
    if(paused)playback?.pause();
    else void playback?.play().catch(error=>{if(current())this.showError(error);});
    if(!thumbnail){
     this.replayTimer=setInterval(()=>{void this.refillPlayback().catch(e=>this.showError(e));},250);
     this.armPlaybackFrameTimeout();
    }
   }
  }catch{
   loaded=false;
  }finally{
   if(epoch===this.epoch){this.operation=false;this.updateButtons();}
  }
  if(!loaded&&current()){
   if(thumbnail){this.replayResult='failed';this.switchingMedia=false;this.mediaGate.reset();}
   else this.finishReplay('未能继续播放存储卡录像，请重试。');
  }
 }
 private armPlaybackFrameTimeout():void{
  clearTimeout(this.modeTimer);this.modeTimer=undefined;
  if(!this.clip||this.player?.waitingForDecoder)return;
  const epoch=this.epoch,selection=this.clipSelection;
  this.modeTimer=setTimeout(()=>{
   this.modeTimer=undefined;
   if(epoch!==this.epoch||selection!==this.clipSelection||this.clipPaused||this.stage.dataset.videoState==='playing')return;
   this.finishReplay('未能取得存储卡录像画面，请重试。');
  },25000);
 }
 private renderPlaybackToggle():void{paintReplayPause(this.playbackPause,this.clipPaused);this.stage.dataset.playbackPaused=String(this.clipPaused);}
 private pausePlayback():void{if(!this.clip||this.clipPaused)return;this.clipPaused=true;this.replayBuffer.resetProgress();if(this.player)this.player.pause();else mediaView(this.video).pause();this.syncReplayAudio(true);this.renderPlaybackToggle();this.updateButtons();}
 private async togglePlayback():Promise<void>{
  if(this.cloudEvent){
   if(this.operation)return;
   const event=this.cloudEvent,epoch=this.epoch;
   await this.cloudControls.toggle();
   if(epoch===this.epoch&&event===this.cloudEvent)this.syncCloudSelection();
   return;
  }
  if(!this.clip||this.operation||this.recording)return;
  if(!this.clipPaused){this.pausePlayback();return;}
  if(this.replayResult||!this.player?.waitingForDecoder&&this.replayBuffer.needsRefill(mediaView(this.video),!!softwareSurface(this.video))){await this.selectClip(this.clip,this.replayResult==='ended'?0:this.replayPosition());return;}
  this.replayBuffer.resetProgress();this.clipPaused=false;
  this.renderPlaybackToggle();this.updateButtons();this.armPlaybackFrameTimeout();
  this.syncReplayAudio(false);
  const epoch=this.epoch,clip=this.clip,selection=this.clipSelection,intent=this.replayIntent;
  try{await (this.player??mediaView(this.video)).play();}
  catch(error){
   if(epoch===this.epoch&&clip===this.clip&&selection===this.clipSelection&&intent===this.replayIntent){
    this.pausePlayback();this.showError(error);
   }
  }
 }
 private captureClipThumbnail():void{const clip=this.clip;if(!clip||mediaView(this.video).readyState<2)return;const key=`${clip.channel}:${clip.start}`;if(this.thumbnailKey===key)return;try{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;canvas.getContext('2d')!.drawImage(mediaSource(this.video),0,0,320,180);this.browser.thumbnail(clip,canvas.toDataURL('image/jpeg',.7));this.thumbnailKey=key;if(this.previewFrame?.key===key)this.previewFrame.resolve();}catch{/* A failed cover stays retryable rather than using a different hour's frame. */}}
 private albumChanged(album:boolean):void{
  this.stage.dataset.cameraAlbum=String(album);this.stage.querySelector('.device-page-scroll')?.scrollTo(0,0);
  if(album){++this.clipSelection;this.albumRestore=this.pendingClip??this.albumRestore??(this.clip?{clip:this.clip,offset:this.replayPosition(),speed:this.playbackRate,paused:this.clipPaused}:undefined);this.albumRate=this.albumRestore?.speed??this.playbackRate;this.pausePlayback();this.audio.clearPlayback();}
  else{this.albumAbort?.abort();const restore=this.albumRestore;if(restore)void this.selectClip(restore.clip,restore.offset,restore.speed,restore.paused);}
 }
 private selectClip(clip:CameraClip,offset=0,speed=this.albumRate??this.playbackRate,paused=false):Promise<void>{
  const selection=++this.clipSelection,epoch=this.epoch,previous=this.clipTask,album=this.albumTask,playing=this.playbackTask;
  this.pendingClip={clip,offset,speed,paused};this.albumAbort?.abort();
  return this.clipTask=(async()=>{
   await album;await previous;await playing;
   if(selection!==this.clipSelection||epoch!==this.epoch)return;
   this.albumRate=undefined;this.replayRecoveryOffset=undefined;await this.playClip(clip,offset,speed,paused);
   if(selection===this.clipSelection&&epoch===this.epoch)this.albumRestore=this.pendingClip=undefined;
  })();
 }
 private loadAlbumThumbnails(clips:CameraClip[]):void{
  const previous=this.albumTask,foreground=this.clipTask;this.albumAbort?.abort();const abort=new AbortController();this.albumAbort=abort;const epoch=this.epoch;
  this.albumTask=(async()=>{await previous;await foreground;if(abort.signal.aborted||epoch!==this.epoch)return;
   for(const clip of clips){if(abort.signal.aborted||epoch!==this.epoch)break;if(this.browser.hasThumbnail(clip))continue;
    let finish!:()=>void,timeout:ReturnType<typeof setTimeout>|undefined;const frame=new Promise<void>(resolve=>finish=resolve);abort.signal.addEventListener('abort',finish,{once:true});
    const previewFrame={key:`${clip.channel}:${clip.start}`,resolve:finish};this.previewFrame=previewFrame;
    try{await this.playClip(clip,0,1,false,true);if(!abort.signal.aborted&&this.replayResult!=='failed'){timeout=setTimeout(finish,7000);await frame;}if(epoch===this.epoch)this.pausePlayback();}catch{/* Other hours can still have readable frames. */}
    finally{clearTimeout(timeout);abort.signal.removeEventListener('abort',finish);if(this.previewFrame===previewFrame)this.previewFrame=undefined;if(!abort.signal.aborted&&epoch===this.epoch&&!this.browser.hasThumbnail(clip))this.browser.thumbnailUnavailable(clip);}
   }
  })();
 }
 private async returnLive():Promise<void>{
  if(this.playbackTask&&!this.recordingPending){
   const pending=this.playbackTask,epoch=this.epoch;
   this.cancelPlaybackSelection();
   const selection=this.clipSelection;
   await pending;
   if(epoch!==this.epoch||selection!==this.clipSelection)return;
  }
  if(this.operation&&!this.cloudEvent||this.recordingPending)return;if(this.recording){await this.toggleRecord();if(this.recording||this.operation)return;}
  const leavingPlayback=!!this.clip||this.replayEmpty;
  ++this.careEpoch;this.showView('live');
  if(this.cloudEvent){this.cleanup();await this.start();return;}
  if(!leavingPlayback||!this.session){if(!this.busy)await this.start();return;}
  clearInterval(this.replayTimer);this.replayTimer=undefined;
  clearTimeout(this.modeTimer);this.modeTimer=undefined;
  this.replayResult=undefined;this.replayRecoveryOffset=undefined;
  this.operation=true;this.switchingMedia=true;this.mediaGate.begin();this.clip=undefined;this.clipPaused=false;this.playbackRate=1;this.primaryMediaKey=undefined;
  this.releaseDecoder();this.audio.clearPlayback();this.audio.setPlaybackBuffered(false);this.syncReplayAudio(false);this.setState('waiting-frame','正在返回实时画面…');
  const epoch=this.epoch,reply=await this.command({kind:'live'});if(epoch!==this.epoch)return;this.switchingMedia=false;this.operation=false;
  if(reply){this.secondary?.reset();this.renderRate();this.stage.dataset.videoMode='live';this.renderLenses();this.consumeEvents(this.mediaGate.commit(reply.streamRevision),epoch);}
  else this.fail('无法恢复实时画面，请重新连接摄像机。');this.updateButtons();
 }
}
