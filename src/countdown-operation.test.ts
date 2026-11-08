import {describe,it,expect} from 'vitest';
import {CountdownOperation} from './countdown-operation';
import type {CountdownChange,CountdownChangeResult,TimerReport} from './types';

const report=(active=false,dueAt:number|null=null,key:string|null=null):TimerReport=>({did:'fixture-only',model:'cuco.plug.v3',fetchedAt:1000,entries:[],warnings:[],writeReason:null,unsupportedCount:0,countdowns:[{on:false,active,dueAt,key,hours:0,minutes:5,writeReason:null,durationSource:'default'}]});
const set:CountdownChange={operation:'set',on:false,key:null,hours:0,minutes:5};
const accepted=(data:TimerReport|null,verified=true):CountdownChangeResult=>({sceneVerified:verified,preferencesVerified:null,report:data,message:'fixture'});
const immediate=async()=>{};
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};};

describe('countdown target display and independent scene confirmation',()=>{
  it('displays the target synchronously while preserving confirmed records before a reply',async()=>{
    const send=deferred<CountdownChangeResult>();let calls=0,changes=0,reads=0;
    const original=report(),op=new CountdownOperation(set,original,()=>{calls++;return send.promise;},async()=>{reads++;return report(true,1300,'created');},()=>changes++,immediate,()=>1000);
    const run=op.start();void op.start();
    expect(op.intent).toMatchObject({active:true,phase:'sending',minutes:5});expect(op.report).toBe(original);expect(original.countdowns[0].active).toBe(false);expect(changes).toBe(1);expect(calls).toBe(1);
    await op.refresh();expect(reads).toBe(0);
    send.resolve(accepted(report(true,1300,'created')));await run;expect(op.phase).toBe('confirmed');expect(op.intent).toBeUndefined();
  });
  it('reconciles a lost submission response by reading without repeating the mutation',async()=>{
    let writes=0,reads=0;
    const op=new CountdownOperation(set,report(),async()=>{writes++;throw {kind:'network'};},async()=>{reads++;return report(true,1300,'created');},()=>{},immediate,()=>1000);
    await op.start();expect(op.phase).toBe('confirmed');expect(writes).toBe(1);expect(reads).toBe(1);
  });
  it('does not trust an acceptance flag or a mismatched duration as execution proof',async()=>{
    const op=new CountdownOperation(set,report(),async()=>accepted(report(true,1900,'wrong-duration')),async()=>report(true,1900,'wrong-duration'),()=>{},immediate,()=>1000);
    await op.start();expect(op.phase).toBe('rejected');expect(op.report.countdowns[0].dueAt).toBe(1900);
  });
  it('rolls back after three consistent fresh observations disagree with the target',async()=>{
    let reads=0;
    const op=new CountdownOperation(set,report(),async()=>accepted(null,false),async()=>{reads++;return report();},()=>{},immediate,()=>1000);
    await op.start();expect(op.phase).toBe('rejected');expect(op.error?.kind).toBe('timerNotApplied');expect(reads).toBe(3);expect(op.report.countdowns[0].active).toBe(false);
  });
  it('keeps timeouts uncertain, accepts a later read, and coalesces simultaneous reads',async()=>{
    let writes=0,reads=0;const final=deferred<TimerReport>();let recover=false;
    const op=new CountdownOperation(set,report(),async()=>{writes++;return accepted(null,false);},()=>{reads++;if(recover)return final.promise;throw {kind:'network'};},()=>{},immediate,()=>1000);
    await op.start();expect(op.intent?.phase).toBe('uncertain');expect(op.pending).toBe(true);expect(reads).toBe(4);
    recover=true;const a=op.refresh(),b=op.refresh();await Promise.resolve();expect(reads).toBe(5);final.resolve(report(true,1300,'created'));await Promise.all([a,b]);expect(op.phase).toBe('confirmed');expect(writes).toBe(1);
  });
  it('rejects explicit permission failure and retains the last confirmed value',async()=>{
    let reads=0;const op=new CountdownOperation(set,report(),async()=>{throw {kind:'permissionDenied',message:'fixture denial',retryable:false};},async()=>{reads++;return report();},()=>{},immediate,()=>1000);
    await op.start();expect(op.phase).toBe('rejected');expect(op.error?.kind).toBe('permissionDenied');expect(reads).toBe(0);expect(op.report.countdowns[0].active).toBe(false);
  });
  it('ignores observations belonging to another device or model',async()=>{
    let reads=0;const op=new CountdownOperation(set,report(),async()=>accepted({...report(true,1300,'wrong'),did:'other'}),async()=>({...report(true,1300,'wrong'),model:reads++%2?'other':'cuco.plug.v3',did:'other'}),()=>{},immediate,()=>1000);
    await op.start();expect(op.phase).toBe('uncertain');expect(op.report.did).toBe('fixture-only');expect(op.report.countdowns[0].active).toBe(false);
  });
  it('requires the existing scene key for edits, and cancels only after an inactive read',async()=>{
    const edit=new CountdownOperation({...set,key:'original'},report(true,1400,'original'),async()=>accepted(report(true,1300,'other')),async()=>report(true,1300,'other'),()=>{},immediate,()=>1000);
    await edit.start();expect(edit.phase).toBe('rejected');
    const cancel=new CountdownOperation({operation:'cancel',on:false,key:'original'},report(true,1400,'original'),async()=>accepted(null,false),async()=>report(),()=>{},immediate,()=>1000);
    expect(cancel.intent?.active).toBe(false);await cancel.start();expect(cancel.phase).toBe('confirmed');
  });
  it('disposes late responses on page or household changes without starting more reads',async()=>{
    const send=deferred<CountdownChangeResult>();let callbacks=0,reads=0;
    const op=new CountdownOperation(set,report(),()=>send.promise,async()=>{reads++;return report(true,1300,'created');},()=>callbacks++,immediate,()=>1000);
    const run=op.start();op.cancel();send.resolve(accepted(report(true,1300,'created')));await run;expect(callbacks).toBe(1);expect(reads).toBe(0);expect(op.report.countdowns[0].active).toBe(false);
  });
});
