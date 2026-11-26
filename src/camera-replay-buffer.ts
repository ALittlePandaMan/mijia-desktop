import type {CameraEvent} from './camera-types';
import type {MediaView} from './media-surface';

const MAX_FORWARD_SECONDS=24;
export const REPLAY_FORWARD_BYTES=12*1024*1024;
const MAX_SAMPLES=4096;
const STALL_MS=6000;

/** Count only the range the playhead can actually reach. */
export function replayBufferedAhead(video:Pick<MediaView,'buffered'|'currentTime'>):number {
 const {buffered,currentTime}=video;
 for(let i=0;i<buffered.length;i++){
  const start=buffered.start(i),end=buffered.end(i);
  if(start<=currentTime+.5&&end>=currentTime)return end-Math.max(start,currentTime);
 }
 return 0;
}

/** Bound encoded input before it reaches the MSE append queue, including while paused. */
export class CameraReplayBuffer {
 private samples:{end:number;bytes:number}[]=[];
 private bytes=0;
 private timestamp?:number;
 private elapsed=0;
 private lastFrame?:number;
 private progress?:{time:number;at:number};
 halted=false;
 reset():void {this.samples=[];this.bytes=0;this.timestamp=this.lastFrame=undefined;this.elapsed=0;this.halted=false;this.resetProgress();}
 frame(time:number):void{if(Number.isFinite(time)&&time>=0)this.lastFrame=time;}
 displayedTime(time:number):number{return this.lastFrame??time;}
 resetProgress():void {this.progress=undefined;}
 stalled(time:number,now:number):boolean {
  if(!this.progress||Math.abs(time-this.progress.time)>.025){
   this.progress={time,at:now};
   return false;
  }
  return now-this.progress.at>=STALL_MS;
 }
 append(event:CameraEvent,currentTime:number):boolean {
  if(this.halted)return false;
  while(this.samples.length&&this.samples[0].end<currentTime-1)this.bytes-=this.samples.shift()!.bytes;
  const timestamp=event.timestamp;
  const delta=timestamp===undefined||this.timestamp===undefined?undefined:timestamp-this.timestamp;
  const end=this.elapsed+(delta===undefined?0:delta>=1&&delta<=60000?delta/1000:.05);
  const bytes=Math.ceil((event.data?.length??0)*3/4);
  if(end-currentTime>MAX_FORWARD_SECONDS||this.bytes+bytes>REPLAY_FORWARD_BYTES||this.samples.length>=MAX_SAMPLES){this.halted=true;return false;}
  this.timestamp=timestamp??this.timestamp;this.elapsed=end;
  this.samples.push({end,bytes});this.bytes+=bytes;return true;
 }
 needsRefill(video:Pick<MediaView,'buffered'|'currentTime'>,software=false):boolean {
  return this.halted&&(software?this.elapsed-video.currentTime:replayBufferedAhead(video))<=3;
 }
}
