import {describe,expect,it} from 'vitest';
import {CameraReplayBuffer,replayBufferedAhead} from './camera-replay-buffer';

function viewAt(currentTime:number,ranges:[number,number][]) {
 return {currentTime,buffered:{length:ranges.length,start:(i:number)=>ranges[i][0],end:(i:number)=>ranges[i][1]}};
}

describe('SD replay buffering',()=>{
 it('counts only playable data before a gap',()=>{
  const ranges:[number,number][]=[[0,2],[8,18]];
  expect(replayBufferedAhead(viewAt(1.5,ranges))).toBe(.5);
  expect(replayBufferedAhead(viewAt(4,ranges))).toBe(0);
  expect(replayBufferedAhead(viewAt(9,ranges))).toBe(9);
 });
 it('keeps the forward limit and refills after usable data drains',()=>{
  const buffer=new CameraReplayBuffer();
  expect(buffer.append({state:'media',timestamp:1000},0)).toBe(true);
  expect(buffer.append({state:'media',timestamp:25000},0)).toBe(true);
  expect(buffer.append({state:'media',timestamp:26000},0)).toBe(false);
  expect(buffer.needsRefill(viewAt(18,[[0,24]]))).toBe(false);
  expect(buffer.needsRefill(viewAt(22,[[0,24]]))).toBe(true);
  expect(buffer.needsRefill(viewAt(20,[]),true)).toBe(false);
  expect(buffer.needsRefill(viewAt(22,[]),true)).toBe(true);
 });
 it('starts timing again after playback advances or resumes after a pause',()=>{
  const buffer=new CameraReplayBuffer();
  expect(buffer.stalled(2,0)).toBe(false);
  expect(buffer.stalled(2,5900)).toBe(false);
  expect(buffer.stalled(3,6000)).toBe(false);
  expect(buffer.stalled(3,12000)).toBe(true);
  buffer.resetProgress();
  expect(buffer.stalled(3,30000)).toBe(false);
 });
});
