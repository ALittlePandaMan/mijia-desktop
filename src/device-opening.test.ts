import {afterEach,describe,expect,it,vi} from 'vitest';
import {DeviceOpening} from './device-opening';
afterEach(()=>vi.useRealTimers());
describe('device opening without loading flashes',()=>{
 it('quick cached/metadata results never expose a loading surface',()=>{
  vi.useFakeTimers();const changed=vi.fn(),state=new DeviceOpening(changed);state.begin();expect(state.hidden).toBe(true);vi.advanceTimersByTime(70);state.ready();expect(state.waiting).toBe(false);expect(state.showing).toBe(false);vi.advanceTimersByTime(500);expect(changed).toHaveBeenCalledTimes(1);
 });
 it('a visible loader remains for a readable interval instead of flashing for one frame',()=>{
  vi.useFakeTimers();const state=new DeviceOpening(()=>{});state.begin();vi.advanceTimersByTime(140);expect(state.showing).toBe(true);state.ready();vi.advanceTimersByTime(179);expect(state.showing).toBe(true);vi.advanceTimersByTime(1);expect(state.waiting).toBe(false);
 });
 it('closing or switching device prevents old show/finish timers reopening it',()=>{
  vi.useFakeTimers();const changed=vi.fn(),state=new DeviceOpening(changed);state.begin();vi.advanceTimersByTime(140);state.ready();state.cancel();state.begin();vi.advanceTimersByTime(100);expect(state.hidden).toBe(true);expect(changed).toHaveBeenCalledTimes(1);state.cancel();vi.advanceTimersByTime(1000);expect(state.showing).toBe(false);expect(changed).toHaveBeenCalledTimes(1);
 });
 it('a truly slow request shows the loader and exposes ready content immediately after its minimum interval',()=>{
  vi.useFakeTimers();const state=new DeviceOpening(()=>{});state.begin();vi.advanceTimersByTime(2000);expect(state.showing).toBe(true);state.ready();expect(state.waiting).toBe(false);
 });
});
