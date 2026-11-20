import {describe,it,expect,vi} from 'vitest';
import {MonitorCatalogController,selectedMonitorMembers,type MonitorCatalog} from './monitor-catalog';
import type {Device,Home} from './types';
const home=(id:string):Home=>({id,name:id,ownerId:'owner',rooms:[],shared:false});
const device=(did:string,readOnly=false)=>({did,name:'同名摄像头',model:'test.camera.a',online:true,roomName:'客厅',sharedReadOnly:readOnly})as Device;
const fixture=():MonitorCatalog=>({scope:'account',generation:3,allHomes:true,incomplete:false,homes:[{home:home('a'),devices:[device('1',true),device('2')],excludedDeviceIds:['2']},{home:home('b'),devices:[device('1'),device('3')],excludedDeviceIds:[]}]});
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};};
describe('whole-household monitor selection',()=>{
 it('keeps household exclusions, deduplicates DID and keeps the first selected source permissions',()=>{
  const view=fixture();const members=selectedMonitorMembers(view);expect(members.map(m=>[m.home.id,m.device.did])).toEqual([['a','1'],['b','3']]);expect(members[0].device.sharedReadOnly).toBe(true);
  view.homes[0].excludedDeviceIds.push('1');expect(selectedMonitorMembers(view)[0].home.id).toBe('b');
  view.homes[1].error={message:'offline directory'};expect(selectedMonitorMembers(view)).toEqual([]);
 });
 it('coalesces metadata reads and never starts a media connection to select a scope',async()=>{
  const pending=deferred<MonitorCatalog>(),load=vi.fn(()=>pending.promise),changed=vi.fn();
  const state=new MonitorCatalogController(changed,{load,change:vi.fn()});state.setAccount('account');const a=state.load(),b=state.load();expect(a).toBe(b);expect(load).toHaveBeenCalledTimes(1);expect(state.loading).toBe(true);pending.resolve(fixture());await a;expect(state.data?.homes).toHaveLength(2);expect(state.loading).toBe(false);
 });
 it('rejects a late old-account directory',async()=>{
  const pending=deferred<MonitorCatalog>();const state=new MonitorCatalogController(()=>{},{load:()=>pending.promise,change:vi.fn()});state.setAccount('account');const loading=state.load();state.setAccount('next');pending.resolve(fixture());await loading;expect(state.data).toBeUndefined();expect(state.loading).toBe(false);
 });
 it('projects exclusions immediately and ordered saves do not overwrite a newer choice',async()=>{
  const writes:ReturnType<typeof deferred<MonitorCatalog>>[]=[],change=vi.fn(()=>{const write=deferred<MonitorCatalog>();writes.push(write);return write.promise;});
  const state=new MonitorCatalogController(()=>{},{load:async()=>fixture(),change});state.setAccount('account');await state.load();state.select('a','1',true);state.select('a','1',false);expect(state.data?.homes[0].excludedDeviceIds).toEqual(['2']);await vi.waitFor(()=>expect(writes).toHaveLength(1));
  const old=fixture();old.homes[0].excludedDeviceIds.push('1');writes[0].resolve(old);await vi.waitFor(()=>expect(writes).toHaveLength(2));expect(state.data?.homes[0].excludedDeviceIds).toEqual(['2']);writes[1].resolve(fixture());await vi.waitFor(()=>expect(state.pending).toBe(0));
 });
 it('restores the saved selection after a failed save, and keeps partial-home errors',async()=>{
  const saved=fixture();saved.incomplete=true;saved.homes[1].error={message:'读取失败'};const state=new MonitorCatalogController(()=>{},{load:async()=>structuredClone(saved),change:async()=>{throw Error('disk');}});state.setAccount('account');await state.load();state.select('a','1',true);expect(selectedMonitorMembers(state.data!)).toEqual([]);await vi.waitFor(()=>expect(state.pending).toBe(0));expect(state.data?.homes[0].excludedDeviceIds).toEqual(['2']);expect(state.error).toContain('保存失败');expect(state.data?.incomplete).toBe(true);
 });
});
