import type {AppError,DeviceContext,DevicePanel,Json} from './types';
import {normalizeError} from './logic';
import {PropertyOperations} from './property-operations';
export interface ReportAdapter<R,C>{read:(c:DeviceContext)=>Promise<R>;send:(c:DeviceContext,actual:R,change:C)=>Promise<{report:R;confirmed:boolean}>;validate:(r:R,c:DeviceContext)=>void;key:(change:C)=>string;supersedes?:(change:C)=>string[];project:(r:R,change:C)=>R;matches:(r:R,change:C)=>boolean;allowed?:(r:R,change:C)=>boolean;accepted?:(c:DeviceContext,r:R)=>void;interval?:number;}
interface Entry<R>{context:DeviceContext;actual?:R;readVersion:number;error?:AppError;loading:boolean;alive:boolean;sequence:number;applied:number;readTask?:Promise<void>;tail:Promise<void>;ops:PropertyOperations;timer?:ReturnType<typeof setTimeout>;}
/** Shared report controller for private-protocol devices. Raw reports are never
 * patched with predictions; the adapter projects only the visible settings. */
export class ReportOperations<R,C>{
 private records=new Map<string,Entry<R>>();private active?:Entry<R>;private scope='';private identity='';
 constructor(private adapter:ReportAdapter<R,C>,private changed:()=>void,private failed:(e:AppError)=>void){}
 seed(report:R){const e=this.active;if(!e||e.actual)return;this.adapter.validate(report,e.context);e.actual=structuredClone(report);e.readVersion=e.ops.version;e.loading=false;}
 observe(report:R){const e=this.active;if(!e)return;this.adapter.validate(report,e.context);e.actual=structuredClone(report);e.readVersion=e.ops.version;e.applied=++e.sequence;}
 get actual(){return this.active?.actual;}
 get version(){return this.active?(this.active.ops.version+this.active.sequence):0;}
 get report():R|undefined{const e=this.active;if(!e?.actual)return;let view:R=e.actual;for(const[,op]of [...e.ops.entries()].sort((a,b)=>a[1].revision-b[1].revision)){if(op.pending||op.settledRevision>e.readVersion&&op.outcome==='confirmed')view=this.adapter.project(view,op.target as unknown as C);}return view;}
 get error(){return this.active?.error;}
 get loading(){return this.active?.loading??false;}
 get pending(){return !!this.active?.ops.pendingCount;}
 get sending(){return !!this.active?.ops.entries().some(([,c])=>c.pending&&c.phase==='sending');}
 get message(){return this.active?.ops.uncertainCount?'待确认，后台正在核验':this.pending?'正在确认':'';}
 get uncertain(){return !!this.active?.ops.uncertainCount;}
 get intents():C[]{return this.active?.ops.entries().filter(([,c])=>c.pending).map(([,c])=>c.target as unknown as C)??[];}
 bind(context:DeviceContext,scope:string){
  const id=JSON.stringify([scope,context.homeId,context.generation,context.did]);if(id===this.identity&&this.active)return;
  this.close();if(scope!==this.scope){for(const e of this.records.values())e.ops.reset();this.records.clear();}this.scope=scope;this.identity=id;
  let e=this.records.get(id);if(!e){
   const entry:Entry<R>={context:{...context},loading:false,alive:true,sequence:0,applied:0,readVersion:0,tail:Promise.resolve(),ops:undefined!};
   const notify=()=>{if(this.active===entry)this.changed();};
   entry.ops=new PropertyOperations((key,value)=>this.send(entry,key,value as unknown as C),(key,value)=>this.confirm(entry,key,value as unknown as C),notify);
   e=entry;this.records.set(id,e);
  }this.active=e;e.alive=true;e.ops.setActive(true);this.schedule(e);
 }
 close(){const e=this.active;if(e){e.alive=false;clearTimeout(e.timer);e.ops.setActive(false);}this.active=undefined;this.identity='';}
 reset(){this.close();for(const e of this.records.values())e.ops.reset();this.records.clear();}
 redraw(){this.changed();}
 adopt(){const e=this.active;if(!e)return;e.readVersion=Infinity;for(const[key,c]of e.ops.entries())if(c.pending&&c.phase==='uncertain')e.ops.adopt(key);e.readVersion=e.ops.version;this.changed();}
 private schedule(e:Entry<R>){clearTimeout(e.timer);if(this.active===e)e.timer=setTimeout(()=>void this.read(),this.adapter.interval??10000);}
 private apply(e:Entry<R>,r:R,version:number,sequence:number){this.adapter.validate(r,e.context);if(sequence>=e.applied){e.actual=structuredClone(r);e.readVersion=version;e.applied=sequence;e.error=undefined;if(this.active===e)this.adapter.accepted?.(e.context,r);}return e.actual!;}
 private async fetch(e:Entry<R>){const version=e.ops.version,sequence=++e.sequence,r=await this.adapter.read(e.context);return this.apply(e,r,version,sequence);}
 read():Promise<void>{const e=this.active;if(!e)return Promise.resolve();if(e.readTask)return e.readTask;e.loading=!e.actual;if(e.loading)this.changed();
  const task=(async()=>{try{await this.fetch(e);}catch(error){e.error=normalizeError(error);if(this.active===e)this.failed(e.error);}finally{e.loading=false;if(this.active===e){this.changed();this.schedule(e);}}})();e.readTask=task;void task.finally(()=>{if(e.readTask===task)e.readTask=undefined;});return task;
 }
 async change(change:C){const e=this.active;if(!e||!e.actual)return;if(this.adapter.allowed&&!this.adapter.allowed(e.actual,change))return;
  for(const key of this.adapter.supersedes?.(change)??[])e.ops.cancel(key,false);
  e.ops.write(this.adapter.key(change),change as unknown as Json,null);const task=e.tail;await task;await Promise.resolve();
 }
 private send(e:Entry<R>,key:string,change:C){
  const revision=e.ops.get(key)?.revision;
  const job=e.tail.then(async()=>{
   if(e.ops.get(key)?.revision!==revision)return {outcome:'pending' as const,message:'已由最新操作替代'};
   try{if(!e.alive)throw{kind:'staleContext',message:'设备已关闭，未发送排队操作。'};if(!e.actual)throw {kind:'unavailable',message:'设备状态尚未读取。'};if(this.adapter.allowed&&!this.adapter.allowed(e.actual,change))throw{kind:'unavailable',message:'当前设备任务不允许调整此设置。'};
    const version=e.ops.version,sequence=++e.sequence,result=await this.adapter.send(e.context,e.actual,change),actual=this.apply(e,result.report,version,sequence);
    return{outcome:this.adapter.matches(actual,change)?'confirmed' as const:'pending' as const,actual:this.adapter.matches(actual,change)?change as unknown as Json:undefined,message:result.confirmed?'已确认':'待确认'};
   }catch(error){if(this.active===e)this.failed(normalizeError(error));throw error;}
  });e.tail=job.then(()=>{},()=>{});return job;
 }
 private async confirm(e:Entry<R>,_key:string,change:C){const r=await this.fetch(e);return{outcome:this.adapter.matches(r,change)?'confirmed' as const:'pending' as const,actual:this.adapter.matches(r,change)?change as unknown as Json:undefined,message:'待确认'};}
}

/** Discard UI predictions before accepting a panel as a transport baseline. */
export function panelReadback(panel:DevicePanel,previous?:DevicePanel):DevicePanel{return {...panel,services:panel.services.map(s=>({...s,properties:s.properties.map(p=>p.pending?(previous?.services.flatMap(s=>s.properties).find(q=>q.siid===p.siid&&q.piid===p.piid)??{...p,value:undefined,code:undefined,pending:undefined}):p)}))};}
/** Overlay generic control intents only on the rendered private-page panel. */
export function panelDisplay(view:DevicePanel,incoming:DevicePanel):DevicePanel{return {...view,services:view.services.map(s=>({...s,properties:s.properties.map(p=>incoming.services.flatMap(s=>s.properties).find(q=>q.siid===p.siid&&q.piid===p.piid&&q.pending)??p)}))};}
