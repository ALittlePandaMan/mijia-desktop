import {api} from '../src/api';
import{CameraPlayer,type CameraSource}from'../src/camera-page';
import{MonitorWall}from'../src/ui/monitor-wall';
import type{MonitorTransport}from'../src/monitor';
import type{Device,HomeSnapshot}from'../src/types';
import{monitorInBackground,ResourceRevisions,setVisualWorkPaused,type ResourceState}from'../src/background-work';
import{listenResourceState}from'../src/resource-events';
import{settingsPage,createSettingsViewState,captureSettingsView,restoreSettingsView}from'../src/ui/settings-page';
import{renderMonitorQuality}from'../src/ui/camera-control-view';
import{CameraCare}from'../src/camera-care';
import{CameraBrowser}from'../src/camera-browser';
import{attachSurface,detachSurface,type SoftwareSurface}from'../src/media-surface';
import type{CameraEvent,CameraOperation,CameraReply}from'../src/camera-types';
import{cameraDate,cameraDayStart}from'../src/camera-time';
import{dismissOnBackdrop}from'../src/ui/dialog-dismiss';

const checks:{name:string;passed:boolean}[]=[];
function check(name:string,value:unknown){checks.push({name,passed:!!value});if(!value)throw Error(name);}
const wait=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(onCommand?:(op:CameraOperation)=>void){
 const calls:{stop:number;start:number;play:number;pause:number;watch:number;clip:unknown[]}={stop:0,start:0,play:0,pause:0,watch:0,clip:[]};let paused=false;
 const source:CameraSource={cameraFeatures:async()=>({qualities:[],listen:true,talk:true,ptz:false,playback:true}),startCamera:async()=>{calls.start++;return'mock-session';},stopCamera:async()=>{calls.stop++;},readCamera:async()=>[],cameraCommand:async(_context,_id,op)=>{onCommand?.(op);return{state:op.kind==='record'&&op.enabled?'recording':'ready'};},cameraMicrophone:async()=>{},cameraScreenshot:async()=>null};
 const player=new CameraPlayer(()=>{},source);document.querySelector('#fixture')!.append(player.stage);
 Reflect.set(player,'context',{homeId:'mock-home',generation:1,did:'mock-camera'});Reflect.set(player,'online',true);Reflect.set(player,'session','mock-session');Reflect.set(player,'busy',true);
 player.video.muted=true;Object.defineProperty(player.video,'paused',{configurable:true,get:()=>paused});player.video.pause=()=>{paused=true;calls.pause++;};player.video.play=async()=>{paused=false;calls.play++;};
 Reflect.set(player,'start',async()=>{calls.start++;Reflect.set(player,'session','resumed-session');});Reflect.set(player,'watchFrames',()=>{calls.watch++;});Reflect.set(player,'playClip',async(...args:unknown[])=>{calls.clip=args;});
 return{player,calls,paused:()=>paused};
}
async function run(){
 {
  const {player,calls}=fixture(),clip={start:1000,duration:60,channel:0,event:false};
  const audio=Reflect.get(player,'audio');
  let failAudio!:(error:Error)=>void,finishedAudio=false;
  const pendingAudio=new Promise<void>((_,reject)=>failAudio=reject);
  Reflect.set(audio,'resumePlayback',()=>pendingAudio.finally(()=>{finishedAudio=true;}));
  Reflect.set(player,'clip',clip);Reflect.set(player,'clipPaused',true);
  Reflect.set(player,'listening',true);
  Reflect.apply(Reflect.get(player,'showView'),player,['playback']);
  Reflect.apply(Reflect.get(player,'renderPlaybackToggle'),player,[]);
  player.video.pause();
  const toggle=()=>Reflect.apply(Reflect.get(player,'togglePlayback'),player,[]);
  try{
   const resumed=toggle();await wait();
   check('the SD play control resumes video while the audio device is still starting',
    !finishedAudio&&calls.play===1&&!player.video.paused&&player.stage.dataset.playbackPaused==='false');
   await toggle();
   failAudio(Error('old sound activation timed out'));await resumed;await wait();
   check('pause wins over an earlier sound activation failure',
    player.video.paused&&player.stage.dataset.playbackPaused==='true'&&player.audioControls.listening&&
    !player.stage.textContent?.includes('old sound activation timed out'));
  }finally{failAudio(Error('fixture ended'));player.dispose();player.stage.remove();}
 }
 {
  const calls:CameraOperation[]=[],{player}=fixture(),source=Reflect.get(player,'source') as CameraSource;
  const audio=Reflect.get(player,'audio');
  Reflect.set(audio,'startMicrophone',async()=>{});
  Object.defineProperty(audio,'microphoneActive',{get:()=>true,configurable:true});
  player.applyFeatures({qualities:[],listen:true,talk:true,ptz:false,playback:true,talkFormat:{codec:'pcma',sampleRate:8000}});
  let rejectOld!:(error:Error)=>void,starts=0;
  const old=new Promise<CameraReply>((_,reject)=>rejectOld=reject);
  source.cameraCommand=async(_context,_session,op)=>{
   calls.push(op);
   if(op.kind==='talk'&&op.enabled)return ++starts===1?old:{state:'talking',talkRevision:starts};
   return {state:'talk-stopped'};
  };
  try{
   const first=player.toggleTalk();await wait();
   await player.toggleTalk();await player.toggleTalk();
   rejectOld(Error('fixture cancelled talk response'));await first;
   check('a cancelled talk response cannot overwrite the next working microphone session',
    player.audioControls.talking&&!player.audioControls.talkPending&&
    calls.filter(op=>op.kind==='talk').map(op=>op.enabled).join(',')==='true,false,true'&&
    !player.stage.textContent?.includes('fixture cancelled talk response'));
   const stopped=(talkRevision:number)=>Reflect.apply(Reflect.get(player,'consumeEvents'),player,
    [[{state:'talk-stopped',talkRevision}],Reflect.get(player,'epoch')]);
   stopped(1);
   check('an old camera stop event cannot end a newer acknowledged talk session',player.audioControls.talking);
   stopped(2);
   check('a stop in the current session releases the microphone without sending a second stop',!player.audioControls.talking&&calls.length===3);
  }finally{player.dispose();player.stage.remove();}
 }
 {
  const played:number[]=[],coverLenses:number[]=[];
  const browser=new CameraBrowser(clip=>played.push(clip.channel),()=>{},()=>{},
   clips=>coverLenses.push(...clips.map(clip=>clip.channel)));
  const start=Math.floor(Date.now()/1000);
  browser.update([0,10].map(channel=>({start,duration:30,channel,event:false})));
  browser.root.querySelector<HTMLButtonElement>('.camera-all-clips')!.click();
  browser.root.querySelector<HTMLButtonElement>('.camera-channel-tabs button:last-child')!.click();
  check('switching lenses in the SD album only requests covers for the selected lens',
   !played.length&&coverLenses.join(',')==='0,10');
 }
 {
  const {player}=fixture(),source=Reflect.get(player,'source') as CameraSource;
  const delays:number[]=[],original=window.setTimeout;
  const clip={start:1000,duration:60,channel:0,event:false};
  let count=12;
  source.readCamera=async()=>Array.from({length:count},():CameraEvent=>({state:'throughput'}));
  const poll=()=>Reflect.apply(Reflect.get(player,'poll'),player,[Reflect.get(player,'context'),'mock-session',Reflect.get(player,'epoch')]);
  try{
   window.setTimeout=(_callback,delay)=>{delays.push(delay??0);return 0;};
   await poll();
   Reflect.set(player,'clip',clip);await poll();
   Reflect.set(player,'playbackRate',4);await poll();
   count=2;await poll();
   check('only a full accelerated SD batch drains on the next turn',delays.join(',')==='40,40,0,40');
  }finally{window.setTimeout=original;player.dispose();player.stage.remove();}
 }
 {
  const {player,calls}=fixture(),source=Reflect.get(player,'source') as CameraSource;
  const clip={start:1000,duration:60,channel:0,event:false},operations:CameraOperation[]=[];
  let rejectSpeed=true,currentTime=12.5;
  const refill=(now:number)=>Reflect.apply(Reflect.get(player,'refillPlayback'),player,[now]);
  const rate=()=>Reflect.apply(Reflect.get(player,'cycleRate'),player,[]);
  source.cameraCommand=async(_context,_session,operation)=>{
   operations.push(operation);
   if(operation.kind==='playbackSpeed'&&rejectSpeed)throw {kind:'cameraBusy',message:'fixture refused the speed change'};
   return {state:'speed-set'};
  };
  Object.defineProperty(player.video,'currentTime',{get:()=>currentTime,configurable:true});
  player.applyFeatures({qualities:[],listen:true,talk:false,ptz:false,playback:true});
  Reflect.set(player,'clip',clip);Reflect.set(player,'clipOffset',8);Reflect.set(player,'listening',true);
  Reflect.apply(Reflect.get(player,'showView'),player,['playback']);
  player.stage.dataset.videoState='playing';
  try{
   await rate();
   check('SD speed rejection restores the old rate and unblocks controls',
    player.video.playbackRate===1&&Reflect.get(player,'listening')&&!Reflect.get(player,'operation')&&!player.stage.querySelector<HTMLButtonElement>('.camera-playback-rate')!.disabled);
   rejectSpeed=false;await rate();await rate();
   check('successful speed changes preserve the current SD player',
    player.video.playbackRate===4&&operations.filter(op=>op.kind==='playbackSpeed').length===2&&calls.clip.length===0);
   check('accepted fast replay releases its existing listening subscription once',
    !Reflect.get(player,'listening')&&operations.filter(op=>op.kind==='listen'&&!op.enabled).length===1);
   const buffer=Reflect.get(player,'replayBuffer');buffer.frame(currentTime);
   await refill(0);await refill(5900);
   check('a short buffering gap does not restart SD playback',calls.clip.length===0);
   currentTime=21;
   await refill(6100);
   check('4x stall resumes from the last painted frame even when the playback clock advances',
    calls.clip[0]===clip&&calls.clip[1]===20.5&&calls.clip[2]===4&&calls.start===0&&calls.stop===0);
   calls.clip=[];
   await refill(6200);await refill(12200);
   check('repeated SD stall exposes retry instead of reopening in a loop',
    player.stage.dataset.videoState==='error'&&player.video.paused&&calls.clip.length===0);
   Reflect.set(player,'replayResult',undefined);Reflect.set(player,'clipPaused',false);Reflect.set(player,'replayRecoveryOffset',undefined);
   player.stage.dataset.videoState='playing';currentTime=52;buffer.frame(currentTime);
   await refill(12300);await refill(18400);
   check('SD playback near the end finishes without replaying the last seconds',
    Reflect.get(player,'replayResult')==='ended'&&player.video.paused&&calls.clip.length===0);
  }finally{player.dispose();player.stage.remove();}
 }
 {
  const {player,calls}=fixture();
  const clip={start:1000,duration:60,channel:10,event:false};
  const gate=Reflect.get(player,'mediaGate'),buffer=Reflect.get(player,'replayBuffer');
  const epoch=Reflect.get(player,'epoch');
  const consume=(events:CameraEvent[])=>Reflect.apply(Reflect.get(player,'consumeEvents'),player,[events,epoch]);
  const refill=()=>Reflect.apply(Reflect.get(player,'refillPlayback'),player,[]);
  const cutoff=(generation:number):CameraEvent=>({state:'playback-preview-limit',mediaGeneration:generation});
  let currentTime=5;
  Object.defineProperty(player.video,'currentTime',{get:()=>currentTime,configurable:true});
  Object.defineProperty(player.video,'buffered',{value:{length:1,start:()=>0,end:()=>12},configurable:true});
  Reflect.apply(Reflect.get(player,'showView'),player,['playback']);
  Reflect.set(player,'clip',clip);Reflect.set(player,'clipOffset',14);Reflect.set(player,'playbackRate',4);
  player.stage.dataset.videoState='playing';
  try{
   gate.begin();consume([cutoff(1),cutoff(2)]);
   check('a preview limit waits for its playback generation acknowledgement',!buffer.halted);
   consume(gate.commit(2));
   check('a native preview limit stops new input while retaining the clip and session',buffer.halted&&Reflect.get(player,'clip')===clip&&Reflect.get(player,'session')==='mock-session');
   buffer.reset();consume([cutoff(1)]);
   check('a delayed preview limit cannot interrupt the newer playback generation',!buffer.halted);
   consume([cutoff(2)]);await refill();
   check('after the native preview limit usable frames continue playing',calls.clip.length===0);
   currentTime=10;buffer.frame(currentTime);Reflect.set(player,'recording',true);
   await refill();
   check('preview saturation cannot seek or stop an active recording',calls.clip.length===0&&player.controls.recording&&calls.stop===0);
   Reflect.set(player,'recording',false);await refill();
   check('the exhausted preview refills the same SD clip, lens and speed on its current session',
    calls.clip[0]===clip&&calls.clip[1]===24&&calls.clip[2]===4&&calls.start===0&&calls.stop===0);
  }finally{player.dispose();player.stage.remove();}
 }
 {
  const {player}=fixture(),source=Reflect.get(player,'source') as CameraSource;
  const clip={start:1000,duration:60,channel:0,event:false};
  Reflect.deleteProperty(player,'playClip');
  Reflect.set(player,'attachPlayer',()=>{});
  Reflect.apply(Reflect.get(player,'showView'),player,['playback']);
  source.cameraCommand=async()=>{throw {kind:'cameraBusy',message:'fixture refused the clip'};};
  try{
   await Reflect.apply(Reflect.get(player,'playClip'),player,[clip,14,4]);
   check('failed SD playback clears the media transition and leaves the selected clip retryable',
    player.stage.dataset.videoState==='error'&&!Reflect.get(player,'operation')&&!Reflect.get(player,'mediaGate').transitioning&&
    Reflect.get(player,'clip')===clip&&Reflect.get(player,'clipOffset')===14&&!player.stage.querySelector<HTMLButtonElement>('.camera-retry')!.hidden);
  }finally{player.dispose();player.stage.remove();}
 }
 {
  const {player,calls}=fixture(),source=Reflect.get(player,'source') as CameraSource;
  const clip={start:1000,duration:60,channel:0,event:false},operations:string[]=[];
  let deliver!:(reply:CameraReply)=>void,decoders=0;
  const reply=new Promise<CameraReply>(resolve=>deliver=resolve);
  Reflect.deleteProperty(player,'playClip');Reflect.set(player,'attachPlayer',()=>{decoders++;});
  source.cameraCommand=async(_context,_session,operation)=>{operations.push(operation.kind);return operation.kind==='playback'?reply:{state:'live',streamRevision:2};};
  Reflect.apply(Reflect.get(player,'showView'),player,['playback']);
  try{
   const playback=Reflect.apply(Reflect.get(player,'playClip'),player,[clip,14,4]);
   await wait();
   player.stage.querySelector<HTMLButtonElement>('.device-page-header .page-icon-button')!.click();
   deliver({state:'playback',streamRevision:1});await playback;await wait();
   check('back during SD startup discards the late reply and returns to the existing live session',
    player.stage.dataset.cameraView==='live'&&operations.join(',')==='playback,live'&&decoders===0&&calls.start===0&&calls.stop===0);
  }finally{player.dispose();player.stage.remove();}
 }
 {
  const {player,calls}=fixture(),clip={start:1000,duration:60,channel:0,event:false};
  let time=11.5;
  Object.defineProperty(player.video,'currentTime',{get:()=>time,configurable:true});player.video.load=()=>{time=0;};
  Reflect.apply(Reflect.get(player,'showView'),player,['playback']);Reflect.set(player,'clip',clip);Reflect.set(player,'clipOffset',14);
  try{
   Reflect.apply(Reflect.get(player,'failPrimary'),player,['fixture decoder failed']);
   player.stage.querySelector<HTMLButtonElement>('.camera-retry')!.click();await wait();
   check('SD decoder failure keeps the clip position and session for explicit retry',
    player.stage.dataset.videoState==='error'&&calls.clip[0]===clip&&calls.clip[1]===25.5&&calls.start===0&&calls.stop===0);
  }finally{player.dispose();player.stage.remove();}
 }
 {
  const {player}=fixture(),clip={start:1234,duration:60,channel:0,event:false};
  const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='#336699';ctx.fillRect(0,0,16,16);
  const surface={canvas,readyState:2,pause(){},dispose(){}} as unknown as SoftwareSurface;
  attachSurface(player.video,surface);Reflect.set(player,'clip',clip);
  try{
   Reflect.apply(Reflect.get(player,'captureClipThumbnail'),player,[]);
   check('SD album uses the decoded canvas when hardware video decoding is unavailable',Reflect.get(player,'browser').hasThumbnail(clip));
  }finally{detachSurface(player.video);player.dispose();player.stage.remove();}
 }
 {
  const ops:CameraOperation[]=[],f=fixture(op=>ops.push(op));const state=()=>Reflect.apply(Reflect.get(f.player,'updateButtons'),f.player,[]);
  const record=()=>f.player.stage.querySelector<HTMLButtonElement>('[aria-label="开始录像"],[aria-label="结束录像"]')!;
  const surface={readyState:2,videoWidth:1280,videoHeight:720,currentTime:1,paused:false,muted:true,playbackRate:1,pause(){},dispose(){}};
  check('camera detail cannot record before the first frame',record().disabled);
  attachSurface(f.player.video,surface as unknown as SoftwareSurface);state();
  check('software-decoded detail frame enables the same native recording action',!record().disabled&&f.player.video.readyState===0);
  record().click();await wait();check('record keeps the original stream dimensions and lens',ops[0]?.kind==='record'&&ops[0].enabled&&ops[0].width===1280&&ops[0].height===720&&ops[0].lensId===0);
  surface.readyState=0;state();check('recording remains stoppable after a temporary frame loss',!record().disabled&&record().getAttribute('aria-label')==='结束录像');
  record().click();await wait();check('ending recording still uses the native route',ops[1]?.kind==='record'&&!ops[1].enabled);
  detachSurface(f.player.video);f.player.dispose();f.player.stage.remove();
 }
 {
  const ops:CameraOperation[]=[],f=fixture(op=>ops.push(op));
  f.player.applyFeatures({qualities:[],listen:true,talk:true,ptz:false,playback:true,lenses:[{id:0,label:'主镜头',ptz:false},{id:10,label:'副镜头',ptz:false}]});
  const secondary=Reflect.get(f.player,'secondary').video as HTMLVideoElement;
  const update=()=>Reflect.apply(Reflect.get(f.player,'updateButtons'),f.player,[]);
  const main=Reflect.get(f.player,'recordButton') as HTMLButtonElement,other=Reflect.get(f.player,'secondaryRecord') as HTMLButtonElement;
  const surface={readyState:2,videoWidth:640,videoHeight:360,currentTime:1,paused:false,muted:true,playbackRate:1,pause(){},dispose(){}};
  attachSurface(secondary,surface as unknown as SoftwareSurface);update();
  check('dual-lens detail enables capture only on the decoded lens',main.disabled&&!other.disabled);
  other.click();await wait();
  check('dual-lens recording still uses the selected physical lens',ops[0]?.kind==='record'&&ops[0].enabled&&ops[0].lensId===10);
  detachSurface(secondary);f.player.dispose();f.player.stage.remove();
 }
 {
  const {player,calls}=fixture(),source=Reflect.get(player,'source') as CameraSource;
  player.applyFeatures({qualities:[],listen:true,talk:false,ptz:false,playback:true,care:true,lenses:[{id:0,label:'主镜头',ptz:false},{id:10,label:'副镜头',ptz:false}]});
  const secondary=Reflect.get(player,'secondary');
  const commands:string[]=[];let fed=0,closed=0;
  Reflect.set(player,'selectedLens',10);
  Reflect.set(secondary,'attach',()=>{Reflect.set(secondary,'player',{feed:()=>{fed++;},play:async()=>{},destroy:()=>{closed++;}});});
  source.cameraCommand=async(_context,_session,operation)=>{commands.push(operation.kind);return {state:'ready',clips:[{start:Math.floor(Date.now()/1000),duration:60,channel:0,event:false}]};};
  source.cameraCare=async()=>({events:[]});
  const packet=(keyframe:boolean)=>Reflect.apply(Reflect.get(player,'consumeEvents'),player,[[{state:'media',lensId:10,streamRevision:1,keyframe,data:'AA=='}],Reflect.get(player,'epoch')]);
  try{
   packet(true);
   await Reflect.apply(Reflect.get(player,'openPlayback'),player,[]);
   packet(true);
   check('opening SD playback releases the hidden lens without decoding subsequent packets',closed===1&&fed===1&&secondary.viewport.hidden);
   await Reflect.apply(Reflect.get(player,'returnLive'),player,[]);
   packet(false);
   check('returning to the dual view waits for a complete secondary keyframe',fed===1&&!secondary.viewport.hidden);
   packet(true);
   await Reflect.apply(Reflect.get(player,'openCare'),player,[]);
   packet(true);
   check('care without a recording also releases the secondary decoder while keeping the live session',closed===2&&fed===2&&secondary.viewport.hidden&&calls.start===0&&calls.stop===0);
   await Reflect.apply(Reflect.get(player,'returnLive'),player,[]);
   packet(true);
   check('returning from care restores the same lens selection and connection',fed===3&&player.primaryLensId===10&&commands.join(',')==='recordings'&&calls.start===0&&calls.stop===0);
  }finally{player.dispose();player.stage.remove();}
 }
 {
  const {player}=fixture(),stage=player.stage,operations:CameraOperation['kind'][]=[];
  const source=Reflect.get(player,'source') as CameraSource;
  const clip={start:Math.floor(Date.now()/1000),duration:120,event:false,channel:0};
  let finishLive!:(reply:CameraReply)=>void;
  const liveReply=new Promise<CameraReply>(resolve=>finishLive=resolve);
  source.cameraCommand=async(_context,_session,operation)=>{
   operations.push(operation.kind);
   if(operation.kind==='recordings')return{state:'ready',clips:[clip]};
   if(operation.kind==='live')return liveReply;
   return{state:'ready',streamRevision:1};
  };
  source.cameraCare=async()=>({events:[{id:'motion',time:clip.start,kind:'有人移动',duration:5,thumbnailAvailable:false,playbackAvailable:true}]});
  // Use the native-session navigation and switch acknowledgements; the decoder is inert.
  Reflect.deleteProperty(player,'playClip');
  Reflect.set(player,'attachPlayer',()=>{});
  const click=(selector:string)=>stage.querySelector<HTMLButtonElement>(selector)!.click();
  const visible=(selector:string)=>!!stage.querySelector(selector)?.getClientRects().length;
  try{
   player.applyFeatures({qualities:[],listen:true,talk:false,ptz:false,playback:true,care:true});
   Reflect.set(player,'talkPending',true);Reflect.apply(Reflect.get(player,'updateButtons'),player,[]);
   click('.camera-care-entry');await wait();
   check('opening camera care cannot leave a pending microphone confirmation hidden',stage.dataset.cameraView==='live'&&operations.length===0);
   Reflect.set(player,'talkPending',false);Reflect.apply(Reflect.get(player,'updateButtons'),player,[]);
   click('.camera-playback-entry:not(.camera-care-entry)');await wait();
   check('native-session playback shows its own controls and asks for one recording',stage.dataset.cameraView==='playback'&&
    visible('.camera-playback-browser')&&visible('.camera-playback-timeline')&&!visible('.camera-page-footer')&&operations.join(',')==='recordings,playback');
   click('.device-page-header .page-icon-button');
   click('.camera-care-entry');await wait();
   check('care opens while the return-to-live reply is pending',stage.dataset.cameraView==='care'&&
    visible('[data-care-event=motion]')&&!visible('.camera-playback-browser')&&!visible('.camera-page-footer')&&
    !visible('.camera-playback-timeline')&&Reflect.get(player,'modeTimer')===undefined);
   finishLive({state:'ready',streamRevision:2});await wait();
   check('a late live reply cannot show live controls on the care page',stage.dataset.videoMode==='live'&&
    stage.querySelector('.device-page-title')?.textContent==='看家助手'&&visible('[data-care-event=motion]')&&
    !visible('.camera-tool-actions')&&!visible('.camera-page-footer')&&!visible('.camera-playback-timeline')&&
    operations.join(',')==='recordings,playback,live');
   click('.device-page-header .page-icon-button');await wait();
   check('leaving care restores the live controls without another media switch',stage.dataset.cameraView==='live'&&
    visible('.camera-tool-actions')&&visible('.camera-page-footer')&&!visible('.camera-care-browser')&&
    operations.join(',')==='recordings,playback,live');
  }finally{player.dispose();stage.remove();}
 }
 {
  const {player,calls}=fixture(),stage=player.stage,source=Reflect.get(player,'source') as CameraSource;
  const today=cameraDayStart(cameraDate(Date.now()/1000));
  const clips=[today,today-2*86400].map(start=>({start,duration:120,event:false,channel:0}));
  const emptyDay=cameraDate(today-86400).replaceAll('-','/');
  const operations:CameraOperation[]=[];
  let finishIndex!:(reply:CameraReply)=>void,finishFirstClip!:(reply:CameraReply)=>void,finishSecondClip!:(reply:CameraReply)=>void;
  let shots=0,decoders=0;
  const index=new Promise<CameraReply>(resolve=>finishIndex=resolve);
  const firstClip=new Promise<CameraReply>(resolve=>finishFirstClip=resolve);
  const secondClip=new Promise<CameraReply>(resolve=>finishSecondClip=resolve);
  const todaysReplies=[firstClip,secondClip];
  source.cameraCommand=async(_context,_session,operation)=>{
   operations.push(operation);
   if(operation.kind==='recordings')return index;
   if(operation.kind==='playback'&&operation.start===today)return todaysReplies.shift()!;
   return {state:'ready',streamRevision:2};
  };
  source.cameraScreenshot=async()=>{shots++;return null;};
  Reflect.deleteProperty(player,'playClip');
  Reflect.set(player,'attachPlayer',()=>{decoders++;});
  Reflect.set(player,'screenshotPixels',()=>'mock-frame');
  Object.defineProperties(player.video,{readyState:{configurable:true,value:2},videoWidth:{configurable:true,value:1280},videoHeight:{configurable:true,value:720}});
  const control=(selector:string)=>stage.querySelector<HTMLButtonElement>(selector)!;
  const click=(selector:string)=>control(selector).click();
  const day=()=>stage.querySelector('.camera-day-title')?.textContent;
  const empty=()=>day()===emptyDay&&stage.dataset.videoState==='stopped'&&
   !Reflect.get(player,'clip')&&![...stage.querySelectorAll<HTMLButtonElement>('.camera-playback-timeline button,.camera-replay-pause')].some(button=>!button.disabled);
  try{
   player.applyFeatures({qualities:[],listen:true,talk:false,ptz:false,playback:true});
   click('.camera-playback-entry:not(.camera-care-entry)');
   click('[aria-label="前一天"]');
   finishIndex({state:'ready',clips});await wait();
   check('an SD index reply honors the date selected while loading',empty()&&operations.length===1);
   click('[aria-label="后一天"]');await wait();
   check('the camera requests the selected recording',operations[1]?.kind==='playback'&&operations[1].start===today);
   click('[aria-label="前一天"]');
   check('selecting an empty day invalidates the pending clip and disables its tools',empty());
   const previousDecoders=decoders,previousPlays=calls.play;
   finishFirstClip({state:'ready',streamRevision:1});await wait();
   player.video.dispatchEvent(new Event('timeupdate'));
   Reflect.apply(Reflect.get(player,'consumeEvents'),player,[[{state:'waiting-frame'},{state:'media',data:'AA==',codec:'h264'}],Reflect.get(player,'epoch')]);
   click('[aria-label="回看截图"]');
   check('a late playback reply and old stream cannot restore the empty clip',empty()&&shots===0&&decoders===previousDecoders&&calls.play===previousPlays);
   click('[aria-label="后一天"]');await wait();
   click('[aria-label="前一天"]');click('[aria-label="前一天"]');await wait();
   check('a second date selection waits for the pending playback command',operations.length===3);
   finishSecondClip({state:'ready',streamRevision:2});await wait();
   check('the newest recording selection plays in the original session',operations[3]?.kind==='playback'&&
    operations[3].start===clips[1].start&&!control('[aria-label="回看截图"]').disabled&&calls.start===0);
   click('[aria-label="回看截图"]');await wait();
   click('[aria-label="后一天"]');click('[aria-label="回看截图"]');
   check('an empty date also clears an already playing clip',empty()&&shots===1);
   click('.device-page-header .page-icon-button');await wait();
   check('leaving an empty SD date restores the live stream once',stage.dataset.cameraView==='live'&&
    operations.map(operation=>operation.kind).join(',')==='recordings,playback,playback,playback,live');
  }finally{player.dispose();stage.remove();}
 }
 {
  const care=new CameraCare(()=>{},()=>{},(c,date,id)=>api.cameraCareThumbnail(c,date,id));document.body.append(care.root);
  care.loading({homeId:'mock-home',did:'camera',generation:1},'2026-11-18');
  care.update({events:[{id:'event',time:1795006800,kind:'有人移动',duration:3,thumbnailAvailable:false,playbackAvailable:true}]});
  const trigger=care.root.querySelector<HTMLButtonElement>('.camera-care-filter-menu')!;
  trigger.click();const menu=()=>care.root.querySelector('.camera-care-filter-options');
  const pointer=(type:string)=>new PointerEvent(type,{bubbles:true,isPrimary:true,pointerId:1,button:0});
  menu()!.dispatchEvent(pointer('pointerdown'));check('care filter ignores a press within its menu',!!menu());
  document.body.dispatchEvent(pointer('pointerdown'));check('care filter closes on outside press without changing selection',!menu()&&trigger.getAttribute('aria-expanded')==='false');
  trigger.click();document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  check('Escape returns focus to the care filter trigger',!menu()&&document.activeElement===trigger);
  trigger.click();menu()!.querySelectorAll<HTMLButtonElement>('button')[1].click();trigger.click();
  check('choosing an event filter retains its checked state when reopened',menu()!.querySelector('[aria-checked=true]')?.textContent==='有人移动');
  care.clear();check('closing camera care retires the menu and its listeners',!menu());care.root.remove();
  const backdrop=document.createElement('div'),content=document.createElement('section');backdrop.append(content);document.body.append(backdrop);let closed=0;
  dismissOnBackdrop(backdrop,()=>closed++);
  content.dispatchEvent(pointer('pointerdown'));backdrop.dispatchEvent(pointer('pointerup'));backdrop.click();
  check('dragging from a dialog to the backdrop does not cancel it',closed===0);
  backdrop.dispatchEvent(pointer('pointerdown'));backdrop.dispatchEvent(pointer('pointerup'));backdrop.click();
  check('a deliberate backdrop click only runs the cancel callback',closed===1);backdrop.remove();
 }
 {
  const root=document.createElement('div'),view=createSettingsViewState('mcp');document.body.append(root);let baseline='8765';
  const render=()=>settingsPage({view,homeAvailable:false,changed:()=>{},homeName:'',devices:[],loading:false,pending:false,back:()=>{},retry:()=>{},change:()=>{},artwork:()=>document.createElement('span'),application:{card:()=>{const card=document.createElement('div'),input=document.createElement('input');input.className='settings-number';input.dataset.focusKey='test-port';input.defaultValue=input.value=baseline;card.append(input);return card;}}});
  root.append(render());root.querySelector('input')!.value='9555';captureSettingsView(root,view);root.replaceChildren(render());restoreSettingsView(root,view);check('settings redraw preserves an unsubmitted numeric draft',root.querySelector('input')!.value==='9555');
  baseline='9555';root.replaceChildren(render());restoreSettingsView(root,view);check('committed settings baseline retires the transient draft',root.querySelector('input')!.value==='9555'&&!view.panels.mcp.inputDrafts?.['test-port']);root.remove();
 }
 {const f=fixture();let polls=0;Reflect.set(f.player,'powerActive',true);Reflect.set(f.player,'refreshPower',async()=>{polls++;});Reflect.set(f.player,'powerTimer',setTimeout(()=>polls++,5));f.player.backgroundPause();await new Promise(r=>setTimeout(r,15));check('camera power background timer is released',polls===0&&Reflect.get(f.player,'powerTimer')===undefined);f.player.backgroundResume();check('camera power refresh resumes once',polls===1);f.player.dispose();}
 for(const flag of['recording','recordingPending','listening','soundPending','talking','talkPending','operation']){
  const f=fixture();Reflect.set(f.player,flag,flag==='recordingPending'?1:true);f.player.backgroundPause();check(`background preserves ${flag}`,f.calls.stop===0&&f.player.blocksSuspension);Reflect.set(f.player,flag,flag==='recordingPending'?0:false);f.player.dispose();
 }
 {const f=fixture();f.player.video.muted=false;f.player.backgroundPause();check('audible playback continues',f.calls.stop===0&&f.player.blocksSuspension);f.player.video.muted=true;f.player.dispose();}
 {const f=fixture();Reflect.set(Reflect.get(f.player,'cloudControls'),'saving',true);f.player.backgroundPause();check('export blocks suspension',f.calls.stop===0&&f.player.blocksSuspension);Reflect.set(Reflect.get(f.player,'cloudControls'),'saving',false);f.player.dispose();}
 {const f=fixture(),stage=f.player.stage,video=f.player.video;f.player.backgroundPause();await wait();check('silent live stream stops once and permits suspension',f.calls.stop===1&&!f.player.blocksSuspension);f.player.backgroundPause();check('repeated idle heartbeat does not stop twice',f.calls.stop===1);f.player.backgroundResume();await wait();check('live resumes without replacing video or controls',f.calls.start===1&&f.player.stage===stage&&f.player.video===video);f.player.dispose();}
 {const f=fixture(),clip={start:0,duration:120,event:false,channel:0};Reflect.set(f.player,'clip',clip);Reflect.set(f.player,'clipOffset',25);Reflect.set(f.player,'playbackRate',4);Reflect.set(f.player,'clipPaused',true);Object.defineProperty(f.player.video,'currentTime',{configurable:true,value:11,writable:true});f.player.backgroundPause();await wait();f.player.backgroundResume();await wait();check('SD replay preserves position speed and paused state on the zero-based media clock',f.calls.clip[0]===clip&&f.calls.clip[1]===36&&f.calls.clip[2]===4&&f.calls.clip[3]===true);f.player.dispose();}
 {const f=fixture(),event={id:'mock-event'},timeline=Reflect.get(f.player,'cloudSequence');Reflect.set(f.player,'cloudEvent',event);f.player.video.playbackRate=2;
  Object.defineProperty(f.player.video,'src',{writable:true,value:''});f.player.video.load=()=>queueMicrotask(()=>f.player.video.dispatchEvent(new Event('loadedmetadata')));
  const data=new TextEncoder().encode('\0\0\0\x18ftypisom\0\0\0\0isom').buffer;
  await timeline.load({parts:[2],read:async()=>data,close:()=>{}},true);
  timeline.pause();f.player.video.dispatchEvent(new Event('pause'));
  check('cloud pause synchronizes the event row before another video frame appears',Reflect.get(f.player,'clipPaused')&&Reflect.get(Reflect.get(f.player,'care'),'playing')===false);
  await timeline.play();f.player.video.dispatchEvent(new Event('play'));
  const playsBeforeBackground=f.calls.play;
  f.player.backgroundPause();check('cloud replay pauses without discarding its source',f.calls.stop===0&&f.paused()&&Reflect.get(f.player,'cloudEvent')===event&&!f.player.blocksSuspension);
  f.player.backgroundResume();await wait();check('cloud replay restores speed and playback',f.calls.play===playsBeforeBackground+1&&f.player.video.playbackRate===2);f.player.dispose();
 }
 {const f=fixture();f.player.backgroundPause();await wait();f.player.dispose();f.player.backgroundResume();await wait();check('disposed media does not restart after a delayed wake',f.calls.start===0);}
 {
  const calls={create:0,stop:0,retry:0};const transport:MonitorTransport={create:async()=>{calls.create++;return'group';},read:()=>new Promise(()=>{}),retry:async()=>{calls.retry++;},stop:async()=>{calls.stop++;}};
  const wall=new MonitorWall(()=>{},()=>{},transport);document.querySelector('#fixture')!.append(wall.root);
  const device=(did:string):Device=>({did,name:did,model:'chuangmi.camera.mock',online:false,roomId:'mock-room',roomName:'模拟房间',specType:'urn:miot-spec-v2:device:camera:mock:1'});
  wall.update({homeId:'mock-home',generation:1,devices:[device('one'),device('two')]}as HomeSnapshot,[]);await wait();
  const roots=[...wall.root.querySelectorAll('.monitor-tile')],tiles=[...Reflect.get(wall,'tiles').values()];Reflect.set(tiles[0],'recording',true);
  wall.setPaused(true);check('recording wall keeps its group while silent tile pauses',calls.stop===0&&!tiles[0].resourceIsPaused&&tiles[1].resourceIsPaused);
  wall.setPaused(false);await wait();check('selective wall wake retains recording and DOM',calls.create===1&&roots.every((root,i)=>wall.root.querySelectorAll('.monitor-tile')[i]===root));
  Reflect.set(tiles[0],'recording',false);Reflect.set(tiles[0],'quality','hd');wall.setPaused(true);await wait();check('fully silent wall releases decoders and keeps the original group',calls.stop===0&&tiles.every(tile=>tile.resourceIsPaused)&&!wall.blocksSuspension&&roots.every((root,i)=>wall.root.querySelectorAll('.monitor-tile')[i]===root));
  wall.setPaused(false);await wait();check('wall wakes on the existing group with its selected quality',calls.create===1&&calls.retry===0&&Reflect.get(tiles[0],'quality')==='hd');wall.close();check('explicit exit stops the original group',calls.stop===1);
 }
 {
  // Exercise the production subscription through Tauri's real JS event adapter.
  const callbacks=new Map<number,(event:{payload:ResourceState})=>void>(),listeners=new Map<number,{target:{kind:string;label?:string};handler:number}>();let sequence=0;
  const oldInternals=Reflect.get(window,'__TAURI_INTERNALS__'),oldEvents=Reflect.get(window,'__TAURI_EVENT_PLUGIN_INTERNALS__');
  Reflect.set(window,'__TAURI_INTERNALS__',{transformCallback:(callback:(event:{payload:ResourceState})=>void)=>{const id=++sequence;callbacks.set(id,callback);return id;},invoke:async(command:string,args:{target:{kind:string;label?:string};handler:number;eventId:number})=>{if(command==='plugin:event|listen'){const id=++sequence;listeners.set(id,args);return id;}if(command==='plugin:event|unlisten')listeners.delete(args.eventId);}});
  Reflect.set(window,'__TAURI_EVENT_PLUGIN_INTERNALS__',{unregisterListener:()=>{}});
  const emit=(label:string,revision:number,visible:boolean,monitorBackground?:boolean)=>{for(const entry of listeners.values())if(entry.target.kind==='Any'||entry.target.label===label)callbacks.get(entry.handler)?.({payload:{version:1,revision,visible,refreshMs:30000,monitorBackground}});};
  const calls={create:0,stop:0,retry:0};const transport:MonitorTransport={create:async()=>{calls.create++;return'fullscreen-group';},read:()=>new Promise(()=>{}),retry:async()=>{calls.retry++;},stop:async()=>{calls.stop++;}};
  const wall=new MonitorWall(()=>{},()=>{},transport);document.querySelector('#fixture')!.append(wall.root);
  const devices=Array.from({length:4},(_,i)=>({did:`fullscreen-${i}`,name:'模拟监控',model:'chuangmi.camera.mock',online:false,roomId:'mock-room',roomName:'模拟房间',specType:'urn:miot-spec-v2:device:camera:mock:1'}));
  wall.update({homeId:'mock-home',generation:1,devices}as HomeSnapshot,[]);await wait();const roots=[...wall.root.querySelectorAll('.monitor-tile')],videos=[...wall.root.querySelectorAll('video')];
  const revisions=new ResourceRevisions();const off=await listenResourceState('main',value=>{if(revisions.accept(value))wall.setPaused(monitorInBackground(value.monitorBackground,false,false),!value.visible);});
  try{
   emit('main',2,true,false);
   for(let i=0;i<20;i++){document.body.classList.add('desktop-native-fullscreen');emit('widget-a',100+i*2,false);emit('widget-b',500+i*2,false);window.dispatchEvent(new Event('resize'));await wait();document.body.classList.remove('desktop-native-fullscreen');emit('widget-a',101+i*2,true);emit('widget-b',501+i*2,true);}
   check('20 fullscreen cycles ignore covered desktop host events without reconnecting',calls.create===1&&calls.stop===0);
   check('fullscreen keeps all four monitor tiles and video nodes',roots.length===4&&videos.length===4&&roots.every((root,i)=>wall.root.querySelectorAll('.monitor-tile')[i]===root)&&videos.every((video,i)=>wall.root.querySelectorAll('video')[i]===video));
   const tiles=[...Reflect.get(wall,'tiles').values()];const mediaBefore=tiles.map(tile=>Reflect.get(tile.page,'mediaEpoch'));
   for(const [i,tile] of tiles.entries()){tile.root.dataset.playing='true';Reflect.set(tile,'quality',i===0?'hd':'auto');}
   emit('main',3,false,false);await wait();
   check('Alt+Tab coverage leaves the renderer, playing markers, and selected tiers intact',tiles.every((tile,i)=>!tile.resourceIsPaused&&Reflect.get(tile.page,'monitorHidden')&&Reflect.get(tile.page,'mediaEpoch')===mediaBefore[i]&&tile.root.dataset.playing==='true'&&Reflect.get(tile,'quality')===(i===0?'hd':'auto'))&&calls.create===1&&calls.stop===0&&calls.retry===0);
   emit('main',4,false,true);await wait();check('minimizing while still covered pauses presentation and keeps the group',calls.stop===0&&tiles.every(tile=>tile.resourceIsPaused));
   emit('widget-a',999,true);await wait();check('uncovering a host cannot wake a minimized main monitor',calls.create===1);
   emit('main',5,false,false);await wait();check('restoring under another window resumes the same group and selected tiers',calls.create===1&&tiles.every((tile,i)=>!tile.resourceIsPaused&&Reflect.get(tile,'quality')===(i===0?'hd':'auto')));
   emit('main',4,false,true);await wait();check('a delayed minimize event cannot blank restored monitor tiles',tiles.every(tile=>!tile.resourceIsPaused)&&calls.retry===0);
   emit('main',6,true,false);await wait();check('uncovering re-enables paint checks without reconnecting',tiles.every(tile=>!Reflect.get(tile.page,'monitorHidden'))&&calls.create===1&&calls.retry===0);
   off();await wait();check('fullscreen resource subscription is released on cleanup',listeners.size===0);
  }finally{off();wall.close();Reflect.set(window,'__TAURI_INTERNALS__',oldInternals);Reflect.set(window,'__TAURI_EVENT_PLUGIN_INTERNALS__',oldEvents);}
 }
 {
  const qualities=[{id:'sd',label:'流畅'},{id:'hd',label:'高清'},{id:'uhd',label:'超清'},{id:'auto',label:'自动'}];
  const low={width:848,height:480},high={width:2960,height:1666},sizes={sd:low,hd:high,uhd:low};
  const menu=document.createElement('div');document.body.append(menu);
  renderMonitorQuality(menu,qualities,'uhd',()=>{});
  check('monitor selects the native ultra tier when independently available',menu.textContent==='超清高清流畅自动'&&!!menu.querySelector('[data-quality=uhd][data-quality-mode=uhd][aria-checked=true]'));
  menu.querySelector<HTMLButtonElement>('[data-quality=uhd]')!.focus();
  renderMonitorQuality(menu,qualities,'uhd',()=>{},sizes);
  check('monitor quality menu folds a duplicate low stream and maps selection and focus to smooth without sizes',menu.textContent==='高清流畅自动'&&document.activeElement===menu.querySelector('[data-quality=sd][aria-checked=true]'));menu.remove();
  const f=fixture();f.player.applyFeatures({qualities,listen:true,talk:true,ptz:false,playback:false});
  f.player.syncControls('uhd',false);
  check('detail menu and toolbar show the native ultra tier',f.player.stage.querySelector('.camera-quality-button')?.textContent==='超清'&&f.player.stage.querySelector('[data-quality=uhd]')?.textContent==='超清');
  const readings=Reflect.get(f.player,'qualityReadings');for(const [quality,size]of Object.entries(sizes)){readings.reset(quality);for(let frame=0;frame<3;frame++)readings.observe(0,size,quality,quality);}
  Reflect.set(f.player,'quality','uhd');const panel=f.player.stage.querySelector<HTMLElement>('.camera-quality-modal')!;panel.hidden=false;Reflect.apply(Reflect.get(f.player,'renderQuality'),f.player,[]);
  check('camera detail uses the same plain tier labels without a diagnostic action',[...panel.querySelectorAll('[data-quality]')].map(choice=>choice.textContent?.trim()).join('')==='高清流畅自动'&&!!panel.querySelector('[data-quality=sd][aria-checked=true]')&&!panel.textContent?.includes('导出播放诊断'));
  check('detail toolbar uses the label of the matched stream while retaining its old selection',f.player.stage.querySelector('.camera-quality-button')?.textContent==='流畅'&&f.player.controls.quality==='uhd');
  f.player.dispose();f.player.stage.remove();
 }
 {
  const a=document.createElement('div'),b=document.createElement('div');document.body.append(a,b);const one=a.animate([{opacity:0},{opacity:1}],{duration:10000}),two=b.animate([{opacity:0},{opacity:1}],{duration:10000});
  setVisualWorkPaused(a,true);setVisualWorkPaused(b,true);setVisualWorkPaused(a,false);check('animation ownership is isolated per card',one.playState!=='paused'&&two.playState==='paused');setVisualWorkPaused(b,false);one.cancel();two.cancel();a.remove();b.remove();
 }
 return{complete:true,mockOnly:true,physicalDeviceWrites:0,checks};
}
(window as unknown as {runResourceChecks:()=>Promise<unknown>}).runResourceChecks=async()=>{try{return await run();}catch(error){return{complete:false,mockOnly:true,physicalDeviceWrites:0,checks,error:String(error)};}};
