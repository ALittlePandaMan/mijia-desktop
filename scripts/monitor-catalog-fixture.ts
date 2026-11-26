// Standalone offline fixture. All transports are mocks; no device command is sent.
import '../src/style.css';import '../src/theme.css';import '../src/ui/app-font.css';
import {MonitorCatalogController,selectedMonitorMembers,type MonitorCatalog} from '../src/monitor-catalog';
import {monitorPresetKey} from '../src/monitor-layout';
import {settingsPage,createSettingsViewState} from '../src/ui/settings-page';
import {ApplicationSettingsController} from '../src/ui/application-settings';
import {mountDesktopFrame} from '../src/ui/desktop-frame';
import {adoptFullscreen,nativeFullscreen} from '../src/desktop-fullscreen';
import type {CameraEvent} from '../src/camera-types';
import type {Device,Home} from '../src/types';import type {LocalPreferences,PreferenceChange} from '../src/local-preferences';
const root=document.querySelector<HTMLElement>('#app')!,checks:{name:string;passed:boolean}[]=[],calls:{command:string;args?:unknown}[]=[];
const wait=()=>new Promise(r=>setTimeout(r,20));
const check=(name:string,value:unknown)=>{checks.push({name,passed:!!value});if(!value)throw Error(name);};
const device=(did:string,readOnly=false):Device=>({did,name:'同名摄像头',model:'chuangmi.camera.mock',online:false,roomId:'room',roomName:'客厅',sharedReadOnly:readOnly});
const home=(id:string):Home=>({id,name:`家庭 ${id}`,ownerId:'mock',rooms:[],shared:false});
const saved:MonitorCatalog={scope:'mock-account',generation:8,allHomes:false,incomplete:false,homes:[{home:home('a'),devices:[device('one',true),device('two')],excludedDeviceIds:['two']},{home:home('b'),devices:[device('one'),device('three')],excludedDeviceIds:[]},{home:home('empty'),devices:[],excludedDeviceIds:[]}]};
const existingArtwork='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const remoteArtwork='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=';
saved.homes[1].devices[1]={...saved.homes[1].devices[1],model:'other.camera.mock',productIcon:remoteArtwork};
const prefs:LocalPreferences={hideOffline:false,dragLocked:false,splitSwitches:false,hiddenDeviceIds:[],homeHiddenDeviceIds:[],roomOrders:{},monitor:{enabled:false,excludedDeviceIds:saved.homes[0].excludedDeviceIds}};
let failSave=false;const view=createSettingsViewState('monitor');
const catalog=new MonitorCatalogController(render,{load:async()=>{calls.push({command:'catalog'});await wait();return structuredClone(saved);},change:async(_scope,home,did,excluded)=>{calls.push({command:'selection',args:{home,did,excluded}});await wait();if(failSave){failSave=false;throw Error('disk');}const h=saved.homes.find(h=>h.home.id===home)!;h.excludedDeviceIds=excluded?[...new Set([...h.excludedDeviceIds,did])]:h.excludedDeviceIds.filter(d=>d!==did);return structuredClone(saved);}});catalog.setAccount('mock-account');
const app=new ApplicationSettingsController(render);app.data={settings:{version:1,startupMonitor:true,startupHome:{scope:'mock-account',homeId:'a'},closeToTray:true,keepAwake:false,mcp:{enabled:false,localPort:8765,excludedHomes:[]}},scope:'mock-account',autostart:false,mcpStatus:{state:'stopped'},update:{revision:1,state:'idle',currentVersion:'mock',latestVersion:null,notes:null,checkedAt:null,downloadedBytes:0,totalBytes:null,message:'',packageKind:'portable',supported:false,canInstall:false,canDownload:false}};
(window as any).__TAURI_INTERNALS__={invoke:async(command:string,args:any)=>{calls.push({command,args});if(command==='change_application_settings'){app.data!.settings=structuredClone(args.value);return structuredClone(app.data);}if(command==='monitor_window')return;throw Error('Denied offline IPC: '+command);}};
function change(value:PreferenceChange){if(value.operation==='setMonitorAllHomes'){prefs.monitorAllHomes=value.value;render();if(value.value)void catalog.load();}if(value.operation==='setMonitorExcluded'){catalog.select('a',value.did,value.excluded);}if(value.operation==='setMonitorEnabled'){prefs.monitor!.enabled=value.value;render();}}
function render(){root.replaceChildren(settingsPage({view,homeAvailable:true,homeName:'家庭 a',devices:saved.homes[0].devices.map(d=>({...d,productIcon:existingArtwork})),preferences:prefs,monitorCatalog:catalog,loading:false,pending:false,changed:render,change,back(){},retry(){},artwork(){return document.createElement('span');},application:{card:(category,panel)=>app.card(category,panel,saved.homes.map(h=>h.home),'a')}}));}
const click=(key:string)=>{root.querySelector<HTMLButtonElement>(`[data-focus-key="${key}"]`)!.click();};
async function checkAudio(MonitorWall:typeof import('../src/ui/monitor-wall').MonitorWall){
 const OriginalAudioContext=window.AudioContext;
 const nativeHost=Reflect.get(window,'isTauri');
 let playing=0,closed=0,mutedCommands=0,finishListen:((value:{state:string})=>void)|undefined;
 let rejectAudioStart=false,finishMute:((value:{state:string})=>void)|undefined;
 class FixtureAudio {
  currentTime=0;state='running';destination={};
  async resume(){if(rejectAudioStart)throw Error('Audio output unavailable');}
  async close(){closed++;}
  createGain(){return {connect(){},disconnect(){}};}
  createBuffer(_channels:number,length:number,rate:number){return {duration:length/rate,copyToChannel(){}};}
  createBufferSource(){return {buffer:null,connect(){},disconnect(){},start(){playing++;},stop(){}};}
 }
 Object.defineProperty(window,'AudioContext',{configurable:true,value:FixtureAudio});
 const originalCapture=navigator.mediaDevices.getUserMedia;
 const features={qualities:[{id:'sd',label:'流畅'}],listen:true,talk:true,talkFormat:{codec:'pcma',sampleRate:8000},ptz:false,playback:false};
 const packet:CameraEvent={state:'audio',codec:'pcm',sampleRate:8000,data:btoa('\x00\x20'.repeat(160))};
 const camera={...device('fixture-audio'),online:true};
 let audio:CameraEvent[]=[];
 let connections=0,talkCommands=0,released=0,grant:((stream:MediaStream)=>void)|undefined;
 const track={stop:()=>{released++;}};
 const stream={getTracks:()=>[track]} as unknown as MediaStream;
 navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{grant=resolve;});
 const wall=new MonitorWall(()=>{},()=>{},{create:async()=>{connections++;return 'fixture';},
  read:async()=>[{did:camera.did,revision:1,state:'live',events:audio.splice(0),features}],
  command:async(_scope,_viewer,_did,_revision,operation)=>{
   if(operation.kind==='talk'){talkCommands++;return {state:operation.enabled?'talking':'talk-stopped'};}
   if(operation.kind!=='listen')throw Error('Unexpected simulated operation');
   if(operation.enabled)return new Promise(resolve=>{finishListen=resolve;});
   mutedCommands++;
   if(rejectAudioStart)return new Promise(resolve=>{finishMute=resolve;});
   return {state:'muted'};
  },retry:async()=>{},stop:async()=>{},
 });
 const sound=()=>wall.root.querySelector<HTMLButtonElement>('.monitor-audio-button[aria-pressed]');
 const until=async(fn:()=>unknown,attempts=100)=>{for(let attempt=0;attempt<attempts;attempt++){if(fn())return;await wait();}};
 try{
  Reflect.set(window,'isTauri',true);
  root.replaceChildren(wall.root);wall.update({homeId:'audio-home',generation:1,devices:[camera]},[],undefined,'mock-audio-account');
  await until(()=>sound()?.disabled===false);
  check('monitor starts muted with a usable sound button',sound()?.getAttribute('aria-pressed')==='false'&&sound()?.disabled===false);
  audio.push(packet);await new Promise(resolve=>setTimeout(resolve,200));
  check('muted monitor does not play a stray audio packet',playing===0);
  sound()!.click();await until(()=>!!finishListen);
  audio.push(packet);
  await until(()=>playing===1);
  check('monitor plays the first audio packet before the separate acknowledgement arrives',
   playing===1&&sound()?.getAttribute('aria-busy')==='true'&&sound()?.getAttribute('aria-pressed')==='false');
  finishListen!({state:'listening'});await until(()=>sound()?.disabled===false);
  check('audio uses the current monitor session',connections===1&&sound()?.getAttribute('aria-pressed')==='true');
  sound()!.click();await until(()=>mutedCommands===1&&sound()?.disabled===false);
  audio.push(packet);await new Promise(resolve=>setTimeout(resolve,200));
  check('muting closes the local output and drops late audio packets',closed===1&&playing===1&&sound()?.getAttribute('aria-pressed')==='false');
  finishListen=undefined;
  sound()!.click();await until(()=>!!finishListen);
  audio.push({...packet,data:'invalid-base64*'});
  finishListen!({state:'listening'});
  await until(()=>mutedCommands===2&&sound()?.disabled===false,150);
  check('a camera acknowledgement without playable audio leaves the monitor muted',
   connections===1&&closed===2&&playing===1&&sound()?.getAttribute('aria-pressed')==='false');
  finishListen=undefined;
  rejectAudioStart=true;
  sound()!.click();await until(()=>!!finishListen&&!!finishMute&&sound()?.disabled===false);
  check('failed local output releases the button before either command replies',
   !!finishListen&&!!finishMute&&closed===3&&sound()?.getAttribute('aria-busy')==='false'&&sound()?.getAttribute('aria-pressed')==='false');
  finishListen!({state:'listening'});finishMute!({state:'muted'});
  rejectAudioStart=false;
  const talk=wall.root.querySelector<HTMLButtonElement>('.monitor-audio-button[aria-label="开始通话"]')!;
  talk.click();await until(()=>!!grant);
  talk.click();grant!(stream);
  await until(()=>released===1);
  check('cancelling microphone permission releases a late stream without sending a talk command',
   released===1&&talkCommands===0&&talk.getAttribute('aria-pressed')==='false'&&talk.getAttribute('aria-label')==='开始通话');
 }finally{
  finishListen?.({state:'cancelled'});
  finishMute?.({state:'muted'});
  wall.close();
  grant?.(stream);
  navigator.mediaDevices.getUserMedia=originalCapture;
  Object.defineProperty(window,'AudioContext',{configurable:true,value:OriginalAudioContext});
  if(nativeHost===undefined)Reflect.deleteProperty(window,'isTauri');else Reflect.set(window,'isTauri',nativeHost);
 }
}
async function checkPresets(MonitorWall:typeof import('../src/ui/monitor-wall').MonitorWall){
 const account='split-fixture',homeId='split-home';
 const keys=[monitorPresetKey(account,homeId)!,monitorPresetKey(account,null)!,monitorPresetKey('other-split-account',homeId)!];
 for(const key of keys)localStorage.removeItem(key);
 let members:string[]=[],raiseRecording=false,fakeFrames=false,stops=0;
 const opened:string[][]=[];
 const qualityWrites:{did:string;quality:string}[]=[];
 const qualities=[{id:'hd',label:'高清',wireValue:3},{id:'sd',label:'流畅',wireValue:1}];
 const names=Array.from({length:21},(_,i)=>`camera-${i+1}`);
 const cameras=names.map((did,i)=>({...device(did),name:`测试摄像头 ${i+1}`}));
 const viewer=new MonitorWall(()=>{},()=>{},{
  create:async(_scope,dids)=>{members=dids;opened.push(dids);return `split-${opened.length}`;},
  read:async()=>members.map((did,i)=>({did,revision:1,state:fakeFrames||raiseRecording&&i===0?'connecting':'offline',events:raiseRecording&&i===0?[{state:'recording'}]:[],qualities})),
  command:async(_scope,_id,did,_revision,operation)=>{if(operation.kind==='quality')qualityWrites.push({did,quality:operation.quality});return {state:'ready'};},
  retry:async()=>{},stop:async()=>{stops++;},
 });
 const catalog=(count:number):MonitorCatalog=>({scope:account,generation:1,allHomes:true,incomplete:false,homes:[{home:home(homeId),devices:cameras.slice(0,count),excludedDeviceIds:[]}]});
 const show=(count:number,scope=account,generation=1)=>viewer.update({homeId,generation,devices:cameras.slice(0,count+1)},[names[count]],undefined,scope);
 const tiles=()=>[...viewer.root.querySelectorAll<HTMLElement>('.monitor-tile')];
 const tileNames=()=>tiles().map(t=>t.getAttribute('aria-label')?.split('，')[0]);
 const blanks=()=>viewer.root.querySelectorAll('.monitor-blank').length;
 const menu=()=>viewer.root.querySelector<HTMLElement>('.monitor-split-menu');
 const options=()=>[...menu()!.querySelectorAll<HTMLButtonElement>('button')];
 const value=(n:number)=>options().find(option=>option.value===String(n))!;
 const checked=()=>options().find(option=>option.getAttribute('aria-checked')==='true')?.value;
 const page=()=>viewer.root.querySelector('.monitor-page-number')?.textContent;
 const next=()=>viewer.root.querySelectorAll<HTMLButtonElement>('.monitor-page-button')[1];
 const right=(target:Element=viewer.root)=>target.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-1,clientY:innerHeight-1,button:2}));
 const key=(target:Element,key:string,shiftKey=false)=>target.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,shiftKey}));
 root.replaceChildren(viewer.root);show(5);await wait();await wait();
 const fifth=tiles()[4],video=fifth.querySelector('video');
 const tileBounds=tiles().map(t=>t.getBoundingClientRect());
 check('5 selected plus an excluded device default to the 6 preset with four vacant cells',viewer.root.dataset.columns==='3'&&viewer.root.dataset.rows==='3'&&blanks()===4&&members.join()===names.slice(0,5).join());
 check('every monitor cell is equal and fits a 16:9 stream',tileBounds.every(b=>Math.abs(b.width/b.height-16/9)<.003&&b.width===tileBounds[0].width));
 right(viewer.root.querySelector('.monitor-blank')!);
 const menuBounds=menu()!.getBoundingClientRect(),wallBounds=viewer.root.getBoundingClientRect();
 check('right-click on an empty cell offers only 1, 4 and 6 and clamps to the wall',options().map(o=>o.value).join()==='1,4,6'&&checked()==='6'&&menuBounds.right<=wallBounds.right&&menuBounds.bottom<=wallBounds.bottom);
 viewer.root.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,isPrimary:true,button:0}));
 check('an outside press dismisses the split menu',!menu());
 fifth.focus();key(fifth,'F10',true);key(document.activeElement!,'ArrowUp');key(document.activeElement!,'Enter');await wait();await wait();
 check('keyboard selects the 4 preset and keeps the first camera on its new page',!menu()&&members.join()===names.slice(0,4).join()&&page()==='1 / 2'&&viewer.root.dataset.columns==='2');
 next().click();await wait();await wait();
 check('only the last camera is connected on page two, with three vacant cells',members.join()===names[4]&&opened.length===3&&stops===2&&page()==='2 / 2'&&blanks()===3&&tiles()[0].querySelector('video')!==video);
 right(tiles()[0]);value(1).click();await wait();await wait();
 check('changing capacity around the same page anchor keeps the viewer',page()==='5 / 5'&&opened.length===3&&stops===2);
 raiseRecording=true;await new Promise(resolve=>setTimeout(resolve,160));right(tiles()[0]);
 check('recording blocks only split selections that change the connected cameras',value(6).disabled&&!value(4).disabled&&!value(1).disabled);
 key(document.activeElement!,'Escape');check('Escape dismisses the menu and restores tile focus',!menu()&&tiles()[0]===document.activeElement);
 raiseRecording=false;await new Promise(resolve=>setTimeout(resolve,160));
 viewer.close();await wait();show(5,account,2);await wait();await wait();
 check('reopening restores the saved preset and starts on the first page',page()==='1 / 5'&&members[0]===names[0]&&viewer.root.dataset.columns==='1');
 show(5,'other-split-account',2);await wait();await wait();right();check('switching accounts does not inherit the first account split',checked()==='6');
 viewer.updateAll(catalog(6));await wait();await wait();right(tiles()[0]);
 check('aggregate scope starts independently with six equal tiles and exactly three blanks',checked()==='6'&&blanks()===3&&tiles().length===6);
 value(4).click();viewer.updateAll(catalog(1));await wait();await wait();right();check('smaller rosters clamp without overwriting the saved preset',checked()==='1');
 viewer.updateAll(catalog(6));await wait();await wait();right();check('the previous choice returns when the roster grows',checked()==='4');
 value(6).click();await wait();await wait();const preserved=tiles(),before=opened.length;
 const reordered=catalog(6);reordered.homes[0].devices=[...reordered.homes[0].devices].reverse().map((d,i)=>({...d,online:i%2===0}));
 viewer.updateAll(reordered);await wait();await wait();check('directory reordering and status changes preserve tile order and connections',tiles().every((tile,i)=>tile===preserved[i])&&opened.length===before&&tileNames()[0]===cameras[0].name);
 viewer.updateAll(catalog(5));await wait();await wait();
 // The current page contains the sole tail camera under both presets; only its grid size changes.
 right();value(4).click();await wait();await wait();next().click();await wait();await wait();
 const tail=tiles()[0],tailVideo=tail.querySelector('video'),tailConnection=opened.length;
 right();value(1).click();await wait();await wait();
 check('grid-only resize reuses the same tile and exact video element',!!tailVideo&&tiles()[0]===tail&&tiles()[0].querySelector('video')===tailVideo&&opened.length===tailConnection);
 viewer.close();await wait();localStorage.removeItem(keys[1]);viewer.updateAll(catalog(21));await wait();await wait();
 right();check('21 cameras offer the complete preset list capped at 16',checked()==='16'&&options().map(o=>o.value).join()==='1,4,6,8,9,13,16'&&members.length===16);
 viewer.dismissPopup();next().click();await wait();await wait();check('overflow pagination connects only the five remaining cameras in order',page()==='2 / 2'&&members.join()===names.slice(16).join()&&blanks()===11);
 adoptFullscreen(true);right(tiles()[0]);check('native monitor fullscreen still supports the split menu',!!menu());viewer.dismissPopup();adoptFullscreen(false);
 viewer.close();await wait();viewer.updateAll(catalog(13));await wait();await wait();
 check('13 cameras default to a 4-by-4 grid with three vacant cells',viewer.root.dataset.columns==='4'&&blanks()===3&&members.length===13);
 viewer.close();await wait();fakeFrames=true;show(5);await wait();await wait();
 const frame=()=>tiles()[0].querySelector('.device-stage')!.dispatchEvent(new CustomEvent('camera-frame',{detail:{lensId:0,count:1}}));
 frame();tiles()[0].querySelector<HTMLButtonElement>('.monitor-quality-button')!.click();
 const hd=tiles()[0].querySelector<HTMLButtonElement>('.monitor-quality-menu [data-quality=hd]')!;
 check('HD is selectable when the tile receives a decoded frame',hd&&!hd.disabled);
 hd.click();await wait();
 next().click();await wait();await wait();frame();
 viewer.root.querySelector<HTMLButtonElement>('.monitor-page-button')!.click();await wait();await wait();frame();await wait();
 check('changing page restores the camera quality when that camera returns',JSON.stringify(qualityWrites)===JSON.stringify([{did:names[0],quality:'hd'},{did:names[0],quality:'hd'}]));
 viewer.close();await wait();for(const key of keys)localStorage.removeItem(key);
}
async function run(){
 render();check('scope defaults to current household',root.querySelector('[data-focus-key=monitor-all-homes]')?.getAttribute('aria-pressed')==='false');
 check('old household exclusions remain selected',root.querySelectorAll('.settings-monitor-device input:checked').length===1);
 check('monitor settings omit the retired low-power mode',!root.textContent?.includes('低配监控')&&!!root.querySelector('[data-focus-key=monitor-mode]'));
 const noop=async()=>{};
 const titlebar=mountDesktopFrame({minimize:noop,toggleMaximize:noop,close:noop,startDragging:noop,isMaximized:async()=>false,onResized:async()=>()=>{}});
 const actions=titlebar.querySelector<HTMLElement>('.desktop-monitor-actions')!;
 check('monitor title buttons are hidden on cold startup before loading the monitor wall',getComputedStyle(actions).display==='none'&&titlebar.querySelectorAll('.desktop-window-button').length===3);
 click('monitor-all-homes');await wait();await wait();
 check('selecting all homes loads metadata but never starts a stream',calls.every(c=>c.command==='catalog')&&!prefs.monitor!.enabled);
 check('all homes use continuous device rows without empty household headings',root.querySelectorAll('.settings-monitor-device').length===4&&!root.querySelector('.settings-monitor-home-title')&&!root.textContent!.includes('家庭 empty'));
 check('each subtitle includes its real home, room and online state',Array.from(root.querySelectorAll('.settings-monitor-device small')).map(n=>n.textContent).join('|')==='家庭 a 客厅 离线|家庭 a 客厅 离线|家庭 b 客厅 离线|家庭 b 客厅 离线');
 const separator=getComputedStyle(root.querySelectorAll('.settings-monitor-device')[1]),separatorWidth=parseFloat(separator.borderTopWidth);
 check('continuous rows retain the existing row separator',separator.borderTopStyle==='solid'&&separatorWidth>0&&separatorWidth<=1);
 check('existing device images are reused without mutating current-home metadata',root.querySelector<HTMLImageElement>('.settings-monitor-device img')?.src===existingArtwork&&catalog.data!.homes[0].devices.every(d=>!d.productIcon));
 check('another household uses its own camera model image without visiting its home',root.querySelector('[data-focus-key=monitor-device-b-three]')?.closest('label')?.querySelector<HTMLImageElement>('img')?.src===remoteArtwork);
 check('old home exclusions and duplicate memberships remain editable',root.querySelectorAll('.settings-monitor-device input').length===4&&root.querySelectorAll('.settings-monitor-device input:checked').length===3);
 check('duplicate DID counted once, first selected permission retained',selectedMonitorMembers(catalog.data!).length===2&&selectedMonitorMembers(catalog.data!)[0].device.sharedReadOnly);
 click('monitor-device-b-three');await wait();await wait();check('cross-household selection saves to its actual home',saved.homes[1].excludedDeviceIds.includes('three'));
 click('monitor-all-homes');check('single-home scope does not replace exclusions',root.querySelectorAll('.settings-monitor-device input:checked').length===1);
 click('monitor-all-homes');await wait();await wait();check('all-home scope restores saved remote exclusions',!root.querySelector<HTMLInputElement>('[data-focus-key=monitor-device-b-three]')!.checked);
 failSave=true;click('monitor-device-a-one');await wait();await wait();await wait();check('failed selection restores persisted state',root.querySelector<HTMLInputElement>('[data-focus-key=monitor-device-a-one]')!.checked&&catalog.error.includes('保存失败'));
 saved.incomplete=true;saved.homes[1].error={message:'模拟家庭读取失败'};await catalog.load(true);check('partial failure is marked while available homes remain usable',root.textContent!.includes('列表不完整')&&!root.querySelector<HTMLButtonElement>('[data-focus-key=monitor-mode]')!.disabled);
 saved.incomplete=false;delete saved.homes[1].error;await catalog.load(true);
 const {MonitorWall}=await import('../src/ui/monitor-wall');
 const viewer=new MonitorWall(()=>{},()=>{}, {create:async(c,dids)=>{calls.push({command:'create',args:{c,dids}});return'mock-viewer';},read:async()=>selectedMonitorMembers(catalog.data!).map(({device})=>({did:device.did,revision:1,state:'offline',events:[]})),retry:async()=>{},stop:async()=>{calls.push({command:'stop'});}});
 root.replaceChildren(viewer.root);viewer.updateAll(catalog.data!);await wait();await wait();
 check('one wall uses one aggregate group',calls.filter(c=>c.command==='create').length===1&&viewer.root.querySelectorAll('.monitor-tile').length===1);
 check('home and room labels survive poll updates',viewer.root.querySelector('.monitor-name')?.textContent?.includes('家庭 a · 客厅'));
 check('monitor title buttons appear only while the windowed wall is active',getComputedStyle(actions).display==='flex');
 adoptFullscreen(true);viewer.reveal();
 check('fullscreen hides the title bar even with monitor controls revealed',getComputedStyle(titlebar).display==='none'&&root.getBoundingClientRect().top===0);
 adoptFullscreen(false);viewer.reveal();
 check('leaving fullscreen restores the windowed monitor controls',getComputedStyle(titlebar).display==='flex'&&titlebar.querySelectorAll('.desktop-monitor-action')[1]?.textContent==='全屏');
 const videos=[...viewer.root.querySelectorAll('video')];for(let i=0;i<10;i++){document.body.classList.toggle('desktop-native-fullscreen');window.dispatchEvent(new Event('resize'));viewer.updateAll(catalog.data!);}
 check('fullscreen resize preserves videos and the aggregate group',videos.every((v,i)=>v===viewer.root.querySelectorAll('video')[i])&&calls.filter(c=>c.command==='create').length===1);
 viewer.close();await wait();check('exit stops the group once',calls.filter(c=>c.command==='stop').length===1);render();
 check('monitor title buttons stay hidden after returning to settings',getComputedStyle(actions).display==='none');
 const many=structuredClone(catalog.data!);
 many.homes[1].devices.push(device('four'),device('five'),device('six'));
 many.homes[1].excludedDeviceIds=[];
 let pageMembers:string[]=[],recording=false,stopCount=0;
 const pageOpens:string[][]=[];
 const current=new MonitorWall(()=>{},()=>{},{
  create:async(_scope,dids)=>{pageMembers=dids;pageOpens.push(dids);return 'paginated-'+pageOpens.length;},
  read:async()=>pageMembers.map((did,index)=>({did,revision:1,state:recording&&index===0?'connecting':'offline',events:recording&&index===0?[{state:'recording'}]:[]})),
  retry:async()=>{},stop:async()=>{stopCount++;},
 });
 const presetKey=monitorPresetKey(many.scope,null)!;
 localStorage.setItem(presetKey,'4');
 root.replaceChildren(current.root);current.updateAll(many);await wait();await wait();
 const pageButton=(direction:number)=>current.root.querySelectorAll<HTMLButtonElement>('.monitor-page-button')[direction];
 check('opening a preset does not connect cameras on other pages',pageOpens.length===1&&pageOpens[0].join(',')==='one,three,four,five'&&current.root.querySelectorAll('.monitor-tile').length===4);
 adoptFullscreen(true);
 const single=current.root.querySelector<HTMLElement>('.monitor-tile')!,singleVideo=single.querySelector('video')!;
 const fullscreenButton=single.querySelector<HTMLButtonElement>('[aria-label="画面全屏"]')!;
 fullscreenButton.click();
 const bounds=single.getBoundingClientRect(),wall=current.root.getBoundingClientRect();
 check('single camera fills the fullscreen wall without changing native or DOM fullscreen',nativeFullscreen()&&document.fullscreenElement===null&&single.hasAttribute('data-wall-fullscreen')&&bounds.width===wall.width&&bounds.height===wall.height);
 fullscreenButton.click();
 check('leaving one camera with the button returns to the same fullscreen wall',nativeFullscreen()&&!single.hasAttribute('data-wall-fullscreen')&&single.querySelector('video')===singleVideo&&pageOpens.length===1);
 fullscreenButton.click();current.handleEscape();
 check('first Escape leaves single camera fullscreen without leaving wall fullscreen',nativeFullscreen()&&!single.hasAttribute('data-wall-fullscreen')&&getComputedStyle(titlebar).display==='none'&&pageOpens.length===1);
 fullscreenButton.click();adoptFullscreen(false);
 check('an external fullscreen exit clears the single-camera view and restores the grid',!single.hasAttribute('data-wall-fullscreen')&&pageButton(1).closest('nav')?.hidden===false);
 recording=true;await new Promise(resolve=>setTimeout(resolve,180));pageButton(1).click();
 check('page changes keep active recording sessions',pageButton(1).disabled&&pageOpens.length===1);
 recording=false;await new Promise(resolve=>setTimeout(resolve,180));pageButton(1).click();await wait();await wait();
 check('the last page connects only the remaining camera and stops the old group',stopCount===1&&pageOpens[1].join(',')==='six'&&pageButton(1).disabled&&selectedMonitorMembers(many).length===5);
 current.close();await wait();localStorage.removeItem(presetKey);await checkPresets(MonitorWall);await checkAudio(MonitorWall);render();
 for(const h of catalog.data!.homes)h.excludedDeviceIds=h.devices.map(d=>d.did);render();check('all unselected disables monitor',root.querySelector<HTMLButtonElement>('[data-focus-key=monitor-mode]')!.disabled);
 view.category='application';render();click('app-start-home');const all=[...document.querySelectorAll<HTMLElement>('[role=option]')].find(n=>n.textContent==='全屋');check('startup includes all-household option',!!all);all!.click();await wait();await wait();check('startup target is explicit, without a virtual household ID',JSON.stringify(app.data!.settings.startupHome)===JSON.stringify({scope:'mock-account',allHomes:true}));
 document.documentElement.dataset.theme='dark';view.category='monitor';render();check('dark theme keeps flat all-home settings',root.querySelectorAll('.settings-monitor-device').length===4&&!root.querySelector('.settings-monitor-home-title'));
 catalog.setAccount('other-account');render();check('account change removes old metadata',!catalog.data&&root.querySelector<HTMLButtonElement>('[data-focus-key=monitor-mode]')!.disabled);
 return{complete:true,mockOnly:true,physicalDeviceWrites:0,checks};
}
(window as any).runMonitorChecks=async()=>{try{return await run();}catch(error){return{complete:false,mockOnly:true,physicalDeviceWrites:0,checks,error:String(error)};}};
