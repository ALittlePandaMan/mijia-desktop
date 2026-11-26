import {mediaView,softwareSurface,detachSurface} from './media-surface';
import {canUseSoftware,decoderRuntimeMissing,playbackMessage,playFailure,systemPlaybackFailure,type PlaybackFailure} from './playback-error';

export interface CloudVideoSession extends VideoSource{parts:readonly number[];container?:'webm'}
interface VideoAsset{url:string;blob:Blob}
interface VideoPart{asset?:VideoAsset;duration:number;start:number}
interface VideoSource{
 read:(index:number,prefetch:boolean)=>Promise<ArrayBuffer>;
 close:()=>void;
}
interface Presentation{offset:number;rate:number;muted:boolean}
class MediaFailure extends Error{constructor(readonly kind:PlaybackFailure){super(playbackMessage(kind));}}
const cancelled=()=>new DOMException('Cancelled','AbortError');
const isCancelled=(error:unknown)=>(error as {name?:string}|null)?.name==='AbortError';
const LIMIT=48*1024*1024;

/** Each part may fall back once, using the same bytes and one playback timeline. */
export class CloudVideoSequence{
 private parts:VideoPart[]=[];private index=0;private controller?:AbortController;
 private task?:Promise<void>;private softwareParts=new Set<number>();
 private wantsPlay=false;private failed=false;
 private suspended?:{time:number;rate:number;muted:boolean;paused:boolean};
 private source?:CloudVideoSession;
 private prefetching?:{index:number;task:Promise<ArrayBuffer|undefined>};
 constructor(private video:HTMLVideoElement,private error:(message:string)=>void=()=>{},private capacityChanged?:(waiting:boolean)=>void){
  video.addEventListener('ended',()=>{
   if(!this.active||this.suspended||!this.wantsPlay||!mediaView(video).ended)return;
   if(this.index+1>=this.parts.length){this.wantsPlay=false;return;}
   void this.change(this.index+1,0,true).catch(e=>this.report(e));
  });
  video.addEventListener('error',()=>{
   if(!this.active||this.suspended||this.task||this.failed||softwareSurface(video))return;
   const kind=systemPlaybackFailure(video.error?.code);if(!kind)return;
   if(this.source?.container!=='webm'&&canUseSoftware(kind)&&!this.softwareParts.has(this.index)){
    this.softwareParts.add(this.index);
    void this.change(this.index,Math.max(0,video.currentTime),this.wantsPlay).catch(e=>this.report(e));
   }else this.report(new MediaFailure(kind));
  });
 }
 get active():boolean{return this.parts.length>0;}
 get resourceSuspended():boolean{return !!this.suspended;}
 get ended():boolean{return this.active&&this.index===this.parts.length-1&&mediaView(this.video).ended;}
 get duration():number{return this.parts.reduce((n,p)=>n+p.duration,0);}
 get currentTime():number{return this.suspended?.time??(this.parts[this.index]?.start??0)+Math.max(0,mediaView(this.video).currentTime||0);}
 private report(error:unknown):void{
  if(isCancelled(error)||this.failed||!this.active)return;
  this.failed=true;this.error(error instanceof MediaFailure?error.message:playbackMessage('start'));
 }
 suspend():void{
  if(!this.active||this.suspended)return;
  const view=mediaView(this.video),paused=!this.wantsPlay;
  if(!softwareSurface(this.video)&&!this.task){this.pause();return;}
  this.suspended={time:this.currentTime,rate:view.playbackRate,muted:view.muted,paused};
  this.controller?.abort();this.task=undefined;view.pause();detachSurface(this.video);this.resetSource();
 }
 async resume():Promise<void>{
  const saved=this.suspended;if(!saved)return;this.suspended=undefined;
  const time=Math.min(saved.time,this.duration-.001),index=this.partAt(time);
  if(index<0)return;
  await this.change(index,Math.max(0,time-this.parts[index].start),!saved.paused,saved);
 }
 async load(source:CloudVideoSession,play=false):Promise<void>{
  this.dispose();this.source=source;
  try{
   const durations=source.parts;
   if(!durations.length||durations.length>100)throw new MediaFailure('format');
   let start=0;
   for(const duration of durations){
    if(!Number.isFinite(duration)||duration<=0||start+duration>600)throw new MediaFailure('format');
    this.parts.push({duration,start});start+=duration;
   }
   await this.change(0,0,play);
  }catch(error){if(this.source===source)this.dispose();throw error;}
 }
 private asset(buffer:ArrayBuffer):VideoAsset{
  const bytes=new Uint8Array(buffer);
  if(this.source?.container==='webm'){
   if(bytes.length<16||bytes.length>LIMIT||new DataView(buffer).getUint32(0)!==0x1a45dfa3)throw new MediaFailure('format');
   const blob=new Blob([buffer],{type:'video/webm'});return {url:URL.createObjectURL(blob),blob};
  }
  if(bytes.length<16||bytes.length>LIMIT||String.fromCharCode(...bytes.subarray(4,8))!=='ftyp')throw new MediaFailure('format');
  const blob=new Blob([buffer],{type:'video/mp4'});return {url:URL.createObjectURL(blob),blob};
 }
 private discard(part:VideoPart):void{if(part.asset)URL.revokeObjectURL(part.asset.url);part.asset=undefined;}
 private async loadAsset(index:number,part:VideoPart,signal:AbortSignal):Promise<VideoAsset>{
  if(part.asset)return part.asset;
  const source=this.source;if(!source)throw new MediaFailure('format');
  const prefetched=this.prefetching?.index===index?this.prefetching:undefined;
  if(prefetched)this.prefetching=undefined;
  const cached=prefetched?await prefetched.task:undefined;
  signal.throwIfAborted();
  const bytes=cached??await source.read(index,false);
  signal.throwIfAborted();
  return part.asset=this.asset(bytes);
 }
 private prefetch(index:number):void{
  const source=this.source,part=this.parts[index],currentSize=this.parts[this.index]?.asset?.blob.size;
  if(!source||!part||part.asset||this.prefetching?.index===index||currentSize===undefined||currentSize>=LIMIT/2)return;
  const entry={index,task:source.read(index,true).then(data=>data.byteLength+currentSize<=LIMIT?data:undefined).catch(()=>undefined)};
  this.prefetching=entry;
 }
 async play():Promise<void>{
  if(!this.active||this.failed)return;
  this.wantsPlay=true;
  if(this.task){await this.task;if(this.wantsPlay&&mediaView(this.video).paused)await this.play();return;}
  if(this.suspended){this.suspended.paused=false;await this.resume();return;}
  const view=mediaView(this.video);
  if(view.ended){await this.change(this.ended?0:this.index+1,0,true);return;}
  if(softwareSurface(this.video)){await view.play();return;}
  await this.run(this.index,view.currentTime,true,false);
 }
 pause():void{this.wantsPlay=false;if(this.suspended)this.suspended.paused=true;mediaView(this.video).pause();}
 private partAt(time:number):number{return this.parts.findIndex(p=>time>=p.start&&time<p.start+p.duration);}
 seek(time:number):void{
  if(!this.active||!Number.isFinite(time))return;
  const t=Math.max(0,Math.min(time,this.duration-.001)),index=this.partAt(t);
  if(index<0)return;
  if(index===this.index&&!this.task&&!this.failed&&!this.softwareParts.has(index)){this.video.currentTime=t-this.parts[index].start;return;}
  void this.change(index,t-this.parts[index].start,this.wantsPlay).catch(e=>this.report(e));
 }
 private change(index:number,offset:number,play:boolean,settings?:Pick<Presentation,'rate'|'muted'>):Promise<void>{
  return this.run(index,offset,play,true,settings);
 }
 private run(index:number,offset:number,play:boolean,replace:boolean,settings?:Pick<Presentation,'rate'|'muted'>):Promise<void>{
  const part=this.parts[index];if(!part)return Promise.resolve();
  const view=mediaView(this.video),state={offset:Math.min(Math.max(0,offset||0),Math.max(0,part.duration-.001)),rate:settings?.rate??view.playbackRate,muted:settings?.muted??view.muted};
  this.controller?.abort();const job=this.controller=new AbortController();
  this.index=index;this.wantsPlay=play;this.failed=false;
  // Take ownership before switching src: old DOM errors must not start a second fallback.
  const task=Promise.resolve().then(async()=>{
   const signal=job.signal;signal.throwIfAborted();
   if(this.source){
    for(const [i,other] of this.parts.entries())if(i!==index)this.discard(other);
    if(this.prefetching&&this.prefetching.index!==index)this.prefetching=undefined;
    if(replace){detachSurface(this.video);this.resetSource();}
   }
   const asset=await this.loadAsset(index,part,signal);
   if(this.softwareParts.has(index)){await this.compatible(part,asset,state,signal);this.prefetch(index+1);return;}
   try{
    if(replace){
     detachSurface(this.video);
     await this.wait('loadedmetadata',signal,()=>{this.video.src=asset.url;this.video.load();});
     signal.throwIfAborted();this.video.muted=state.muted;this.video.playbackRate=state.rate;this.video.currentTime=state.offset;
    }
    if(this.wantsPlay)await this.wait('playing',signal,()=>this.video.play());
    if(!this.wantsPlay&&!this.video.paused)this.video.pause();
   }catch(error){
    signal.throwIfAborted();
    if(isCancelled(error)){if(!this.wantsPlay)return;throw error;}
    const kind=error instanceof MediaFailure?error.kind:playFailure(error,this.video.error?.code)??'start';
    if(kind==='policy'){this.wantsPlay=false;return;}
    // The clip bytes are already local. A native startup timeout can use the same fallback as a codec error.
    if(this.source?.container==='webm'||kind!=='timeout'&&!canUseSoftware(kind))throw new MediaFailure(kind);
    this.softwareParts.add(index);
    if(!replace)state.offset=Math.max(0,Math.min(this.video.currentTime||state.offset,part.duration-.001));
    await this.compatible(part,asset,state,signal);
   }
   signal.throwIfAborted();this.prefetch(index+1);
  }).catch(error=>{if(job.signal.aborted||this.controller!==job)throw cancelled();throw error;}).finally(()=>{if(this.controller===job)this.task=undefined;});
  this.task=task;return task;
 }
 private wait(event:string,signal:AbortSignal,start:()=>void|Promise<void>,settleOnStart=true):Promise<void>{
  return new Promise((resolve,reject)=>{
   signal.throwIfAborted();
   const done=(error?:unknown)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);this.video.removeEventListener(event,ready);this.video.removeEventListener('error',failed);error===undefined?resolve():reject(error);};
   const ready=()=>done(),failed=()=>done(new MediaFailure(systemPlaybackFailure(this.video.error?.code)??'format')),abort=()=>done(cancelled());
   const timer=setTimeout(()=>done(new MediaFailure('timeout')),15000);
   signal.addEventListener('abort',abort,{once:true});this.video.addEventListener(event,ready,{once:true});
   // Once the software surface owns playback, late errors from the old Blob
   // source must not be mistaken for its worker's status.
   if(settleOnStart)this.video.addEventListener('error',failed,{once:true});
   try{const running=start();if(running)void running.then(()=>{if(settleOnStart)done();},done);}catch(error){done(error);}
  });
 }
 private resetSource():void{this.video.removeAttribute('src');this.video.load();}
 private async compatible(part:VideoPart,asset:VideoAsset,state:Presentation,signal:AbortSignal):Promise<void>{
  let surface:Awaited<ReturnType<typeof import('./software-video').CompatVideo.open>>|undefined;
  const firstFrame=new AbortController(),abortFrame=()=>firstFrame.abort();let openingFailed=false;
  signal.addEventListener('abort',abortFrame,{once:true});
  try{
   const {CompatVideo}=await import('./software-video');signal.throwIfAborted();
   detachSurface(this.video);this.resetSource();
   surface=await CompatVideo.open(this.video,{format:'mp4',size:asset.blob.size,offset:state.offset,duration:part.duration,signal,capacity:waiting=>{if(!signal.aborted)this.capacityChanged?.(waiting);},error:()=>{
    if(signal.aborted)return;
    if(this.task){openingFailed=true;firstFrame.abort(new MediaFailure('decode'));}else this.report(new MediaFailure('decode'));
   }});
   const player=surface,release=()=>detachSurface(this.video,player);
   signal.addEventListener('abort',release,{once:true});signal.throwIfAborted();
   player.muted=state.muted;player.playbackRate=state.rate;player.pause();
   await this.wait('decoded-media-frame',firstFrame.signal,async()=>{
     for(let offset=0;offset<asset.blob.size;offset+=256*1024){
      signal.throwIfAborted();const bytes=await asset.blob.slice(offset,offset+256*1024).arrayBuffer();signal.throwIfAborted();await player.feed(bytes);
     }
     signal.throwIfAborted();await player.finish();
    },false);
   signal.throwIfAborted();if(this.wantsPlay)await player.play();
  }catch(error){
   if(surface)detachSurface(this.video,surface);
   signal.throwIfAborted();if(openingFailed)throw new MediaFailure('decode');
   if(isCancelled(error)||error instanceof MediaFailure)throw error;
   throw new MediaFailure(decoderRuntimeMissing(error)?'runtime':surface?'decode':'unsupported');
  }finally{signal.removeEventListener('abort',abortFrame);}
 }
 dispose():void{
  this.controller?.abort();this.controller=undefined;this.task=undefined;this.suspended=undefined;
  this.source?.close();this.source=undefined;this.prefetching=undefined;
  const owned=this.parts;this.parts=[];detachSurface(this.video);if(owned.length)this.resetSource();
  this.softwareParts.clear();for(const part of owned)this.discard(part);this.index=0;this.wantsPlay=this.failed=false;
 }
}
