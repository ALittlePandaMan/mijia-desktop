import {describe,it,expect} from 'vitest';
import {cardMetrics} from './ui/card-metrics';
import {swapCardIds,DRAG_START_DIP} from './card-interaction';
describe('card interaction policy',()=>{
 it('starts a drag after four logical pixels',()=>expect(DRAG_START_DIP).toBe(4));
 it('swaps two cards while every third origin is unchanged',()=>{expect(swapCardIds(['a','b','c'],'a','c',{},2)).toEqual(['c','b','a']);});
 it('accepts mixed heights only when the other half cell is free',()=>{expect(swapCardIds(['a','b'],'a','b',{a:'small',b:'medium'},3)).toEqual(['b','a']);expect(swapCardIds(['a','b','c'],'a','b',{a:'small',b:'medium',c:'small'},3)).toBeUndefined();});
 it('rejects oversized exchange and duplicate identities without modifying input',()=>{const ids=['a','b','c'];expect(swapCardIds(ids,'a','b',{a:'large'},3)).toBeUndefined();expect(ids).toEqual(['a','b','c']);expect(swapCardIds(['a','a'],'a','a',{},2)).toBeUndefined();});
 it('uses identical medium and large typography independently of outer width',()=>{for(const width of [120,180,240,320])expect(cardMetrics(width,width*.8,'medium')).toEqual(cardMetrics(width,width*.8,'large'));});
});
