import {describe,expect,it} from 'vitest';
import {deviceColumnCount} from './home-grid';

describe('continuous desktop device columns',()=>{
  it('includes five columns and does not skip odd column counts',()=>{
    const seen=new Set<number>();for(let width=360;width<=8000;width++)seen.add(deviceColumnCount(width));
    expect([...seen]).toEqual(Array.from({length:33},(_,i)=>i+2));
    expect(deviceColumnCount(1000)).toBe(5);expect(deviceColumnCount(1239)).toBe(5);
  });
  it('fits actual home margins and 12px gaps without relying on a maximum card width',()=>{
    for(let width=360;width<=16000;width++){
      const count=deviceColumnCount(width),inset=Math.max(16,Math.min(48,width*.03));
      const card=(width-inset*2-12*(count-1))/count;
      expect(card).toBeGreaterThanOrEqual(150);expect(card).toBeLessThanOrEqual(360);
      expect(card*1.5).toBeLessThanOrEqual(360);
    }
  });
  it('adds exactly one column at neighboring desktop breakpoints',()=>{
    for(const point of [520,760,1000,1240,1480,1720,1960,2200,2440,2680,2920,3160,3400,3640,3880,4120,7960]){
      expect(deviceColumnCount(point)).toBe(deviceColumnCount(point-1)+1);
    }
  });
  it('continues above 8K and handles an unavailable viewport safely',()=>{
    expect(deviceColumnCount(12000)).toBeGreaterThan(32);
    expect(deviceColumnCount(16000)).toBeGreaterThan(deviceColumnCount(12000));
    expect(deviceColumnCount(NaN)).toBe(2);expect(deviceColumnCount(0)).toBe(2);
  });
});
