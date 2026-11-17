import type mpegts from 'mpegts.js';
let engine:typeof mpegts|undefined;
let loading:Promise<typeof mpegts>|undefined;
/** One shared, retryable feature load; does not create a transport or decoder. */
export function loadVideoEngine():Promise<typeof mpegts>{
 return loading??=import('mpegts.js').then(module=>engine=module.default).catch(error=>{loading=undefined;throw error;});
}
export function nativeVideoSupported():boolean{return !!engine?.isSupported();}
/** Shared inert MPEG-TS IPC loader for the detail viewer and monitor tiles. */
export function nativeVideoPlayer(video:HTMLVideoElement,attach:(feed:(buffer:ArrayBuffer)=>void)=>()=>void,error:()=>void,live=true):mpegts.Player {
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
