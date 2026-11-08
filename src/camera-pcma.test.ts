import {expect,it} from 'vitest';
import {encodePcma} from './camera-pcma';
it('encodes G.711 A-law silence, polarity and full-scale vectors',()=>{
 expect([...encodePcma(new Float32Array([0,-1/32768,1,-1,.5,-.5]))]).toEqual([0xd5,0x55,0xaa,0x2a,0xa5,0x3a]);
});
