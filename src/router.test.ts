import {afterEach,describe,expect,it,vi} from 'vitest';
import {routerModel,routerPageEligible,routerPublicSpeed,routerSpeed,RouterState} from './router';
import type {Device,DeviceContext,DevicePanel,Property,RouterReport} from './types';
const context:DeviceContext={homeId:'home',generation:1,did:'router-fixture'};
const report:RouterReport={did:context.did,model:routerModel,fetchedAt:1,network:'ok',uploadBps:0,downloadBps:1918,wifi7:true,warnings:[]};
afterEach(()=>{vi.useRealTimers();});
describe('verified router projection and read lifecycle',()=>{
 it('routes unlisted router models without treating repeaters as routers',()=>{
   const device:Device={did:context.did,name:'router',model:'xiaomi.router.r1350',online:true,roomId:'room',roomName:'room'};
   expect(routerPageEligible(device)).toBe(true);
   expect(routerPageEligible({...device,model:'xiaomi.plc.v1'})).toBe(false);
 });
 it('trusts explicit units and retains zero while discarding ambiguous or failed rates',()=>{
   const upload:Property={siid:2,piid:2,name:'upload-speed',description:'Upload',access:['read'],format:'uint32',unit:'KByte/s',code:0,value:120};
   const download:Property={...upload,piid:1,name:'download-speed',unit:'B/s',value:0};
   const panel=(properties:Property[]):DevicePanel=>({did:context.did,model:'xiaomi.router.rp09',services:[
     {siid:2,name:'router',description:'Router',properties,actions:[]},
   ]});
   expect(routerPublicSpeed(panel([upload,download]),'up')).toBe(120000);
   expect(routerPublicSpeed(panel([upload,download]),'down')).toBe(0);
   expect(routerPublicSpeed(panel([{...upload,unit:undefined}]),'up')).toBeUndefined();
   expect(routerPublicSpeed(panel([{...upload,code:-1}]),'up')).toBeUndefined();
   expect(routerPublicSpeed(panel([upload,{...upload,piid:4}]),'up')).toBeUndefined();
 });
 it('uses the actual decimal speed units and keeps unknown values empty',()=>{expect(routerSpeed(0)).toEqual({value:'0',unit:'KB/S'});expect(routerSpeed(1918)).toEqual({value:'2',unit:'KB/S'});expect(routerSpeed(999999)).toEqual({value:'1000',unit:'KB/S'});expect(routerSpeed(1000000)).toEqual({value:'1',unit:'MB/S'});for(const value of [undefined,null,-1,Infinity,NaN,1.1])expect(routerSpeed(value)).toEqual({value:'--',unit:''});});
 it('serializes polling and prevents late former-context reads from repopulating state',async()=>{vi.useFakeTimers();let resolve!:(r:RouterReport)=>void;const read=vi.fn(()=>new Promise<RouterReport>(r=>resolve=r)),changed=vi.fn(),s=new RouterState(read,changed,vi.fn());s.bind(context,'account');const p=s.load(context);await s.load(context);expect(read).toHaveBeenCalledTimes(1);s.close();resolve(report);await p;await vi.advanceTimersByTimeAsync(30000);expect(s.report).toBeUndefined();expect(read).toHaveBeenCalledTimes(1);});
 it('clears private reports on account changes and cancels periodic reads',async()=>{vi.useFakeTimers();const read=vi.fn(async()=>report),s=new RouterState(read,vi.fn(),vi.fn());s.bind(context,'one');await s.load(context);expect(s.report).toBe(report);s.bind(context,'two');expect(s.report).toBeUndefined();await vi.advanceTimersByTimeAsync(20000);expect(read).toHaveBeenCalledTimes(1);s.close();});
 it('rejects a response for another device and never ignores expired authentication',async()=>{vi.useFakeTimers();const failed=vi.fn(),s=new RouterState(async()=>({...report,did:'other'}),vi.fn(),failed);s.bind(context,'a');await s.load(context);expect(s.error?.kind).toBe('protocol');expect(s.report).toBeUndefined();s.close();const r=new RouterState(async()=>{throw{kind:'authExpired',message:'expired',retryable:false};},vi.fn(),failed);r.bind(context,'a');await r.load(context);await vi.advanceTimersByTimeAsync(30000);expect(r.error?.kind).toBe('authExpired');expect(failed).toHaveBeenCalledTimes(2);r.close();});
 it('refreshes network status while open and stops polling when closed',async()=>{vi.useFakeTimers();const read=vi.fn(async()=>report),s=new RouterState(read,vi.fn(),vi.fn());s.bind(context,'account');await s.load(context);expect(read).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(10000);expect(read).toHaveBeenCalledTimes(2);s.close();await vi.advanceTimersByTimeAsync(30000);expect(read).toHaveBeenCalledTimes(2);});

});
