import {describe,it,expect} from 'vitest';
import {DoorbellState,filteredDoorbellEvents,type DoorbellCloudReport} from './doorbell';
const context={homeId:'home',did:'doorbell',generation:1};
const report=(date:string):DoorbellCloudReport=>({date,complete:true,retentionDays:3,availableFrom:null,playbackAvailable:false,reason:'',events:[{id:'a',time:1,kind:'逗留',type:'Pass:Stay',duration:null},{id:'b',time:2,kind:'按门铃',type:'Bell',duration:null}]});
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
describe('doorbell cloud state',()=>{
 it('retains the storage boundary during date requests and resets it between households',async()=>{
  const pending=deferred<DoorbellCloudReport>();let calls=0;const state=new DoorbellState(async()=>++calls===1?{...report('2026-01-03'),availableFrom:new Date('2026-01-03T00:00:00+08:00').getTime()/1000}:pending.promise,()=>{},()=>{});
  state.bind(context,'a');await state.read('2026-01-03');expect(state.oldestDate).toBe('2026-01-03');const read=state.read('2026-01-04');expect(state.report).toBeUndefined();expect(state.oldestDate).toBe('2026-01-03');pending.resolve({...report('2026-01-04'),availableFrom:null});await read;expect(state.oldestDate).toBe('2026-01-03');state.bind({...context,homeId:'other'},'a');expect(state.oldestDate).not.toBe('2026-01-03');
 });
 it('opens only an event that belongs to the current readable report',async()=>{
  const r=report('2026-01-01');r.playbackAvailable=true;const state=new DoorbellState(async()=>r,()=>{},()=>{});state.bind(context,'a');await state.read(r.date);state.play('foreign');expect(state.view).toBe('events');state.play('a');expect(state.view).toBe('cloud');expect(state.selectedEvent?.id).toBe('a');await state.read('2026-01-02');expect(state.view).toBe('events');expect(state.selectedEvent).toBeUndefined();
 });
 it('does not open a cloud event whose server metadata disables playback',async()=>{
  const r=report('2026-01-01');r.playbackAvailable=true;r.events[0].playbackAvailable=false;const state=new DoorbellState(async()=>r,()=>{},()=>{});state.bind(context,'a');await state.read(r.date);state.play('a');expect(state.view).toBe('events');state.play('b');expect(state.view).toBe('cloud');
 });
 it('deduplicates thumbnail reads and suppresses late images after account changes',async()=>{
  const pending=deferred<string>(),r=report('2026-01-01');r.events[0].thumbnailAvailable=true;let calls=0;const state=new DoorbellState(async()=>r,()=>{},()=>{},()=>{calls++;return pending.promise;});state.bind(context,'a');await state.read(r.date);const first=state.thumbnail('a'),second=state.thumbnail('a');expect(first).toBe(second);expect(calls).toBe(1);expect(await state.thumbnail('foreign')).toBeUndefined();state.bind({...context,generation:2},'b');pending.resolve('data:image/jpeg;base64,fixture');expect(await first).toBeUndefined();
 });
 it('bounds concurrent image reads and cancels queued reads on close',async()=>{
  const r=report('2026-01-01');r.events=Array.from({length:7},(_,i)=>({id:String(i),time:i,kind:'事件',type:'Pass',duration:null,thumbnailAvailable:true}));const pending=Array.from({length:7},()=>deferred<string>());let calls=0;const state=new DoorbellState(async()=>r,()=>{},()=>{},()=>pending[calls++].promise);state.bind(context,'a');await state.read(r.date);const reads=r.events.map(e=>state.thumbnail(e.id));expect(calls).toBe(3);state.close();for(const p of pending)p.resolve('data:image/jpeg;base64,fixture');expect(await Promise.all(reads)).toEqual(Array(7).fill(undefined));expect(calls).toBe(3);
 });
 it('isolates late replies after switching account generation',async()=>{
  const pending=deferred<DoorbellCloudReport>(),state=new DoorbellState(()=>pending.promise,()=>{},()=>{});state.bind(context,'account-a');const read=state.read('2026-01-01');state.bind({...context,generation:2},'account-b');pending.resolve(report('2026-01-01'));await read;expect(state.report).toBeUndefined();expect(state.loading).toBe(false);
 });
 it('keeps the latest selected date when replies finish out of order',async()=>{
  const first=deferred<DoorbellCloudReport>(),second=deferred<DoorbellCloudReport>(),state=new DoorbellState((_c,d)=>d==='2026-01-01'?first.promise:second.promise,()=>{},()=>{});state.bind(context,'a');const a=state.read('2026-01-01'),b=state.read('2026-01-02');second.resolve(report('2026-01-02'));await b;first.resolve(report('2026-01-01'));await a;expect(state.report?.date).toBe('2026-01-02');expect(state.date).toBe('2026-01-02');
 });
 it('rejects a response for another date and distinguishes failure from an empty day',async()=>{
  const failed:string[]=[],state=new DoorbellState(async()=>report('2026-01-02'),()=>{},e=>failed.push(e.message));state.bind(context,'a');await state.read('2026-01-01');expect(state.report).toBeUndefined();expect(state.error).toBeDefined();expect(failed).toHaveLength(1);expect(state.loading).toBe(false);
 });
 it('supports combined pass/stay event types without losing either filter',()=>{
  const r=report('2026-01-01');expect(filteredDoorbellEvents(r,'Stay').map(e=>e.id)).toEqual(['a']);expect(filteredDoorbellEvents(r,'Pass').map(e=>e.id)).toEqual(['a']);expect(filteredDoorbellEvents(r,'Bell').map(e=>e.id)).toEqual(['b']);expect(filteredDoorbellEvents(r,'Default')).toHaveLength(2);
 });
});
