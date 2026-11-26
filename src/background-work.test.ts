import {describe,it,expect} from 'vitest';
import {BackgroundWork,ResourceRevisions} from './background-work';
describe('background work',()=>{
 it('only notifies real transitions and releases subscribers',()=>{const gate=new BackgroundWork(),seen:boolean[]=[];const off=gate.subscribe(p=>seen.push(p));gate.setPaused(true);gate.setPaused(true);gate.setPaused(false);expect(seen).toEqual([true,false]);off();gate.setPaused(true);expect(gate.subscribers).toBe(0);expect(seen).toEqual([true,false]);});
 it('isolates windows and rejects stale or unsupported policies',()=>{const a=new ResourceRevisions(),b=new ResourceRevisions();const state={version:1,revision:5,visible:false,refreshMs:120000};expect(a.accept(state)).toBe(true);expect(a.accept({...state,revision:4,visible:true})).toBe(false);expect(a.accept({...state,version:2,revision:6})).toBe(false);expect(b.accept({...state,revision:1})).toBe(true);});
});
