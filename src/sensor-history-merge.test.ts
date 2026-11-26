import {describe,expect,it} from 'vitest';
import {historyExtremes,historySlots,sensorHistorySlots,historySlotDescription} from './history';
import type {HistoryChannel,HistoryPoint,SensorHistory} from './types';
const end=new Date(2026,10,4,12,30).getTime()/1000;
const hour=new Date(2026,10,4,12).getTime()/1000;
const point=(time:number,value:number):HistoryPoint=>({time,low:value,high:value,gateway:false,source:'miotProperty',bucketTime:time,state:'measured'});
const channel=(name:HistoryChannel['name'],points:HistoryPoint[],complete=true):HistoryChannel=>({name,unit:name==='temperature'?'℃':'%',points,complete,error:null,completeness:complete?'complete':'partial'});
const history=(temperature:HistoryChannel,humidity:HistoryChannel):SensorHistory=>({did:'fixture',model:'published-contract',fetchedAt:end,start:end-30*3600,end,channels:[temperature,humidity],warnings:[]});

describe('hourly sensor display carries prior observations with source provenance',()=>{
 it('uses a verified bucket timestamp once, independently of the legacy gateway flag',()=>{
  const p={...point(hour-1800,24),bucketTime:hour,gateway:true};
  const slots=historySlots(channel('temperature',[p]),end);
  expect(slots.at(-1)).toMatchObject({high:24,origin:'measured',sourceTime:hour-1800});
  expect(historyExtremes(slots)?.count).toBe(1);
 });
 it('carries across consecutive wholly missing hours and keeps the original source time',()=>{
  const data=history(channel('temperature',[point(hour-3*3600,0),point(hour,2)]),channel('humidity',[point(hour-3*3600,50),point(hour-2*3600,51),point(hour,52)]));
  const untouched=structuredClone(data),slots=sensorHistorySlots(data);
  expect(slots.temperature.at(-3)).toMatchObject({high:0,origin:'carried',sourceTime:hour-3*3600});
  expect(slots.temperature.at(-2)).toMatchObject({high:0,origin:"carried",sourceTime:hour-3*3600});
  expect(slots.humidity.at(-2)).toMatchObject({high:51,origin:"carried",sourceTime:hour-2*3600});
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
  expect(slots.temperature[1]).toMatchObject({high:-1,origin:"carried",sourceTime:earlier});
  expect(historyExtremes(slots.temperature)?.count).toBe(0);
 });
 it('can display available earlier observations even when a source is partial or failed',()=>{
  for(const failed of [channel('temperature',[point(hour-3600,20)],false),{...channel('temperature',[point(hour-3600,20)]),error:'读取失败'}]){
   const slots=sensorHistorySlots(history(failed,channel('humidity',[point(hour,40)])));
   expect(slots.temperature.at(-1)).toMatchObject({high:20,origin:"carried",sourceTime:hour-3600});
  }
 });
 it('merges duplicate and unordered measurements without dropping independent channels',()=>{
  const data=history(channel('temperature',[point(hour,21),point(hour-3600,20),point(hour,22)]),channel('humidity',[point(hour-7200,60)]));
  const slots=sensorHistorySlots(data);
  expect(slots.temperature.at(-1)).toMatchObject({low:21,high:22,origin:'measured'});
  expect(slots.humidity.at(-3)).toMatchObject({high:60,origin:'measured'});
 });
});

it('fills one channel independently, including trailing hours, without creating an absent channel',()=>{
 const data=history(channel('temperature',[point(hour-3*3600,18)]),channel('humidity',[]));data.channels=data.channels.slice(0,1);
 const result=sensorHistorySlots(data);
  expect(result.temperature.slice(-3).map(s=>s.high)).toEqual([18,18,18]);
  expect(result.temperature.slice(-3).every(s=>s.origin==='carried'&&s.sourceTime===hour-3*3600)).toBe(true);
  expect(result.humidity.every(s=>s.high===null)).toBe(true);
  expect(result.temperature[0].high).toBeNull();
});
