import {pages,connect,until,delay} from './perf/cdp.mjs';
import fs from 'node:fs/promises';
const client=await connect((await pages(9444))[0]),checks=[];const output=process.argv[2]??'.tools/compat-media-browser.json';
const check=async(name,expression)=>{const passed=!!await client.evaluate(expression);checks.push({name,passed});if(!passed)throw Error(name);};
try{
 await client.call('Page.enable');await client.call('Page.bringToFront');await client.call('Emulation.setFocusEmulationEnabled',{enabled:true});await client.call('Runtime.enable');
 await client.call('Page.addScriptToEvaluateOnNewDocument',{source:"window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));"});
 for(const render of ['', '?render2d=1']){
  const url='http://127.0.0.1:1421/scripts/compat-media-fixture.html'+render;
  const {errorText}=await client.call('Page.navigate',{url});
  if(errorText)throw Error(`Could not load the offline media fixture: ${errorText}`);
  try{await until(client,'!!window.compatFixture || !!window.fixtureErrors?.length');}
  catch(error){
   const state=await client.evaluate('({url:location.href,ready:document.readyState,errors:window.fixtureErrors??[]})');
   throw Error(`Offline media fixture did not initialize: ${JSON.stringify(state)}`,{cause:error});
  }
  const fixtureErrors=await client.evaluate('window.fixtureErrors??[]');
  if(fixtureErrors.length)throw Error(`Offline media fixture failed to start: ${fixtureErrors.join("; ")}`);
  for(const [mode,message]of [['current','当前已是最新版本。'],['available','发现新版本 v1.0.1，可以更新。'],['throw','检查更新失败，请重试。']]){
   await client.evaluate(`compatFixture.clearToast();compatFixture.setMode(${JSON.stringify(mode)});document.querySelector('[data-focus-key=app-update-check]').click();document.querySelector('[data-focus-key=app-update-check]').click();`);
   await until(client,`document.querySelector('.camera-media-toast')?.textContent.includes(${JSON.stringify(message)})`);
   await check(`${render} ${mode} has one toast and no inline result prose`,"document.querySelectorAll('.camera-media-toast').length===1&&!document.querySelector('.settings-update-message')&& !document.querySelector('main').textContent.includes('DO NOT DISPLAY BACKEND PROSE')");
   await client.evaluate('compatFixture.render()');await check(`${render} rerender retains one notification`,"document.querySelectorAll('.camera-media-toast').length===1");
  }
  await check(`${render} repeated clicks admitted three checks only`,'compatFixture.checks===3');
  await client.evaluate('compatFixture.clearToast();compatFixture.controller.acceptUpdate({...compatFixture.controller.data.update,revision:100,state:"current"})');await delay(80);await check(`${render} background status does not toast`,"!document.querySelector('.camera-media-toast')");
  await client.evaluate('compatFixture.watch();compatFixture.open()');await until(client,'compatFixture.state.leases===1');await client.evaluate('compatFixture.send(2.5,2560,1440,false,2560,1440)');await until(client,'compatFixture.state.ready===2&&compatFixture.acknowledged()');
  await check(`${render} software frame keeps source dimensions and clock`,'compatFixture.state.width===2560&&compatFixture.state.height===1440&&compatFixture.state.time===2.5&&compatFixture.frameCallbacks===1');
  await check(`${render} screenshot and layout screenshot use the actual software frame`,"compatFixture.shot().startsWith('iVBOR')&&compatFixture.layoutShot().startsWith('iVBOR')");
  await client.call('Emulation.setDeviceMetricsOverride',{width:1500,height:960,deviceScaleFactor:2,mobile:false});
  await client.evaluate("compatFixture.viewport.style.width='1280px';compatFixture.viewport.style.height='720px';document.dispatchEvent(new Event('fullscreenchange'))");
  await delay(150);
  await check(`${render} window and DPI changes keep the original worker and source-sized output`,"compatFixture.calls.filter(c=>c.command==='camera_decode_open').length===1&&compatFixture.calls.find(c=>c.command==='camera_decode_open').args.preserveSource===true&&!compatFixture.calls.some(c=>c.command==='camera_decode_viewport')&&compatFixture.viewport.querySelector('canvas').width===2560&&compatFixture.state.leases===1");
  await client.evaluate('compatFixture.send(2.75,2560,1440,false,2560,1440)');
  await until(client,"compatFixture.viewport.querySelector('canvas').width===2560&&compatFixture.acknowledged()");
  await client.evaluate("compatFixture.viewport.style.width='640px';compatFixture.viewport.style.height='360px'");
  await delay(150);
  await client.call('Emulation.clearDeviceMetricsOverride');
  await check(`${render} shrinking the live player preserves its decoded pixels`,"compatFixture.viewport.querySelector('canvas').width===2560&&compatFixture.state.leases===1");
  if(!render){
   await client.call('Emulation.setDeviceMetricsOverride',{width:1500,height:960,deviceScaleFactor:2,mobile:false});
   await client.evaluate('compatFixture.monitorLayout()');
   await client.call('Runtime.evaluate',{expression:"document.querySelector('#fixture-fullscreen').click()",userGesture:true,awaitPromise:true,returnByValue:true});
   await until(client,"document.fullscreenElement===compatFixture.viewport");
   await client.evaluate('document.exitFullscreen()');
   await until(client,"document.fullscreenElement===null");
   await check('monitor tile enters and exits fullscreen without downsizing or reopening the worker',"compatFixture.calls.filter(c=>c.command==='camera_decode_open').length===1&&!compatFixture.calls.some(c=>c.command==='camera_decode_viewport')&&compatFixture.viewport.querySelector('canvas').width===2560");
   await client.call('Emulation.clearDeviceMetricsOverride');
   await check('two software lenses keep their own source resolution despite different tile sizes','compatFixture.secondLens()');
  }
  const lost=await client.evaluate(`(()=>{
   const canvas=compatFixture.viewport.querySelector('canvas');
   if(canvas.dataset.renderer!=='software-webgl')return false;
   const extension=canvas.getContext('webgl')?.getExtension('WEBGL_lose_context');
   if(!extension)return false;
   extension.loseContext();return true;
  })()`);
  if(lost){
   await until(client,"compatFixture.viewport.querySelector('canvas').dataset.renderer==='software-canvas'");
   await client.evaluate('compatFixture.send(3)');
   await until(client,'compatFixture.acknowledged()');
   await check(`${render} WebGL loss keeps the same worker and resumes on Canvas 2D`,"compatFixture.state.leases===1&&compatFixture.state.time===3&&compatFixture.shot().startsWith('iVBOR')");
  }
  await client.evaluate('compatFixture.close()');await until(client,'compatFixture.state.leases===0');await check(`${render} disposal releases its canvas and restores the video`,"!compatFixture.state.canvas&&compatFixture.video.style.visibility===''");
  await client.evaluate('compatFixture.open("mpegts",true)');
  await client.evaluate('compatFixture.send(0)');
  await until(client,'compatFixture.state.ready===2&&compatFixture.acknowledged()');
  await client.evaluate('compatFixture.pause();compatFixture.send(4)');
  await delay(150);
  await check(`${render} software SD replay holds the next frame and its clock during pause`,'compatFixture.state.paused&&!compatFixture.acknowledged()&&compatFixture.state.time<.25');
  await client.evaluate('compatFixture.rate(4);compatFixture.play()');await delay(150);
  await check(`${render} software SD replay schedules the held frame at the new rate`,'!compatFixture.acknowledged()&&compatFixture.state.time>.3&&compatFixture.state.time<4');
  await until(client,'compatFixture.acknowledged()',15);
  await check(`${render} switching rate and resuming use the existing SD decoder`,"compatFixture.state.time===4&&compatFixture.state.leases===1&&compatFixture.calls.filter(c=>c.command==='camera_decode_open'&&c.args.replay).length===1");
  await client.evaluate('compatFixture.close()');await until(client,'compatFixture.state.leases===0');
  await client.evaluate('compatFixture.open("mp4")');await until(client,'compatFixture.state.leases===1');await client.evaluate('compatFixture.send(0)');await until(client,'compatFixture.state.ready===2&&compatFixture.acknowledged()');
  await client.evaluate('compatFixture.pause();compatFixture.send(.08)');await delay(120);await check(`${render} paused playback holds only the bounded pending frame`,'!compatFixture.acknowledged()&&compatFixture.state.paused');await client.evaluate('compatFixture.play()');await until(client,'compatFixture.acknowledged()');
  await client.evaluate('compatFixture.seek(4)');await check(`${render} seeking delegates the existing timeline`,'compatFixture.seeks.length===1&&compatFixture.seeks[0]===4');
  await client.evaluate('compatFixture.stale()');await until(client,'compatFixture.state.leases===0');await check(`${render} stale context releases the failed surface and its last frame`,'compatFixture.errors.length===1&&!compatFixture.state.canvas&&compatFixture.state.ready===0');
  await check(`${render} cloud playback falls back when play rejects after metadata and produces a software frame`,'compatFixture.cloudFallback()');
  if(!render){
   await check('decoder capacity preserves the monitor route and resumes its original input', 'compatFixture.decoderCapacity()');
   await check('saturated software preview resumes at the next keyframe in the existing worker', 'compatFixture.keyframeAfterSaturation()');
   await check('at capacity monitor main lenses and recordings take priority over insets', 'compatFixture.decoderMainLensPriority()');
   await check('a frame already posted when the last decoder closes is released', 'compatFixture.releaseClosingFrame()');
  }
  if(!render)await check('unavailable or silent system decoding reuses the paused 4x stream in one software worker','compatFixture.systemStartupTimeout()');
  await until(client,'compatFixture.state.leases===0');
  await check(`${render} all commands are local decoder, preferences, or explicit update checks`,"compatFixture.calls.every(c=>c.command.startsWith('camera_decode_')||c.command.startsWith('plugin:event|')||['home_preferences','change_home_preferences','check_app_update'].includes(c.command))");
  await check(`${render} no browser errors`,'fixtureErrors.length===0');
 }
 console.log(JSON.stringify({passed:checks.length,mockOnly:true,nativeAcceptance:false}));
}finally{await fs.writeFile(output,JSON.stringify({checks,mockOnly:true,nativeAcceptance:false},null,2));client.close();}
