import {describe,it,expect} from 'vitest';
import {sensorStatusLabel} from './sensor-status';
import type {Property} from './types';
const contact:Property={siid:2,piid:2,name:'contact-state',description:'接触状态',format:'bool',access:['read','notify']};
describe('contact status display: native open sample, closed branch checked with a fixture',()=>{
 it('does not invert an open contact into a closed door',()=>{expect(sensorStatusLabel('magnet-sensor',contact,false)).toBe('已打开');expect(sensorStatusLabel('magnet-sensor',contact,true)).toBe('已关闭');});
 it('leaves missing, malformed and unrelated Boolean readings alone',()=>{for(const value of [undefined,null,0,1,'false'])expect(sensorStatusLabel('magnet-sensor',contact,value)).toBeUndefined();expect(sensorStatusLabel('camera-control',contact,false)).toBeUndefined();expect(sensorStatusLabel('magnet-sensor',{...contact,name:'on'},false)).toBeUndefined();});
 it('lets the device enum retain authority over model fallback semantics',()=>{expect(sensorStatusLabel('magnet-sensor',{...contact,valueList:[{value:false,description:'设备自己的说明'},{value:true,description:'另一状态'}]},false)).toBeUndefined();});
});
