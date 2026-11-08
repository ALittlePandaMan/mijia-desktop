import { describe, expect, it } from 'vitest';
import fridge from '../src-tauri/src/fixtures/compatibility/fridge--viomi.fridge.b1.json';
import controlPanel from '../src-tauri/src/fixtures/compatibility/control-panel--xiaomi.controller.oh10p.json';
import thermometer from '../src-tauri/src/fixtures/compatibility/temperature-humidity-sensor--xiaomi.sensor_ht.minigl.json';
import airer from '../src-tauri/src/fixtures/compatibility/airer--dooya.airer.2m.json';
import airerTarget from '../src-tauri/src/fixtures/compatibility/airer--hyd.airer.1s1.json';
import washer from '../src-tauri/src/fixtures/compatibility/washer--viomi.washer.s1.json';
import purifier from '../src-tauri/src/fixtures/compatibility/water-purifier--bj352.waterpuri.k10.json';
import dispenser from '../src-tauri/src/fixtures/compatibility/water-dispenser--yunmi.plmachine.mg2.json';
import router from '../src-tauri/src/fixtures/compatibility/router--isa.router.mr01hl.json';
import roller from '../src-tauri/src/fixtures/compatibility/roller-shutter--shuse.roller.sr01.json';
import doorbell from '../src-tauri/src/fixtures/compatibility/video-doorbell--chuangmi.cateye.ipc018.json';
import freshAir from '../src-tauri/src/fixtures/compatibility/air-fresh--zhimi.airfresh.va2.json';
import observed from './fixtures/daily-remaining-panels.json';
import publishedAc from '../src-tauri/src/fixtures/compatibility/air-conditioner--viomi.airc.m1.json';
import { capabilityBinding, capabilityCategory, capabilityProperties, capabilityProperty, hasCapabilityCategory, resolveDeviceCapabilities } from './device-capabilities';
import type { DevicePanel, Json } from './types';

interface RawInstance {
  type: string;
  services: { iid: number; type: string; description: string;
    properties?: { iid: number; type: string; description: string; format: string; access?: string[]; unit?: string; 'value-list'?: {value: Json; description: string}[]; 'value-range'?: number[] }[];
    actions?: { iid: number; type: string; description: string; in?: number[]; out?: number[] }[] }[];
}
/** Test-only projection of the untouched published descriptor, with no invented
 * current values. The backend separately parses the same real raw fixtures. */
function published(raw: unknown, model: string): DevicePanel {
  const data = raw as RawInstance;
  return { did: 'public-model-fixture', model, specType: data.type, services: data.services.map(service => ({
    siid: service.iid, name: service.type.split(':')[3], description: service.description,
    properties: (service.properties ?? []).map(property => ({ siid: service.iid, piid: property.iid,
      name: property.type.split(':')[3], description: property.description, format: property.format,
      access: property.access ?? [], unit: property.unit, valueList: property['value-list'], valueRange: property['value-range'] })),
    actions: (service.actions ?? []).map(action => ({ siid: service.iid, aiid: action.iid,
      name: action.type.split(':')[3], description: action.description, in: action.in ?? [], out: action.out ?? [] })),
  })) };
}

describe('public daily capability resolution, independent of brand', () => {
  it('keeps actual high-numbered switch service identifiers and hides smart configurations', () => {
    const panel = published(controlPanel, 'xiaomi.controller.oh10p'), caps = resolveDeviceCapabilities(panel);
    expect(caps.category).toBe('switch');
    expect(caps.properties.map(binding => [binding.siid, binding.piid, binding.name])).toEqual([[10, 1, 'on'], [11, 1, 'on'], [12, 1, 'on']]);
    expect(caps.actions).toEqual([]);
    expect(capabilityProperty(panel, 'switch.on')).toBeUndefined();
    expect(capabilityProperties(panel, 'switch.on')).toHaveLength(3);
  });
  it('binds the real minigl thermometer 1001/1002 properties without assuming 1/2', () => {
    const panel = published(thermometer, 'xiaomi.sensor_ht.minigl');
    expect(capabilityProperty(panel, 'temperature-humidity-sensor.temperature')?.piid).toBe(1001);
    expect(capabilityProperty(panel, 'temperature-humidity-sensor.relative-humidity')?.piid).toBe(1002);
    expect(resolveDeviceCapabilities(panel).properties.every(binding => binding.kind === 'reading')).toBe(true);
  });
  it('keeps both fridge chambers and never guesses a first temperature channel', () => {
    const panel = published(fridge, 'viomi.fridge.b1');
    expect(capabilityProperties(panel, 'fridge-chamber.target-temperature').map(property => [property.siid, property.piid])).toEqual([[3, 2], [4, 2]]);
    expect(capabilityProperty(panel, 'fridge-chamber.target-temperature')).toBeUndefined();
    expect(resolveDeviceCapabilities(panel).properties.some(binding => binding.service === 'fridge-factory')).toBe(false);
  });
  it('retains actual airer lights, explains write-only movement, and omits missing target-position', () => {
    const panel = published(airer, 'dooya.airer.2m'), caps = resolveDeviceCapabilities(panel);
    expect(caps.properties.find(binding => binding.role === 'light.on')).toMatchObject({siid:3,piid:1,kind:'power'});
    expect(caps.properties.find(binding=>binding.name==='motor-control')?.kind).toBe('command');
    expect(caps.properties.some(binding=>binding.name==='target-position')).toBe(false);
    const missing=structuredClone(panel);missing.services.forEach(s=>s.properties=s.properties.filter(p=>p.name!=='status'&&p.name!=='current-position'));
    expect(resolveDeviceCapabilities(missing).properties.some(b=>b.name==='motor-control')).toBe(false);
    const target = resolveDeviceCapabilities(published(airerTarget, 'hyd.airer.1s1'));
    expect(target.properties.find(binding => binding.role === 'airer.target-position')).toMatchObject({siid:2,piid:6,kind:'range'});
    expect(target.properties.some(binding => binding.service === 'set-night-light' && binding.name === 'set-position')).toBe(false);
  });
  it('keeps washer power, lock and current state without inventing programs or start commands', () => {
    const caps = resolveDeviceCapabilities(published(washer, 'viomi.washer.s1'));
    expect(caps.properties.some(binding => binding.role === 'washer.on')).toBe(true);
    expect(caps.properties.some(binding => binding.role === 'physical-controls-locked.physical-controls-locked')).toBe(true);
    expect(caps.properties.some(binding => binding.name === 'mode' || binding.name === 'target-water-level')).toBe(false);
    expect(caps.actions.every(a=>['start-wash','pause','stop-washing'].includes(a.name))).toBe(true);
    expect(caps.privateFeatures.map(feature => feature.feature)).toContain('washer-program');
  });
  it('keeps independent filter readings and only genuinely supplied water settings', () => {
    const caps = resolveDeviceCapabilities(published(purifier, 'bj352.waterpuri.k10'));
    expect(caps.properties.filter(binding => binding.name === 'filter-life-level').map(binding => binding.siid)).toEqual([3,5]);
    expect(caps.properties.some(binding => binding.name === 'on')).toBe(false);
    const water = resolveDeviceCapabilities(published(dispenser, 'yunmi.plmachine.mg2'));
    expect(water.properties.find(binding => binding.name === 'target-temperature')).toMatchObject({siid:2,piid:6,kind:'range',unit:'celsius'});
    expect(water.privateFeatures.some(feature => feature.feature === 'cup-volume')).toBe(true);
  });
  it('does not infer private router network operations or expose Wi-Fi passwords as generic properties', () => {
    const caps = resolveDeviceCapabilities(published(router, 'isa.router.mr01hl'));
    expect(caps.properties.every(binding => binding.kind === 'reading')).toBe(true);
    expect(caps.actions).toEqual([]);
    expect(caps.privateFeatures.some(feature => feature.feature === 'router-network')).toBe(true);
  });
  it('requires a genuine primary service rather than trusting a category name', () => {
    const caps = resolveDeviceCapabilities(published(roller, 'shuse.roller.sr01'));
    expect(caps.category).toBe('curtain'); expect(caps.profile).toBe('none');
    expect(caps.properties).toEqual([]); expect(caps.actions).toEqual([]);
  });
  it('keeps doorbell battery reading without inventing video controls', () => {
    const caps = resolveDeviceCapabilities(published(doorbell, 'chuangmi.cateye.ipc018'));
    expect(caps.properties.every(binding => binding.kind === 'reading')).toBe(true);
    expect(caps.properties.some(binding => binding.name === 'battery-level')).toBe(true);
    expect(caps.actions).toEqual([]);
  });
  it('normalizes the published fresh-air category without opening indicator or screen settings', () => {
    const caps = resolveDeviceCapabilities(published(freshAir, 'zhimi.airfresh.va2'));
    expect(caps.category).toBe('fresh-air');
    expect(caps.properties.some(binding => binding.service === 'air-fresh' && binding.name === 'on')).toBe(true);
    expect(caps.properties.some(binding => ['screen','indicator-light'].includes(binding.service))).toBe(false);
  });
  it('rejects missing units, invalid formats, ambiguous IDs, and unsupported bindings', () => {
    const panel = published(thermometer, 'xiaomi.sensor_ht.minigl'), property = capabilityProperty(panel, 'temperature-humidity-sensor.temperature')!;
    delete property.unit; expect(capabilityProperty(panel, 'temperature-humidity-sensor.temperature')).toBeUndefined();
    property.unit = 'celsius'; property.format = 'string'; expect(capabilityProperty(panel, 'temperature-humidity-sensor.temperature')).toBeUndefined();
    property.format = 'float'; property.unsupportedReason = 'unverified'; expect(capabilityProperty(panel, 'temperature-humidity-sensor.temperature')).toBeUndefined();
    delete property.unsupportedReason;
    panel.services[0].properties.push({...property});
    expect(capabilityProperty(panel, 'temperature-humidity-sensor.temperature')).toBeUndefined();
  });
  it('does not bind an arbitrary renamed property from a mismatched service', () => {
    const panel = published(fridge, 'viomi.fridge.b1'), caps = resolveDeviceCapabilities(panel), binding = caps.properties.find(binding => binding.name === 'target-temperature')!;
    expect(capabilityBinding(panel, binding)?.siid).toBe(3);
    expect(capabilityBinding(panel, {...binding, service:'freezer'})).toBeUndefined();
    expect(capabilityBinding(panel, {...binding, piid:999})).toBeUndefined();
    expect(resolveDeviceCapabilities({...panel, unsupportedReason:'权限不足'}).profile).toBe('none');
  });
  it('returns no guessed category for invalid or non-device URNs', () => {
    for (const type of ['fan', 'urn:miot-spec-v2:property:fan:0000', 'urn:other:device:fan:0000']) expect(capabilityCategory(type)).toBeUndefined();
  });
  it('keeps observed ceiling fan swing and published AC fan-control bindings', () => {
    const panel = structuredClone(observed.models.find(panel => panel.model === 'yeelink.ven_fan.vf3')) as DevicePanel;
    const caps = resolveDeviceCapabilities(panel);
    expect(caps.properties.some(binding => binding.service === 'ceiling-fan' && binding.name === 'vertical-swing')).toBe(true);
    expect(caps.properties.some(binding => binding.service === 'light' && binding.name === 'brightness')).toBe(true);
    const ac = published(publishedAc, 'viomi.airc.m1'), actual = ac.services.find(service => service.name === 'fan-control')?.properties.find(property => property.name === 'fan-level');
    expect(actual).toBeDefined();
    expect(resolveDeviceCapabilities(ac).properties.some(binding => binding.siid === actual!.siid && binding.piid === actual!.piid)).toBe(true);
  });
  it('recognizes only supported category policy keys and their explicit aliases', () => {
    for (const category of ['relay','control-panel','air-fresh','ceiling-fan','ir-remote-control']) expect(hasCapabilityCategory(category)).toBe(true);
    for (const category of ['unknown', 'toString', 'constructor', '__proto__', undefined, null]) expect(hasCapabilityCategory(category)).toBe(false);
    const panel = published(fridge, 'viomi.fridge.b1');
    panel.services.push({...panel.services[0],siid:999,name:'constructor',properties:panel.services[0].properties.map(property=>({...property,siid:999}))});
    expect(()=>resolveDeviceCapabilities(panel)).not.toThrow();
    expect(resolveDeviceCapabilities({...panel,specType:'urn:miot-spec-v2:device:constructor:0000:x:1'}).profile).toBe('none');
  });
});
