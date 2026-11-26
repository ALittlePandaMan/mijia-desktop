import {describe,it,expect} from 'vitest';
import {careDateLabel} from './camera-care';
describe('care date label',()=>{
 it('uses the same UTC+8 day boundary as native queries',()=>{
  const now=Date.parse('2026-11-05T16:05:00Z');expect(careDateLabel('2026-11-06',now)).toBe('11月6日 | 今天');expect(careDateLabel('2026-11-05',now)).toBe('11月5日 | 昨天');expect(careDateLabel('2026-11-04',now)).toBe('11月4日');expect(careDateLabel('2025-11-04',now)).toBe('11月4日 | 2025年');
 });
});
