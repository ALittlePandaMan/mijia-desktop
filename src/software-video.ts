import {invoke} from '@tauri-apps/api/core';
import {listen,type UnlistenFn} from '@tauri-apps/api/event';
import {attachSurface,detachSurface,mediaContext,type SoftwareSurface} from './media-surface';
import {previewViewport} from './camera-playback-diagnostics';

interface Frame{kind:number;width:number;height:number;sourceWidth:number;sourceHeight:number;pts:number;duration:number;bytes:number;rate:number;droppedFrames?:number}
interface SharedEvent extends Event{additionalData:{kind:string;id:string;sequence:number;frame:Frame};getBuffer():ArrayBuffer}
interface Bridge{addEventListener(name:string,listener:EventListener):void;removeEventListener(name:string,listener:EventListener):void;releaseBuffer(buffer:ArrayBuffer):void}
const active=new Map<string,CompatVideo>();
function bridge():Bridge|undefined{return (window as unknown as {chrome?:{webview?:Bridge}}).chrome?.webview;}
const receive:EventListener=event=>{const e=event as SharedEvent;if(e.additionalData?.kind!=='mijia-software-media')return;
 const buffer=e.getBuffer(),target=active.get(e.additionalData.id);if(target)target.frame(e.additionalData.frame,buffer,e.additionalData.sequence);else bridge()?.releaseBuffer(buffer);
};
let removeError:UnlistenFn|undefined;let errorListening:Promise<void>|undefined;let pendingOpen=0;
function unsubscribeIfIdle():void{if(!active.size&&!pendingOpen){bridge()?.removeEventListener('sharedbufferreceived',receive);removeError?.();removeError=undefined;errorListening=undefined;}}
async function subscribe():Promise<void>{
 if(active.size===0)bridge()?.addEventListener('sharedbufferreceived',receive);
 await(errorListening??=listen<{id:string;kind:string}>('camera-decoder-error',e=>active.get(e.payload.id)?.fail(e.payload.kind)).then(remove=>{removeError=remove;}).catch(error=>{errorListening=undefined;if(!active.size)bridge()?.removeEventListener('sharedbufferreceived',receive);throw error;}));
}
function base64(bytes:Uint8Array):string{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}
interface Options{format:'mpegts'|'mp4';preserveSource?:boolean;size?:number;offset?:number;duration?:number;seek?:(time:number)=>void;signal?:AbortSignal;error:(message:string)=>void}

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
 readonly id=crypto.randomUUID();private renderer:Renderer;private disposed=false;private failed=false;private chain=Promise.resolve();private queued=0;private count=0;private stamp=0;
 private pausedValue=true;private rate=1;private base=0;private started=0;private sourceWidth=0;private sourceHeight=0;private pending?:{frame:Frame;buffer:ArrayBuffer;sequence:number};private animation?:number;private context?:AudioContext;private audio=new Set<AudioBufferSourceNode>();private complete=false;
 private viewportObserver?:ResizeObserver;private dpi?:MediaQueryList;private viewportTimer?:ReturnType<typeof setTimeout>;
 private viewportWriting=false;private viewportDirty=false;private viewportSent='';
 private constructor(private video:HTMLVideoElement,private options:Options){
  const canvas=document.createElement('canvas');canvas.style.cssText=video.style.cssText;canvas.style.position='absolute';canvas.style.inset='0';canvas.style.width='100%';canvas.style.height='100%';canvas.style.objectFit='contain';canvas.style.pointerEvents='none';canvas.style.background='#000';video.after(canvas);
  this.renderer=new Renderer(canvas);this.canvas.setAttribute('role','img');this.canvas.setAttribute('aria-label',video.getAttribute('aria-label')??'摄像机画面');this.rate=video.playbackRate;this.pausedValue=!video.autoplay;this.video.style.visibility='hidden';this.video.dataset.decoder='software';this.base=options.offset??0;
 }
 static async open(video:HTMLVideoElement,options:Options):Promise<CompatVideo>{
  options.signal?.throwIfAborted();
  const context=mediaContext(video);if(!context||!bridge())throw Error('兼容播放器暂不可用。');
  ++pendingOpen;let surface:CompatVideo;
  try{await subscribe();options.signal?.throwIfAborted();surface=new CompatVideo(video,options);active.set(surface.id,surface);attachSurface(video,surface);}
  finally{--pendingOpen;unsubscribeIfIdle();}
  const abort=()=>detachSurface(video,surface);
  options.signal?.addEventListener('abort',abort,{once:true});
  try{
   const size=options.preserveSource?undefined:surface.viewportSize(true);
   await invoke('camera_decode_open',{id:surface.id,context,format:options.format,size:options.size??0,offset:options.offset??0,preserveSource:options.preserveSource,...size});
   if(surface.disposed){await invoke('camera_decode_close',{id:surface.id}).catch(()=>{});throw new DOMException('Cancelled','AbortError');}
   if(options.format==='mpegts'&&size){
    surface.viewportSent=`${size.width}x${size.height}`;
    surface.startViewportObservation();
   }
   return surface;
  }
  catch(error){detachSurface(video,surface);throw error;}
  finally{options.signal?.removeEventListener('abort',abort);}
 }
 private viewportSize(starting=false):{width:number;height:number}|undefined{
  const width=this.video.clientWidth,height=this.video.clientHeight;
  if((!width||!height)&&!starting)return;
  const tile=this.video.closest('.monitor-tile'),grid=tile?.parentElement,fullscreen=document.fullscreenElement;
  const focused=this.options.format==='mpegts'&&(!tile||!grid||grid.querySelectorAll(':scope > .monitor-tile').length<=1||!!fullscreen&&tile.contains(fullscreen)&&fullscreen.contains(this.video));
  return previewViewport(width||1280,height||720,devicePixelRatio||1,focused);
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
  const size=this.viewportSize();
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
 get currentTime():number{return this.options.format==='mpegts'?this.stamp:this.pausedValue||!this.started?this.base:Math.min(this.duration,this.base+(performance.now()-this.started)*this.rate/1000);}
 set currentTime(time:number){this.options.seek?.(time);}
 get paused():boolean{return this.pausedValue;}get muted():boolean{return this.video.muted;}set muted(value:boolean){this.video.muted=value;if(value)this.stopAudio();}
 get playbackRate():number{return this.rate;}set playbackRate(value:number){if(!Number.isFinite(value)||value<.25||value>4)return;this.base=this.currentTime;this.started=performance.now();this.rate=value;this.video.playbackRate=value;if(value!==1)this.stopAudio();}
 get buffered():TimeRanges{const start=this.currentTime,end=Math.max(start,this.pending?.frame.pts??start);return {length:this.count?1:0,start:()=>start,end:()=>end};}
 async play():Promise<void>{if(this.disposed)return;this.base=this.currentTime;this.started=performance.now();this.pausedValue=false;await this.context?.resume();this.video.dispatchEvent(new Event('play'));this.schedule();}
 pause():void{this.base=this.currentTime;this.pausedValue=true;this.stopAudio();this.video.dispatchEvent(new Event('pause'));}
 feed(bytes:ArrayBuffer):Promise<void>{
  if(this.disposed)return Promise.resolve();if(this.options.format==='mpegts'&&this.queued+bytes.byteLength>4*1024*1024)return Promise.resolve();this.queued+=bytes.byteLength;
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
 private schedule():void{if(this.animation===undefined&&!this.disposed)this.animation=requestAnimationFrame(()=>{this.animation=undefined;this.render();});}
 private render():void{
  const pending=this.pending;if(!pending||this.disposed)return;const {frame,buffer,sequence}=pending;
  if(this.options.format==='mp4'&&this.count&&this.pausedValue)return;
  if(this.options.format==='mp4'&&this.count&&frame.pts>this.currentTime+.025){this.schedule();return;}
  this.pending=undefined;
  try{
   if(frame.kind===1){if(frame.width<1||frame.height<1||frame.width*frame.height*4!==frame.bytes)throw Error();this.renderer.draw(frame,buffer);this.stamp=frame.pts;this.sourceWidth=frame.sourceWidth;this.sourceHeight=frame.sourceHeight;
    if(++this.count===1){this.base=frame.pts;this.started=performance.now();this.video.dispatchEvent(new Event('loadedmetadata'));this.video.dispatchEvent(new Event('loadeddata'));}
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
 fail(kind:string):void{if(this.disposed||this.failed)return;this.failed=true;this.options.error(kind==='staleContext'?'视频会话已关闭。':'视频暂时无法解码，请重试。');this.dispose();}
 dispose():void{if(this.disposed)return;this.disposed=true;this.viewportObserver?.disconnect();this.dpi?.removeEventListener('change',this.dpiChanged);document.removeEventListener('fullscreenchange',this.queueViewport);window.removeEventListener('resize',this.queueViewport);clearTimeout(this.viewportTimer);
  if(this.animation!==undefined)cancelAnimationFrame(this.animation);if(this.pending){bridge()?.releaseBuffer(this.pending.buffer);this.pending=undefined;}this.stopAudio();void this.context?.close();this.context=undefined;this.renderer.dispose();this.video.style.visibility='';delete this.video.dataset.decoder;active.delete(this.id);void invoke('camera_decode_close',{id:this.id}).catch(()=>{});
  unsubscribeIfIdle();
 }
}
