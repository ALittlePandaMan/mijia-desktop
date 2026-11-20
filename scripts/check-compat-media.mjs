import {pages,connect,until,delay} from './perf/cdp.mjs';
import fs from 'node:fs/promises';
const client=await connect((await pages(9444))[0]),checks=[];const output=process.argv[2]??'.tools/compat-media-browser.json';
const check=async(name,expression)=>{const passed=!!await client.evaluate(expression);checks.push({name,passed});if(!passed)throw Error(name);};
try{
 await client.call('Page.enable');await client.call('Runtime.enable');
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
  await check(`${render} exported diagnostic keeps source and output separate and omits identities`,`(async()=>{
   const report=await compatFixture.diagnostic(),sample=report.lenses?.[0]?.samples?.[0];
   return sample?.codec==='hevc'&&sample.quality==='uhd'&&sample.source.width===2560&&sample.output.width===2560&&sample.viewport.width<2560&&sample.receiveBytesPerSecond===220000&&!JSON.stringify(report).includes('mock-');
  })()`);
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
   const point=await client.evaluate("(()=>{const r=document.querySelector('#fixture-fullscreen').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
   for(const type of ['mousePressed','mouseReleased'])await client.call('Input.dispatchMouseEvent',{type,...point,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});
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
  await client.evaluate('compatFixture.open("mp4")');await until(client,'compatFixture.state.leases===1');await client.evaluate('compatFixture.send(0)');await until(client,'compatFixture.state.ready===2&&compatFixture.acknowledged()');
  await client.evaluate('compatFixture.pause();compatFixture.send(.08)');await delay(120);await check(`${render} paused playback holds only the bounded pending frame`,'!compatFixture.acknowledged()&&compatFixture.state.paused');await client.evaluate('compatFixture.play()');await until(client,'compatFixture.acknowledged()');
  await client.evaluate('compatFixture.seek(4)');await check(`${render} seeking delegates the existing timeline`,'compatFixture.seeks.length===1&&compatFixture.seeks[0]===4');
  await client.evaluate('compatFixture.stale()');await until(client,'compatFixture.state.leases===0');await check(`${render} stale context closes decoding once`,'compatFixture.errors.length===1&&!compatFixture.state.canvas');
  await check(`${render} cloud playback falls back when play rejects after metadata and produces a software frame`,'compatFixture.cloudFallback()');
  await until(client,'compatFixture.state.leases===0');
  await check(`${render} all commands are local decoder or explicit update checks`,"compatFixture.calls.every(c=>c.command.startsWith('camera_decode_')||c.command.startsWith('plugin:event|')||c.command==='check_app_update')");
  await check(`${render} no browser errors`,'fixtureErrors.length===0');
 }
 console.log(JSON.stringify({passed:checks.length,mockOnly:true,nativeAcceptance:false}));
}finally{await fs.writeFile(output,JSON.stringify({checks,mockOnly:true,nativeAcceptance:false},null,2));client.close();}
