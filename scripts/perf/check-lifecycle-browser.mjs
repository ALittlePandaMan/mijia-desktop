import fs from'node:fs/promises';import path from'node:path';import{connect,pages,until}from'./cdp.mjs';
const port=Number(process.argv[2]??9444),base=process.argv[3]??'http://127.0.0.1:1421',output=process.argv[4]??'.cache/perf/media-lifecycle.json';const target=(await pages(port))[0];if(!target)throw Error('Start a disposable browser with its own data directory and diagnostic port');
const c=await connect(target);
try{
 await c.call('Page.enable');await c.call('Page.navigate',{url:`${base}/scripts/resource-lifecycle-fixture.html`});
 await until(c,'typeof window.runResourceChecks==="function"');
 const report=await c.evaluate('window.runResourceChecks()');
 if(report.complete)try{await homeSelection(report.checks);}catch(error){report.complete=false;report.error=String(error);}
 await fs.mkdir(path.dirname(path.resolve(output)),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.complete)process.exitCode=1;
}finally{c.close();}

async function homeSelection(checks){
 const washerPanel=JSON.parse(await fs.readFile('src-tauri/src/fixtures/washer-panel.json','utf8')),washerConfig=JSON.parse(await fs.readFile('src-tauri/src/fixtures/washer-config.json','utf8'));
 washerPanel.did='mock-washer';
 const mode=washerPanel.services.find(s=>s.name==='washer').properties.find(p=>p.name==='mode').valueList.find(v=>v.description.toLowerCase()==='smart').value;
 washerPanel.washerRuntime={state:'busy',active:true,mode,stage:'washing',remainingMinutes:23,reservationMinutes:null,weighing:false,hasDrying:false,cleaning:false,locked:false,
  steps:['称重','洗涤','漂洗','脱水'].map((label,id)=>({id,label,progress:id===0?'done':id===1?'current':'pending'})),controls:[]};
 await c.call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
  const params=new URLSearchParams(location.search),userId=params.get('account')||'simulated-a',region='cn';
  const washerPanel=${JSON.stringify(washerPanel)},washerConfig=${JSON.stringify(washerConfig)};
  const washer={did:washerPanel.did,model:washerPanel.model,specType:washerPanel.specType,name:'洗衣机',online:true,roomId:'',roomName:''};
  const homes=(params.has('limited')?['first']:['first','second','third']).map(id=>({id,name:id,ownerId:userId,rooms:[],shared:false}));
  window.selectedHomes=[];window.heldHome=null;window.finishHeldHome=null;
  window.startupErrors=[];window.mockCommands=[];
  Object.defineProperty(document,'hidden',{get:()=>false});
  addEventListener('error',event=>startupErrors.push(event.message));
  addEventListener('unhandledrejection',event=>startupErrors.push(String(event.reason?.message??event.reason)));
  window.isTauri=true;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
  let sequence=0;
  window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>++sequence,invoke:async(command,args={})=>{
   mockCommands.push(command);
   switch(command){
    case 'plugin:event|listen':case 'plugin:event|unlisten':return ++sequence;
    case 'session':return {loggedIn:true,userId,region};
    case 'list_homes':return homes;
    case 'account_profile':return {displayName:'Fixture'};
    case 'select_home':{
     const value={homeId:args.homeId,generation:++sequence,devices:params.has('washer')?[washer]:[]};selectedHomes.push(value.homeId);
     if(window.heldHome===value.homeId){window.heldHome=null;await new Promise(resolve=>window.finishHeldHome=resolve);}
     return value;
    }
    case 'home_scenes':return {...args,scenes:[]};
    case 'home_preferences':return {monitor:{enabled:false,excludedDeviceIds:[]},hideOffline:false,dragLocked:false,splitSwitches:false,hiddenDeviceIds:[],homeHiddenDeviceIds:[],roomOrders:{}};
    case 'washer_config':return {did:washer.did,model:washer.model,firmware:'2.2.5',fetchedAt:1,config:washerConfig};
    case 'device_panel':case 'read_properties':return washerPanel;
    case 'device_preview':return {panel:washerPanel,cachedAt:0,hasCachedState:true};
    case 'home_cards':return {...args,cards:[],statuses:{}};
    case 'desktop_resource_snapshot':return {version:1,revision:1,visible:true,refreshMs:10000,monitorBackground:false};
    case 'plugin:window|is_minimized':case 'plugin:window|is_maximized':return false;
    case 'plugin:window|show':case 'plugin:window|set_theme':case 'plugin:window|set_background_color':case 'desktop_frontend_idle':return;
    default:throw Error('Offline fixture denied '+command);
   }
  }};
 })();`});
 const open=async(query,expected)=>{
  await c.call('Page.navigate',{url:base+'/?'+query});
  try{await until(c,`window.selectedHomes?.[0]===${JSON.stringify(expected)}&&document.querySelector('.home-title')?.textContent===${JSON.stringify(expected)}&&document.querySelector('.home-screen')?.dataset.localPreferencesReady==='true'`,50);}
  catch(error){throw Error(`${error.message}: ${JSON.stringify(await c.evaluate("({selectedHomes,mockCommands,startupErrors,title:document.querySelector('.home-title')?.textContent,body:document.body.textContent.slice(0,300)})"))}`);}
 };
 const choose=id=>c.evaluate(`(()=>{document.querySelector('.home-title').click();document.querySelector('[data-focus-key=home-choice-${id}]').click();})()`);
 const saved=id=>`localStorage.getItem('mijia.last-home.v1:'+JSON.stringify(['cn','simulated-a']))===${JSON.stringify(id)}`;
 await open('case=first','first');
 await choose('second');await until(c,saved('second'));
 await open('case=reopen','second');
 checks.push({name:'the production home switcher restores the confirmed last home on a new page',passed:true});
 await c.evaluate("window.heldHome='third'");await choose('third');await until(c,'typeof window.finishHeldHome==="function"');
 await choose('second');await until(c,"window.selectedHomes?.join(',')==='second,third,second'&&document.querySelector('.home-screen')?.dataset.localPreferencesReady==='true'");
 const preserved=await c.evaluate(`(async()=>{window.finishHeldHome();await new Promise(resolve=>setTimeout(resolve,50));return ${saved('second')}&&document.querySelector('.home-title')?.textContent==='second';})()`);
 checks.push({name:'a late home switch response does not persist or redraw the stale home',passed:!!preserved});if(!preserved)throw Error('stale home selection won');
 await open('account=simulated-b','first');await open('limited','first');await open('case=access-restored','second');
 checks.push({name:'another account or missing home falls back without replacing the original choice',passed:true});
 await open('washer','second');
 await until(c,"!!document.querySelector('.device-card-open')",40);
 await c.evaluate("document.querySelector('.device-card-open').click()");
 await until(c,"!!document.querySelector('.washer-home-status')&&!document.querySelector('.washer-runtime-page')&&!document.querySelector('.device-opening')",40);
 const summary=await c.evaluate("(()=>{const b=document.querySelector('.washer-home-status');return b.textContent.includes('主洗中')&&b.textContent.includes('智能洗')&&/预计.*完成/.test(b.textContent);})()");
 checks.push({name:'an active washer initially opens the overview with a real phase and finish estimate',passed:!!summary});if(!summary)throw Error('washer overview');
 await c.evaluate("document.querySelector('.washer-home-status').click()");
 await until(c,"document.querySelector('.washer-runtime-hero h3')?.textContent==='工作中'");
 const runtime=await c.evaluate("document.querySelectorAll('.washer-runtime-art i').length===3&&document.querySelector('[aria-current=step]')?.textContent.includes('主洗')&&document.querySelectorAll('.washer-runtime-step').length===4");
 checks.push({name:'the progress card opens the washer phase timeline by explicit click',passed:!!runtime});if(!runtime)throw Error('washer timeline');
 await c.evaluate("document.querySelector('.washer-runtime-page .page-icon-button').click()");
 await until(c,"document.activeElement===document.querySelector('.washer-home-status')&&!document.querySelector('.washer-runtime-page')");
 checks.push({name:'returning from the timeline restores the overview and progress card focus',passed:true});
}
