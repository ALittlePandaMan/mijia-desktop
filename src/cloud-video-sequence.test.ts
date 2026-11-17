import {describe,it,expect} from 'vitest';
import {CloudVideoSequence} from './cloud-video-sequence';
class Video extends EventTarget{
 src='';currentTime=0;playbackRate=1;muted=true;paused=true;ended=false;
 load(){this.currentTime=0;this.ended=false;queueMicrotask(()=>this.dispatchEvent(new Event('loadedmetadata')));}
 async play(){this.paused=false;}
}
const data=btoa('\0\0\0\u0018ftypisom\0\0\0\0isom');
const tick=()=>new Promise(r=>setTimeout(r,0));
describe('cloud video decoder configuration boundaries',()=>{
 it('resets the decoder at a boundary and preserves the total seek timeline, speed and sound',async()=>{
  const v=new Video(),s=new CloudVideoSequence(v as unknown as HTMLVideoElement);v.playbackRate=2;v.muted=false;
  await s.load({data,duration:9,parts:[{data,duration:3},{data,duration:6}]});await v.play();const first=v.src;v.currentTime=2;expect(s.currentTime).toBe(2);expect(s.duration).toBe(9);
  v.currentTime=3;v.ended=true;v.dispatchEvent(new Event('ended'));await tick();expect(v.src).not.toBe(first);expect(v.playbackRate).toBe(2);expect(v.muted).toBe(false);expect(v.paused).toBe(false);expect(s.ended).toBe(false);
  v.currentTime=1;expect(s.currentTime).toBe(4);s.seek(1);await tick();expect(v.src).toBe(first);expect(s.currentTime).toBe(1);s.dispose();expect(s.active).toBe(false);
 });
 it('cancels stale loads without disposing the newer event',async()=>{
  const v=new Video(),s=new CloudVideoSequence(v as unknown as HTMLVideoElement);
  const first=s.load({data,duration:2}).catch(e=>e.name);const second=s.load({data,duration:5});await Promise.all([first,second]);expect(s.active).toBe(true);expect(s.duration).toBe(5);s.dispose();
 });
});
