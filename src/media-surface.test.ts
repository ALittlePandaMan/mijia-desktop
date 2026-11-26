import {describe,it,expect,vi} from 'vitest';
import {mediaView,attachSurface,detachSurface,requestMediaFrame,cancelMediaFrame,type SoftwareSurface} from './media-surface';
class Video extends EventTarget{
 callbacks=new Map<number,VideoFrameRequestCallback>();serial=0;
 requestVideoFrameCallback(callback:VideoFrameRequestCallback){this.callbacks.set(++this.serial,callback);return this.serial;}
 cancelVideoFrameCallback(id:number){this.callbacks.delete(id);}
}
describe('renderer handoff and ownership',()=>{
 it('a pending native frame wakes from software, ignores stale native output and fires once',()=>{
  const v=new Video(),video=v as unknown as HTMLVideoElement,callback=vi.fn();requestMediaFrame(video,callback);
  const native=v.callbacks.get(1)!;const dispose=vi.fn(),surface={dispose} as unknown as SoftwareSurface;attachSurface(video,surface);
  native(1,{} as VideoFrameCallbackMetadata);expect(callback).not.toHaveBeenCalled();
  v.dispatchEvent(new CustomEvent('decoded-media-frame',{detail:{width:320,height:180,presentedFrames:1}}));expect(callback).toHaveBeenCalledOnce();
  v.dispatchEvent(new CustomEvent('decoded-media-frame',{detail:{}}));expect(callback).toHaveBeenCalledOnce();
  detachSurface(video);expect(dispose).toHaveBeenCalledOnce();expect(mediaView(video)).toBe(video);
 });
 it('closing a previous renderer never disposes its replacement',()=>{
  const video=new Video() as unknown as HTMLVideoElement,first={dispose:vi.fn()} as unknown as SoftwareSurface,second={dispose:vi.fn()} as unknown as SoftwareSurface;
  attachSurface(video,first);attachSurface(video,second);detachSurface(video,first);expect(first.dispose).toHaveBeenCalledOnce();expect(second.dispose).not.toHaveBeenCalled();expect(mediaView(video)).toBe(second);detachSurface(video);
 });
 it('cancellation removes both frame subscriptions',()=>{
  const v=new Video(),video=v as unknown as HTMLVideoElement,callback=vi.fn(),id=requestMediaFrame(video,callback);cancelMediaFrame(video,id);expect(v.callbacks.size).toBe(0);
  v.dispatchEvent(new CustomEvent('decoded-media-frame',{detail:{}}));expect(callback).not.toHaveBeenCalled();
 });
});
