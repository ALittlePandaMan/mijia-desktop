import {describe,it,expect,vi,afterEach} from 'vitest';
import {HomeScenesState,sceneRooms,sceneShortcutGroups,environmentSeries,latestEnvironment,type SceneTransport, type HomeSceneReport} from './home-scenes';
import type {Device,HomeCardEntry,DevicePanel,SensorHistory} from './types';
const device=(did:string,category:string,extra:Partial<Device>={}):Device=>({did,name:did,model:'test.model',online:true,roomId:'r',roomName:'客厅',specType:`urn:miot-spec-v2:device:${category}:0000:test:1`,...extra});
const card=(did:string,extra:Partial<HomeCardEntry>={}):HomeCardEntry=>({did,kind:'power',selected:false,enabled:true,reason:null,visible:true,highlight:false,binding:{siid:2,piid:1},action:'on',cardType:1,...extra});
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
const report:HomeSceneReport={homeId:'h',generation:1,scenes:[{id:'one',name:'回家',roomIds:['r'],common:true,icon:null},{id:'two',name:'离家',roomIds:[],common:false,icon:null}]};
function state(overrides:Partial<SceneTransport>={}){const transport:SceneTransport={list:vi.fn(async()=>report),run:vi.fn(async()=>{}),panel:vi.fn(),history:vi.fn(),write:vi.fn(),refresh:vi.fn(async()=>{}),...overrides};const s=new HomeScenesState(transport,vi.fn(),vi.fn());s.connect({homeId:'h',generation:1});return{s,transport};}
describe('home scene grouping and readings',()=>{
 it('groups choices in room order, retains global and unassigned tasks, and includes multi-room tasks in each room',()=>{
  const scene=(id:string,roomIds:string[])=>({id,roomIds,name:id,icon:null,common:false});
  const scenes=[scene('global',[]),scene('living',['a']),scene('both',['a','b']),scene('unknown',['removed'])],rooms=[{id:'b',name:'次卧'},{id:'a',name:'客厅'},{id:'empty',name:'厨房'}];
  expect(sceneShortcutGroups(scenes,rooms).map(g=>[g.name,g.scenes.map(s=>s.id)])).toEqual([['全屋',['global']],['次卧',['both']],['客厅',['living','both']],['未分配',['unknown']]]);
  expect(scenes[2].roomIds).toEqual(['a','b']);expect(sceneShortcutGroups([],rooms)).toEqual([]);
 });
 it('groups only lights and wired switches; excludes outlets, camera power, wireless channels',()=>{
  const devices=[device('a','light'),device('b','switch'),device('c','outlet'),device('d','camera'),device('e','switch'),device('f','curtain',{roomId:'other'})];
  const cards=devices.map(d=>card(d.did,d.did==='e'?{modeAllowed:false}:d.did==='f'?{kind:'curtain'}:{}));
  expect(sceneRooms(devices,[{id:'r',name:'客厅'}],cards,'light')[0].devices.map(d=>d.did)).toEqual(['a','b']);
  expect(sceneRooms(devices,[{id:'r',name:'客厅'}],cards,'curtain').map(r=>[r.id,r.devices[0].did])).toEqual([['?','f']]);
 });
 it('keeps first-card permissions, inventory order and unknown-room membership when indexed',()=>{
  const devices=[device('second','light',{roomId:'b'}),device('missing','light',{roomId:'removed'}),device('first','light',{roomId:'b'}),device('blocked','light',{roomId:'b'})];
  const cards=[card('blocked',{modeAllowed:false}),card('blocked'),card('first'),card('second')];
  expect(sceneRooms(devices,[{id:'empty',name:'空房间'},{id:'b',name:'卧室'}],cards,'light').map(g=>[g.name,g.devices.map(d=>d.did)])).toEqual([['卧室',['second','first']],['未分配',['missing']]]);
 });
 it('does not duplicate a task with repeated room IDs or misclassify a partly unknown assignment',()=>{
  const scenes=[{id:'a',name:'重复房间',roomIds:['r','r','missing'],icon:null,common:false}];
  expect(sceneShortcutGroups(scenes,[{id:'r',name:'客厅'}]).map(g=>[g.name,g.scenes.map(s=>s.id)])).toEqual([['客厅',['a']]]);
 });
 it('keeps zero readings across missing hours, rejects failed properties',()=>{
  const p={services:[{name:'temperature-humidity-sensor',properties:[{name:'temperature',access:['read'],value:0,code:0},{name:'humidity',access:['read'],value:55,code:-1}]}]} as unknown as DevicePanel;
  expect(latestEnvironment(p,'temperature')).toBe(0);expect(latestEnvironment(p,'humidity')).toBeNull();
  const reported={services:[{name:'temperature-humidity-sensor',properties:[{name:'temperature',access:['read'],value:null,code:-704010000,lastReported:{value:23.8,updatedAt:100,retrievedAt:120}},{name:'relative-humidity',access:['read'],value:null,code:-704010000,lastReported:{value:36.5,updatedAt:100,retrievedAt:120}}]}]} as unknown as DevicePanel;
  expect(latestEnvironment(reported,'temperature')).toBe(23.8);expect(latestEnvironment(reported,'humidity')).toBe(36.5);
  const h={channels:[{name:'temperature',points:[{time:100,low:0,high:0},{time:7400,low:20,high:22}]}]} as SensorHistory;
  expect(environmentSeries(h,'temperature')).toEqual([[0,0],[3600000,0],[7200000,21]]);expect(environmentSeries(undefined,'temperature')).toEqual([]);
 });
});

describe('environment hourly display',()=>{
 const start=Date.parse('2026-11-10T00:00:00Z')/1000;
 const point=(offset:number,low:number,high=low)=>({time:start+offset,low,high,gateway:false});
 const history=(points:SensorHistory['channels'][number]['points']):SensorHistory=>({channels:[{name:'temperature',points}]} as SensorHistory);
 it('averages each hour independently and aligns irregular reports to clock hours',()=>{
  const source=history([point(3599,26),point(1799,24),point(0,20,24),point(1800,24),point(3600,28)]),original=structuredClone(source);
  expect(environmentSeries(source,'temperature')).toEqual([[start*1000,24],[(start+3600)*1000,28]]);
  expect(source).toEqual(original);
 });
 it('extends the last hourly average through missing hours',()=>{
  expect(environmentSeries(history([point(600,20),point(7200,24)]),'temperature')).toEqual([[start*1000,20],[(start+3600)*1000,20],[(start+7200)*1000,24]]);
 });
 it('preserves zero through invalid hours without poisoning other samples',()=>{
  const source=history([point(0,0),point(100,NaN),point(3600,Infinity),point(7200,22.2),point(7210,22.3),{...point(0,99),time:NaN}]);
  expect(environmentSeries(source,'temperature')).toEqual([[start*1000,0],[(start+3600)*1000,0],[(start+7200)*1000,22.3]]);
 });
 it('aggregates humidity separately and leaves an absent channel empty',()=>{
  const source=history([point(0,22)]);source.channels.push({name:'humidity',unit:'%',points:[point(0,30),point(1200,40),point(1800,0),point(3600,60)],error:null,complete:true});
  expect(environmentSeries(source,'humidity')).toEqual([[start*1000,23.3],[(start+3600)*1000,60]]);
  expect(environmentSeries(history([]),'humidity')).toEqual([]);
 });
});
describe('home scene request lifecycle',()=>{
 it('deduplicates concurrent reads and ignores a previous household reply',async()=>{const read=deferred<HomeSceneReport>(),{s,transport}=state({list:vi.fn(()=>read.promise)});const a=s.load(),b=s.load();expect(transport.list).toHaveBeenCalledTimes(1);s.connect({homeId:'other',generation:2});read.resolve(report);await Promise.all([a,b]);expect(s.scenes).toEqual([]);});
 it('accepts every explicit task click while cloud replies are delayed, without retries',async()=>{
  const first=deferred<void>(),second=deferred<void>();let n=0;const{s,transport}=state({run:vi.fn(()=>++n===1?first.promise:second.promise)});await s.load();
  const a=s.run(report.scenes[0]),b=s.run(report.scenes[0]);expect(transport.run).toHaveBeenCalledTimes(2);expect((transport.run as ReturnType<typeof vi.fn>).mock.calls[0][3]).not.toEqual((transport.run as ReturnType<typeof vi.fn>).mock.calls[1][3]);
  first.resolve();await a;expect(s.taskStates.get('one')?.pending).toBe(true);second.resolve();await b;expect(s.taskStates.get('one')?.pending).toBe(false);
  const failed=state({run:vi.fn(async()=>{throw{kind:'sceneUncertain',message:'待确认',retryable:false};})});await failed.s.load();await failed.s.run(report.scenes[0]);expect(failed.transport.run).toHaveBeenCalledTimes(1);
 });
 it('queues every room target locally in the same turn and accepts immediate reverse and other-room intents',()=>{
  const{s,transport}=state();const devices=[device('a','light'),device('b','light'),device('c','light'),device('offline','light',{online:false}),device('shared','light',{sharedReadOnly:true})],cards=devices.map(d=>card(d.did));
  s.control(devices,'off',cards);expect(transport.write).toHaveBeenCalledTimes(3);s.control(devices,'on',cards);expect(transport.write).toHaveBeenCalledTimes(6);s.control([device('other','light')],'on',[card('other')]);expect(transport.write).toHaveBeenCalledTimes(7);
  expect(transport.refresh).not.toHaveBeenCalled();expect(s.pending).toBe(false);
 });
 it('stops dispatching a batch immediately when the household changes',()=>{
  const{s,transport}=state();(transport.write as ReturnType<typeof vi.fn>).mockImplementationOnce(()=>s.connect({homeId:'other',generation:2}));const devices=[device('a','light'),device('b','light')];s.control(devices,'off',devices.map(d=>card(d.did)));expect(transport.write).toHaveBeenCalledTimes(1);
 });
 it('does not adopt environment replies from the previous home',async()=>{const panel=deferred<DevicePanel>(),history=deferred<SensorHistory>(),{s}=state({panel:()=>panel.promise,history:()=>history.promise});const pending=s.loadEnvironment([device('t','temperature-humidity-sensor')]);s.connect({homeId:'other',generation:2});panel.resolve({services:[]} as unknown as DevicePanel);history.resolve({did:'t',channels:[]} as unknown as SensorHistory);await pending;expect(s.environment.size).toBe(0);});
});

describe('environment hourly refresh',()=>{
 afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
 const thermometer=device('t','temperature-humidity-sensor');
 const responses={panel:vi.fn(async()=>({services:[]} as unknown as DevicePanel)),history:vi.fn(async()=>({did:'t',channels:[]} as unknown as SensorHistory))};
 it('fetches initially then exactly on clock hours, including after navigation',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-10T03:42:10Z'));const {s,transport}=state(responses);
  await s.loadEnvironment([thermometer]);const first=(transport.history as ReturnType<typeof vi.fn>).mock.calls.length;
  await s.loadEnvironment([thermometer]);await vi.advanceTimersByTimeAsync(17*60000+49999);expect(transport.history).toHaveBeenCalledTimes(first);
  await vi.advanceTimersByTimeAsync(1);expect(transport.history).toHaveBeenCalledTimes(first+1);
  await s.loadEnvironment([thermometer]);expect(transport.history).toHaveBeenCalledTimes(first+1);
  await vi.advanceTimersByTimeAsync(3600000);expect(transport.history).toHaveBeenCalledTimes(first+2);s.reset();expect(vi.getTimerCount()).toBe(0);
 });
 it('deduplicates a slow hourly request and cancels the old household timer',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-10T03:59:00Z'));const reply=deferred<SensorHistory>(),{s,transport}=state({panel:responses.panel,history:vi.fn(()=>reply.promise)});
  const first=s.loadEnvironment([thermometer]),second=s.loadEnvironment([thermometer]);
  reply.resolve({did:'t',channels:[]} as unknown as SensorHistory);await Promise.all([first,second]);expect(transport.history).toHaveBeenCalledTimes(1);
  s.connect({homeId:'other',generation:2});await vi.advanceTimersByTimeAsync(2*3600000);expect(transport.history).toHaveBeenCalledTimes(1);expect(s.environment.size).toBe(0);
 });
 it('retains successful readings across a transient hourly failure and updates atomically',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-10T03:30:00Z'));
  const panel={services:[{name:'temperature-humidity-sensor',properties:[{name:'temperature',access:['read'],value:24,code:0}]}]} as unknown as DevicePanel;
  const {s,transport}=state({panel:vi.fn(async()=>panel),history:vi.fn(async()=>({did:'t',channels:[]} as unknown as SensorHistory))});await s.loadEnvironment([thermometer]);
  const previous=s.environment.get('t');(transport.panel as ReturnType<typeof vi.fn>).mockRejectedValue({kind:'network',message:'offline'});(transport.history as ReturnType<typeof vi.fn>).mockRejectedValue({kind:'network',message:'offline'});
  await vi.advanceTimersByTimeAsync(30*60000);expect(s.environment.get('t')?.temperature).toBe(24);expect(s.environment.get('t')?.history).toBe(previous?.history);s.reset();
 });
});

it('carries each environment channel only forward through the requested final hour',()=>{
 const start=Date.parse('2026-11-10T00:00:00Z')/1000;
 const source={start,end:start+4*3600+1200,channels:[{name:'temperature',points:[{time:start+3600,low:0,high:0},{time:start+3*3600,low:22,high:24},{time:start+5*3600,low:99,high:99}]},{name:'humidity',points:[{time:start+2*3600,low:40,high:40}]}]} as SensorHistory;
 expect(environmentSeries(source,'temperature')).toEqual([[start*1000+3600000,0],[start*1000+7200000,0],[start*1000+10800000,23],[start*1000+14400000,23]]);
 expect(environmentSeries(source,'humidity')).toEqual([[start*1000+7200000,40],[start*1000+10800000,40],[start*1000+14400000,40]]);
});
