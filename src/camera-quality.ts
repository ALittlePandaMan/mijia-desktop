import type {DeviceContext} from './types';
import type {CameraFeatures} from './camera-types';

type Qualities=CameraFeatures['qualities'];
export interface CameraDecodedSize{width:number;height:number}
export type CameraQualitySizes=Readonly<Record<string,CameraDecodedSize|undefined>>;
// Standard plugin 4433: the 069 family overrides its resolution indices with
// [1, 8, 6]. Indices 1/6 publish these dimensions; index 8 only publishes a
// model-specific name, so its exact dimensions must come from decoded frames.
const modelSizes:Record<string,Record<string,string>>=Object.fromEntries(
  ['chuangmi.camera.069a01','chuangmi.camera.069a02','xiaomi.camera.069a03'].map(model=>[model,{uhd:'2960×1666',sd:'864×480'}])
);
export function cameraQualityProfiles(qualities:Qualities,model:string):Qualities{
  return qualities.map(q=>({...q,resolution:q.resolution??modelSizes[model]?.[q.id]}));
}
function sameResolution(a:Qualities[number],b:Qualities[number],sizes:CameraQualitySizes):boolean{
  const aName=resolution(a.label),bName=resolution(b.label);
  // Published distinct tiers must not disappear because a transitional frame
  // happened to have the previous tier's dimensions.
  if(aName&&bName&&aName!==bName)return false;
  if(a.resolution&&b.resolution&&a.resolution!==b.resolution)return false;
  const left=pixels(sizes[a.id])??a.resolution,right=pixels(sizes[b.id])??b.resolution;
  if(left&&right)return left===right;
  return !!aName&&aName===bName;
}
function tiers(qualities:Qualities,sizes:CameraQualitySizes={}){
  const original=qualities.find(q=>q.id==='uhd')??qualities.find(q=>q.id==='hd');
  const middle=original?.id==='uhd'?qualities.find(q=>q.id==='hd'):undefined;
  const duplicate=!!original&&!!middle&&sameResolution(original,middle,sizes);
  return [
    {mode:'original',label:'原画',profile:original,aliases:duplicate?[middle!.id]:[]},
    {mode:'hd',label:'高清',profile:duplicate?undefined:middle,aliases:[]},
    {mode:'sd',label:'流畅',profile:qualities.find(q=>q.id==='sd'),aliases:[]},
    {mode:'auto',label:'自动',profile:qualities.find(q=>q.id==='auto'),aliases:[]},
  ].filter(q=>q.profile);
}
function resolution(label:string):string|undefined{return /^\d+(?:\.\d+)?[KP]$/i.test(label)?label.toUpperCase():undefined;}
function pixels(frame?:CameraDecodedSize):string|undefined{return frame&&Number.isInteger(frame.width)&&Number.isInteger(frame.height)&&frame.width>0&&frame.height>0?`${frame.width}×${frame.height}`:undefined;}
// Exact size names from the already recovered standard-plugin resolution table.
// K is a vendor name, not a rounded pixel count; unknown sizes stay as pixels.
const kSizes:Record<string,string>={'3840×2160':'4K','3200×1800':'3.5K','2880×1620':'3K','2960×1666':'3K','2560×1440':'2.5K','2304×1296':'2K'};
function matchesResolution(label:string,frame:CameraDecodedSize):boolean{
  const long=Math.max(frame.width,frame.height),short=Math.min(frame.width,frame.height);
  return label.endsWith('P')?Number(label.slice(0,-1))===short:kSizes[`${long}×${short}`]===label;
}
/** Show only verified model tiers, with their published resolution when known.
 * Keep native IDs; two-resolution cameras do not acquire a synthetic middle. */
export function cameraQualityOptions(qualities:Qualities=[],frame?:CameraDecodedSize,selected?:string,sizes:CameraQualitySizes={}){
  const readings=frame&&selected?{...sizes,[selected]:frame}:sizes;
  return tiers(qualities,readings).map(q=>({mode:q.mode,label:cameraQualityLabel(qualities,q.profile!.id,readings[q.profile!.id],readings),id:q.profile!.id,aliases:q.aliases,available:true}));
}
/** Keep toolbar buttons compact; resolution details belong to the open menu. */
export function cameraQualityButtonLabel(qualities:Qualities=[],id:string,sizes:CameraQualitySizes={}):string{
  return id==='auto'?'自动':tiers(qualities,sizes).find(q=>q.profile!.id===id||q.aliases.includes(id))?.label??'画质';
}
export function cameraQualityLabel(qualities:Qualities=[],id:string,frame?:CameraDecodedSize,sizes:CameraQualitySizes={}):string{
  const readings=frame?{...sizes,[id]:frame}:sizes,options=tiers(qualities,readings),selected=options.find(q=>q.profile!.id===id||q.aliases.includes(id)),size=pixels(readings[id]);
  if(id==='auto'){
    if(!size)return '自动';
    const actual=size&&options.find(q=>q.mode!=='auto'&&resolution(q.profile!.label)&&matchesResolution(resolution(q.profile!.label)!,frame!));
    return `自动（${actual?`${actual.label}·${resolution(actual.profile!.label)}`:size}）`;
  }
  const detail=size??selected?.profile?.resolution??(selected&&resolution(selected.profile!.label));
  return selected?selected.label+(detail?`（${detail}）`:''):'画质';
}

const profiles = new Set(['auto', 'sd', 'hd', 'uhd']);
// Device IDs are cloud identities. Generation is deliberately excluded so a new
// opening can restore the choice; home/model prevent cross-device reuse.
function key(context:DeviceContext, model:string):string {
  return 'mijia.camera-quality.v1:' + JSON.stringify([context.homeId, context.did, model]);
}
export function rememberedCameraQuality(context:DeviceContext, model:string):string {
  try {
    const value = localStorage.getItem(key(context, model));
    return value && profiles.has(value) ? value : 'auto';
  } catch { return 'auto'; }
}
export function rememberCameraQuality(context:DeviceContext, model:string, quality:string):boolean {
  if (!profiles.has(quality)) return false;
  try { localStorage.setItem(key(context, model), quality); return true; }
  catch { return false; }
}
