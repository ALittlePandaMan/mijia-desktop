// Real shared renderers, main App adapter and desktop host; mock transports only.
import{pages,connect,until,delay}from'./perf/cdp.mjs';
import{writeFile}from'node:fs/promises';
const c=await connect((await pages(9444))[0]),checks=[];
const check=(name,ok)=>{checks.push({name,passed:!!ok});if(!ok)throw Error(name);};
const state=()=>c.evaluate('window.templateFixture.snapshot()');
const mouse=(type,x,y,buttons=0)=>c.call('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'&&!buttons?'none':'left',buttons,clickCount:type==='mouseMoved'?0:1});
const box=selector=>c.evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)}),r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
const click=async selector=>{const r=await box(selector);await mouse('mousePressed',r.x+r.width/2,r.y+r.height/2,1);await mouse('mouseReleased',r.x+r.width/2,r.y+r.height/2);await delay(30);};
const card=id=>`[data-device-id="${id}"]`,control=(id,key)=>`${card(id)} [data-control-id="${key}"]`;
const shortcutSize=id=>c.evaluate(`(()=>{const list=[...document.querySelectorAll('[data-device-id="${id}"] .device-shortcut')].filter(b=>b.getClientRects().length);const b=list[0],i=b.querySelector('.icon');return [list.length,getComputedStyle(b).width,getComputedStyle(i).width,getComputedStyle(i).strokeWidth]})()`);
const sharedTrackHeight=()=>c.evaluate('Math.abs(document.querySelector("[data-device-id=a] .brightness-slider").getBoundingClientRect().height-document.querySelector("[data-device-id=b] .air-temperature-slider").getBoundingClientRect().height)<0.1');
const load=async (desktop,missing=false)=>{await c.call('Page.navigate',{url:`http://127.0.0.1:1421/scripts/card-template-fixture.html?${desktop?'desktop=1':''}${missing?'&missing-first=1':''}`});await until(c,'!!window.templateFixture&&document.querySelectorAll(".has-card-template").length===5');await delay(200);};
const cardColors=(powered)=>c.evaluate(`(()=>{
 const light=document.querySelector('[data-device-id=a]'),climate=document.querySelector('[data-device-id=b]');
 const [brightness,temperature]=[light.querySelector('.brightness-slider'),climate.querySelector('.air-temperature-slider')];
 const buttons=[light,climate].map(card=>card.querySelector('.card-template-header .device-shortcut'));
 const color=node=>getComputedStyle(node).backgroundColor,fill=node=>getComputedStyle(node).backgroundImage;
 const off='rgb(204, 216, 225)';
 if(${powered})return buttons.every(button=>!button.disabled&&color(button)==='rgb(13, 206, 149)')&&
  !brightness.disabled&&fill(brightness).includes('rgb(255, 188, 57)')&&!temperature.disabled&&fill(temperature).includes('rgb(40, 116, 254)');
 return buttons.every(button=>!button.disabled&&color(button)===off)&&
  [brightness,temperature,...climate.querySelectorAll('.air-temperature-step')].every(node=>node.disabled&&color(node)===off&&fill(node)==='none'&&getComputedStyle(node).opacity==='1')&&
  light.querySelector('.card-control-value').textContent==='45%'&&climate.querySelector('.card-control-value').textContent==='23℃';
})()`);
const adjustmentGeometry=(id)=>c.evaluate(`(()=>{
 const card=document.querySelector(${JSON.stringify(card(id))}), row=card.querySelector('.card-control-slider-heading');
 const button=[...card.querySelectorAll('.device-shortcut')].find(node=>node.getClientRects().length).getBoundingClientRect();
 const input=card.querySelector('input[type=range]'), track=input.getBoundingClientRect();
 const lower=document.querySelector('[data-device-id=e] .device-card-top .device-shortcut').getBoundingClientRect();
 const art=card.querySelector('.device-artwork').getBoundingClientRect(), heading=row.getBoundingClientRect();
 const near=(a,b)=>Math.abs(a-b)<.6;
 return heading.height>0&&heading.top>=art.bottom-.6&&heading.bottom<=track.top+.6&&near(track.height,button.height)&&
  near(track.top,lower.top)&&near(track.bottom,lower.bottom)&&
  [...card.querySelectorAll('.air-temperature-step')].every(step=>{
   const box=step.getBoundingClientRect();return near(box.width,button.width)&&near(box.top,track.top)&&near(box.bottom,track.bottom);
  });
})()`);
const mixedGeometry=(selector)=>c.evaluate(`['a','b','c','e'].map(id=>{
 const card=document.querySelector('[data-device-id="'+id+'"]');
 const visible=[...card.querySelectorAll(${JSON.stringify(selector)})].filter(node=>node.getClientRects().length&&getComputedStyle(node).visibility==='visible');
 const button=visible[0],icon=button?.querySelector('.icon'),cardRect=card.getBoundingClientRect(),rect=button?.getBoundingClientRect();
 if(!rect)return null;
 const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
 return {count:visible.length,size:card.dataset.cardSize,template:card.classList.contains('has-card-template'),top:cardRect.top,height:cardRect.height,x,y,
   diameter:rect.width,buttonHeight:rect.height,diameterStyle:parseFloat(getComputedStyle(button).width),right:cardRect.right-rect.right,
   glyph:icon?.getBoundingClientRect().width,stroke:icon&&getComputedStyle(icon).strokeWidth,focusable:button.tabIndex===0,
   hit:button.contains(document.elementFromPoint(x,y))};
})`);
const near=(a,b)=>Math.abs(a-b)<.6;
const aligned=(cards,scale)=>{
 if(cards.some(card=>!card))return false;
 const [large,medium,upper,lower]=cards;
 return large.template&&medium.size==='medium'&&upper.size==='small'&&lower.size==='small'&&
  near(large.y,upper.y)&&near(medium.y,upper.y)&&near(upper.y-upper.top,upper.height/2)&&
  near(lower.y-lower.top,lower.height/2)&&lower.top>upper.top&&
  cards.every(card=>card.count===1&&card.focusable&&card.hit&&near(card.diameter,card.buttonHeight)&&
   near(card.diameter/scale,card.diameterStyle)&&card.diameterStyle>=32&&card.diameterStyle<=44&&
   near(card.y-card.top-card.buttonHeight/2,card.right)&&
   near(card.diameter,large.diameter)&&near(card.right,large.right)&&near(card.glyph,large.glyph)&&card.stroke===large.stroke);
};
try{
 await c.call('Emulation.setFocusEmulationEnabled',{enabled:true});await c.call('Emulation.setDeviceMetricsOverride',{width:1100,height:900,deviceScaleFactor:1,mobile:false});
 await load(false);
 await c.evaluate('window.templateFixture.failPassive("a")');
 await until(c,'document.querySelector("[data-device-id=a] input")?.disabled');
 check('failed passive device preserves its layout and does not disable a sibling',await c.evaluate('document.querySelector("[data-device-id=a]").classList.contains("has-card-template")&&!document.querySelector("[data-device-id=b] [data-control-id=temperature] button:last-child").disabled'));
 await c.evaluate('window.templateFixture.failPassive("a",false)');
 await until(c,'!document.querySelector("[data-device-id=a] input")?.disabled');
 check('main large brightness and climate tracks have equal height',await sharedTrackHeight());
 check('main uses five supported templates and a simple fallback',await c.evaluate('document.querySelectorAll(".has-card-template").length===5&&!document.querySelector("[data-device-id=f]").classList.contains("has-card-template")'));
 check('main header puts artwork, name and power in one row with controls below',await c.evaluate('(()=>{const c=document.querySelector("[data-device-id=a]"),a=c.querySelector(".device-artwork").getBoundingClientRect(),l=c.querySelector(".device-card-label").getBoundingClientRect(),p=c.querySelector(".card-template-header").getBoundingClientRect(),b=c.querySelector(".card-template-controls").getBoundingClientRect();return a.x<l.x&&l.x<p.x&&Math.abs(l.y-a.y)<30&&b.y>=Math.max(a.bottom,l.bottom)-1})()'));
 check('only currently visible large devices request template data', (await state()).reads.length>0&&(await state()).reads.every(ids=>ids.length<=6));
 await c.evaluate('window.savedImage=document.querySelector("[data-device-id=a] .device-artwork");window.savedSlider=document.querySelector("[data-device-id=a] input[type=range]")');
 const r=await box(`${control('a','brightness')} input`),before=(await state()).writes.length;
 await mouse('mousePressed',r.x+r.width*.45,r.y+r.height/2,1);await mouse('mouseMoved',r.x+r.width*.78,r.y+r.height/2,1);
 check('slider movement previews locally without sending', (await state()).writes.length===before&&await c.evaluate('Number(document.querySelector("[data-device-id=a] input").value)>60'));
 check('slider does not start card press, drag or open details',!(await state()).drags&&!(await state()).opens&&await c.evaluate('!document.querySelector("[data-device-id=a][data-card-press]")'));
 await mouse('mouseReleased',r.x+r.width*.78,r.y+r.height/2);await delay(100);
 check('slider release sends once and preserves the original input and artwork',(await state()).writes.length===before+1&&await c.evaluate('window.savedSlider===document.querySelector("[data-device-id=a] input")&&window.savedImage===document.querySelector("[data-device-id=a] .device-artwork")'));
 const written=(await state()).writes.length;
 await c.evaluate('(()=>{const n=document.querySelector("[data-device-id=a] input");n.dispatchEvent(new PointerEvent("pointerdown",{pointerId:9,button:0,bubbles:true}));n.value="20";n.dispatchEvent(new Event("input"));window.dispatchEvent(new Event("blur"));n.dispatchEvent(new Event("change"));})()');await delay(40);
 check('blur cancels the slider draft without submitting',(await state()).writes.length===written);
 await c.evaluate('(()=>{const n=document.querySelector("[data-device-id=a] input");n.dispatchEvent(new PointerEvent("pointerdown",{pointerId:10,button:0,bubbles:true}));n.value="30";n.dispatchEvent(new Event("input"));n.dispatchEvent(new PointerEvent("pointercancel",{pointerId:10}));n.dispatchEvent(new Event("change"));})()');
 check('pointer cancellation never commits',(await state()).writes.length===written);
 await c.evaluate('(()=>{const n=document.querySelector("[data-device-id=a] input");n.dispatchEvent(new PointerEvent("pointerdown",{pointerId:11,button:0,bubbles:true}));n.value="35";n.dispatchEvent(new Event("input"));n.dispatchEvent(new Event("blur"));n.dispatchEvent(new Event("change"));})()');
 check('losing slider focus cancels without sending',(await state()).writes.length===written);
 await c.evaluate('(()=>{const n=document.querySelector("[data-device-id=a] input"),r=n.closest(".card-control");n.dispatchEvent(new PointerEvent("pointerdown",{pointerId:12,button:0,bubbles:true}));n.value="35";n.dispatchEvent(new Event("input"));window.removedControl={r,parent:r.parentNode,next:r.nextSibling};r.remove();})()');await delay(25);
 await c.evaluate('(()=>{const {r,parent,next}=window.removedControl;parent.insertBefore(r,next);r.querySelector("input").dispatchEvent(new Event("change"));})()');
 check('unmounting a slider cancels its unsubmitted draft',(await state()).writes.length===written);
 await c.evaluate('window.templateFixture.setSize("a","small")');await delay(370);
 check('small card hides the multi-control panel and keeps one visible primary operation',await c.evaluate('(()=>{const n=document.querySelector("[data-device-id=a]"),buttons=[...n.querySelectorAll(".device-shortcut")].filter(b=>b.getClientRects().length);return !n.classList.contains("has-card-template")&&n.querySelector(".card-template-controls").hidden&&buttons.length===1&&buttons[0].getBoundingClientRect().height>=32})()'));
 await c.evaluate('window.templateFixture.setSize("a","large")');await delay(400);
 check('size round trip retains the same template control nodes',await c.evaluate('window.savedSlider===document.querySelector("[data-device-id=a] input")&&window.savedImage===document.querySelector("[data-device-id=a] .device-artwork")'));
 await c.evaluate('window.templateFixture.setDelay(120)');await click(`${control('b','temperature')} button:last-child`);await click(`${control('b','temperature')} button:last-child`);await delay(450);
 check('rapid temperature changes update the target reading above the track',(await state()).writes.filter(w=>w.did==='b').at(-1)?.change.value===25&&await c.evaluate('document.querySelector("[data-device-id=b] .card-control-slider-heading").textContent==="目标温度|25℃"'));
 await c.evaluate('window.templateFixture.setDelay(0)');await click(`${control('c','mode')} button:nth-child(2)`);
 check('mode buttons submit the real enum value',(await state()).writes.at(-1)?.change.value===1&&await c.evaluate('document.querySelector("[data-device-id=c] .card-control-choice:nth-child(2)").getAttribute("aria-pressed")==="true"'));
 await click(`${control('e','motor')} button:nth-child(3)`);
 check('curtain order and nonstandard enum values are preserved',(await state()).writes.at(-1)?.change.value===9&&await c.evaluate('[...document.querySelectorAll("[data-device-id=e] .card-control-choice")].map(n=>n.textContent).join()==="打开,暂停,关闭"'));
 await c.evaluate('window.templateFixture.setDelay(120)');const a=(await state()).writes.length;await click(`${control('d','sweep')} button`);await click(`${control('d','sweep')} button`);await delay(220);
 await delay(180);
 check('immediate reverse action follows start once and preserves submission order',(await state()).writes.length===a+2&&(await state()).writes.slice(a).map(w=>w.change.value).join()==='vacuum:start-sweep,vacuum:pause-sweeping');
 check('vacuum updates its next action after confirmed readback',await c.evaluate('document.querySelector("[data-device-id=d] .card-control-action-label").textContent==="开始清扫"'));
 await c.evaluate('window.templateFixture.setDelay(0);window.templateFixture.setEditing(true)');const edit=(await state()).writes.length;await click(`${control('c','mode')} button:first-child`);
 check('arrangement mode disables template controls',(await state()).writes.length===edit&&await c.evaluate('[...document.querySelectorAll(".card-control button")].every(b=>b.disabled)'));
 await c.evaluate('window.templateFixture.setEditing(false)');await delay(100);
 await c.evaluate('window.templateFixture.setSize("a","medium");window.templateFixture.setSize("b","medium")');await delay(350);const font=await c.evaluate('getComputedStyle(document.querySelector("[data-device-id=a] h3")).fontSize'),mediumSizes=await Promise.all([shortcutSize('a'),shortcutSize('b')]);await c.evaluate('window.templateFixture.setSize("a","large");window.templateFixture.setSize("b","large")');await delay(90);
 check('medium to large keeps the stable title font',await c.evaluate('getComputedStyle(document.querySelector("[data-device-id=a] h3")).fontSize')===font);await delay(300);
 check('main light and climate keep the exact medium power button and glyph sizes',JSON.stringify(await Promise.all([shortcutSize('a'),shortcutSize('b')]))===JSON.stringify(mediumSizes));
 check('control interactions never open details or send a legacy shortcut',(await state()).opens===0&&(await state()).legacyWrites===0);
 await c.evaluate('window.templateFixture.failNextWrite()');await click(`${control('c','mode')} button:first-child`);await delay(60);
 check('rejected writes restore the confirmed choice silently',await c.evaluate('(()=>{const n=document.querySelector("[data-device-id=c] [data-control-id=mode]");return n.querySelector(".card-control-choice:nth-child(2)").getAttribute("aria-pressed")==="true"&&!n.querySelector(".card-control-feedback")})()'));
 await c.evaluate('document.documentElement.dataset.theme="dark"');await delay(250);
 check('dark controls remain readable with a visible selected state',await c.evaluate('(()=>{const b=document.querySelector("[data-device-id=c] .is-selected"),s=getComputedStyle(b);return s.color!==s.backgroundColor&&s.backgroundColor!=="rgba(0, 0, 0, 0)"})()'));
 await c.call('Page.captureScreenshot',{format:'png'}).then(r=>writeFile('.tools/card-templates-main.png',Buffer.from(r.data,'base64')));
 await c.evaluate('window.templateFixture.compact("a")');
 check('a compact large card fits the caption and complete slider',await c.evaluate('(()=>{const n=document.querySelector("[data-device-id=a]"),r=n.getBoundingClientRect(),heading=n.querySelector(".card-control-slider-heading").getBoundingClientRect(),track=n.querySelector("input").getBoundingClientRect();return n.classList.contains("has-card-template")&&track.bottom<=r.bottom&&heading.top>=n.querySelector(".device-artwork").getBoundingClientRect().bottom&&heading.bottom<=track.top&&track.height===32})()'));
 await load(false);await c.evaluate('window.templateFixture.setValue("a","brightness",null);window.templateFixture.setUnavailable("a","状态未读取")');
 check('temporary failure keeps the last read value visible but noninteractive',await c.evaluate('document.querySelector("[data-device-id=a] input").disabled&&document.querySelector("[data-device-id=a] .card-control-value").textContent==="45%"'));
 await load(false,true);
 check('unknown readings keep controls disabled without inventing a value',await c.evaluate('document.querySelector("[data-device-id=a] input").disabled&&document.querySelector("[data-device-id=a] .card-control-value").textContent==="未读取"'));
 await c.evaluate('window.templateFixture.compact("c");window.templateFixture.overflow("c")');
 check('insufficient space falls back as a whole instead of clipping buttons',await c.evaluate('!document.querySelector("[data-device-id=c]").classList.contains("has-card-template")&&document.querySelector("[data-device-id=c] .card-template-controls").hidden'));
 await load(false);
 await c.evaluate('window.templateFixture.detail("climate")');
 check('temperature detail and large card use the same circular controls and track',await c.evaluate('(()=>{const d=document.querySelector("#template-detail .air-temperature-controls"),c=document.querySelector("[data-device-id=b] .air-temperature-controls");return [d,c].every(control=>control.querySelectorAll(".air-temperature-step").length===2&&control.querySelector("input.air-temperature-slider")&&getComputedStyle(control.querySelector("button")).borderRadius==="50%")})()'));
 check('air-conditioner temperature, selected mode and selected wind speed share the reference blue',await c.evaluate('(()=>{const n=document.querySelector("#template-detail");return getComputedStyle(n.querySelector(".air-temperature-slider")).backgroundImage.includes("rgb(40, 116, 254)")&&[...n.querySelectorAll(".air-choice.selected .air-choice-symbol")].length===2&&[...n.querySelectorAll(".air-choice.selected .air-choice-symbol")].every(b=>getComputedStyle(b).backgroundColor==="rgb(40, 116, 254)")&&n.textContent.includes("风速|低速")})()'));
 check('running air conditioner shows the orange close control',await c.evaluate('(()=>{const b=document.querySelector("#template-detail .air-conditioner-power");return b.textContent.trim()==="关闭"&&getComputedStyle(b.querySelector(".icon")).backgroundColor==="rgb(253, 114, 63)"})()'));
 await c.evaluate('document.querySelector("#template-detail .air-temperature-step:last-child").click()');
 check('detail uses the device half degree step',(await c.evaluate('window.templateFixture.detailTrace().writes')).at(-1)?.value===23.5);
 await c.evaluate('window.templateFixture.detail("climate",false,false)');
 check('non-running air conditioner shows the indigo open control and disables temperature',await c.evaluate('(()=>{const b=document.querySelector("#template-detail .air-conditioner-power");return b.textContent.trim()==="开启"&&getComputedStyle(b.querySelector(".icon")).backgroundColor==="rgb(32, 28, 62)"&&document.querySelector("#template-detail .air-temperature-slider").disabled})()'));
 await c.evaluate('window.templateFixture.detail("group")');
 check('white light group uses two power buttons and the detail brightness and Kelvin tracks',await c.evaluate('(()=>{const n=document.querySelector("#template-detail");return [...n.querySelectorAll(".light-power-row button")].map(b=>b.textContent.trim()).join(",")==="全开,全关"&&n.querySelector(".brightness-white input")&&n.querySelector(".slider-temperature input")&&document.querySelector("[data-device-id=a] .brightness-white .brightness-endpoint")})()'));
 await c.evaluate('window.templateFixture.detail("rgb")');
 check('RGB uses one switchable color surface without preset or mode panels',await c.evaluate('(()=>{const n=document.querySelector("#template-detail");return n.querySelector(".brightness-rgb input")&&n.querySelectorAll("[role=tab]").length===2&&n.querySelector(".light-color-plane")&&!/我的模式|情景模式|自定义/.test(n.textContent)})()'));
 check('RGB brightness uses an amber fill and both endpoint icons',await c.evaluate('(()=>{const b=document.querySelector("#template-detail .brightness-track");return getComputedStyle(b.querySelector("input")).backgroundImage.includes("rgb(255, 188, 57)")&&[...b.querySelectorAll(".brightness-endpoint")].filter(n=>n.getClientRects().length).length===2})()'));
 const beforeTab=await c.evaluate('window.templateFixture.detailTrace().writes.length');
 await c.evaluate('document.querySelector("#template-detail [role=tab]").click()');
 check('switching RGB to Kelvin changes the editor without a device write',await c.evaluate('!!document.querySelector("#template-detail .light-temperature-slider")')&&(await c.evaluate('window.templateFixture.detailTrace().writes.length'))===beforeTab);
 await c.evaluate('document.querySelector("#template-detail [role=tab][aria-selected=true]").focus()');await c.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
 check('switching color tabs with the keyboard retains focus and sends no command',await c.evaluate('document.activeElement?.textContent==="颜色"&&!!document.querySelector("#template-detail .light-color-plane")')&&(await c.evaluate('window.templateFixture.detailTrace().writes.length'))===beforeTab);
 await c.evaluate('window.templateFixture.detail("rgb-only")');
 check('RGB without color temperature has no empty tab or white preset',await c.evaluate('(()=>{const n=document.querySelector("#template-detail");return n.querySelector(".light-color-plane")&&!n.querySelector("[role=tab],.light-white-card,.light-temperature-slider")})()'));
 await c.evaluate('window.templateFixture.detail("invalid-rgb")');
 check('an incompatible color encoding uses the ordinary white light controls',await c.evaluate('(()=>{const n=document.querySelector("#template-detail");return n.querySelector(".brightness-white input")&&n.querySelector(".slider-temperature")&&!n.querySelector(".light-color-plane")})()'));
 await c.evaluate('window.templateFixture.detail("power")');
 check('power-only light omits brightening, color and mode UI',await c.evaluate('(()=>{const n=document.querySelector("#template-detail");return n.querySelectorAll(".native-wide-power").length===1&&!n.querySelector("input,.light-color-card,.yeelight-modes")})()'));
 await c.evaluate('window.templateFixture.detail("rgb",true)');
 check('shared read-only RGB lights cannot alter the device',await c.evaluate('(()=>{const n=document.querySelector("#template-detail");return [...n.querySelectorAll("button:not([role=tab]),input")].every(b=>b.disabled)&&n.querySelector(".light-color-plane").getAttribute("aria-disabled")==="true"})()'));
 await c.evaluate('window.templateFixture.detail("rgb",false,false)');
 check('an off light retains the real brightness readout in a gray track',await c.evaluate('(()=>{const n=document.querySelector("#template-detail"),b=n.querySelector(".brightness-slider"),s=getComputedStyle(b);return b.disabled&&n.querySelector(".native-slider-value").textContent==="45%"&&s.backgroundImage.includes("rgb(237, 238, 239)")&&!s.backgroundImage.includes("rgb(255, 188, 57)")})()'));
 check('light details never request the removed mode data',await c.evaluate('window.templateFixture.detailTrace().invocations.every(n=>!["light_modes","light_settings","light_favorites"].includes(n))'));
 await load(true);
 await c.evaluate('window.templateFixture.failPassive("a");');
 await until(c,'document.querySelector("[data-device-id=a] input")?.disabled');
 check('desktop preserves its large card and the other device controls after an omitted result',await c.evaluate('document.querySelector("[data-device-id=a]").classList.contains("has-card-template")&&!document.querySelector("[data-device-id=b] [data-control-id=temperature] button:last-child").disabled'));
 await c.evaluate('window.templateFixture.failPassive("a",false)');
 await until(c,'!document.querySelector("[data-device-id=a] input")?.disabled');
 check('desktop shares all five real template renderers',await c.evaluate('document.querySelectorAll(".has-card-template").length===5'));
 check('desktop large brightness and climate tracks have equal height',await sharedTrackHeight());
 const largeDesktopSizes=await Promise.all([shortcutSize('a'),shortcutSize('b')]);
 await c.evaluate('window.templateFixture.setSize("a","medium");window.templateFixture.setSize("b","medium")');await delay(350);
 check('desktop uses the exact medium power button and glyph sizes for large cards',JSON.stringify(await Promise.all([shortcutSize('a'),shortcutSize('b')]))===JSON.stringify(largeDesktopSizes));
 await c.evaluate('window.templateFixture.setSize("a","large");window.templateFixture.setSize("b","large")');await delay(350);
 check('desktop card bounds match the native host placement',await c.evaluate('(()=>{const p=document.querySelector("[data-widget-id=a]"),r=p.getBoundingClientRect(),c=p.querySelector(".device-card").getBoundingClientRect();return Math.abs(r.height-c.height)<1&&Math.abs(r.width-c.width)<1})()'));
 for(const scale of [1,1.25,1.5]){
  await c.evaluate(`window.templateFixture.projectHost(${scale},400)`);
  await delay(90);
  check(`desktop projected ${Math.round(scale*100)}% keeps equal tracks and the temperature buttons inside the card`,await sharedTrackHeight()&&await c.evaluate('(()=>{const n=document.querySelector("[data-device-id=b]"),r=n.getBoundingClientRect();return n.classList.contains("has-card-template")&&[...n.querySelectorAll("[data-control-id=temperature] button")].every(b=>{const box=b.getBoundingClientRect();return !b.disabled&&box.bottom<=r.bottom&&box.right<=r.right})})()'));
 }
 await c.evaluate('window.templateFixture.projectHost(1.5,140)');
 await until(c,'!document.querySelector("[data-device-id=b]").classList.contains("has-card-template")');
 check('desktop falls back when the actual logical width cannot fit the controls',true);
 await c.evaluate('window.templateFixture.projectHost(1,492)');
 await until(c,'Math.abs(document.querySelector("[data-widget-id=b]").getBoundingClientRect().width-492)<1&&document.querySelector("[data-device-id=b]").classList.contains("has-card-template")');
 await until(c,'window.templateFixture.snapshot().regions.length===6');
 check('desktop registers power and slider as separate native control regions',(await state()).regions.find(r=>r.id==='a').regions.filter(r=>r.kind==='control').length===2);
 await click(`${control('b','temperature')} button:last-child`);await delay(60);
 check('desktop control uses its widget identity and opaque control identifier',(await state()).writes.at(-1)?.did==='b'&&(await state()).writes.at(-1)?.change.controlId==='temperature');
 check('desktop controls do not open details or trigger legacy power',(await state()).opens===0&&(await state()).legacyWrites===0);
 await c.evaluate('window.desktopInput=document.querySelector("[data-device-id=a] input");window.desktopArt=document.querySelector("[data-device-id=a] .device-artwork");window.templateFixture.setSize("a","small")');await delay(350);await c.evaluate('window.templateFixture.setSize("a","large")');await delay(350);
 check('desktop size animation retains artwork and control identities',await c.evaluate('window.desktopInput===document.querySelector("[data-device-id=a] input")&&window.desktopArt===document.querySelector("[data-device-id=a] .device-artwork")'));
 await c.evaluate('window.templateFixture.setUnavailable("c","只有读取权限")');
 await until(c,'(()=>{const buttons=[...document.querySelectorAll("[data-device-id=c] .card-control button")];return buttons.length>0&&buttons.every(b=>b.disabled)})()');
 check('desktop readonly controls are disabled',await c.evaluate('[...document.querySelectorAll("[data-device-id=c] .card-control button")].every(b=>b.disabled)'));
 await c.call('Page.captureScreenshot',{format:'png'}).then(r=>writeFile('.tools/card-templates-desktop.png',Buffer.from(r.data,'base64')));
 check('every request stays in the local mock transport',(await state()).writes.every(w=>w.change.templateId&&w.change.controlId&&!('siid'in w.change)&&!('piid'in w.change)));
 await c.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await c.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await mouse('mouseMoved',5,5);
 for(const desktop of [false,true]){
  await c.call('Page.navigate',{url:`http://127.0.0.1:1421/scripts/card-template-fixture.html?mixed=1${desktop?'&desktop=1':''}`});
  await until(c,'!!window.templateFixture&&document.querySelector("[data-device-id=a]")?.classList.contains("has-card-template")');
  if(desktop){
   for(const scale of [1,1.25,1.5]){
    await c.evaluate(`window.templateFixture.projectHost(${scale},492)`);
    await until(c,`Math.abs(document.querySelector('[data-widget-id=b]').getBoundingClientRect().width-${180*scale})<.5`);
    check(`desktop mixed cards align power at ${scale*100}%`,aligned(await mixedGeometry('.device-shortcut'),scale));
    check(`desktop brightness track aligns with both shortcut rows at ${scale*100}%`,await adjustmentGeometry('a'));
   }
  }else{
   const buttons=await mixedGeometry('.device-shortcut');
   check('app mixed cards align power on the upper small-card centerline',aligned(buttons,1));
   check('app brightness track matches the power height and aligns with the lower small card',await adjustmentGeometry('a'));
   await c.evaluate('document.documentElement.dataset.theme="dark"');
   check('dark mode keeps mixed power-button geometry',aligned(await mixedGeometry('.device-shortcut'),1));
   await c.evaluate('window.templateFixture.setEditing(true)');
   const markers=await mixedGeometry('.device-select-indicator');
   check('app editing markers share the power-button centers across sizes',markers.every((marker,i)=>marker&&near(marker.x,buttons[i].x)&&near(marker.y,buttons[i].y)));
   await c.evaluate('window.templateFixture.setEditing(false)');
  }
  await c.evaluate('window.templateFixture.setSize("a","medium");window.templateFixture.setSize("b","large")');
  await until(c,'document.querySelector("[data-device-id=b]").classList.contains("has-card-template")');
  check(`temperature track and step buttons align in the ${desktop?'desktop':'app'} mixed grid`,await adjustmentGeometry('b'));
  check(`mixed alignment on the ${desktop?'desktop':'app'} never submits an action`,(await state()).writes.length===0);
 }
 for(const desktop of [false,true]){
  await load(desktop);
  const surface=desktop?'desktop':'app';
  check(`${surface} keeps the active power, brightness and temperature colors`,await cardColors(true));
  await c.evaluate('window.templateFixture.setValue("a","power",false);window.templateFixture.setValue("b","power",false)');
  await until(c,'[...document.querySelectorAll(".brightness-slider,.air-temperature-slider")].every(input=>input.disabled)');
  check(`${surface} off shortcuts and disabled tracks share the exact slate background with retained values`,await cardColors(false));
  await c.evaluate('document.documentElement.dataset.theme="dark"');
  check(`${surface} dark theme keeps the same inactive control color`,await cardColors(false));
 }
 for(const desktop of [false,true]){
  const surface=desktop?'desktop':'app';
  await c.call('Page.navigate',{url:`http://127.0.0.1:1421/scripts/card-template-fixture.html?mixed=1&curtain-position=1${desktop?'&desktop=1':''}`});
  await until(c,'!!window.templateFixture&&!!document.querySelector("[data-device-id=a] .curtain-slider-input")');
  await mouse('mouseMoved',5,5);
  check(`${surface} position-only curtain keeps its original shortcut and shared lower-slot geometry`,
    await adjustmentGeometry('a')&&await c.evaluate(`(()=>{
      const n=document.querySelector('[data-device-id=a]');
      const buttons=[...n.querySelectorAll('.device-shortcut')].filter(b=>b.getClientRects().length);
      return buttons.length===1&&buttons[0].dataset.shortcutKind==='curtain'&&
        buttons[0].querySelector('.icon').dataset.iconName==='curtain-close'&&
        n.querySelectorAll('.curtain-slider-panel').length===2&&!n.querySelector('.card-control-slider');
    })()`));
  if(!desktop){
   await c.evaluate('window.templateFixture.curtainDetail()');
   check('curtain card and detail use matching track structure and active colors',await c.evaluate(`(()=>{
    const [card,detail]=['[data-device-id=a]','#curtain-detail-fixture'].map(sel=>document.querySelector(sel+' .curtain-slider-track'));
    return card.innerHTML.split('<input')[0]===detail.innerHTML.split('<input')[0]&&
     getComputedStyle(card.querySelector('.curtain-slider-panel')).backgroundColor===getComputedStyle(detail.querySelector('.curtain-slider-panel')).backgroundColor;
   })()`));
   await c.evaluate('document.querySelector("#curtain-detail-fixture").remove()');
  }
  const slider=await box(`${card('a')} .curtain-slider-input`);
  const centre=slider.x+slider.width/2,y=slider.y+slider.height/2;
  await mouse('mousePressed',centre,y,1);await mouse('mouseMoved',slider.x+slider.width-2,y,1);await mouse('mouseReleased',slider.x+slider.width-2,y);
  await until(c,'window.templateFixture.snapshot().writes.length===1');
  check(`${surface} curtain drag submits exactly one validated position and never opens details`,
    (await state()).writes[0].change.value===100&&(await state()).opens===0);
  await mouse('mousePressed',centre,y,1);
  await c.evaluate('window.dispatchEvent(new Event("blur"))');await mouse('mouseReleased',centre,y);
  check(`${surface} cancelled curtain drag sends no write and restores the position`,(await state()).writes.length===1&&await c.evaluate('document.querySelector("[data-device-id=a] .curtain-slider-input").value==="100"'));
  await mouse('mouseMoved',5,5);
  await c.evaluate('document.querySelector("[data-device-id=a] .curtain-slider-input").focus()');
  await c.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
  await c.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
  await until(c,'window.templateFixture.snapshot().writes.length===2');
  check(`${surface} curtain slider keeps native keyboard steps`,(await state()).writes[1].change.value===95);
 }
 console.log(JSON.stringify(checks));
}finally{await writeFile('.tools/card-templates-browser-results.json',JSON.stringify({checks,mockOnly:true,nativeMouseVerified:false,realDeviceCommandsSent:0},null,2));c.close();}
