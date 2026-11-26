import {describe,it,expect} from 'vitest';
import {mediaSpecPanel,televisionSample} from './fixtures/television-sample';
import mediaSpecs from './fixtures/media-remote-specs.json';
import gimiSpec from '../src-tauri/src/fixtures/compatibility/projector--gimi.projector.fm01.json';
import actualPanel from './fixtures/television-xiaomi-mih1-panel.json';
import type {DevicePanel} from './types';
import {televisionCommand,televisionPageEligible,televisionRoles,televisionSettings} from './television';
describe('media remotes use published description bindings',()=>{
 it('recognizes all eleven controls from the actual authenticated mih1 description',()=>{const p=actualPanel as unknown as DevicePanel;expect(televisionRoles.every(role=>televisionCommand(p,role)?.kind==='action')).toBe(true);});
 it('binds all eleven controls to the actual published 4kh1 actions',()=>{const p=televisionSample();expect(televisionRoles.map(role=>{const c=televisionCommand(p,role);return c?.kind==='action'?[c.action.siid,c.action.aiid]:null;})).toEqual([[7,1],[7,11],[7,12],[7,8],[7,6],[7,10],[7,7],[7,9],[7,2],[7,5],[7,3]]);});
 it('preserves high service/action IDs and rejects ambiguous services and actions',()=>{const p=televisionSample(),s=p.services.find(s=>s.name==='remote-control')!;s.siid=1234;for(const a of s.actions){a.siid=1234;a.aiid+=300;}const c=televisionCommand(p,'center');expect(c?.kind==='action'&&[c.action.siid,c.action.aiid]).toEqual([1234,310]);s.actions.push({...s.actions.find(a=>a.name==='press-ok')!});expect(televisionCommand(p,'center')).toBeUndefined();p.services.push(structuredClone(s));expect(televisionCommand(p,'home')).toBeUndefined();});
 it('keeps verified IR models on their key-table transport and rejects mismatched or unsupported panels',()=>{
  for(const model of ['miir.tv.ir01','miir.stb.ir01','miir.tvbox.ir01','miir.projector.ir01','miir.remote.ir01']){
   const p=televisionSample();p.model=model;expect(televisionCommand(p,'up')).toBeUndefined();
  }
  const p=televisionSample();
  expect(televisionPageEligible({did:'other',model:p.model},p)).toBe(false);
  p.unsupportedReason='unsupported';
  expect(televisionCommand(p,'up')).toBeUndefined();
 });
 it('binds TV-box actions and legacy third-party projector buttons without using HDMI settings as keys',()=>{
  const box=mediaSpecPanel('xiaomi.tvbox.5b1',mediaSpecs['xiaomi.tvbox.5b1']);
  expect(televisionRoles.every(role=>televisionCommand(box,role)?.kind==='action')).toBe(true);
  const projector=mediaSpecPanel('gimi.projector.fm01',gimiSpec);
  const key=televisionCommand(projector,'center');
  expect(key?.kind==='action'&&[key.service.name,key.action.name,key.inputs]).toEqual(['remote-key','ok',[]]);
  expect(televisionSettings(projector).source?.name).toBe('input-control');
 });
 it('maps the same projector key to each model’s actual action parameter',()=>{
  for(const [model,home,up] of [['xiaomi.projector.rm03',0,5],['fengmi.projector.015fo6',2,8]] as const){
   const panel=mediaSpecPanel(model,mediaSpecs[model]);
   const command=televisionCommand(panel,'home');
   expect(command?.kind==='action'&&[command.service.name,command.action.name,command.inputs]).toEqual(['virtual-remote','press-button',[home]]);
   expect(televisionCommand(panel,'up')).toMatchObject({inputs:[up]});
   const service=panel.services.find(s=>s.name==='virtual-remote')!;
   const keyTable=service.properties.find(p=>p.name==='button-type')!;
   keyTable.valueList!.push({description:'HOME',value:127});
   expect(televisionCommand(panel,'home')).toBeUndefined();
   expect(televisionCommand(panel,'up')).toMatchObject({inputs:[up]});
  }
 });
 it('uses the documented alternate TV service and keeps unbound directions disabled',()=>{
  const panel=mediaSpecPanel('xiaomi.tv.mitvsp',mediaSpecs['xiaomi.tv.mitvsp']);
  expect(televisionCommand(panel,'power')).toMatchObject({kind:'property',property:{name:'on'},value:true});
  expect(televisionCommand(panel,'up')).toBeUndefined();
  expect(televisionCommand(panel,'volume-up')).toMatchObject({kind:'property',value:51});
 });
 it('only uses parameterless supported real remote commands',()=>{const p=televisionSample(),s=p.services.find(s=>s.name==='remote-control')!;s.actions.find(a=>a.name==='press-home')!.in=[1];s.actions.find(a=>a.name==='press-menu')!.unsupportedReason='not supported';expect(televisionCommand(p,'home')).toBeUndefined();expect(televisionCommand(p,'menu')).toBeUndefined();});
 it('retains shutdown and real one-step volume when navigation is unavailable',()=>{const p=televisionSample();p.services=p.services.filter(s=>s.name!=='remote-control');const power=televisionCommand(p,'power');expect(power?.kind==='action'&&[power.action.siid,power.action.aiid]).toEqual([2,1]);const c=televisionCommand(p,'volume-up');expect(c?.kind==='property'&&[c.property.siid,c.property.piid,c.value]).toEqual([4,1,51]);expect(televisionCommand(p,'center')).toBeUndefined();const volume=p.services.find(s=>s.name==='speaker')!.properties.find(p=>p.name==='volume')!;volume.value=100;expect(televisionCommand(p,'volume-up')).toBeUndefined();volume.code=-6;expect(televisionCommand(p,'volume-down')).toBeUndefined();});
});
