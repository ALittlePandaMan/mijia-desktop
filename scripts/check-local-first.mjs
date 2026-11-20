// Real shared App/card/desktop renderers. Only local mock transports are installed.
import{pages,connect,until,delay}from'./perf/cdp.mjs';
import{writeFile}from'node:fs/promises';
const c=await connect((await pages(9444))[0]),checks=[];
const check=(name,ok)=>{checks.push({name,passed:!!ok});if(!ok)throw Error(name);};
const state=()=>c.evaluate('window.templateFixture.snapshot()');
const button=(id,key='power')=>`[data-device-id=${id}] [data-control-id=${key}] button`;
const click=async selector=>{const r=await c.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of['mousePressed','mouseReleased'])await c.call('Input.dispatchMouseEvent',{type,x:r.x,y:r.y,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});};
const load=async desktop=>{await c.call('Page.navigate',{url:`http://127.0.0.1:1421/scripts/card-template-fixture.html?local=1${desktop?'&desktop=1':''}`});await until(c,'!!window.templateFixture&&document.querySelectorAll(".has-card-template").length===5');await delay(160);await c.evaluate('window.templateFixture.setDelay(140);window.templateFixture.setCloudLag(5000)');};
try{
 await c.call('Emulation.setFocusEmulationEnabled',{enabled:true});await c.call('Emulation.setDeviceMetricsOverride',{width:1100,height:900,deviceScaleFactor:1,mobile:false});
 for(const desktop of[false,true]){const prefix=desktop?'desktop':'main';await load(desktop);
  await c.evaluate('window.templateFixture.setValue("a","power",false)');check(`${prefix} off-state dependency starts disabled`,await c.evaluate('document.querySelector("[data-device-id=a] input").disabled'));
  await click(button('a'));check(`${prefix} power intention immediately unlocks brightness before acknowledgement`,await c.evaluate('!document.querySelector("[data-device-id=a] input").disabled'));
  await c.evaluate('(()=>{const n=document.querySelector("[data-device-id=a] input");n.dispatchEvent(new PointerEvent("pointerdown",{pointerId:7,button:0,bubbles:true}));n.value="67";n.dispatchEvent(new Event("input"));window.dispatchEvent(new PointerEvent("pointerup",{pointerId:7}));n.dispatchEvent(new Event("change"));})()');
  check(`${prefix} dependent brightness shows the local target before any cloud readback`,await c.evaluate('document.querySelector("[data-device-id=a] .card-control-value").textContent==="67%"'));
  await delay(370);const light=(await state()).executed.filter(w=>w.did==='a');check(`${prefix} submits power then brightness while cloud state is still old`,light.map(w=>w.controlId).join()==='power,brightness'&&light[1].value===67);
  await c.evaluate('window.templateFixture.setValue("b","power",false)');await click(button('b'));await click('[data-device-id=b] .air-temperature-step:last-child');await click('[data-device-id=b] .air-temperature-step:last-child');
  check(`${prefix} climate accepts a temperature change immediately after power on`,await c.evaluate('document.querySelector("[data-device-id=b] .card-control-value").textContent==="25℃"'));await delay(520);check(`${prefix} climate submits the latest temperature without state-readback gating`,(await state()).executed.filter(w=>w.did==='b').at(-1)?.value===25);
  await click(button('d','sweep'));check(`${prefix} vacuum start immediately offers pause`,await c.evaluate('document.querySelector("[data-device-id=d] .card-control-action-label").textContent==="暂停"'));await click(button('d','sweep'));await delay(370);
  check(`${prefix} immediate pause is sent after start exactly once`,(await state()).executed.filter(w=>w.did==='d').map(w=>w.value).join()==='vacuum:start-sweep,vacuum:pause-sweeping');
  await c.evaluate('window.templateFixture.failNextWrite()');await click('[data-device-id=e] .card-control-choice:first-child');check(`${prefix} enum selection updates locally`,await c.evaluate('document.querySelector("[data-device-id=e] .card-control-choice:first-child").getAttribute("aria-pressed")==="true"'));await delay(190);
  check(`${prefix} rejection silently restores the confirmed choice`,await c.evaluate('document.querySelector("[data-device-id=e] .card-control-choice:nth-child(2)").getAttribute("aria-pressed")==="true"&&!document.querySelector(".card-control-feedback")'));
  check(`${prefix} no pending, success or failure notification prose appears`,await c.evaluate('!document.querySelector(".card-control-feedback")&&![...document.querySelectorAll(".device-card")].some(n=>/待确认|操作成功|操作失败/.test(n.textContent))'));
  const group='[data-device-id=g] .device-shortcut';check(`${prefix} aggregate switch has a quick power button`,await c.evaluate(`!!document.querySelector('${group}')`));await click(group);
  check(`${prefix} a mixed group immediately targets all on`,await c.evaluate(`document.querySelector('${group}').getAttribute('aria-pressed')==='true'`));await click(group);check(`${prefix} immediate reverse targets all off`,await c.evaluate(`document.querySelector('${group}').getAttribute('aria-pressed')==='false'`));await delay(370);
  check(`${prefix} group writes contain only backend group identity and explicit targets`,(await state()).groupWrites.map(w=>w.on).join()==='true,false'&&(await state()).groupWrites.every(w=>w.groupId==='mock-normal-only'&&!('members'in w)));
  const pads=await c.evaluate(`(()=>{
   const vacuum=document.querySelector('[data-device-id=d]'),light=document.querySelector('[data-device-id=a]');
   const bounds=vacuum.getBoundingClientRect(),art=vacuum.querySelector('.device-artwork').getBoundingClientRect();
   const action=vacuum.querySelector('.card-control-button').getBoundingClientRect();
   const card=light.getBoundingClientRect(),power=light.querySelector('.card-template-header .device-shortcut').getBoundingClientRect();
   const track=light.querySelector('input').getBoundingClientRect();
   return {top:art.top-bounds.top,bottom:bounds.bottom-action.bottom,track:track.height,mirror:(power.top-card.top)-(card.bottom-track.bottom),power:power.height};
  })()`);
  check(`${prefix} vacuum button bottom padding equals header top padding`,Math.abs(pads.top-pads.bottom)<1&&Math.abs(pads.top-12)<1);
  check(`${prefix} brightness track mirrors the power shortcut with an equal hit area`,Math.abs(pads.mirror)<.6&&Math.abs(pads.track-pads.power)<.6&&pads.track>=32);
  check(`${prefix} control interaction never starts dragging or opens detail`,(await state()).drags===0&&(await state()).opens===0);
  await c.call('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(`.tools/local-first-${prefix}.png`,Buffer.from(r.data,'base64')));
  await load(desktop);await c.evaluate('window.templateFixture.setGroupFailures(["2:1"])');await click(group);await delay(190);check(`${prefix} a failed key rolls back without undoing the other key`,await c.evaluate(`document.querySelector('${group}').getAttribute('aria-pressed')==='false'`)&&(await state()).groupWrites.length===1);
  for(const size of['small','medium','large']){await c.evaluate(`window.templateFixture.setSize('g','${size}')`);await delay(330);check(`${prefix} ${size} group keeps a reachable quick button`,await c.evaluate(`(()=>{const n=document.querySelector('${group}'),r=n.getBoundingClientRect();return !n.disabled&&r.width>=32&&r.height>=32})()`));}
 }
 console.log(JSON.stringify(checks));
}finally{await writeFile('.tools/local-first-browser-results.json',JSON.stringify({checks,mockOnly:true,realDeviceCommandsSent:0,nativeMouseVerified:false},null,2));c.close();}
