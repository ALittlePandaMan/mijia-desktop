import {afterEach,describe,expect,it} from 'vitest';
import {historyDetailSlots,historyExtremes,historySlots,sensorHistorySlots,historySlotDescription} from './history';
import type {HistoryChannel,HistoryPoint,SensorHistory} from './types';
const end=new Date(2026,10,4,12,30).getTime()/1000;
const hour=new Date(2026,10,4,12).getTime()/1000;
const point=(time:number,value:number):HistoryPoint=>({time,low:value,high:value,gateway:false,source:'miotProperty',bucketTime:time,state:'measured'});
const channel=(name:HistoryChannel['name'],points:HistoryPoint[],complete=true):HistoryChannel=>({name,unit:name==='temperature'?'℃':'%',points,complete,error:null,completeness:complete?'complete':'partial'});
const history=(temperature:HistoryChannel,humidity:HistoryChannel):SensorHistory=>({did:'fixture',model:'published-contract',fetchedAt:end,start:end-30*3600,end,referenceTime:end,selection:null,channels:[temperature,humidity],warnings:[]});
const testEnv=(globalThis as unknown as {process:{env:Record<string,string|undefined>}}).process.env;
const originalTz=testEnv.TZ;afterEach(()=>{if(originalTz===undefined)delete testEnv.TZ;else testEnv.TZ=originalTz;});

describe('hourly sensor display merges real observations without manufacturing history',()=>{
 it('uses a verified bucket timestamp once, independently of the legacy gateway flag',()=>{
  const p={...point(hour-1800,24),bucketTime:hour,gateway:true};
  const slots=historySlots(channel('temperature',[p]),end);
  expect(slots.at(-1)).toMatchObject({high:24,origin:'measured',sourceTime:hour-1800});
  expect(historyExtremes(slots)?.count).toBe(1);
 });
 it('carries only into an hour observed by the other channel and keeps the original source time',()=>{
  const data=history(channel('temperature',[point(hour-3*3600,0),point(hour,2)]),channel('humidity',[point(hour-3*3600,50),point(hour-2*3600,51),point(hour,52)]));
  const untouched=structuredClone(data),slots=sensorHistorySlots(data);
  expect(slots.temperature.at(-3)).toMatchObject({high:0,origin:'carried',sourceTime:hour-3*3600});
  expect(slots.temperature.at(-2)?.high).toBeNull();
  expect(slots.humidity.at(-2)?.high).toBeNull();
  expect(historyExtremes(slots.temperature)).toEqual({min:0,max:2,count:2});
  expect(historySlotDescription(slots.temperature.at(-3)!,'℃',1)).toBe('0.0℃');
  expect(data).toEqual(untouched);
 });
 it('never fills backwards, invents a first reading, or substitutes zero/negative observations',()=>{
  const slots=sensorHistorySlots(history(channel('temperature',[point(hour-3600,-2),point(hour,0)]),channel('humidity',[point(hour-7200,0),point(hour-3600,1),point(hour,2)])));
  expect(slots.temperature.at(-3)?.high).toBeNull();
  expect(slots.temperature.at(-2)).toMatchObject({high:-2,origin:'measured'});
  expect(slots.temperature.at(-1)).toMatchObject({high:0,origin:'measured'});
 });
 it('seeds the first visible hour from an earlier fetched observation, never the live property',()=>{
  const earlier=hour-25*3600,data=history(channel('temperature',[point(earlier,-1)]),channel('humidity',[point(hour-24*3600,50)]));
  const slots=sensorHistorySlots(data);
  expect(slots.temperature[0]).toMatchObject({high:-1,origin:'carried',sourceTime:earlier});
  expect(slots.temperature[1].high).toBeNull();
  expect(historyExtremes(slots.temperature)?.count).toBe(0);
 });
 it('does not carry across an incomplete or failed source',()=>{
  for(const failed of [channel('temperature',[point(hour-3600,20)],false),{...channel('temperature',[point(hour-3600,20)]),error:'读取失败'}]){
   const slots=sensorHistorySlots(history(failed,channel('humidity',[point(hour,40)])));
   expect(slots.temperature.at(-1)?.high).toBeNull();
  }
 });
 it('does not create monthly or yearly measurements from the other channel',()=>{
  const data=history(channel('temperature',[point(hour-86400,20)]),channel('humidity',[point(hour,40)]));
  const monthly=sensorHistorySlots(data,{period:'month',date:'2026-11-04'});
  expect(monthly.temperature.filter(s=>s.high!==null)).toHaveLength(1);
  expect(monthly.temperature.every(s=>s.origin!=='carried')).toBe(true);
 });
 it('merges duplicate and unordered measurements without dropping independent channels',()=>{
  const data=history(channel('temperature',[point(hour,21),point(hour-3600,20),point(hour,22)]),channel('humidity',[point(hour-7200,60)]));
  const slots=sensorHistorySlots(data);
  expect(slots.temperature.at(-1)).toMatchObject({low:21,high:22,origin:'measured'});
  expect(slots.humidity.at(-3)).toMatchObject({high:60,origin:'measured'});
 });
 it('keeps both occurrences of a repeated DST hour and the actual historical-day length',()=>{
  testEnv.TZ='America/New_York';
  const start=Date.parse('2026-11-01T00:00:00-04:00')/1000;
  const a=Date.parse('2026-11-01T01:00:00-04:00')/1000,b=Date.parse('2026-11-01T01:00:00-05:00')/1000;
  const slots=historyDetailSlots(channel('temperature',[point(a,1),point(b,2)]),{period:'day',date:'2026-11-01'},Date.parse('2026-11-04T12:00:00-05:00')/1000);
  expect(slots[0].time).toBe(start);expect(slots).toHaveLength(26);
  expect(slots.find(s=>s.time===a)?.high).toBe(1);expect(slots.find(s=>s.time===b)?.high).toBe(2);
 });
 it('uses the shorter spring DST day without extrapolating a phantom final hour',()=>{
  testEnv.TZ='America/New_York';
  const slots=historyDetailSlots(undefined,{period:'day',date:'2026-03-08'},Date.parse('2026-11-04T12:00:00-05:00')/1000);
  expect(slots).toHaveLength(24);expect(slots.at(-1)?.time).toBe(Date.parse('2026-03-09T00:00:00-04:00')/1000);
 });
});
