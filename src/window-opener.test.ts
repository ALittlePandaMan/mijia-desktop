import {describe,expect,it} from 'vitest';
import {openingPositionInput,windowOpenerCommand,windowOpenerRails} from './window-opener';
import type {DevicePanel,Property,Service} from './types';

const property=(siid:number,piid:number,name:string,fields:Partial<Property>):Property=>({
  siid,piid,name,description:name,format:'uint8',access:['read'],...fields,
});
const choices=(...labels:string[])=>labels.map((description,value)=>({description,value}));
const service=(siid:number,name:string,properties:Property[]):Service=>({siid,name,description:name,properties,actions:[]});
const panel=(services:Service[],model='example.wopener.test'):DevicePanel=>({
  did:'mock',model,specType:'urn:miot-spec-v2:device:window-opener:0000A043:example:1',services,
} as DevicePanel);

describe('window-opener controls',()=>{
  it('binds motor commands from the published values without allowing other modes',()=>{
    const motor=property(2,1,'motor-control',{access:['write'],valueList:choices('Close','Open','Pause','Calibration')});
    const [rail]=windowOpenerRails(panel([service(2,'window-opener',[motor])]));
    expect(rail.target).toBeUndefined();
    expect(['open','pause','close'].map(meaning=>windowOpenerCommand(rail,meaning as 'open'|'pause'|'close')?.value))
      .toEqual([1,2,0]);
    expect(windowOpenerRails(panel([service(2,'window-opener',[motor])]),3)).toEqual([]);
  });

  it('honors the target step even when the live position falls between two steps',()=>{
    const position=property(2,2,'current-position',{unit:'percentage',valueRange:[0,100,1],value:47});
    const target=property(2,3,'target-position',{access:['read','write'],unit:'percentage',valueRange:[0,100,5],value:50});
    const [rail]=windowOpenerRails(panel([service(2,'window-opener',[position,target])]));
    expect(rail.position?.value).toBe(47);
    expect(openingPositionInput(rail.target,rail.position)).toBe(target);
    expect(openingPositionInput(target,{...position,value:45})?.value).toBe(45);
    expect(openingPositionInput({...target,value:55,pending:'sending'},position)?.value).toBe(55);
  });

  it('scopes the multi-window controls to paired channels and keeps an offline channel locked',()=>{
    const channel=(siid:number,suffix:string,kind:number,online:boolean)=>service(siid,`param-set-${suffix}`,[
      property(siid,10,`motor-control-${suffix}`,{access:['write'],valueList:choices('Stop','Open','Close','Defense')}),
      property(siid,19,`devicetype-${suffix}`,{valueList:choices('Unknown','Paired'),value:kind}),
      property(siid,17,`online-${suffix}`,{format:'bool',value:online}),
    ]);
    const descriptor=panel([channel(8,'a',1,true),channel(9,'b',0,false),channel(10,'c',1,false)],'evecca.wopener.na03ma');
    expect(windowOpenerRails(descriptor).map(({siid,online})=>[siid,online])).toEqual([[8,true],[10,false]]);
    const [rail]=windowOpenerRails(descriptor,8);
    expect(windowOpenerCommand(rail,'pause')).toMatchObject({property:{siid:8,piid:10},value:0});
  });
});
