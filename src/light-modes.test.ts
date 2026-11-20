import { describe, expect, it } from 'vitest';
import { validLightModeSlot, wyraModeReason, wyraModeValue, wyraScenes } from './light-modes';
import type { LightModeSlot, Property } from './types';

const mode: Property = { siid:2,piid:5,name:'mode',description:'Mode',format:'uint8',access:['read','write','notify'],code:0,value:18,valueList:Array.from({length:19},(_,value)=>({value,description:String(value)})) };
const slot: LightModeSlot = { index:0,mode:11,brightness:100,color:0xff0000,temperature:null,reason:null };
describe('observed wyra01 modes',()=>{
  it('keeps the installed twelve scene values distinct from custom and flow slots',()=>{
    expect(wyraScenes.map(scene=>scene.value)).toEqual([1,2,3,4,5,6,7,8,9,10,16,17]);
    expect(new Set(wyraScenes.map(scene=>scene.name)).size).toBe(12);
  });
  it('uses actual valid enum values including zero',()=>{
    expect(wyraModeValue(mode)).toBe(18);expect(wyraModeValue({...mode,value:0})).toBe(0);
  });
  it('rejects failed missing and historical-only values',()=>{
    for(const property of [undefined,{...mode,code:-1},{...mode,value:null},{...mode,value:undefined,lastReported:{value:15,updatedAt:1,retrievedAt:2}}])expect(wyraModeValue(property)).toBeUndefined();
  });
  it('rejects unknown encodings and malformed or ambiguous enum metadata',()=>{
    for(const change of [{format:'string'},{name:'power'},{unit:'percentage'},{valueRange:[0,18,1]},{valueList:null},{valueList:[]},{valueList:[{value:'18',description:'CT'}]},{valueList:[{value:18,description:'A'},{value:18,description:'B'}]},{value:19},{value:1.5},{access:['write']}])expect(wyraModeValue({...mode,...change})).toBeUndefined();
  });
  it('allows only descriptor-approved target values',()=>{
    expect(wyraModeReason(mode,15)).toBeUndefined();
    for(const target of [19,-1,1.5,NaN])expect(wyraModeReason(mode,target)).toBeTruthy();
    expect(wyraModeReason({...mode,valueList:[{value:18,description:'CT'}]},15)).toBeTruthy();
  });
  it('does not enable readonly or explicitly unsupported properties',()=>{
    expect(wyraModeReason({...mode,access:['read']},1)).toBeTruthy();
    expect(wyraModeReason({...mode,unsupportedReason:'restricted'},1)).toBe('restricted');
  });
  it('accepts zero brightness and exact black as real slot values',()=>{
    expect(validLightModeSlot({...slot,brightness:0,color:0},0)).toBe(true);
  });
  it('accepts either an RGB or a Kelvin slot with the matching identity',()=>{
    expect(validLightModeSlot(slot,0)).toBe(true);
    expect(validLightModeSlot({...slot,index:3,mode:14,color:null,temperature:6500},3)).toBe(true);
  });
  it('rejects unconfirmed malformed and mixed slot values without defaults',()=>{
    for(const change of [{reason:'failed'},{index:1},{mode:12},{brightness:null},{brightness:-1},{brightness:101},{brightness:0.5},{color:null},{color:0x1000000},{color:NaN},{temperature:4600},{color:null,temperature:6501},{color:null,temperature:2699},{color:null,temperature:4600.5}])expect(validLightModeSlot({...slot,...change},0)).toBe(false);
    expect(validLightModeSlot(undefined,0)).toBe(false);
  });
});
