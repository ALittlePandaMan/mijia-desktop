import type {CardControlChange,CardControlResult,HomeCardPresentation,Json} from './types';
import {PropertyOperations,type PropertyReply} from './property-operations';
import {nextDisplayOrder,type DisplayIntent} from './local-display-intent';

/** One queue per rendered device, with one cell per bound control. No polling
 * is installed per card; only existing pending-operation readback is reused. */
export class CardControlSession {
 private current?:HomeCardPresentation;private active=true;
 private requests=new Map<string,{id:string}>();
 private serial=0;private readonly origin=crypto.randomUUID();
 private operations:PropertyOperations;
 private actionKeys=new Map<string,string>();private actionTail:Promise<unknown>=Promise.resolve();
 private failure?:string;
 private external:readonly DisplayIntent[]=[];
 setExternalIntents(intents:readonly DisplayIntent[]){this.external=intents;}
 private foreign=new Map<string,{value:Json;sequence:number;order:number;at:number;dependencies:{id:string;sequence:number}[];timer:ReturnType<typeof setTimeout>}>();private sequences=new Map<string,number>();
 constructor(private transport:(change:CardControlChange)=>Promise<CardControlResult>,private changed:()=>void){
  this.operations=new PropertyOperations((id,value)=>this.request(id,value,false),(id,value)=>this.request(id,value,true),changed);
 }
 get pendingCount(){return this.operations.pendingCount;}
 get version(){return this.operations.version;}
 private removeForeign(id:string,sequence:number){const p=this.foreign.get(id);if(!p||p.sequence!==sequence)return;clearTimeout(p.timer);this.foreign.delete(id);for(const[key,d]of this.foreign)if(d.dependencies.some(p=>p.id===id&&p.sequence===sequence))this.removeForeign(key,d.sequence);}
 rejectNative(fieldId:string,sequence:number){for(const c of this.current?.controls??[]){if(c.fieldId!==fieldId||this.sequences.get(c.id)!==sequence)continue;this.removeForeign(c.id,sequence);for(const[key,op]of this.operations.entries())if((this.actionKeys.get(key)??key)===c.id&&op.pending&&op.phase==='uncertain')this.operations.reject(key,op.revision);}this.changed();}
 get displayIntents():DisplayIntent[]{
  const p=this.current;if(!p)return [];const intents:DisplayIntent[]=[];
  const append=(id:string,value:Json,order:number)=>{const control=p.controls.find(c=>c.id===id),projection=p.projections?.find(e=>e.controlId===id&&JSON.stringify(e.value)===JSON.stringify(value));if(projection?.effects?.length){for(const effect of projection.effects)intents.push({fieldId:effect.fieldId,value:effect.value,order,effect:control?.kind==='action'});}else if(control?.fieldId&&control.kind!=='action')intents.push({fieldId:control.fieldId,value,order});};
  for(const[id,item]of this.foreign)append(id,item.value,item.order);
  for(const[key,op]of this.operations.entries())if(op.pending)append(this.actionKeys.get(key)??key,op.target,op.displayOrder??0);
  return intents;
 }
 rejectReadback(fields:ReadonlySet<string>,startedAt:number){const p=this.current;if(!p)return;const idFor=(key:string)=>p.controls.find(c=>c.id===(this.actionKeys.get(key)??key))?.fieldId??'';this.operations.rejectReadback(fields,startedAt,idFor);for(const[id,item]of this.foreign){const c=p.controls.find(c=>c.id===id);if(item.at<=startedAt&&c?.fieldId&&fields.has(c.fieldId))this.removeForeign(id,item.sequence);}this.changed();}
 reflect(controlIds:string[],value:Json,sequence:number){for(const id of controlIds){const c=this.current?.controls.find(c=>c.id===id);if(!c)continue;this.receive({homeId:'',did:this.current!.did,controlId:id,requestId:`native:${sequence}:${id}`,sequence,submitted:true,target:c.kind==='toggle'?value===true||value===1:value,verified:false,actual:null,message:'',presentation:null,card:null,status:null});}}
 receive(result:CardControlResult):void{
  if(!result.submitted||result.target==null||!this.current?.controls.some(c=>c.id===result.controlId))return;
  const sequence=result.sequence??0;if(sequence<=(this.sequences.get(result.controlId)??-1))return;this.sequences.set(result.controlId,sequence);
  if([...this.requests.values()].some(r=>r.id===result.requestId))return;
  const previous=this.foreign.get(result.controlId);clearTimeout(previous?.timer);
  const dependencies=[...this.foreign].filter(([id,item])=>this.current?.projections?.some(p=>p.controlId===id&&JSON.stringify(p.value)===JSON.stringify(item.value)&&p.controls.some(c=>c.id===result.controlId&&c.enabled))).map(([id,item])=>({id,sequence:item.sequence}));
  this.foreign.set(result.controlId,{value:result.target,sequence,order:nextDisplayOrder(),at:Date.now(),dependencies,timer:setTimeout(()=>{this.removeForeign(result.controlId,sequence);this.changed();},30000)});for(const[key,op]of this.operations.entries())if((this.actionKeys.get(key)??key)===result.controlId&&op.pending&&op.phase==='uncertain')this.operations.cancel(key,false);this.changed();
 }
 private clearForeign(){for(const item of this.foreign.values())clearTimeout(item.timer);this.foreign.clear();this.sequences.clear();}
 accept(value:HomeCardPresentation|undefined):boolean{
  if(!value){if(!this.current)return false;this.current=undefined;this.operations.reset();this.requests.clear();this.actionKeys.clear();this.actionTail=Promise.resolve();this.clearForeign();return true;}
  if(this.current&&value.revision<this.current.revision)return false;
  const fresh=!this.current||value.revision>this.current.revision||this.current.templateId!==value.templateId;
  if(this.current?.templateId!==value.templateId){this.operations.reset();this.requests.clear();this.actionKeys.clear();this.actionTail=Promise.resolve();this.clearForeign();}
  this.current=value;this.failure=undefined;
  if(fresh){for(const c of value.controls){const foreign=this.foreign.get(c.id);if(foreign&&JSON.stringify(c.value)===JSON.stringify(foreign.value)){clearTimeout(foreign.timer);this.foreign.delete(c.id);}}
  for(const control of value.controls)if(control.kind!=='action'&&control.value!==null)this.operations.observe(control.id,control.value);}
  return true;
 }
 get presentation():HomeCardPresentation|undefined {
  if(!this.current)return;
  const controls=this.current.controls.map(c=>{
   const op=c.kind==='action'?[...this.operations.entries()].filter(([key])=>this.actionKeys.get(key)===c.id).at(-1)?.[1]:this.operations.get(c.id),shown=c.kind==='action'?undefined:this.operations.display(c.id,c.value);
   return {...c,value:op?.pending?shown?.value??c.value:this.foreign.get(c.id)?.value??shown?.value??c.value,pending:op?.pending?op.phase:undefined,message:undefined,error:undefined};
  });
  const project=(id:string,target:Json)=>{const projection=this.current!.projections?.find(p=>p.controlId===id&&JSON.stringify(p.value)===JSON.stringify(target));for(const patch of projection?.controls??[]){const c=controls.find(c=>c.id===patch.id);if(c){c.enabled=patch.enabled;if(c.kind==='action'){c.value=patch.value;c.label=patch.label;}}}};
  for(const[id,item]of this.foreign)project(id,item.value);
  for(const [id,op]of [...this.operations.entries()].sort((a,b)=>a[1].revision-b[1].revision))if(op.pending)project(this.actionKeys.get(id)??id,op.target);
  for(const intent of [...this.displayIntents,...this.external].sort((a,b)=>a.order-b.order)){for(const c of controls){if(c.fieldId!==intent.fieldId||c.kind==='action')continue;c.value=c.kind==='toggle'?intent.value===true||intent.value===1:intent.value;project(c.id,c.value);}}
  return {...this.current,controls:controls.map(c=>({...c,enabled:c.enabled&&this.active&&!this.failure,reason:this.failure??c.reason}))};
 }
 write(id:string,value:Json):void{
  const control=this.presentation?.controls.find(c=>c.id===id);
  if(!this.active||this.failure||!control?.enabled)return;
  if(control.kind==='action'){
   const latest=[...this.operations.entries()].filter(([key])=>this.actionKeys.get(key)===id).at(-1)?.[1];if(latest?.pending&&JSON.stringify(latest.target)===JSON.stringify(value))return;
   for(const key of this.actionKeys.keys())if(!this.operations.get(key)?.pending){this.actionKeys.delete(key);this.requests.delete(key);this.operations.cancel(key,false);}
   const key=`action:${++this.serial}:${id}`;this.actionKeys.set(key,id);this.operations.write(key,value,null);return;
  }
  const dependencies=this.operations.entries().filter(([key,op])=>op.pending&&this.current?.controls.find(c=>c.id===key)?.kind==='toggle'&&control.kind!=='toggle').map(([key,op])=>({key,revision:op.revision}));this.operations.write(id,value,control.value,dependencies);
 }
 setActive(active:boolean){if(this.active===active)return;this.active=active;this.operations.setActive(active);}
 unavailable(message:string,version=this.operations.version,startedAt=Date.now()){for(const[key,op]of this.operations.entries())if(op.pending&&op.revision<=version)this.operations.reject(key,op.revision);for(const[id,p]of this.foreign)if(p.at<=startedAt){clearTimeout(p.timer);this.foreign.delete(id);}if(!this.current)this.failure=message;}
 dispose(){this.active=false;this.operations.reset();this.requests.clear();this.actionKeys.clear();this.clearForeign();this.current=undefined;this.external=[];}
 private async request(key:string,value:Json,confirmOnly:boolean):Promise<PropertyReply>{
  const id=this.actionKeys.get(key)??key;
  const current=this.current;if(!current)throw {kind:'staleContext',message:'卡片已经变化。'};
  const revision=this.operations.get(key)?.revision;
  let request=this.requests.get(key);
  if(!confirmOnly||!request){request={id:`${this.origin}:${++this.serial}`};this.requests.set(key,request);}
  const change={templateId:current.templateId,controlId:id,value,requestId:request.id,confirmOnly};
  const send=()=>{if(this.current?.templateId!==current.templateId||!this.operations.get(key)?.pending)throw{kind:'staleContext',message:''};return this.transport(change);};
  let result:CardControlResult;
  if(this.actionKeys.has(key)&&!confirmOnly){const task=this.actionTail.then(send);this.actionTail=task.then(()=>{},()=>{});result=await task;}else result=await send();
  if(result.submitted){const foreign=this.foreign.get(id);if(foreign&&foreign.sequence<=(result.sequence??0)){clearTimeout(foreign.timer);this.foreign.delete(id);}else if(foreign&&this.operations.get(key)?.revision===revision)this.operations.cancel(key,false);}
  this.receive(result);
  if(this.current?.templateId!==current.templateId)throw {kind:'staleContext',message:'卡片已经变化。'};
  if(!result.submitted)this.accept(result.presentation??undefined);
  this.changed();
  return {outcome:result.verified?'confirmed':'pending',actual:result.actual??undefined,message:result.message};
 }
}
