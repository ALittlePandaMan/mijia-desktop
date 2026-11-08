import {describe,it,expect} from 'vitest';
import {DevicePresentationRoute,presentationReady,presentationFingerprint,dedicatedPage} from './device-presentation-route';
import type {Device,DevicePanel} from './types';
const device={did:'isolated',model:'xiaomi.waterpuri.lx32'} as Device;
const panel={did:device.did,model:device.model,specType:'urn:miot-spec-v2:device:water-purifier:1',services:[{siid:2,name:'water-purifier',description:'净水器',properties:[],actions:[]}]} as DevicePanel;
describe('stable device presentation',()=>{
 it('waits for visible state, including false and zero, rather than metadata',()=>{
  const device={did:'sensor',model:'fixture.sensor'} as Device;
  const property={siid:2,piid:1,name:'occupancy-status',description:'有人状态',format:'bool',access:['read']} as const;
  const p={did:device.did,model:device.model,specType:'urn:miot-spec-v2:device:occupancy-sensor:1',services:[{siid:2,name:'occupancy-sensor',description:'',properties:[{...property,access:['read']}],actions:[]}]} as DevicePanel;
  expect(presentationReady(device,p)).toBe(false);
  p.services[0].properties[0].value=false;expect(presentationReady(device,p)).toBe(true);
  p.services[0].properties[0].code=-1;expect(presentationReady(device,p)).toBe(false);
  p.services[0].properties[0].lastReported={value:0,updatedAt:1,retrievedAt:2};expect(presentationReady(device,p)).toBe(true);
 });
 it('does not release a page for battery alone or an empty panel',()=>{
  const d={did:'sensor',model:'fixture.sensor'} as Device;
  const p={did:d.did,model:d.model,services:[{siid:3,name:'battery',description:'电量',properties:[{siid:3,piid:1,name:'battery-level',description:'电量',format:'uint8',access:['read'],value:99}],actions:[]}]} as DevicePanel;
  expect(presentationReady(d,p)).toBe(false);expect(presentationReady(d,{...p,services:[]})).toBe(false);
 });
 it('reserves the modern purifier shell before the private snapshot exists',()=>{expect(dedicatedPage(device.model)).toBe('purifier');expect(presentationReady(device,panel)).toBe(false);expect(presentationReady(device,{...panel,purifier:{} as DevicePanel['purifier']})).toBe(true)});
 it('keeps unavailable dedicated data in its own page shell',()=>{expect(presentationReady(device,{...panel,unsupportedReason:'暂时无法读取'})).toBe(false)});
 it('reserves compared fan and curtain themes before description reads',()=>{expect(dedicatedPage('dmaker.fan.p28')).toBe('fan');expect(dedicatedPage('xiaomi.fan.p69')).toBe('fan-p69');expect(dedicatedPage('xiaomi.curtain.acn009')).toBe('curtain')});
 it('does not include live readings or private snapshots in the schema identity',()=>{expect(presentationFingerprint(panel)).toBe(presentationFingerprint({...panel,purifier:{} as DevicePanel['purifier']}))});
 it('never commits an empty pre-metadata fallback',()=>{const route=new DevicePresentationRoute();expect(route.choose(device)).toBe('generic');expect(route.changed).toBe(false);route.choose(device,panel);expect(route.changed).toBe(false)});
 it('does not pin a metadata failure before the complete descriptor arrives',()=>{const route=new DevicePresentationRoute();route.choose(device,{...panel,services:[],unsupportedReason:'正在取得描述'});route.choose(device,panel);expect(route.changed).toBe(false)});
 it('keeps an opened layout stable and identifies a structural change',()=>{const route=new DevicePresentationRoute();route.choose(device,panel);route.choose(device,{...panel,specType:'urn:miot-spec-v2:device:fan:2'});expect(route.changed).toBe(true);route.reset();expect(route.changed).toBe(false)});
 it('ignores mismatched previews and resets for a different device',()=>{const route=new DevicePresentationRoute();route.choose(device,{...panel,did:'other'});expect(route.changed).toBe(false);route.choose(device,panel);route.choose({...device,did:'other'},{...panel,did:'other'});expect(route.changed).toBe(false)});
});
