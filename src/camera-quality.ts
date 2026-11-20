import type {DeviceContext} from './types';
import type {CameraFeatures} from './camera-types';

type Qualities=CameraFeatures['qualities'];
const manualQualityNames=Object.entries({sd:'流畅',hd:'高清',uhd:'超清'});
export interface CameraDecodedSize{width:number;height:number}
export type CameraQualitySizes=Readonly<Record<string,CameraDecodedSize|undefined>>;
function sameStream(a:Qualities[number],b:Qualities[number],sizes:CameraQualitySizes):boolean{
  if(a.wireValue!==undefined&&a.wireValue===b.wireValue)return true;
  const left=pixels(sizes[a.id]);
  return left!==undefined&&left===pixels(sizes[b.id]);
}
function tiers(qualities:Qualities,sizes:CameraQualitySizes={}){
  // Prefer the actual low/high command when an extra native code aliases it.
  const manual:{mode:string;label:string;profile:Qualities[number];aliases:string[]}[]=[];
  for(const [mode,label] of manualQualityNames){
    const profile=qualities.find(q=>q.id===mode);if(!profile)continue;
    const existing=manual.find(tier=>sameStream(tier.profile,profile,sizes));
    if(existing)existing.aliases.push(mode);else manual.push({mode,label,profile,aliases:[]});
  }
  manual.reverse();
  const auto=qualities.find(q=>q.id==='auto');
  return auto?[...manual,{mode:'auto',label:'自动',profile:auto,aliases:[]}]:manual;
}
function pixels(frame?:CameraDecodedSize):string|undefined{return frame&&Number.isInteger(frame.width)&&Number.isInteger(frame.height)&&frame.width>0&&frame.height>0?`${frame.width}×${frame.height}`:undefined;}
/** Use model tiers; stable dimensions are only used internally to identify aliases. */
export function cameraQualityOptions(qualities:Qualities=[],sizes:CameraQualitySizes={}){
  return tiers(qualities,sizes).map(q=>({mode:q.mode,label:q.label,id:q.profile.id,aliases:q.aliases,available:true}));
}
export function cameraQualityButtonLabel(qualities:Qualities=[],id:string,sizes:CameraQualitySizes={}):string{
  return id==='auto'?'自动':tiers(qualities,sizes).find(q=>q.profile.id===id||q.aliases.includes(id))?.label??'画质';
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
