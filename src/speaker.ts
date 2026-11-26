import type {AppError,Device,DeviceContext,DevicePanel,Property} from './types';
import {isReadableValue,numericValue} from './panel-layout';
import {normalizeError} from './logic';
import {ReportOperations} from './report-operations';
import {detailProperty,detailPropertyAt,detailServices} from './appliance-details';
import {capabilityCategory,readOnlyCategory,validChoices,validRange} from './device-capabilities';
export interface SpeakerPlayer {
 did:string;model:string;fetchedAt:number;status:0|1|2|null;hasSong:boolean;
 title:string|null;artist:string|null;cover:string|null;
 position:number|null;duration:number|null;volume:number|null;
}
export function speakerMetadataSupported(model:string):boolean{return ['xiaomi.wifispeaker.s12','xiaomi.wifispeaker.l05c','xiaomi.wifispeaker.lx06'].includes(model)}
const audioCategories=new Set(['speaker','ble-speaker','radio','robot','story-machine','audio-video-amplifier']);
const audioModelTypes=new Set(['wifispeaker','btspker','radio','robot','mistory','mistudy','avamp']);
export function audioDetailEligible(device:Pick<Device,'model'|'specType'>,panel?:DevicePanel):boolean {
 const category=capabilityCategory(panel?.specType??device.specType);
 return category?audioCategories.has(category):audioModelTypes.has(device.model.split('.')[1]);
}
export type TrackDirection='next'|'previous';
const amplifierVolumeIds:Record<string,number>={
 'urn:miot-spec-v2:device:audio-video-amplifier:0000A0D6:vidon-wd2:1:0000C83D':6,
 'urn:miot-spec-v2:device:audio-video-amplifier:0000A0D6:yihe-yjn01:1:0000C83D':2,
 'urn:miot-spec-v2:device:audio-video-amplifier:0000A0D6:yihe-yybfj:1:0000C83D':2,
};
const singlePlaybackZone=new Set([
 'urn:miot-spec-v2:device:speaker:0000A015:wise-x7:1',
 'urn:miot-spec-v2:device:speaker:0000A015:090615-x6bj:1',
]);
export function audioBindings(device:Device,panel:DevicePanel){
 const amplifier=capabilityCategory(panel.specType)==='audio-video-amplifier';
 const services=detailServices(panel);
 const volumeServices=services.filter(s=>s.name===(amplifier?'audio-video-amplifier':'speaker')&&
   (device.controlServiceId==null||device.controlServiceId===s.siid));
 const control=volumeServices.length===1?volumeServices[0]:undefined;
 const outputId=Object.hasOwn(amplifierVolumeIds,panel.specType??'')?amplifierVolumeIds[panel.specType!]:undefined;
 const candidate=control&&(outputId&&control.siid===2?detailPropertyAt(control,outputId,'volume'):detailProperty(control,'volume'));
 const volume=candidate?.access.includes('read')&&(validRange(candidate)||validChoices(candidate)&&candidate.valueList!.length>1&&
   candidate.valueList!.every(choice=>typeof choice.value==='number'))?candidate:undefined;
 const zoned=singlePlaybackZone.has(panel.specType??'');
 const playback=services.filter(s=>(zoned?s.name==='zone-state-one'&&s.siid===4:s.name==='play-control')&&
   (device.controlServiceId==null||device.controlServiceId===s.siid));
 const service=playback.length===1?playback[0]:undefined;
 const command=(name:TrackDirection|'play'|'pause')=>{
   if(!service||readOnlyCategory(panel.specType))return;
   const actions=service.actions.filter(action=>action.name===name||(['next','previous'].includes(name)&&action.name===`${name}-song`));
   if(actions.length!==1)return;
   const action=actions[0];
   if(action.siid===service.siid&&Number.isSafeInteger(action.aiid)&&action.aiid>0&&!action.unsupportedReason&&
     !action.in.length&&service.actions.filter(other=>other.aiid===action.aiid).length===1)return {action,service,inputs:[]};
 };
 const play=command('play'),pause=command('pause');
 const state=service&&detailProperty(service,'playing-state');
 const readings=['current-track-id','current-song-id','track-name','song-name','music-title','music-id']
   .map(name=>service&&detailProperty(service,name)).filter(isReadableValue);
 const hasSong=readings.length?readings.some(({value})=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0
   ||typeof value==='string'&&!/^(?:|0|null|none|undefined|\[\]|\{\})$/i.test(value.trim())):undefined;
 return {volume,next:command('next'),previous:command('previous'),play,pause,state,hasSong};
}

export function playbackBinding(state:Property|undefined){
 if(!state||!validChoices(state))return;
 const matches=(patterns:RegExp)=>state.valueList!.filter(v=>patterns.test(v.description.trim()));
 const playing=matches(/^(play|playing|播放中)$/i);
 const paused=matches(/^(pause|paused|暂停|已暂停)$/i);
 const idle=matches(/^(idle|stop|stopped|空闲|停止|已停止|待机)$/i);
 if(playing.length!==1||paused.length>1||!paused.length&&idle.length!==1)return;
 return {property:state,playing:playing[0].value,paused:(paused[0]??idle[0]).value,idle:idle.map(v=>v.value)};
}

export function playbackActive(binding:ReturnType<typeof playbackBinding>):boolean|undefined{
 if(!binding||!isReadableValue(binding.property))return;
 const {value}=binding.property;
 if(value===binding.playing)return true;
 if(value===binding.paused||binding.idle.includes(value))return false;
}
export function playerPresentation(player:SpeakerPlayer|undefined):'loading'|'song'|'empty'|'unknown'{return !player?'loading':player.hasSong?'song':player.status===0?'empty':'unknown'}
export type SpeakerChange={operation:'volume';value:number}|{operation:'previous'|'next'};
type PlaybackAction={siid:number;aiid:number};
type PlayerIntent=Extract<SpeakerChange,{operation:'volume'}>|{operation:'playback';playing:boolean;action:PlaybackAction};
export class SpeakerState{
 private state:ReportOperations<SpeakerPlayer,PlayerIntent>;
 private context?:DeviceContext;private scope='';private identity='';private restores=new Map<string,number>();private epoch=0;
 private pendingSteps=new Set<TrackDirection>();
 private transportTail=Promise.resolve();
 private observedSong?:Property;
 constructor(private api:{read:(c:DeviceContext)=>Promise<SpeakerPlayer>;change:(c:DeviceContext,change:SpeakerChange)=>Promise<void>;
   action?:(c:DeviceContext,action:PlaybackAction)=>Promise<unknown>},private changed:()=>void,private failed:(e:AppError)=>void){
  this.state=new ReportOperations({read:api.read,send:async(c,r,i)=>{
   if(i.operation==='playback')await api.action!(c,i.action);else await api.change(c,i);
   return{report:r,confirmed:false};
  },
   validate:(r,c)=>{if(r.did!==c.did||!speakerMetadataSupported(r.model)||r.status!==null&&![0,1,2].includes(r.status)||r.volume!==null&&(!Number.isFinite(r.volume)||r.volume<0||r.volume>100))throw Error('音箱播放状态与设备不匹配。');},
   key:i=>i.operation,project:(r,i)=>i.operation==='playback'?{...r,status:i.playing?1:2}:{...r,volume:i.value},
   allowed:(r,i)=>i.operation==='volume'||(r.status===1||r.status===2)&&(!i.playing||r.hasSong),
   matches:(r,i)=>i.operation==='playback'?r.status===(i.playing?1:2):r.volume===i.value,interval:5000},changed,failed);
 }
 get report(){return this.state.report;}get actual(){return this.state.actual;}get error(){return this.state.error;}get pending(){return this.state.pending;}
 get uncertain(){return this.state.uncertain;}
 bind(c:DeviceContext,scope:string){const id=JSON.stringify([scope,c.homeId,c.generation,c.did]);if(id!==this.identity){this.close();if(scope!==this.scope)this.restores.clear();this.scope=scope;this.identity=id;this.context={...c};this.state.bind(c,scope);}}
 close(){++this.epoch;this.context=undefined;this.identity='';this.state.close();this.pendingSteps.clear();this.observedSong=undefined;}
 read(){return this.state.read();}adopt(){this.state.adopt();}
 seedPanel(panel:DevicePanel){if(panel.did!==this.context?.did||!speakerMetadataSupported(panel.model))return;const p=panel.services.find(s=>s.name==='speaker')?.properties.find(p=>p.name==='volume'),volume=!p?.pending?numericValue(p):undefined;if(volume===undefined||!Number.isInteger(volume)||volume<0||volume>100)return;this.state.seed({did:panel.did,model:panel.model,fetchedAt:Date.now()/1000,status:null,hasSong:false,title:null,artist:null,cover:null,position:null,duration:null,volume});}
 volume(value:number){if(!Number.isInteger(value)||value<0||value>100)return;return this.state.change({operation:'volume',value});}
 playbackStatus(audio:ReturnType<typeof audioBindings>){
  const binding=playbackBinding(audio.state),property=binding?.property;
  const active=playbackActive(binding);
  const paused=active===false&&!!binding&&!binding.idle.includes(property!.value!);
  if(!property?.pending){
   if(active===true)this.observedSong=property;
   else if(!paused)this.observedSong=undefined;
  }
  const player=this.error?undefined:this.report;
  if(player?.status!=null&&this.api.action){
   return {binding,playing:player.status===1,resumable:player.status===2&&player.hasSong,privatePlayer:true};
  }
  const sameTrack=this.observedSong?.siid===property?.siid&&this.observedSong?.piid===property?.piid&&!!property;
  return {binding,playing:active===true,resumable:paused&&(audio.hasSong??sameTrack),privatePlayer:false};
 }
 setPlayback(playing:boolean,action:PlaybackAction){
  if(!this.api.action||!this.report)return;
  return this.state.change({operation:'playback',playing,action});
 }
 mute(){const volume=this.report?.volume;if(volume==null)return;if(volume>0){this.restores.set(this.identity,volume);return this.volume(0);}return this.volume(this.restores.get(this.identity)??30);}
 stepPending(operation:TrackDirection):boolean{return this.pendingSteps.has(operation);}
 async step(operation:TrackDirection){
  if(!this.context||this.pendingSteps.has(operation))return;
  const c={...this.context},epoch=this.epoch;
  this.pendingSteps.add(operation);this.changed();
  const job=this.transportTail.then(async()=>{if(epoch!==this.epoch)return;await this.api.change(c,{operation});});this.transportTail=job.catch(()=>{});
  try{await job;if(epoch===this.epoch)void this.read();}
  catch(error){if(epoch===this.epoch)this.failed(normalizeError(error));}
  finally{if(epoch===this.epoch){this.pendingSteps.delete(operation);this.changed();}}
 }
}
