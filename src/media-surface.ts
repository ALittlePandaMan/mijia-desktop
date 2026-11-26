import type {DeviceContext} from './types';

export interface MediaView{
 readonly videoWidth:number;readonly videoHeight:number;readonly readyState:number;readonly error:MediaError|null;
 currentTime:number;readonly duration:number;readonly ended:boolean;readonly paused:boolean;muted:boolean;playbackRate:number;
 readonly buffered:TimeRanges;play():Promise<void>;pause():void;
}
export interface SoftwareSurface extends MediaView{readonly canvas:HTMLCanvasElement;dispose():void;feed(bytes:ArrayBuffer):Promise<void>;finish():Promise<void>}
const surfaces=new WeakMap<HTMLVideoElement,SoftwareSurface>();
const contexts=new WeakMap<HTMLVideoElement,()=>DeviceContext|undefined>();
const insets=new WeakSet<HTMLVideoElement>();
export const mediaLayout=new EventTarget();
export function mediaIsInset(video:HTMLVideoElement):boolean{return insets.has(video);}
export function setMediaInset(video:HTMLVideoElement,inset:boolean):void{
 if(insets.has(video)===inset)return;
 if(inset)insets.add(video);else insets.delete(video);
 mediaLayout.dispatchEvent(new Event('change'));
}
export function mediaView(video:HTMLVideoElement):MediaView{return surfaces.get(video)??video;}
export function hasMediaFrame(video?:HTMLVideoElement):boolean{
 if(!video)return false;
 const view=mediaView(video);return view.readyState>=2&&view.videoWidth>0&&view.videoHeight>0&&!view.error;
}
export function softwareSurface(video:HTMLVideoElement):SoftwareSurface|undefined{return surfaces.get(video);}
export function mediaSource(video:HTMLVideoElement):CanvasImageSource{return surfaces.get(video)?.canvas??video;}
export function mediaContext(video:HTMLVideoElement):DeviceContext|undefined{return contexts.get(video)?.();}
export function setMediaContext(video:HTMLVideoElement,context:()=>DeviceContext|undefined):void{contexts.set(video,context);}
export function attachSurface(video:HTMLVideoElement,surface:SoftwareSurface):void{surfaces.get(video)?.dispose();surfaces.set(video,surface);}
export function detachSurface(video:HTMLVideoElement,surface?:SoftwareSurface):void{const current=surfaces.get(video);if(current&&(!surface||surface===current)){surfaces.delete(video);current.dispose();}}
let serial=0;
const requests=new Map<number,()=>void>();
/** Both renderers deliver the same frame notification; a pending native request
 * must also wake when software decoding takes over without a new DOM node. */
export function requestMediaFrame(video:HTMLVideoElement,callback:VideoFrameRequestCallback):number{
 const id=++serial;let native:number|undefined;
 const clear=()=>{video.removeEventListener('decoded-media-frame',software);if(native!==undefined)video.cancelVideoFrameCallback(native);requests.delete(id);};
 const done:VideoFrameRequestCallback=(now,metadata)=>{clear();callback(now,metadata);};
 const software=(event:Event)=>done(performance.now(),(event as CustomEvent<VideoFrameCallbackMetadata>).detail);
 video.addEventListener('decoded-media-frame',software,{once:true});
 if(!surfaces.has(video)&&video.requestVideoFrameCallback)native=video.requestVideoFrameCallback((now,metadata)=>{if(!surfaces.has(video))done(now,metadata);else native=undefined;});
 requests.set(id,clear);return id;
}
export function cancelMediaFrame(_video:HTMLVideoElement,id:number):void{requests.get(id)?.();}
