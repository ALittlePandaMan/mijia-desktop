import {describe,it,expect,vi} from 'vitest';
import {WasherRuntimeCommands,washerHomeStatus,washerFinishTime,washerRuntimeHasDetail,washerRuntimeMode,type WasherRuntimeControl,type WasherRuntimeSnapshot} from './washer-runtime';
import type {ControlResult,DeviceContext,DevicePanel} from './types';
const context:DeviceContext={homeId:'h',generation:1,did:'washer'};
const pause:WasherRuntimeControl={key:'pause',label:'暂停',kind:'action',siid:2,aiid:3,piid:null,value:null,enabled:true,reason:null,confirmation:null};
const resume={...pause,key:'resume',label:'继续',aiid:2};
const lock={...pause,key:'lock',kind:'property' as const,piid:1,aiid:null,value:true};
const panel:DevicePanel={did:'washer',model:'midjd8.washer.42',services:[{siid:2,name:'washer',description:'',properties:[],actions:[{siid:2,aiid:2,name:'start-wash',description:'',in:[],out:[]},{siid:2,aiid:3,name:'pause',description:'',in:[],out:[]}]}],washerRuntime:{state:'busy',active:true,locked:false,controls:[pause,lock],steps:[]} as unknown as WasherRuntimeSnapshot};
it('shows the reported wash phase and a finish estimate tied to the live reading',()=>{
 const runtime={...panel.washerRuntime!,steps:[{id:2,label:'洗涤',progress:'current' as const}]};
 expect(washerHomeStatus(runtime)).toBe('主洗中');
 expect(washerHomeStatus({...runtime,state:'paused'})).toBe('暂停中');
 expect(washerHomeStatus({...runtime,steps:[]})).toBe('工作中');
 const readAt=new Date(2026,10,18,23,50).getTime();
 expect(washerFinishTime(23,readAt)).toBe('次日 00:13');
 expect(washerFinishTime(null,readAt)).toBeUndefined();
 expect(washerFinishTime(23)).toBeUndefined();
});
const deferred=<T>()=>{let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function setup(){const transport={action:vi.fn<(...args:unknown[])=>Promise<ControlResult>>(),write:vi.fn<(...args:unknown[])=>Promise<ControlResult>>(),read:vi.fn<(...args:unknown[])=>Promise<DevicePanel>>().mockResolvedValue(panel)},accept=vi.fn(),failed=vi.fn();const commands=new WasherRuntimeCommands(transport,vi.fn(),accept,failed);commands.bind(context,'account');return{commands,transport,accept,failed};}
it('opens live work and pause details without a timeline or runtime controls',()=>{
 const runtime={...panel.washerRuntime!,modeLabel:'Quick Wash',controls:[]};
 expect(washerRuntimeMode(runtime,[])).toBe('快速洗');
 expect(washerRuntimeMode({...runtime,modeLabel:'Golden Wash'},[])).toBe('黄金洗');
 expect(washerRuntimeMode({...runtime,modeLabel:'Untranslated program'},[])).toBe('Untranslated program');
 expect(washerRuntimeMode({...runtime,modeLabel:'Mode 3'},[])).toBeUndefined();
 expect(washerRuntimeHasDetail(runtime,false)).toBe(true);
 expect(washerRuntimeHasDetail({...runtime,controls:[pause]},false)).toBe(true);
 expect(washerRuntimeHasDetail({...runtime,state:'paused'},true)).toBe(true);
 expect(washerRuntimeHasDetail({...runtime,active:false,state:'unknown'},false)).toBe(false);
 expect(washerRuntimeHasDetail({...runtime,state:'completed',controls:[lock]},false)).toBe(false);
});
it('uses the projected power of the washer channel for its working card and controls',()=>{
 const {commands}=setup(),property={siid:2,piid:1,name:'on',description:'Power',format:'bool',access:['read','write'],code:0,value:false,pending:'sending' as const};
 const working={...panel,washerRuntime:{...panel.washerRuntime!,serviceId:2},services:[{...panel.services[0],properties:[property]}]};
 expect(commands.display(working).washerRuntime).toMatchObject({state:'off',active:false,controls:[]});
 expect(working.washerRuntime.state).toBe('busy');
 expect(commands.display({...working,washerRuntime:{...working.washerRuntime,serviceId:3}}).washerRuntime?.state).toBe('busy');
});
describe('washer runtime local intents',()=>{
 it('rolls back failed and expired intentions silently without replay',async()=>{vi.useFakeTimers();try{const {commands,transport}=setup();transport.action.mockRejectedValueOnce({kind:'offline',message:'offline'});await commands.execute(context,pause);expect(commands.display(panel).washerRuntime?.state).toBe('busy');expect(commands.message).toBe('');transport.action.mockResolvedValueOnce({verified:false,message:'',panel});await commands.execute(context,pause);expect(commands.display(panel).washerRuntime?.state).toBe('paused');await vi.advanceTimersByTimeAsync(30000);expect(commands.display(panel).washerRuntime?.state).toBe('busy');expect(transport.action).toHaveBeenCalledTimes(2);}finally{vi.useRealTimers();}});
 it('projects pause immediately, accepts reverse before acknowledgement and ignores the older reply',async()=>{
  const {commands,transport,accept}=setup(),first=deferred<ControlResult>(),last=deferred<ControlResult>();transport.action.mockImplementationOnce(()=>first.promise).mockImplementationOnce(()=>last.promise);
  const a=commands.execute(context,pause);expect(commands.display(panel).washerRuntime?.state).toBe('paused');expect(commands.display(panel).washerRuntime?.controls[0].key).toBe('resume');await Promise.resolve();
  const b=commands.execute(context,resume);expect(commands.blocked).toBe(false);expect(commands.display(panel).washerRuntime?.state).toBe('busy');first.resolve({verified:true,message:'',panel:{...panel,washerRuntime:{...panel.washerRuntime!,state:'paused'}}});await a;expect(accept).not.toHaveBeenCalled();expect(commands.display(panel).washerRuntime?.state).toBe('busy');
  last.resolve({verified:true,message:'',panel});await b;expect(transport.action.mock.calls.map(c=>c[2])).toEqual([3,2]);expect(commands.pending).toBe(false);expect(accept).toHaveBeenCalledWith(context,panel);
 });
 it('keeps independent task and child-lock predictions, and accepts another setting while uncertain',async()=>{
  const {commands,transport}=setup(),first=deferred<ControlResult>();transport.action.mockImplementation(()=>first.promise);transport.write.mockResolvedValue({verified:false,message:'',panel});const a=commands.execute(context,pause);await Promise.resolve();const b=commands.execute(context,lock);
  expect(commands.display(panel).washerRuntime).toMatchObject({state:'paused',locked:true});first.resolve({verified:false,message:'',panel});await Promise.all([a,b]);expect(commands.blocked).toBe(false);expect(commands.display(panel).washerRuntime).toMatchObject({state:'paused',locked:true});
 });
 it('retains exact native bindings and emits no success prose or automatic retries',async()=>{const{commands,transport}=setup();transport.write.mockResolvedValue({verified:false,message:'waiting',panel});await commands.execute(context,lock);expect(transport.write).toHaveBeenCalledExactlyOnceWith(context,2,1,true);expect(commands.message).toBe('');expect(commands.blocked).toBe(false);});
 it('rejects wrong-device reports and never accepts a stale explicit refresh over a new local action',async()=>{const{commands,transport,accept,failed}=setup();transport.action.mockResolvedValue({verified:true,message:'',panel:{...panel,did:'other'}});await commands.execute(context,pause);expect(accept).not.toHaveBeenCalled();expect(failed).toHaveBeenCalledTimes(1);const read=deferred<DevicePanel>();transport.read.mockImplementation(()=>read.promise);const pending=commands.refresh(context);transport.write.mockResolvedValue({verified:false,message:'',panel});await commands.execute(context,lock);read.resolve(panel);await pending;expect(commands.display(panel).washerRuntime?.locked).toBe(true);});
 it('cancels queued writes and isolates late authentication errors after switching accounts',async()=>{const{commands,transport,accept,failed}=setup(),reply=deferred<ControlResult>();transport.action.mockImplementation(()=>reply.promise);const a=commands.execute(context,pause);await Promise.resolve();const b=commands.execute(context,resume);commands.bind(context,'another-account');reply.reject({kind:'authExpired',message:'expired',retryable:false});await Promise.all([a,b]);expect(transport.action).toHaveBeenCalledTimes(1);expect(accept).not.toHaveBeenCalled();expect(failed).not.toHaveBeenCalled();expect(commands.pending).toBe(false);});
 it('drops a refused prerequisite and its queued reversal without submitting the reversal',async()=>{
  const {commands,transport}=setup(),ack=deferred<ControlResult>();
  transport.action.mockReturnValue(ack.promise);
  const a=commands.execute(context,pause),b=commands.execute(context,resume);
  ack.reject({kind:'permissionDenied',message:'refused'});
  await Promise.all([a,b]);
  expect(transport.action.mock.calls.map(call=>call[2])).toEqual([3]);
  expect(transport.read).not.toHaveBeenCalled();
  expect(commands.projecting).toBe(false);
 });
 it('does not wait for a pending confirmation to submit the next action and ignores that older read failure',async()=>{
  const {commands,transport,accept,failed}=setup(),first=deferred<DevicePanel>();
  transport.action.mockResolvedValue({verified:false,message:'',panel});
  transport.read.mockReturnValueOnce(first.promise);
  await commands.execute(context,pause);
  expect(transport.read).toHaveBeenCalledWith(context,'paused',transport.action.mock.calls[0][4]);
  await commands.execute(context,resume);
  first.reject({kind:'timeout',message:'stale'});
  await Promise.resolve();
  expect(transport.action.mock.calls.map(call=>call[2])).toEqual([3,2]);
  expect(accept).toHaveBeenCalledTimes(1);
  expect(failed).not.toHaveBeenCalled();
  expect(commands.projecting).toBe(false);
 });
 it('rolls back on the first confirmation error or a missing live state',async()=>{
  const {commands,transport,accept,failed}=setup();
  transport.action.mockResolvedValue({verified:false,message:'',panel});
  transport.read.mockRejectedValueOnce({kind:'network',message:'failed'}).mockResolvedValueOnce({...panel,washerRuntime:{...panel.washerRuntime!,state:'unknown'}});
  for(let attempt=0;attempt<2;attempt++){
   await commands.execute(context,pause);
   expect(commands.display(panel).washerRuntime?.state).toBe('busy');
  }
  expect(accept).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledTimes(2);
  expect(transport.action).toHaveBeenCalledTimes(2);
 });
});
