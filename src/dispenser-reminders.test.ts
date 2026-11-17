import {describe,it,expect,vi} from 'vitest';
import {DispenserReminders,reminderDraftError,reminderMatches,type ReminderDraft,type ReminderReport,type ReminderResult,type ReminderChange} from './dispenser-reminders';
const c={homeId:'home',generation:1,did:'fixture'};
const point:ReminderDraft={kind:'point',time:'18:00',repeat:'everyDay',weekdays:[]};
const report=():ReminderReport=>({did:c.did,fetchedAt:1,revision:'first',cycle:60,cycleCanEdit:true,cycleReason:null,cleanFinish:{value:true,source:'cloud',canEdit:true,reason:null},lackWater:{value:false,source:'cloud',canEdit:true,reason:null},reminders:[{key:'old',enabled:true,draft:structuredClone(point)}],canEditSchedules:true,scheduleReason:null,active:{enabled:false,intervalHours:0,orphaned:false,canStop:false},warnings:[]});
const result=(r:ReminderReport,verified=true):ReminderResult=>({verified,report:r,message:'read back'});
const deferred=<T>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
const tick=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
describe('gxj reminders: real targets and async ownership',()=>{
 it('sends once, snapshots the draft and keeps the current state while pending',async()=>{
  const wait=deferred<ReminderResult>(),save=vi.fn((_c:typeof c,_change:ReminderChange)=>wait.promise),s=new DispenserReminders({read:async()=>report(),save},()=>{},()=>{});s.bind(c,'a');await s.read(c);
  const draft=structuredClone(point),p=s.save(c,{operation:'save',key:null,draft});draft.time='19:00';expect(s.pending).toBe(true);expect(s.report?.reminders).toHaveLength(1);expect(await s.save(c,{operation:'cycle',value:15})).toBe(false);
  const next=report();next.reminders.push({key:'new',enabled:true,draft:structuredClone(point)});wait.resolve(result(next));expect(await p).toBe(true);expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][1]).toMatchObject({revision:'first',draft:{time:'18:00'}});expect(s.blocked).toBe(false);s.close();
 });
 it('does not confirm a new reminder using an already existing identical row',()=>{
  const before=report(),change={operation:'save' as const,key:null,draft:point};expect(reminderMatches(report(),change,before)).toBe(false);const next=report();next.reminders.push({key:'new',enabled:true,draft:point});expect(reminderMatches(next,change,before)).toBe(true);next.reminders.push({key:'another',enabled:true,draft:point});expect(reminderMatches(next,change,before)).toBe(false);
 });
 it('projects reversible values, retains uncertainty across same-context reopen and adopts without replaying',async()=>{const save=vi.fn(async()=>result(report())),s=new DispenserReminders({read:async()=>report(),save},()=>{},()=>{});s.bind(c,'a');await s.read(c);expect(await s.save(c,{operation:'cycle',value:15})).toBe(true);expect(s.report?.cycle).toBe(15);await tick();expect(s.uncertain).toBe(true);s.close();s.bind(c,'a');expect(s.report?.cycle).toBe(15);s.adopt();expect(s.report?.cycle).toBe(60);expect(save).toHaveBeenCalledOnce();s.close();});
 it('does not clear an uncertain operation using an unread or malformed category',async()=>{
  let value=report();const s=new DispenserReminders({read:async()=>value,save:async()=>result(report(),false)},()=>{},()=>{});s.bind(c,'a');await s.read(c);await s.save(c,{operation:'delete',key:'old'});value={...report(),canEditSchedules:false,warnings:['ambiguous scene']};await s.read(c);expect(s.blocked).toBe(true);expect(reminderMatches({...value,reminders:[]},{operation:'delete',key:'old'},report())).toBe(false);s.close();
 });
 it('does not backfill an old account or household after a late write',async()=>{
  const wait=deferred<ReminderResult>(),s=new DispenserReminders({read:async()=>report(),save:()=>wait.promise},()=>{},()=>{});s.bind(c,'a');await s.read(c);const p=s.save(c,{operation:'cycle',value:15});await tick();s.bind({...c,homeId:'other',generation:2},'b');wait.resolve(result({...report(),cycle:15}));expect(await p).toBe(true);await tick();expect(s.report).toBeUndefined();expect(s.opening.waiting).toBe(false);expect(s.blocked).toBe(false);s.close();
 });
 it('rejects late reads and reports for a different device',async()=>{
  const wait=deferred<ReminderReport>(),failed=vi.fn(),s=new DispenserReminders({read:()=>wait.promise,save:async()=>result({...report(),did:'wrong'})},()=>{},failed);s.bind(c,'a');const p=s.read(c);s.bind({...c,did:'other'},'a');wait.resolve(report());await p;expect(s.report).toBeUndefined();s.bind(c,'a');await s.read(c);expect(await s.save(c,{operation:'cycle',value:15})).toBe(true);await tick();expect(s.report?.did).toBe(c.did);expect(s.uncertain).toBe(true);expect(failed).toHaveBeenCalled();s.close();
 });
 it('requires explicit recurrence, valid custom days and a complete period without poisoning a later valid draft',async()=>{
  expect(reminderDraftError({kind:'point',repeat:'notSelected',time:'',weekdays:[]})).toContain('重复');expect(reminderDraftError({kind:'point',repeat:'custom',time:'18:00',weekdays:[]})).toContain('星期');expect(reminderDraftError({kind:'period',startTime:'22:00',endTime:'08:00',intervalHours:.5})).toBeUndefined();expect(reminderDraftError({kind:'period',startTime:'08:00',endTime:'08:15',intervalHours:.5})).toContain('间隔');
  const save=vi.fn(async()=>result({...report(),reminders:[{key:'old',enabled:true,draft:point}]})),s=new DispenserReminders({read:async()=>report(),save},()=>{},()=>{});s.bind(c,'a');await s.read(c);expect(await s.save(c,{operation:'save',key:null,draft:{kind:'point',repeat:'notSelected',time:'',weekdays:[]}})).toBe(false);expect(save).not.toHaveBeenCalled();expect(s.error).toBeUndefined();expect(await s.save(c,{operation:'save',key:'old',draft:point})).toBe(true);s.close();
 });
 it('requires the exact target for toggles, deletes, push settings and device stop',()=>{
  const r=report();expect(reminderMatches(r,{operation:'toggle',key:'old',enabled:false},r)).toBe(false);expect(reminderMatches(r,{operation:'delete',key:'old'},r)).toBe(false);expect(reminderMatches({...r,cleanFinish:{...r.cleanFinish,source:'vendorDefault'}},{operation:'push',field:'cleanFinish',enabled:true},r)).toBe(false);expect(reminderMatches({...r,active:{...r.active,enabled:null}},{operation:'stopActive'},r)).toBe(false);
  const custom:ReminderDraft={kind:'point',time:'18:00',repeat:'custom',weekdays:[5,1]};expect(reminderMatches({...r,reminders:[{key:'old',enabled:true,draft:{...custom,weekdays:[1,5]}}]},{operation:'save',key:'old',draft:custom},r)).toBe(true);
 });
});
