import {describe,it,expect} from 'vitest';
import {expansionPanel} from './fixtures/expansion-panels';
import {resolveDeviceCapabilities,capabilityProperties,readOnlyCategory} from './device-capabilities';
import {panelLayout} from './panel-layout';
import {fanLightPower,lightChannelBindings} from './light-bindings';
import {applianceDetailCategory,unavailableApplianceDetail} from './appliance-details';
import manifest from '../src-tauri/src/fixtures/expansion/provenance.json';
describe('unowned production models: public protocol compatibility, not physical claims',()=>{
 it('uses the pet and plant empty details even when the account has no Spec descriptor',()=>{
   for(const [model,category] of [
     ['pio.flowerpot.ivy01','flowerpot'],['petjc.litter_box.pro','cat-litter-box'],
     ['skyrc.pet_waterer.fres2','pet-drinking-fountain'],['skyrc.feeder.vfed','pet-feeder'],
     ['hfjh.fishbowl.v2','fish-tank'],['uvfive.s_lamp.slmap2','germicidal-lamp'],
   ]){
     const device={did:'device',model,name:'fixture',online:true,roomId:'',roomName:''};
     expect(applianceDetailCategory(device)).toBe(category);
     expect(unavailableApplianceDetail(applianceDetailCategory(device),model)).toBe(true);
   }
   expect(unavailableApplianceDetail('pet-toy','mpmiot.pettoy.v1')).toBe(false);
   expect(unavailableApplianceDetail('plant-monitor','hhcc.bleflowerpot.v2')).toBe(false);
 });
 it('uses the lighting page and keeps the independent light and fan endpoints',()=>{
   const panel=expansionPanel('yeelink.light.fancl8');
   const device={did:panel.did,model:panel.model,name:'fixture',online:true,roomId:'',roomName:''};
   expect(panelLayout(device,panel)).toBe('light');
   expect(lightChannelBindings(panel)[0].on).toMatchObject({siid:2,piid:1});
   expect(fanLightPower(panel)).toMatchObject({siid:3,piid:1});
 });
 it('adds hood speed and light without merging repeated stove channels',()=>{const p=expansionPanel('xiaomi.hood.jyjp2'),c=resolveDeviceCapabilities(p);expect(c.properties.some(b=>b.role==='fan-control.fan-level'&&b.kind==='enum')).toBe(true);expect(c.properties.find(b=>b.role==='light.on')?.kind).toBe('power');expect(capabilityProperties(p,'kitchen-stove.status').length).toBeGreaterThan(1);expect(c.actions).toEqual([]);});
 it('binds favorite motor service, filters and settings actually declared on purifier',()=>{const c=resolveDeviceCapabilities(expansionPanel('xiaomi.airp.mp5'));for(const role of ['air-purifier-favorite.fan-level','screen.on','air-purifier.uv','filter.filter-left-time'])expect(c.properties.some(b=>b.role===role)).toBe(true);expect(c.properties.some(b=>b.service==='filter-debug')).toBe(false);});
 it('keeps lock shortcuts read-only while explicitly enabling bounded ordinary settings',()=>{const p=expansionPanel('xiaomi.lock.m40'),c=resolveDeviceCapabilities(p);expect(readOnlyCategory(p.specType)).toBe(true);expect(c.properties.some(b=>b.role==='lock-volume-management.door-operation-volume'&&b.kind!=='reading')).toBe(true);expect(c.actions).toEqual([]);expect(c.properties.some(b=>b.name==='credential'||b.name==='anti-lock')).toBe(false);expect(c.events.some(e=>e.eiid===1020&&e.name==='lock-event')).toBe(true);});
 it('requires exact model and type for a private stove mapping and never exposes ignition',()=>{const p=expansionPanel('chunmi.i_stove.x1');expect(resolveDeviceCapabilities(p).properties.some(b=>b.name==='gas-stateleft')).toBe(true);expect(resolveDeviceCapabilities(p).properties.every(b=>b.kind==='reading')).toBe(true);expect(resolveDeviceCapabilities(p).actions).toEqual([]);p.model='other.i_stove.x1';expect(resolveDeviceCapabilities(p).properties.some(b=>b.service==='self')).toBe(false);});
 it('does not authorize duplicate event arguments or an absent event parameter',()=>{const p=expansionPanel('xiaomi.lock.s20pro');const s=p.services.find(s=>s.name==='lock')!,event=s.events!.find(e=>e.name==='lock-event')!;event.arguments=[999];expect(resolveDeviceCapabilities(p).events.some(e=>e.name==='lock-event')).toBe(false);});
 it.each(manifest.records)('$model only binds real schema IDs and retains absent values',row=>{const p=expansionPanel(row.model),c=resolveDeviceCapabilities(p);for(const b of c.properties){const s=p.services.find(s=>s.siid===b.siid)!;const property=s.properties.find(p=>p.piid===b.piid)!;expect(property.name).toBe(b.name);expect(property.value).toBeUndefined();}expect(row.physicalDeviceVerified).toBe(false);});
});
