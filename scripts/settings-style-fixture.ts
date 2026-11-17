// Offline UI fixture: every IPC is mocked; device and assistant execution are denied.
import '../src/style.css';import '../src/theme.css';import '../src/ui/app-font.css';
import {ApplicationSettingsController} from '../src/ui/application-settings';
import {settingsPage,createSettingsViewState,captureSettingsView,restoreSettingsView,type SettingsCategory} from '../src/ui/settings-page';
import type {DesktopGridSettings} from '../src/desktop-widgets';
const params=new URLSearchParams(location.search),root=document.querySelector<HTMLElement>('#app')!;
const view=createSettingsViewState((params.get('category')??'mcp')as SettingsCategory),calls:{command:string;args:any}[]=[];
let auth=params.get('auth')??'authorized',failSave=false,qrCount=0,clipboard='',delay=30;
const homes=[{id:'mock-one',name:'我的家',rooms:[{id:'r1',name:'客厅'},{id:'r2',name:'卧室'}]},{id:'mock-two',name:'父母家',rooms:[{id:'r3',name:'客厅'}]},{id:'mock-three',name:'办公室',rooms:[]}];
const displays:DesktopGridSettings={supported:true,displays:[{id:'one',name:'显示器 1 · 主屏幕',primary:true,width:2560,height:1440,scale:1.25,enabled:true,padding:{top:16,right:24,bottom:80,left:24},preset:'6x4',available:['6x4','8x6']},{id:'two',name:'显示器 2 · 竖屏',primary:false,width:1080,height:1920,scale:1,enabled:false,padding:{top:0,right:0,bottom:0,left:0},preset:'6x4',available:['6x4']}]};
const status=()=>({state:auth,expiresAt:auth==='authorized'?1893456000:null,authorizationGeneration:1,regionSupported:auth!=='assistantRegionUnsupported',scopeGuarantee:'householdDelegationUnverified',simpleAvailable:auth==='authorized',complexAvailable:auth==='authorized',unavailableReason:'',clientIdentity:'mock',skillVersion:'mock-v1',ssoAvailable:!['authorizationRequired','disabled'].includes(auth),reverifyRequired:auth==='authorizationRequired',autoReconnect:auth!=='disabled'});
const qr='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/><text x="20" y="100">MOCK QR ONLY</text></svg>');
const invoke=async(command:string,args:any={})=>{
 calls.push({command,args:structuredClone(args)});await new Promise(resolve=>setTimeout(resolve,delay));
 switch(command){
  case'application_settings':return structuredClone(storedData);
  case'change_application_settings':if(failSave){failSave=false;throw{message:'模拟保存失败'};}storedData.settings=structuredClone(args.value);return structuredClone(storedData);
  case'assistant_status':if(args.refresh)auth='authorized';return status();
  case'start_assistant_authorization':qrCount++;return{attemptId:'mock-only',qrDataUrl:qr,expiresAt:Math.floor(Date.now()/1000)+180};
  case'poll_assistant_authorization':return{status:'pending',authorization:status()};
  case'cancel_assistant_authorization':return;
  case'revoke_assistant_authorization':auth='disabled';return;
  case'mcp_connection_config':return JSON.stringify({mcpServers:{mijia:{url:`http://127.0.0.1:${storedData.settings.mcp.localPort}/mcp`,headers:{Authorization:'Bearer mock-only'}}}});
  case'mcp_rotate_key':return structuredClone(storedData);
  case'desktop_widget_grids':{
   if(args.monitor){if(failSave){failSave=false;throw{message:'留白过大，已保留原设置'};}const screen=displays.displays.find(s=>s.id===args.monitor);if(screen)for(const key of ['enabled','padding','preset']as const)if(args[key]!==undefined)(screen as any)[key]=structuredClone(args[key]);}
   return structuredClone(displays);
  }
  default:throw Error('Mock denied unsupported command: '+command);
 }
};
(window as any).isTauri=true;(window as any).__TAURI_INTERNALS__={invoke};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{clipboard=text;}}});
const controller=new ApplicationSettingsController(()=>render());
controller.data={settings:{version:1,startupMonitor:false,startupHome:null,closeToTray:true,keepAwake:false,mcp:{enabled:true,localPort:8765,excludedHomes:[{scope:'mock-account',homeId:'mock-three'}]}},autostart:false,scope:params.has('loggedOut')?null:'mock-account',mcpStatus:{state:'running'},update:{revision:1,state:'idle',currentVersion:'mock',latestVersion:null,notes:null,checkedAt:null,downloadedBytes:0,totalBytes:null,message:'',packageKind:'portable',supported:false,canInstall:false,canDownload:false}};
const storedData=structuredClone(controller.data);
function render(){captureSettingsView(root,view);root.replaceChildren(settingsPage({homeAvailable:!!controller.data?.scope,homeName:'我的家',devices:[],loading:false,pending:false,view,changed:render,back(){},retry(){},change(){},artwork(){return document.createElement('span');},application:{card:(category,panel)=>controller.card(category,panel,homes,'mock-one')}}));restoreSettingsView(root,view);}
(window as any).settingsFixture={calls,controller,view,displays,homes,render,get qrCount(){return qrCount;},get clipboard(){return clipboard;},failNextSave(){failSave=true;},setDelay(value:number){delay=value;},select(category:SettingsCategory){captureSettingsView(root,view);view.category=category;view.focusKey=`settings-nav-${category}`;render();},async setAuth(value:string){auth=value;await(controller as any).assistant.load();},loggedOut(value=true){storedData.scope=controller.data!.scope=value?null:'mock-account';render();}};
if(params.get('theme')==='dark')document.documentElement.dataset.theme='dark';
render();
