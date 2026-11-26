import {expect,it,vi} from 'vitest';
import {BathHeaterState,bathSelected,type BathHeaterReport} from './bath-heater';
const c={homeId:'fixture',generation:1,did:'fixture'},report:BathHeaterReport={did:'fixture',model:'yeelink.bhf_light.v13',lightOn:false,mode:'bh_off',gears:111,bathDelay:0,lightDelay:0,targetTemperature:25,revision:'baseline'};
it('projects the requested mode immediately and preserves it across old reads until explicitly adopted',async()=>{
 vi.useFakeTimers();try{const change=vi.fn(async()=>({report:{...report},confirmed:false})),read=vi.fn(async()=>({...report}));
 const state=new BathHeaterState({read,change},()=>{},()=>{});state.bind(c,'account');await state.read();const writing=state.change({operation:'mode',mode:'fastwarm',gear:0});expect(bathSelected(state.report,'fastwarm')).toBe(true);await writing;expect(state.actual?.mode).toBe('bh_off');expect(state.error).toBeUndefined();await vi.advanceTimersByTimeAsync(10000);expect(state.report?.mode).toBe('fastwarm');expect(change).toHaveBeenCalledTimes(1);expect(state.uncertain).toBe(true);state.adopt();expect(state.report?.mode).toBe('bh_off');state.close();}finally{vi.useRealTimers()}
});
it('discards late readings after account/device context changes',async()=>{
 let resolve!:(r:BathHeaterReport)=>void;const state=new BathHeaterState({read:()=>new Promise(r=>resolve=r),change:vi.fn()},()=>{},()=>{});
 state.bind(c,'account');const pending=state.read();state.bind({...c,did:'other'},'account');resolve(report);await pending;expect(state.report).toBeUndefined();state.close();
});
it('keeps gear selection specific to each active combined mode',()=>{
 const r={...report,mode:'warmwind|venting',gears:213};expect(bathSelected(r,'warmwind',2)).toBe(true);expect(bathSelected(r,'venting',3)).toBe(true);expect(bathSelected(r,'coolwind',1)).toBe(false);
});
