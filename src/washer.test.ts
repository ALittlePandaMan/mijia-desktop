import {describe,expect,it} from 'vitest';
import config from '../src-tauri/src/fixtures/washer-config.json';
import rawPanel from '../src-tauri/src/fixtures/washer-panel.json';
import {changeWasherDraft,newWasherDraft,washerConditions,washerFields,washerFieldText,washerMinutes,washerProgramCatalog,washerPrograms,type WasherConfigReport} from './washer';
import type {DevicePanel} from './types';
const panel=rawPanel as DevicePanel;
const report:WasherConfigReport={did:panel.did,model:panel.model,firmware:'2.2.5',fetchedAt:1,config:config as unknown as WasherConfigReport['config']};
const programs=washerPrograms(report,panel);
describe('published washer programs',()=>{
 it('uses Chinese labels from the model metadata and keeps English protocol meanings intact',()=>{
  const modeChoices=[
   {value:13,description:'Golden Wash',localizedDescription:'黄金洗'},
   {value:15,description:'Golden Dry'},
   {value:18,description:'Wash Dry',localizedDescription:'智能洗烘'},
   {value:29,description:'Untranslated model-specific mode'},
   {value:30,description:'Mode30',localizedDescription:'模式30'},
  ];
  const localized={...panel,services:panel.services.map(service=>({...service,properties:service.properties.map(property=>
   property.name==='mode'?{...property,valueList:modeChoices}:property)}))};
  const programs=washerProgramCatalog(undefined,localized);
  expect(programs.map(program=>program.title)).toEqual(['黄金洗','黄金烘','智能洗烘','Untranslated model-specific mode']);
  expect(programs.map(program=>[program.value,program.meaning])).toEqual(modeChoices.slice(0,-1).map(choice=>[choice.value,choice.description]));
 });
 it('uses the model’s mode values without creating extra programs or a second writable binding',()=>{
  const standard={...panel,services:panel.services.map(service=>({...service,properties:service.properties.map(property=>property.name==='mode'
   ?{...property,valueList:[{value:93,description:'Quick Wash'},{value:45,description:'Standard'},{value:1,description:'Standby'},{value:2,description:'Wash'},{value:4,description:'Wash Paused'}]}:property)}))};
  const choices=washerProgramCatalog(undefined,standard);
  expect(choices.map(program=>[program.value,program.title,program.published?.siid])).toEqual([[93,'快速洗',2],[45,'标准洗',2]]);
  const other=standard.services.find(service=>service.name==='washer')!;
  expect(washerProgramCatalog(undefined,{...standard,services:[...standard.services,{...other,siid:80,properties:other.properties.map(p=>({...p,siid:80}))}]})).toEqual([]);
 });
 it('displays confirmed enum values from a public descriptor and keeps generic program edits read-only',()=>{
  const confirmed:DevicePanel={...panel,services:panel.services.map(service=>({...service,properties:service.properties.map(property=>{
   if(property.name==='target-temperature')return {...property,code:0,value:4,valueList:[{value:1,description:'Cold Water'},{value:4,description:'40 Celsius'},{value:6,description:'60 Celsius'}]};
   if(property.name==='spin-speed')return {...property,code:0,value:3,valueList:[{value:0,description:'No Spin'},{value:3,description:'800rpm'}]};
   return property;
  })}))};
  const selected=washerProgramCatalog(undefined,confirmed).find(program=>program.meaning==='Down Coat')!;
  const draft=newWasherDraft(undefined,selected,confirmed);
  expect(draft.values).toMatchObject({'target-temperature':4,'spin-speed':3});
  const fields=washerFields(undefined,selected,confirmed,draft);
  expect(washerFieldText(fields.find(field=>field.name==='target-temperature')!)).toBe('40℃');
  expect(washerFieldText(fields.find(field=>field.name==='spin-speed')!)).toBe('800转/分');
  expect(changeWasherDraft(undefined,selected,confirmed,draft,'target-temperature',6)).toBe(draft);
 });
});
describe('firmware-specific washer metadata and local-only program drafts',()=>{
 it('binds all 26 actual programs by semantic enum rather than config or array index',()=>{
  expect(programs).toHaveLength(26);expect(programs.slice(0,5).map(p=>p.title)).toEqual(['智能洗','快速洗','单烘干','轻干洗','随心洗烘']);
  expect(programs.slice(0,5).map(p=>p.value)).toEqual([24,3,8,17,58]);
  expect(washerPrograms(report,{...panel,did:'wrong'})).toEqual([]);
  const noModes={...panel,services:panel.services.map(s=>({...s,properties:s.properties.filter(p=>p.name!=='mode')}))};expect(washerPrograms(report,noModes)).toEqual([]);
 });
 it('defaults are copied from program config, not unavailable or last-reported values',()=>{
  const program=programs.find(p=>p.name==='smart')!,before=JSON.stringify(report),draft=newWasherDraft(report,program),fields=washerFields(report,program,panel,draft);
  expect(draft.values.temperature).toBe(40);expect(draft.values.speed).toBe(800);expect(draft.values.rinsh).toBe(2);
  expect(fields.find(f=>f.name==='temperature')?.property?.piid).toBe(5);
  expect(fields.find(f=>f.name==='temperature')?.choices).toEqual([0,40,60]);
  expect(fields.find(f=>f.name==='temperature')?.property?.value).toBeNull();
  draft.values.temperature=60;expect(JSON.stringify(report)).toBe(before);
 });
 it('drying restricts quick-wash speed and reselects its actual configured default',()=>{
  const program=programs.find(p=>p.name==='quickWash')!,draft=newWasherDraft(report,program);
  const next=changeWasherDraft(report,program,panel,draft,'dry',1),speed=washerFields(report,program,panel,next).find(f=>f.name==='speed')!;
  expect(speed.choices).toEqual([800]);expect(next.values.speed).toBe(800);expect(draft.values.dry).toBe(0);
  expect(changeWasherDraft(report,program,panel,next,'speed',1200)).toBe(next);
 });
 it('night mode constrains spin options without sending device parameters',()=>{
  const program=programs.find(p=>p.name==='smart')!,draft=newWasherDraft(report,program),next=changeWasherDraft(report,program,panel,draft,'night',true);
  expect(next.values.speed).toBe(600);expect(washerFields(report,program,panel,next).find(f=>f.name==='speed')?.choices).toEqual([0,400,600]);
  expect(changeWasherDraft(report,program,panel,next,'unknown',true)).toBe(next);
 });
 it('applies all forced dependent defaults in the same change, rather than only the first',()=>{
  const program={...programs[0],items:[{propertyName:'dry',data:[0,1],defaultValue:0,conditions:[]},{propertyName:'speed',data:[400,800],defaultValue:800,conditions:[]},{propertyName:'shakeTime',data:[0,1],defaultValue:0,conditions:[]}]};
  const draft={program:program.name,values:{dry:0,speed:400,shakeTime:1}},next=changeWasherDraft(report,program,panel,draft,'dry',1);
  expect(next.values).toEqual({dry:1,speed:800,shakeTime:0});expect(draft.values.speed).toBe(400);
 });
 it('does not apply another model’s temperature/rinse reset to the exact 42 washer',()=>{
  const program={...programs[0],items:[{propertyName:'temperature',data:[40,60],defaultValue:40,conditions:[]},{propertyName:'rinsh',data:[1,2,3],defaultValue:3,conditions:[]}]};
  const next=changeWasherDraft(report,program,panel,{program:program.name,values:{temperature:40,rinsh:1}},'temperature',60);
  expect(next.values.rinsh).toBe(1);
 });
 it('field visibility changes through configured conditions and unavailable properties remain disabled',()=>{
  const program=programs.find(p=>p.name==='smart')!,draft=newWasherDraft(report,program);
  const at60=changeWasherDraft(report,program,panel,draft,'temperature',60);
  expect(washerFields(report,program,panel,at60).find(f=>f.name==='highWaterLevel')?.hidden).toBe(true);
  const missing={...panel,services:panel.services.map(s=>({...s,properties:s.properties.filter(p=>p.name!=='target-temperature')}))};
  expect(washerFields(report,program,missing,draft).find(f=>f.name==='temperature')?.disabled).toBe(true);
 });
 it('condition ordering, stop, merge, prior results and named definitions preserve plugin semantics',()=>{
  expect(washerConditions(['a',{key:'x',keyValue:3,operator:'=',merge:true,data:[4]}],{x:3},{a:{key:'x',keyValue:0,operator:'>',next:true,defaultValue:4}})).toEqual({defaultValue:4,data:[4]});
  expect(washerConditions([{key:'x',keyValue:3,operator:'=',next:true,data:[1]},{key:0,keyValue:true,operator:'&',data:[2]}],{x:3})).toEqual({data:[2]});
  expect(washerConditions([{key:'x',keyValue:3,operator:'=',stop:true,data:[1]}],{x:3})).toEqual({});
  expect(washerConditions([{key:'x',keyValue:3,operator:'runScript',data:[9]}],{x:3})).toEqual({});
 });
 it('display units and time use the selected per-program item data',()=>{
  const program=programs.find(p=>p.name==='quickWash')!,draft=newWasherDraft(report,program),fields=washerFields(report,program,panel,draft);
  expect(washerFieldText(fields.find(f=>f.name==='temperature')!)).toBe('常温');expect(washerFieldText(fields.find(f=>f.name==='dry')!)).toBe('不烘干');
  expect(washerMinutes(program,fields)).toBe(15);
  expect(washerFieldText(fields.find(f=>f.name==='shakeTime')!,2)).toBe('2小时');
 });
});
