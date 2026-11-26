import {describe,it,expect,vi} from 'vitest';
import {irControlKeys,IrRemoteState,type IrApi,type IrReport} from './ir-remote';
const c={homeId:'home',generation:1,did:'ir-fixture'};
const report:IrReport={model:'miir.tv.ir01',baseline:'a'.repeat(64),keys:[{name:'POWER',label:'电源'},{name:'VOL+',label:'音量＋'}]};
const deferred=<T>()=>{let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const setup=(over:Partial<IrApi>={})=>{const api={read:vi.fn(async()=>structuredClone(report)),send:vi.fn(async()=> '已发送，请核实设备反馈'),...over};let nonceIndex=0;const state=new IrRemoteState(api,()=>{},()=>{},()=> '12345678-1234-1234-1234-'+String(123456789012+nonceIndex++));state.bind(c,report.model,'account');return{state,api};};
describe('observed IR key capabilities and one-shot sending',()=>{
 it('places the exact observed TV and learned IPTV names in the reference remote without inferred commands',()=>{
  const roles=['power','volume-down','volume-up','up','left','center','right','down','home','back','menu'];
  const tvNames=['POWER','VOL-','VOL+','NAVIGATE_UP','NAVIGATE_LEFT','OK','NAVIGATE_RIGHT','NAVIGATE_DOWN','HOMEPAGE','BACK','MENU'];
  const tv={...report,keys:tvNames.map(name=>({name,label:name}))};
  const placed=irControlKeys(tv);expect(roles.map(role=>placed[role]?.name)).toEqual(tvNames);expect(Object.values(placed).every(key=>tv.keys.includes(key!))).toBe(true);
  const learnedNames=['电源','-','+','上','左','确认','右','下','主页','返回'];
  const learned={...report,model:'miir.remote.ir01',keys:learnedNames.map(name=>({name,label:name}))};
  expect(roles.map(role=>irControlKeys(learned)[role]?.name)).toEqual([...learnedNames,undefined]);
  expect(irControlKeys({...tv,keys:[]}).menu).toBeUndefined();
  expect(irControlKeys({...learned,keys:[{name:'MENU',label:'菜单'}]}).menu).toBeUndefined();
 });
 it('read and unknown keys never send, and valid keys keep snapshot/name/nonce identity',async()=>{const{state,api}=setup();await state.read();await state.press('MUTE');expect(api.send).not.toHaveBeenCalled();await state.press('POWER');expect(api.send).toHaveBeenCalledExactlyOnceWith(c,report.baseline,'POWER','12345678-1234-1234-1234-123456789012');expect(state.message).toBe('');});
 it('accepts a second key immediately while preserving transport order and unique nonces',async()=>{
  const reply=deferred<string>(),send=vi.fn().mockImplementationOnce(()=>reply.promise).mockResolvedValue('ok'),{state}=setup({send});await state.read();
  const first=state.press('POWER');await Promise.resolve();const next=state.press('VOL+');expect(state.lastPressed).toBe('VOL+');expect(state.pending).toBe(true);expect(send).toHaveBeenCalledTimes(1);
  reply.resolve('ok');await Promise.all([first,next]);expect(send.mock.calls.map(c=>c[2])).toEqual(['POWER','VOL+']);expect(send.mock.calls[0][3]).not.toEqual(send.mock.calls[1][3]);expect(state.pending).toBe(false);
 });
 it('deduplicates the same in-flight key and accepts it after the acknowledgement',async()=>{
  const reply=deferred<string>(),send=vi.fn().mockImplementationOnce(()=>reply.promise).mockResolvedValue('ok');
  const {state}=setup({send});await state.read();
  const first=state.press('POWER');await state.press('POWER');
  expect(send).toHaveBeenCalledTimes(1);expect(state.keyPending('POWER')).toBe(true);
  reply.resolve('ok');await first;await state.press('POWER');
  expect(send).toHaveBeenCalledTimes(2);expect(state.keyPending('POWER')).toBe(false);
 });
 it('never retries an uncertain key automatically but accepts the next explicit press, scoped to its account',async()=>{
  const send=vi.fn(async()=>{throw{kind:'network',message:'超时',retryable:true};}),{state}=setup({send});await state.read();await state.press('POWER');expect(state.uncertain).toBe(true);expect(send).toHaveBeenCalledTimes(1);
  state.close();state.bind(c,report.model,'account');await state.read();expect(send).toHaveBeenCalledTimes(1);await state.press('VOL+');expect(send).toHaveBeenCalledTimes(2);
  state.bind(c,report.model,'other-account');await state.read();expect(state.uncertain).toBe(false);
 });
 it('a known preflight conflict does not pretend to send or block forever',async()=>{const{state}=setup({send:async()=>{throw{kind:'conflict',message:'键表已变化',retryable:false};}});await state.read();await state.press('POWER');expect(state.uncertain).toBe(false);expect(state.error?.kind).toBe('conflict');expect(state.message).toBe('');});
 it('rejects a report for another model',async()=>{const{state,api}=setup({read:async()=>({...report,model:'miir.stb.ir01'})});await state.read();await state.press('POWER');expect(state.report).toBeUndefined();expect(state.error?.kind).toBe('protocol');expect(api.send).not.toHaveBeenCalled();});
 it('late reads from the previous household cannot replace the new view',async()=>{const old=deferred<IrReport>(),{state}=setup({read:()=>old.promise});const p=state.read();state.bind({...c,homeId:'other',generation:2},report.model,'account');old.resolve(report);await p;expect(state.report).toBeUndefined();expect(state.loading).toBe(false);});
 it('reopening during a send does not copy a late message',async()=>{const old=deferred<string>(),{state}=setup({send:()=>old.promise});await state.read();const p=state.press('POWER');await Promise.resolve();state.close();state.bind(c,report.model,'account');expect(state.pending).toBe(true);old.resolve('previous message');await p;expect(state.pending).toBe(false);expect(state.uncertain).toBe(false);expect(state.message).toBe('');});
 it('late uncertain sends remain attached to the original scope',async()=>{const old=deferred<string>(),{state}=setup({send:()=>old.promise});await state.read();const p=state.press('POWER');await Promise.resolve();state.bind({...c,homeId:'other'},report.model,'account');old.reject({kind:'network',message:'timeout',retryable:true});await p;expect(state.uncertain).toBe(false);state.bind(c,report.model,'account');expect(state.uncertain).toBe(true);});
});
