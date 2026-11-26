import {invoke} from '@tauri-apps/api/core';
import {listen,type UnlistenFn} from '@tauri-apps/api/event';
import {attachSurface,detachSurface,mediaContext,mediaIsInset,mediaLayout,type SoftwareSurface} from './media-surface';
import {REPLAY_FORWARD_BYTES} from './camera-replay-buffer';

interface Frame{kind:number;width:number;height:number;sourceWidth:number;sourceHeight:number;pts:number;duration:number;bytes:number;rate:number;droppedFrames?:number}
interface SharedEvent extends Event{additionalData:{kind:string;id:string;sequence:number;frame:Frame};getBuffer():ArrayBuffer}
interface Bridge{addEventListener(name:string,listener:EventListener):void;removeEventListener(name:string,listener:EventListener):void;releaseBuffer(buffer:ArrayBuffer):void}
const active=new Map<string,CompatVideo>();
function bridge():Bridge|undefined{return (window as unknown as {chrome?:{webview?:Bridge}}).chrome?.webview;}
const receive:EventListener=event=>{const e=event as SharedEvent;if(e.additionalData?.kind!=='mijia-software-media')return;
 const buffer=e.getBuffer(),target=active.get(e.additionalData.id);if(target)target.frame(e.additionalData.frame,buffer,e.additionalData.sequence);else bridge()?.releaseBuffer(buffer);
};
let unlisten:UnlistenFn|undefined;let listening:Promise<void>|undefined;
const opening=new Set<()=>boolean>();
const available=new EventTarget();
let closingDecoders=0;
let capacityRevision=0;
function capacityChanged():void{
 ++capacityRevision;
 available.dispatchEvent(new Event('available'));
}
function unsubscribeIfIdle():void{
 if(active.size||opening.size||closingDecoders)return;
 bridge()?.removeEventListener('sharedbufferreceived',receive);
 unlisten?.();unlisten=undefined;listening=undefined;
}
function closeDecoder(id:string):Promise<void>{
 // A buffer posted before cancellation can still reach the shared listener.
 ++closingDecoders;
 return invoke<void>('camera_decode_close',{id}).catch(()=>{}).finally(()=>{
  --closingDecoders;
  unsubscribeIfIdle();
 });
}
async function subscribe():Promise<void>{
 if(!listening){
  bridge()?.addEventListener('sharedbufferreceived',receive);
  listening=(async()=>{
   const removeError=await listen<{id:string;kind:string}>('camera-decoder-error',e=>active.get(e.payload.id)?.fail(e.payload.kind));
   try{
    const removeAvailable=await listen('camera-decoder-available',capacityChanged);
    mediaLayout.addEventListener('change',capacityChanged);
    unlisten=()=>{removeError();removeAvailable();mediaLayout.removeEventListener('change',capacityChanged);};
   }catch(error){removeError();throw error;}
  })().catch(error=>{listening=undefined;bridge()?.removeEventListener('sharedbufferreceived',receive);throw error;});
 }
 await listening;
}
function waitForCapacity(revision:number,signal?:AbortSignal):Promise<void>{
 signal?.throwIfAborted();
 if(revision!==capacityRevision)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const ready=()=>{signal?.removeEventListener('abort',cancel);resolve();};
  const cancel=()=>{available.removeEventListener('available',ready);reject(signal?.reason);};
  available.addEventListener('available',ready,{once:true});
  signal?.addEventListener('abort',cancel,{once:true});
 });
}
function base64(bytes:Uint8Array):string{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}
interface Options{format:'mpegts'|'mp4';preserveSource?:boolean;replay?:boolean;size?:number;offset?:number;duration?:number;seek?:(time:number)=>void;signal?:AbortSignal;capacity?:(waiting:boolean)=>void;yielded?:()=>void;error:(message:string)=>void}

function previewViewport(width:number,height:number,dpr:number,focused:boolean):{width:number;height:number} {
 const pixels={width:Math.max(1,width*dpr),height:Math.max(1,height*dpr)};
 const [long,short]=focused?[3840,2160]:[1920,1080];
 const portrait=width<height;
 const scale=Math.min(1,(portrait?short:long)/pixels.width,(portrait?long:short)/pixels.height);
 return {width:Math.max(1,Math.floor(pixels.width*scale)),height:Math.max(1,Math.floor(pixels.height*scale))};
}
function viewportSize(video:HTMLVideoElement,format:Options['format'],starting=false):{width:number;height:number}|undefined{
 const width=video.clientWidth,height=video.clientHeight;
 if((!width||!height)&&!starting)return;
 const tile=video.closest('.monitor-tile'),grid=tile?.parentElement,fullscreen=document.fullscreenElement;
 const focused=format==='mpegts'&&(!tile||!grid||grid.querySelectorAll(':scope > .monitor-tile').length<=1||!!fullscreen&&tile.contains(fullscreen)&&fullscreen.contains(video));
 return previewViewport(width||1280,height||720,devicePixelRatio||1,focused);
}

class Renderer{
 private gl:WebGLRenderingContext|null;private context:CanvasRenderingContext2D|null=null;private texture?:WebGLTexture;private textureLimit=0;
 constructor(private canvas:HTMLCanvasElement){
  this.gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
  if(this.gl){try{const g=this.gl,program=g.createProgram()!;
   const precision=g.getShaderPrecisionFormat(g.FRAGMENT_SHADER,g.HIGH_FLOAT)?.precision?'highp':'mediump';
   for(const [kind,source]of [[g.VERTEX_SHADER,`attribute vec2 p;varying ${precision} vec2 uv;void main(){uv=vec2((p.x+1.)*.5,(1.-p.y)*.5);gl_Position=vec4(p,0.,1.);}`],[g.FRAGMENT_SHADER,`precision ${precision} float;varying ${precision} vec2 uv;uniform sampler2D image;void main(){gl_FragColor=texture2D(image,uv);}`]] as const){const shader=g.createShader(kind)!;g.shaderSource(shader,source);g.compileShader(shader);if(!g.getShaderParameter(shader,g.COMPILE_STATUS))throw Error();g.attachShader(program,shader);g.deleteShader(shader);}
   g.linkProgram(program);if(!g.getProgramParameter(program,g.LINK_STATUS))throw Error();g.useProgram(program);g.bindBuffer(g.ARRAY_BUFFER,g.createBuffer());g.bufferData(g.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),g.STATIC_DRAW);const p=g.getAttribLocation(program,'p');g.enableVertexAttribArray(p);g.vertexAttribPointer(p,2,g.FLOAT,false,0,0);
   this.texture=g.createTexture()!;g.bindTexture(g.TEXTURE_2D,this.texture);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);
  }catch{this.gl.getExtension('WEBGL_lose_context')?.loseContext();this.gl=null;}}
  if(this.gl){this.textureLimit=this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);canvas.dataset.renderer='software-webgl';canvas.addEventListener('webglcontextlost',this.contextLost);}
  else this.useCanvas();
 }
 private contextLost=()=>{try{this.useCanvas();}catch{/* The next frame reports a rendering error. */}};
 private useCanvas():void{
  // Once a canvas has owned WebGL, the browser cannot give it a 2D context.
  this.canvas.removeEventListener('webglcontextlost',this.contextLost);
  this.gl?.getExtension('WEBGL_lose_context')?.loseContext();this.gl=null;this.texture=undefined;
  const replacement=this.canvas.cloneNode(false) as HTMLCanvasElement;
  this.context=replacement.getContext('2d',{alpha:false});
  if(!this.context)throw Error('无法创建视频画面。');
  replacement.dataset.renderer='software-canvas';
  this.canvas.replaceWith(replacement);this.canvas=replacement;
 }
 get element():HTMLCanvasElement{return this.canvas;}
 draw(frame:Frame,buffer:ArrayBuffer):void{
  if(this.gl&&(this.gl.isContextLost()||frame.width>this.textureLimit||frame.height>this.textureLimit))this.useCanvas();
  const c=this.canvas;if(c.width!==frame.width||c.height!==frame.height){c.width=frame.width;c.height=frame.height;}
  c.dataset.sourceWidth=String(frame.sourceWidth);c.dataset.sourceHeight=String(frame.sourceHeight);
  c.dataset.droppedFrames=String(frame.droppedFrames??0);
  if(this.gl&&!this.gl.isContextLost()){const g=this.gl;g.viewport(0,0,c.width,c.height);g.bindTexture(g.TEXTURE_2D,this.texture!);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,c.width,c.height,0,g.RGBA,g.UNSIGNED_BYTE,new Uint8Array(buffer));g.drawArrays(g.TRIANGLE_STRIP,0,4);}
  else if(this.context)this.context.putImageData(new ImageData(new Uint8ClampedArray(buffer),c.width,c.height),0,0);
  else throw Error('视频绘制中断。');
 }
 dispose():void{this.canvas.removeEventListener('webglcontextlost',this.contextLost);this.gl?.getExtension('WEBGL_lose_context')?.loseContext();this.canvas.remove();}
}

/** One bounded output frame stays in shared memory until consumed. The backend
 * blocks its pipe reader instead of accumulating decoded pictures in JS. */
export class CompatVideo implements SoftwareSurface{
 private renderer:Renderer;private disposed=false;private failed=false;private chain=Promise.resolve();private queued=0;private count=0;private stamp=0;private needsKeyframe=false;
 private pausedValue=true;private rate=1;private base=0;private started=0;private sourceWidth=0;private sourceHeight=0;private pending?:{frame:Frame;buffer:ArrayBuffer;sequence:number};private animation?:number;private context?:AudioContext;private audio=new Set<AudioBufferSourceNode>();private complete=false;
 private renderTimer?:ReturnType<typeof setTimeout>;
 private viewportObserver?:ResizeObserver;private dpi?:MediaQueryList;private viewportTimer?:ReturnType<typeof setTimeout>;
 private viewportWriting=false;private viewportDirty=false;private viewportSent='';
 private closing?:Promise<void>;
 private constructor(readonly id:string,private video:HTMLVideoElement,private options:Options){
  const canvas=document.createElement('canvas');canvas.style.cssText=video.style.cssText;canvas.style.position='absolute';canvas.style.inset='0';canvas.style.width='100%';canvas.style.height='100%';canvas.style.objectFit='contain';canvas.style.pointerEvents='none';canvas.style.background='#000';video.after(canvas);
  try{this.renderer=new Renderer(canvas);}
  catch(error){canvas.remove();throw error;}
  this.canvas.setAttribute('role','img');this.canvas.setAttribute('aria-label',video.getAttribute('aria-label')??'摄像机画面');this.rate=video.playbackRate;this.pausedValue=!video.autoplay;this.video.style.visibility='hidden';this.video.dataset.decoder='software';this.base=options.offset??0;
 }
 static async open(video:HTMLVideoElement,options:Options):Promise<CompatVideo>{
  options.signal?.throwIfAborted();
  const context=mediaContext(video);if(!context||!bridge())throw Error('兼容播放器暂不可用。');
  const id=crypto.randomUUID();
  const isInset=()=>!!options.yielded&&mediaIsInset(video);
  opening.add(isInset);
  let admitted=false,waiting=false,surface:CompatVideo|undefined;
  const showWaiting=()=>{if(!waiting){waiting=true;options.capacity?.(true);}};
  try{
   detachSurface(video);
   await subscribe();
   let size:{width:number;height:number}|undefined;
   for(;;){
    options.signal?.throwIfAborted();
    const revision=capacityRevision;
    if(isInset()&&[...opening].some(isOtherInset=>!isOtherInset())){
     showWaiting();
     await waitForCapacity(revision,options.signal);
     continue;
    }
    size=options.preserveSource?undefined:viewportSize(video,options.format,true);
    try{
     await invoke('camera_decode_open',{id,context,format:options.format,size:options.size??0,offset:options.offset??0,preserveSource:options.preserveSource,replay:options.replay,...size});
     admitted=true;
     break;
    }catch(error){
     if((error as {kind?:string}|null)?.kind!=='decodeCapacity')throw error;
     options.signal?.throwIfAborted();
     showWaiting();
     if(revision===capacityRevision&&!isInset()){
      const inset=[...active.values()].find(candidate=>candidate.canYield);
      if(inset){
       await inset.releaseInset();
       continue;
      }
     }
     await waitForCapacity(revision,options.signal);
    }
   }
   options.signal?.throwIfAborted();
   surface=new CompatVideo(id,video,options);
   active.set(id,surface);attachSurface(video,surface);
   if(options.format==='mpegts'&&size){
    surface.viewportSent=`${size.width}x${size.height}`;
    surface.startViewportObservation();
   }
   return surface;
  }catch(error){
   if(surface)detachSurface(video,surface);
   else if(admitted)await closeDecoder(id);
   throw error;
  }finally{
   if(waiting)options.capacity?.(false);
   opening.delete(isInset);
   // Another request may be waiting for this main request to settle, or
   // may have hit capacity before a reclaimable inset became visible here.
   if(opening.size&&(!isInset()||surface?.canYield))capacityChanged();
   unsubscribeIfIdle();
  }
 }
 private get canYield():boolean{return !this.disposed&&!!this.options.yielded&&mediaIsInset(this.video);}
 private async releaseInset():Promise<void>{
  detachSurface(this.video,this);
  this.options.yielded?.();
  await this.closing;
 }
 private queueViewport=()=>{
  this.viewportDirty=true;
  if(!this.viewportTimer&&!this.viewportWriting&&!this.disposed){
   this.viewportTimer=setTimeout(()=>{this.viewportTimer=undefined;void this.sendViewport();},100);
  }
 };
 private async sendViewport():Promise<void>{
  if(this.disposed||!this.viewportDirty)return;
  this.viewportDirty=false;
  const size=viewportSize(this.video,this.options.format);
  if(!size)return;
  const key=`${size.width}x${size.height}`;
  if(key===this.viewportSent)return;
  this.viewportWriting=true;
  try{await invoke('camera_decode_viewport',{id:this.id,...size});this.viewportSent=key;}
  catch{/* A closing worker may have already removed its lease. */}
  finally{this.viewportWriting=false;if(this.viewportDirty)this.queueViewport();}
 }
 private dpiChanged=()=>{
  this.dpi?.removeEventListener('change',this.dpiChanged);
  this.dpi=matchMedia(`(resolution: ${devicePixelRatio||1}dppx)`);
  this.dpi.addEventListener('change',this.dpiChanged);
  this.queueViewport();
 };
 private startViewportObservation():void{
  this.viewportObserver=new ResizeObserver(this.queueViewport);
  this.viewportObserver.observe(this.video);
  document.addEventListener('fullscreenchange',this.queueViewport);
  window.addEventListener('resize',this.queueViewport);
  this.dpiChanged();
 }
 get canvas():HTMLCanvasElement{return this.renderer.element;}
 get videoWidth():number{return this.count?this.sourceWidth||this.canvas.width:0;}get videoHeight():number{return this.count?this.sourceHeight||this.canvas.height:0;}
 get readyState():number{return this.count?2:0;}get error():MediaError|null{return this.failed?{code:3,message:'视频解码失败。'} as MediaError:null;}
 get duration():number{return this.options.duration??Infinity;}get ended():boolean{return this.complete&&!this.pending;}
 private get clockTime():number{return this.pausedValue||!this.started?this.base:Math.min(this.duration,this.base+(performance.now()-this.started)*this.rate/1000);}
 get currentTime():number{
  if(this.options.format==='mp4')return this.clockTime;
  if(!this.options.replay||!this.count)return this.stamp;
  if(this.pausedValue)return this.base;
  return this.pending?Math.max(this.stamp,Math.min(this.pending.frame.pts,this.clockTime)):this.stamp;
 }
 set currentTime(time:number){this.options.seek?.(time);}
 get paused():boolean{return this.pausedValue;}get muted():boolean{return this.video.muted;}set muted(value:boolean){this.video.muted=value;if(value)this.stopAudio();}
 get playbackRate():number{return this.rate;}set playbackRate(value:number){if(!Number.isFinite(value)||value<.25||value>4||value===this.rate)return;this.base=this.currentTime;this.started=performance.now();this.rate=value;this.video.playbackRate=value;if(value!==1)this.stopAudio();this.schedule();}
 get buffered():TimeRanges{const start=this.currentTime,end=Math.max(start,this.pending?.frame.pts??start);return {length:this.count?1:0,start:()=>start,end:()=>end};}
 async play():Promise<void>{if(this.disposed)return;this.base=this.currentTime;this.started=performance.now();this.pausedValue=false;await this.context?.resume();if(this.disposed||this.pausedValue)return;this.video.dispatchEvent(new Event('play'));this.schedule();}
 pause():void{this.base=this.currentTime;this.pausedValue=true;clearTimeout(this.renderTimer);this.renderTimer=undefined;this.stopAudio();this.video.dispatchEvent(new Event('pause'));}
 feed(bytes:ArrayBuffer,keyframe?:boolean):Promise<void>{
  if(this.disposed)return Promise.resolve();
  if(this.needsKeyframe&&keyframe===false)return Promise.resolve();
  if(this.options.format==='mpegts'&&this.queued+bytes.byteLength>(this.options.replay?REPLAY_FORWARD_BYTES:4*1024*1024)){
   if(this.options.replay)this.fail('decodeBackpressure');
   else this.needsKeyframe=true;
   return Promise.resolve();
  }
  this.needsKeyframe=false;
  this.queued+=bytes.byteLength;
  const task=this.chain.then(async()=>{for(let i=0;i<bytes.byteLength&&!this.disposed;i+=256*1024)await invoke('camera_decode_feed',{id:this.id,data:base64(new Uint8Array(bytes,i,Math.min(256*1024,bytes.byteLength-i)))});});
  this.chain=task.catch(()=>{if(!this.disposed)this.fail('decodeInput');}).finally(()=>{this.queued-=bytes.byteLength;});return task;
 }
 async finish():Promise<void>{await this.chain;if(!this.disposed)await invoke('camera_decode_finish',{id:this.id});}
 frame(frame:Frame,buffer:ArrayBuffer,sequence:number):void{
  if(this.disposed){bridge()?.releaseBuffer(buffer);return;}
  if(frame.bytes!==buffer.byteLength||!Number.isFinite(frame.pts)||frame.bytes>3840*2160*4){bridge()?.releaseBuffer(buffer);this.fail('decodeProtocol');return;}
  if(this.pending){bridge()?.releaseBuffer(buffer);this.fail('decodeBackpressure');return;}
  this.pending={frame,buffer,sequence};this.schedule();
 }
 private schedule(delay=0):void{
  if(this.disposed||!this.pending)return;
  clearTimeout(this.renderTimer);this.renderTimer=undefined;
  if(delay>32){this.renderTimer=setTimeout(()=>this.schedule(),delay-16);return;}
  if(this.animation===undefined)this.animation=requestAnimationFrame(()=>{this.animation=undefined;this.render();});
 }
 private render():void{
  const pending=this.pending;if(!pending||this.disposed)return;const {frame,buffer,sequence}=pending;
  const paced=this.options.replay||this.options.format==='mp4';
  if(paced&&this.count&&this.pausedValue)return;
  if(paced&&this.count&&frame.pts>this.clockTime+.025){this.schedule((frame.pts-this.clockTime)*1000/this.rate);return;}
  this.pending=undefined;
  try{
   if(frame.kind===1){if(frame.width<1||frame.height<1||frame.width*frame.height*4!==frame.bytes)throw Error();this.renderer.draw(frame,buffer);this.stamp=frame.pts;this.sourceWidth=frame.sourceWidth;this.sourceHeight=frame.sourceHeight;
    if(++this.count===1){
     this.base=frame.pts;this.started=performance.now();this.video.dispatchEvent(new Event('loadedmetadata'));this.video.dispatchEvent(new Event('loadeddata'));
    }else if(this.options.replay&&frame.pts<this.clockTime-.25){
     // After late delivery, do not run through all subsequent frames to catch the wall clock.
     this.base=frame.pts;this.started=performance.now();
    }
    const metadata={width:this.videoWidth,height:this.videoHeight,presentedFrames:this.count,mediaTime:frame.pts,expectedDisplayTime:performance.now(),presentationTime:performance.now(),processingDuration:0} as VideoFrameCallbackMetadata;
    this.video.dispatchEvent(new CustomEvent('decoded-media-frame',{detail:metadata}));this.video.dispatchEvent(new Event('timeupdate'));
   }else if(frame.kind===2)this.sound(frame,buffer);
   else if(frame.kind===4){this.complete=true;this.pausedValue=true;this.base=frame.pts;this.video.dispatchEvent(new Event('ended'));}
  }catch{this.fail('decodeRender');}
  finally{bridge()?.releaseBuffer(buffer);if(!this.disposed)void invoke('camera_decode_ack',{id:this.id,sequence}).catch(()=>this.fail('decodeClosed'));}
 }
 private sound(frame:Frame,buffer:ArrayBuffer):void{
  if(this.muted||this.rate!==1||this.pausedValue||frame.rate!==48000||buffer.byteLength%8)return;
  this.context??=new AudioContext();void this.context.resume();const values=new Float32Array(buffer),count=values.length/2;
  if(count>48000||this.audio.size>=32)return;const data=this.context.createBuffer(2,count,48000);
  for(let channel=0;channel<2;channel++){const target=data.getChannelData(channel);for(let i=0;i<count;i++)target[i]=values[i*2+channel];}
  const source=this.context.createBufferSource();source.buffer=data;source.connect(this.context.destination);this.audio.add(source);source.onended=()=>{source.disconnect();this.audio.delete(source);};
  source.start(this.context.currentTime+Math.max(0,Math.min(.5,frame.pts-this.currentTime)));
 }
 private stopAudio():void{for(const source of this.audio){try{source.stop();}catch{/* Already ended. */}source.disconnect();}this.audio.clear();}
 fail(kind:string):void{if(this.disposed||this.failed)return;this.failed=true;try{this.options.error(kind==='staleContext'?'视频会话已关闭。':'视频暂时无法解码，请重试。');}finally{detachSurface(this.video,this);}}
 dispose():void{if(this.disposed)return;this.disposed=true;this.viewportObserver?.disconnect();this.dpi?.removeEventListener('change',this.dpiChanged);document.removeEventListener('fullscreenchange',this.queueViewport);window.removeEventListener('resize',this.queueViewport);clearTimeout(this.viewportTimer);clearTimeout(this.renderTimer);
  if(this.animation!==undefined)cancelAnimationFrame(this.animation);if(this.pending){bridge()?.releaseBuffer(this.pending.buffer);this.pending=undefined;}this.stopAudio();void this.context?.close();this.context=undefined;this.renderer.dispose();this.video.style.visibility='';delete this.video.dataset.decoder;active.delete(this.id);this.closing=closeDecoder(this.id);
 }
}
