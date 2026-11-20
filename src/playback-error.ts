export type PlaybackFailure='network'|'format'|'decode'|'unsupported'|'timeout'|'start'|'policy'|'runtime';

export function systemPlaybackFailure(code:number|undefined):PlaybackFailure|undefined{
 switch(code){case 2:return 'network';case 3:return 'decode';case 4:return 'unsupported';}
}

export function playbackMessage(kind:PlaybackFailure):string{
 return {network:'视频连接中断，请重试。',format:'视频数据格式异常，请重试。',decode:'视频数据无法解码，请重试。',unsupported:'当前视频播放组件不可用，请重试。',timeout:'视频加载超时，请重试。',start:'视频播放器无法启动，请重试。',policy:'系统阻止了自动播放，请点击播放。',runtime:'兼容播放需要更新 Microsoft Edge WebView2 Runtime。'}[kind];
}

export function decoderRuntimeMissing(error:unknown):boolean{return (error as {kind?:string}|undefined)?.kind==='decodeRuntime';}

export function playFailure(error:unknown,code?:number):PlaybackFailure|undefined{
 const name=(error as {name?:string}|null)?.name;
 if(name==='AbortError')return;
 if(name==='NotAllowedError')return 'policy';
 return systemPlaybackFailure(code)??(name==='NotSupportedError'?'unsupported':'start');
}

export function canUseSoftware(kind:PlaybackFailure):boolean{return kind==='decode'||kind==='unsupported';}
