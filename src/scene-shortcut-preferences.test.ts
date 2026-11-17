import {describe,it,expect} from 'vitest';
import {visibleSceneShortcuts,removeSceneShortcuts,addSceneShortcuts} from './scene-shortcut-preferences';
import {projectPreferences,type LocalPreferences} from './local-preferences';
const scenes=[{id:'a',name:'客厅任务',roomIds:['living'],icon:null,common:false},{id:'b',name:'卧室任务',roomIds:['bed'],icon:null,common:false},{id:'c',name:'第二个客厅任务',roomIds:['living'],icon:null,common:false}];
const empty={sceneIds:[],hiddenSceneIds:[]};
describe('desktop scene shortcuts',()=>{
 it('hides whole-home and scene tabs by default, keeps room defaults',()=>{expect(visibleSceneShortcuts(scenes,'*')).toEqual([]);expect(visibleSceneShortcuts(scenes,'@scenes')).toEqual([]);expect(visibleSceneShortcuts(scenes,'living').map(s=>s.id)).toEqual(['a','c']);});
 it('adds another room task once and restores a hidden task',()=>{const hidden=removeSceneShortcuts(empty,['a']);const added=addSceneShortcuts(hidden,['c'],['b','a','b']);expect(visibleSceneShortcuts(scenes,'living',added).map(s=>s.id)).toEqual(['c','b','a']);expect(added.hiddenSceneIds).toEqual([]);});
 it('removes a default task without the cloud default adding it back',()=>{const result=removeSceneShortcuts({sceneIds:['c','a','b'],hiddenSceneIds:[]},['a','b']);expect(visibleSceneShortcuts(scenes,'living',result).map(s=>s.id)).toEqual(['c']);expect(scenes).toHaveLength(3);});
 it('persists custom order and ignores removed cloud records',()=>{expect(visibleSceneShortcuts(scenes,'living',{sceneIds:['missing','c','a','c'],hiddenSceneIds:[]}).map(s=>s.id)).toEqual(['c','a']);expect(visibleSceneShortcuts(scenes,'*',{sceneIds:['b'],hiddenSceneIds:[]}).map(s=>s.id)).toEqual(['b']);});
 it('keeps room preference changes isolated and immutable',()=>{const view:LocalPreferences={hideOffline:false,dragLocked:false,splitSwitches:false,hiddenDeviceIds:[],homeHiddenDeviceIds:[],roomOrders:{},sceneShortcuts:{bed:{sceneIds:['b'],hiddenSceneIds:[]}}};const next=projectPreferences(view,{operation:'setSceneShortcuts',roomId:'living',sceneIds:['c'],hiddenSceneIds:['a']});expect(next.sceneShortcuts?.bed).toEqual(view.sceneShortcuts?.bed);expect(view.sceneShortcuts?.living).toBeUndefined();expect(next.sceneShortcuts?.living?.hiddenSceneIds).toEqual(['a']);});
});

it('fresh room layouts show every associated task, including non-common and multi-room tasks',()=>{
 const tasks=Array.from({length:40},(_,i)=>({id:String(i),name:'任务 '+i,roomIds:i<25?['living']:['bed'],common:false,icon:null}));
 tasks.push({id:'both',name:'跨房间',roomIds:['living','bed'],common:false,icon:null});
 expect(visibleSceneShortcuts(tasks,'living').map(s=>s.id)).toEqual([...tasks.slice(0,25).map(s=>s.id),'both']);
 expect(visibleSceneShortcuts(tasks,'bed',empty)).toHaveLength(16);
 expect(visibleSceneShortcuts(tasks,'*',empty)).toEqual([]);
 expect(visibleSceneShortcuts(tasks,'*',addSceneShortcuts(empty,[],['both','1'])).map(s=>s.id)).toEqual(['both','1']);
});
it('later cloud tasks join room defaults while explicitly hidden tasks remain hidden',()=>{
 const layout={sceneIds:['c'],hiddenSceneIds:['a']};
 expect(visibleSceneShortcuts([...scenes,{...scenes[0],id:'new'}],'living',layout).map(s=>s.id)).toEqual(['c','new']);
});
