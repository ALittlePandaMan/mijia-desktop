// Actual App/shared card/desktop host with exclusively local mock transports.
import{pages,connect,until,delay}from'./perf/cdp.mjs';
import{writeFile}from'node:fs/promises';
const c=await connect((await pages(9444))[0]),checks=[];
const check=(name,ok)=>{checks.push({name,passed:!!ok});if(!ok)throw Error(name);};
const caption=id=>c.evaluate(`document.querySelector('[data-device-id=${id}] .device-room')?.textContent`);
const state=()=>c.evaluate('window.templateFixture.snapshot()');
const click=async selector=>{const r=await c.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of['mousePressed','mouseReleased'])await c.call('Input.dispatchMouseEvent',{type,x:r.x,y:r.y,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});};
const btn=(id,key='power')=>`[data-device-id=${id}] [data-control-id=${key}] button`;
const slider=async(value)=>c.evaluate(`(()=>{const n=document.querySelector('[data-device-id=a] input');n.dispatchEvent(new PointerEvent('pointerdown',{pointerId:8,button:0,bubbles:true}));n.value='${value}';n.dispatchEvent(new Event('input'));window.dispatchEvent(new PointerEvent('pointerup',{pointerId:8}));n.dispatchEvent(new Event('change'));})()`);
const load=async desktop=>{await c.call('Page.navigate',{url:`http://127.0.0.1:1421/scripts/card-template-fixture.html?captions=1${desktop?'&desktop=1':''}`});await until(c,'!!window.templateFixture&&document.querySelectorAll(".has-card-template").length===5');await delay(150);await c.evaluate('window.templateFixture.setDelay(60);window.templateFixture.setCloudLag(10000)');};
try{
 await c.call('Emulation.setFocusEmulationEnabled',{enabled:true});await c.call('Emulation.setDeviceMetricsOverride',{width:1100,height:1100,deviceScaleFactor:1,mobile:false});
 for(const desktop of[false,true]){const p=desktop?'desktop':'main';await load(desktop);
  check(`${p} starts from confirmed ordered switch descriptions`,(await caption('g'))==='客厅 | 关 开 开');
  const group='[data-device-id=g] .device-shortcut';await click(group);check(`${p} all-on caption changes in the interaction frame`,(await caption('g'))==='客厅 | 开 开 开');
  await click(group);check(`${p} all-off keeps the protected third key on`,(await caption('g'))==='客厅 | 关 关 开');
  await delay(180);check(`${p} old acknowledgements leave the latest description and button consistent`,(await caption('g'))==='客厅 | 关 关 开'&&await c.evaluate(`document.querySelector('${group}').getAttribute('aria-pressed')==='false'`));
  for(const size of['small','medium','large']){await c.evaluate(`window.templateFixture.setSize('g','${size}')`);await delay(330);check(`${p} ${size} preserves the same local switch description`,(await caption('g'))==='客厅 | 关 关 开');}
  await slider(67);check(`${p} brightness caption and control share one local target`,(await caption('a'))==='客厅 | 67%'&&await c.evaluate('document.querySelector("[data-device-id=a] .card-control-value").textContent==="67%"'));
  await click(btn('b','temperature')+':last-child');check(`${p} temperature caption updates without changing indoor temperature`,(await caption('b'))==='客厅 | 24℃ 24℃');
  await click('[data-device-id=c] .card-control-choice:nth-child(2)');check(`${p} mode description uses its authenticated label immediately`,(await caption('c'))==='客厅 | 睡眠');
  await click(btn('d','sweep'));check(`${p} action effect updates description and next button together`,(await caption('d'))==='客厅 | 清扫中'&&await c.evaluate('document.querySelector("[data-device-id=d] .card-control-action-label").textContent==="暂停"'));
  await click(btn('d','sweep'));check(`${p} immediate action reversal updates the description`,(await caption('d'))==='客厅 | 已暂停');
  check(`${p} unrelated status text is preserved`,(await caption('f'))==='客厅 | 连接设备数 35');
  await c.evaluate('window.captionInput=document.querySelector("[data-device-id=a] input");window.captionArt=document.querySelector("[data-device-id=a] .device-artwork")');
  await c.evaluate('document.documentElement.dataset.theme="dark"');await slider(72);check(`${p} dark caption updates reuse input and image nodes`,(await caption('a'))==='客厅 | 72%'&&await c.evaluate('window.captionInput===document.querySelector("[data-device-id=a] input")&&window.captionArt===document.querySelector("[data-device-id=a] .device-artwork")'));
  check(`${p} no operation notification prose is displayed`,await c.evaluate('![...document.querySelectorAll(".device-card")].some(n=>/待确认|操作失败|操作成功/.test(n.textContent))'));
  await c.call('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(`.tools/card-captions-${p}.png`,Buffer.from(r.data,'base64')));
  await load(desktop);await c.evaluate('window.templateFixture.failReads("a")');await slider(80);check(`${p} read failure case first shows the local description`,(await caption('a'))==='客厅 | 80%');await delay(1250);
  check(`${p} first read error rolls description and slider back together`,(await caption('a'))==='客厅 | 45%'&&await c.evaluate('document.querySelector("[data-device-id=a] .card-control-value").textContent==="45%"'));
  await load(desktop);await c.evaluate('window.templateFixture.failReads("g")');await click(group);await delay(1250);check(`${p} failed aggregate read restores per-key descriptions and button`,(await caption('g'))==='客厅 | 关 开 开'&&await c.evaluate(`document.querySelector('${group}').getAttribute('aria-pressed')==='false'`));
  await load(desktop);await slider(65);await delay(1400);check(`${p} a successful old reading is not treated as an error`,(await caption('a'))==='客厅 | 65%');
  const prior=(await state()).writes.filter(w=>w.did==='a').at(-1);await slider(85);await c.evaluate(`window.templateFixture.emitReadFailure('a','2:2',0)`);check(`${p} obsolete remote failures cannot erase a newer display target`,(await caption('a'))==='客厅 | 85%'&&!!prior);
  if(!desktop){await c.evaluate('window.templateFixture.detailWrite("a","2:2",91)');check('main detail intention updates card description and controls together',(await caption('a'))==='客厅 | 91%'&&await c.evaluate('document.querySelector("[data-device-id=a] .card-control-value").textContent==="91%"'));}
  check(`${p} control operation never opens details or starts card dragging`,(await state()).opens===0&&(await state()).drags===0);
  await load(desktop);
  const began=Date.now();
  await c.evaluate('window.templateFixture.externalSwitch(true)');
  try{await until(c,`document.querySelector('[data-device-id=g] .device-room').textContent==='客厅 | 开 开 开'`,65);}
  catch{throw Error(JSON.stringify({surface:p,caption:await caption('g'),reads:(await state()).stateReads,bounds:await c.evaluate(`['.home-screen','[data-device-id=g]'].map(selector=>document.querySelector(selector).getBoundingClientRect().toJSON())`)}));}
  const elapsed=Date.now()-began;
  check(`${p} external change updates the caption and button within the active read cadence without writes`,(desktop?elapsed<=3000:elapsed>=9500&&elapsed<=12000)&&(await state()).groupWrites.length===0&&await c.evaluate(`document.querySelector('${group}').getAttribute('aria-pressed')==='true'`));
  if(!desktop){await c.evaluate('window.templateFixture.staleSwitch()');check('an older poll cannot revert either group display',await caption('g')==='客厅 | 开 开 开'&&await c.evaluate(`document.querySelector('${group}').getAttribute('aria-pressed')==='true'`));}
 }
 console.log(JSON.stringify(checks));
}finally{await writeFile('.tools/card-captions-browser-results.json',JSON.stringify({checks,mockOnly:true,realDeviceCommandsSent:0,nativeMouseVerified:false},null,2));c.close();}
