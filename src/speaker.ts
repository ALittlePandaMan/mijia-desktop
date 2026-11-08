import type {AppError,DeviceContext,DevicePanel} from './types';
import {numericValue} from './panel-layout';
import {normalizeError} from './logic';
import {ReportOperations} from './report-operations';
export interface SpeakerPlayer {
 did:string;model:string;fetchedAt:number;status:0|1|2|null;hasSong:boolean;
 title:string|null;artist:string|null;cover:string|null;
 position:number|null;duration:number|null;volume:number|null;
}
export function speakerMetadataSupported(model:string):boolean{return ['xiaomi.wifispeaker.s12','xiaomi.wifispeaker.l05c','xiaomi.wifispeaker.lx06'].includes(model)}
export function playerPresentation(player:SpeakerPlayer|undefined):'loading'|'song'|'empty'|'unknown'{return !player?'loading':player.hasSong?'song':player.status===0?'empty':'unknown'}
export type SpeakerChange={operation:'volume';value:number}|{operation:'previous'|'next'};
export class SpeakerState{
 private state:ReportOperations<SpeakerPlayer,{operation:'volume';value:number}>;
 private context?:DeviceContext;private scope='';private identity='';private restores=new Map<string,number>();private epoch=0;
 private transportTail=Promise.resolve();actionPending=false;actionMessage='';
 constructor(private api:{read:(c:DeviceContext)=>Promise<SpeakerPlayer>;change:(c:DeviceContext,change:SpeakerChange)=>Promise<void>},private changed:()=>void,private failed:(e:AppError)=>void){
  this.state=new ReportOperations({read:api.read,send:async(c,r,i)=>{await api.change(c,i);return{report:r,confirmed:false}},
   validate:(r,c)=>{if(r.did!==c.did||!speakerMetadataSupported(r.model)||r.status!==null&&![0,1,2].includes(r.status)||r.volume!==null&&(!Number.isFinite(r.volume)||r.volume<0||r.volume>100))throw Error('音箱播放状态与设备不匹配。');},
   key:()=> 'volume',project:(r,c)=>({...r,volume:c.value}),matches:(r,c)=>r.volume===c.value,interval:5000},changed,failed);
 }
 get report(){return this.state.report;}get actual(){return this.state.actual;}get error(){return this.state.error;}get pending(){return this.state.pending;}
 get uncertain(){return this.state.uncertain;}get message(){return this.state.message||this.actionMessage;}
 bind(c:DeviceContext,scope:string){const id=JSON.stringify([scope,c.homeId,c.generation,c.did]);if(id!==this.identity){this.close();if(scope!==this.scope)this.restores.clear();this.scope=scope;this.identity=id;this.context={...c};this.state.bind(c,scope);}}
 close(){++this.epoch;this.context=undefined;this.identity='';this.state.close();this.actionPending=false;this.actionMessage='';}
 read(){return this.state.read();}adopt(){this.state.adopt();}
 seedPanel(panel:DevicePanel){if(panel.did!==this.context?.did||!speakerMetadataSupported(panel.model))return;const p=panel.services.find(s=>s.name==='speaker')?.properties.find(p=>p.name==='volume'),volume=!p?.pending?numericValue(p):undefined;if(volume===undefined||!Number.isInteger(volume)||volume<0||volume>100)return;this.state.seed({did:panel.did,model:panel.model,fetchedAt:Date.now()/1000,status:null,hasSong:false,title:null,artist:null,cover:null,position:null,duration:null,volume});}
 volume(value:number){if(!Number.isInteger(value)||value<0||value>100)return;return this.state.change({operation:'volume',value});}
 mute(){const volume=this.report?.volume;if(volume==null)return;if(volume>0){this.restores.set(this.identity,volume);return this.volume(0);}return this.volume(this.restores.get(this.identity)??30);}
 async step(operation:'previous'|'next'){
  if(!this.context)return;const c={...this.context},epoch=this.epoch;this.actionPending=true;this.actionMessage=operation==='previous'?'正在切换上一首…':'正在切换下一首…';this.changed();
  const job=this.transportTail.then(async()=>{if(epoch!==this.epoch)return;await this.api.change(c,{operation});});this.transportTail=job.catch(()=>{});
  try{await job;if(epoch===this.epoch){this.actionMessage='已发送切歌操作';void this.read();}}
  catch(error){if(epoch===this.epoch){const e=normalizeError(error);this.actionMessage=e.message;this.failed(e);}}
  finally{if(epoch===this.epoch){this.actionPending=false;this.changed();}}
 }
}
