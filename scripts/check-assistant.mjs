// Isolated Chrome + fixture IPC only. No native login or hardware calls.
import{pages,connect,until,delay}from'./perf/cdp.mjs';
import{writeFile}from'node:fs/promises';
const c=await connect((await pages(9444))[0]),checks=[];
const check=(name,passed)=>{checks.push({name,passed:!!passed});if(!passed)throw Error(name);};
const click=async key=>{const r=await c.evaluate(`(()=>{const n=document.querySelector('[data-focus-key=${key}]');n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of['mousePressed','mouseReleased'])await c.call('Input.dispatchMouseEvent',{type,x:r.x,y:r.y,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});};
const load=async()=>{await c.call('Page.navigate',{url:'http://127.0.0.1:1421/scripts/assistant-fixture.html'});await until(c,'!!window.assistantFixture&&document.querySelector(".settings-assistant")?.textContent.includes("需要验证")');};
try{
 await c.call('Emulation.setFocusEmulationEnabled',{enabled:true});await c.call('Emulation.setDeviceMetricsOverride',{width:1100,height:950,deviceScaleFactor:1,mobile:false});await load();
 check('assistant entry appears in actual MCP settings',await c.evaluate('document.querySelector("#settings-nav-mcp").getAttribute("aria-selected")==="true"&&document.querySelector(".settings-assistant-heading .settings-row-label").textContent==="智能家居助手连接"'));
 check('removed scope prose and routine actions stay out of the assistant card',await c.evaluate('!document.querySelector(".settings-assistant").textContent.includes("强制隔离尚未验证")&&!document.querySelector("[data-focus-key=assistant-refresh],[data-focus-key=assistant-revoke]")'));
 await click('assistant-authorize');await until(c,'!!document.querySelector(".settings-assistant-qr img")');
 check('authorization QR stays inside the settings card',await c.evaluate('document.querySelector(".settings-assistant-qr img").alt==="云端助手授权二维码"'));
 check('ordinary MIoT login is not restarted',await c.evaluate('!window.assistantFixture.calls.some(c=>["start_login","logout"].includes(c.command))'));
 await c.evaluate('window.assistantFixture.success()');await until(c,'document.querySelector(".settings-assistant .settings-mcp-status").textContent==="已连接"');
 check('successful authorization removes QR, expiry and empty action footer',await c.evaluate('!document.querySelector(".settings-assistant-qr,.settings-assistant-expiry,.settings-assistant-actions")'));
 check('connected state has no second scan entry',await c.evaluate('!document.querySelector("[data-focus-key=assistant-authorize]")'));
 check('initial status read still uses the assistant-only endpoint',await c.evaluate('window.assistantFixture.calls.some(c=>c.command==="assistant_status"&&c.args.refresh===false)'));
 await c.evaluate('document.documentElement.dataset.theme="dark"');await delay(300);await c.call('Page.captureScreenshot',{format:'png'}).then(r=>writeFile('.tools/assistant-settings-dark.png',Buffer.from(r.data,'base64')));
 await c.call('Emulation.setDeviceMetricsOverride',{width:520,height:900,deviceScaleFactor:1,mobile:false});await delay(100);check('narrow settings do not overflow horizontally',await c.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
 await c.evaluate('document.documentElement.dataset.theme="light"');await c.call('Page.captureScreenshot',{format:'png'}).then(r=>writeFile('.tools/assistant-settings-narrow.png',Buffer.from(r.data,'base64')));
 await load();await c.evaluate('window.assistantFixture.mismatch()');await click('assistant-authorize');await until(c,'document.querySelector(".settings-assistant [role=alert]")?.textContent.includes("相同的小米账号")');
 check('wrong-account rejection visibly explains the error and preserves normal connection controls',await c.evaluate('!document.querySelector(".settings-assistant-qr")&&document.querySelector(".settings-assistant [role=alert]").getClientRects().length>0&&!!document.querySelector("[data-focus-key=mcp-enabled]")'));
 await load();await click('assistant-authorize');await until(c,'!!document.querySelector(".settings-assistant-qr")');await c.evaluate('[...document.querySelectorAll(".settings-assistant button")].find(n=>n.textContent==="取消扫码").click()');await delay(50);check('cancel removes QR and cancels exactly its attempt',await c.evaluate('!document.querySelector(".settings-assistant-qr")&&window.assistantFixture.calls.some(c=>c.command==="cancel_assistant_authorization"&&c.args.attemptId==="mock-qr")'));
 check('browser verification contains no device writes',await c.evaluate('window.assistantFixture.calls.every(c=>!["set_property","home_card_control","switch_group_control","run_action","miot_ask_assistant"].includes(c.command))'));
 console.log(JSON.stringify(checks));
}finally{await writeFile('.tools/assistant-browser-results.json',JSON.stringify({checks,mockOnly:true,realDeviceWrites:0,nativeWindowsAcceptance:false},null,2));c.close();}
