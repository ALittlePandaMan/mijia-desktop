import {describe,it,expect,vi} from 'vitest';
import {DispenserDnd,dndMatches,type DispenserDndReport,type DispenserDndChange} from './dispenser-dnd';
const c={homeId:'offline',generation:1,did:'dispenser-fixture'},report=():DispenserDndReport=>({did:c.did,fetchedAt:0,current:false,enabled:false,allDay:true,startTime:'22:00',endTime:'05:00',revision:'fixture',canEdit:true,reason:null,warnings:[]});
describe('gxj DND controller',()=>{
 it('preserves the real disabled timer times while enabling native all-day mode',async()=>{
  const save=vi.fn(async(_c:typeof c,change:DispenserDndChange)=>({verified:true,message:'read back',report:{...report(),...change,current:change.enabled&&change.allDay}}));const state=new DispenserDnd({read:async()=>report(),save},()=>{},()=>{});state.bind(c,'a');await state.read(c);const before=state.operationVersion;expect(await state.save(c,{enabled:true,allDay:true})).toBe(true);expect(state.operationVersion).toBeGreaterThan(before);for(let i=0;i<40;i++)await Promise.resolve();expect(save.mock.calls[0][1]).toMatchObject({startTime:'22:00',endTime:'05:00',allDay:true});state.close();
 });
 it('never treats the cloud timer alone as confirmed device state',()=>{const change:DispenserDndChange={revision:'x',enabled:true,allDay:false,startTime:'22:00',endTime:'05:00'};expect(dndMatches({...report(),enabled:true,allDay:false,current:true},change)).toBe(false);expect(dndMatches({...report(),enabled:true,allDay:false,current:false},change)).toBe(true);});
 it('keeps same-context local schedule on reopen and isolates a new account',async()=>{
  const state=new DispenserDnd({read:async()=>report(),save:async()=>({verified:false,message:'pending',report:report()})},()=>{},()=>{});state.bind(c,'old');await state.read(c);await state.save(c,{enabled:true,allDay:true});for(let i=0;i<40;i++)await Promise.resolve();state.close();state.bind(c,'old');expect(state.report?.enabled).toBe(true);state.bind(c,'new');expect(state.report).toBeUndefined();expect(state.pending).toBe(false);state.close();
 });
});
