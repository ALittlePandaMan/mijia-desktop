import {describe,it,expect} from 'vitest';
import {cardDimensions,packCards,snapCardSize} from './card-size';
describe('card sizes',()=>{
 it('keeps the original medium and the shared gap',()=>{expect(cardDimensions(240,192,'small')).toEqual({width:240,height:90});expect(cardDimensions(240,192,'large')).toEqual({width:492,height:192});});
 it('pairs small cards and backfills holes without changing source order',()=>{const ids=['a','b','c','d'];const s=packCards(ids,{a:'small',b:'medium',c:'small',d:'large'},2);expect(s.map(x=>[x.id,x.column,x.row])).toEqual([['a',0,0],['b',1,0],['c',0,1],['d',0,2]]);expect(ids).toEqual(['a','b','c','d']);});
 it('never overlaps mixed sizes and wraps large cards',()=>{const ids=Array.from({length:100},(_,i)=>String(i));const cells=new Set();for(const p of packCards(ids,Object.fromEntries(ids.map((id,i)=>[id,(['small','medium','large'] as const)[i%3]])),3)){expect(p.column+p.columns).toBeLessThanOrEqual(3);for(let x=0;x<p.columns;x++)for(let y=0;y<p.rows;y++){const k=`${p.column+x}:${p.row+y}`;expect(cells.has(k)).toBe(false);cells.add(k);}}});
 it('snaps with hysteresis in both directions',()=>{expect(snapCardSize(240,90,240,192,'medium')).toBe('small');expect(snapCardSize(492,192,240,192,'small')).toBe('large');expect(snapCardSize(240,144,240,192,'medium')).toBe('medium');expect(snapCardSize(240,192,240,192,'large')).toBe('medium');});
});
