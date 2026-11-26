import {expect,it,vi} from 'vitest';
import {airerMotorValues,airerPositionTarget,standardAirerLight,standardAirerRails} from './airer-spec';
import {SpecAirerCommands} from './airer-spec-commands';
import type {ControlResult,Device,DevicePanel,Json,Property} from './types';

const context={homeId:'home',generation:1,did:'airer-fixture'};
const model='dooya.airer.2m';
const device:Device={did:context.did,model,name:'晾衣机',roomId:'room',roomName:'阳台',online:true};
const property=(siid:number,piid:number,name:string,options:Partial<Property>):Property=>({siid,piid,name,description:name,format:'uint8',access:['read'],...options});
const choices=(values:[Json,string][])=>values.map(([value,description])=>({value,description}));
const fixture=(status=2):DevicePanel=>({did:device.did,model,specType:'urn:miot-spec-v2:device:airer:0000A00D:dooya-2m:1',services:[
 {siid:2,name:'airer',description:'Airer',actions:[],properties:[
   property(2,1,'fault',{code:0,value:0,valueList:choices([[0,'No Faults'],[1,'Overweight']])}),
   property(2,2,'motor-control',{access:['write'],valueList:choices([[0,'Down'],[1,'Up'],[2,'Pause']])}),
   property(2,3,'status',{code:0,value:status,valueList:choices([[0,'Down'],[1,'Rising'],[2,'Stop']])}),
 ]},
 {siid:3,name:'light',description:'Light',actions:[],properties:[
   property(3,1,'on',{access:['read','write'],format:'bool',code:0,value:false}),
   property(3,3,'brightness',{access:['read','write'],code:0,value:25,valueRange:[1,100,1]}),
 ]},
]});
const tick=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};

it('uses model-specific direction codes and rejects duplicate and calibration choices',()=>{
 const rail=standardAirerRails(fixture())[0];
 expect(rail.values).toEqual({up:1,pause:2,down:0});
 const motor={...rail.motor,valueList:choices([[0,'Pause'],[1,'Up'],[2,'Down'],[3,'Pause'],[4,'Up While Set Limit'],[5,'Down While Set Limit']])};
 expect(airerMotorValues(motor)).toEqual({up:1,pause:0,down:2});
 motor.valueList.push({value:6,description:'Up'});
 expect(airerMotorValues(motor).up).toBeUndefined();
});

it('keeps controls on their own rail and uses the light service for illumination',()=>{
 const panel=fixture();
 const second=structuredClone(panel.services[0]);second.siid=5;second.description='Airer 2';
 second.properties.forEach(p=>p.siid=5);panel.services[0].description='Airer 1';panel.services.push(second);
 expect(standardAirerRails(panel).map(rail=>[rail.label,rail.motor.siid])).toEqual([['晾杆 1',2],['晾杆 2',5]]);
 expect(standardAirerLight(panel).brightness?.piid).toBe(3);
 panel.services[1].properties.pop();expect(standardAirerLight(panel).brightness).toBeUndefined();
 panel.services.splice(1,1);expect(standardAirerLight(panel)).toEqual({power:undefined});
});

it('shows movement before acknowledgement and sends stop after the submitted lift',async()=>{
 let resolve!: (result:ControlResult)=>void;
 const write=vi.fn().mockImplementationOnce(()=>new Promise(r=>resolve=r)).mockResolvedValue({panel:fixture(),verified:true,message:''});
 const state=new SpecAirerCommands({read:vi.fn().mockResolvedValue(fixture()),write},()=>{},()=>{},()=>{});
 try{
   state.bind(device,context,'account',fixture());state.lift('down');await tick();
   expect(state.pendingIntent).toBe('down');
   state.lift('pause');
   expect(state.pendingIntent).toBe('pause');expect(write).toHaveBeenCalledTimes(1);
   resolve({panel:fixture(0),verified:true,message:''});await tick();
   expect(write.mock.calls.map(call=>call[1].value)).toEqual([0,2]);
   expect(state.rail?.phase).toBe('stopped');
   expect(state.activeIntent).toBe('pause');
 }finally{state.close();}
});

it('keeps confirmed manual pauses through ordinary Stop reports and clears them on resume or completion',async()=>{
 vi.useFakeTimers();
 const atStatus=(status:number)=>{
   const panel=fixture(status);
   panel.services[0].properties[2].valueList!.push({value:3,description:'Upper Limit'},{value:4,description:'Lower Limit'});
   return panel;
 };
 let actual=atStatus(2);
 const write=vi.fn(async (_context,change:{intent:'up'|'pause'|'down'})=>{
   actual=atStatus(change.intent==='up'?1:change.intent==='down'?0:2);
   return {panel:actual,verified:true,message:''};
 });
 const state=new SpecAirerCommands({read:async()=>actual,write},()=>{},()=>{},()=>{});
 try{
   state.bind(device,context,'account',actual);
   state.lift('pause');await tick();expect(state.activeIntent).toBeUndefined();
   state.lift('up');expect(state.activeIntent).toBe('up');await tick();
   state.lift('pause');expect(state.activeIntent).toBe('pause');await tick();
   await vi.advanceTimersByTimeAsync(10000);expect(state.activeIntent).toBe('pause');
   write.mockRejectedValueOnce({kind:'permissionDenied'});
   state.lift('down');expect(state.activeIntent).toBe('down');await tick();
   expect(state.activeIntent).toBe('pause');
   state.lift('down');await tick();expect(state.activeIntent).toBe('down');
   actual=atStatus(4);await vi.advanceTimersByTimeAsync(10000);expect(state.activeIntent).toBeUndefined();
   state.lift('up');await tick();actual=atStatus(3);
   await vi.advanceTimersByTimeAsync(10000);expect(state.activeIntent).toBeUndefined();
   expect(write).toHaveBeenCalledTimes(6);
 }finally{state.close();vi.useRealTimers();}
});

it('does not fabricate position for a motor whose spec has no direction feedback',()=>{
 const panel=fixture();panel.services[0].properties.pop();
 const rail=standardAirerRails(panel)[0];
 expect(rail.values.down).toBe(0);expect(rail.phase).toBe('unknown');expect(rail.position).toBeUndefined();
});

it('only offers a writable percentage position from the selected rail and rejects limit setters',()=>{
 const panel=fixture();
 const target=property(2,12,'target-position',{access:['read','write'],unit:'percentage',valueRange:[15,100,1]});
 const reading=property(2,11,'current-position',{unit:'percentage',valueRange:[0,100,1]});
 panel.services[0].properties.push(reading,target);
 expect(airerPositionTarget(panel,2)).toBe(target);
 expect(airerPositionTarget(panel,3)).toBeUndefined();
 const second=structuredClone(panel.services[0]);second.siid=6;second.properties.forEach(p=>p.siid=6);panel.services.push(second);
 expect(airerPositionTarget(panel,6)?.siid).toBe(6);
 target.description='设置上限位';
 expect(airerPositionTarget(panel,2)).toBeUndefined();
 target.description='设定位置';target.access=['read'];
 expect(airerPositionTarget(panel,2)).toBeUndefined();
});
