import {describe,it,expect} from 'vitest';
import {WidgetRevisions,externalIntentSupersedes,widgetSizeAvailable,type WidgetGeometry} from './desktop-widgets';
describe('desktop card operation ordering',()=>{
 it('menu size choices respect both occupied halves and the right edge',()=>{
  const at=(column:number,halfRow=0,size:WidgetGeometry['size']='medium',monitor='one'):WidgetGeometry=>({monitor,x:12,y:12,width:240,size,grid:{preset:'6x4',column,halfRow,step:12}});
  expect(widgetSizeAvailable(at(0),'large',[at(1)])).toBe(false);expect(widgetSizeAvailable(at(0),'large',[at(2)])).toBe(true);
  expect(widgetSizeAvailable(at(5),'large',[])).toBe(false);expect(widgetSizeAvailable(at(0,1,'small'),'medium',[at(0,0,'small')])).toBe(false);
  expect(widgetSizeAvailable(at(0),'large',[at(1,0,'large','two')])).toBe(true);
 });
 it('ignores a stale poll after a newer intent or result',()=>{const gate=new WidgetRevisions();expect(gate.accept('home','light',30)).toBe(true);expect(gate.accept('home','light',29)).toBe(false);expect(gate.accept('home','light',30)).toBe(true);expect(gate.accept('home','light',31)).toBe(true);expect(gate.accept('home','light',30)).toBe(false);});
 it('does not mix devices or homes',()=>{const gate=new WidgetRevisions();expect(gate.accept('a','d',100)).toBe(true);expect(gate.accept('b','d',1)).toBe(true);expect(gate.accept('a','e',1)).toBe(true);expect(gate.accept('a','d',2)).toBe(false);});
 it('invalidates the previous account epoch',()=>{const gate=new WidgetRevisions();gate.accept('a','d',100);gate.clear();expect(gate.accept('a','d',1)).toBe(true);});
 it('keeps later local taps queued when acknowledging an earlier local send',()=>{expect(externalIntentSupersedes('main','main','on',false)).toBe(false);expect(externalIntentSupersedes('widget-a','widget-a','on','off')).toBe(false);});
 it('relinquishes a conflicting local operation to a newer foreign intent',()=>{expect(externalIntentSupersedes('main','widget-a','off',true)).toBe(true);expect(externalIntentSupersedes('widget-a','main','close',100)).toBe(true);expect(externalIntentSupersedes('main','widget-a','on',true)).toBe(false);});
 it('does not invent conflicting operations for passive snapshots',()=>{expect(externalIntentSupersedes('main',null,'off',true)).toBe(false);expect(externalIntentSupersedes('main','widget-a','on',undefined)).toBe(false);});
});
