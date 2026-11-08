import type mpegts from 'mpegts.js';
import {nativeVideoPlayer,nativeVideoSupported} from './native-video';
import {CameraFrameClock,type CameraRecordingPoint} from './camera-frame-clock';
import type {CameraEvent} from './camera-types';

export interface CameraLensFrameStats {count:number;lastFrameAt:number;width:number;height:number}
const BUFFER_LIMIT=4*1024*1024;
const FRAME_TIMEOUT=15000;

/** A decoder for one lens only. The owning camera session supplies every event. */
export class CameraLensPlayer {
 readonly viewport=document.createElement('div');
 readonly element=this.viewport;
 readonly video=document.createElement('video');
 private status=document.createElement('p');
 private player?:mpegts.Player;
 private push?:((data:ArrayBuffer)=>void);
 private pending:ArrayBuffer[]=[];
 private pendingBytes=0;
 private revision=-1;
 private clock=new CameraFrameClock();
 private lastRecordingPoint:CameraRecordingPoint={};
 private epoch=0;
 private request?:number;
 private timeout?:ReturnType<typeof setTimeout>;
 private disposed=false;
 private hasFrame=false;
 private warned=false;
 private decoderFailed=false;
 private stats:CameraLensFrameStats={count:0,lastFrameAt:0,width:0,height:0};

 constructor(readonly lensId:number,private onFrame:(stats:CameraLensFrameStats)=>void=()=>{},private onError:(message:string)=>void=()=>{}) {
  this.viewport.className='camera-secondary-viewport';
  this.viewport.dataset.lensId=String(lensId);
  this.viewport.style.cssText='background:#000;aspect-ratio:16/9;overflow:hidden';
  this.video.muted=true;this.video.autoplay=true;this.video.playsInline=true;
  this.video.setAttribute('aria-label',`摄像机镜头 ${lensId} 实时画面`);
  this.video.style.cssText='position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:contain;object-position:center;background:#000';
  this.status.className='camera-secondary-state';
  this.status.setAttribute('role','status');
  this.status.style.cssText='position:absolute;inset:0;display:grid;place-items:center;margin:0;padding:8px;color:#aaa;font-size:12px;text-align:center;pointer-events:none';
  this.viewport.append(this.video,this.status);
  this.video.addEventListener('error',this.videoError);
  this.reset();
 }

 get playing():boolean{return this.hasFrame&&!this.disposed;}
 get frames():CameraLensFrameStats{return {...this.stats};}
 get latestCount():number{return this.stats.count;}
 get recordingPoint(){return this.video.readyState>=2?{...this.lastRecordingPoint,...this.clock.at(this.video.currentTime)}:this.lastRecordingPoint;}

 feed(event:CameraEvent&{lensId?:number}):void {
  if(this.disposed||event.lensId!==undefined&&event.lensId!==this.lensId)return;
  const revision=event.streamRevision??0;
  if(revision<this.revision)return;
  if(event.error){this.unavailable(event.error.message);return;}
  if(event.state==='stopped'){this.reset('此镜头已停止');return;}
  if(event.state==='waiting-frame'&&!this.hasFrame)this.show('等待画面…');
  if(event.state!=='media'||!event.data)return;
  if(revision===this.revision&&this.decoderFailed)return;
  if(revision>this.revision||!this.player){
   this.clearDecoder();this.revision=revision;
   this.hasFrame=false;this.warned=false;this.decoderFailed=false;this.show('等待画面…');
   if(!nativeVideoSupported()){this.fail('当前环境不支持此镜头的视频播放',true);return;}
   this.attach();
  }
  if(!this.player)return;
  this.clock.observe(event,this.video.currentTime);
  try {
   const bytes=Uint8Array.from(atob(event.data),character=>character.charCodeAt(0));
   if(bytes.byteLength>BUFFER_LIMIT){this.fail('此镜头的视频数据过大',true);return;}
   if(this.push)this.push(bytes.buffer);
   else if(this.pendingBytes+bytes.byteLength<=BUFFER_LIMIT){this.pending.push(bytes.buffer);this.pendingBytes+=bytes.byteLength;}
   else this.fail('此镜头暂未返回可播放的画面',true);
  } catch {this.fail('此镜头的视频数据无法解码',true);}
 }

 /** A session restart resets its independent revision, buffers and frame counter. */
 reset(message='等待画面…'):void {
  if(this.disposed)return;
  this.clearDecoder();this.revision=-1;this.hasFrame=false;this.warned=false;this.decoderFailed=false;
  this.lastRecordingPoint={};
  this.stats={count:0,lastFrameAt:0,width:0,height:0};
  this.viewport.dataset.decodedFrames='0';delete this.viewport.dataset.videoWidth;delete this.viewport.dataset.videoHeight;
  this.show(message);
 }

 unavailable(message:string):void {
  if(this.disposed)return;
  this.clearDecoder();this.hasFrame=false;this.show(message);
 }

 dispose():void {
  if(this.disposed)return;
  this.disposed=true;this.clearDecoder();this.hasFrame=false;
  this.video.removeEventListener('error',this.videoError);
 }

 private videoError=()=>{if(!this.disposed&&this.player)this.fail('当前视频解码器不支持此镜头返回的编码',true);};
 private show(message:string):void {this.status.textContent=message;this.status.hidden=!message;this.status.style.display=message?'grid':'none';this.viewport.dataset.videoState=message?'waiting-frame':'playing';}
 private fail(message:string,terminal=false):void {if(terminal){this.clearDecoder();this.decoderFailed=true;}this.hasFrame=false;this.show(message);if(!this.warned){this.warned=true;this.onError(message);}}
 private attach():void {
  const epoch=this.epoch;
  try {
   const player=nativeVideoPlayer(this.video,feed=>{
    if(epoch!==this.epoch||this.disposed)return()=>{};
    this.push=feed;const pending=this.pending;this.pending=[];this.pendingBytes=0;
    for(const data of pending)feed(data);
    return()=>{if(epoch===this.epoch)this.push=undefined;};
   },()=>{if(epoch===this.epoch&&!this.disposed)this.fail('此镜头的视频格式或解码不受当前环境支持',true);},true);
   if(epoch!==this.epoch||this.disposed){player.destroy();return;}
   this.player=player;
   this.watchFrame(epoch);this.armMissing(epoch);
   void Promise.resolve(player.play()).catch(()=>{});
  } catch {if(epoch===this.epoch)this.fail('此镜头的视频播放器无法启动',true);}
 }

 private watchFrame(epoch:number):void {
  if(epoch!==this.epoch||this.disposed)return;
  this.request=this.video.requestVideoFrameCallback(()=>{
   if(epoch!==this.epoch||this.disposed)return;
   this.request=undefined;this.hasFrame=true;this.warned=false;
   this.lastRecordingPoint=this.clock.at(this.video.currentTime);
   this.stats={count:this.stats.count+1,lastFrameAt:performance.now(),width:this.video.videoWidth,height:this.video.videoHeight};
   this.viewport.dataset.decodedFrames=String(this.stats.count);
   this.viewport.dataset.videoWidth=String(this.stats.width);this.viewport.dataset.videoHeight=String(this.stats.height);
   if(this.stats.width>0&&this.stats.height>0)this.viewport.style.aspectRatio=`${this.stats.width}/${this.stats.height}`;
   this.show('');this.armMissing(epoch);this.onFrame(this.frames);this.watchFrame(epoch);
  });
 }

 private armMissing(epoch:number):void {
  if(this.timeout)clearTimeout(this.timeout);
  this.timeout=setTimeout(()=>{this.timeout=undefined;if(epoch===this.epoch&&!this.disposed)this.fail('此镜头暂未返回画面');},FRAME_TIMEOUT);
 }

 private clearDecoder():void {
  ++this.epoch;
  this.clock.reset();
  if(this.timeout)clearTimeout(this.timeout);this.timeout=undefined;
  if(this.request!==undefined)this.video.cancelVideoFrameCallback(this.request);this.request=undefined;
  this.push=undefined;this.pending=[];this.pendingBytes=0;
  const player=this.player;this.player=undefined;
  if(player){try{player.pause();}catch{/* An unsupported decoder can already be detached. */}try{player.unload();}catch{/* Keep the other lens independent. */}try{player.detachMediaElement();}catch{/* Best-effort decoder disposal. */}try{player.destroy();}catch{/* Native session ownership remains with the caller. */}}
  this.video.removeAttribute('src');this.video.load();
 }
}

interface VideoLayout {video:HTMLVideoElement;rect:DOMRect;clip:{left:number;top:number;right:number;bottom:number};primary:boolean}

/** One decoded lens only, independent of page/fullscreen geometry and tools. */
export function captureCameraLens(video:HTMLVideoElement):string{
 if(video.readyState<2||video.videoWidth<=0||video.videoHeight<=0)throw Error('等待该镜头的实际画面后可截图。');
 const scale=Math.min(1,4096/video.videoWidth,4096/video.videoHeight,Math.sqrt(16*1024*1024/(video.videoWidth*video.videoHeight)));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('当前环境无法生成截图。');ctx.drawImage(video,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png').split(',')[1];
}

function visibleLayout(container:HTMLElement,video:HTMLVideoElement):VideoLayout|undefined {
 if(!video.isConnected||!container.contains(video)||!video.getClientRects().length)return;
 const rect=video.getBoundingClientRect(),bounds=container.getBoundingClientRect();
 if(rect.width<=0||rect.height<=0||bounds.width<=0||bounds.height<=0)return;
 const clip={left:Math.max(rect.left,bounds.left),top:Math.max(rect.top,bounds.top),right:Math.min(rect.right,bounds.right),bottom:Math.min(rect.bottom,bounds.bottom)};
 for(let current:HTMLElement|null=video;current;current=current.parentElement){
  const style=getComputedStyle(current);
  if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0)return;
  if(current!==video&&current!==container){
   const bounds=current.getBoundingClientRect();
   if(/hidden|clip|auto|scroll/.test(style.overflowX)){clip.left=Math.max(clip.left,bounds.left);clip.right=Math.min(clip.right,bounds.right);}
   if(/hidden|clip|auto|scroll/.test(style.overflowY)){clip.top=Math.max(clip.top,bounds.top);clip.bottom=Math.min(clip.bottom,bounds.bottom);}
  }
  if(current===container)break;
 }
 if(clip.left>=clip.right||clip.top>=clip.bottom)return;
 const primary=video.closest<HTMLElement>('[data-primary]')?.dataset.primary==='true';
 return {video,rect,clip,primary};
}

/** Capture video pixels only, following the current stacked or picture-in-picture layout. */
export function captureCameraLayout(container:HTMLElement,videos:readonly HTMLVideoElement[]):string {
 const layouts=videos.map(video=>visibleLayout(container,video)).filter((layout):layout is VideoLayout=>!!layout);
 if(!layouts.some(({video})=>video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0))throw new Error('等待视频画面后可截图。');
 const left=Math.min(...layouts.map(({clip})=>clip.left)),top=Math.min(...layouts.map(({clip})=>clip.top));
 const right=Math.max(...layouts.map(({clip})=>clip.right)),bottom=Math.max(...layouts.map(({clip})=>clip.bottom));
 const width=right-left,height=bottom-top;
 const main=layouts.find(layout=>layout.primary)??layouts[0];
 const scale=Math.min(Math.min(main.video.videoWidth||main.rect.width,4096)/main.rect.width,8192/width,8192/height,Math.sqrt(16*1024*1024/(width*height)));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
 const context=canvas.getContext('2d');if(!context)throw new Error('当前环境无法生成截图。');
 context.fillStyle='#000';context.fillRect(0,0,canvas.width,canvas.height);
 // Draw the large image first, then the inset. Otherwise preserve the caller's DOM paint order.
 layouts.sort((a,b)=>Number(b.primary)-Number(a.primary));
 let painted=0;
 for(const {video,rect,clip}of layouts){
  if(video.readyState<2||video.videoWidth<=0||video.videoHeight<=0)continue;
  const ratio=Math.min(rect.width/video.videoWidth,rect.height/video.videoHeight);
  const destinationWidth=video.videoWidth*ratio,destinationHeight=video.videoHeight*ratio;
  const x=rect.left+(rect.width-destinationWidth)/2,y=rect.top+(rect.height-destinationHeight)/2;
  context.save();context.beginPath();context.rect((clip.left-left)*scale,(clip.top-top)*scale,(clip.right-clip.left)*scale,(clip.bottom-clip.top)*scale);context.clip();
  try{context.fillStyle='#000';context.fillRect((rect.left-left)*scale,(rect.top-top)*scale,rect.width*scale,rect.height*scale);context.drawImage(video,(x-left)*scale,(y-top)*scale,destinationWidth*scale,destinationHeight*scale);++painted;}
  catch{/* A lens can lose its decoded image while the other lens remains usable. */}
  finally{context.restore();}
 }
 if(!painted)throw new Error('等待视频画面后可截图。');
 return canvas.toDataURL('image/png').split(',')[1];
}
