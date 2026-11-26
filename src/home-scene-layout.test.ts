import {describe,expect,it} from 'vitest';
import {sceneRoomColumns} from './home-scene-layout';
describe('scene room tracks fill the available container',()=>{
 it('keeps full-width tracks small across desktop and ultra-wide windows',()=>{
  for(let width=280;width<=12000;width++){
   const count=sceneRoomColumns(width),card=(width-(count-1)*12)/count;
   expect(card).toBeGreaterThan(120);expect(card).toBeLessThanOrEqual(190);
   expect(card*count+12*(count-1)).toBeCloseTo(width);
  }
 });
 it('calculates from actual content width and spacing, regardless of room count',()=>{
  expect(sceneRoomColumns(1203)).toBe(7);expect(sceneRoomColumns(1805)).toBe(9);
  expect(sceneRoomColumns(1203,20)).toBe(6);expect(sceneRoomColumns(392)).toBe(2);expect(sceneRoomColumns(393)).toBe(3);
 });
 it('keeps narrow and initially hidden grids usable until measured',()=>{
  for(const width of [0,200,279,NaN,Infinity])expect(sceneRoomColumns(width)).toBe(1);
  expect(sceneRoomColumns(500,NaN)).toBe(sceneRoomColumns(500));
 });
});
