import {expect,it} from 'vitest';
import {IdentityIndex} from './identity-index';

it('keeps the same first match as Array.find, including duplicate IDs',()=>{
 const first={did:'one',value:1},rows=[first,{did:'one',value:2},{did:'two',value:3}],index=new IdentityIndex<typeof first>();
 expect(index.find(rows,'one')).toBe(first);expect(index.find(rows,'two')).toBe(rows[2]);expect(index.find(rows,'missing')).toBeUndefined();
});
it('replaces old device bindings when a new inventory snapshot arrives',()=>{
 const index=new IdentityIndex<{did:string;value:number}>(),before=[{did:'one',value:1}],after=[{did:'one',value:2}];
 expect(index.find(before,'one')).toBe(before[0]);expect(index.find(after,'one')).toBe(after[0]);expect(index.find([],'one')).toBeUndefined();
});
it('clears the last household on reset without leaking a missing identity',()=>{
 const index=new IdentityIndex<{did:string}>(),rows=[{did:'one'}];index.find(rows,'one');
 expect(index.find(undefined,'one')).toBeUndefined();expect(index.find(rows,undefined)).toBeUndefined();expect(index.find(rows,'one')).toBe(rows[0]);
});
