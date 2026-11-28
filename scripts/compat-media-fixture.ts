// Offline fixture only. No account credentials or device commands.
import '../src/style.css';import '../src/theme.css';
import '../src/ui/settings-content.css';
import {CompatVideo} from '../src/software-video';
import {CloudVideoSequence} from '../src/cloud-video-sequence';
import {loadVideoEngine,nativeVideoPlayer} from '../src/native-video';
import {mediaView,setMediaContext,detachSurface,requestMediaFrame} from '../src/media-surface';
import {captureCameraLens,captureCameraLayout} from '../src/camera-lens-player';
import {ApplicationSettingsController} from '../src/ui/application-settings';
import {clearToast} from '../src/ui/toast';
import {Tile} from '../src/ui/monitor-tile';
const params=new URLSearchParams(location.search);
if(params.has('render2d')){const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind:any,options:any){return kind==='webgl'||kind==='webgl2'?null:get.call(this,kind,options);} as typeof get;}
const callbacks=new Map<number,(value:any)=>void>(),subscriptions=new Map<number,string>(),calls:{command:string;args:any}[]=[],leases=new Map<string,{acked:number;next:number}>();let callbackId=0,released=0,errors:string[]=[],mode='current',checks=0;
let decoderLimit=Infinity;
let heldDecoderClose:Promise<void>|undefined;
function emit(event:string,payload:unknown){for(const [id,name]of subscriptions){if(name===event)callbacks.get(id)?.({event,payload});}}
let primeCloud=false;
const bridge=new EventTarget() as EventTarget&{releaseBuffer:(buffer:ArrayBuffer)=>void};bridge.releaseBuffer=()=>{released++;};(window as any).chrome??={};(window as any).chrome.webview=bridge;
let savedAutoCheck=false,latestVersion='1.0.1';
let runAutomaticCheck:(()=>void)|undefined;
const originalInterval=window.setInterval;
window.setInterval=(fn,ms,...args)=>{
 if(ms===6*60*60*1000&&typeof fn==='function')runAutomaticCheck=()=>fn(...args);
 return originalInterval(fn,ms,...args);
};
const data:any={scope:'mock',settings:{},desktopOptions:{autoCheckUpdates:false,monitorSeparateWindow:false},update:{revision:1,state:'idle',currentVersion:'1.0.0',latestVersion:null,notes:null,checkedAt:null,downloadedBytes:0,totalBytes:null,message:'',packageKind:'portable',supported:true,canInstall:false,canDownload:false}};
const invoke=async(command:string,args:any={})=>{
 calls.push({command,args});
 if(command==='plugin:event|listen'){subscriptions.set(args.handler,args.event);return args.handler;}
 if(command==='plugin:event|unlisten'){subscriptions.delete(args.eventId);callbacks.delete(args.eventId);return;}
 if(command==='camera_decode_open'){if(leases.size>=decoderLimit)throw{kind:'decodeCapacity'};leases.set(args.id,{acked:0,next:0});return;}
 if(command==='camera_decode_ack'){const l=leases.get(args.id);if(l)l.acked=args.sequence;return;}
 if(command==='camera_decode_close'){if(heldDecoderClose)await heldDecoderClose;if(leases.delete(args.id))emit('camera-decoder-available',null);return;}
 if(command==='camera_decode_finish'&&primeCloud){setTimeout(()=>{if(leases.has(args.id))sendFrame({id:args.id},0,640,360,false,320,180);},0);return;}
 if(command==='camera_decode_feed'||command==='camera_decode_finish'||command==='camera_decode_viewport')return;
 if(command==='home_preferences'||command==='change_home_preferences')return {cameraPrimaryLenses:{}};
 if(command==='change_desktop_option'&&args.option==='autoCheckUpdates'){savedAutoCheck=args.enabled;return {...data,desktopOptions:{...data.desktopOptions,autoCheckUpdates:savedAutoCheck}};}
 if(command==='check_app_update'){checks++;await new Promise(r=>setTimeout(r,50));if(mode==='throw')throw Error('mock network');return {...data.update,revision:++data.update.revision,state:mode,latestVersion:mode==='available'?latestVersion:null,canDownload:mode==='available',message:'DO NOT DISPLAY BACKEND PROSE'};}
 throw Error('Mock denied: '+command);
};
(window as any).__TAURI_INTERNALS__={invoke,transformCallback:(fn:any)=>{const id=++callbackId;callbacks.set(id,fn);return id;},unregisterCallback:(id:number)=>callbacks.delete(id)};(window as any).isTauri=true;
(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:(_event:string,id:number)=>callbacks.delete(id)};
const root=document.querySelector<HTMLElement>('#app')!,settings=document.createElement('section'),viewport=document.createElement('section'),video=document.createElement('video');
settings.className='settings-page';
viewport.style.cssText='position:relative;width:640px;height:360px;background:#000';video.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain';video.autoplay=true;video.muted=true;video.setAttribute('aria-label','模拟镜头');viewport.append(video);root.append(settings,viewport);setMediaContext(video,()=>({homeId:'mock-home',generation:7,did:'mock-camera'}));
const controller=new ApplicationSettingsController(()=>render());controller.data=data;function render(){settings.replaceChildren(controller.card('about',{} as any,[],''));}render();
let surface:CompatVideo|undefined,frameCallbacks=0,seeks:number[]=[];
function sendFrame(target:Pick<CompatVideo,'id'>,pts:number,sourceWidth:number,sourceHeight:number,malformed:boolean,width:number,height:number){
 const lease=leases.get(target.id)!;
 if(lease.next!==lease.acked)throw Error('One output frame must be acknowledged before the next.');
 const sequence=++lease.next,bytes=new Uint8Array(width*height*4);
 for(let i=0;i<bytes.length;i+=4){bytes[i]=24;bytes[i+1]=160;bytes[i+2]=80;bytes[i+3]=255;}
 const event=new Event('sharedbufferreceived') as any;
 event.additionalData={kind:'mijia-software-media',id:target.id,sequence,frame:{kind:1,width,height,sourceWidth,sourceHeight,pts,duration:0,bytes:bytes.length+(malformed?1:0),rate:0}};
 event.getBuffer=()=>bytes.buffer;bridge.dispatchEvent(event);
}
const fixture={calls,controller,viewport,video,errors,seeks,get released(){return released;},get checks(){return checks;},get savedAutoCheck(){return savedAutoCheck;},get frameCallbacks(){return frameCallbacks;},get state(){const v=mediaView(video);return {width:v.videoWidth,height:v.videoHeight,ready:v.readyState,time:v.currentTime,paused:v.paused,ended:v.ended,leases:leases.size,canvas:!!viewport.querySelector('canvas')};},setMode(value:string){mode=value;},setLatestVersion(version:string){latestVersion=version;},automaticTick(){runAutomaticCheck?.();},render,clearToast(){clearToast(document.body);},
 async releaseClosingFrame(){
  const surface=await CompatVideo.open(video,{format:'mpegts',error:message=>errors.push(message)});
  let finishClose!:()=>void;
  heldDecoderClose=new Promise(resolve=>{finishClose=resolve;});
  try{
   const before=released;
   detachSurface(video,surface);
   sendFrame(surface,0,640,360,false,320,180);
   return released===before+1&&leases.has(surface.id)&&leases.get(surface.id)?.acked===0;
  }finally{heldDecoderClose=undefined;finishClose();}
 },
 async decoderCapacity(){
  const first=document.createElement('video'),cancelled=document.createElement('video');
  const context={homeId:'mock-home',generation:7,did:'mock-camera'};
  for(const video of [first,cancelled]){viewport.append(video);setMediaContext(video,()=>context);}
  const engine=await loadVideoEngine(),supports=engine.isSupported;
  engine.isSupported=()=>false;decoderLimit=1;
  const delay=()=>new Promise<void>(resolve=>setTimeout(resolve,40));
  const started=await CompatVideo.open(first,{format:'mpegts',error:message=>errors.push(message)});
  const failureCount=errors.length,before=calls.length;
  let reconnects=0;
  const tile=new Tile({did:context.did,name:'离线模拟镜头',model:'example.camera.mock',online:true,roomId:'',roomName:''},()=>reconnects++,()=>reconnects++,{
   fullscreenInWall:()=>false,open:()=>{},context,command:async()=>{throw Error('Device commands denied');},screenshot:async()=>null
  });
  const originalTimeout=window.setTimeout;
  window.setTimeout=(task,ms,...args)=>originalTimeout(task,ms===25000?60:ms,...args);
  const abandoned=nativeVideoPlayer(cancelled,kind=>errors.push(kind));
  try{
   viewport.append(tile.root);
   tile.update({did:context.did,revision:1,state:'live',events:[{state:'media',codec:'hevc',keyframe:true,data:'RwE='}]});
   abandoned.feed(Uint8Array.of(0x47,2).buffer);
   const opens=()=>calls.slice(before).filter(call=>call.command==='camera_decode_open');
   for(let i=0;i<25&&opens().length<2;i++)await delay();
   // Run past the shortened frame watchdog while the native worker is busy.
   await delay();await delay();await delay();
   tile.update({did:context.did,revision:1,state:'live',events:[]});
   if(reconnects||!tile.page.waitingForDecoder||!tile.root.textContent?.includes('等待视频解码资源')||
    errors.length!==failureCount||opens().length!==2||leases.size!==1||viewport.querySelectorAll('canvas').length!==1)return false;
   // Only shorten the watchdog while the decoder is waiting for capacity.
   window.setTimeout=originalTimeout;
   abandoned.destroy();
   detachSurface(first,started);
   for(let i=0;i<25&&(opens().length<3||tile.page.waitingForDecoder);i++)await delay();
   const admitted=opens().at(-1);
   if(opens().length!==3||!admitted||!leases.has(admitted.args.id)||leases.size!==1)return false;
   sendFrame(admitted.args,0,640,360,false,320,180);
   for(let i=0;i<50&&mediaView(tile.page.video).readyState<2;i++)await delay();
   if(mediaView(tile.page.video).readyState<2)throw Error('Mock monitor frame was not presented: '+JSON.stringify({
    released,lease:leases.get(admitted.args.id),decoder:tile.page.video.dataset.decoder,
    state:tile.root.dataset.state,errors
   }));
   return reconnects===0&&tile.routeRevision===1&&errors.length===failureCount&&mediaView(tile.page.video).readyState===2&&
    calls.slice(before).some(call=>call.command==='camera_decode_feed'&&call.args.id===admitted.args.id&&call.args.data==='RwE=')&&
    !calls.slice(before).some(call=>call.command==='camera_decode_feed'&&call.args.data==='RwI=');
  }finally{window.setTimeout=originalTimeout;tile.dispose();abandoned.destroy();detachSurface(first,started);first.remove();cancelled.remove();decoderLimit=Infinity;engine.isSupported=supports;}
 },
 async keyframeAfterSaturation(){
  const probe=document.createElement('video');viewport.append(probe);
  setMediaContext(probe,()=>({homeId:'mock-home',generation:7,did:'mock-camera'}));
  const compat=await CompatVideo.open(probe,{format:'mpegts',preserveSource:true,error:message=>errors.push(message)});
  try{
   const queued=compat.feed(new ArrayBuffer(4*1024*1024),true);
   await compat.feed(Uint8Array.of(0x47,2).buffer,false);
   await queued;
   const before=calls.length;
   await compat.feed(Uint8Array.of(0x47,3).buffer,false);
   await compat.feed(Uint8Array.of(0x47,4).buffer,true);
   const packets=calls.slice(before).filter(call=>call.command==='camera_decode_feed');
   return packets.length===1&&packets[0].args.id===compat.id&&packets[0].args.data==='RwQ='&&leases.size===1;
  }finally{detachSurface(probe,compat);probe.remove();}
 },
 async decoderMainLensPriority(){
  const engine=await loadVideoEngine(),supports=engine.isSupported;
  engine.isSupported=()=>false;decoderLimit=2;
  const tiles:Tile[]=[];
  const failureCount=errors.length,before=calls.length;
  let reconnects=0,commands=0;
  const wait=async(test:()=>boolean)=>{for(let i=0;i<40;i++){if(test())return true;await new Promise(r=>setTimeout(r,25));}return false;};
  const add=(did:string,dual=false)=>{
   const tile=new Tile({did,name:did,model:'example.camera.mock',online:true,roomId:'',roomName:''},()=>reconnects++,()=>reconnects++,{
    fullscreenInWall:()=>false,open:()=>{},context:{homeId:'mock-home',generation:7,did},
    command:async()=>{commands++;throw Error('Device commands denied');},screenshot:async()=>null,
   });
   viewport.append(tile.root);tiles.push(tile);
   const features={qualities:[],listen:false,talk:false,ptz:false,playback:false,
    lenses:dual?[{id:0,label:'主镜头',ptz:false},{id:1,label:'副镜头',ptz:false}]:undefined};
   return {tile,feed:(lensId:number,data:string)=>tile.update({did,revision:1,state:'live',features,
    events:[{state:'media',codec:'hevc',lensId,keyframe:true,data}]})};
  };
  const lease=(data:string)=>calls.slice(before).find(c=>c.command==='camera_decode_feed'&&c.args.data===data&&leases.has(c.args.id))?.args.id as string|undefined;
  try{
   const dual=add('dual',true);
   dual.feed(0,'RwE=');
   if(!await wait(()=>!!lease('RwE=')))return false;
   dual.feed(1,'RwI=');
   if(!await wait(()=>!!lease('RwI=')))return false;
   const firstMain=lease('RwE='),firstInset=lease('RwI=');
   dual.tile.page.syncControls('auto',true,1);
   const other=add('other-main');
   other.feed(0,'RwM=');
   if(!await wait(()=>other.tile.page.waitingForDecoder)||lease('RwI=')!==firstInset)return false;
   dual.tile.page.syncControls('auto',false);
   if(!await wait(()=>!!lease('RwM='))||lease('RwE=')!==firstMain||lease('RwI=')||leases.size!==2)return false;
   const otherLease=lease('RwM=');
   dual.feed(1,'Rwg=');
   await new Promise(r=>setTimeout(r,80));
   dual.tile.root.querySelector<HTMLButtonElement>('.camera-lens-swap')!.click();
   if(!await wait(()=>!!lease('Rwg=')))return false;
   const promoted=lease('Rwg=');
   if(!promoted||promoted===firstInset||lease('RwM=')!==otherLease||lease('RwE=')||leases.size!==2)return false;
   sendFrame({id:promoted},0,640,360,false,320,180);
   return await wait(()=>mediaView(dual.tile.page.primaryVideo).readyState===2)&&tiles.every(t=>t.routeRevision===1)&&
    errors.length===failureCount&&reconnects===0&&commands===0;
  }finally{
   for(const tile of tiles)tile.dispose();
   decoderLimit=Infinity;engine.isSupported=supports;
  }
 },
 async systemStartupTimeout(){
  await loadVideoEngine();
  const source=document.createElement('video');source.muted=true;viewport.append(source);
  const context={homeId:'mock-home',generation:7,did:'mock-camera'};
  setMediaContext(source,()=>context);
  const before=calls.length,errorCount=errors.length;
  const player=nativeVideoPlayer(source,kind=>errors.push(kind),false);
  try{
   source.playbackRate=4;
   player.feed(Uint8Array.of(0x47).buffer);
   const deadline=performance.now()+15000;
   while(!leases.size&&performance.now()<deadline&&errors.length===errorCount)await new Promise(resolve=>setTimeout(resolve,50));
   const opens=calls.slice(before).filter(call=>call.command==='camera_decode_open');
   if(opens.length!==1)return false;
   const [opened]=opens;
   const decoded=new Promise<void>(resolve=>requestMediaFrame(source,()=>resolve()));
   sendFrame(opened.args,0,640,360,false,320,180);await decoded;
   return opened.args.replay===true&&opened.args.context.did===context.did&&mediaView(source).paused&&
    mediaView(source).playbackRate===4&&mediaView(source).readyState===2&&
    calls.slice(before).some(call=>call.command==='camera_decode_feed'&&call.args.data==='Rw==');
  }finally{player.destroy();source.remove();}
 },
 async cloudFallback(){
  const source=document.createElement('video');source.muted=true;viewport.append(source);
  setMediaContext(source,()=>({homeId:'mock-home',generation:7,did:'mock-camera'}));
  let url='';Object.defineProperty(source,'src',{get:()=>url,set:(value:string)=>url=value});
  source.load=()=>{if(url)queueMicrotask(()=>source.dispatchEvent(new Event('loadedmetadata')));};
  source.play=async()=>{throw new DOMException('No supported source','NotSupportedError');};
  const timeline=new CloudVideoSequence(source,message=>errors.push(message)),before=calls.length;
  const data=new TextEncoder().encode('\0\0\0\x18ftypisom\0\0\0\0isom').buffer;
  try{
   primeCloud=true;await timeline.load({parts:[2],read:async()=>data,close:()=>{}},true);
   return calls.slice(before).filter(call=>call.command==='camera_decode_open').length===1&&mediaView(source).readyState===2&&mediaView(source).videoWidth===640&&!mediaView(source).paused;
  }finally{primeCloud=false;timeline.dispose();source.remove();}
 },
 monitorLayout(){
  const grid=document.createElement('div'),neighbor=document.createElement('section'),open=document.createElement('button');
  viewport.classList.add('monitor-tile');neighbor.className='monitor-tile';neighbor.hidden=true;
  viewport.before(grid);grid.append(viewport,neighbor);
  open.id='fixture-fullscreen';open.textContent='全屏';open.style.cssText='position:absolute;z-index:10;top:0;left:0';
  open.onclick=()=>{void viewport.requestFullscreen();};viewport.append(open);open.scrollIntoView();
 },
 async open(format:'mpegts'|'mp4'='mpegts',replay=false){detachSurface(video);surface=await CompatVideo.open(video,{format,preserveSource:format==='mpegts'&&!replay,replay,size:format==='mp4'?100:0,duration:10,seek:time=>seeks.push(time),error:message=>errors.push(message)});await surface.play();},
 send(pts=0,sourceWidth=640,sourceHeight=360,malformed=false,width=320,height=180){if(!surface)throw Error('No surface');sendFrame(surface,pts,sourceWidth,sourceHeight,malformed,width,height);},
 async secondLens(){
  const second=document.createElement('video');
  second.autoplay=true;second.muted=true;
  second.style.cssText='position:absolute;inset:10px 10px auto auto;width:160px;height:90px';
  viewport.append(second);
  setMediaContext(second,()=>({homeId:'mock-home',generation:7,did:'mock-camera'}));
  try{
   const compat=await CompatVideo.open(second,{format:'mpegts',preserveSource:true,error:message=>errors.push(message)});
   const ready=new Promise<void>(resolve=>requestMediaFrame(second,()=>resolve()));
   sendFrame(compat,0,1920,1080,false,1920,1080);await ready;
   return leases.size===2&&compat.canvas.width===1920&&compat.canvas.height===1080&&surface?.canvas.width===2560;
  }finally{detachSurface(second);second.remove();}
 },
 watch(){requestMediaFrame(video,()=>{frameCallbacks++;});},shot(){return captureCameraLens(video);},layoutShot(){return captureCameraLayout(viewport,[video]);},pause(){surface?.pause();},play(){return surface?.play();},rate(value:number){if(surface)surface.playbackRate=value;},seek(value:number){if(surface)surface.currentTime=value;},close(){detachSurface(video);surface=undefined;},acknowledged(){const lease=surface&&leases.get(surface.id);return !lease||lease.acked===lease.next;},
 stale(){emit('camera-decoder-error',{id:surface?.id,kind:'staleContext'});}
};(window as any).compatFixture=fixture;
