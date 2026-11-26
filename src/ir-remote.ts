import type {AppError,DeviceContext} from './types';
import {normalizeError,sameContext} from './logic';
export interface IrReport{model:string;baseline:string;keys:{name:string;label:string}[]}
export const isIrRemote=(model:string)=>['miir.tv.ir01','miir.stb.ir01','miir.tvbox.ir01','miir.projector.ir01','miir.remote.ir01'].includes(model);
/** Aliases select an existing server key, never synthesize a missing command. */
export function irControlKeys(report:IrReport):Record<string,IrReport['keys'][number]|undefined>{
 const learned=report.model==='miir.remote.ir01',names:Record<string,string>=learned
  ?{power:'电源','volume-down':'-','volume-up':'+',up:'上',left:'左',center:'确认',right:'右',down:'下',home:'主页',back:'返回'}
  :{power:'POWER','volume-down':'VOL-','volume-up':'VOL+',up:'NAVIGATE_UP',left:'NAVIGATE_LEFT',center:'OK',right:'NAVIGATE_RIGHT',down:'NAVIGATE_DOWN',home:'HOMEPAGE',back:'BACK',menu:'MENU'};
 return Object.fromEntries(Object.entries(names).map(([role,name])=>[role,report.keys.find(key=>key.name===name)]));
}
export interface IrApi{read:(c:DeviceContext)=>Promise<IrReport>;send:(c:DeviceContext,baseline:string,name:string,nonce:string)=>Promise<string>}
export class IrRemoteState{
 report:IrReport|undefined;loading=false;pending=false;message='';error:AppError|undefined;uncertain=false;
 private epoch=0;private context:DeviceContext|undefined;private model='';private scope='';private unresolved=new Set<string>();private inFlight=new Map<string,Set<string>>();private tail=Promise.resolve();
 constructor(private api:IrApi,private changed:()=>void,private failed:(e:AppError)=>void,private nonce:()=>string=()=>crypto.randomUUID()){}
 private key(){return JSON.stringify([this.scope,this.context?.homeId,this.context?.did]);}
 close(){this.epoch++;this.context=undefined;this.report=undefined;this.loading=false;this.pending=false;this.message='';this.error=undefined;this.uncertain=false;}
 bind(context:DeviceContext,model:string,scope:string){this.close();this.context={...context};this.model=model;this.scope=scope;this.uncertain=this.unresolved.has(this.key());this.pending=this.inFlight.has(this.key());}
 async read(){if(!this.context||this.loading||this.pending)return;const c={...this.context},epoch=this.epoch;this.loading=true;this.error=undefined;this.changed();try{const report=await this.api.read(c);if(epoch!==this.epoch||!sameContext(c,this.context))return;if(report.model!==this.model||!isIrRemote(report.model))throw {kind:'protocol',message:'遥控器型号不匹配。',retryable:false};this.report=report;}catch(e){if(epoch!==this.epoch)return;this.error=normalizeError(e);this.failed(this.error);}finally{if(epoch===this.epoch){this.loading=false;this.changed();}}}
 lastPressed?:string;
 async press(name:string){
  if(!this.context||!this.report||this.loading||!this.report.keys.some(k=>k.name===name))return;
  const c={...this.context},epoch=this.epoch,key=this.key(),baseline=this.report.baseline,keys=this.inFlight.get(key)??new Set<string>();
  if(keys.has(name))return;
  const ticket=this.nonce();
  keys.add(name);this.inFlight.set(key,keys);this.lastPressed=name;this.pending=true;this.error=undefined;this.message='';this.changed();
  const job=this.tail.then(async()=>{
   if(epoch!==this.epoch||!sameContext(c,this.context))return;
   this.unresolved.add(key);
   try{await this.api.send(c,baseline,name,ticket);this.unresolved.delete(key);}
   catch(e){const error=normalizeError(e);if(['permissionDenied','offline','conflict','invalidInput','unsupported','authExpired'].includes(error.kind))this.unresolved.delete(key);if(epoch===this.epoch){this.error=error;this.failed(error);}}
  });this.tail=job.catch(()=>{});
  try{await job;}finally{keys.delete(name);if(!keys.size)this.inFlight.delete(key);if(this.context&&this.key()===key){this.pending=keys.size>0;this.uncertain=this.unresolved.has(key);this.changed();if(!this.report)void this.read();}}
 }

 keyPending(name:string):boolean{return this.inFlight.get(this.key())?.has(name)??false;}
 acknowledge(){if(this.pending)return;this.unresolved.delete(this.key());this.uncertain=false;this.error=undefined;this.message='';this.changed();}
}
