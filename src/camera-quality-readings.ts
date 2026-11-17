import type {DeviceContext} from './types';
import type {CameraDecodedSize,CameraQualitySizes} from './camera-quality';

type Reading={size:CameraDecodedSize;stream:string};
type LensSizes=Map<number,Record<string,CameraDecodedSize>>;
// Dimensions are device metadata, stored under the same cloud identity scope as
// quality preferences. Live frame ownership remains scoped to the generation.
const devices=new Map<string,LensSizes>();
const valid=(size:CameraDecodedSize)=>Number.isInteger(size.width)&&Number.isInteger(size.height)&&size.width>0&&size.height>0&&size.width<=32768&&size.height<=32768;
const storageKey='mijia.camera-resolutions.v1',maxDevices=128,maxAge=30*24*60*60*1000;
type Stored={key:string;at:number;lenses:[number,Record<string,CameraDecodedSize>][]};
let stored:Stored[]|undefined;
function savedDevices():Stored[]{
 if(stored)return stored;
 stored=[];
 try{
  const data:unknown=JSON.parse(localStorage.getItem(storageKey)??'[]');
  if(Array.isArray(data))for(const row of data.slice(-maxDevices)){
   if(!row||typeof row.key!=='string'||row.key.length>2048||!Number.isFinite(row.at)||row.at>Date.now()||Date.now()-row.at>maxAge||!Array.isArray(row.lenses))continue;
   const lenses:Stored['lenses']=[];
   for(const lens of row.lenses.slice(0,8)){
    if(!Array.isArray(lens)||!Number.isInteger(lens[0])||lens[0]<0||lens[0]>255||!lens[1]||typeof lens[1]!=='object')continue;
    const sizes:Record<string,CameraDecodedSize>={};
    for(const id of ['sd','hd','uhd']){const size=lens[1][id];if(size&&valid(size))sizes[id]={width:size.width,height:size.height};}
    lenses.push([lens[0],sizes]);
   }
   stored.push({key:row.key,at:row.at,lenses});
  }
 }catch{/* Playback and in-memory readings work when local storage is unavailable. */}
 return stored;
}

export class CameraQualityReadings {
 private saved:LensSizes=new Map();
 private storageIdentity='';
 private frames=new Map<number,Reading>();
 private quality='auto';
 private change?:{quality:string;confirmed:boolean;before:Map<number,string>;ready:Set<number>};

 bind(context:DeviceContext,model:string):void {
  const key=JSON.stringify([context.homeId,context.generation,context.did,model]);
  this.storageIdentity=JSON.stringify([context.homeId,context.did,model]);
  let saved=devices.get(key);
  if(!saved){saved=new Map(savedDevices().find(row=>row.key===this.storageIdentity)?.lenses);if(devices.size>=maxDevices)devices.delete(devices.keys().next().value!);devices.set(key,saved);}
  this.saved=saved;
 }
 reset(quality:string):void {this.quality=quality;this.frames.clear();this.change=undefined;}
 begin(quality:string):void {
  if(this.change?.quality===quality)return;
  this.change={quality,confirmed:false,before:new Map([...this.frames].map(([lens,frame])=>[lens,frame.stream])),ready:new Set()};
 }
 confirm(quality:string):void {
  if(!this.change&&this.quality===quality)return;
  if(this.change?.quality!==quality)this.begin(quality);
  this.quality=quality;this.change!.confirmed=true;
  for(const [lens,frame]of this.frames)if(frame.stream!==this.change!.before.get(lens))this.remember(lens,frame);
 }
 cancel():void {this.change=undefined;}
 observe(lens:number,size:CameraDecodedSize,stream:string):void {
  if(!valid(size))return;
  const frame={size:{width:size.width,height:size.height},stream};this.frames.set(lens,frame);
  // An acknowledgement can precede the new codec parameters. Keep old frames
  // out of the new manual tier until that lens actually changes media revision.
  if(this.change&&(!this.change.confirmed||this.quality!=='auto'&&stream===this.change.before.get(lens)))return;
  this.remember(lens,frame);
 }
 sizes(lens:number):CameraQualitySizes {
  const sizes={...this.saved.get(lens)};
  const frame=this.frames.get(lens);
  if(this.quality==='auto'&&frame&&(!this.change||this.change.confirmed&&this.change.ready.has(lens)))sizes.auto=frame.size;
  return sizes;
 }
 private remember(lens:number,frame:Reading):void {
  this.change?.ready.add(lens);
  if(this.quality==='auto')return;
  const sizes=this.saved.get(lens)??{};
  const previous=sizes[this.quality];
  if(previous?.width===frame.size.width&&previous.height===frame.size.height)return;
  sizes[this.quality]=frame.size;this.saved.set(lens,sizes);
  if(!this.storageIdentity)return;
  stored=[...savedDevices().filter(row=>row.key!==this.storageIdentity),{key:this.storageIdentity,at:Date.now(),lenses:[...this.saved]}].slice(-maxDevices);
  try{localStorage.setItem(storageKey,JSON.stringify(stored));}catch{/* Keep the current session's dimensions if storage is full or denied. */}
 }
}
