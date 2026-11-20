import type mpegts from 'mpegts.js';
import {isTauri} from '@tauri-apps/api/core';
import {detachSurface,mediaView} from './media-surface';
import {canUseSoftware,decoderRuntimeMissing,playFailure,systemPlaybackFailure,type PlaybackFailure} from './playback-error';
let engine:typeof mpegts|undefined;
let loading:Promise<typeof mpegts>|undefined;
/** One shared, retryable feature load; does not create a transport or decoder. */
export function loadVideoEngine():Promise<typeof mpegts>{
 return loading??=import('mpegts.js').then(module=>engine=module.default).catch(error=>{loading=undefined;throw error;});
}
export function nativeVideoSupported():boolean{return !!engine?.isSupported()||isTauri();}
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
export function nativeVideoPlayer(video:HTMLVideoElement,attach:(feed:(buffer:ArrayBuffer)=>void)=>()=>void,error:(kind:PlaybackFailure)=>void,live=true):mpegts.Player{
 let system:mpegts.Player|undefined,soft:import('./software-video').CompatVideo|undefined,push:((data:ArrayBuffer)=>void)|undefined;
 let closed=false,switching=false,wantsPlayback=video.autoplay,cache:ArrayBuffer[]=[],bytes=0,timer:ReturnType<typeof setTimeout>|undefined,frame:number|undefined;
 const lifetime=new AbortController();
 const detach=attach(data=>{
  if(closed)return;if(soft){void soft.feed(data).catch(()=>{});return;}
  cache.push(data);bytes+=data.byteLength;while(bytes>4*1024*1024&&cache.length>1)bytes-=cache.shift()!.byteLength;
  if(!timer&&!switching&&!video.videoWidth)timer=setTimeout(()=>{timer=undefined;if(!closed&&!video.videoWidth&&bytes)error('timeout');},12000);
  push?.(data);
 });
 const clearSystem=()=>{push=undefined;const p=system;system=undefined;if(p)for(const command of [()=>p.pause(),()=>p.unload(),()=>p.detachMediaElement(),()=>p.destroy()]){try{command();}catch{/* Failed MSE paths may already be detached. */}}};
 const fallback=async()=>{
  if(closed||switching||soft)return;if(!isTauri()){error('unsupported');return;}
  switching=true;if(timer)clearTimeout(timer);timer=undefined;const muted=video.muted,rate=video.playbackRate;wantsPlayback||=!video.paused;clearSystem();video.removeAttribute('src');video.load();
  try{const {CompatVideo}=await import('./software-video');if(closed)return;const next=await CompatVideo.open(video,{format:'mpegts',preserveSource:live,signal:lifetime.signal,error:()=>{if(!closed)error('decode');}});if(closed){detachSurface(video,next);return;}soft=next;next.muted=muted;next.playbackRate=rate;const pending=cache;cache=[];bytes=0;for(const data of pending)void soft.feed(data).catch(()=>{});if(wantsPlayback)await soft.play();}
  catch(reason){if(!closed)error(decoderRuntimeMissing(reason)?'runtime':'start');}
 };
 const failed=()=>{if(closed||soft||switching)return;const kind=systemPlaybackFailure(video.error?.code);if(kind==='unsupported'||kind==='decode')void fallback();else if(kind)error(kind);};
 video.addEventListener('error',failed);
 try{if(!engine?.isSupported())void fallback();else{system=systemVideoPlayer(video,feed=>{push=feed;for(const data of cache)feed(data);return()=>{push=undefined;};},(type,detail)=>{
  if(closed||switching)return;
  if(type===engine?.ErrorTypes.NETWORK_ERROR)error('network');
  else if(detail===engine?.ErrorDetails.MEDIA_CODEC_UNSUPPORTED)void fallback();
  else if(detail===engine?.ErrorDetails.MEDIA_MSE_ERROR){if(systemPlaybackFailure(video.error?.code)==='network')error('network');else void fallback();}
  else error('format');
 },live);
  frame=video.requestVideoFrameCallback(()=>{frame=undefined;cache=[];bytes=0;if(timer)clearTimeout(timer);timer=undefined;});
 }}catch{void fallback();}
 const destroy=()=>{if(closed)return;closed=true;lifetime.abort();detach();if(timer)clearTimeout(timer);if(frame!==undefined)video.cancelVideoFrameCallback(frame);video.removeEventListener('error',failed);clearSystem();detachSurface(video);cache=[];};
 const play=async()=>{wantsPlayback=true;if(closed||switching&&!soft)return;try{await mediaView(video).play();}catch(issue){if(closed)return;const kind=playFailure(issue,video.error?.code);if(!kind||kind==='policy')throw issue;if(!soft&&canUseSoftware(kind)){await fallback();return;}error(kind);}};
 return {play,pause:()=>{wantsPlayback=false;mediaView(video).pause();},unload:destroy,detachMediaElement:()=>{},destroy,load:()=>{}} as unknown as mpegts.Player;
}
