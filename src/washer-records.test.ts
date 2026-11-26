import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {DeviceContext,EnergySelection} from './types';
import {WasherRecords,washerLogRange,washerLogSlots,washerRecordTime,type WasherLogRange,type WasherRecordDetail,type WasherRecordReport} from './washer-records';
const ctx:DeviceContext={homeId:'record-fixture-home',generation:3,did:'record-fixture-washer'};
const selection:EnergySelection={period:'week',date:'2026-10-29'};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function harness(){
 const pages:{context:DeviceContext;range:WasherLogRange;cursor:string|null;reply:ReturnType<typeof deferred<WasherRecordReport>>}[]=[],details:{id:string;cursor:string|null;reply:ReturnType<typeof deferred<WasherRecordDetail>>}[]=[];
 const changed=vi.fn(),failure=vi.fn(),state=new WasherRecords({records:(context,range,cursor)=>{const reply=deferred<WasherRecordReport>();pages.push({context,range,cursor,reply});return reply.promise;},detail:(_ctx,_range,cursor,id)=>{const reply=deferred<WasherRecordDetail>();details.push({id,cursor,reply});return reply.promise;}},changed,failure);
 const response=(index:number,ids=['record-1'],nextId:string|null=null):WasherRecordReport=>({did:pages[index].context.did,range:pages[index].range,fetchedAt:1,buckets:[{startTime:pages[index].range.startTime,endTime:pages[index].range.startTime+86399000,value:2}],frequentModes:[24],logs:ids.map(id=>({id,mode:24,startTime:pages[index].range.startTime,endTime:pages[index].range.startTime+3600000})),nextId});
 return{state,pages,details,changed,failure,response};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(2026,9,29,13));});afterEach(()=>vi.useRealTimers());
describe('washer record calendars and response ownership',()=>{
 it('formats actual record timestamps using the standard plugin date and minute labels',()=>{
  expect(washerRecordTime({id:'fixture',mode:24,startTime:new Date(2026,9,28,9,3).getTime(),endTime:new Date(2026,9,28,9,45).getTime()})).toBe('2026.10.28 9:03-9:45');
 });
 it('uses seven local days and handles month, leap year and year boundaries',()=>{
  const week=washerLogRange({period:'week',date:'2026-10-03'});expect(new Date(week.startTime)).toEqual(new Date(2026,8,27));expect(new Date(week.endTime)).toEqual(new Date(2026,9,3,23,59,59));
  const current=washerLogRange({period:'month',date:'2026-10-01'});expect(new Date(current.startTime)).toEqual(new Date(2026,8,30));
  const leap=washerLogRange({period:'month',date:'2024-02-01'},new Date(2024,2,15));expect(new Date(leap.endTime)).toEqual(new Date(2024,1,29,23,59,59));
  const year=washerLogRange({period:'year',date:'2026-10-29'});expect(new Date(year.startTime)).toEqual(new Date(2025,10,1));expect(year.aggregation).toBe('month');
  for(const date of ['2026-02-30','2027-01-01','2024-01-01'])expect(()=>washerLogRange({period:'week',date})).toThrow();
 });
 it('preserves missing bucket slots and a true measured zero',()=>{
  const h=harness();void h.state.load(ctx,selection);const report=h.response(0);report.buckets=[{startTime:report.range.startTime,endTime:report.range.startTime+86399000,value:0},{startTime:report.range.startTime+2*86400000,endTime:report.range.startTime+3*86400000-1000,value:2}];
  expect(washerLogSlots(report)).toHaveLength(7);expect(washerLogSlots(report).slice(0,3).map(s=>s.value)).toEqual([0,null,2]);
 });
 it('shows loading immediately and ignores old household/date responses',async()=>{
  const h=harness(),old=h.state.load(ctx,selection);expect(h.state.loading).toBe(true);
  const fresh=h.state.load({...ctx,homeId:'other-home',generation:4,did:'other-device'},{period:'month',date:'2026-09-01'});h.pages[1].reply.resolve(h.response(1,['new']));await fresh;
  h.pages[0].reply.resolve(h.response(0,['old']));await old;expect(h.state.rows.map(r=>r.entry.id)).toEqual(['new']);expect(h.state.selection.date).toBe('2026-09-01');expect(h.state.loading).toBe(false);
 });
 it('paginates with the actual cursor, deduplicates rows and keeps source-page membership for detail',async()=>{
  const h=harness(),first=h.state.load(ctx,selection);h.pages[0].reply.resolve(h.response(0,['a','b'],'next'));await first;
  const more=h.state.load(ctx,selection,true);expect(h.pages[1].cursor).toBe('next');h.pages[1].reply.resolve(h.response(1,['b','c']));await more;
  expect(h.state.rows.map(r=>r.entry.id)).toEqual(['a','b','c']);const detail=h.state.openDetail(ctx,h.state.rows[2]);expect(h.details[0]).toMatchObject({id:'c',cursor:'next'});
  h.details[0].reply.resolve({did:ctx.did,entry:h.state.rows[2].entry,parameters:{waterTemperature:40}});await detail;expect(h.state.detail?.parameters.waterTemperature).toBe(40);
 });
 it('keeps the period chart while a selected bar requests only that day and toggles back',async()=>{
  const h=harness(),first=h.state.load(ctx,selection);h.pages[0].reply.resolve(h.response(0));await first;const chart=h.state.chartReport;
  const focus=h.state.selectBucket(ctx,2);expect(h.state.selectedBucket).toBe(2);expect(h.state.chartReport).toBe(chart);expect(h.pages[1].range.endTime-h.pages[1].range.startTime).toBe(86399000);h.pages[1].reply.resolve(h.response(1,[]));await focus;
  expect(h.state.rows).toHaveLength(0);expect(h.state.chartReport).toBe(chart);
  const reset=h.state.selectBucket(ctx,2);expect(h.state.selectedBucket).toBeUndefined();expect(h.pages[2].range).toEqual(h.pages[0].range);h.pages[2].reply.resolve(h.response(2));await reset;
 });
 it('keeps existing pages on a network error and rejects repeated cursors and wrong-device results',async()=>{
  const h=harness(),first=h.state.load(ctx,selection);h.pages[0].reply.resolve(h.response(0,['a'],'next'));await first;
  const more=h.state.load(ctx,selection,true);h.pages[1].reply.reject({kind:'network',message:'fixture offline',retryable:true});await more;expect(h.state.rows).toHaveLength(1);expect(h.state.error?.kind).toBe('network');
  const retry=h.state.load(ctx,selection,true);h.pages[2].reply.resolve(h.response(2,['b'],'next'));await retry;expect(h.state.rows.map(r=>r.entry.id)).toEqual(['a']);expect(h.state.error).toBeDefined();
  const wrong=h.state.load(ctx,selection);h.pages[3].reply.resolve({...h.response(3),did:'wrong-device'});await wrong;expect(h.state.rows).toEqual([]);expect(h.state.report).toBeUndefined();
 });
 it('ignores a detail response after back/reset and refuses a foreign row object',async()=>{
  const h=harness(),first=h.state.load(ctx,selection);h.pages[0].reply.resolve(h.response(0));await first;
  await h.state.openDetail(ctx,{...h.state.rows[0]});expect(h.details).toHaveLength(0);
  const entry=h.state.rows[0].entry,reading=h.state.openDetail(ctx,h.state.rows[0]);h.state.reset();h.details[0].reply.resolve({did:ctx.did,entry,parameters:{waterTemperature:60}});await reading;
  expect(h.state.detail).toBeUndefined();expect(h.state.selected).toBeUndefined();expect(h.state.rows).toEqual([]);
 });
 it('turns invalid UI dates into a visible error without issuing a cloud request',async()=>{
  const h=harness();await h.state.load(ctx,{period:'week',date:'2026-02-30'});expect(h.pages).toHaveLength(0);expect(h.state.error).toBeDefined();expect(h.state.loading).toBe(false);
 });
});
