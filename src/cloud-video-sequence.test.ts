import {afterEach,describe,it,expect,vi} from 'vitest';
import {CloudVideoSequence} from './cloud-video-sequence';
import {attachSurface,mediaView,type SoftwareSurface} from './media-surface';
const {open}=vi.hoisted(()=>({open:vi.fn()}));vi.mock('./software-video',()=>({CompatVideo:{open}}));
class Video extends EventTarget{
 src='';currentTime=0;playbackRate=1;muted=true;paused=true;ended=false;error?:{code:number};
 reject?:string;
 load(){this.currentTime=0;this.ended=false;this.error=undefined;this.paused=true;if(this.src)queueMicrotask(()=>this.dispatchEvent(new Event('loadedmetadata')));}
 async play(){if(this.reject)throw new DOMException('raw browser message',this.reject);this.paused=false;}
 pause(){this.paused=true;}
 removeAttribute(){this.src='';}
}
const data=new TextEncoder().encode('\0\0\0\u0018ftypisom\0\0\0\0isom').buffer;
const clip=(...parts:number[])=>({parts,read:vi.fn(async(_i:number,_preload:boolean)=>data),close:vi.fn()});
const tick=()=>new Promise(r=>setTimeout(r,0));
afterEach(()=>open.mockReset());
function mockedSoftware(){
 let frame:(()=>void)|undefined;
 const finish=vi.fn(async()=>{}),close=vi.fn();
 open.mockImplementation(async(video:HTMLVideoElement,options:{offset:number})=>{
  const surface={readyState:0,currentTime:options.offset,paused:true,muted:false,playbackRate:1,feed:vi.fn(async()=>{}),finish,dispose:close,play:vi.fn(async()=>{surface.paused=false;}),pause:()=>{surface.paused=true;}};
  attachSurface(video,surface as unknown as SoftwareSurface);
  frame=()=>{surface.readyState=2;video.dispatchEvent(new Event('decoded-media-frame'));};
  return surface;
 });
 return {finish,close,frame:()=>frame?.()};
}
describe('cloud video decoder configuration boundaries',()=>{
 it('resets the decoder at a boundary and preserves the total seek timeline, speed and sound',async()=>{
  const v=new Video(),s=new CloudVideoSequence(v as unknown as HTMLVideoElement);v.playbackRate=2;v.muted=false;
  const source=clip(3,6);await s.load(source,true);const first=v.src;v.currentTime=2;expect(s.currentTime).toBe(2);expect(s.duration).toBe(9);
  expect(source.read.mock.calls).toEqual([[0,false],[1,true]]);
  v.currentTime=3;v.ended=true;v.dispatchEvent(new Event('ended'));await tick();expect(v.src).not.toBe(first);expect(v.playbackRate).toBe(2);expect(v.muted).toBe(false);expect(v.paused).toBe(false);expect(s.ended).toBe(false);
  expect(source.read).toHaveBeenCalledTimes(2);
  v.currentTime=1;expect(s.currentTime).toBe(4);s.seek(1);await tick();expect(v.src).not.toBe(first);expect(s.currentTime).toBe(1);
  expect(source.read.mock.calls.slice(2)).toEqual([[0,false],[1,true]]);s.dispose();expect(s.active).toBe(false);expect(source.close).toHaveBeenCalledOnce();
 });
 it('keeps the current cloud part when a late end event arrives after a pause or source change',async()=>{
  const v=new Video(),s=new CloudVideoSequence(v as unknown as HTMLVideoElement);
  await s.load(clip(3,6),true);const first=v.src;
  s.pause();v.ended=true;v.dispatchEvent(new Event('ended'));await tick();
  expect(v.src).toBe(first);expect(v.paused).toBe(true);
  await s.play();const second=v.src;
  expect(second).not.toBe(first);expect(s.currentTime).toBe(3);
  v.dispatchEvent(new Event('ended'));await tick();
  expect(v.src).toBe(second);expect(v.paused).toBe(false);
  s.dispose();
 });
 it('cancels stale loads without disposing the newer event',async()=>{
  const v=new Video(),s=new CloudVideoSequence(v as unknown as HTMLVideoElement);
  const stale=clip(2),current=clip(5);
  let release!:(bytes:ArrayBuffer)=>void;
  stale.read.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  const first=s.load(stale).catch(e=>e.name);await tick();
  await s.load(current);release(data);expect(await first).toBe('AbortError');
  expect(stale.close).toHaveBeenCalledOnce();expect(current.close).not.toHaveBeenCalled();expect(s.active).toBe(true);expect(s.duration).toBe(5);s.dispose();
 });
 it('falls back after metadata when play rejects, and waits for the decoded frame',async()=>{
  const v=new Video(),node=v as unknown as HTMLVideoElement,s=new CloudVideoSequence(node),soft=mockedSoftware();
  v.reject='NotSupportedError';v.playbackRate=2;v.muted=false;
  let finished=false;const result=s.load(clip(8),true).then(()=>finished=true);
  await tick();expect(open).toHaveBeenCalledTimes(1);expect(soft.finish).toHaveBeenCalled();expect(finished).toBe(false);
  soft.frame();await result;expect(mediaView(node)).toMatchObject({readyState:2,playbackRate:2,muted:false,paused:false});
  s.dispose();expect(soft.close).toHaveBeenCalledTimes(1);
 });
 it('reuses a downloaded cloud part when the native decoder never starts',async()=>{
  vi.useFakeTimers();
  const v=new Video(),node=v as unknown as HTMLVideoElement,s=new CloudVideoSequence(node),soft=mockedSoftware(),source=clip(8);
  v.playbackRate=4;
  vi.spyOn(v,'play').mockReturnValueOnce(new Promise<void>(()=>{}));
  try{
   const playback=s.load(source,true);
   await vi.advanceTimersByTimeAsync(15001);
   expect(open).toHaveBeenCalledOnce();expect(source.read).toHaveBeenCalledOnce();
   soft.frame();await playback;
   expect(mediaView(node)).toMatchObject({readyState:2,playbackRate:4,paused:false});
  }finally{s.dispose();vi.useRealTimers();}
 });
 it('preserves pause and time when a native error arrives after startup',async()=>{
  const v=new Video(),node=v as unknown as HTMLVideoElement,s=new CloudVideoSequence(node),soft=mockedSoftware();
  await s.load(clip(5),true);s.pause();v.currentTime=2;v.error={code:3};v.dispatchEvent(new Event('error'));
  await tick();expect(open.mock.calls[0][1].offset).toBe(2);soft.frame();await tick();expect(mediaView(node).paused).toBe(true);s.dispose();
 });
 it('does not attempt compatibility decoding for network or autoplay-policy failures',async()=>{
  const v=new Video(),s=new CloudVideoSequence(v as unknown as HTMLVideoElement,vi.fn());
  v.reject='NotAllowedError';await s.load(clip(3),true);expect(v.paused).toBe(true);
  v.reject=undefined;v.error={code:2};await expect(s.play()).resolves.toBeUndefined();
  v.error={code:2};v.reject='NotSupportedError';await expect(s.play()).rejects.toThrow('视频连接中断');
  expect(open).not.toHaveBeenCalled();s.dispose();
 });
 it('cancels a waiting software part when another cloud event replaces it',async()=>{
  const v=new Video(),node=v as unknown as HTMLVideoElement,s=new CloudVideoSequence(node),soft=mockedSoftware();
  v.reject='NotSupportedError';const first=s.load(clip(8),true).catch(e=>e.name);await tick();
  v.reject=undefined;await s.load(clip(2),true);
  expect(await first).toBe('AbortError');expect(soft.close).toHaveBeenCalledTimes(1);expect(mediaView(node)).toBe(v);expect(s.duration).toBe(2);s.dispose();
 });
});
