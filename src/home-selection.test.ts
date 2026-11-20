import {afterEach,describe,expect,it,vi} from 'vitest';
import {preferredHome,rememberHome} from './home-selection';
import type {SessionView} from './types';

const session:SessionView={loggedIn:true,userId:'account-a',region:'cn'};
const homes=[{id:'first'},{id:'last'},{id:'monitor'}];
function storage(){
  const values=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
}
afterEach(()=>vi.unstubAllGlobals());

describe('home selection across openings',()=>{
  it('remembers only within the same account and region',()=>{
    storage();
    rememberHome(session,'last');
    expect(preferredHome(homes,{...session})).toBe('last');
    expect(preferredHome(homes,{...session,userId:'account-b'})).toBe('first');
    expect(preferredHome(homes,{...session,region:'other'})).toBe('first');
    expect(preferredHome(homes,{...session,loggedIn:false})).toBe('first');
  });
  it('honors a configured startup monitor without replacing the saved home',()=>{
    storage();
    rememberHome(session,'last');
    expect(preferredHome(homes,session,'first','monitor')).toBe('monitor');
    expect(preferredHome(homes,session,undefined,'removed')).toBe('last');
    expect(preferredHome(homes,session)).toBe('last');
  });
  it('falls back when access changes, the list is empty or storage is blocked',()=>{
    storage();
    rememberHome(session,'last');
    expect(preferredHome([homes[0]],session,'last')).toBe('first');
    expect(preferredHome([],session)).toBeUndefined();
    vi.stubGlobal('localStorage',{getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('denied');}});
    expect(()=>rememberHome(session,'last')).not.toThrow();
    expect(preferredHome(homes,session)).toBe('first');
  });
});
