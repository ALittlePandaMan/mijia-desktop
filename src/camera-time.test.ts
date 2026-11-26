import {describe,it,expect} from 'vitest';
import {cameraDate,cameraDayStart,cameraHour} from './camera-time';
const seconds=(value:string)=>Date.parse(value)/1000;
describe('camera UTC+8 calendar matches native event ranges',()=>{
 it('changes date at 16:00 UTC rather than the host midnight',()=>{
  expect(cameraDate(seconds('2026-11-05T15:59:59Z'))).toBe('2026-11-05');
  expect(cameraDate(seconds('2026-11-05T16:00:00Z'))).toBe('2026-11-06');
 });
 it('uses the exact native day start across years',()=>{
  expect(cameraDayStart('2027-01-01')).toBe(seconds('2026-12-31T16:00:00Z'));
  expect(cameraDate(cameraDayStart('2027-01-01')-1)).toBe('2026-12-31');
 });
 it('keeps leap-day navigation independent of daylight saving and host timezone',()=>{
  expect(cameraDate(cameraDayStart('2024-02-28')+86400)).toBe('2024-02-29');
  expect(cameraDate(cameraDayStart('2024-02-29')+86400)).toBe('2024-03-01');
 });
 it('groups album hours in the same timezone as their date',()=>{
  expect(cameraHour(seconds('2026-11-05T16:30:00Z'))).toBe(0);
  expect(cameraHour(seconds('2026-11-05T15:59:59Z'))).toBe(23);
 });
});
