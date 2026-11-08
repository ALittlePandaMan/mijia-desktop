import {dismissCameraDatePicker} from './ui/camera-date-picker';
import {PropertyOperations} from './property-operations';
import type mpegts from 'mpegts.js';
import {nativeVideoPlayer,loadVideoEngine,nativeVideoSupported} from './native-video';
import {CameraFrameWatchdog} from './camera-frame-watchdog';
import {CameraLensPlayer,captureCameraLayout,captureCameraLens} from './camera-lens-player';
import {CameraMediaGate} from './camera-media-gate';
import {CameraReplayBuffer} from './camera-replay-buffer';
import {CameraFrameClock,type CameraRecordingPoint} from './camera-frame-clock';
import {primaryCameraLens,rememberCameraLens} from './camera-lens-preferences';
import{api}from './api';
import{button,element}from './ui/dom';
import{icon,officialIcon,type IconName}from './icons';
import{normalizeError,sameContext}from './logic';
import{capabilityProperty}from './device-capabilities';
import{booleanValue}from './panel-layout';
import{CameraAudio}from './camera-audio';
import{CameraBrowser,cameraDate}from './camera-browser';
import{CameraCare,type CareEvent}from './camera-care';
import{rememberCameraQuality,rememberedCameraQuality,cameraQualityOptions,cameraQualityLabel,cameraQualityButtonLabel,type CameraDecodedSize}from './camera-quality';
import{isCloudDoorbell}from './doorbell';
import type{Device,DeviceContext,DevicePanel,Property}from './types';
import type{CameraFeatures,CameraOperation,CameraClip,CameraPower,CameraAuxSnapshot,CameraEvent,SavedCameraMedia}from './camera-types';
export type CameraSource=Pick<typeof api,'cameraFeatures'|'startCamera'|'stopCamera'|'readCamera'|'cameraCommand'|'cameraMicrophone'|'cameraScreenshot'>&Partial<Pick<typeof api,'cameraPower'|'changeCameraPower'>>&{monitor?:boolean};
import './camera-player.css';
import {CloudVideoControls} from './ui/cloud-video-controls';
import {CameraLiveToolbar} from './ui/camera-live-toolbar';
import {cameraFillLightIcon} from './ui/camera-fill-light';
import {cameraStatusIcon} from './ui/camera-status-icons';
import {cameraOutlineIcon} from './ui/camera-outline-icons';
import {cameraSoundIcon} from './ui/camera-sound-icons';
export function cameraPageEligible(device:Device):boolean{return ['camera','video-doorbell','doorbell'].includes(device.specType?.split(':')[3]??'')||/\.(?:camera|cateye)\./.test(device.model);}
export interface CameraPageData{panel?:DevicePanel;loading?:boolean;cached?:boolean;busy?:boolean;error?:string;power?:(property:Property,value:boolean)=>Promise<void>}
const cameraGlyphs:Partial<Record<IconName,string>>={power:'power',microphone:'microphone',camera:'snapshot',video:'record',ptz:'ptz',volume:'sound','volume-off':'muted',fullscreen:'fullscreen',play:'playback'};
function cameraIcon(glyph:IconName):SVGSVGElement{if(glyph==='power'||glyph==='fullscreen')return cameraOutlineIcon(glyph);return cameraGlyphs[glyph]?officialIcon('camera:'+cameraGlyphs[glyph]):icon(glyph);}
function tool(label:string,glyph:IconName,run:()=>void):HTMLButtonElement{const b=button('','camera-icon-button',run);b.append(cameraIcon(glyph));b.title=label;b.setAttribute('aria-label',label);return b;}
/** One owner keeps video, overlays and audio alive across state polling. */
export class CameraPlayer{
 private frames=new CameraFrameWatchdog(()=>{if(this.browserView==='live'&&!this.clip&&!this.cloudEvent)this.failPrimary('此镜头暂未返回画面');});
 private model='';private lastPower?:boolean;private externalError?:string;
 readonly stage=element('div','device-stage');
 readonly video=document.createElement('video');private state=element('p','camera-state');private name=element('h2');
 private receiveRate=element('span','camera-receive-rate','0 KB/S');private nameBlock=element('div','camera-device-name',this.name,this.receiveRate);
 private viewport=element('div','camera-video-viewport');private overlay=element('div','camera-video-overlay');private dots=element('span','camera-connect-dots',element('i'),element('i'),element('i'));
 private lensDeck=element('div','camera-lens-deck');private secondary?:CameraLensPlayer;private selectedLens=0;private lensChoiceVersion=0;private lensPreferenceKey='';private monitorPresentation=false;
 private swap=button('','camera-lens-swap',()=>this.swapLens());private primaryFailed=false;
 private secondaryTools?:CameraLiveToolbar;
 private qualityFrame?:CameraDecodedSize;
 private liveActions=element('div','camera-live-actions');private outsideTools=element('div','camera-tool-actions');private controlsDual?:boolean;
 private recordingLens?:number;
 private recordingPending=0;private mediaGate=new CameraMediaGate();private primaryMediaKey?:string;private replayBuffer=new CameraReplayBuffer();private replayTimer?:ReturnType<typeof setInterval>;
 private frameClock=new CameraFrameClock();private lastRecordingPoint:CameraRecordingPoint={};
 private recordingBadge=element('div','camera-recording-status');private recordingSince=0;private recordingTimer?:ReturnType<typeof setInterval>;private savedRecordingId='';
 private auxiliary?:CameraAuxSnapshot;private auxiliaryBusy=false;private auxiliarySettling=false;
 private auxiliaryVersion=0;private qualityReturn?:HTMLButtonElement;
 private alarmButton=tool('警报','warning',()=>{void this.changeAuxiliary('alarm');});private lightButton=tool('补光灯','light',()=>{void this.changeAuxiliary('light');});
 private retry=button('重新连接','camera-retry',()=>{if(this.browserView==='playback')void this.openPlayback();else void this.start();});
 private powerButton=tool('休眠摄像机','power',()=>{void this.changePower();});private soundButton=tool('打开声音','volume-off',()=>{void this.toggleSound();});
 private wake=button('唤醒摄像机','camera-retry camera-wake',()=>{void this.changePower(true);});
 private powerSnapshot?:CameraPower;private powerTimer?:ReturnType<typeof setTimeout>;private powerEpoch=0;private powerActive=false;private powerReading=false;private powerChanging=false;private powerTarget?:boolean;private powerSettlingUntil=0;
 private qualityButton=button('高清','camera-icon-button camera-quality-button',()=>this.openQuality(this.qualityButton));
 private talkButton=tool('开始通话','microphone',()=>{void this.toggleTalk();});private shotButton=tool('截图','camera',()=>{void this.snapshot(this.dualLive()?0:undefined);});private recordButton=tool('开始录像','video',()=>{void this.toggleRecord(this.dualLive()?0:undefined);});private ptzButton=tool('云台控制','ptz',()=>{this.ptzPanel.hidden=!this.ptzPanel.hidden;this.ptzButton.setAttribute('aria-pressed',String(!this.ptzPanel.hidden));});
 private talkGlyph=element('span','camera-talk-glyph');private speaking=false;
 private secondaryShot=tool('截图','camera',()=>{if(this.secondary)void this.snapshot(this.secondary.lensId);});private secondaryRecord=tool('开始录像','video',()=>{if(this.secondary)void this.toggleRecord(this.secondary.lensId);});
 private fullscreenButton=tool('全屏','fullscreen',()=>this.toggleLensFullscreen(this.viewport));
 private replayShot=tool('回看截图','camera',()=>{void this.snapshot();});private replaySound=tool('打开声音','volume-off',()=>{void this.toggleSound();});
 private replayRecord=tool('开始回看录像','video',()=>{void this.toggleRecord();});
 private playbackRate=1;private rateButton=button('','camera-playback-rate',()=>{void this.cycleRate();});
 private playbackButton=button('回看','camera-playback-entry',()=>{void this.openPlayback();},'play');
 private careButton=button('看家助手','camera-care-entry camera-playback-entry',()=>{void this.openCare();},'shield');
 private qualityPanel=element('div','camera-quality-modal');private ptzPanel=element('div','camera-ptz-panel');private browser=new CameraBrowser((clip,offset)=>{void this.playClip(clip,offset);},album=>{this.stage.dataset.cameraAlbum=String(album);if(album)this.pausePlayback();this.stage.querySelector('.device-page-scroll')?.scrollTo(0,0);},()=>{this.pausePlayback();this.setState('stopped','此日期没有存储卡录像。');});private playbackPanel=this.browser.root;private care=new CameraCare(date=>{void this.openCare(date);},event=>{void this.playCare(event);});private carePanel=this.care.root;private careEpoch=0;private careDate='';private cloudEvent?:CareEvent;private cloudUrl?:string;
 private cloudControls=new CloudVideoControls(this.video,this.viewport,message=>{this.setMessage(message);},async()=>{if(this.context&&this.cloudEvent)return api.saveCloudVideo(this.context,this.careDate,this.cloudEvent.id);});
 private headerTitle=element('div','device-page-title');private browserView:'live'|'playback'|'care'='live';
 private diagnostic='';
 private clip?:CameraClip;private seek=element('input');private playbackPause=button('','camera-replay-pause',()=>{void this.togglePlayback();});private thumbnailKey='';
 private player:mpegts.Player|undefined;private context?:DeviceContext;private data:CameraPageData={};private features?:CameraFeatures;private session?:string;private epoch=0;private timer?:ReturnType<typeof setTimeout>;
 private qualityOps=new PropertyOperations((_key,value)=>this.submitQuality(String(value)),async()=>({outcome:'pending',message:'画质切换待确认'}),()=>{this.renderQuality();this.updateButtons();});
 private feed?:((buffer:ArrayBuffer)=>void);private bufferedVideo:ArrayBuffer[]=[];private bufferedVideoBytes=0;private frameRequest?:number;private busy=false;private online=false;private stopping?:Promise<void>;private starting?:Promise<string>;private autoAttempted=false;private operation=false;private listening=false;private talking=false;private recording=false;private audio=new CameraAudio();private quality='auto';private mounted=false;
 constructor(private back:()=>void,private source:CameraSource=api,private failed:()=>void=()=>{}){
  this.viewport.tabIndex=0;this.viewport.setAttribute('aria-label','摄像机视频及播放工具');
  this.receiveRate.title='当前视频会话的实际接收速率，双镜头合计，含音频和传输封装；不是带宽测速。';
  this.monitorPresentation=!!source.monitor;this.lensDeck.append(this.viewport);this.swap.hidden=true;this.swap.setAttribute('aria-label','切换主副镜头');for(const event of ['dblclick','pointerdown','click']as const)this.swap.addEventListener(event,e=>e.stopPropagation());
  this.alarmButton.replaceChildren(officialIcon('camera:alarm'));this.lightButton.replaceChildren(cameraFillLightIcon());this.alarmButton.hidden=this.lightButton.hidden=true;
  this.video.muted=true;this.video.autoplay=true;this.video.playsInline=true;this.video.setAttribute('aria-label','摄像机实时画面');
  this.retry.hidden=this.wake.hidden=true;this.overlay.append(this.dots,this.state,this.retry,this.wake);this.state.setAttribute('role','status');
  this.liveActions.append(this.powerButton,this.soundButton,this.qualityButton,this.fullscreenButton);this.viewport.append(this.video,this.overlay,this.liveActions);
  const page=element('section','device-page page-camera');page.dataset.presentationTemplate='camera';
  const backButton=tool('返回家庭','back',()=>{if(this.browser.closeAlbum())return;if(this.browserView!=='live'){void this.returnLive();}else this.back();});backButton.className='page-icon-button';
  this.talkGlyph.append(...this.talkButton.childNodes);this.talkButton.replaceChildren(this.talkGlyph);
  const tools=this.outsideTools;tools.append(this.talkButton,this.shotButton,this.recordButton,this.alarmButton,this.lightButton,this.ptzButton);
  this.playbackButton.querySelector('svg')?.replaceWith(cameraIcon('play'));this.careButton.querySelector('svg')?.replaceWith(officialIcon('camera:ai'));this.playbackButton.append(icon('chevron','camera-entry-arrow'));
  this.qualityPanel.hidden=this.ptzPanel.hidden=this.playbackPanel.hidden=this.carePanel.hidden=true;
  this.qualityPanel.addEventListener('click',e=>{if(e.target===this.qualityPanel)this.qualityPanel.hidden=true;});this.qualityPanel.addEventListener('keydown',e=>{if(e.key==='Escape'){this.qualityPanel.hidden=true;(this.qualityReturn??this.qualityButton).focus();}});
  const pad=element('div','camera-ptz-pad',officialIcon('camera:ptz-pad'));for(const[d,label]of[['up','向上'],['left','向左'],['right','向右'],['down','向下']]as const){const b=button('','camera-ptz-direction',()=>{b.setAttribute('aria-busy','true');b.classList.add('is-sending');this.setMessage('正在转动云台…');void this.command({kind:'ptz',direction:d}).finally(()=>{b.setAttribute('aria-busy','false');b.classList.remove('is-sending');});});b.dataset.direction=d;b.setAttribute('aria-label',label);pad.append(b);}
  this.ptzPanel.append(pad);
  this.seek.type='range';this.seek.hidden=true;this.seek.min='0';this.seek.step='1';this.seek.value='0';this.seek.setAttribute('aria-label','录像播放位置');this.seek.addEventListener('change',()=>{if(this.clip)void this.playClip(this.clip,Number(this.seek.value));});
  const replayRecord=this.replayRecord;
  this.replayShot.replaceChildren(officialIcon('camera:replay-snapshot'));replayRecord.replaceChildren(officialIcon('camera:replay-record'));
  const replayFullscreen=tool('回看全屏','fullscreen',()=>this.toggleLensFullscreen(this.viewport));
  const rate=this.rateButton;this.renderRate();
  this.renderPlaybackToggle();this.viewport.append(this.playbackPause,element('div','camera-playback-timeline',this.seek,element('div','camera-replay-actions',this.replayShot,replayRecord,rate,this.replaySound,replayFullscreen)));
  this.viewport.append(this.cloudControls.root,this.cloudControls.top);this.headerTitle.append(this.nameBlock);
  page.append(element('header','device-page-header',backButton,this.headerTitle),element('div','device-page-scroll device-controls-region',element('div','camera-live-card',this.lensDeck,tools),this.ptzPanel,element('div','camera-page-footer',this.playbackButton,this.careButton),this.playbackPanel,this.carePanel),this.qualityPanel);this.stage.append(page);
  this.video.addEventListener('loadedmetadata',()=>this.updateVideoAspect());
  this.video.addEventListener('error',()=>{if(this.busy)this.failPrimary('当前 Windows 视频解码器无法播放此镜头的编码。');});
  this.video.addEventListener('ended',()=>{if(this.cloudEvent){this.clipPaused=true;this.renderPlaybackToggle();this.care.select(this.cloudEvent.id,false);}});
  this.video.addEventListener('timeupdate',()=>{if(this.clip&&!this.seek.matches(':active')){const offset=Math.min(this.clip.duration,this.clipOffset+Math.max(0,this.video.currentTime-1));this.seek.value=String(offset);this.browser.position(this.clip,offset);}});
  this.updateButtons();
 }
 get primaryLensId():number{return this.selectedLens;}
 get qualityResolution():CameraDecodedSize|undefined{return this.resolutionForLens(this.selectedLens);}
 private resolutionForLens(lensId:number):CameraDecodedSize|undefined{
  if(this.clip||this.cloudEvent||this.stage.dataset.videoMode!=='live')return;
  if(lensId===0)return this.primaryFailed?undefined:this.qualityFrame;
  if(this.secondary?.lensId===lensId&&this.secondary.playing)return this.secondary.frames;
 }
 private get displayedQuality():string{const value=this.qualityOps.display('quality',this.quality).value;return typeof value==='string'?value:this.quality;}
 private updateQualityLabels():void{
  const label=cameraQualityButtonLabel(this.features?.qualities,this.displayedQuality),span=this.qualityButton.querySelector('span');
  if(span){if(span.textContent!==label)span.textContent=label;}else this.qualityButton.replaceChildren(element('span','',label));
  const title=`切换画质：${label}`;if(this.qualityButton.title!==title)this.qualityButton.title=title;if(this.qualityButton.getAttribute('aria-label')!==title)this.qualityButton.setAttribute('aria-label',title);
  if(!this.qualityPanel.hidden){
   const lens=this.qualityReturn&&this.secondaryTools?.root.contains(this.qualityReturn)?this.secondary?.lensId??0:0,selected=this.displayedQuality;
   for(const choice of this.qualityPanel.querySelectorAll<HTMLButtonElement>('[data-quality]')){const id=choice.dataset.quality!,text=cameraQualityLabel(this.features?.qualities,id,id===selected&&selected===this.quality?this.resolutionForLens(lens):undefined),reading=choice.querySelector('span');if(reading&&reading.textContent!==text)reading.textContent=text;}
  }
  this.secondaryTools?.sync();
 }
 get recordingPoint():CameraRecordingPoint{return this.pointForLens(this.recordingLens??this.selectedLens);}
 private videoForLens(id:number):HTMLVideoElement|undefined{return id===0?this.video:this.secondary?.lensId===id?this.secondary.video:undefined;}
 private pointForLens(id:number):CameraRecordingPoint{if(!this.clip&&this.secondary?.lensId===id)return this.secondary.recordingPoint;return this.video.readyState>=2?{...this.lastRecordingPoint,...this.frameClock.at(this.video.currentTime)}:this.lastRecordingPoint;}
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
 get primaryVideo():HTMLVideoElement{return this.secondary&&this.selectedLens===this.secondary.lensId?this.secondary.video:this.video;}
 get hasDecodedVideo():boolean{return this.video.readyState>=2||!!this.secondary?.playing;}
 private toggleLensFullscreen(viewport:HTMLElement):void{void(document.fullscreenElement===viewport?document.exitFullscreen():viewport.requestFullscreen()).catch(e=>this.showError(e));}
 private leaveLensFullscreen():void{const current=document.fullscreenElement;if(current&&(current===this.viewport||current===this.secondary?.viewport))void document.exitFullscreen().catch(()=>{});}
 screenshotPixels():string{return captureCameraLayout(this.lensDeck,this.secondary?[this.video,this.secondary.video]:[this.video]);}
 setMonitorPresentation(enabled:boolean):void{this.monitorPresentation=enabled;this.renderLenses();}
 holdRecordingChange():()=>void{const epoch=this.epoch;this.recordingPending++;this.updateButtons();let released=false;return()=>{if(released)return;released=true;if(epoch===this.epoch){this.recordingPending=Math.max(0,this.recordingPending-1);this.updateButtons();}};}
 private renderLenses():void{
  const dual=this.dualLive();this.arrangeControls(dual);
  this.lensDeck.dataset.dual=String(dual);this.lensDeck.dataset.layout=this.monitorPresentation?'pip':'stack';
  this.viewport.dataset.primary=String(!dual||this.selectedLens===0);
  const inset=this.selectedLens===0?this.secondary?.video:this.video;if(inset&&inset.videoWidth>0&&inset.videoHeight>0)this.lensDeck.style.setProperty('--inset-ratio',`${inset.videoWidth}/${inset.videoHeight}`);
  const width=this.lensDeck.clientWidth;this.lensDeck.style.setProperty('--camera-inset',width&&width<360?'4px':'8px');
  if(this.secondary){this.secondary.viewport.hidden=!dual;this.secondary.viewport.dataset.primary=String(this.selectedLens===this.secondary.lensId);}
  this.swap.hidden=!dual||!this.monitorPresentation;this.swap.disabled=this.recording||this.operation||this.recordingPending>0;
  this.lensDeck.dataset.primaryLens=String(this.selectedLens);
  const owner=this.recordingLens??this.selectedLens,target=!this.clip&&!this.cloudEvent&&this.secondary&&owner===this.secondary.lensId?this.secondary.viewport:this.viewport;
  if(this.recordingBadge.parentElement!==target)target.append(this.recordingBadge);
  this.recordingBadge.hidden=!this.recording;
 }
 private configureLenses():void{
  const lens=this.features?.lenses?.find(l=>l.id!==0);
  if(this.secondary?.lensId!==lens?.id){this.secondary?.dispose();this.secondary?.viewport.remove();this.secondary=undefined;
   this.secondaryTools=undefined;
   if(lens){this.secondary=new CameraLensPlayer(lens.id,()=>{this.updateQualityLabels();this.stage.dispatchEvent(new CustomEvent('camera-frame',{detail:{lensId:lens.id}}));},message=>{this.updateQualityLabels();this.setMessage(message);});this.secondary.video.setAttribute('aria-label',lens.label+'实时画面');this.secondary.viewport.tabIndex=0;this.secondary.viewport.setAttribute('aria-label',lens.label+'视频及播放工具');this.secondaryTools=new CameraLiveToolbar([
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
  if(!this.secondary||this.clip||this.cloudEvent){this.fail(message);return;}
  this.frames.reset();this.qualityFrame=undefined;this.primaryFailed=true;this.updateQualityLabels();this.setState('error',message);this.retry.hidden=true;
  this.stage.dispatchEvent(new CustomEvent('camera-lens-unavailable',{detail:{lensId:0}}));
 }
 unavailable(state:string):void{const message=state==='closed'?'摄像机休眠中':state==='offline'?'摄像机离线':'无法连接';this.qualityFrame=undefined;this.secondary?.unavailable(message);this.updateQualityLabels();this.setState(state==='error'?'error':'stopped',message);this.retry.disabled=state!=='error';}
 activatePower(active:boolean):void{if(this.powerActive===active)return;this.powerActive=active;++this.powerEpoch;this.powerReading=false;if(this.powerTimer)clearTimeout(this.powerTimer);this.powerTimer=undefined;if(active)void this.refreshPower();}
 private async refreshPower():Promise<void>{
  const context=this.context;if(!context||!this.powerActive||!this.stage.isConnected||isCloudDoorbell(this.model)||this.powerReading)return;
  const epoch=++this.powerEpoch;this.powerReading=true;
  try{const state=await(this.source.cameraPower??api.cameraPower)(context);if(epoch===this.powerEpoch&&sameContext(context,this.context)&&this.powerActive){if(!this.powerChanging)this.acceptPower(state);}if(this.powerActive&&epoch===this.powerEpoch&&!this.auxiliaryBusy){const version=this.auxiliaryVersion,auxiliary=await api.cameraAuxiliary(context);if(epoch===this.powerEpoch&&version===this.auxiliaryVersion&&!this.auxiliaryBusy&&sameContext(context,this.context)){this.auxiliary=auxiliary;this.auxiliarySettling=false;this.updateAuxiliary();}}}
  catch(error){if(epoch===this.powerEpoch&&!this.powerSnapshot)this.setMessage(normalizeError(error).message);}
  finally{if(epoch===this.powerEpoch){this.powerReading=false;if(this.powerActive&&this.stage.isConnected)this.powerTimer=setTimeout(()=>{this.powerTimer=undefined;void this.refreshPower();},5000);}}
 }
 private acceptPower(state:CameraPower):void{
  const previous=this.powerValue();this.powerSnapshot=state;
  if(this.powerSettlingUntil&&(state.awake===this.powerTarget||Date.now()>=this.powerSettlingUntil)){this.powerSettlingUntil=0;this.powerTarget=undefined;}
  if(state.awake===false){if(this.busy)this.stop();this.setState('stopped','摄像机休眠中');}
  else if(state.awake===true&&previous===false){this.autoAttempted=false;if(!this.source.monitor&&this.online&&!this.data.loading)void this.start();}
  this.updateButtons();
 }
 private updateAuxiliary():void{
  for(const kind of ['alarm','light']as const){
   const control=this.auxiliary?.[kind],b=kind==='alarm'?this.alarmButton:this.lightButton;
   b.hidden=!control?.supported;b.disabled=!control?.writable||control.active===null||!this.online||this.auxiliaryBusy||this.auxiliarySettling||this.powerValue()===false;
   b.setAttribute('aria-pressed',String(control?.active===true));b.setAttribute('aria-busy',String(this.auxiliaryBusy||this.auxiliarySettling));
   b.title=control?.reason??(kind==='alarm'?(control?.active?'停止警报':'启动警报'):(control?.active?'关闭补光灯':'打开补光灯'));b.setAttribute('aria-label',b.title);
  }
  this.outsideTools.style.setProperty('--camera-tools',String(isCloudDoorbell(this.model)?2:(this.dualLive()?3:4)+Number(!!this.auxiliary?.alarm.supported)+Number(!!this.auxiliary?.light.supported)));this.updateStatusIcons();
 }
 private updateStatusIcons():void{
  for(const [b,kind,active]of [[this.talkButton,'talk',this.talking],[this.lightButton,'light',this.auxiliary?.light.active===true],[this.alarmButton,'alarm',this.auxiliary?.alarm.active===true]]as const){
   const state=active?kind:'off';if(b.dataset.statusIcon===state)continue;b.dataset.statusIcon=state;
   const glyph=active?cameraStatusIcon(kind):kind==='light'?cameraFillLightIcon():officialIcon(kind==='talk'?'camera:microphone':'camera:alarm');
   if(kind==='talk')this.talkGlyph.replaceChildren(glyph);else b.replaceChildren(glyph);
  }
 }
 private updateTalkActivity():void{
  const speaking=this.talking&&this.audio.microphoneActive&&this.audio.microphoneSpeaking;
  if(speaking===this.speaking)return;this.speaking=speaking;this.talkButton.classList.toggle('is-speaking',speaking);
 }
 private renderSoundIcons():void{
  for(const [b,outside]of [[this.soundButton,this.dualLive()],[this.replaySound,false]]as const){
   const kind=this.listening?'sound':'muted',key=`${outside?'outside':'inside'}-${kind}`;
   if(b.dataset.soundIcon!==key){b.dataset.soundIcon=key;b.replaceChildren(cameraSoundIcon(this.listening,outside));}
   b.title=this.listening?'关闭声音':'打开声音';b.setAttribute('aria-label',b.title);b.setAttribute('aria-pressed',String(this.listening));
  }
 }
 private async changeAuxiliary(kind:'alarm'|'light'):Promise<void>{
  const context=this.context,control=this.auxiliary?.[kind];
  if(!context||!control?.writable||control.active===null||this.auxiliaryBusy||this.auxiliarySettling||!this.online||this.powerValue()===false)return;
  const version=++this.auxiliaryVersion,current=()=>version===this.auxiliaryVersion&&sameContext(context,this.context);
  this.auxiliaryBusy=true;this.updateAuxiliary();
  try{const result=await api.changeCameraAuxiliary(context,kind,!control.active,control.active);if(current()){this.auxiliary=result.report;this.auxiliarySettling=!result.confirmed;}}
  catch(e){if(current()){this.auxiliarySettling=true;this.showError(e);}}
  finally{if(current()){this.auxiliaryBusy=false;this.updateAuxiliary();}}
 }
 private openQuality(anchor:HTMLButtonElement):void{this.qualityReturn=anchor;this.renderQuality();this.qualityPanel.hidden=!this.qualityPanel.hidden;if(!this.qualityPanel.hidden)this.qualityPanel.querySelector<HTMLButtonElement>('[aria-checked=true]')?.focus();}
 get controls(){return {recording:this.recording,quality:this.quality,mode:this.cloudEvent?'cloud':this.clip?'playback':'live'};}
 syncControls(quality:string,recording:boolean,lensId?:number):void{const ownerChanged=recording&&lensId!==undefined&&this.recordingLens!==lensId;if(this.quality===quality&&this.recording===recording&&!ownerChanged)return;if(this.quality!==quality){this.quality=quality;this.renderQuality();}if(ownerChanged)this.recordingLens=lensId;this.setRecording(recording);}
 private recordingClock():string{const seconds=Math.floor(Math.max(0,performance.now()-this.recordingSince)/1000);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
 private updateRecordingBadge():void{this.recordingBadge.textContent=`正在录制 ${this.recordingClock()}`;this.recordingBadge.hidden=!this.recording;this.stage.dispatchEvent(new CustomEvent('camera-recording-state',{detail:{recording:this.recording,text:this.recordingBadge.textContent}}));}
 private setRecording(active:boolean,file?:SavedCameraMedia):void{
  if(active)this.recordingLens??=this.clip?.channel??this.selectedLens;
  else{this.recordingLens=undefined;}
  if(this.recording!==active){this.recording=active;if(this.recordingTimer)clearInterval(this.recordingTimer);this.recordingTimer=undefined;if(active){this.recordingSince=performance.now();this.recordingTimer=setInterval(()=>this.updateRecordingBadge(),1000);}const glyph=officialIcon(active?'camera:recording':'camera:replay-record');if(active)glyph.setAttribute('viewBox','4 4 24 24');this.replayRecord.replaceChildren(glyph);this.replayRecord.title=active?'结束录制':'开始回看录像';}
  this.updateRecordingBadge();this.updateButtons();
  if(file&&file.id!==this.savedRecordingId){this.savedRecordingId=file.id;this.showRecordingNotice(`录像已保存：${file.fileName}`,file);this.stage.dispatchEvent(new CustomEvent('camera-recording-saved',{detail:file}));}
 }
 private showRecordingNotice(message:string,_file?:SavedCameraMedia):void{this.setMessage(message);}
 async leaveDetail():Promise<void>{
  ++this.talkEpoch;this.audio.stopMicrophone();if(this.talking||this.talkPending)await this.endTalk();
  if(this.listening)await this.toggleSound();
  const deadline=performance.now()+30000;while(this.operation&&performance.now()<deadline)await new Promise(r=>setTimeout(r,25));
  if(this.clip||this.cloudEvent||this.browserView!=='live')await this.returnLive();
  this.ptzPanel.hidden=this.qualityPanel.hidden=true;
 }
 dismissPopup():boolean{if(dismissCameraDatePicker(this.stage))return true;if(!this.qualityPanel.hidden){this.qualityPanel.hidden=true;(this.qualityReturn??this.qualityButton).focus({preventScroll:true});return true;}if(!this.ptzPanel.hidden){this.ptzPanel.hidden=true;this.ptzButton.setAttribute('aria-pressed','false');this.ptzButton.focus({preventScroll:true});return true;}return false;}
 retryStream():void{this.autoAttempted=false;this.stop();}
 private switchingMedia=false;private modeTimer?:ReturnType<typeof setTimeout>;private mediaEpoch=0;private clipOffset=0;private clipPaused=false;private talkEpoch=0;private talkPending=false;
 private blur=()=>{if(this.talking||this.talkPending&&this.audio.microphoneActive){this.setMessage('窗口失去焦点，通话已结束。');void this.endTalk();}};
 update(context:DeviceContext,device:Device,data:CameraPageData={}):HTMLElement{
  // Overlap the feature download with independent panel/feature reads. No stream is opened here.
  if(!sameContext(this.context,context))void loadVideoEngine().catch(()=>{});
  const changed=!sameContext(this.context,context);if(changed){this.selectedLens=0;this.lensPreferenceKey='';++this.lensChoiceVersion;this.auxiliary=undefined;this.auxiliarySettling=false;this.auxiliaryBusy=false;++this.auxiliaryVersion;this.secondaryTools=undefined;this.qualityReturn=undefined;this.secondary?.dispose();this.secondary?.viewport.remove();this.secondary=undefined;this.activatePower(false);this.powerSnapshot=undefined;this.powerChanging=false;this.powerTarget=undefined;this.powerSettlingUntil=0;this.stop();this.care.clear();this.context={...context};this.model=device.model;this.browserView='live';this.thumbnailKey='';this.renderHeader();this.lastPower=undefined;this.externalError=undefined;this.features=undefined;this.autoAttempted=false;this.quality=this.source.monitor?'sd':rememberedCameraQuality(context,device.model);this.primaryMediaKey=undefined;this.switchingMedia=false;this.clip=undefined;this.renderLenses();this.playbackPanel.hidden=this.carePanel.hidden=this.ptzPanel.hidden=this.qualityPanel.hidden=true;this.setMessage('');
   const epoch=this.epoch;void this.source.cameraFeatures(context).then(features=>{if(epoch!==this.epoch||!sameContext(this.context,context))return;this.applyFeatures(features);}).catch(e=>{if(epoch===this.epoch)this.showError(e);});
  }
  if(!this.mounted){window.addEventListener('blur',this.blur);this.mounted=true;}
  this.data=data;this.online=device.online;this.name.textContent=device.name;
  const doorbell=isCloudDoorbell(this.model);if(changed)this.viewport.style.aspectRatio=doorbell?'4/3':'';this.stage.classList.toggle('doorbell-live',doorbell);this.stage.querySelector<HTMLElement>('.device-page')!.dataset.presentationTemplate=doorbell?'doorbell-live':'camera';
  for(const b of [this.powerButton,this.ptzButton,this.playbackButton,this.careButton,this.talkButton,this.qualityButton])b.hidden=doorbell;
  this.stage.querySelector<HTMLElement>('.camera-page-footer')!.hidden=doorbell;
  this.stage.querySelector<HTMLButtonElement>('.page-icon-button')!.setAttribute('aria-label',doorbell?'返回门铃':'返回家庭');if(doorbell)this.name.textContent='实时画面';
  if(data.error!==this.externalError){if(data.error)this.setMessage(data.error);else if(this.diagnostic===this.externalError)this.setMessage('');this.externalError=data.error;}
  const power=this.powerValue();if(this.lastPower===false&&power===true)this.autoAttempted=false;this.lastPower=power;if(!this.online||power===false){if(this.busy)this.stop();this.setState('stopped',!this.online?'摄像机离线':'摄像机休眠中');}
  if(!this.source.monitor&&!isCloudDoorbell(this.model))queueMicrotask(()=>{if(this.stage.isConnected&&sameContext(this.context,context))this.activatePower(true);});
  this.updateButtons();
  const guard=import.meta.env.DEV?(window as Window&{__MIJIA_UI_TEST_GUARD?:{allowCameraAutoplay?:boolean}}).__MIJIA_UI_TEST_GUARD:undefined;
  if(!this.autoAttempted&&!data.loading&&this.online&&power!==false&&(!guard||guard.allowCameraAutoplay||this.source.monitor)){this.autoAttempted=true;queueMicrotask(()=>{if(this.stage.isConnected&&sameContext(this.context,context))void this.start();});}
  return this.stage;
 }
 private powerProperty():Property|undefined{return isCloudDoorbell(this.model)?undefined:capabilityProperty(this.data.panel,'camera-control.on');}
 private powerValue():boolean|undefined{return this.powerSnapshot?this.powerSnapshot.awake??undefined:booleanValue(this.powerProperty());}
 private disabled(button:HTMLButtonElement,value:boolean,reason?:string):void{button.disabled=value;if(reason&&value)button.setAttribute('aria-description',reason);else button.removeAttribute('aria-description');}
 private updateMediaButtons(active:boolean):void{
  const dual=this.dualLive();
  for(const [record,shot,lensId]of [[this.recordButton,this.shotButton,0],[this.secondaryRecord,this.secondaryShot,this.secondary?.lensId]]as const){
   const recording=this.recording&&(!dual||lensId===this.recordingLens);
   const style=recording?'recording':dual?'outline':'solid';if(record.dataset.mediaIcon!==style){const glyph=recording?officialIcon('camera:recording'):dual?cameraOutlineIcon('record'):officialIcon('camera:record');if(recording)glyph.setAttribute('viewBox','4 4 24 24');record.replaceChildren(glyph);record.dataset.mediaIcon=style;}record.dataset.recording=String(recording);
   const shotStyle=dual?'outline':'solid';if(shot.dataset.mediaIcon!==shotStyle){shot.replaceChildren(dual?cameraOutlineIcon('snapshot'):officialIcon('camera:snapshot'));shot.dataset.mediaIcon=shotStyle;}
   record.title=recording?'结束录像':'开始录像';record.setAttribute('aria-label',record.title);record.setAttribute('aria-pressed',String(recording));
   if(dual&&lensId!==undefined){const ready=(this.videoForLens(lensId)?.readyState??0)>=2,other=this.recording&&!recording;
    this.disabled(shot,!active||!ready||this.operation,'等待此镜头画面后可截图。');
    this.disabled(record,!active||this.operation||this.recordingPending>0||other||!this.recording&&!ready,other?'另一镜头正在录像，请先结束该录像。':'等待此镜头画面后可录像。');
   }
  }
 }
 private updateButtons():void{
  const active=!!this.session&&this.busy&&!this.stopping,reason=this.features?.reason??(this.features?'此型号未提供已核实的此项能力。':'正在读取此型号的视频能力。'),power=this.powerValue();
  const powerAllowed=!!this.data.power||!!this.powerSnapshot?.writable,powerDisabled=!this.online||!powerAllowed||power===undefined||this.operation||this.powerChanging||this.powerSettlingUntil>Date.now();
  this.disabled(this.powerButton,powerDisabled,this.powerSnapshot?.reason??'休眠状态尚未确认，或此设备仅有读取权限。');this.powerButton.setAttribute('aria-label',power===false?'唤醒摄像机':'休眠摄像机');this.powerButton.title=this.powerButton.getAttribute('aria-label')!;this.powerButton.setAttribute('aria-pressed',String(power===true));this.powerButton.setAttribute('aria-busy',String(this.powerChanging||this.powerSettlingUntil>Date.now()));
  this.wake.hidden=power!==false;this.wake.disabled=powerDisabled;
  this.disabled(this.soundButton,!this.cloudEvent&&(!active||!this.features?.listen),reason);this.disabled(this.qualityButton,!active||!this.features?.qualities.length||this.recording||!!this.clip,reason);
  this.disabled(this.talkButton,!active||!this.features?.talk||!!this.clip||this.operation&&!this.talkPending&&!this.talking,reason);this.disabled(this.shotButton,!active||!this.hasDecodedVideo||this.operation,'等待视频画面后可截图。');this.disabled(this.recordButton,!active||this.operation||this.recordingPending>0||(!this.recording&&(this.primaryVideo.readyState<2||!!this.clip)),'等待实时画面后可录像。');this.disabled(this.ptzButton,!active||!this.features?.ptz||!!this.clip,reason);this.disabled(this.playbackButton,!active||!this.features?.playback||this.recording||this.talking||this.talkPending,reason);
  this.disabled(this.careButton,!this.context||this.recording||this.talking||this.features?.care===false,'此型号尚未提供已核实的事件接口，或请先结束录像和通话。');
  this.disabled(this.replayShot,!active||this.video.readyState<2||this.operation,'等待回看画面后可截图。');this.disabled(this.replaySound,!active||!this.features?.listen,reason);
  this.disabled(this.replayRecord,!active||!this.clip||this.operation||this.recordingPending>0||(!this.recording&&(this.video.readyState<2||this.clipPaused)),'继续播放后可录制回看片段。');this.replayRecord.setAttribute('aria-label',this.recording?'结束回看录像':'开始回看录像');this.replayRecord.setAttribute('aria-pressed',String(this.recording));
  this.playbackPanel.inert=this.recording;
  this.rateButton.disabled=!active||!this.clip||this.operation||this.recording;this.replaySound.disabled=this.replaySound.disabled||this.playbackRate!==1;
  this.disabled(this.playbackPause,(!active||!this.clip)&&!this.cloudEvent||this.video.readyState<2||this.operation||this.recording);this.stage.dataset.playbackPaused=String(this.clipPaused);
  this.talkButton.setAttribute('aria-pressed',String(this.talking));this.talkButton.setAttribute('aria-label',this.talkPending?'正在建立通话，点击取消':this.talking?'结束通话':'开始通话');this.talkButton.title=this.talkButton.getAttribute('aria-label')!;this.talkButton.dataset.pending=String(this.talkPending);
  this.updateTalkActivity();this.renderLenses();this.updateAuxiliary();this.updateMediaButtons(active);
  this.retry.disabled=!!this.stopping||!this.online;
  this.updateQualityLabels();
 }
 private setState(state:string,message:string):void{this.stage.dataset.videoState=state;this.state.textContent=['connecting','waiting-frame'].includes(state)||message==='已停止'?'':message;this.overlay.setAttribute('aria-label',message);this.overlay.hidden=state==='playing';this.dots.hidden=!['connecting','waiting-frame'].includes(state);this.retry.hidden=!['error','stopped'].includes(state)||this.powerValue()===false||!this.online;}
 private setMessage(message:string):void{this.diagnostic=message;this.stage.setAttribute('aria-description',message);}
 private showError(error:unknown):void{const issue=normalizeError(error);if(issue.kind==='cameraOperationRejected')return;this.setMessage(issue.message);}
 private cleanup():void{
  this.receiveRate.textContent='0 KB/S';this.qualityFrame=undefined;
  this.frames.reset();this.secondary?.reset();this.primaryFailed=false;this.frameClock.reset();this.lastRecordingPoint={};this.mediaGate.reset();this.primaryMediaKey=undefined;this.replayBuffer.reset();this.recordingPending=0;if(this.replayTimer)clearInterval(this.replayTimer);this.replayTimer=undefined;
  this.qualityOps.reset();
  ++this.epoch;++this.mediaEpoch;if(this.modeTimer)clearTimeout(this.modeTimer);this.modeTimer=undefined;if(this.timer)clearTimeout(this.timer);this.timer=undefined;if(this.frameRequest!==undefined)this.video.cancelVideoFrameCallback(this.frameRequest);this.frameRequest=undefined;
  this.audio.dispose();++this.talkEpoch;this.talkPending=false;this.clipPaused=false;this.cloudEvent=undefined;this.video.muted=true;if(this.cloudUrl){URL.revokeObjectURL(this.cloudUrl);this.cloudUrl=undefined;}this.video.controls=false;this.talking=this.listening=false;this.setRecording(false);this.playbackRate=1;this.video.playbackRate=1;this.renderRate();delete this.stage.dataset.playbackRate;this.renderSoundIcons();this.stage.dataset.audioFrames='0';delete this.stage.dataset.audioCodec;
  const session=this.session,context=this.context;this.session=undefined;this.feed=undefined;this.bufferedVideo=[];this.bufferedVideoBytes=0;
  const closing=context?(session?this.source.stopCamera(context,session):this.starting?.then(id=>this.source.stopCamera(context,id))):undefined;
  if(closing){this.stopping=closing;void closing.then(()=>{if(this.stopping===closing){this.stopping=undefined;this.updateButtons();}},()=>{if(this.stopping===closing){this.stopping=undefined;this.updateButtons();}});}
  if(this.player){this.player.pause();this.player.unload();this.player.detachMediaElement();this.player.destroy();this.player=undefined;}this.video.removeAttribute('src');this.video.load();this.busy=false;this.operation=false;this.updateButtons();
 }
 stop():void{++this.careEpoch;this.cleanup();this.setState('stopped','已停止');}
 dispose():void{this.leaveLensFullscreen();this.activatePower(false);this.stop();this.secondary?.dispose();this.secondary?.viewport.remove();this.secondary=undefined;this.secondaryTools=undefined;this.qualityReturn=undefined;++this.auxiliaryVersion;this.auxiliaryBusy=false;this.care.clear();this.context=undefined;this.autoAttempted=false;window.removeEventListener('blur',this.blur);this.mounted=false;}
 private fail(message:string):void{this.cleanup();this.setState('error',message);this.failed();}
 private attachPlayer(epoch:number):void{
  this.frames.reset();this.qualityFrame=undefined;this.updateQualityLabels();this.replayBuffer.reset();this.frameClock.reset();
  const media=++this.mediaEpoch;if(this.player){this.player.pause();this.player.unload();this.player.detachMediaElement();this.player.destroy();this.player=undefined;}
  this.feed=undefined;this.bufferedVideo=[];this.bufferedVideoBytes=0;this.video.autoplay=!this.clip;this.video.playbackRate=this.clip?this.playbackRate:1;this.player=nativeVideoPlayer(this.video,feed=>{if(media!==this.mediaEpoch)return()=>{};this.feed=feed;const pending=this.bufferedVideo;this.bufferedVideo=[];this.bufferedVideoBytes=0;for(const buffer of pending)feed(buffer);return()=>{if(media===this.mediaEpoch)this.feed=undefined;};},()=>{if(epoch===this.epoch&&media===this.mediaEpoch)this.failPrimary('此镜头的视频格式或解码不受当前环境支持。');},!this.clip);
 }
 private async start():Promise<void>{
  if(!this.context||this.busy||!this.online||this.powerValue()===false)return;if(this.stopping){try{await this.stopping;}catch{return;}if(!this.context||this.busy)return;}
  this.cleanup();this.primaryMediaKey=undefined;this.switchingMedia=false;this.clip=undefined;this.renderLenses();this.stage.dataset.videoMode='live';delete this.stage.dataset.cameraBrowser;this.playbackPanel.hidden=true;const context={...this.context},epoch=this.epoch;
  // Feature discovery is independent of the stream-open generation.
  if(!this.features)void this.source.cameraFeatures(context).then(features=>{if(epoch===this.epoch&&sameContext(context,this.context)){this.applyFeatures(features);}}).catch(e=>{if(epoch===this.epoch&&sameContext(context,this.context))this.showError(e);});
  this.busy=true;this.updateButtons();this.setState('connecting','正在连接摄像机…');this.stage.dataset.decodedFrames='0';
  try{
   await loadVideoEngine();if(epoch!==this.epoch||!sameContext(context,this.context))return;
   if(!nativeVideoSupported())throw Error('当前系统视频组件 不支持 MediaSource 视频播放。');
   if(!this.source.monitor)this.attachPlayer(epoch);
   const opening=this.source.startCamera(context,this.quality);this.starting=opening;const session=await opening;if(this.starting===opening)this.starting=undefined;
   if(epoch!==this.epoch){if(!this.stopping)void this.source.stopCamera(context,session).catch(()=>{});return;}this.session=session;this.updateButtons();this.watchFrames(epoch);void Promise.resolve(this.player?.play()).catch(()=>{});void this.poll(context,session,epoch);
  }catch(error){this.starting=undefined;if(epoch===this.epoch)this.fail(normalizeError(error).message);}
 }
 private updateVideoAspect():void{if(this.video.videoWidth>0&&this.video.videoHeight>0)this.viewport.style.aspectRatio=`${this.video.videoWidth}/${this.video.videoHeight}`;}
 private watchFrames(epoch:number):void{this.frameRequest=this.video.requestVideoFrameCallback((_time,metadata)=>{if(epoch!==this.epoch)return;this.primaryFailed=false;this.qualityFrame={width:metadata.width,height:metadata.height};this.lastRecordingPoint=this.frameClock.at(this.video.currentTime);this.frames.frame();this.stage.dispatchEvent(new CustomEvent('camera-frame',{detail:{lensId:0}}));this.stage.dataset.decodedFrames=String(metadata.presentedFrames);this.stage.dataset.videoWidth=String(this.video.videoWidth);this.stage.dataset.videoHeight=String(this.video.videoHeight);this.updateVideoAspect();if(!this.switchingMedia&&(this.browserView==='live'||this.browserView==='care'||!!this.clip||!!this.cloudEvent)){if(this.modeTimer)clearTimeout(this.modeTimer);this.modeTimer=undefined;this.setState('playing',this.cloudEvent?'云端录像':this.clip?'存储卡回看':'实时画面');if(this.cloudEvent)this.care.select(this.cloudEvent.id,!this.clipPaused&&!this.video.paused);this.captureClipThumbnail();}this.updateButtons();this.watchFrames(epoch);});}
 private consumeEvents(events:CameraEvent[],epoch:number):void{
  for(const event of events){
   if(event.state==='throughput'){const bytes=event.receiveBytesPerSecond;if(bytes!==undefined&&Number.isFinite(bytes)&&bytes>=0){const rate=bytes/1024;this.receiveRate.textContent=`${rate>=10?Math.round(rate):Number(rate.toFixed(1))} KB/S`;}continue;}
   if(event.state==='talk-stopped'){if(this.talking&&!this.talkPending){++this.talkEpoch;this.audio.stopMicrophone();this.talking=false;this.setMessage('摄像头已结束通话，请重新开启。');this.updateButtons();}continue;}
   const media=['media','audio','lens-unavailable'].includes(event.state);
   if(media){if(this.mediaGate.transitioning){this.mediaGate.hold(event);continue;}if(!this.mediaGate.accept(event))continue;}
   const lens=event.lensId??0,other=this.secondary&&lens===this.secondary.lensId;
   if(event.state==='lens-unavailable'){if(!this.clip&&!this.cloudEvent){if(other)this.secondary?.unavailable(event.error?.message??'此镜头暂时没有画面');else if(lens===0)this.failPrimary(event.error?.message??'此镜头暂时没有画面');this.updateQualityLabels();}continue;}
   if(event.state==='recording'){this.setRecording(true);continue;}if(event.state==='recording-stopped'){this.setRecording(false);continue;}
   if(event.error){if(event.state==='operation-error'){if(event.file||['recordingCodecChanged','recordingLimit','mediaSaveFailed','recordingEmpty'].includes(event.error.kind)){this.setRecording(false,event.file);this.showRecordingNotice(event.error.message,event.file);}this.showError(event.error);this.updateButtons();continue;}this.fail(event.error.message);return;}
   if(event.state==='stopped'){this.stop();return;}
   if(event.state==='waiting-frame')this.setState('waiting-frame','等待首帧…');
   if(event.file)this.setRecording(false,event.file);
   if(!event.data||this.cloudEvent)continue;
   if(event.state==='audio'){if(this.clip&&this.replayBuffer.halted)continue;this.stage.dataset.audioCodec=event.codec;if(this.listening)this.audio.receive(event,m=>this.setMessage(m));this.stage.dataset.audioFrames=String(this.audio.decoded);continue;}
   if(event.state!=='media')continue;
   // A list or album can be open while the device is still sending live video.
   if(!this.clip){if(other){const playing=this.secondary?.playing;this.secondary?.feed(event);if(playing&&!this.secondary?.playing)this.updateQualityLabels();continue;}if(lens!==0)continue;}
   else if(event.lensId!==undefined&&lens!==this.clip.channel)continue;
   const key=this.mediaGate.decoderKey(event);
   if(key!==this.primaryMediaKey){this.primaryMediaKey=key;this.primaryFailed=false;this.attachPlayer(epoch);this.audio.clearPlayback();if(!this.clip||!this.clipPaused&&!this.operation)void this.video.play().catch(()=>{});}
   if(this.primaryFailed)this.primaryFailed=false;if(!this.player)this.attachPlayer(epoch);
   if(this.clip&&!this.replayBuffer.append(event,this.video.currentTime))continue;
   this.frameClock.observe(event,this.video.currentTime,!!this.clip);this.stage.dataset.videoCodec=event.codec;if(!this.clip)this.frames.data();
   const bytes=Uint8Array.from(atob(event.data),c=>c.charCodeAt(0));if(this.feed)this.feed(bytes.buffer);else if(this.bufferedVideoBytes+bytes.byteLength<=4*1024*1024){this.bufferedVideo.push(bytes.buffer);this.bufferedVideoBytes+=bytes.byteLength;}
  }
 }
 private async poll(context:DeviceContext,session:string,epoch:number):Promise<void>{
  try{const events=await this.source.readCamera(context,session);if(epoch!==this.epoch)return;this.consumeEvents(events,epoch);if(epoch===this.epoch)this.timer=setTimeout(()=>{void this.poll(context,session,epoch);},40);}
  catch(error){if(epoch===this.epoch)this.fail(normalizeError(error).message);}
 }
 private async command(operation:CameraOperation,propagate=false,clearMessage=true){if(!this.context||!this.session)return;const context={...this.context},session=this.session;try{const reply=await this.source.cameraCommand(context,session,operation);if(!sameContext(context,this.context)||session!==this.session)return;if(clearMessage&&!this.data.error)this.setMessage('');if(reply.features){this.applyFeatures(reply.features);}return reply;}catch(error){if(sameContext(context,this.context))this.showError(error);if(propagate)throw error;}}
 private async changePower(desired?:boolean):Promise<void>{
  const value=this.powerValue(),context=this.context;if(value===undefined||!context||this.powerChanging||this.powerSettlingUntil>Date.now())return;
  const awake=desired??!value;if(awake===value)return;this.powerChanging=true;this.powerTarget=awake;this.updateButtons();
  try{const property=this.powerProperty();if(this.data.power&&property){await this.data.power(property,awake);}else{
    const result=await(this.source.changeCameraPower??api.changeCameraPower)(context,awake,value);if(!sameContext(context,this.context))return;
    if(result.confirmed)this.acceptPower(result.report);else this.powerSettlingUntil=Date.now()+15000;
  }}catch(e){if(sameContext(context,this.context))this.showError(e);}
  finally{if(sameContext(context,this.context)){this.powerChanging=false;this.updateButtons();if(this.powerTimer)clearTimeout(this.powerTimer);this.powerTimer=undefined;void this.refreshPower();}}
 }
 private async toggleSound():Promise<void>{const enabled=!this.listening;if(this.cloudEvent){this.video.muted=!enabled;this.listening=enabled;this.renderSoundIcons();return;}try{await this.audio.listen(enabled);if(enabled&&this.clipPaused)await this.audio.pausePlayback();const result=await this.command({kind:'listen',enabled});if(!result){this.audio.closeListening();return;}this.listening=enabled;this.renderSoundIcons();}catch(e){this.audio.closeListening();this.showError(e);}finally{this.secondaryTools?.sync();}}
 private async toggleTalk():Promise<void>{
  if(this.talking||this.talkPending){await this.endTalk();return;}if(!this.context||!this.session||!this.features?.talkFormat)return;
  const context={...this.context},session=this.session,attempt=++this.talkEpoch,current=()=>attempt===this.talkEpoch&&sameContext(context,this.context)&&session===this.session;
  let requested=false;this.talkPending=true;this.operation=true;this.setMessage('正在申请麦克风权限并准备音频…');this.updateButtons();
  try{
   await this.audio.startMicrophone(this.features.talkFormat.sampleRate,packet=>current()&&this.talking?this.source.cameraMicrophone(context,session,packet):Promise.resolve(),message=>{if(current()){this.setMessage(message);if(requested)void this.endTalk();}},this.features.talkFormat.codec,()=>{if(current())this.updateTalkActivity();});
   if(!current())return;if(!this.audio.microphoneActive)throw Error('麦克风未能启动，请检查录音设备和权限。');
   this.setMessage('正在等待摄像头确认通话…');requested=true;const reply=await this.command({kind:'talk',enabled:true},true);
   if(!current())return;if(reply?.state!=='talking')throw Error('摄像头未建立通话，请重试。');this.talking=true;this.setMessage('通话中');
  }catch(error){if(current()){this.audio.stopMicrophone();this.talking=false;this.setMessage(normalizeError(error).message);if(requested)await this.command({kind:'talk',enabled:false},false,false);}}
  finally{if(current()){this.talkPending=false;this.operation=false;this.updateButtons();}}
 }
 private async endTalk():Promise<void>{++this.talkEpoch;if(this.talkPending)this.operation=false;this.talkPending=false;this.audio.stopMicrophone();this.talking=false;if(/^(通话中|正在申请麦克风|正在等待摄像头确认通话)/.test(this.diagnostic))this.setMessage('');this.updateButtons();await this.command({kind:'talk',enabled:false},false,false);}
 private async snapshot(lensId?:number):Promise<void>{
  const video=lensId===undefined?undefined:this.videoForLens(lensId);
  if(!this.context||!this.session||this.operation||(lensId===undefined?!this.hasDecodedVideo:!video||video.readyState<2))return;
  const context={...this.context},session=this.session;this.operation=true;this.updateButtons();
  try{const file=await this.source.cameraScreenshot(context,session,video?captureCameraLens(video):this.screenshotPixels());if(file&&sameContext(context,this.context)&&session===this.session)this.setMessage(`截图已保存：${file.fileName}`);}
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
   try{while(epoch===this.epoch&&this.video.readyState<2&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));}
   finally{release();}
   if(epoch!==this.epoch||this.clip!==clip||this.video.readyState<2||this.clipPaused){this.showRecordingNotice('尚未取得可录制的1倍回看画面。');return;}
  }
  const enabled=!this.recording,lensId=enabled?(this.clip?.channel??requestedLens??this.selectedLens):(this.recordingLens??this.selectedLens),video=this.clip?this.video:this.videoForLens(lensId);
  if(!this.context||!this.session||!video||enabled&&video.readyState<2)return;
  const context=this.context,session=this.session,point=this.pointForLens(lensId);if(enabled){this.recordingLens=lensId;}this.operation=true;this.updateButtons();
  if(!enabled)this.showRecordingNotice('正在保存录像…');
  try{const reply=await this.command(enabled?{kind:'record',enabled:true,width:video.videoWidth,height:video.videoHeight,lensId,...point}:{kind:'record',enabled:false,...point},true);if(reply&&reply.state!=='cancelled')this.setRecording(reply.state==='recording',reply.file);}
  catch(error){if(sameContext(context,this.context))this.showRecordingNotice(normalizeError(error).message);}
  finally{if(sameContext(context,this.context)&&session===this.session){if(!this.recording)this.recordingLens=undefined;this.operation=false;this.updateButtons();}}
 }
 applyFeatures(features:CameraFeatures):void{if(JSON.stringify(this.features)===JSON.stringify(features))return;if(!features.talk&&(this.talking||this.talkPending))void this.endTalk();this.features=features;this.configureLenses();if(!features.qualities.some(q=>q.id===this.quality))this.quality='auto';this.renderQuality();this.updateButtons();}
 private renderQuality():void{
  const selected=this.displayedQuality;
  this.qualityButton.setAttribute('aria-busy',String(this.qualityOps.pendingCount>0));
  const options=element('div','camera-quality-options');options.setAttribute('role','radiogroup');
  const lens=this.qualityReturn&&this.secondaryTools?.root.contains(this.qualityReturn)?this.secondary?.lensId??0:0;
  for(const q of cameraQualityOptions(this.features?.qualities,selected===this.quality?this.resolutionForLens(lens):undefined,selected)){
   const b=button('','',()=>{if(q.available)void this.changeQuality(q.id);});b.append(element('span','',q.label));
   b.disabled=!q.available;b.dataset.quality=q.id;b.dataset.qualityMode=q.mode;
   b.setAttribute('role','radio');b.setAttribute('aria-checked',String(q.available&&q.id===selected));b.setAttribute('aria-pressed',String(q.available&&q.id===selected));
   b.append(officialIcon('camera:selected'));options.append(b);
  }
  const dialog=element('div','camera-quality-dialog',element('h3','','视频画质选择'),options);
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','视频画质选择');
  this.qualityPanel.replaceChildren(dialog);
  this.updateQualityLabels();
 }
 private async changeQuality(quality:string):Promise<void>{if(this.operation&&!this.qualityOps.pendingCount||!this.session||!this.features?.qualities.some(q=>q.id===quality))return;this.qualityPanel.hidden=true;this.setMessage('正在切换画质…');this.qualityOps.write('quality',quality,this.quality);}
 private async submitQuality(quality:string){const context=this.context,session=this.session,epoch=this.epoch;if(!context||!session)throw{kind:'staleContext',message:'视频会话已关闭。'};this.operation=true;this.updateButtons();try{const reply=await this.command({kind:'quality',quality},true);if(epoch!==this.epoch||session!==this.session||!sameContext(context,this.context)||!reply)throw{kind:'staleContext',message:'视频会话已改变。'};this.quality=quality;if(!this.source.monitor)rememberCameraQuality(context,this.model,quality);this.setState('waiting-frame','正在切换画质…');void this.video.play().catch(()=>{});return{outcome:'confirmed' as const,actual:quality,message:'画质设置已接受，正在等待画面'};}catch(error){if(!this.source.monitor&&normalizeError(error).kind==='cameraQualityUncertain'&&sameContext(context,this.context)){this.cleanup();this.quality=quality;this.renderQuality();await this.start();if(this.session)rememberCameraQuality(context,this.model,quality);return {outcome:'confirmed' as const,actual:quality,message:''};}throw error;}finally{if(epoch===this.epoch&&session===this.session){this.operation=false;this.updateButtons();}}}

 private renderHeader():void{this.renderLenses();this.stage.dataset.cameraView=this.browserView;if(this.browserView==='live'){delete this.stage.dataset.cameraBrowser;delete this.stage.dataset.cameraAlbum;if(this.nameBlock.parentElement!==this.headerTitle)this.headerTitle.replaceChildren(this.nameBlock);}else{this.stage.dataset.cameraBrowser='true';this.headerTitle.replaceChildren(element('span','',this.browserView==='playback'?'microSD卡':'看家助手'));}}
 private async openPlayback():Promise<void>{if(isCloudDoorbell(this.model))return;const attempt=++this.careEpoch;this.browserView='playback';this.renderHeader();this.carePanel.hidden=true;this.playbackPanel.hidden=false;this.ptzPanel.hidden=this.qualityPanel.hidden=true;this.stage.querySelector('.device-page-scroll')?.scrollTo(0,0);this.browser.loading();this.setState('waiting-frame','正在读取存储卡录像…');const reply=await this.command({kind:'recordings'});if(attempt!==this.careEpoch||this.browserView!=='playback')return;if(reply?.clips){this.browser.update(reply.clips);const today=cameraDate(Date.now()/1000),latest=this.browser.latestClip(today);if(latest)void this.playClip(latest,Math.max(0,latest.duration-30));else this.setState('stopped','此日期没有存储卡录像。');}else{this.browser.failure();this.setState('error','存储卡录像读取失败。');}}
 private async openCare(date=cameraDate(Date.now()/1000)):Promise<void>{
  if(!this.context)return;
  if(this.browserView!=='care'&&this.clip)await this.returnLive();
  const context={...this.context},attempt=++this.careEpoch;this.careDate=date;this.browserView='care';this.renderHeader();delete this.stage.dataset.cameraAlbum;this.playbackPanel.hidden=this.ptzPanel.hidden=this.qualityPanel.hidden=true;this.carePanel.hidden=false;
  this.care.loading(context,date);this.stage.querySelector('.device-page-scroll')?.scrollTo(0,0);
  try{const result=await api.cameraCare(context,date);if(attempt!==this.careEpoch||!sameContext(context,this.context))return;this.care.update(result);}
  catch(error){if(attempt===this.careEpoch&&sameContext(context,this.context))this.care.failure(normalizeError(error).message);}
 }
 private async playCare(event:CareEvent):Promise<void>{
  if(!this.context||this.operation||!event.playbackAvailable)return;
  if(this.cloudEvent?.id===event.id){await this.togglePlayback();return;}
  const context={...this.context},date=this.careDate,attempt=this.careEpoch;
  this.cleanup();this.cloudEvent=event;this.clip=undefined;this.operation=true;this.busy=true;this.stage.dataset.videoMode='cloud';this.renderPlaybackToggle();this.setState('waiting-frame','正在读取云端录像…');this.care.select(event.id,false);this.updateButtons();
  const epoch=this.epoch;
  try{const report=await api.cameraCareVideo(context,date,event.id);if(attempt!==this.careEpoch||epoch!==this.epoch||!sameContext(context,this.context)||this.browserView!=='care')return;
   const bytes=Uint8Array.from(atob(report.data),c=>c.charCodeAt(0));
   this.cloudUrl=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));this.video.playbackRate=1;this.video.src=this.cloudUrl;this.video.load();this.watchFrames(epoch);this.operation=false;this.updateButtons();await this.video.play();
  }catch(error){if(epoch===this.epoch&&sameContext(context,this.context)){this.operation=false;this.fail(normalizeError(error).message);}}
 }
 private renderRate():void{this.rateButton.replaceChildren(element('span','camera-rate-label',`${this.playbackRate}×`));this.rateButton.title=`回看速度：${this.playbackRate}倍`;this.rateButton.setAttribute('aria-label',`回看速度：${this.playbackRate}倍`);}
 private replayPosition():number{return this.clip?Math.max(0,Math.min(this.clip.duration-1,this.clipOffset+Math.max(0,this.video.currentTime-1))):0;}
 private async cycleRate():Promise<void>{if(!this.clip||this.operation||this.recording)return;const rates=[.5,1,2,4],next=rates[(rates.indexOf(this.playbackRate)+1)%rates.length];await this.playClip(this.clip,this.replayPosition(),next,this.clipPaused);}
 private async bufferPlayback(speed:number,epoch:number,remaining:number):Promise<void>{
  if(speed===1)return;this.video.pause();const target=Math.min(speed*1.5,Math.max(.5,remaining*.6)),deadline=performance.now()+10000;
  while(epoch===this.epoch&&performance.now()<deadline){const ranges=this.video.buffered;if(ranges.length&&ranges.end(ranges.length-1)-this.video.currentTime>=target)return;await new Promise(r=>setTimeout(r,100));}
 }
 private async refillPlayback():Promise<void>{
  if(!this.clip||this.clipPaused||this.operation||this.recording||this.recordingPending||!this.stage.isConnected||!this.replayBuffer.needsRefill(this.video))return;
  const offset=this.replayPosition();if(offset>=this.clip.duration-1)return;
  // Re-seek through the existing verified playback operation. The connection is shared;
  // no private pause command or unbounded forward MSE queue is required.
  await this.playClip(this.clip,offset,this.playbackRate);
 }
 private async playClip(clip:CameraClip,offset=0,speed=this.playbackRate,paused=false):Promise<void>{
  if(this.operation||this.recording||this.recordingPending)return;
  if(this.modeTimer)clearTimeout(this.modeTimer);this.modeTimer=undefined;
  if(this.replayTimer)clearInterval(this.replayTimer);this.replayTimer=undefined;
  this.operation=true;this.switchingMedia=true;this.mediaGate.begin();this.clipPaused=paused;this.clip=clip;this.playbackRate=speed;this.renderRate();this.renderLenses();this.primaryFailed=false;this.primaryMediaKey=undefined;
  this.clipOffset=Math.max(0,Math.min(Number.isFinite(offset)?Math.floor(offset):0,clip.duration-1));this.attachPlayer(this.epoch);this.audio.clearPlayback();this.audio.setPlaybackBuffered(true);void this.audio.resumePlayback().catch(e=>this.showError(e));this.setState('waiting-frame','正在读取存储卡录像…');this.updateButtons();
  const epoch=this.epoch,reply=await this.command({kind:'playback',start:clip.start,offset:this.clipOffset,channel:clip.channel,speed:speed>1?4:1});if(epoch!==this.epoch)return;
  this.switchingMedia=false;
  if(reply){this.consumeEvents(this.mediaGate.commit(reply.streamRevision),epoch);if(epoch!==this.epoch)return;await this.bufferPlayback(speed,epoch,clip.duration-this.clipOffset);if(epoch!==this.epoch)return;}
  this.operation=false;
  if(reply){
   this.video.playbackRate=speed;if(speed!==1){this.audio.closeListening();this.listening=false;this.renderSoundIcons();}
   this.stage.dataset.videoMode='playback';this.stage.dataset.playbackRate=String(speed);this.seek.max=String(clip.duration);this.seek.value=String(this.clipOffset);this.renderPlaybackToggle();this.browser.position(clip,this.clipOffset);
   if(paused){this.video.pause();void this.audio.pausePlayback().catch(e=>this.showError(e));}else void this.video.play().catch(e=>this.showError(e));
   this.replayTimer=setInterval(()=>{void this.refillPlayback().catch(e=>this.showError(e));},250);
   this.modeTimer=setTimeout(()=>{if(epoch===this.epoch&&!this.clipPaused&&this.stage.dataset.videoState!=='playing'){this.setMessage('未能取得存储卡录像画面，正在恢复实时画面。');void this.returnLive();}},25000);
  }else await this.returnLive();
  this.updateButtons();
 }
 private renderPlaybackToggle():void{this.playbackPause.replaceChildren(officialIcon(this.clipPaused?'camera:replay-play':'camera:replay-pause'));this.playbackPause.setAttribute('aria-label',this.clipPaused?'继续播放':'暂停回看');this.playbackPause.setAttribute('aria-pressed',String(this.clipPaused));this.stage.dataset.playbackPaused=String(this.clipPaused);}
 private pausePlayback():void{if(!this.clip||this.clipPaused)return;this.clipPaused=true;this.video.pause();void this.audio.pausePlayback().catch(e=>this.showError(e));this.renderPlaybackToggle();this.updateButtons();}
 private async togglePlayback():Promise<void>{
  if(this.cloudEvent){if(this.operation)return;if(this.clipPaused){await this.video.play();this.clipPaused=false;}else{this.video.pause();this.clipPaused=true;}this.renderPlaybackToggle();this.care.select(this.cloudEvent.id,!this.clipPaused);return;}if(!this.clip||this.operation||this.recording)return;if(!this.clipPaused){this.pausePlayback();return;}
  if(this.replayBuffer.needsRefill(this.video)){await this.playClip(this.clip,this.replayPosition(),this.playbackRate);return;}
  const epoch=this.epoch;try{await this.video.play();if(epoch!==this.epoch)return;await this.audio.resumePlayback();if(epoch!==this.epoch)return;this.clipPaused=false;this.renderPlaybackToggle();this.updateButtons();}catch(error){if(epoch===this.epoch)this.showError(error);}
 }
 private captureClipThumbnail():void{const clip=this.clip;if(!clip||this.video.readyState<2)return;const key=`${clip.channel}:${clip.start}`;if(this.thumbnailKey===key)return;try{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;canvas.getContext('2d')!.drawImage(this.video,0,0,320,180);this.browser.thumbnail(clip,canvas.toDataURL('image/jpeg',.7));this.thumbnailKey=key;}catch{/* Album placeholders remain until a decoded frame is available. */}}
 private async returnLive():Promise<void>{
  if(this.operation||this.recordingPending)return;if(this.recording){await this.toggleRecord();if(this.recording||this.operation)return;}
  ++this.careEpoch;this.browserView='live';this.renderHeader();this.playbackPanel.hidden=this.carePanel.hidden=true;
  if(this.cloudEvent){this.cleanup();this.cloudEvent=undefined;await this.start();return;}
  if(!this.clip){if(!this.busy)await this.start();return;}
  if(this.replayTimer)clearInterval(this.replayTimer);this.replayTimer=undefined;
  this.operation=true;this.switchingMedia=true;this.mediaGate.begin();this.clip=undefined;this.clipPaused=false;this.playbackRate=1;this.primaryMediaKey=undefined;
  this.attachPlayer(this.epoch);this.audio.clearPlayback();this.audio.setPlaybackBuffered(false);void this.audio.resumePlayback().catch(e=>this.showError(e));this.setState('waiting-frame','正在返回实时画面…');
  const epoch=this.epoch,reply=await this.command({kind:'live'});if(epoch!==this.epoch)return;this.switchingMedia=false;this.operation=false;
  if(reply){this.secondary?.reset();this.renderRate();this.stage.dataset.videoMode='live';this.renderLenses();delete this.stage.dataset.cameraBrowser;this.playbackPanel.hidden=true;this.consumeEvents(this.mediaGate.commit(reply.streamRevision),epoch);if(epoch===this.epoch)void this.video.play().catch(e=>this.showError(e));}
  else this.fail('无法恢复实时画面，请重新连接摄像机。');this.updateButtons();
 }
}
