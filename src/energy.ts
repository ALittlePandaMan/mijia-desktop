import { dateKey,parseDateKey } from './history';
import type { Device,DevicePanel,EnergyReport,EnergySelection } from './types';
import { capabilityCategory } from './device-capabilities';

export function meterProperty(panel: DevicePanel | undefined, name: 'electric-power' | 'power-consumption') {
  const services = panel?.services.filter(s => s.name === 'power-consumption') ?? [];
  if (services.length !== 1 || panel?.services.filter(s => s.siid === services[0].siid).length !== 1) return;
  const fields = services[0].properties.filter(p => p.name === name);
  if (fields.length !== 1) return;
  const p = fields[0];
  if (p.siid === services[0].siid && p.piid > 0 && services[0].properties.filter(item => item.piid === p.piid).length === 1 &&
      p.access.includes('read') && !p.unsupportedReason && /^(u?int(8|16|32|64)|float|double)$/.test(p.format) &&
      (name !== 'electric-power' || p.unit === 'watt')) return p;
}
function meterContext(device: Device, panel: DevicePanel | undefined): panel is DevicePanel {
  return !!panel && panel.did === device.did && panel.model === device.model && !panel.unsupportedReason && !device.controlServiceId;
}
function legacyPartner(device: Device, panel: DevicePanel): boolean {
  return device.model === 'lumi.acpartner.mcn02' && capabilityCategory(panel.specType) === 'air-conditioner';
}
export function climateMeter(device: Device, panel: DevicePanel | undefined): boolean {
  return meterContext(device, panel) && (capabilityCategory(panel.specType) === 'air-condition-outlet' || legacyPartner(device, panel))
    && !!meterProperty(panel, 'electric-power');
}
export function energySupported(device:Device,panel:DevicePanel|undefined):boolean {
  if (!meterContext(device, panel) || !panel.specType?.startsWith('urn:miot-spec-v2:device:') || !meterProperty(panel, 'electric-power')) return false;
  if (legacyPartner(device, panel)) return true;
  const energy = meterProperty(panel, 'power-consumption');
  const verifiedModel=['cuco.plug.cp1m','cuco.plug.cp1md','cuco.plug.cp2','cuco.plug.cp2d','cuco.plug.v3','zimi.plug.zncz01','chuangmi.plug.212a01','qmi.plug.psv3'].includes(device.model);
  return panel.specType.startsWith('urn:miot-spec-v2:device:outlet:') && !!energy && (verifiedModel||['kilowatt-hour','kWh','watt-hour','Wh'].includes(energy.unit??''));
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
