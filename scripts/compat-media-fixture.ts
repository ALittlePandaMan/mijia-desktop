// Offline fixture only. No account credentials or device commands.
import '../src/style.css';import '../src/theme.css';
import {CompatVideo} from '../src/software-video';
import {CloudVideoSequence} from '../src/cloud-video-sequence';
import {mediaView,setMediaContext,detachSurface,requestMediaFrame} from '../src/media-surface';
import {captureCameraLens,captureCameraLayout} from '../src/camera-lens-player';
import {exportPlaybackDiagnostics,recordPlaybackInput,recordPlaybackSample} from '../src/camera-playback-diagnostics';
import {ApplicationSettingsController} from '../src/ui/application-settings';
import {clearToast} from '../src/ui/toast';
const params=new URLSearchParams(location.search);
if(params.has('render2d')){const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind:any,options:any){return kind==='webgl'||kind==='webgl2'?null:get.call(this,kind,options);} as typeof get;}
const callbacks=new Map<number,(value:any)=>void>(),calls:{command:string;args:any}[]=[],leases=new Map<string,{acked:number;next:number}>();let callbackId=0,released=0,errors:string[]=[],mode='current',checks=0;
let primeCloud=false;
const bridge=new EventTarget() as EventTarget&{releaseBuffer:(buffer:ArrayBuffer)=>void};bridge.releaseBuffer=()=>{released++;};(window as any).chrome??={};(window as any).chrome.webview=bridge;
const data:any={scope:'mock',update:{revision:1,state:'idle',currentVersion:'1.0.0',latestVersion:null,notes:null,checkedAt:null,downloadedBytes:0,totalBytes:null,message:'',packageKind:'portable',supported:true,canInstall:false,canDownload:false}};
const invoke=async(command:string,args:any={})=>{
 calls.push({command,args});
 if(command==='plugin:event|listen')return args.handler;
 if(command==='plugin:event|unlisten'){callbacks.delete(args.eventId);return;}
 if(command==='camera_decode_open'){leases.set(args.id,{acked:0,next:0});return;}
 if(command==='camera_decode_ack'){const l=leases.get(args.id);if(l)l.acked=args.sequence;return;}
 if(command==='camera_decode_close'){leases.delete(args.id);return;}
 if(command==='camera_decode_finish'&&primeCloud){setTimeout(()=>{if(leases.has(args.id))sendFrame({id:args.id},0,640,360,false,320,180);},0);return;}
 if(command==='camera_decode_feed'||command==='camera_decode_finish'||command==='camera_decode_viewport')return;
 if(command==='check_app_update'){checks++;await new Promise(r=>setTimeout(r,50));if(mode==='throw')throw Error('mock network');return {...data.update,revision:++data.update.revision,state:mode,latestVersion:mode==='available'?'1.0.1':null,canDownload:mode==='available',message:'DO NOT DISPLAY BACKEND PROSE'};}
 throw Error('Mock denied: '+command);
};
(window as any).__TAURI_INTERNALS__={invoke,transformCallback:(fn:any)=>{const id=++callbackId;callbacks.set(id,fn);return id;},unregisterCallback:(id:number)=>callbacks.delete(id)};(window as any).isTauri=true;
(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:(_event:string,id:number)=>callbacks.delete(id)};
const root=document.querySelector<HTMLElement>('#app')!,settings=document.createElement('section'),viewport=document.createElement('section'),video=document.createElement('video');
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
const fixture={calls,controller,viewport,video,errors,seeks,get released(){return released;},get checks(){return checks;},get frameCallbacks(){return frameCallbacks;},get state(){const v=mediaView(video);return {width:v.videoWidth,height:v.videoHeight,ready:v.readyState,time:v.currentTime,paused:v.paused,ended:v.ended,leases:leases.size,canvas:!!viewport.querySelector('canvas')};},setMode(value:string){mode=value;},render,clearToast(){clearToast(document.body);},
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
 async diagnostic(){
  const oldUrl=URL.createObjectURL,oldClick=HTMLAnchorElement.prototype.click;
  let report:Promise<string>|undefined;
  try{
   URL.createObjectURL=blob=>{report=(blob as Blob).text();return oldUrl.call(URL,blob);};
   HTMLAnchorElement.prototype.click=()=>{};
   recordPlaybackInput(video,'hevc',220000);
   recordPlaybackSample(video,'uhd');
   exportPlaybackDiagnostics([video]);
   return JSON.parse((await report)??'{}');
  }finally{URL.createObjectURL=oldUrl;HTMLAnchorElement.prototype.click=oldClick;}
 },
 async open(format:'mpegts'|'mp4'='mpegts'){detachSurface(video);surface=await CompatVideo.open(video,{format,preserveSource:format==='mpegts',size:format==='mp4'?100:0,duration:10,seek:time=>seeks.push(time),error:message=>errors.push(message)});await surface.play();},
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
 watch(){requestMediaFrame(video,()=>{frameCallbacks++;});},shot(){return captureCameraLens(video);},layoutShot(){return captureCameraLayout(viewport,[video]);},pause(){surface?.pause();},play(){return surface?.play();},seek(value:number){if(surface)surface.currentTime=value;},close(){detachSurface(video);surface=undefined;},acknowledged(){const lease=surface&&leases.get(surface.id);return !lease||lease.acked===lease.next;},
 stale(){for(const fn of callbacks.values())fn({event:'camera-decoder-error',payload:{id:surface?.id,kind:'staleContext'}});}
};(window as any).compatFixture=fixture;
