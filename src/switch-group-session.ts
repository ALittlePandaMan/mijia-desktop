import type {HomeCardEntry,SwitchGroupResult} from './types';
import {nextDisplayOrder,type DisplayIntent} from './local-display-intent';
/** Only active user intentions own timers. There is no per-card polling. */
export class SwitchGroupSession {
 private card?:HomeCardEntry;private revision=0;private observedRevision=-1;private running=false;private queued?:{on:boolean;revision:number;id:string};private disposed=false;
 private pending=new Map<string,{on:boolean;revision:number;order:number;at:number;timer:ReturnType<typeof setTimeout>}>();private own=new Set<string>();private sequence=0;
 get displayIntents():DisplayIntent[]{return [...this.pending].map(([fieldId,p])=>({fieldId,value:p.on,order:p.order}));}
 get version(){return this.revision;}
 unavailable(version=this.revision){for(const[id,p]of this.pending)if(p.revision<=version){clearTimeout(p.timer);this.pending.delete(id);}this.changed();}
 rejectReadback(fields:ReadonlySet<string>,startedAt:number){for(const[id,p]of this.pending)if(p.at<=startedAt&&fields.has(id)){clearTimeout(p.timer);this.pending.delete(id);}this.changed();}
 private memberSequences=new Map<string,number>();
 private deferred?:SwitchGroupResult;
 private verifyTimer?:ReturnType<typeof setTimeout>;private verifying=false;
 private active=true;private verifyAttempts=0;
 setActive(active:boolean){if(this.active===active)return;this.active=active;if(active)this.scheduleVerify();else clearTimeout(this.verifyTimer);}
 rejectNative(id:string,sequence:number){const p=this.pending.get(id);if(!p||this.running||(this.memberSequences.get(id)??this.sequence)!==sequence)return;clearTimeout(p.timer);this.pending.delete(id);this.changed();}
 constructor(private send:(groupId:string,on:boolean,requestId:string,confirmOnly?:boolean)=>Promise<SwitchGroupResult>,private changed:()=>void,private confirmed?:(card:HomeCardEntry)=>void){}
 accept(card:HomeCardEntry,observed=true){
  if(this.card?.group?.id===card.group?.id&&(card.group?.revision??0)<(this.card?.group?.revision??0))return;
  if(this.card?.group?.id!==card.group?.id){this.clear();this.observedRevision=-1;}const advanced=(card.group?.revision??0)>this.observedRevision;this.card=card;
  if(observed)this.observedRevision=Math.max(this.observedRevision,card.group?.revision??0);
  for(const[id,p]of this.pending){const member=card.group?.members.find(m=>m.id===id);if(!member||observed&&advanced&&(card.group?.readStartedAt??Infinity)>=p.at&&member.selected===p.on){clearTimeout(p.timer);this.pending.delete(id);}}
 }
 get display():HomeCardEntry|undefined{
  const card=this.card;if(!card?.group)return card;const members=card.group.members.map(m=>({...m,selected:this.pending.get(m.id)?.on??m.selected}));const on=members.every(m=>m.selected===true);
  return {...card,selected:on,highlight:on,group:{...card.group,members}};
 }
 write(on:boolean){if(this.disposed||!this.card?.enabled||!this.card.group)return;this.verifyAttempts=0;const revision=++this.revision,id=crypto.randomUUID();this.own.add(id);if(this.own.size>128)this.own.delete(this.own.values().next().value!);this.project(on,revision);this.queued={on,revision,id};this.changed();void this.pump();}
 reflect(id:string,on:boolean,sequence:number){if(this.running||sequence<=(this.memberSequences.get(id)??-1)||!this.card?.group?.members.some(m=>m.id===id))return;this.memberSequences.set(id,sequence);clearTimeout(this.pending.get(id)?.timer);const revision=++this.revision;this.pending.set(id,{on,revision,order:nextDisplayOrder(),at:Date.now(),timer:setTimeout(()=>{if(this.pending.get(id)?.revision===revision){this.pending.delete(id);this.changed();}},30000)});this.changed();}
 receive(result:SwitchGroupResult){if(this.disposed||this.card?.group?.id!==result.card.group?.id)return;if(result.readback){this.accept(result.card);this.rejectReadback(new Set(result.failed),result.card.group?.readStartedAt??0);return;}if(result.sequence<=this.sequence)return;if(this.own.has(result.requestId)){this.sequence=result.sequence;return;}if(this.running){if(!this.deferred||result.sequence>this.deferred.sequence)this.deferred=result;return;}this.sequence=result.sequence;this.accept(result.card,false);const revision=++this.revision;this.project(result.target,revision);this.rollback(result.failed,revision);this.changed();}
 private project(on:boolean,revision:number){for(const m of this.card?.group?.members??[]){clearTimeout(this.pending.get(m.id)?.timer);this.pending.set(m.id,{on,revision,order:nextDisplayOrder(),at:Date.now(),timer:setTimeout(()=>{if(this.pending.get(m.id)?.revision===revision){this.pending.delete(m.id);this.changed();}},30000)});}}
 private rollback(ids:string[],revision:number){for(const id of ids)if(this.pending.get(id)?.revision===revision){clearTimeout(this.pending.get(id)?.timer);this.pending.delete(id);}}
 private async pump(){if(this.running||this.disposed)return;this.running=true;try{while(this.queued&&!this.disposed){const job=this.queued;this.queued=undefined;const groupId=this.card?.group?.id;if(!groupId)break;try{const result=await this.send(groupId,job.on,job.id);if(this.disposed||this.card?.group?.id!==groupId)return;this.sequence=Math.max(this.sequence,result.sequence);this.accept(result.card,false);this.rollback(result.failed,job.revision);}catch{this.rollback([...this.pending.keys()],job.revision);}this.changed();}}finally{this.running=false;const deferred=this.deferred;this.deferred=undefined;if(deferred)this.receive(deferred);this.scheduleVerify();}}
 private scheduleVerify(){clearTimeout(this.verifyTimer);if(this.disposed||!this.active||!this.pending.size||this.verifying||this.verifyAttempts>=3)return;this.verifyTimer=setTimeout(()=>{this.verifyAttempts++;void this.verify();},[1000,2500,5000][this.verifyAttempts]);}
 private async verify(){const group=this.card?.group;if(!group||this.disposed||!this.pending.size)return;const version=this.revision,snapshot=new Map([...this.pending].map(([id,p])=>[id,p.revision]));this.verifying=true;try{const result=await this.send(group.id,this.display?.selected===true,crypto.randomUUID(),true);if(this.disposed||version!==this.revision)return;this.confirmed?.(result.card);this.accept(result.card);for(const id of result.failed)if(this.pending.get(id)?.revision===snapshot.get(id)){clearTimeout(this.pending.get(id)?.timer);this.pending.delete(id);}}catch{for(const[id,revision]of snapshot)if(this.pending.get(id)?.revision===revision){clearTimeout(this.pending.get(id)?.timer);this.pending.delete(id);}}finally{this.verifying=false;this.changed();this.scheduleVerify();}}
 private clear(){clearTimeout(this.verifyTimer);for(const p of this.pending.values())clearTimeout(p.timer);this.pending.clear();this.queued=undefined;this.deferred=undefined;}
 dispose(){this.disposed=true;this.clear();this.card=undefined;}
}
