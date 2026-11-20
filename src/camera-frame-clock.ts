import type {CameraEvent} from './camera-types';
export interface CameraRecordingPoint {atTimestamp?:number;mediaGeneration?:number}
/** Match source timestamps to the zero-based media clock produced by the TS remuxer. */
export class CameraFrameClock {
 private points:{media:number;source:number}[]=[];
 private last?:number;private media=0;private generation?:number;
 reset():void{this.points=[];this.last=undefined;this.media=0;this.generation=undefined;}
 observe(event:CameraEvent,currentTime:number,playback=false):void{
  if(event.timestamp===undefined)return;
  if(this.last!==undefined){const delta=event.timestamp-this.last;this.media+=delta>=1&&delta<=(playback?60000:500)?delta/1000:.05;}
  this.last=event.timestamp;this.generation=event.mediaGeneration;
  this.points.push({media:this.media,source:event.timestamp});
  while(this.points.length>4096||this.points.length>2&&this.points[1].media<currentTime-8)this.points.shift();
 }
 at(currentTime:number):CameraRecordingPoint{
  if(!this.points.length)return {};
  let index=this.points.length-1;while(index>0&&this.points[index].media>currentTime)index--;
  const point=this.points[index],next=this.points[index+1];
  const extra=next?Math.max(0,Math.min(1,(currentTime-point.media)/(next.media-point.media)))*(next.source-point.source):0;
  return {atTimestamp:Math.max(0,Math.floor(point.source+extra)),mediaGeneration:this.generation};
 }
}
