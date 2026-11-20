import type {DeviceContext} from './types';
import type {CameraDecodedSize,CameraQualitySizes} from './camera-quality';

type LensSizes=Map<number,Record<string,CameraDecodedSize>>;
type Sample={key:string;size:CameraDecodedSize;count:number};
const devices=new Map<string,LensSizes>();
const maxDevices=128;
const allowed=new Set(['sd','hd','uhd']);

/** Keep confirmed manual sizes scoped to this account context and physical lens. */
export class CameraQualityReadings {
 private saved:LensSizes=new Map();
 private samples=new Map<number,Sample>();
 private quality='auto';
 private pending?:string;

 bind(context:DeviceContext,model:string):void {
  const key=JSON.stringify([context.homeId,context.generation,context.did,model]);
  let saved=devices.get(key);
  if(!saved){
   if(devices.size>=maxDevices)devices.delete(devices.keys().next().value!);
   saved=new Map();devices.set(key,saved);
  }
  this.saved=saved;
 }
 private clearFrames():void{this.samples.clear();}
 reset(quality:string):void{this.quality=quality;this.pending=undefined;this.clearFrames();}
 begin(quality:string):void{if(this.pending!==quality){this.pending=quality;this.clearFrames();}}
 confirm(quality:string):void{if(this.quality!==quality||this.pending)this.reset(quality);}
 cancel():void{this.pending=undefined;this.clearFrames();}
 observe(lens:number,size:CameraDecodedSize,stream:string,quality?:string):boolean {
  if(this.pending||!quality||quality!==this.quality||!allowed.has(quality)||!Number.isInteger(size.width)||!Number.isInteger(size.height)||size.width<=0||size.height<=0||size.width>32768||size.height>32768)return false;
  const key=JSON.stringify([stream,quality,size.width,size.height]),previous=this.samples.get(lens);
  if(previous?.key===key){if(previous.count>=3||++previous.count!==3)return false;}
  else{this.samples.set(lens,{key,size:{width:size.width,height:size.height},count:1});return false;}
  const measured=previous.size;
  const sizes=this.saved.get(lens)??{};
  if(sizes[quality]?.width===measured.width&&sizes[quality]?.height===measured.height)return false;
  sizes[quality]=measured;this.saved.set(lens,sizes);return true;
 }
 sizes(lens:number):CameraQualitySizes{return {...this.saved.get(lens)};}
}
