import {expect,it,vi} from 'vitest';
import {CeilingFanState,type CeilingFanReport} from './ceiling-fan';
const c={homeId:'fixture',generation:1,did:'fixture'},report:CeilingFanReport={did:'fixture',model:'yeelink.ven_fan.vf3',lightOn:false,fanOn:false,gear:0,swingAction:'stop',swingAngle:0,brightness:75,lightMode:'daylight',revision:'baseline'};
it('updates local fan and gear without replacing the raw baseline or rolling back on old readings',async()=>{
 vi.useFakeTimers();try{const read=vi.fn(async()=>({...report})),change=vi.fn(async()=>({report:{...report},confirmed:false}));const s=new CeilingFanState({read,change},()=>{},()=>{});s.bind(c,'account');await s.read();const task=s.change({operation:'fan',on:true,gear:1});expect(s.report?.fanOn).toBe(true);expect(s.report?.gear).toBe(1);await task;expect(s.actual?.fanOn).toBe(false);await vi.advanceTimersByTimeAsync(10000);expect(s.report?.fanOn).toBe(true);expect(change).toHaveBeenCalledTimes(1);s.adopt();expect(s.report?.fanOn).toBe(false);s.close();}finally{vi.useRealTimers()}
});
it('discards late readings when the home or account binding changes',async()=>{
 let resolve!:(r:CeilingFanReport)=>void;const s=new CeilingFanState({read:()=>new Promise(r=>resolve=r),change:vi.fn()},()=>{},()=>{});s.bind(c,'account');const pending=s.read();s.bind({...c,homeId:'another-home'},'another-account');resolve(report);await pending;expect(s.report).toBeUndefined();s.close();
});
it('rejects cross-device or malformed reports before exposing controls',async()=>{
 for(const bad of[{...report,did:'another'},{...report,gear:3},{...report,swingAngle:181},{...report,brightness:0}]){const s=new CeilingFanState({read:async()=>bad as CeilingFanReport,change:vi.fn()},()=>{},()=>{});s.bind(c,'account');await s.read();expect(s.report).toBeUndefined();expect(s.error).toBeDefined();s.close();}
});
