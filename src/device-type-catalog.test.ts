import {describe,it,expect} from 'vitest';
import catalog from './device-type-catalog.json';
import manifest from '../src-tauri/src/fixtures/catalog/provenance.json';
import {resolveDeviceCapabilities,capabilityBinding,readOnlyCategory} from './device-capabilities';
import type {DevicePanel} from './types';
const fixtures=import.meta.glob<{type:string;services:any[]}>('../src-tauri/src/fixtures/catalog/**/*.json',{eager:true,import:'default'});
function panel(row:typeof manifest.records[number]):DevicePanel{
 const raw=fixtures['../src-tauri/src/fixtures/catalog/'+row.file];
 return{did:'isolated-public-descriptor',model:row.model,specType:raw.type,services:raw.services.map((s:any)=>({siid:s.iid,name:s.type.split(':')[3],description:s.description??'',properties:(s.properties??[]).map((p:any)=>({siid:s.iid,piid:p.iid,name:p.type.split(':')[3],description:p.description??'',format:p.format,access:p.access??[],unit:p.unit,valueList:p['value-list'],valueRange:p['value-range']})),actions:(s.actions??[]).map((a:any)=>({siid:s.iid,aiid:a.iid,name:a.type.split(':')[3],description:a.description??'',in:a.in??[],out:a.out??[]}))}))};
}
describe('complete supplied device type catalog',()=>{
 it('keeps every screenshot entry and unresolved mappings explicit',()=>{expect(catalog.source.groups).toBe(16);expect(catalog.entries).toHaveLength(192);expect(new Set(catalog.entries.map(e=>`${e.group}/${e.label}`)).size).toBe(catalog.entries.length);expect(manifest.errors).toEqual([]);for(const entry of catalog.entries)expect(entry.mapping).toBe(entry.categories.length?'public-category':'unresolved')});
 it.each(manifest.records)('$category $model uses actual descriptor bindings only',row=>{
  const p=panel(row),before=JSON.stringify(p),caps=resolveDeviceCapabilities(p);expect(caps.version).toBe(2);expect(caps.family).toBeTruthy();
  for(const binding of caps.properties){const property=capabilityBinding(p,binding);expect(property).toBeDefined();if(binding.kind!=='command')expect(property!.access).toContain('read');if(binding.kind!=='reading'){expect(property!.access).toContain('write');expect(caps.readOnly).toBe(false)}}
  if(readOnlyCategory(p.specType)){if(caps.category!=='lock')expect(caps.properties.every(b=>b.kind==='reading')).toBe(true);else expect(caps.properties.filter(b=>b.kind!=='reading').every(b=>!['on','credential','lock-action'].includes(b.name))).toBe(true);expect(caps.actions).toEqual([])}
  for(const binding of caps.actions){const service=p.services.find(s=>s.siid===binding.siid)!;const action=service.actions.find(a=>a.aiid===binding.aiid)!;for(const id of action.in){const input=service.properties.find(p=>p.piid===id)!;expect(input.valueRange||input.valueList).toBeTruthy()}}
  expect(JSON.stringify(p)).toBe(before);expect(p.services.flatMap(s=>s.properties).some(p=>p.value!==undefined)).toBe(false);
 });
 it('never enables operations solely because a sensitive property is read/write',()=>{const row=manifest.records.find(r=>r.category==='charging-pile')!,p=panel(row);expect(resolveDeviceCapabilities(p).actions).toEqual([]);expect(readOnlyCategory(p.specType)).toBe(true)});
 it('requires bounded real input properties for manual feeding',()=>{const row=manifest.records.find(r=>r.category==='pet-feeder')!,p=panel(row),caps=resolveDeviceCapabilities(p);expect(caps.actions.some(a=>a.name==='pet-food-out')).toBe(true);const a=caps.actions.find(a=>a.name==='pet-food-out')!,s=p.services.find(s=>s.siid===a.siid)!,input=s.properties.find(p=>p.piid===s.actions.find(x=>x.aiid===a.aiid)!.in[0])!;input.valueRange=undefined;input.valueList=undefined;expect(resolveDeviceCapabilities(p).actions.some(a=>a.name==='pet-food-out')).toBe(false)});
});
