import type {CameraEvent} from './camera-types';

const MAX_FORWARD_SECONDS=24;
const MAX_FORWARD_BYTES=12*1024*1024;
const MAX_SAMPLES=4096;
/** Bound encoded input before it reaches the MSE append queue, including while paused. */
export class CameraReplayBuffer {
 private samples:{end:number;bytes:number}[]=[];
 private bytes=0;
 private timestamp?:number;
 private elapsed=1;
 halted=false;
 reset():void {this.samples=[];this.bytes=0;this.timestamp=undefined;this.elapsed=1;this.halted=false;}
 append(event:CameraEvent,currentTime:number):boolean {
  if(this.halted)return false;
  while(this.samples.length&&this.samples[0].end<currentTime-1)this.bytes-=this.samples.shift()!.bytes;
  if(event.timestamp!==undefined){
   if(this.timestamp!==undefined){const delta=event.timestamp-this.timestamp;this.elapsed+=delta>=1&&delta<=60000?delta/1000:.05;}
   this.timestamp=event.timestamp;
  }
  const bytes=Math.ceil((event.data?.length??0)*3/4);
  if(this.elapsed-currentTime>MAX_FORWARD_SECONDS||this.bytes+bytes>MAX_FORWARD_BYTES||this.samples.length>=MAX_SAMPLES){this.halted=true;return false;}
  this.samples.push({end:this.elapsed,bytes});this.bytes+=bytes;return true;
 }
 needsRefill(video:HTMLVideoElement):boolean {
  if(!this.halted)return false;
  for(let i=0;i<video.buffered.length;i++)if(video.buffered.start(i)<=video.currentTime+.5&&video.buffered.end(i)>=video.currentTime)return video.buffered.end(i)-video.currentTime<=3;
  return true;
 }
}
