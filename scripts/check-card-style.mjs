// Mock cards only. Uses the same disposable Vite/CDP setup as check-card-sizes.
import{pages,connect,until,delay}from'./perf/cdp.mjs';
import{writeFile,mkdir}from'node:fs/promises';
const client=await connect((await pages(9444))[0]),checks=[];
const check=(name,passed)=>{checks.push({name,passed:!!passed});if(!passed)throw Error(name);};
const inspect=()=>client.evaluate(`(()=>{const cards=[...document.querySelectorAll('.device-grid > .device-card')];return cards.map(card=>{const rect=card.getBoundingClientRect(),content=card.querySelector('.device-card-content'),control=card.querySelector('.device-shortcut'),selected=card.querySelector('.device-select-indicator'),style=getComputedStyle(content);const center=node=>{const r=node.getBoundingClientRect();return{x:r.x+r.width/2-rect.x,y:r.y+r.height/2-rect.y,w:r.width,h:r.height};};const dots=[...card.querySelectorAll('.card-resize-handle')].map(node=>{const h=getComputedStyle(node),dot=getComputedStyle(node,'::before');return{...center(node),axis:node.dataset.resizeAxis,cursor:h.cursor,color:dot.backgroundColor,width:dot.width,height:dot.height,visible:h.display!=='none'&&Number(h.opacity)>0};});return{id:card.dataset.deviceId,width:rect.width,height:rect.height,padding:[style.paddingTop,style.paddingRight,style.paddingBottom,style.paddingLeft],gap:style.columnGap,control:control?center(control):null,selected:center(selected),labelWidth:card.querySelector('.device-card-label').getBoundingClientRect().width,outline:getComputedStyle(card).outlineStyle,after:getComputedStyle(card,'::after').content,dots,handleVisible:dots.length>0&&dots.every(d=>d.visible)};});})()`);
try{
 await mkdir('.tools',{recursive:true});
 await client.call('Emulation.setFocusEmulationEnabled',{enabled:true});await client.call('Page.bringToFront');
 for(const width of[520,894,1600]){
  await client.call('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:false});await client.call('Page.navigate',{url:'http://127.0.0.1:1421/scripts/card-size-fixture.html'});await until(client,'!!window.cardFixture');
  await client.evaluate(`for(const id of['a','b','c'])window.cardFixture.setSize(id,'small');window.cardFixture.setSelected('a',true);`);
  const editing=await inspect(),a=editing.find(c=>c.id==='a'),b=editing.find(c=>c.id==='b'),empty=editing.find(c=>c.id==='c');
  check(`${width}px compact small-card padding`,a.padding.join(',')==='8px,10px,8px,10px'&&a.gap==='6px');
  check(`${width}px selected and unselected checks are vertically centered`,[a,b].every(c=>Math.abs(c.selected.y-c.height/2)<.5));
  check(`${width}px editing check shares shortcut alignment`,Math.abs(a.selected.x-a.control.x)<.5);
  check(`${width}px medium/large layout is untouched`,editing.find(c=>c.id==='d').padding.join(',')!=='8px,10px,8px,10px');
  await client.evaluate('window.cardFixture.setEdit(false)');const browsing=await inspect(),live=browsing.find(c=>c.id==='a');
  check(`${width}px browsing shortcut is vertically centered`,Math.abs(live.control.y-live.height/2)<.5);
  check(`${width}px cards without shortcuts reclaim the empty column`,browsing.find(c=>c.id==='c').labelWidth>empty.labelWidth+30);
  check(`${width}px browse resize handles stay hidden`,browsing.every(c=>!c.handleVisible));
  const hit=await client.evaluate(`(()=>{const b=document.querySelector('[data-device-id="a"] .device-shortcut'),r=b.getBoundingClientRect();return document.elementFromPoint(r.right-8,r.bottom-5)?.closest('.device-shortcut')===b;})()`);
  check(`${width}px shortcut wins overlapping resize hit regions`,hit);
 }
 await client.evaluate('window.cardFixture.setEdit(true)');
 check('editing cards contain no resize dots, handles or diagonal cursor',await client.evaluate(`!document.querySelector('.card-resize-handle,.widget-resize')&&[...document.querySelectorAll('.device-card *')].every(n=>!getComputedStyle(n).cursor.includes('resize'))`));
 await client.evaluate('window.cardFixture.setEdit(false);window.cardFixture.setDesktop(true)');
 const card=(await client.evaluate('window.cardFixture.snapshot()')).cards[0];await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:card.x+card.width/2,y:card.y+card.height/2,button:'none',buttons:0});await delay(160);
 check('desktop hover never creates resize affordances',await client.evaluate(`!document.querySelector('.card-resize-handle,.widget-resize')`));
 check('style changes retain every artwork and shortcut node',await client.evaluate('window.cardFixture.stable()'));
 check('style checks send no mock device action',await client.evaluate('window.cardFixture.snapshot().writes===0'));
 await client.call('Page.captureScreenshot',{format:'png'}).then(r=>writeFile('.tools/card-style-browser.png',Buffer.from(r.data,'base64')));console.log(JSON.stringify(checks));
}finally{await writeFile('.tools/card-style-browser-results.json',JSON.stringify({checks,nativeMouseTest:false,deviceWrites:0},null,2));client.close();}
