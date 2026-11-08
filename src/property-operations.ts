import type {Json} from './types';
export interface PropertyReply {outcome:'confirmed'|'rejected'|'pending';actual?:Json;message:string}
export interface PropertyOperation {revision:number;settledRevision:number;confirmed:Json;observed?:Json;target:Json;pending:boolean;phase:'sending'|'uncertain';message:string;running:boolean;unresolved?:{target:Json;revision:number};retries:number;outcome?:'confirmed'|'rejected';sentRevision?:number}
type Transport=(key:string,target:Json)=>Promise<PropertyReply>;
const equal=(a:Json|undefined,b:Json|undefined)=>JSON.stringify(a)===JSON.stringify(b);
export function explicitRejection(error:unknown):boolean{return ['invalidInput','invalidValue','permissionDenied','unsupported','offline','authExpired','staleContext','stateSuperseded','conflict','unavailable'].includes((error as {kind?:string})?.kind??'');}
/** Latest local intent owns presentation. Each intent is sent once; reads only
 * verify it, and old read values are never interpreted as command rejection. */
export class PropertyOperations {
 private cells=new Map<string,PropertyOperation>();private clock=0;private epoch=0;
 private timers=new Map<string,ReturnType<typeof setTimeout>>();private wakes=new Map<string,()=>void>();private active=true;
 constructor(private send:Transport,private read:Transport,private changed:()=>void,private wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){}
 get version(){return this.clock;}
 get pendingCount(){return [...this.cells.values()].filter(c=>c.pending).length;}
 get uncertainCount(){return [...this.cells.values()].filter(c=>c.pending&&c.phase==='uncertain').length;}
 get(key:string):Readonly<PropertyOperation>|undefined{return this.cells.get(key);}
 entries():ReadonlyArray<readonly[string,Readonly<PropertyOperation>]>{return [...this.cells];}
 cancel(key:string,notify=true){this.cells.delete(key);clearTimeout(this.timers.get(key));this.timers.delete(key);this.wakes.get(key)?.();++this.clock;if(notify)this.changed();}
 get lastSettled(){return [...this.cells.values()].filter(c=>!c.pending&&c.settledRevision).sort((a,b)=>b.settledRevision-a.settledRevision)[0];}
 reset(){++this.epoch;for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();for(const wake of this.wakes.values())wake();this.wakes.clear();this.cells.clear();++this.clock;}
 setActive(active:boolean){this.active=active;if(!active){for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();}else this.resume();}
 write(key:string,target:Json,confirmed:Json){
  let c=this.cells.get(key);if(c?.pending&&equal(c.target,target))return;
  if(!c){c={revision:0,settledRevision:0,confirmed,observed:confirmed,target,pending:false,phase:'sending',message:'',running:false,retries:0};this.cells.set(key,c);}else if(!c.pending){c.confirmed=confirmed;c.observed=confirmed;}
  c.target=structuredClone(target);c.revision=++this.clock;c.pending=true;c.phase='sending';c.message='正在确认';c.retries=0;c.unresolved=undefined;c.outcome=undefined;
  clearTimeout(this.timers.get(key));this.timers.delete(key);this.wakes.get(key)?.();this.changed();if(!c.running)void this.pump(key,c);
 }
 resume(){for(const[key,c]of this.cells)if(c.pending&&!c.running)void this.pump(key,c);}
 display(key:string,incoming:Json|undefined,readVersion=this.clock):{value:Json|undefined;phase?:'sending'|'uncertain'}{const c=this.cells.get(key);if(!c)return{value:incoming};if(c.pending)return{value:c.target,phase:c.phase};return{value:c.settledRevision>readVersion?c.confirmed:incoming};}
 observe(key:string,actual:Json,readVersion=this.clock){const c=this.cells.get(key);if(!c||readVersion<c.revision)return;c.observed=structuredClone(actual);if(c.pending&&c.sentRevision===c.revision&&equal(actual,c.target)){this.finish(c,{outcome:'confirmed',actual,message:'已确认'});this.wakes.get(key)?.();}}
 adopt(key:string,actual?:Json){const c=this.cells.get(key);if(!c||c.phase==='sending'&&c.pending)return;const value=actual??c.observed??c.confirmed;c.revision=++this.clock;this.finish(c,{outcome:'confirmed',actual:value,message:'已采用设备状态'});clearTimeout(this.timers.get(key));this.timers.delete(key);this.wakes.get(key)?.();}
 private finish(c:PropertyOperation,r:PropertyReply){if(r.actual!==undefined)c.confirmed=structuredClone(r.actual);else if(r.outcome==='confirmed')c.confirmed=structuredClone(c.target);else if(c.observed!==undefined)c.confirmed=structuredClone(c.observed);c.pending=false;c.target=c.confirmed;c.unresolved=undefined;c.settledRevision=++this.clock;c.message=r.message;c.outcome=r.outcome==='rejected'?'rejected':'confirmed';this.changed();}
 private async delay(key:string,ms:number){let wake!:()=>void;const signal=new Promise<void>(r=>wake=r);this.wakes.set(key,wake);try{await Promise.race([this.wait(ms),signal]);}finally{if(this.wakes.get(key)===wake)this.wakes.delete(key);}}
 private async query(key:string,target:Json){let wake!:()=>void;const signal=new Promise<undefined>(r=>wake=()=>r(undefined));this.wakes.set(key,wake);const task=this.read(key,target).catch(e=>({outcome:'pending' as const,message:(e as {message?:string})?.message??'状态查询暂不可用。'}));try{return await Promise.race([task,signal]);}finally{if(this.wakes.get(key)===wake)this.wakes.delete(key);}}
 private async pump(key:string,c:PropertyOperation){
  const epoch=this.epoch,alive=()=>epoch===this.epoch&&this.cells.get(key)===c;c.running=true;
  try{while(alive()&&c.pending){const ticket={target:structuredClone(c.target),revision:c.revision},latest=()=>alive()&&c.pending&&c.revision===ticket.revision;
   let result:PropertyReply;
   if(c.sentRevision!==ticket.revision){c.sentRevision=ticket.revision;c.phase='sending';this.changed();try{result=await this.send(key,ticket.target);}catch(e){result={outcome:explicitRejection(e)?'rejected':'pending',message:(e as {message?:string})?.message??'操作暂未确认。'};}}
   else result={outcome:'pending',message:'待确认'};
   if(!alive())return;if(result.actual!==undefined)c.observed=structuredClone(result.actual);if(!latest())continue;if(result.outcome==='confirmed'&&result.actual!==undefined&&!equal(result.actual,ticket.target))result={...result,outcome:'pending'};
   if(result.outcome!=='pending'){this.finish(c,result);continue;}
   c.phase='uncertain';c.unresolved=ticket;c.message='待确认';this.changed();
   for(const ms of[1000,2500,5000]){if(!this.active)break;await this.delay(key,ms);if(!latest())break;const queried=await this.query(key,ticket.target);if(!queried||!latest())break;result=queried;if(result.outcome==='confirmed'&&result.actual!==undefined&&!equal(result.actual,ticket.target))result={...result,outcome:'pending'};if(result.actual!==undefined)c.observed=structuredClone(result.actual);if(result.outcome==='confirmed'||result.outcome==='rejected'||result.actual!==undefined&&equal(result.actual,ticket.target)){this.finish(c,{...result,outcome:result.outcome==='rejected'?'rejected':'confirmed'});break;}}
   if(!alive())return;if(!latest())continue;
   c.message='待确认，后台将继续核验';c.retries++;if(this.active){const timer=setTimeout(()=>{this.timers.delete(key);if(alive()&&c.pending&&!c.running)void this.pump(key,c);},15000);this.timers.set(key,timer);}this.changed();return;
  }}finally{if(alive()){c.running=false;this.changed();}}
 }
}
