import { describe,expect,it } from 'vitest';
import { flowSpeed,flowSpeedPosition,LightSettingsOperation,settingsChange,settingsDraft,settingsMatch,settingsSlot } from './light-settings';
import type { LightSettingsChange,LightSettingsReport,LightSettingsResult } from './types';
const revision='ab'.repeat(32);
const report=():LightSettingsReport=>({did:'fixture',model:'yeelink.light.wyra01',fetchedAt:1,writeReason:null,slots:Array.from({length:4},(_,index)=>({index,brightness:100,color:0xff0000,temperaturePercent:50,tab:'color',revision,reason:null})),flowSlots:Array.from({length:4},(_,index)=>({index,brightness:100,color:0xff0000,temperaturePercent:null,tab:'color',revision,reason:null})),speed:{value:50,reason:null}});
const change:LightSettingsChange={operation:'saveMode',index:0,baseline:revision,brightness:30,color:0,temperaturePercent:20,tab:'temperature'};
function applied():LightSettingsReport{const r=report();Object.assign(r.slots[0],{brightness:30,color:0,temperaturePercent:20,tab:'temperature'});return r;}
const result=(status:LightSettingsResult['status'],r:LightSettingsReport|null=report()):LightSettingsResult=>({status,message:'fixture reason',report:r});
const pause=()=>new Promise<void>(()=>{});
describe('light settings draft and confirmation',()=>{
  it('loads real active and inactive fields without modifying the report',()=>{
    const r=report(),before=structuredClone(r);const draft=settingsDraft(r,'modes',0);expect(draft).toEqual({kind:'slot',index:0,baseline:revision,brightness:100,color:0xff0000,temperaturePercent:50,tab:'color'});expect(r).toEqual(before);
  });
  it('rejects unconfirmed malformed duplicate and out-of-range slots',()=>{
    for(const edit of [{brightness:null},{color:NaN},{revision:'bad'},{temperaturePercent:101},{reason:'failed'}]){const r=report();Object.assign(r.slots[0],edit);expect(settingsSlot(r,'modes',0)).toBeUndefined();}
    const r=report();r.slots.push(r.slots[0]);expect(settingsSlot(r,'modes',0)).toBeUndefined();expect(()=>settingsDraft(undefined,'modes',0)).toThrow();
  });
  it('preserves valid zero brightness and black and blocks zero flow brightness',()=>{
    const draft={...settingsDraft(report(),'modes',0),brightness:0,color:0};expect(settingsChange('modes',draft)).toMatchObject({brightness:0,color:0});expect(()=>settingsChange('flow',draft)).toThrow();
  });
  it('serializes only typed changes and retains the slot revision',()=>{
    expect(settingsChange('modes',{kind:'slot',index:0,baseline:revision,brightness:30,color:0,temperaturePercent:20,tab:'temperature'})).toEqual(change);
    expect(settingsChange('flow',settingsDraft(report(),'flow',1))).toEqual({operation:'saveFlow',index:1,baseline:revision,brightness:100,color:0xff0000});
  });
  it('keeps speed zero/one visible without inventing an editable saved value',()=>{
    const r=report();r.speed.value=0;expect(settingsDraft(r,'flow','speed')).toMatchObject({value:0,baseline:0});expect(()=>settingsChange('flow',settingsDraft(r,'flow','speed'))).toThrow();
    expect(flowSpeed(0)).toBe(2);expect(flowSpeed(100)).toBe(100);expect(flowSpeed(50)).toBe(51);expect(flowSpeedPosition(50)).toBe(48);expect(()=>flowSpeed(NaN)).toThrow();
  });
  it('requires the actual target fields before calling a result confirmed',()=>{
    expect(settingsMatch(applied(),change)).toBe(true);expect(settingsMatch(report(),change)).toBe(false);const r=applied();r.slots[0].reason='failed';expect(settingsMatch(r,change)).toBe(false);
  });
  it('sends once even when start is called repeatedly',async()=>{
    let writes=0,queries=0;const op=new LightSettingsOperation(change,report(),async()=>{writes++;return result('confirmed',applied());},async()=>{queries++;return result('uncertain');},()=>{},pause);
    await Promise.all([op.start(),op.start()]);expect(writes).toBe(1);expect(queries).toBe(0);expect(op.phase).toBe('confirmed');
  });
  it('ignores transport success without matching direct readback',async()=>{
    const op=new LightSettingsOperation(change,report(),async()=>result('confirmed',report()),async()=>result('uncertain'),()=>{},async()=>{});await op.start();expect(op.phase).toBe('uncertain');
  });
  it('network timeout queries without resending and later confirms',async()=>{
    let writes=0,queries=0;const op=new LightSettingsOperation(change,report(),async()=>{writes++;throw{kind:'network'};},async()=>{queries++;return result('confirmed',applied());},()=>{},async()=>{});await op.start();expect(op.phase).toBe('confirmed');expect([writes,queries]).toEqual([1,1]);
  });
  it('retains uncertain intent after bounded failed queries instead of declaring failure',async()=>{
    let queries=0;const op=new LightSettingsOperation(change,report(),async()=>result('uncertain'),async()=>{queries++;throw{kind:'offline'};},()=>{},async()=>{});await op.start();expect(queries).toBe(3);expect(op.pending).toBe(true);expect(op.phase).toBe('uncertain');
  });
  it('returns actual mixed fields and rejection rather than pretending an atomic rollback',async()=>{
    const mixed=report();mixed.slots[0].temperaturePercent=20;const op=new LightSettingsOperation(change,report(),async()=>result('rejected',mixed),async()=>{throw Error('Should not query');},()=>{},pause);await op.start();expect(op.phase).toBe('rejected');expect(op.report.slots[0].temperaturePercent).toBe(20);expect(op.report.slots[0].brightness).toBe(100);expect(op.error?.message).toBe('fixture reason');
  });
  it('a baseline conflict before submission result does not query or invent success',async()=>{
    let queries=0;const op=new LightSettingsOperation(change,report(),async()=>{throw{kind:'lightSettingsConflict',message:'conflict'};},async()=>{queries++;return result('uncertain');},()=>{},pause);await op.start();expect(op.phase).toBe('rejected');expect(queries).toBe(0);
  });
  it('cancellation ignores a late old account response',async()=>{
    let resolve!:(r:LightSettingsResult)=>void,changes=0;const op=new LightSettingsOperation(change,report(),()=>new Promise(done=>{resolve=done;}),async()=>result('uncertain'),()=>changes++,pause);const flight=op.start();op.cancel();resolve(result('confirmed',applied()));await flight;expect(op.phase).toBe('sending');expect(changes).toBe(1);
  });
  it('mismatched device report cannot confirm and does not replace current data',async()=>{
    const wrong=applied();wrong.did='other';const op=new LightSettingsOperation(change,report(),async()=>result('confirmed',wrong),async()=>result('uncertain',wrong),()=>{},async()=>{});await op.start();expect(op.phase).toBe('uncertain');expect(op.report.did).toBe('fixture');
  });
  it('query callers share one in-flight confirmation and mutable inputs cannot retarget the write',async()=>{
    let resolve!:(r:LightSettingsResult)=>void,queries=0;const local=structuredClone(change);const op=new LightSettingsOperation(local,report(),async()=>result('uncertain'),()=>{queries++;return new Promise(done=>{resolve=done;});},()=>{},pause);
    void op.start();await Promise.resolve();await Promise.resolve();local.brightness=99;const a=op.refresh(),b=op.refresh();resolve(result('confirmed',applied()));await Promise.all([a,b]);expect(queries).toBe(1);expect(op.change).toEqual(change);expect(op.phase).toBe('confirmed');
  });
});
