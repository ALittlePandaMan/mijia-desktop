import {expect,it} from 'vitest';
import {energySlots,energyDateText,energySupported,outletPowerDivisor} from './energy';
import {powerReading} from './ui/energy-page';
import type {Device,DevicePanel,EnergyReport} from './types';
const time=(year:number,month:number,day:number)=>new Date(year,month-1,day).getTime()/1000;
const report=(extra:Partial<EnergyReport>={}):EnergyReport=>({did:'a',model:'cuco.plug.v3',fetchedAt:time(2026,10,26),selection:{period:'week',date:'2026-10-26'},start:time(2026,10,20),end:time(2026,10,27)-1,points:[],summary:{today:null,yesterday:null,month:null,switches:null,switchesMore:false,complete:true},complete:true,error:null,warnings:[],...extra});
it('weekly energy keeps zero and gaps instead of fabricating missing consumption',()=>{
 const slots=energySlots(report({points:[{time:time(2026,10,20),value:0},{time:time(2026,10,22),value:.13},{time:time(2026,10,21),value:-1},{time:time(2026,10,27),value:99}]}));
 expect(slots).toHaveLength(7);expect(slots[0].value).toBe(0);expect(slots[1].value).toBeNull();expect(slots[2].value).toBe(.13);expect(slots.at(-1)!.value).toBeNull();
});
it('yearly statistics retain rolling twelve months across years',()=>{
 const slots=energySlots(report({selection:{period:'year',date:'2026-10-26'},start:time(2025,11,1),points:[{time:time(2026,2,1),value:4.5}]}));
 expect(slots).toHaveLength(12);expect(new Date(slots[0].time*1000).getFullYear()).toBe(2025);expect(slots[3].value).toBe(4.5);expect(slots[11].value).toBeNull();
});
it('historical month uses its actual leap-day count',()=>{
 const slots=energySlots(report({selection:{period:'month',date:'2024-02-01'},start:time(2024,2,1),end:time(2024,3,1)-1}));
 expect(slots).toHaveLength(29);expect(new Date(slots.at(-1)!.time*1000).getDate()).toBe(29);
});
it('weekly date label follows the selected end day rather than the current clock',()=>{
 expect(energyDateText(undefined,{period:'week',date:'2026-01-03'})).toBe('12/28-01/03');
});
it('verified adapters and standard unit aliases expose the same statistics capability',()=>{
 const device:Device={did:'a',model:'cuco.plug.cp2',name:'outlet',online:true,roomId:'r',roomName:'room'};
 const prop={siid:11,piid:1,name:'power-consumption',description:'energy',format:'float',access:['read'],unit:'kilowatt-hour'};
 const panel:DevicePanel={did:'a',model:device.model,specType:'urn:miot-spec-v2:device:outlet:0000A002:vendor:1',services:[{siid:11,name:'power-consumption',description:'energy',actions:[],properties:[prop,{...prop,piid:2,name:'electric-power',unit:'watt'}]}]};
 for(const model of ['cuco.plug.cp1m','cuco.plug.cp1md','cuco.plug.cp2','cuco.plug.cp2d','cuco.plug.v3','zimi.plug.zncz01','chuangmi.plug.212a01','qmi.plug.psv3']){
  const next=structuredClone(panel);next.model=model;next.services[0].properties[0].unit=null;
  expect(energySupported({...device,model},next)).toBe(true);
 }
 for(const unit of ['kWh','kilowatt-hour','Wh','watt-hour',null,'unknown']){
  const next=structuredClone(panel);next.model='xiaomi.plug.04';next.services[0].properties[0].unit=unit;
  expect(energySupported({...device,model:next.model},next)).toBe(unit!==null&&unit!=='unknown');
 }
 expect(energySupported({...device,did:'other'},panel)).toBe(false);
 expect(energySupported({...device,controlServiceId:2},panel)).toBe(false);
 expect(energySupported(device,{...panel,unsupportedReason:'no permission'})).toBe(false);
});
it('scales vendor power separately, preserves zero, and never treats invalid readings as power',()=>{
 const prop={siid:3,piid:2,name:'electric-power',description:'power',format:'float',access:['read'],unit:'watt',code:0,value:123};
 const panel:DevicePanel={did:'a',model:'cuco.plug.cp2',services:[{siid:3,name:'power-consumption',description:'',actions:[],properties:[prop]}]};
 expect(powerReading(panel).value).toBe(12.3);
 expect(outletPowerDivisor('cuco.plug.cp2d')).toBe(1);
 expect(powerReading({...panel,model:'zimi.plug.zncz01'}).value).toBe(1.23);
 prop.value=0;expect(powerReading(panel).value).toBe(0);
 prop.value=-1;expect(powerReading(panel).value).toBeNull();
 prop.value=NaN;expect(powerReading(panel).value).toBeNull();
 prop.value=123;prop.unit='unknown';expect(powerReading(panel).value).toBeNull();
});
it('acpartner legacy statistics require the real climate type and watt capability, without inventing a counter',()=>{
 const d:Device={did:'a',model:'lumi.acpartner.mcn02',name:'空调插座',online:true,roomId:'r',roomName:'房间'};
 const p:DevicePanel={did:d.did,model:d.model,specType:'urn:miot-spec-v2:device:air-conditioner:0000A004:lumi-mcn02:1',services:[{siid:5,name:'power-consumption',description:'',actions:[],properties:[{siid:5,piid:1,name:'electric-power',description:'',format:'float',unit:'watt',access:['read'],value:564,code:0}]}]};
 expect(energySupported(d,p)).toBe(true);expect(powerReading(p).value).toBe(564);
 expect(energySupported({...d,model:'other.acpartner'},p)).toBe(false);expect(energySupported(d,{...p,specType:'urn:miot-spec-v2:device:camera:fixture'})).toBe(false);
});
