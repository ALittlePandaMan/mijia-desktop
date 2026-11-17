import fs from'node:fs/promises';import path from'node:path';import{execFile,spawn}from'node:child_process';import{promisify}from'node:util';import{createHash}from'node:crypto';import{main,pages,connect,until,delay}from'./cdp.mjs';import{summarize}from'./summarize.mjs';
const args=Object.fromEntries(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]?.startsWith('--')?true:a[i+1]??true]:null).filter(Boolean));
if(!args['allow-layout-changes']||!args.fixture||!args.exe||!args.pid||!args.out)throw Error('Requires --fixture private.json --exe app.exe --pid ID --out report.json --allow-layout-changes. Run with an isolated backed-up widget layout.');
const run=promisify(execFile),fixture=JSON.parse(await fs.readFile(args.fixture,'utf8')),candidates=fixture.devices??fixture.created,seconds=Number(args.seconds??30),created=[],covers=[];let app=await main(Number(args.port??9442));
const report={version:1,complete:false,at:new Date().toISOString(),binarySha256:createHash('sha256').update(await fs.readFile(args.exe)).digest('hex'),physicalDeviceWrites:0,scenes:[]};
const save=()=>fs.writeFile(args.out,JSON.stringify(report,null,2));const diag=async()=>{const d=await app.invoke('desktop_widget_diagnostics');return{hosts:d.hosts.map(h=>({cards:h.cards??1,child:h.host?.child,topmost:h.host?.alwaysOnTop,parentClass:h.host?.parentClass})),cache:d.cache,frontend:d.frontend,resources:d.resources,requestCounts:d.samples?.map(s=>({phase:s.phase,counts:s.counts}))};};
async function closeCovers(){for(const child of covers.splice(0)){await fs.writeFile(child.closeSignal,'close');if(child.exitCode===null)await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(10000)]);if(child.exitCode===null){child.kill();await delay(1500);}await fs.unlink(child.closeSignal).catch(()=>{});}await delay(500);}
async function wake(){await run('pwsh.exe',['-NoProfile','-File','scripts/perf/activate-windows.ps1','-Executable',args.exe],{windowsHide:true,timeout:15000});await delay(600);app.close();app=await main(Number(args.port??9442));await until(app,"!!document.querySelector('.home-title')");}
async function heaps(){const result=[];for(const target of await pages(Number(args.port??9442))){const c=await connect(target);try{const usage=await c.call('Runtime.getHeapUsage',{},1500);result.push({widget:target.url.includes('widget.html'),usedBytes:usage.usedSize});}catch{result.push({widget:target.url.includes('widget.html'),unavailable:'Renderer suspended; not woken for instrumentation'});}finally{c.close();}}return result;}
async function measure(cards,layout,mode){
 console.log(JSON.stringify({stage:'begin',cards,layout,mode,at:new Date().toISOString()}));
 await wake();let before=await diag(),heap=await heaps();if(mode==='covered'){await app.evaluate("document.querySelector('button[aria-label=\"最小化\"]').click()");for(let n=0;n<(await app.invoke('desktop_widget_diagnostics')).monitors.length;n++){const closeSignal=path.resolve(path.dirname(args.out),`cover-${process.pid}-${n}.close`);await fs.unlink(closeSignal).catch(()=>{});const child=spawn('pwsh.exe',['-NoProfile','-File','scripts/perf/cover-windows.ps1','-Monitor',String(n),'-Seconds',String(seconds+80),'-CloseSignalPath',closeSignal],{windowsHide:true,stdio:'ignore'});child.closeSignal=closeSignal;covers.push(child);}}
 await delay(35000);if(mode!=='covered'){before=await diag();heap=await heaps();}const file=path.resolve(path.dirname(args.out),`capture-${path.basename(args.out,'.json')}-${cards}-${layout}-${mode}.json`);
 await run('pwsh.exe',['-NoProfile','-File','scripts/perf/sample-windows.ps1','-RootPid',String(args.pid),'-Seconds',String(seconds),'-Output',file],{windowsHide:true,maxBuffer:1024*1024});
 console.log(JSON.stringify({stage:'sampled',cards,mode}));await closeCovers();console.log(JSON.stringify({stage:'covers-closed',cards,mode}));await wake();console.log(JSON.stringify({stage:'woke',cards,mode}));const after=await diag(),capture=JSON.parse(await fs.readFile(file,'utf8'));
 report.scenes.push({cards,layout,mode,seconds,heap,summary:summarize(capture),rawCapture:path.basename(file),before,after});await save();
}
try{
 await until(app,"document.querySelectorAll('.device-card').length>10&&document.querySelector('.home-screen').dataset.homeCardsReady==='true'");if((await app.invoke('desktop_widget_support')).pins.length)throw Error('Use an empty temporary layout; existing user pins must be preserved outside this run');
 report.runtime=(await(await fetch(`http://127.0.0.1:${Number(args.port??9442)}/json/version`)).json()).Browser;
 for(const count of[0,1,5,10]){
  if(count){const context=await app.invoke('select_home',{homeId:candidates[0].homeId});for(const d of candidates.slice(created.length,count)){const state=await app.invoke('desktop_widget_pin',{homeId:context.homeId,generation:context.generation,did:d.did});const p=state.pins.find(p=>p.did===d.did);if(!p)throw Error('Fixture could not be pinned');created.push(p);}
   await app.evaluate('location.reload()').catch(()=>{});await until(app,"document.querySelectorAll('.device-card').length>10&&document.querySelector('.home-screen').dataset.homeCardsReady==='true'");}
  if((await app.invoke('desktop_widget_support')).pins.length!==count)throw Error('Fixture pin count mismatch');
  if(args.modes!=='covered')await measure(count,'same-monitor','visible');if(args.modes!=='visible')await measure(count,'same-monitor','covered');
 }
 const d=await app.invoke('desktop_widget_diagnostics'),second=d.monitors.find(m=>!m.primary);
 if(second){for(let n=5;n<10;n++){const p=created[n];let host;for(const target of await pages(Number(args.port??9442))){if(!target.url.includes('widget.html'))continue;const c=await connect(target);try{const s=await c.invoke('desktop_widget_snapshot');if(s.cards?.some(x=>x.interactive&&x.view.id===p.id)||s.id===p.id){host=c;break;}}catch{}c.close();}if(!host)throw Error('Card host missing');try{await host.invoke('desktop_widget_geometry',{widgetId:p.id,geometry:{monitor:second.id,x:40+(n-5)*25,y:40+(n-5)*25,width:240}});}finally{host.close();}}
  if(args.modes!=='covered')await measure(10,'two-monitors','visible');if(args.modes!=='visible')await measure(10,'two-monitors','covered');
 }
 report.complete=true;
}catch(error){report.error=String(error);throw error;}finally{
 await closeCovers();await wake().catch(()=>{});
 const pins=(await app.invoke('desktop_widget_support').catch(()=>({pins:[]}))).pins;for(const p of pins.filter(p=>created.some(c=>c.id===p.id)))await app.invoke('desktop_widget_unpin',{id:p.id}).catch(()=>{});
 await save();app.close();
}
