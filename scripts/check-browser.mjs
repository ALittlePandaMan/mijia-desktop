import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';import os from 'node:os';import net from 'node:net';
const out=path.resolve(process.argv[2]??'.cache/browser-regression');
await fs.mkdir(out,{recursive:true});
const free=port=>new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(Error('Required fixture port is in use: '+port)));server.listen(port,'127.0.0.1',()=>server.close(resolve));});
await free(1421);await free(9444);
const candidates=[process.env.CHROME_PATH,path.join(process.env.PROGRAMFILES??'','Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']??'','Google/Chrome/Application/chrome.exe'),path.join(process.env.PROGRAMFILES??'','Microsoft/Edge/Application/msedge.exe'),'/usr/bin/google-chrome','/usr/bin/chromium'];
let browserPath;for(const candidate of candidates.filter(Boolean)){try{await fs.access(candidate);browserPath=candidate;break;}catch{}}if(!browserPath)throw Error('Set CHROME_PATH to an installed Chrome or Edge executable');
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'mijia-offline-browser-'));
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1421','--strictPort'],{windowsHide:true,stdio:'ignore'});
const browser=spawn(browserPath,['--headless=new','--disable-extensions','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9444','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});

import {pages,connect} from './perf/cdp.mjs';
const filters=new Set((process.env.MIJIA_BROWSER_SCRIPTS??'').split(',').filter(Boolean));
const entries=[
 ['scripts/check-compat-media.mjs',path.join(out,'compat-media-browser.json'),path.join(out,'compat-media-browser.json')],
 ['scripts/check-monitor-catalog.mjs',path.join(out,'monitor-catalog-browser.json'),path.join(out,'monitor-catalog-browser.json')],
 ['scripts/check-assistant.mjs','.tools/assistant-browser-results.json'],
 ['scripts/check-card-captions.mjs','.tools/card-captions-browser-results.json'],
 ['scripts/check-card-interactions.mjs','.tools/card-interaction-browser-results.json'],
 ['scripts/check-card-sizes.mjs','.tools/card-size-browser-results.json'],
 ['scripts/check-card-style.mjs','.tools/card-style-browser-results.json'],
 ['scripts/check-card-templates.mjs','.tools/card-templates-browser-results.json'],
 ['scripts/check-local-first.mjs','.tools/local-first-browser-results.json'],
 ['scripts/check-settings-style.mjs',path.join(out,'settings-style/results.json'),path.join(out,'settings-style')],
 ['scripts/check-desktop-grid.mjs','.tools/desktop-grid-browser-results.json'],
 ['scripts/perf/check-widget-browser.mjs',path.join(out,'widget-browser.json'),path.join(out,'widget-browser.json')],
 ['scripts/perf/check-lifecycle-browser.mjs',path.join(out,'lifecycle-browser.json'),'9444','http://127.0.0.1:1421',path.join(out,'lifecycle-browser.json')],
].filter(([script])=>!filters.size||filters.has(script));
const results=[];
try{
for(let n=0;n<100;n++){try{if((await pages(9444)).length&&(await fetch('http://127.0.0.1:1421/scripts/compat-media-fixture.ts',{signal:AbortSignal.timeout(5000)})).ok)break;}catch{}if(n===99)throw Error('Browser fixture startup timed out');await new Promise(r=>setTimeout(r,200));}
for(const [script,resultPath,...args]of entries){
 await fs.mkdir(path.dirname(resultPath),{recursive:true});
 const targets=await pages(9444);const c=await connect(targets[0]);
 try{if(!results.length)console.log(JSON.stringify({mockBrowserEnvironment:{prefersReducedMotion:await c.evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches')}}));const fresh=await c.call('Target.createTarget',{url:'about:blank'});await c.call('Target.activateTarget',{targetId:fresh.targetId});for(const target of targets)await c.call('Target.closeTarget',{targetId:target.id});}finally{c.close();}
 const run=await new Promise(resolve=>{const child=spawn(process.execPath,[script,...args],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const timer=setTimeout(()=>child.kill(),180000);child.on('close',code=>{clearTimeout(timer);resolve({code,output});});});
 const name=script.split('/').at(-1).replace('.mjs','');await fs.writeFile(path.join(out,`${name}.log`),run.output);
 let report;try{report=JSON.parse(await fs.readFile(resultPath,'utf8'));await fs.writeFile(path.join(out,`${name}.json`),JSON.stringify(report,null,2));}catch{}
 const checks=report?.checks??[];const item={script,exitCode:run.code,checks:checks.length,passed:checks.filter(c=>c.passed).length,complete:run.code===0&&checks.length>0&&checks.every(c=>c.passed)};results.push(item);console.log(JSON.stringify(item));
 if(!item.complete){console.error(JSON.stringify({script,failures:checks.filter(c=>!c.passed)}));console.error(run.output.slice(-16000));}
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify({mockOnly:true,deviceWrites:0,results},null,2));
}
if(results.some(r=>!r.complete))process.exitCode=1;

}finally{try{const c=await connect((await pages(9444))[0]);await c.call('Browser.close');c.close();}catch{}for(const child of[browser,vite])if(child.exitCode===null)child.kill();}
