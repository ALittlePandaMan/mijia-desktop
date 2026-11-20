import {expect,it} from 'vitest';
import {countdownText,durationText,timersSupported,timerDraft,timerDraftProblem,repeatText,timerTimeSubtitle} from './timers';
import type {CountdownView,Device,DevicePanel,TimerEntry} from './types';
const view=(extra:Partial<CountdownView>={}):CountdownView=>({on:false,key:null,writeReason:null,active:false,dueAt:null,hours:0,minutes:5,durationSource:'default',...extra});
it('missing state and default preferences are distinct from a disabled timer with stored duration',()=>{
  expect(countdownText(undefined)).toBe('未读取');expect(countdownText(view({active:null}))).toBe('状态未知');
  expect(countdownText(view())).toBe('未启用');expect(durationText(view())).toBe('5分钟（默认）');
  expect(durationText(view({durationSource:'stored'}))).toBe('5分钟');expect(durationText(view({hours:null,minutes:null,durationSource:'unknown'}))).toBe('未读取');
});
it('remaining countdown rounds up and expired cloud records require another read',()=>{
  expect(countdownText(view({active:true,dueAt:4601}),1000)).toBe('1小时1分钟后关闭');
  expect(countdownText(view({active:true,dueAt:4600,on:true}),1000)).toBe('1小时后开启');
  expect(countdownText(view({active:true,dueAt:999}),1000)).toBe('已到期，待重新读取');
});
it('a timer adapter requires the observed model and one unambiguous actual switch binding',()=>{
  const device:Device={did:'a',model:'cuco.plug.v3',name:'outlet',online:true,roomId:'r',roomName:'room'};
  const panel:DevicePanel={did:'a',model:device.model,specType:'urn:miot-spec-v2:device:outlet:0000A002:vendor:1',services:[{siid:17,name:'switch',description:'power',actions:[],properties:[{siid:17,piid:9,name:'on',description:'power',format:'bool',access:['read','write']}]}]};
  expect(timersSupported(device,panel)).toBe(true);
  for(const invalid of [{...panel,did:'b'},{...panel,model:'other'},{...panel,specType:'urn:miot-spec-v2:device:light:x'},{...panel,services:[...panel.services,...panel.services]}])expect(timersSupported(device,invalid)).toBe(false);
  expect(timersSupported({...device,controlServiceId:17},panel)).toBe(false);
});
it('period drafts require both clocks and keep disabled existing schedules disabled',()=>{
 const draft=timerDraft(undefined,'period');expect(timerDraftProblem(draft)).toBeTruthy();draft.onTime='23:30';expect(timerDraftProblem(draft)).toBeTruthy();draft.offTime='01:00';expect(timerDraftProblem(draft)).toBeUndefined();draft.offTime='23:30';expect(timerDraftProblem(draft)).toBeTruthy();
 const entry:TimerEntry={key:'opaque',on:false,enabled:false,time:'06:00',repeat:'每天',dueAt:null,endTime:null,weekdays:[0,1,2,3,4,5,6],editReason:null};expect(timerDraft(entry).enabled).toBe(false);expect(timerDraft(entry).offTime).toBe('06:00');
});
it('custom weekdays distinguish a single day from daily and invalid duplicates',()=>{
 expect(repeatText([])).toBe('执行一次');expect(repeatText([0,1,2,3,4,5,6])).toBe('每天');expect(repeatText([0,1])).toBe('周一、周日');
 const draft=timerDraft(undefined,'off');draft.offTime='06:00';draft.weekdays=[1,1];expect(timerDraftProblem(draft)).toBeTruthy();draft.weekdays=[1.5];expect(timerDraftProblem(draft)).toBeTruthy();
});
it('one-shot clock subtitles account for Beijing midnight and the second period day',()=>{
 const draft=timerDraft(undefined,'period');draft.onTime='23:30';draft.offTime='01:00';const now=Date.UTC(2026,11,31,15,40);
 expect(timerTimeSubtitle(draft,true,23,30,now)).toBe('明天 23:30');expect(timerTimeSubtitle(draft,false,1,0,now)).toBe('后天 01:00');draft.weekdays=[6];expect(timerTimeSubtitle(draft,false,1,0,now)).toBe('01:00');
});
