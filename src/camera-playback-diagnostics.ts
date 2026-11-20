type Size = {width:number;height:number};

export function previewViewport(width:number,height:number,dpr:number,focused:boolean):Size {
 const pixels={width:Math.max(1,width*dpr),height:Math.max(1,height*dpr)};
 const [long,short]=focused?[3840,2160]:[1920,1080];
 const portrait=width<height;
 const scale=Math.min(1,(portrait?short:long)/pixels.width,(portrait?long:short)/pixels.height);
 return {width:Math.max(1,Math.floor(pixels.width*scale)),height:Math.max(1,Math.floor(pixels.height*scale))};
}

type Sample = {
 atMs:number; quality:string; codec:string; path:string;
 source:Size; output:Size; viewport:Size; dpr:number;
 receiveBytesPerSecond:number; droppedFrames:number; fullscreen:boolean;
};
const samples=new WeakMap<HTMLVideoElement,{first:number;last:number;rows:Sample[]}>();
const stream=new WeakMap<HTMLVideoElement,{codec:string;rate:number}>();

export function recordPlaybackInput(video:HTMLVideoElement,codec?:string,rate?:number):void {
 const previous=stream.get(video);
 const name=codec==='h264'||codec==='hevc'?codec:previous?.codec??'unknown';
 if(name!==previous?.codec||rate!==undefined)stream.set(video,{codec:name,rate:rate??previous?.rate??0});
}

export function clearPlaybackDiagnostics(video:HTMLVideoElement):void {
 samples.delete(video);stream.delete(video);
}

export function recordPlaybackSample(video:HTMLVideoElement,quality:string):void {
 if(!video.isConnected)return;
 const now=performance.now();
 let state=samples.get(video);
 if(state&&now-state.last<1000)return;
 const canvas=video.dataset.decoder==='software'&&video.nextElementSibling instanceof HTMLCanvasElement?video.nextElementSibling:undefined;
 const output=canvas?{width:canvas.width,height:canvas.height}:{width:video.videoWidth,height:video.videoHeight};
 if(!output.width||!output.height)return;
 const info=stream.get(video),bounds=video.getBoundingClientRect(),dpr=devicePixelRatio||1;
 state??={first:now,last:0,rows:[]};
 state.last=now;
 const reading:Sample={
  atMs:Math.round(now-state.first),
  quality:['auto','sd','hd','uhd'].includes(quality)?quality:'unknown',
  codec:info?.codec??'unknown',
  path:canvas?.dataset.renderer??'system-webview2',
  source:canvas?{width:Number(canvas.dataset.sourceWidth),height:Number(canvas.dataset.sourceHeight)}:output,
  output,
  viewport:{width:Math.round(bounds.width*dpr),height:Math.round(bounds.height*dpr)},
  dpr,
  receiveBytesPerSecond:Math.round(info?.rate??0),
  droppedFrames:canvas?Number(canvas.dataset.droppedFrames):video.getVideoPlaybackQuality?.().droppedVideoFrames??0,
  fullscreen:!!document.fullscreenElement?.contains(video),
 };
 state.rows.push(reading);
 if(state.rows.length>120)state.rows.shift();
 samples.set(video,state);
}

export function exportPlaybackDiagnostics(videos:Iterable<HTMLVideoElement>):void {
 const lenses=Array.from(videos,(video,index)=>({lens:index,samples:samples.get(video)?.rows??[]}));
 const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,lenses},null,2)],{type:'application/json'}));
 const link=document.createElement('a');
 link.href=url;link.download='mijia-playback-diagnostics.json';link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
