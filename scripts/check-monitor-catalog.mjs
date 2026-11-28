import fs from 'node:fs/promises';
import path from 'node:path';
import {connect, delay, pages, until} from './perf/cdp.mjs';

const address='http://127.0.0.1:1421';
const out=process.argv[2]??'.cache/monitor-catalog-browser.json';
const client=await connect((await pages(9444))[0]);

function monitorFixture(label) {
 const main=label==='main',scope='monitor-fixture-account';
 const homes=['a','b','empty'].map(id=>({id,name:'测试家庭 '+id,rooms:[],ownerId:'mock',shared:false}));
 const device=homeId=>({did:'camera-'+homeId,name:'测试摄像机 '+homeId,online:true,model:'xiaomi.camera.069a03',roomId:'',roomName:''});
 const desk={autoCheckUpdates:false,monitorSeparateWindow:false};
 const settings={startupMonitor:false,startupHome:null,closeToTray:true,keepAwake:false,mcp:{enabled:false,localPort:8765,excludedHomes:[]}};
 const status={state:'idle',revision:0,currentVersion:'test',supported:false};
 const fixture=window.monitorFixture={calls:[],label:null,loggedIn:true,renew:false,inUse:false,emit(event,payload){
  for(const id of listeners.get(event)??[])callbacks.get(id)?.({event,id,payload});
 }};
 const callbacks=new Map(),listeners=new Map();
 let nextCallback=0,generation=0,home='a',group=0;
 let roster=[];
 window.isTauri=true;
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(event,id){listeners.set(event,(listeners.get(event)??[]).filter(value=>value!==id));}};
 window.__TAURI_INTERNALS__={
  metadata:{currentWindow:{label},currentWebview:{label}},
  transformCallback(fn){callbacks.set(++nextCallback,fn);return nextCallback;},
  unregisterCallback(id){callbacks.delete(id);},
  async invoke(command,args={}){
   fixture.calls.push({command,args});
   if(command==='plugin:event|listen'){
    const ids=listeners.get(args.event)??[];ids.push(args.handler);listeners.set(args.event,ids);return args.handler;
   }
   if(command==='plugin:event|unlisten'||command.startsWith('plugin:window|'))return false;
   if(command==='desktop_resource_snapshot')return {version:1,revision:1,visible:true,monitorBackground:false};
   if(command==='monitor_catalog'){
    const target=args.homeId??(main?null:'a');
    return {scope,generation:55,allHomes:target===null,incomplete:false,availableHomes:homes,
     homes:homes.filter(h=>target===null||h.id===target).map(home=>({home,devices:home.id==='empty'?[]:[device(home.id)],excludedDeviceIds:[]}))};
   }
   if(command==='create_monitor_all'||command==='create_monitor'){
    const target=args.homeId??(main?null:'a');
    if(target!==null && args.dids.some(did=>did!==device(target).did))throw Error('Wrong monitor home');
    roster=args.dids;return 'fixture-group-'+ ++group;
   }
   if(command==='read_monitor'||command==='read_monitor_all'){
    if(!fixture.loggedIn)throw {kind:'authExpired',message:'登录已失效',retryable:false};
    if(fixture.renew){fixture.renew=false;throw {kind:'monitorSessionRenewed',message:'登录已更新',retryable:true};}
    return roster.map(did=>({did,revision:1,state:fixture.inUse?'error':'live',events:[],error:fixture.inUse?{kind:'cameraInUse',retryable:false}:null,
     features:{qualities:[{id:'sd',label:'流畅'}],listen:true,talk:false,playback:true,
      lenses:[{id:0,label:'云台镜头'},{id:10,label:'固定镜头'}]}}));
   }
   if(['stop_monitor','stop_monitor_all','monitor_window'].includes(command))return;
   if(main){
    switch(command){
     case 'session':return {loggedIn:fixture.loggedIn,region:'cn',userId:fixture.loggedIn?'monitor-fixture-user':null};
     case 'application_settings':return structuredClone({scope,autostart:false,mcpStatus:{state:'stopped'},update:status,settings,desktopOptions:desk});
     case 'change_desktop_option':desk[args.option]=args.enabled;return this.invoke('application_settings');
     case 'open_detached_monitor':
      if(!desk.monitorSeparateWindow)return null;
      fixture.label='monitor-fixture';
      fixture.emit('desktop-monitor-window-changed',null);
      return fixture.label;
     case 'close_detached_monitor':
      if(args.label===fixture.label){fixture.label=null;fixture.emit('desktop-monitor-window-changed',null);}
      return;
     case 'detached_monitor_status':return fixture.label;
     case 'list_homes':return homes;
     case 'select_home':home=args.homeId;generation++;return {homeId:home,generation,devices:[device(home)]};
     case 'refresh_devices':return {homeId:home,generation,devices:[device(home)]};
     case 'home_scenes':return {homeId:home,generation,scenes:[]};
     case 'home_preferences':return {roomOrders:{},hiddenDeviceIds:[],homeHiddenDeviceIds:[],monitor:{enabled:false,excludedDeviceIds:[]}};
     case 'home_cards':return {homeId:home,generation,cards:[],statuses:[]};
     case 'account_profile':return {displayName:'测试账号'};
     case 'desktop_widget_support':return {supported:false,enabledDisplays:0,pins:[]};
     case 'desktop_frontend_idle':case 'app_update_result':case 'device_artwork':return null;
    }
   }else{
    switch(command){
     case 'focus_camera_view':return true;
     case 'monitor_detail_open':return {leaseId:'fixture-detail'};
     case 'camera_power':return {awake:true,supported:false,writable:false};
     case 'camera_auxiliary':return {alarm:{supported:false},light:{supported:false}};
     case 'monitor_detail_close':return;
    }
   }
   throw Error('Offline monitor fixture denied IPC: '+command);
  }
 };
 if(main&&new URLSearchParams(location.search).has('startup')){
  desk.monitorSeparateWindow=true;
  settings.startupMonitor=true;
  settings.startupHome={scope,homeId:'a'};
 }
}

async function checkWindows(checks){
 const check=async(name,peer,expression)=>{
  const passed=!!await peer.evaluate(expression);
  checks.push({name,passed});
  if(!passed)throw Error(name);
 };
 const prepare=(peer,label)=>peer.call('Page.addScriptToEvaluateOnNewDocument',{source:`(${monitorFixture.toString()})(${JSON.stringify(label)})`});
 const openSettings=async()=>{
  await client.evaluate('document.querySelector(".home-account").click()');
  await until(client,'!!document.querySelector(".account-menu-item")');
  await client.evaluate('[...document.querySelectorAll(".account-menu-item")].find(b=>b.textContent.includes("设置")).click()');
  await until(client,'!!document.querySelector("[data-focus-key=settings-nav-monitor]")');
  await client.evaluate('document.querySelector("[data-focus-key=settings-nav-monitor]").click()');
  await until(client,'!!document.querySelector("[data-focus-key=monitor-separate-window]")');
 };
 const switchHome=async(peer,id)=>{
  await until(peer,'!!document.querySelector(".monitor-home-trigger:enabled")');
  await peer.evaluate('document.querySelector(".monitor-home-trigger").click()');
  await peer.evaluate(`document.querySelector('.monitor-home-menu button[value="${id}"]').click()`);
 };
 await prepare(client,'main');
 await client.call('Page.navigate',{url:address});
 await until(client,'document.querySelector(".home-title")?.textContent.includes("测试家庭 a")');
 await openSettings();
 await check('the independent window preference starts off',client,'document.querySelector("[data-focus-key=monitor-separate-window]").getAttribute("aria-checked")==="false"');
 await client.evaluate('document.querySelector("[data-focus-key=monitor-separate-window]").click()');
 await until(client,'document.querySelector("[data-focus-key=monitor-mode]")?.disabled===false');
 await client.evaluate('document.querySelector("[data-focus-key=monitor-mode]").click()');
 await until(client,'document.querySelector("[data-focus-key=monitor-mode]")?.getAttribute("aria-checked")==="true"');
 await check('start preserves main settings and sends the current household to the detached window',client,
  'monitorFixture.calls.some(c=>c.command==="open_detached_monitor"&&c.args.target.homeId==="a")&&!monitorFixture.calls.some(c=>c.command==="monitor_window")&&!!document.querySelector(".settings-page")');

 const {targetId}=await client.call('Target.createTarget',{url:'about:blank'});
 const child=await connect((await pages(9444)).find(page=>page.id===targetId));
 try{
  await child.call('Page.enable');
  await prepare(child,'monitor-fixture');
  await child.call('Page.navigate',{url:address+'/monitor.html'});
  await until(child,'document.querySelector(".monitor-tile")?.dataset.did==="camera-a"&&monitorFixture.calls.some(c=>c.command==="read_monitor_all")');
  await check('a separate entry loads the same camera wall without booting the main application',child,
   'document.querySelector(".desktop-title-drag").textContent==="米家监控"&&monitorFixture.calls.some(c=>c.command==="create_monitor_all"&&c.args.dids.join()==="camera-a")&&!monitorFixture.calls.some(c=>["monitor_window","session","list_homes","select_home","application_settings"].includes(c.command))');
  await child.call('Page.bringToFront');
  const move=y=>child.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:100,y});
  await move(100);
  await check('detached wall uses the full viewport with the title bar hidden',child,
   'document.querySelector(".monitor-wall").getBoundingClientRect().top===0&&getComputedStyle(document.querySelector(".desktop-titlebar")).opacity==="0"');
  await move(12);
  await check('pointer enters the shared monitor title bar without an animation delay',child,
   'getComputedStyle(document.querySelector(".desktop-titlebar")).opacity==="1"&&document.querySelector(".desktop-monitor-actions").lastElementChild.matches(".monitor-home-picker")');
  await move(100);
  await check('leaving the title bar hides it in the same frame',child,
   'getComputedStyle(document.querySelector(".desktop-titlebar")).opacity==="0"');
  await client.evaluate('document.querySelector("[data-focus-key=settings-back]").click()');
  await until(client,'!!document.querySelector(".home-title")');
  await client.evaluate('document.querySelector(".home-title").click()');
  await until(client,'[...document.querySelectorAll(".home-menu button")].some(b=>b.textContent.includes("测试家庭 b"))');
  await client.evaluate('[...document.querySelectorAll(".home-menu button")].find(b=>b.textContent.includes("测试家庭 b")).click()');
  await until(client,'document.querySelector(".home-title")?.textContent.includes("测试家庭 b")');
  await check('main household changes leave the original detached stream running',child,
   'monitorFixture.calls.filter(c=>c.command==="create_monitor_all").length===1&&!monitorFixture.calls.some(c=>c.command==="stop_monitor_all")');
  await child.evaluate('monitorFixture.inUse=true');
  await until(child,'document.querySelector(".monitor-retry")?.textContent==="查看播放窗口"');
  await child.evaluate('document.querySelector(".monitor-retry").click()');
  await until(child,'monitorFixture.calls.some(c=>c.command==="focus_camera_view")');
  await check('an occupied camera opens its existing viewer without another session',child,
   'monitorFixture.calls.filter(c=>c.command==="create_monitor_all").length===1&&monitorFixture.calls.find(c=>c.command==="focus_camera_view").args.did==="camera-a"');
  await child.evaluate('monitorFixture.inUse=false;monitorFixture.renew=true');
  await until(child,'monitorFixture.calls.some(c=>c.command==="read_monitor_all"&&c.args.viewerId==="fixture-group-2")');
  await check('a renewed login replaces the previous group without exposing the main window',child,
   'monitorFixture.calls.some(c=>c.command==="stop_monitor_all"&&c.args.viewerId==="fixture-group-1")&&monitorFixture.calls.filter(c=>c.command==="create_monitor_all").length===2');
  await switchHome(child,'b');
  await until(child,'document.querySelector(".monitor-tile")?.dataset.did==="camera-b"&&monitorFixture.calls.some(c=>c.command==="create_monitor_all"&&c.args.homeId==="b")');
  await check('detached home selection replaces only its monitor group with a scoped request',child,
   'monitorFixture.calls.findLast(c=>c.command==="create_monitor_all").args.dids.join()==="camera-b"&&monitorFixture.calls.some(c=>c.command==="stop_monitor_all"&&c.args.viewerId==="fixture-group-2")&&!monitorFixture.calls.some(c=>c.command==="select_home")');
  await switchHome(child,'empty');
  await until(child,'!document.querySelector(".monitor-tile")&&!!document.querySelector(".monitor-empty:not([hidden])")');
  await switchHome(child,'a');
  await until(child,'monitorFixture.calls.some(c=>c.command==="read_monitor_all"&&c.args.viewerId==="fixture-group-4")');
  await child.evaluate('monitorFixture.loggedIn=false');
  await until(child,'monitorFixture.calls.some(c=>c.command==="plugin:window|close")');
  await child.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide"))');
  await until(child,'monitorFixture.calls.some(c=>c.command==="stop_monitor_all"&&c.args.viewerId==="fixture-group-4")');
  await delay(180);
  await check('expiry and close stop the detached group and dispose its tiles',child,'!document.querySelector(".monitor-tile")');
 }finally{
  child.close();
  await client.call('Target.closeTarget',{targetId});
  await client.call('Page.bringToFront');
 }
 await client.call('Page.navigate',{url:address+'/?startup'});
 await until(client,'document.querySelector(".home-title")?.textContent.includes("测试家庭 b")&&monitorFixture.calls.some(c=>c.command==="open_detached_monitor")');
 await check('configured startup monitors its saved home while restoring the main home independently',client,
  'monitorFixture.calls.find(c=>c.command==="open_detached_monitor").args.target.homeId==="a"&&monitorFixture.calls.filter(c=>c.command==="select_home").every(c=>c.args.homeId==="b")');
 await client.call('Page.navigate',{url:address});
 await until(client,'document.querySelector(".home-title")?.textContent.includes("测试家庭 b")');
 await openSettings();
 await until(client,'document.querySelector("[data-focus-key=monitor-mode]")?.disabled===false');
 await client.evaluate('document.querySelector("[data-focus-key=monitor-mode]").click()');
 await until(client,'monitorFixture.calls.some(c=>c.command==="read_monitor")');
 await switchHome(client,'a');
 await until(client,'monitorFixture.calls.some(c=>c.command==="create_monitor_all"&&c.args.homeId==="a")');
 await check('inline monitor switches homes without changing the main household',client,
  'document.querySelector(".monitor-tile")?.dataset.did==="camera-a"&&monitorFixture.calls.filter(c=>c.command==="select_home").every(c=>c.args.homeId==="b")');
}

try{
 await client.call('Page.enable');
 await client.call('Emulation.setFocusEmulationEnabled',{enabled:true});
 await client.call('Page.navigate',{url:address+'/scripts/monitor-catalog-fixture.html'});
 await until(client,'typeof runMonitorChecks==="function"',600);
 const report=await client.evaluate('runMonitorChecks()');
 if(report.complete)try{await checkWindows(report.checks);}catch(error){report.complete=false;report.error=String(error);}
 await fs.mkdir(path.dirname(path.resolve(out)),{recursive:true});
 await fs.writeFile(out,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
 if(!report.complete)process.exitCode=1;
}finally{client.close();}
