import '../src/style.css';import '../src/theme.css';import '../src/ui/app-font.css';
import {ApplicationSettingsController} from '../src/ui/application-settings';
import {settingsPage,createSettingsViewState} from '../src/ui/settings-page';
const calls:{command:string;args:unknown}[]=[];let auth='authorizationRequired',poll='pending',error=false,delay=0;
// Local-only deterministic states for browser tools that interact through visible UI.
const mockCase=new URLSearchParams(location.search).get('mockCase');
if(mockCase==='authorized')auth='authorized';
if(mockCase==='connecting')auth='reconnecting';
if(mockCase==='connectionFailed')auth='connectionFailed';
if(mockCase==='mismatch')error=true;
const status=()=>({state:auth,expiresAt:auth==='authorized'?Math.floor(Date.now()/1000)+3600:null,authorizationGeneration:1,regionSupported:true,scopeGuarantee:'householdDelegationUnverified',simpleAvailable:auth==='authorized',complexAvailable:auth==='authorized',unavailableReason:auth==='authorized'?'':'assistantAuthorizationRequired',clientIdentity:'privateCompatibility',skillVersion:'mock-v1',ssoAvailable:['authorized','reconnecting','connectionFailed'].includes(auth),reverifyRequired:auth==='authorizationRequired',autoReconnect:auth!=='disabled'});
const png='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/><path d="M20 20h55v55H20zM125 20h55v55h-55zM20 125h55v55H20zM110 110h25v25h-25zM150 150h30v30h-30z" fill="black"/><text x="100" y="100" font-size="12" text-anchor="middle">MOCK ONLY</text></svg>');
const invoke=async(command:string,args:any)=>{calls.push({command,args});switch(command){case'assistant_status':if(args?.refresh){auth='reconnecting';setTimeout(()=>{auth='authorized';},500);}return status();case'start_assistant_authorization':await new Promise(r=>setTimeout(r,delay));return{attemptId:'mock-qr',qrDataUrl:png,expiresAt:Math.floor(Date.now()/1000)+180};case'poll_assistant_authorization':if(error)throw{kind:'assistantAccountMismatch',message:'请使用与当前米家登录相同的小米账号扫码。'};if(poll==='success')auth='authorized';return{status:poll,authorization:status()};case'cancel_assistant_authorization':return;case'revoke_assistant_authorization':auth='disabled';return;case'change_application_settings':controller.data!.settings=structuredClone(args.value);return controller.data;case'application_settings':return controller.data;default:throw Error('Mock fixture denied unsupported command: '+command);}};
(window as any).isTauri=true;(window as any).__TAURI_INTERNALS__={invoke};
const root=document.querySelector<HTMLElement>('#app')!,view=createSettingsViewState('mcp');
const controller=new ApplicationSettingsController(()=>render());
const homes=[{id:'mock-home',name:'模拟家庭',rooms:[]},{id:'mock-dorm',name:'宿舍',rooms:[{id:'room-1',name:'宿舍'}]}];
controller.data={settings:{version:1,startupMonitor:false,startupHome:null,closeToTray:true,keepAwake:false,mcp:{enabled:true,localPort:8765,excludedHomes:[]}},autostart:false,scope:'mock-account',mcpStatus:{state:'running'},update:{revision:1,state:'idle',currentVersion:'mock',latestVersion:null,notes:null,checkedAt:null,downloadedBytes:0,totalBytes:null,message:'',packageKind:'portable',supported:false,canInstall:false,canDownload:false}};
function render(){root.replaceChildren(settingsPage({homeAvailable:true,homeName:'模拟家庭',devices:[],loading:false,pending:false,view,changed:render,back(){},retry(){},change(){},artwork(){return document.createElement('span');},application:{card:(category,panel)=>controller.card(category,panel,homes,'mock-home')}}));}
(window as any).assistantFixture={calls,success:()=>{poll='success';},mismatch:()=>{error=true;},setDelay:(n:number)=>{delay=n;},setAccount:(scope:string|null)=>{controller.data!.scope=scope;render();},render};
render();

const fixtureBar=document.createElement('div');fixtureBar.style.cssText='position:fixed;bottom:4px;left:4px;z-index:99999;background:#fff;padding:6px;display:flex;gap:8px';
for(const [label,action] of [
 ['模拟新增家庭',()=>{if(!homes.some(h=>h.id==='mock-new'))homes.push({id:'mock-new',name:'新增家庭',rooms:[]});render();}],
 ['模拟切换账号',()=>{controller.data!.scope='mock-other';render();}],
 ['模拟回原账号',()=>{controller.data!.scope='mock-account';render();}],
 ['模拟连接完成',()=>{auth='authorized';render();}],
] as const){const button=document.createElement('button');button.textContent=label;button.onclick=action;fixtureBar.append(button);}
document.body.append(fixtureBar);
