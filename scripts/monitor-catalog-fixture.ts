// Standalone offline fixture. All transports are mocks; no device command is sent.
import '../src/style.css';import '../src/theme.css';import '../src/ui/app-font.css';
import {MonitorCatalogController,selectedMonitorMembers,type MonitorCatalog} from '../src/monitor-catalog';
import {MonitorWall} from '../src/ui/monitor-wall';
import {settingsPage,createSettingsViewState} from '../src/ui/settings-page';
import {ApplicationSettingsController} from '../src/ui/application-settings';
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
async function run(){
 render();check('scope defaults to current household',root.querySelector('[data-focus-key=monitor-all-homes]')?.getAttribute('aria-pressed')==='false');
 check('old household exclusions remain selected',root.querySelectorAll('.settings-monitor-device input:checked').length===1);
 click('monitor-all-homes');await wait();await wait();
 check('selecting all homes loads metadata but never starts a stream',calls.every(c=>c.command==='catalog')&&!prefs.monitor!.enabled);
 check('all homes use continuous device rows without empty household headings',root.querySelectorAll('.settings-monitor-device').length===4&&!root.querySelector('.settings-monitor-home-title')&&!root.textContent!.includes('家庭 empty'));
 check('each subtitle includes its real home, room and online state',Array.from(root.querySelectorAll('.settings-monitor-device small')).map(n=>n.textContent).join('|')==='家庭 a 客厅 离线|家庭 a 客厅 离线|家庭 b 客厅 离线|家庭 b 客厅 离线');
 check('continuous rows retain the existing row separator',getComputedStyle(root.querySelectorAll('.settings-monitor-device')[1]).borderTopWidth==='1px');
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
 const viewer=new MonitorWall(()=>{},()=>{}, {create:async(c,dids)=>{calls.push({command:'create',args:{c,dids}});return'mock-viewer';},read:async()=>selectedMonitorMembers(catalog.data!).map(({device})=>({did:device.did,revision:1,state:'offline',events:[]})),retry:async()=>{},stop:async()=>{calls.push({command:'stop'});}});
 root.replaceChildren(viewer.root);viewer.updateAll(catalog.data!);await wait();await wait();
 check('one wall uses one aggregate group',calls.filter(c=>c.command==='create').length===1&&viewer.root.querySelectorAll('.monitor-tile').length===1);
 check('home and room labels survive poll updates',viewer.root.querySelector('.monitor-name')?.textContent?.includes('家庭 a · 客厅'));
 const videos=[...viewer.root.querySelectorAll('video')];for(let i=0;i<10;i++){document.body.classList.toggle('desktop-native-fullscreen');window.dispatchEvent(new Event('resize'));viewer.updateAll(catalog.data!);}
 check('fullscreen resize preserves videos and the aggregate group',videos.every((v,i)=>v===viewer.root.querySelectorAll('video')[i])&&calls.filter(c=>c.command==='create').length===1);
 viewer.close();await wait();check('exit stops the group once',calls.filter(c=>c.command==='stop').length===1);render();
 for(const h of catalog.data!.homes)h.excludedDeviceIds=h.devices.map(d=>d.did);render();check('all unselected disables monitor',root.querySelector<HTMLButtonElement>('[data-focus-key=monitor-mode]')!.disabled);
 view.category='application';render();click('app-start-home');const all=[...document.querySelectorAll<HTMLElement>('[role=option]')].find(n=>n.textContent==='全屋');check('startup includes all-household option',!!all);all!.click();await wait();await wait();check('startup target is explicit, without a virtual household ID',JSON.stringify(app.data!.settings.startupHome)===JSON.stringify({scope:'mock-account',allHomes:true}));
 document.documentElement.dataset.theme='dark';view.category='monitor';render();check('dark theme keeps flat all-home settings',root.querySelectorAll('.settings-monitor-device').length===4&&!root.querySelector('.settings-monitor-home-title'));
 catalog.setAccount('other-account');render();check('account change removes old metadata',!catalog.data&&root.querySelector<HTMLButtonElement>('[data-focus-key=monitor-mode]')!.disabled);
 return{complete:true,mockOnly:true,physicalDeviceWrites:0,checks};
}
(window as any).runMonitorChecks=async()=>{try{return await run();}catch(error){return{complete:false,mockOnly:true,physicalDeviceWrites:0,checks,error:String(error)};}};
