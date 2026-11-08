import {describe,it,expect} from 'vitest';
import observed from './fixtures/daily-remaining-panels.json';
import {dailyActionLabel,dailyPanel} from './daily-scope';
import {compilePanelDocument,type ComponentNode} from './ui-schema';
import type {DevicePanel} from './types';
const models=observed.models as unknown as DevicePanel[];
const panel=(model:string)=>{const p=models.find(p=>p.model===model);if(!p)throw Error('Contract missing '+model);return structuredClone(p);};
const services=(model:string)=>dailyPanel(panel(model)).services;
const names=(model:string,service:string)=>services(model).find(s=>s.name===service)?.properties.map(p=>p.name)??[];
const actions=(model:string)=>services(model).flatMap(s=>s.actions.map(a=>s.name+'.'+a.name));
const flat=(items:ComponentNode[]):ComponentNode[]=>items.flatMap(item=>item.name==='Container'?flat(item.items):[item]);
describe('observed remaining devices: daily scope without physical-control claims',()=>{
 it('retains the real presence, contact and gas readings without detector calibration',()=>{
  for(const model of ['xiaomi.sensor_occupy.03','linp.sensor_occupy.hb01']){expect(names(model,'occupancy-sensor')).toContain('occupancy-status');expect(names(model,'occupancy-sensor')).not.toContain('no-one-determine-time');expect(services(model).map(s=>s.name)).not.toContain('vendor');}
  expect(names('isa.magnet.dw2hl','magnet-sensor')).toContain('contact-state');expect(names('lumi.sensor_gas.mcn02','gas-sensor')).toContain('gas-concentration');expect(services('lumi.sensor_gas.mcn02').some(s=>s.name==='gas-sensor-control')).toBe(false);
 });
 it('restores bath-heater light, warmth and ventilation plus stop without hidden vendor actions',()=>{
  expect(names('yeelink.bhf_light.v13','light')).toEqual(['on','mode','brightness']);expect(names('yeelink.bhf_light.v13','ptc-bath-heater')).toEqual(['mode','blow','heating','ventilation','heat-level','target-temperature']);expect(actions('yeelink.bhf_light.v13')).toEqual(['ptc-bath-heater.stop-working']);
 });
 it('keeps the ceiling fan swing and lamp brightness while excluding delayed off',()=>{
  expect(names('yeelink.ven_fan.vf3','ceiling-fan')).toEqual(['on','fan-level','vertical-swing']);expect(names('yeelink.ven_fan.vf3','light')).toEqual(['on','mode','brightness']);expect(actions('yeelink.ven_fan.vf3')).toEqual([]);
 });
 it('keeps fryer ordinary controls and actual ranges while excluding recipe synchronization and self-check',()=>{
  const p=panel('xiaomi.fryer.maf16'),filtered=dailyPanel(p);expect(names(p.model,'air-fryer')).toEqual(['status','fault','target-time','target-temperature','left-time','auto-keep-warm','mode']);expect(actions(p.model)).toEqual(['air-fryer.start-cook','air-fryer.cancel-cooking','air-fryer.pause','air-fryer.resume-cook']);expect(filtered.services.map(s=>s.name)).not.toContain('self-check');expect(filtered.services[0].properties.find(p=>p.name==='target-temperature')?.valueRange).toEqual([40,230,5]);expect(p.services.find(s=>s.name==='air-fryer')?.properties.some(p=>p.name==='recipe-sync')).toBe(true);
 });
 it('never exposes inferred MIoT IR actions instead of the observed controller key table',()=>{for(const model of ['miir.tv.ir01','miir.stb.ir01']){const original=panel(model);expect(original.services.flatMap(s=>s.actions).length).toBeGreaterThanOrEqual(8);expect(dailyPanel(original).services).toEqual([]);}});
 it('keeps projector shutdown, input, sound and playback without claiming BLE wake-up or raw remote support',()=>{
  const model='fengmi.projector.015fo3';expect(names(model,'projector')).toEqual(['input-control']);expect(names(model,'speaker')).toEqual(['volume','mute']);expect(names(model,'play-control')).toEqual(['playing-state']);expect(actions(model)).toEqual(['projector.turn-off','play-control.play','play-control.pause']);expect(services(model).map(s=>s.name)).not.toEqual(expect.arrayContaining(['ble-control','remote-control','message-router']));
 });
 it('does not invent cloud controls for the BLE scale',()=>{expect(dailyPanel(panel('yunmai.scales.ms103')).services).toEqual([]);});
 it('does not give MIoT IR declarations or parameterized commands a daily button label',()=>{const service=panel('miir.tv.ir01').services.find(s=>s.name==='ir-tv-control')!,action=service.actions.find(a=>a.name==='turn-on')!;expect(dailyActionLabel('television',service,action)).toBeUndefined();expect(dailyActionLabel('television',service,{...action,in:[1]})).toBeUndefined();});
 it('compiles restored native-described bindings into real controls rather than empty placeholder pages',()=>{
  for(const model of ['xiaomi.sensor_occupy.03','isa.magnet.dw2hl','yeelink.bhf_light.v13','fengmi.projector.015fo3']){const p=dailyPanel(panel(model)),doc=compilePanelDocument({device:{did:p.did,model,name:'fixture',online:true,roomId:'fixture',roomName:'fixture'},panel:p,includeModelFallback:true});expect(flat(doc.items).filter(n=>['Power','Selector','Slider','Status','Action'].includes(n.name)).length,model).toBeGreaterThan(0);}
 });
});
