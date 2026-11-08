import type {CameraEvent} from './camera-types';

const TRANSITION_BYTES=8*1024*1024;
/** Device mode generations and lens decoder revisions are separate identities. */
export class CameraMediaGate {
 private generation?:number;
 private strictGeneration=false;
 private revisions=new Map<number,number>();
 private pending:CameraEvent[]=[];
 private pendingBytes=0;
 private needsKeyframe=new Set<number>();
 transitioning=false;
 reset():void {this.generation=undefined;this.strictGeneration=false;this.revisions.clear();this.pending=[];this.pendingBytes=0;this.needsKeyframe.clear();this.transitioning=false;}
 begin():void {this.pending=[];this.pendingBytes=0;this.needsKeyframe.clear();this.transitioning=true;}
 hold(event:CameraEvent):void {
  const bytes=event.data?.length??0;
  if(this.pendingBytes+bytes>TRANSITION_BYTES){
   for(const queued of this.pending)if(queued.state==='media')this.needsKeyframe.add(queued.lensId??0);
   this.pending=[];this.pendingBytes=0;
   if(event.state==='media')this.needsKeyframe.add(event.lensId??0);
  }
  if(bytes>TRANSITION_BYTES)return;
  this.pending.push(event);this.pendingBytes+=bytes;
 }
 commit(generation:number|undefined):CameraEvent[] {
  if(generation!==undefined)this.generation=generation;
  this.strictGeneration=generation!==undefined;
  this.revisions.clear();this.transitioning=false;
  const pending=this.pending;this.pending=[];this.pendingBytes=0;return pending;
 }
 accept(event:CameraEvent):boolean {
  if(event.mediaGeneration!==undefined){
   // A monitor player can reattach to its existing native session after cloud
   // playback; that session need not be at generation zero. Only an acknowledged
   // mode transition pins an exact expected generation.
   if(this.generation===undefined||!this.strictGeneration&&event.mediaGeneration>this.generation){this.generation=event.mediaGeneration;this.revisions.clear();}
   else if(event.mediaGeneration!==this.generation)return false;
  }
  if(event.state!=='media')return true;
  const lens=event.lensId??0,revision=event.streamRevision??0,previous=this.revisions.get(lens);
  if(previous!==undefined&&revision<previous)return false;
  if(this.needsKeyframe.has(lens)){
   if(!event.keyframe)return false;
   this.needsKeyframe.delete(lens);
  }
  this.revisions.set(lens,revision);return true;
 }
 decoderKey(event:CameraEvent):string {return `${this.generation??0}:${event.lensId??0}:${event.streamRevision??0}`;}
}
