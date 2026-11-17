import { describe, expect, it } from 'vitest';
import { orderedDevices, orderedRooms, visibleHomeDevices } from './home-order';
import type { Device } from './types';

describe('cloud home order', () => {
  const devices = ['a', 'b', 'c'].map(did => ({ did, name: did, model: 'test', online: true, roomId: 'r', roomName: 'room' })) satisfies Device[];
  it('split choice retains light groups and refuses invalid, hidden or unrelated channels',()=>{
    const parent={...devices[0],did:'parent',controlGroup:'g',specType:'urn:miot-spec-v2:device:switch:0000A003:test:1'};
    const child={...parent,did:'channel',controlServiceId:7};
    const items:Device[]=[parent,child,{...child,did:'invalid',unsupportedReason:'invalid route'},{...child,did:'hidden',hiddenOnHome:true}];
    expect(visibleHomeDevices(items,true).map(d=>d.did)).toEqual(['channel']);
    expect(visibleHomeDevices([parent,{...child,unsupportedReason:'invalid route'}],true).map(d=>d.did)).toEqual(['parent']);
    expect(visibleHomeDevices([{...parent,specType:'urn:miot-spec-v2:device:fan:0000A005:test:1'},child],true).map(d=>d.did)).toEqual(['parent']);
    const grouped=[{...devices[0],did:'outer',groupMembers:['parent']},...items];
    expect(visibleHomeDevices(grouped,true).map(d=>d.did)).toEqual(['outer']);
    expect(items).toHaveLength(4);
  });
  it('single-key choice overrides only authenticated combined-view hiding, not other hide flags',()=>{
    const parent={...devices[0],did:'parent',controlGroup:'g',specType:'urn:miot-spec-v2:device:switch:0000A003:test:1'};
    const child={...parent,did:'channel',controlServiceId:7,hiddenOnHome:true,splitDisplayAvailable:true};
    const items=[parent,child,{...child,did:'private',splitDisplayAvailable:false}];
    expect(visibleHomeDevices(items).map(d=>d.did)).toEqual(['parent']);
    expect(visibleHomeDevices(items,true).map(d=>d.did)).toEqual(['channel']);
    expect(visibleHomeDevices([{...devices[0],did:'group',groupMembers:['parent']},...items],true).map(d=>d.did)).toEqual(['group']);
  });
  it('keeps actual room membership and appends absent rooms without adding unknown ids', () => {
    const rooms = [{ id: 'r1', name: 'one' }, { id: 'r2', name: 'two' }, { id: 'r3', name: 'three' }];
    expect(orderedRooms(rooms, { roomIds: ['r2', 'unknown', 'r2', 'r1'], roomDevices: {}, frontDevices: [] }).map(room => room.id)).toEqual(['r2', 'r1', 'r3']);
    expect(rooms[0].id).toBe('r1');
  });
  it('uses the selected view order without dropping, duplicating or mutating devices', () => {
    const order = { roomIds: ['r'], roomDevices: { r: ['c', 'missing', 'a', 'c'] }, frontDevices: ['b', 'aggregate-token'] };
    expect(orderedDevices(devices, order, '*').map(device => device.did)).toEqual(['b', 'c', 'a']);
    expect(orderedDevices(devices, order, 'r').map(device => device.did)).toEqual(['c', 'a', 'b']);
    expect(orderedDevices(devices, null, 'r')).toEqual(devices);
    expect(devices.map(device => device.did)).toEqual(['a', 'b', 'c']);
  });
  it('keeps front cards first then follows room order for the remaining inventory',()=>{
    const items=['new','b','a','d','c'].map(did=>({...devices[0],did}));
    const order={roomIds:['r2','r1'],roomDevices:{r1:['a','b'],r2:['c','d']},frontDevices:['b','missing','b']};
    expect(orderedDevices(items,order,'*').map(d=>d.did)).toEqual(['b','c','d','a','new']);
    expect(orderedDevices(items,null,'*')).toEqual(items);
  });
  it('follows authenticated visibility without removing routing data',()=>{
    const items:Device[]=[{...devices[0],did:'physical',controlGroup:'opaque',hiddenOnHome:true}, {...devices[0],did:'channel',controlGroup:'opaque',controlServiceId:7}, {...devices[0],did:'group',groupMembers:['member']}, {...devices[0],did:'member',hiddenOnHome:true}, {...devices[0],did:'unrelated'}];
    expect(visibleHomeDevices(items).map(d=>d.did)).toEqual(['channel','group','unrelated']);
    expect(items).toHaveLength(5);expect(items[0].did).toBe('physical');
  });
  it('merges validated split channels only when a usable parent is visible',()=>{
    const items:Device[]=[{...devices[0],did:'physical',controlGroup:'opaque'}, {...devices[0],did:'invalid-child',controlGroup:'opaque',controlServiceId:7,unsupportedReason:'invalid route'}, {...devices[0],did:'unsupported-group',groupMembers:['member'],unsupportedReason:'unsupported'}, {...devices[0],did:'member'}];
    expect(visibleHomeDevices(items).map(d=>d.did)).toEqual(['physical','unsupported-group','member']);
    expect(items).toHaveLength(4);
    expect(visibleHomeDevices(items.map(d=>d.did==='physical'?{...d,unsupportedReason:'parent route unavailable'}:d))).toHaveLength(4);
  });
  it('keeps orphan channels and separates identical service IDs on different parents',()=>{
    const items:Device[]=[{...devices[0],did:'parent',controlGroup:'g1'}, {...devices[0],did:'a',controlGroup:'g1',controlServiceId:2}, {...devices[0],did:'b',controlGroup:'g2',controlServiceId:2}, {...devices[0],did:'c',controlServiceId:2}];
    expect(visibleHomeDevices(items).map(d=>d.did)).toEqual(['parent','b','c']);
    const order={roomIds:['r'],roomDevices:{r:['b','a','parent']},frontDevices:[]};
    expect(orderedDevices(visibleHomeDevices(items),order,'r',items).map(d=>d.did)).toEqual(['b','parent','c']);
    expect(orderedDevices(visibleHomeDevices(items),{...order,frontDevices:['a','b']},'*',items).map(d=>d.did)).toEqual(['parent','b','c']);
  });
  it('stably appends devices without saved ranks across shuffled cloud pages',()=>{
    const items=['z-new','ranked','a-new'].map(did=>({...devices[0],did}));
    const order={roomIds:['r'],roomDevices:{r:[]},frontDevices:['ranked']};
    expect(orderedDevices(items,order,'*').map(d=>d.did)).toEqual(['ranked','a-new','z-new']);
    expect(orderedDevices([...items].reverse(),order,'*')).toEqual(orderedDevices(items,order,'*'));
  });
  it('shows a merged group once and retains its exact members only as routing records',()=>{
    const items:Device[]=[{...devices[0],did:'group',model:'any.vendor.group',groupMembers:['one','two']},{...devices[0],did:'one'},{...devices[0],did:'two'},{...devices[0],did:'unrelated',name:'one'}];
    expect(visibleHomeDevices(items).map(d=>d.did)).toEqual(['group','unrelated']);expect(items).toHaveLength(4);
    const order={roomIds:['r'],roomDevices:{r:['two','unrelated','group','one']},frontDevices:[]};
    expect(orderedDevices(visibleHomeDevices(items),order,'r',items).map(d=>d.did)).toEqual(['group','unrelated']);
  });
  it('projects nested groups and split channels into an available outer group',()=>{
    const items:Device[]=[{...devices[0],did:'outer',groupMembers:['inner','physical']},{...devices[0],did:'inner',groupMembers:['lamp']},{...devices[0],did:'lamp'},{...devices[0],did:'physical',controlGroup:'relay'},{...devices[0],did:'channel',controlGroup:'relay',controlServiceId:4}];
    expect(visibleHomeDevices(items).map(d=>d.did)).toEqual(['outer']);
    expect(orderedDevices(visibleHomeDevices(items),{roomIds:['r'],roomDevices:{r:['channel']},frontDevices:[]},'r',items).map(d=>d.did)).toEqual(['outer']);
  });
  it('keeps members when a group is absent, hidden or explicitly unusable',()=>{
    const member={...devices[0],did:'one'},group={...devices[0],did:'group',groupMembers:['one']};
    expect(visibleHomeDevices([member])).toEqual([member]);
    expect(visibleHomeDevices([{...group,hiddenOnHome:true},member])).toEqual([member]);
    expect(visibleHomeDevices([{...group,unsupportedReason:'route unavailable'},member])).toEqual([{...group,unsupportedReason:'route unavailable'},member]);
  });
  it('does not erase cyclic groups or guess membership from names, model or room',()=>{
    const items:Device[]=[{...devices[0],did:'a',groupMembers:['b']},{...devices[0],did:'b',groupMembers:['a']},{...devices[0],did:'similar',name:'a'}];
    expect(visibleHomeDevices(items)).toEqual(items);
    expect(visibleHomeDevices([{...devices[0],did:'other-home'}]).map(d=>d.did)).toEqual(['other-home']);
  });
  it('keeps both real groups with shared members and uses stable parent aliases',()=>{
    const items:Device[]=[{...devices[0],did:'group-b',groupMembers:['one']},{...devices[0],did:'one'},{...devices[0],did:'group-a',groupMembers:['one']}];
    expect(visibleHomeDevices(items).map(d=>d.did)).toEqual(['group-b','group-a']);
    const order={roomIds:['r'],roomDevices:{r:['one','group-b']},frontDevices:[]};
    expect(orderedDevices(visibleHomeDevices(items),order,'r',items).map(d=>d.did)).toEqual(['group-a','group-b']);
    expect(orderedDevices(visibleHomeDevices([...items].reverse()),order,'r',[...items].reverse()).map(d=>d.did)).toEqual(['group-a','group-b']);
  });
});
