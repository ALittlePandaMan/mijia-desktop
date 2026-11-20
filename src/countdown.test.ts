import {describe,expect,it} from 'vitest';
import {countdownDuration,countdownReason,countdownReport,countdownToggle,countdownUpdate,durationProblem} from './countdown';
import type {CountdownChangeResult,CountdownView,TimerReport} from './types';

const view=(extra:Partial<CountdownView>={}):CountdownView=>({on:false,key:null,writeReason:null,active:false,dueAt:null,hours:0,minutes:5,durationSource:'default',...extra});
const report=(item=view(),extra:Partial<TimerReport>={}):TimerReport=>({did:'test-device',model:'cuco.plug.v3',fetchedAt:1000,entries:[],countdowns:[item],unsupportedCount:0,warnings:[],writeReason:null,...extra});

describe('countdown scene command preconditions and readback',()=>{
  it('active scenes display remaining rounded minutes rather than an old saved preference',()=>{
    expect(countdownDuration(view({active:true,dueAt:4601,hours:0,minutes:5}),1000)).toEqual({hours:1,minutes:1});
    expect(countdownDuration(view({active:true,dueAt:4599}),1000)).toEqual({hours:1,minutes:0});
    expect(countdownDuration(view({active:true,dueAt:999}),1000)).toBeUndefined();
    expect(countdownDuration(view({hours:2,minutes:10}),1000)).toEqual({hours:2,minutes:10});
  });
  it('never creates a schedule from unknown state, permissions or unknown duration',()=>{
    for(const data of [undefined,report(view({active:null})),report(view({writeReason:'记录无法修改'})),report(view(),{writeReason:'无权限'}),report(view({hours:null,minutes:null}))]) {
      expect(()=>countdownToggle(data,false,1000)).toThrow();
    }
  });
  it('uses the actual direction and stored/default duration without inventing a scene key',()=>{
    expect(countdownToggle(report(),false,1000)).toEqual({operation:'set',on:false,key:null,hours:0,minutes:5});
    expect(countdownToggle(report(view({on:true,hours:2,minutes:12,durationSource:'stored'})),true,1000)).toEqual({operation:'set',on:true,key:null,hours:2,minutes:12});
  });
  it('cancels only the active opaque scene key even if duration preferences are unavailable',()=>{
    expect(countdownToggle(report(view({key:'opaque-scene',active:true,dueAt:2000,hours:null,minutes:null})),false,1000)).toEqual({operation:'cancel',on:false,key:'opaque-scene'});
  });
  it('rejects expired, malformed or superseded active scenes rather than editing another record',()=>{
    expect(countdownReason(report(),view({active:true,key:'old',dueAt:999}),1000)).toContain('到期');
    expect(()=>countdownToggle(report(view({active:true,key:null,dueAt:2000})),false,1000)).toThrow();
    const draft={on:false,key:'old',hours:1,minutes:0};
    expect(()=>countdownUpdate(report(view({active:true,key:'new',dueAt:2000})),draft,1000)).toThrow();
    expect(()=>countdownUpdate(report(),draft,1000)).toThrow();
  });
  it('zero, negative, fractional and out-of-range times never become valid commands',()=>{
    for(const [hours,minutes] of [[0,0],[-1,3],[24,0],[0,60],[0,1.5]])expect(durationProblem(hours,minutes)).toBeTruthy();
    expect(durationProblem(0,1)).toBeUndefined();expect(durationProblem(23,59)).toBeUndefined();
    const data=report(view({active:true,key:'current',dueAt:2000}));
    expect(()=>countdownUpdate(data,{on:false,key:'current',hours:0,minutes:0},1000)).toThrow();
    expect(countdownUpdate(data,{on:false,key:'current',hours:23,minutes:59},1000)).toEqual({operation:'set',on:false,key:'current',hours:23,minutes:59});
  });
  it('keeps a confirmed scene when duration preference readback failed',()=>{
    const data=report(view({active:true,key:'current',dueAt:2000}));
    const result:CountdownChangeResult={sceneVerified:true,preferencesVerified:false,message:'场景已确认，偏好未确认',report:data};
    expect(countdownReport(result,data.did,data.model)).toBe(data);
  });
  it('an accepted but unconfirmed scene cannot be presented as successful',()=>{
    const data=report();
    expect(()=>countdownReport({sceneVerified:false,preferencesVerified:null,message:'尚未确认，请查询',report:data},data.did,data.model)).toThrow();
  });
  it('rejects missing reports, other device IDs and other models despite a success flag',()=>{
    for(const data of [null,report(view(),{did:'other'}),report(view(),{model:'other'})]) {
      expect(()=>countdownReport({sceneVerified:true,preferencesVerified:true,message:'confirmed',report:data},'test-device','cuco.plug.v3')).toThrow();
    }
  });
});
