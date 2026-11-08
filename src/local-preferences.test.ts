import { describe, expect, it, vi } from 'vitest';
import { localDevices, mergeVisibleOrder, moveDeviceIds, PreferenceOperations, projectPreferences, type LocalPreferences, type PreferenceChange } from './local-preferences';
import type { Device, HomeCardEntry } from './types';

const empty = (): LocalPreferences => ({hideOffline:false,dragLocked:false,splitSwitches:false,hiddenDeviceIds:[],homeHiddenDeviceIds:[],roomOrders:{}});
const devices: Device[] = ['a','b','c','new'].map((did,index)=>({did,name:'相同名称',model:'test',online:index!==1,roomId:index===3?'other':'r',roomName:'房间'}));
const rooms = [{id:'r',name:'房间'},{id:'other',name:'其他'}];
const mobile = {roomIds:['r','other'],roomDevices:{r:['c','a','b'],other:['new']},frontDevices:[]};
const tick = async (): Promise<void> => { for(let i=0;i<10;i++)await Promise.resolve(); };
const deferred = () => { let resolve!:(value:LocalPreferences)=>void,reject!:(reason:unknown)=>void;return {promise:new Promise<LocalPreferences>((yes,no)=>{resolve=yes;reject=no;}),resolve,reject}; };

describe('本地显示与排序偏好',()=>{
  const physical:Device={...devices[0],did:'parent',controlGroup:'g',specType:'urn:miot-spec-v2:device:switch:0000A003:test:1'};
  const channels=[2,7,9].map((service,index)=>({...physical,did:`key-${index}`,controlServiceId:service,roomId:index===2?'other':'r'}));
  const switches=[physical,...channels,devices[2]];
  it('全屋隐藏独立于完全隐藏，房间和未分配视图仍保留设备',()=>{
    const view=projectPreferences(empty(),{operation:'setHomeHidden',did:'a',hidden:true});
    expect(localDevices(devices,mobile,rooms,'*',view).map(d=>d.did)).not.toContain('a');
    expect(localDevices(devices,mobile,rooms,'r',view).map(d=>d.did)).toContain('a');
    expect(localDevices(devices,mobile,rooms,'*',view,true).map(d=>d.did)).toContain('a');
    expect(localDevices(devices,mobile,[],'?',view).map(d=>d.did)).toContain('a');
    const restored=projectPreferences(view,{operation:'setHomeHidden',did:'a',hidden:false});
    expect(localDevices(devices,mobile,rooms,'*',restored)).toEqual(localDevices(devices,mobile,rooms,'*',empty()));
    expect(view.hiddenDeviceIds).toEqual([]);expect(view.homeHiddenDeviceIds).toEqual(['a']);
  });
  it('单键模式只展示真实通道、保留各自房间、继承父卡位置并支持来回切换',()=>{
    const order={roomIds:['r','other'],roomDevices:{r:['parent','c'],other:['key-2']},frontDevices:['c','parent']};
    const view=projectPreferences(empty(),{operation:'setSplitSwitches',value:true});
    expect(localDevices(switches,order,rooms,'*',view).map(d=>d.did)).toEqual(['c','key-0','key-1','key-2']);
    expect(localDevices(switches,order,rooms,'r',view).map(d=>d.did)).toEqual(['key-0','key-1','c']);
    expect(localDevices(switches,order,rooms,'other',view).map(d=>d.did)).toEqual(['key-2']);
    expect(localDevices(switches,order,rooms,'*',{...view,roomOrders:{'*':['parent','c']}}).map(d=>d.did)).toEqual(['key-0','key-1','key-2','c']);
    expect(localDevices(switches,order,rooms,'*',projectPreferences(view,{operation:'setSplitSwitches',value:false})).map(d=>d.did)).toEqual(['c','parent']);
  });
  it('全屋隐藏父卡覆盖拆分视图，单键隐藏仅影响对应按键',()=>{
    const view={...empty(),splitSwitches:true,homeHiddenDeviceIds:['parent']};
    expect(localDevices(switches,null,rooms,'*',view).map(d=>d.did)).toEqual(['c']);
    expect(localDevices(switches,null,rooms,'r',view).map(d=>d.did)).toEqual(['key-0','key-1','c']);
    expect(localDevices(switches,null,rooms,'*',{...view,homeHiddenDeviceIds:['key-1']}).map(d=>d.did)).toEqual(['key-0','key-2','c']);
  });
  it('模式限制按每个通道的实时语义过滤，未知值不伪装无线，整组模式不受影响',()=>{
    const cards=[{did:'key-0',modeAllowed:false},{did:'key-1',modeAllowed:null}] as HomeCardEntry[];
    const view={...empty(),splitSwitches:true};
    expect(localDevices(switches,null,rooms,'*',view,false,cards).map(d=>d.did)).toEqual(['key-1','key-2','c']);
    expect(localDevices(switches,null,rooms,'*',view,false,channels.map(d=>({did:d.did,modeAllowed:false}) as HomeCardEntry)).map(d=>d.did)).toEqual(['c']);
    expect(localDevices(switches,null,rooms,'*',empty(),false,cards).map(d=>d.did)).toEqual(['parent','c']);
    expect(localDevices(switches,null,rooms,'*',view,true,cards).map(d=>d.did)).toEqual(['key-0','key-1','key-2','c']);
  });
  it('拖拽使用插入让位，跨多卡往返和跨行仍保持中间设备相对顺序',()=>{
    const ids=['a','b','c','d','e','f','g','h'];
    const forward=moveDeviceIds(ids,'a','g')!;expect(forward).toEqual(['b','c','d','e','f','g','a','h']);
    expect(moveDeviceIds(forward,'a','b')).toEqual(ids);
    expect(moveDeviceIds(ids,'h','c')).toEqual(['a','b','h','c','d','e','f','g']);
    expect(moveDeviceIds(ids,'a','a')).toBeUndefined();expect(moveDeviceIds(ids,'missing','b')).toBeUndefined();
    expect(moveDeviceIds(['a','a','b'],'a','b')).toBeUndefined();expect(ids[0]).toBe('a');
  });
  it('提交可见排列时保留离线或手动隐藏卡的位置，不接受跨家庭或缺失草稿',()=>{
    const all=['a','hidden','b','offline','c'];
    expect(mergeVisibleOrder(all,['a','b','c'],['c','a','b'])).toEqual(['c','hidden','a','offline','b']);
    for(const draft of [['a','b'],['a','a','c'],['foreign','a','b']])expect(mergeVisibleOrder(all,['a','b','c'],draft)).toBeUndefined();
    expect(mergeVisibleOrder(['a','a'],['a'],['a'])).toBeUndefined();expect(mergeVisibleOrder(all,['missing'],['missing'])).toBeUndefined();
    expect(all).toEqual(['a','hidden','b','offline','c']);
  });
  it('默认遵循手机顺序，本地插入不修改手机数据和完整设备清单',()=>{
    const before=JSON.stringify({devices,mobile}); const base=localDevices(devices,mobile,rooms,'r',empty());
    expect(base.map(d=>d.did)).toEqual(['c','a','b']);
    const ids=moveDeviceIds(base.map(d=>d.did),'c','b')!;
    const view=projectPreferences(empty(),{operation:'setOrder',roomId:'r',deviceIds:ids});
    expect(localDevices(devices,mobile,rooms,'r',view).map(d=>d.did)).toEqual(['a','b','c']);
    expect(localDevices(devices,mobile,rooms,'*',view).map(d=>d.did)).toEqual(['c','a','b','new']);
    expect(JSON.stringify({devices,mobile})).toBe(before);
    expect(moveDeviceIds(base.map(d=>d.did),'a','a')).toBeUndefined();expect(moveDeviceIds(base.map(d=>d.did),'a','absent')).toBeUndefined();
  });
  it('离线隐藏和手动隐藏分开，恢复后保留原有位置和本地换位',()=>{
    const view={...empty(),hideOffline:true,hiddenDeviceIds:['a'],roomOrders:{r:['b','c','a']}};
    expect(localDevices(devices,mobile,rooms,'r',view).map(d=>d.did)).toEqual(['c']);
    const all=localDevices(devices,mobile,rooms,'r',view,true);
    expect(all.map(d=>d.did)).toEqual(['b','c','a']);
    const restored=projectPreferences(projectPreferences(view,{operation:'setHidden',did:'a',hidden:false}),{operation:'setHideOffline',value:false});
    expect(localDevices(devices,mobile,rooms,'r',restored).map(d=>d.did)).toEqual(['b','c','a']);
    expect(view.hiddenDeviceIds).toEqual(['a']);
  });
  it('隐藏合并父卡不会泄漏单独成员卡，同名设备独立处理',()=>{
    const inventory=[{...devices[0],did:'group',groupMembers:['a','b']},...devices];
    expect(localDevices(inventory,mobile,rooms,'*',{...empty(),hiddenDeviceIds:['group']}).map(d=>d.did)).toEqual(['c','new']);
    expect(localDevices(devices,mobile,rooms,'*',{...empty(),hiddenDeviceIds:['a']}).map(d=>d.did)).toEqual(['c','b','new']);
  });
  it('新设备继承手机顺序，过期和重复保存位置不会增加虚假卡，重置只清理排序',()=>{
    const view={...empty(),hideOffline:true,hiddenDeviceIds:['a'],roomOrders:{'*':['gone','a','a','c']}};
    expect(localDevices(devices,mobile,rooms,'*',view,true).map(d=>d.did)).toEqual(['a','c','b','new']);
    const reset=projectPreferences(view,{operation:'resetOrder'});
    expect(reset.hideOffline).toBe(true);expect(reset.hiddenDeviceIds).toEqual(['a']);expect(reset.roomOrders).toEqual({});
    expect(localDevices(devices,mobile,rooms,'?',empty())).toEqual([]);
  });
  it('在文件写入返回前立即投影，并将连续修改串行保存',async()=>{
    const first=deferred(),second=deferred(),calls:PreferenceChange[]=[];
    const ops=new PreferenceOperations(change=>{calls.push(change);return calls.length===1?first.promise:second.promise;},vi.fn());ops.reset(empty());
    ops.change({operation:'setHideOffline',value:true});ops.change({operation:'setDragLocked',value:true});
    expect(ops.view?.hideOffline).toBe(true);expect(ops.view?.dragLocked).toBe(true);expect(calls).toHaveLength(1);
    first.resolve({...empty(),hideOffline:true});await tick();expect(calls).toHaveLength(2);expect(ops.view?.dragLocked).toBe(true);
    second.resolve({...empty(),hideOffline:true,dragLocked:true});await tick();expect(ops.pendingCount).toBe(0);expect(ops.view?.dragLocked).toBe(true);
  });
  it('文件失败回退已保存值，保留后续用户操作并显示真实错误',async()=>{
    const first=deferred(),second=deferred();let calls=0;
    const ops=new PreferenceOperations(()=>++calls===1?first.promise:second.promise,vi.fn());ops.reset(empty());
    ops.change({operation:'setHideOffline',value:true});ops.change({operation:'setHidden',did:'a',hidden:true});
    first.reject({kind:'localPreferences',message:'disk failure'});await tick();expect(ops.view?.hideOffline).toBe(false);expect(ops.view?.hiddenDeviceIds).toEqual(['a']);expect(ops.error?.message).toBe('disk failure');
    second.resolve({...empty(),hiddenDeviceIds:['a']});await tick();expect(ops.view?.hiddenDeviceIds).toEqual(['a']);expect(ops.pendingCount).toBe(0);
  });
  it('家庭/账号切换后丢弃旧文件响应和队列，不能覆盖新上下文',async()=>{
    const old=deferred(),fresh=deferred();let calls=0;
    const ops=new PreferenceOperations(()=>++calls===1?old.promise:fresh.promise,vi.fn());ops.reset(empty());
    ops.change({operation:'setHidden',did:'old',hidden:true});ops.change({operation:'setDragLocked',value:true});
    ops.reset(empty());ops.change({operation:'setHideOffline',value:true});old.resolve({...empty(),hiddenDeviceIds:['old']});await tick();
    expect(calls).toBe(2);expect(ops.view?.hiddenDeviceIds).toEqual([]);expect(ops.view?.hideOffline).toBe(true);
    fresh.resolve({...empty(),hideOffline:true});await tick();expect(ops.pendingCount).toBe(0);
  });
  it('写入观察回调中的新操作不会触发并发或重复写入',async()=>{
    let saved=empty(),ops:PreferenceOperations;const calls:PreferenceChange[]=[];let append=true;
    ops=new PreferenceOperations(async change=>{calls.push(change);saved=projectPreferences(saved,change);return saved;},()=>{if(append&&ops.pendingCount===0){append=false;ops.change({operation:'setDragLocked',value:true});}});
    ops.reset(empty());ops.change({operation:'setHideOffline',value:true});await tick();
    expect(calls).toHaveLength(2);expect(ops.view?.dragLocked).toBe(true);expect(ops.pendingCount).toBe(0);
  });
});
