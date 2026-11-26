import {beforeEach,describe,expect,it,vi} from 'vitest';
import {ResourceRevisions,type ResourceState} from './background-work';
import {listenResourceState} from './resource-events';

const bus=vi.hoisted(()=>({listeners:new Set<{target?:string;accept:(event:{payload:unknown})=>void}>()}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn(async(_event:string,accept:(event:{payload:unknown})=>void,options?:{target:string})=>{
 const entry={target:options?.target,accept};bus.listeners.add(entry);return()=>bus.listeners.delete(entry);
})}));
const state=(revision:number,visible:boolean):ResourceState=>({version:1,revision,visible,refreshMs:30000});
function emit(label:string,value:ResourceState){for(const entry of bus.listeners)if(!entry.target||entry.target===label)entry.accept({payload:value});}
function surface(){const revisions=new ResourceRevisions(),seen:boolean[]=[];return{seen,accept(value:ResourceState){if(revisions.accept(value))seen.push(value.visible);}};}

describe('window resource event ownership',()=>{
 beforeEach(()=>bus.listeners.clear());
 it('fullscreen covering desktop hosts cannot pause the main monitor or poison its revision',async()=>{
  const main=surface(),a=surface(),b=surface();await listenResourceState('main',main.accept);await listenResourceState('widget-a',a.accept);await listenResourceState('widget-b',b.accept);
  emit('main',state(2,true));emit('widget-a',state(100,true));emit('widget-b',state(500,true));
  for(let i=0;i<20;i++){emit('widget-a',state(101+i*2,false));emit('widget-b',state(501+i*2,false));emit('widget-a',state(102+i*2,true));emit('widget-b',state(502+i*2,true));}
  expect(main.seen).toEqual([true]);expect(a.seen).toHaveLength(41);expect(b.seen).toHaveLength(41);
  emit('main',state(3,false));emit('widget-a',state(1000,true));expect(main.seen).toEqual([true,false]);
  emit('main',state(4,true));emit('main',state(3,false));expect(main.seen).toEqual([true,false,true]);
 });
 it('main visibility cannot wake a hidden host and disposed listeners stay removed',async()=>{
  const host=surface(),off=await listenResourceState('widget-a',host.accept);emit('widget-a',state(1,false));emit('main',state(200,true));expect(host.seen).toEqual([false]);
  emit('widget-a',state(2,true));expect(host.seen).toEqual([false,true]);off();emit('widget-a',state(3,false));expect(host.seen).toEqual([false,true]);expect(bus.listeners.size).toBe(0);
 });
});
