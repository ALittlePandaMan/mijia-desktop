import{describe,it,expect}from'vitest';import{HostFrames}from'./host-frames';import type{HostFrame,HostCard}from'./desktop-widgets';
const card=(id:string,revision:number)=>({view:{id,revision}}as HostCard);
const frame=(revision:number,cards:HostCard[],removed:string[]=[],reset=false):HostFrame=>({revision,cards,removed,reset,viewport:{monitor:'fixture',width:240,height:192,scale:1}});
describe('bounded host frames',()=>{
 it('coalesces drag hints and clears them on release',()=>{const q=new HostFrames();q.push({...frame(1,[]),hints:[{x:12,y:12,width:120,height:96,state:'valid'}]});expect(q.drain()?.hints?.length).toBe(1);q.push({...frame(2,[]),hints:[]});expect(q.drain()?.hints).toEqual([]);});
 it('merges a thousand same-card updates into one paint',()=>{const q=new HostFrames();for(let n=0;n<1000;n++)q.push(frame(n,[card('a',n)]));expect(q.bufferedIdentities).toBe(1);expect(q.drain()?.cards[0].view.revision).toBe(999);expect(q.drain()).toBeUndefined();});
 it('does not retain removed identities that were never painted',()=>{const q=new HostFrames();for(let n=0;n<1000;n++){q.push(frame(n*2,[card(String(n),n)]));q.push(frame(n*2+1,[],[String(n)]));}expect(q.bufferedIdentities).toBe(0);});
 it('preserves removals, resets and rejects an older host frame',()=>{const q=new HostFrames();q.push(frame(1,[card('a',1),card('b',1)],[],true));q.push(frame(2,[],['a']));expect(q.push(frame(1,[card('a',1)]))).toBe(false);let r=q.drain()!;expect(r.reset).toBe(true);expect(r.cards.map(c=>c.view.id)).toEqual(['b']);expect(r.removed).toEqual([]);q.push(frame(3,[card('c',3)],[],true));r=q.drain()!;expect(r.cards.map(c=>c.view.id)).toEqual(['c']);expect(r.removed).toEqual([]);});
});
