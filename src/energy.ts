import { dateKey,parseDateKey } from './history';
import { findProperty } from './panel-layout';
import type { Device,DevicePanel,EnergyReport,EnergySelection } from './types';
export function energySupported(device:Device,panel:DevicePanel|undefined):boolean {
  const energy=findProperty(panel,['power-consumption'],['power-consumption']);
  const power=findProperty(panel,['power-consumption'],['electric-power']);
  if(device.did===panel?.did&&device.model===panel?.model&&!panel?.unsupportedReason&&!device.controlServiceId&&device.model==='lumi.acpartner.mcn02'&&panel.specType?.startsWith('urn:miot-spec-v2:device:air-conditioner:')&&power?.unit==='watt'&&power.access.includes('read'))return true;
  const verifiedModel=['cuco.plug.cp1m','cuco.plug.cp1md','cuco.plug.cp2','cuco.plug.cp2d','cuco.plug.v3','zimi.plug.zncz01','chuangmi.plug.212a01','qmi.plug.psv3'].includes(device.model);
  return device.did===panel?.did&&device.model===panel?.model&&!panel?.unsupportedReason&&!device.controlServiceId&&!!panel?.specType?.startsWith('urn:miot-spec-v2:device:outlet:')&&!!energy?.access.includes('read')&&power?.unit==='watt'&&(verifiedModel||['kilowatt-hour','kWh','watt-hour','Wh'].includes(energy?.unit??''));
}
/** APK 14846 maps power separately from energy statistics. Never scale both alike. */
export function outletPowerDivisor(model:string):number {
  return ['cuco.plug.cp1m','cuco.plug.cp2'].includes(model)?10:model==='zimi.plug.zncz01'?100:1;
}
export function energySlots(report:EnergyReport):{time:number;value:number|null}[]{
  const first=new Date(report.start*1000),last=new Date(report.end*1000),monthly=report.selection.period==='year';
  const slots:{time:number;value:number|null}[]=[];
  for(let date=new Date(first);date<=last&&slots.length<366;){
    slots.push({time:date.getTime()/1000,value:null});
    if(monthly)date=new Date(date.getFullYear(),date.getMonth()+1,1);else date=new Date(date.getFullYear(),date.getMonth(),date.getDate()+1);
  }
  const key=(time:number)=>{const date=new Date(time*1000);return monthly?`${date.getFullYear()}-${date.getMonth()}`:dateKey(date);};
  const byKey=new Map(slots.map(slot=>[key(slot.time),slot]));
  for(const point of report.points){
    if(!Number.isFinite(point.value)||point.value<0||!Number.isFinite(point.time)||point.time<report.start||point.time>report.end)continue;
    const slot=byKey.get(key(point.time));if(slot)slot.value=point.value;
  }
  return slots;
}
export function energyDateText(report:EnergyReport|undefined,selection:EnergySelection):string {
  const at=parseDateKey(selection.date),today=new Date();
  const short=(date:Date)=>`${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')}`;
  if(selection.period==='week'){const first=new Date(at.getFullYear(),at.getMonth(),at.getDate()-6);return `${short(first)}-${short(at)}`;}
  if(selection.period==='month'){
    if(at.getFullYear()===today.getFullYear()&&at.getMonth()===today.getMonth()){
      const lastDay=new Date(today.getFullYear(),today.getMonth()+1,0).getDate();
      const first=report?new Date(report.start*1000):new Date(today.getFullYear(),today.getMonth(),today.getDate()===lastDay?1:today.getDate()-29);
      return `${short(first)}-${short(today)}`;
    }
    return `${at.getFullYear()}/${String(at.getMonth()+1).padStart(2,'0')}`;
  }
  const first=report?new Date(report.start*1000):new Date(today.getFullYear(),today.getMonth()-11,1);
  return first.getFullYear()===today.getFullYear()?String(today.getFullYear()):`${first.getFullYear()}/${String(first.getMonth()+1).padStart(2,'0')}-${today.getFullYear()}/${String(today.getMonth()+1).padStart(2,'0')}`;
}
