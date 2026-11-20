import {afterEach,describe,expect,it,vi} from 'vitest';
import {MonitorConnection,monitorEligible,monitorRetryDelay,type MonitorRow,type MonitorTransport} from './monitor';
import {monitorPresetGrid,monitorPresetKey,monitorPresetLimit,readMonitorPreset,writeMonitorPreset} from './monitor-layout';
import {projectPreferences,type LocalPreferences} from './local-preferences';
import type {Device} from './types';
const device=(model:string,category='camera'):Device=>({did:model,model,name:model,online:true,roomId:'r',roomName:'r',specType:`urn:miot-spec-v2:device:${category}:0000:fixture:1`});
const tick=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const deferred=<T>()=>{let resolve!:(v:T)=>void;return{promise:new Promise<T>(r=>resolve=r),resolve};};
const context={homeId:'h',generation:1};
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('monitor layout and selection',()=>{
 it('offers the first capacity that covers each roster, capped at 16',()=>{
  expect(Array.from({length:18},(_,n)=>monitorPresetLimit(n))).toEqual([1,1,4,4,4,6,6,8,8,9,13,13,13,13,16,16,16,16]);
  expect(monitorPresetLimit(200)).toBe(16);
 });
 it.each([[1,1],[4,2],[6,3],[8,3],[9,3],[13,4],[16,4]] as const)('gives %i routes an equal %i-by-%i square grid',(preset,side)=>expect(monitorPresetGrid(preset)).toEqual({rows:side,columns:side}));
 it('remembers a preset independently for each account, home and aggregate view',()=>{
  const saved=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>saved.get(key),setItem:(key:string,value:string)=>saved.set(key,value)});
  const home=monitorPresetKey('a','home'),all=monitorPresetKey('a',null);
  writeMonitorPreset(home,4);writeMonitorPreset(all,6);writeMonitorPreset(undefined,1);
  expect([readMonitorPreset(home),readMonitorPreset(all),readMonitorPreset(monitorPresetKey('b','home')),readMonitorPreset(monitorPresetKey('a','other'))]).toEqual([4,6,undefined,undefined]);
  saved.set(home!,'3');expect(readMonitorPreset(home)).toBeUndefined();
  vi.stubGlobal('localStorage',{getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}});
  expect(readMonitorPreset(home)).toBeUndefined();expect(()=>writeMonitorPreset(home,6)).not.toThrow();
 });
 it('includes ordinary offline cameras while excluding doorbells, peepholes and other devices',()=>{expect(monitorEligible({...device('xiaomi.camera.c302'),online:false})).toBe(true);for(const d of [device('madv.cateye.mi3iot'),device('fixture.camera.doorbell','video-doorbell'),device('fixture','doorbell'),device('cuco.plug.v3','outlet')])expect(monitorEligible(d)).toBe(false);});
 it('projects monitor defaults and exclusions independently of other home preferences',()=>{const base:LocalPreferences={hideOffline:true,dragLocked:false,splitSwitches:false,hiddenDeviceIds:[],homeHiddenDeviceIds:[],roomOrders:{}};let p=projectPreferences(base,{operation:'setMonitorExcluded',did:'a',excluded:true});p=projectPreferences(p,{operation:'setMonitorEnabled',value:true});expect(p.monitor).toEqual({enabled:true,excludedDeviceIds:['a']});expect(base.monitor).toBeUndefined();expect(p.hideOffline).toBe(true);p=projectPreferences(p,{operation:'setMonitorExcluded',did:'a',excluded:false});expect(p.monitor?.excludedDeviceIds).toEqual([]);});
 it('retries transient failure with bounded backoff, polls closed power without switching it and never retries permissions',()=>{expect([0,1,2,3,9].map(n=>monitorRetryDelay(undefined,'error',n))).toEqual([2000,5000,10000,30000,30000]);expect(monitorRetryDelay({kind:'permissionDenied',message:'',retryable:false},'error',0)).toBeUndefined();expect(monitorRetryDelay(undefined,'offline',0)).toBeUndefined();expect(monitorRetryDelay(undefined,'closed',5)).toBe(30000);});
});
describe('monitor async group ownership',()=>{
 function setup(){vi.useFakeTimers();const stopped:string[]=[],opened:string[][]=[],retry:string[]=[],rows:MonitorRow[][]=[];let sequence=0;let pending:ReturnType<typeof deferred<string>>|undefined;
  let reply:MonitorRow[]=[];const transport:MonitorTransport={create:async(_c,dids)=>{opened.push(dids);return pending?pending.promise:'group'+ ++sequence;},read:async()=>structuredClone(reply),stop:async(_c,id)=>{stopped.push(id);},retry:async(_c,_id,did)=>{retry.push(did);}};const client=new MonitorConnection(transport,r=>rows.push(r),()=>{});
  return{client,stopped,opened,retry,rows,setReply:(r:MonitorRow[])=>reply=r,delay:()=>pending=deferred<string>()};}
 it('stops a create that resolves after exit exactly once',async()=>{const s=setup(),p=s.delay();s.client.open(context,['a']);await tick();s.client.close();p.resolve('old');await tick();expect(s.stopped).toEqual(['old']);expect(s.rows).toEqual([]);});
 it('waits for old creation cleanup before reentering and never stops a new owner',async()=>{const s=setup(),p=s.delay();s.client.open(context,['a']);await tick();s.client.open({...context,generation:2},['b']);await tick();expect(s.opened).toHaveLength(1);p.resolve('old');await tick();expect(s.stopped).toEqual(['old']);expect(s.opened).toHaveLength(2);s.client.close();await tick();});
 it('keeps other cameras reading during isolated retries and cancels retry timers on close',async()=>{const s=setup();s.setReply([{did:'a',revision:1,state:'error',events:[],error:{kind:'network',message:'',retryable:true}},{did:'b',revision:1,state:'live',events:[]}]);s.client.open(context,['a','b']);await tick();await vi.advanceTimersByTimeAsync(2000);expect(s.retry).toEqual(['a']);expect(s.rows.some(r=>r.some(row=>row.did==='b'))).toBe(true);s.client.close();await vi.advanceTimersByTimeAsync(60000);expect(s.retry).toEqual(['a']);expect(s.stopped).toEqual(['group1']);});
 it('retains the original group and route through a minute without renderer reads',async()=>{
  const s=setup();s.setReply([{did:'a',revision:1,state:'live',events:[]}]);s.client.open(context,['a']);await tick();
  s.client.setPollingPaused(true);await vi.advanceTimersByTimeAsync(60000);expect(s.rows).toHaveLength(1);expect(s.stopped).toEqual([]);
  s.client.setPollingPaused(false);await tick();expect(s.rows).toHaveLength(2);expect(s.opened).toEqual([['a']]);expect(s.retry).toEqual([]);
  s.client.close();expect(s.stopped).toEqual(['group1']);
 });
 it('drops a read from before the latest visibility change and wakes immediately on the same viewer',async()=>{
  vi.useFakeTimers();const pending=deferred<MonitorRow[]>(),read=vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue([{did:'a',revision:2,state:'live',events:[]}]);
  const rows:MonitorRow[][]=[],client=new MonitorConnection({create:async()=>'same',read,retry:async()=>{},stop:async()=>{}},r=>rows.push(r),()=>{});
  client.open(context,['a']);await tick();for(let i=0;i<10;i++){client.setPollingPaused(true);client.setPollingPaused(false);}
  pending.resolve([{did:'a',revision:1,state:'error',events:[]}]);await tick();
  expect(read.mock.calls.map(call=>call[1])).toEqual(['same','same']);expect(rows.flat().map(row=>row.revision)).toEqual([2]);client.close();
 });
 it('ignores late camera revisions and clears all polling across home changes',async()=>{const s=setup();s.setReply([{did:'a',revision:5,state:'live',events:[]}]);s.client.open(context,['a']);await tick();s.setReply([{did:'a',revision:4,state:'error',events:[]}]);await vi.advanceTimersByTimeAsync(100);expect(s.rows.at(-1)).toEqual([]);s.client.close();const n=s.rows.length;await vi.advanceTimersByTimeAsync(1000);expect(s.rows).toHaveLength(n);});
 it('reconnects a failed decoder without the healthy native state canceling its timer',async()=>{const s=setup();s.setReply([{did:'a',revision:1,state:'live',events:[]},{did:'b',revision:1,state:'live',events:[]}]);s.client.open(context,['a','b']);await tick();s.client.decoderFailed('a');await vi.advanceTimersByTimeAsync(2000);expect(s.retry).toEqual(['a']);s.client.close();await vi.advanceTimersByTimeAsync(60000);expect(s.retry).toEqual(['a']);});
});
describe('monitor tile action ownership',()=>{
 it('routes aggregate tile actions to their real home while sharing one poll and stop',async()=>{
  vi.useFakeTimers();const calls:unknown[]=[],context={homeId:'first',generation:9,allHomes:true,memberHomes:{a:'first',b:'shared'}};
  const transport:MonitorTransport={create:async(c,dids)=>{calls.push(['create',c,dids]);return'aggregate';},read:async()=>[{did:'a',revision:1,state:'live',events:[]},{did:'b',revision:2,state:'live',events:[]}],retry:async()=>{},stop:async(c,id)=>{calls.push(['stop',c,id]);},command:async(c,id,did)=>{calls.push(['command',c.homeId,id,did]);return{state:'ready'};},detailOpen:async(c,id,did)=>{calls.push(['detail',c.homeId,id,did]);return{leaseId:'mock',features:{qualities:[],listen:false,talk:false,ptz:false,playback:false}};}};
  const client=new MonitorConnection(transport,()=>{},()=>{});client.open(context,['a','b']);await tick();await client.command('b',2,{kind:'listen',enabled:false});await client.detailOpen('b',2);client.close();await tick();
  expect(calls).toEqual([['create',context,['a','b']],['command','shared','aggregate','b'],['detail','shared','aggregate','b'],['stop',context,'aggregate']]);expect(vi.getTimerCount()).toBe(0);
 });
 function setup(){vi.useFakeTimers();const calls:unknown[]=[],pending=deferred<{state:string;streamRevision:number}>(),shot=deferred<null>();let rows:MonitorRow[]=[{did:'a',revision:2,state:'live',events:[]},{did:'b',revision:4,state:'live',events:[]}];
  const transport:MonitorTransport={create:async()=>'viewer',read:async()=>rows,retry:async()=>{},stop:async()=>{},command:async(c,id,did,revision,operation)=>{calls.push({c,id,did,revision,operation});return pending.promise;},screenshot:async(c,id,did,revision,png)=>{calls.push({c,id,did,revision,png});return shot.promise;}};
  const client=new MonitorConnection(transport,()=>{},()=>{});client.open(context,['a','b']);return{client,calls,pending,shot,setRows:(r:MonitorRow[])=>rows=r};
 }
 it('addresses only the chosen device, group and revision',async()=>{const s=setup();await tick();const result=s.client.command('b',4,{kind:'record',enabled:true,width:848,height:480});s.pending.resolve({state:'recording',streamRevision:0});expect(await result).toMatchObject({state:'recording'});expect(s.calls).toEqual([{c:context,id:'viewer',did:'b',revision:4,operation:{kind:'record',enabled:true,width:848,height:480}}]);s.client.close();});
 it('rejects absent routes and old camera revisions before sending',async()=>{const s=setup();await tick();await expect(s.client.command('a',1,{kind:'quality',quality:'hd'})).rejects.toMatchObject({kind:'staleContext'});await expect(s.client.screenshot('missing',1,'png')).rejects.toMatchObject({kind:'staleContext'});expect(s.calls).toHaveLength(0);s.client.close();});
 it('drops late operation completion after a route reconnect',async()=>{const s=setup();await tick();const result=s.client.command('a',2,{kind:'quality',quality:'hd'});const check=expect(result).rejects.toMatchObject({kind:'staleContext'});s.setRows([{did:'a',revision:3,state:'connecting',events:[]}]);await vi.advanceTimersByTimeAsync(100);s.pending.resolve({state:'quality',streamRevision:1});await check;s.client.close();});
 it('drops screenshot completion after exit and reentry',async()=>{const s=setup();await tick();const result=s.client.screenshot('a',2,'pixels');const check=expect(result).rejects.toMatchObject({kind:'staleContext'});s.client.open({...context,generation:2},['a']);s.shot.resolve(null);await check;await tick();s.client.close();});
});

describe('monitor decoder recovery',()=>{
 function setup(error?:{kind:string;message:string;retryable:boolean}){vi.useFakeTimers();let attempts=0,revision=1;const transport:MonitorTransport={create:async()=>'viewer',read:async()=>[{did:'a',revision,state:'live',events:[]}],stop:async()=>{},retry:async()=>{if(++attempts===1&&error)throw error;revision++;}};const client=new MonitorConnection(transport,()=>{},()=>{});client.open(context,['a']);return{client,get attempts(){return attempts;}};}
 it('keeps failed decoder recovery after a transient retry IPC error',async()=>{const s=setup({kind:'network',message:'temporary',retryable:true});await tick();s.client.decoderFailed('a');await vi.advanceTimersByTimeAsync(2000);expect(s.attempts).toBe(1);await vi.advanceTimersByTimeAsync(5000);expect(s.attempts).toBe(2);await vi.advanceTimersByTimeAsync(30000);expect(s.attempts).toBe(2);s.client.close();});
 it('does not retry a permanent permission failure',async()=>{const s=setup({kind:'permissionDenied',message:'denied',retryable:false});await tick();s.client.decoderFailed('a');await vi.advanceTimersByTimeAsync(60000);expect(s.attempts).toBe(1);s.client.close();});
 it('does not let waiting-frame polling cancel an already failed decoder retry',async()=>{vi.useFakeTimers();let retries=0;const client=new MonitorConnection({create:async()=>'viewer',read:async()=>[{did:'a',revision:1,state:'waiting-frame',events:[]}],retry:async()=>{retries++;},stop:async()=>{}},()=>{},()=>{});client.open(context,['a']);await tick();client.decoderFailed('a');await vi.advanceTimersByTimeAsync(2000);expect(retries).toBe(1);client.close();});
});
