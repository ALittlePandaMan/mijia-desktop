import { expect, it } from 'vitest';
import { calendarDates, dateKey, historyExtremes, historySlots, parseDateKey, selectableDate } from './history';
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
