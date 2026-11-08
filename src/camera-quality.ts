import type {DeviceContext} from './types';
import type {CameraFeatures} from './camera-types';

type Qualities=CameraFeatures['qualities'];
export interface CameraDecodedSize{width:number;height:number}
function tiers(qualities:Qualities){
  const original=qualities.find(q=>q.id==='uhd')??qualities.find(q=>q.id==='hd');
  return [
    {mode:'original',label:'原画',profile:original},
    {mode:'hd',label:'高清',profile:original?.id==='uhd'?qualities.find(q=>q.id==='hd'):undefined},
    {mode:'sd',label:'流畅',profile:qualities.find(q=>q.id==='sd')},
    {mode:'auto',label:'自动',profile:qualities.find(q=>q.id==='auto')},
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
export function cameraQualityOptions(qualities:Qualities=[],frame?:CameraDecodedSize,selected?:string){
  return tiers(qualities).map(q=>({mode:q.mode,label:cameraQualityLabel(qualities,q.profile!.id,q.profile!.id===selected?frame:undefined),id:q.profile!.id,available:true}));
}
/** Keep toolbar buttons compact; resolution details belong to the open menu. */
export function cameraQualityButtonLabel(qualities:Qualities=[],id:string):string{
  return id==='auto'?'自动':tiers(qualities).find(q=>q.profile!.id===id)?.label??'画质';
}
export function cameraQualityLabel(qualities:Qualities=[],id:string,frame?:CameraDecodedSize):string{
  const options=tiers(qualities),selected=options.find(q=>q.profile!.id===id),size=pixels(frame);
  if(id==='auto'){
    const actual=size&&options.find(q=>q.mode!=='auto'&&resolution(q.profile!.label)&&matchesResolution(resolution(q.profile!.label)!,frame!));
    return `自动（${actual?`${actual.label}·${resolution(actual.profile!.label)}`:size??'--'}）`;
  }
  return selected?`${selected.label}（${resolution(selected.profile!.label)??size??'--'}）`:'画质';
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
