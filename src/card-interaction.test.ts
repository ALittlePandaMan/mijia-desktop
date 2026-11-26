import {describe,it,expect} from 'vitest';
import {cardMetrics} from './ui/card-metrics';
import {insertCardIds,DRAG_START_DIP} from './card-interaction';
import {packCards} from './card-size';
describe('card interaction policy',()=>{
 it('starts a drag after four logical pixels',()=>expect(DRAG_START_DIP).toBe(4));
 it('moves only the range between the origin and insertion',()=>{
  const ids=['a','b','c','d','e','f'];
  expect(insertCardIds(ids,'a','d')).toEqual(['b','c','d','a','e','f']);
  expect(insertCardIds(ids,'e','b','before')).toEqual(['a','e','b','c','d','f']);
 });
 it('packs a large card into a range containing medium and small cards',()=>{
  const ids=insertCardIds(['a','b','c','d','e'],'a','c')!;
  expect(ids).toEqual(['b','c','a','d','e']);
  expect(packCards(ids,{a:'large',e:'small'},3)).toContainEqual({id:'a',row:2,column:0,rows:2,columns:2});
 });
 it('preserves the original order when the target is missing, duplicate or already adjacent',()=>{
  const ids=['a','b','c'];
  expect(insertCardIds(ids,'a','b','before')).toBeUndefined();
  expect(insertCardIds(ids,'a','unknown')).toBeUndefined();
  expect(insertCardIds(['a','a'],'a')).toBeUndefined();
  expect(insertCardIds(ids,'a')).toEqual(['b','c','a']);
  expect(ids).toEqual(['a','b','c']);
 });
 it('uses identical medium and large typography independently of outer width',()=>{for(const width of [120,180,240,320])expect(cardMetrics(width,width*.8,'medium')).toEqual(cardMetrics(width,width*.8,'large'));});
});
