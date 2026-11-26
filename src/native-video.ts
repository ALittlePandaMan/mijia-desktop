import type mpegts from 'mpegts.js';
import {isTauri} from '@tauri-apps/api/core';
import {detachSurface,mediaView} from './media-surface';
import {canUseSoftware,decoderRuntimeMissing,playFailure,systemPlaybackFailure,type PlaybackFailure} from './playback-error';
import {REPLAY_FORWARD_BYTES} from './camera-replay-buffer';
let engine:typeof mpegts|undefined;
let loading:Promise<typeof mpegts>|undefined;
/** One shared, retryable feature load; does not create a transport or decoder. */
export function loadVideoEngine():Promise<typeof mpegts>{
 return loading??=import('mpegts.js').then(module=>engine=module.default).catch(error=>{loading=undefined;throw error;});
}
export function nativeVideoSupported():boolean{return isTauri()||!!engine?.isSupported();}

export interface NativeVideoPlayer {
 readonly waitingForDecoder:boolean;
 feed(data:ArrayBuffer,keyframe?:boolean):void;
 play():Promise<void>;
 pause():void;
 destroy():void;
}
/** Shared inert MPEG-TS IPC loader for the detail viewer and monitor tiles. */
function systemVideoPlayer(video:HTMLVideoElement,attach:(feed:(buffer:ArrayBuffer)=>void)=>()=>void,error:(type:string,detail:string)=>void,live=true):mpegts.Player {
 const mpegts=engine;if(!mpegts)throw Error('视频组件尚未加载，请重试。');
 class IpcLoader implements mpegts.BaseLoader {
  _status=0;_needStash=false;readonly type='xiaomi-native-session';get status(){return this._status}get needStashBuffer(){return false}
  onContentLengthKnown!:(length:number)=>void;onURLRedirect!:(url:string)=>void;onDataArrival!:(data:ArrayBuffer,start:number,length?:number)=>void;onError!:(type:mpegts.LoaderErrors,error:mpegts.LoaderErrorMessage)=>void;onComplete!:(from:number,to:number)=>void;
  private offset=0;private detach?:()=>void;
  isWorking(){return this._status===2}
  open(){this._status=2;this.detach=attach(buffer=>{if(this._status!==2)return;const start=this.offset;this.offset+=buffer.byteLength;this.onDataArrival(buffer,start,this.offset);});}
  abort(){this._status=4;this.detach?.();this.detach=undefined;}
  destroy(){this.abort();}
 }
 mpegts.LoggingControl.applyConfig({enableAll:false,enableDebug:false,enableInfo:false,enableWarn:false,enableError:false});
 const player=mpegts.createPlayer({type:'mpegts',isLive:live,hasAudio:false,hasVideo:true,url:'native-session'},{customLoader:IpcLoader,enableWorker:false,enableStashBuffer:false,lazyLoad:false,liveBufferLatencyChasing:live,liveBufferLatencyMaxLatency:2,liveBufferLatencyMinRemain:.5,autoCleanupSourceBuffer:true,autoCleanupMaxBackwardDuration:live?30:8,autoCleanupMinBackwardDuration:live?15:4});
 player.on(mpegts.Events.ERROR,error);player.attachMediaElement(video);player.load();return player;
}

/** A decoder switch never opens or replays a device session. */
export function nativeVideoPlayer(video:HTMLVideoElement,error:(kind:PlaybackFailure)=>void,live=true,capacityChanged?:(waiting:boolean)=>void):NativeVideoPlayer{
 let system:mpegts.Player|undefined,soft:import('./software-video').CompatVideo|undefined,push:((data:ArrayBuffer)=>void)|undefined;
 const cacheLimit=live?4*1024*1024:REPLAY_FORWARD_BYTES;
 let closed=false,switching=false,wantsPlayback=video.autoplay,cache:ArrayBuffer[]=[],bytes=0,timer:ReturnType<typeof setTimeout>|undefined,started=false;
 let waitingForDecoder=false,needsKeyframe=false;
 const lifetime=new AbortController();
 const setDecoderWaiting=(waiting:boolean)=>{
  if(waitingForDecoder===waiting)return;
  waitingForDecoder=waiting;
  if(!closed)capacityChanged?.(waiting);
 };
 const ready=()=>{if(switching)return;started=true;cache=[];bytes=0;clearTimeout(timer);timer=undefined;};
 const feed=(data:ArrayBuffer,keyframe?:boolean)=>{
  if(closed)return;
  if(soft){
   if(needsKeyframe&&keyframe===false)return;
   needsKeyframe=false;void soft.feed(data,keyframe).catch(()=>{});return;
  }
  if(live&&keyframe===true){cache=[];bytes=0;}
  if(!live||keyframe!==false||cache.length){
   cache.push(data);bytes+=data.byteLength;
   if(live&&keyframe!==undefined&&bytes>cacheLimit){cache=[];bytes=0;}
   else while(bytes>cacheLimit&&cache.length>1)bytes-=cache.shift()!.byteLength;
  }
  if(!timer&&!switching&&!started)timer=setTimeout(()=>{
   timer=undefined;
   if(!closed&&!started&&bytes)void fallback('timeout');
  },12000);
  push?.(data);
 };
 const clearSystem=()=>{push=undefined;const p=system;system=undefined;if(p)for(const command of [()=>p.pause(),()=>p.unload(),()=>p.detachMediaElement(),()=>p.destroy()]){try{command();}catch{/* Failed MSE paths may already be detached. */}}};
 const fallback=async(reason:PlaybackFailure='unsupported')=>{
  if(closed||switching||soft)return;if(!isTauri()){error(reason);return;}
  switching=true;if(timer)clearTimeout(timer);timer=undefined;const rate=video.playbackRate;wantsPlayback||=!video.paused;clearSystem();video.removeAttribute('src');video.load();video.playbackRate=rate;
  try{
   const {CompatVideo}=await import('./software-video');if(closed)return;
   const next=await CompatVideo.open(video,{
    format:'mpegts',preserveSource:live,replay:!live,signal:lifetime.signal,
    error:()=>{if(!closed)error('decode');},capacity:setDecoderWaiting,
    yielded:live?()=>{
     if(closed)return;
     soft=undefined;switching=false;
     setDecoderWaiting(true);
     void fallback();
    }:undefined,
   });
   if(closed){detachSurface(video,next);return;}
   soft=next;
   setDecoderWaiting(false);
   const pending=cache;cache=[];bytes=0;
   needsKeyframe=live&&!pending.length;
   for(const data of pending)void soft.feed(data).catch(()=>{});
   if(wantsPlayback)await soft.play();else soft.pause();
  }
  catch(reason){if(!closed){setDecoderWaiting(false);error(decoderRuntimeMissing(reason)?'runtime':'start');}}
 };
 const failed=()=>{if(closed||soft||switching)return;const kind=systemPlaybackFailure(video.error?.code);if(kind==='unsupported'||kind==='decode')void fallback();else if(kind)error(kind);};
 video.addEventListener('error',failed);
 video.addEventListener('loadeddata',ready,{once:true});
 try{if(!engine?.isSupported())void fallback();else{system=systemVideoPlayer(video,feed=>{push=feed;for(const data of cache)feed(data);return()=>{push=undefined;};},(type,detail)=>{
  if(closed||switching)return;
  if(type===engine?.ErrorTypes.NETWORK_ERROR)error('network');
  else if(detail===engine?.ErrorDetails.MEDIA_CODEC_UNSUPPORTED)void fallback();
  else if(detail===engine?.ErrorDetails.MEDIA_MSE_ERROR){if(systemPlaybackFailure(video.error?.code)==='network')error('network');else void fallback();}
  else error('format');
 },live);
 }}catch{void fallback();}
 const destroy=()=>{if(closed)return;closed=true;lifetime.abort();clearTimeout(timer);video.removeEventListener('loadeddata',ready);video.removeEventListener('error',failed);clearSystem();detachSurface(video);cache=[];};
 const play=async()=>{wantsPlayback=true;if(closed||switching&&!soft)return;try{await mediaView(video).play();}catch(issue){if(closed)return;const kind=playFailure(issue,video.error?.code);if(!kind||kind==='policy')throw issue;if(!soft&&canUseSoftware(kind)){await fallback();return;}error(kind);}};
 return {get waitingForDecoder(){return waitingForDecoder;},feed,play,pause:()=>{wantsPlayback=false;mediaView(video).pause();},destroy};
}
