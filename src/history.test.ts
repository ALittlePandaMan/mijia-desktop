import { expect, it } from 'vitest';
import { calendarDates, dateKey, historyDetailSlots, historyExtremes, historySlots, parseDateKey, selectableDate } from './history';
import type { HistoryChannel } from './types';
const end = new Date(2026, 9, 26, 18, 30).getTime() / 1000;
const channel = (points: HistoryChannel['points']): HistoryChannel => ({ name: 'temperature', unit: '℃', points, error: null, complete: true });
it('fills exactly 25 hourly slots while preserving missing values', () => {
  const slots = historySlots(undefined, end);
  expect(slots).toHaveLength(25); expect(slots.at(-1)!.time - slots[0].time).toBe(86400);
  expect(historyExtremes(slots)).toBeUndefined(); expect(slots.every(slot => slot.high === null)).toBe(true);
});
it('assigns gateway samples to the next hour without filling an incomplete current hour', () => {
  const slots = historySlots(channel([{ time: end - 3600, low: 28, high: 28, gateway: true }, { time: end, low: 29, high: 29, gateway: true }]), end);
  expect(slots.at(-1)!.high).toBe(28); expect(historyExtremes(slots)?.count).toBe(1);
});
it('keeps zero and negative readings and marks extremes of the high-value curve', () => {
  const slots = historySlots(channel([{ time: end - 7200, low: -9, high: -4, gateway: false }, { time: end - 3600, low: -2, high: 0, gateway: false }]), end);
  expect(historyExtremes(slots)).toEqual({ min: -4, max: 0, count: 2 });
  expect(slots.at(-2)!.high).toBe(0); expect(slots.at(-1)!.high).toBeNull();
});
it('merges actual samples per channel without carrying values across missing hours', () => {
  const slots = historySlots(channel([{ time: end - 3600, low: 12, high: 20, gateway: false }, { time: end - 3500, low: 10, high: 22, gateway: false }, { time: end - 3500, low: NaN, high: 99, gateway: false }]), end);
  expect(slots.at(-2)).toMatchObject({ low: 10, high: 22 }); expect(slots.at(-1)!.high).toBeNull();
});
it('historical day starts at local midnight and keeps both daily boundaries',()=>{
  const slots=historyDetailSlots(undefined,{period:'day',date:'2026-10-25'},end);
  expect(slots).toHaveLength(25);expect(dateKey(new Date(slots[0].time*1000))).toBe('2026-10-25');
  expect(new Date(slots[0].time*1000).getHours()).toBe(0);expect(dateKey(new Date(slots.at(-1)!.time*1000))).toBe('2026-10-26');
});
it('month aggregates gateway hours at the following boundary and retains signed low/high',()=>{
  const time=new Date(2024,1,1,0,15).getTime()/1000;
  const data=channel([{time:time-1800,low:-3,high:-3,gateway:true},{time,low:-1,high:0,gateway:false},{time:time+86400,low:4,high:8,gateway:false}]);
  const slots=historyDetailSlots(data,{period:'month',date:'2024-02-01'},end,{start:time-2700,end:time+2*86400});
  expect(slots).toHaveLength(29);expect(slots[0]).toMatchObject({low:-3,high:0});expect(slots[1]).toMatchObject({low:4,high:8});expect(slots[2].high).toBeNull();
});
it('year keeps twelve months and does not turn a six-month query into fabricated earlier records',()=>{
  const time=new Date(2026,9,26,15).getTime()/1000;
  const slots=historyDetailSlots(channel([{time,low:20,high:28,gateway:false}]),{period:'year',date:'2026-10-26'},end);
  expect(slots).toHaveLength(12);expect(slots[9]).toMatchObject({low:20,high:28});expect(slots.filter(slot=>slot.high===null)).toHaveLength(11);
});
it('calendar validates leap dates and disables future/expired selection while allowing the boundary month',()=>{
  const today=new Date(2026,9,26);
  expect(dateKey(parseDateKey('2024-02-29'))).toBe('2024-02-29');
  for(const text of ['2026-02-29','2026-2-01','2026-10-26Z'])expect(()=>parseDateKey(text)).toThrow();
  expect(selectableDate(new Date(2025,9,25),'day',today)).toBe(false);
  expect(selectableDate(new Date(2025,9,26),'day',today)).toBe(true);
  expect(selectableDate(new Date(2025,9,1),'month',today)).toBe(true);
  expect(selectableDate(new Date(2026,9,27),'day',today)).toBe(false);
  expect(selectableDate(new Date(2026,10,1),'month',today)).toBe(false);
  const cells=calendarDates(new Date(2026,9,1));expect(cells).toHaveLength(35);expect(cells[0].getDay()).toBe(0);expect(dateKey(cells.at(-1)!)).toBe('2026-10-31');
});
