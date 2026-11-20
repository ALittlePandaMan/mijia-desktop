import {dropdownSelect} from './dropdown';
import {isTauri} from '@tauri-apps/api/core';
import {api} from '../api';
import type {ApplicationSettingsView,AppUpdateStatus} from '../application-settings';
import {mcpHomeSelected,selectMcpHome} from '../application-settings';
import type {Home} from '../types';
import type {SettingsPanelState} from './settings-page';
import {button,element} from './dom';
import {icon} from '../icons';
import {settingsContentIcon,settingsCopy,settingsGroup,settingsSwitch} from './settings-content';
import appIconUrl from '../assets/brand/app-icon-blue.svg?url';
import './settings-mcp.css';
import {showToast} from './toast';
import {updateCheckMessage} from '../update-feedback';
import {AssistantAuthorizationController} from '../assistant-authorization';
import {assistantAuthorization} from './assistant-authorization';

export class ApplicationSettingsController{
 data?:ApplicationSettingsView;private queue=Promise.resolve();private version=0;private pending=0;private error='';
  constructor(private changed:()=>void){}
 private readonly assistant=new AssistantAuthorizationController(api,()=>this.changed());
 private updateBusy=false;private updateError='';private aboutNotesOpen=false;

 private async checkUpdate():Promise<void>{
  if(this.updateBusy)return;this.updateBusy=true;this.updateError='';this.changed();
  try{const status=await api.checkAppUpdate();if(status.revision>=(this.data?.update.revision??0)){
   this.acceptUpdate(status,false);const message=updateCheckMessage(status);if(message)showToast(document.body,message,status.state!=='error');
  }}catch{showToast(document.body,'检查更新失败，请重试。',false);}
  finally{this.updateBusy=false;this.changed();}
 }

 acceptUpdate(status:AppUpdateStatus,notify=true):void{if(this.data&&status.revision>=this.data.update.revision){this.data.update=status;if(status.state!=='error')this.updateError='';if(notify)this.changed();}}
 private async updateAction(operation:()=>Promise<AppUpdateStatus|void>):Promise<void>{
  if(this.updateBusy)return;this.updateBusy=true;this.updateError='';this.changed();
  try{const status=await operation();if(status)this.acceptUpdate(status,false);}
  catch(error){this.updateError=typeof error==='object'&&error&&'message' in error?String(error.message):'更新操作未完成，请重试。';}
  finally{this.updateBusy=false;this.changed();}
 }
 private aboutCard():HTMLElement{
  const status=this.data!.update,card=element('section','settings-card settings-about-card');
  const busy=this.updateBusy||['checking','downloading','ready','installing'].includes(status.state);
  const logo=element('img','settings-about-logo');logo.src=appIconUrl;logo.alt='';logo.draggable=false;
  const identity=element('div','settings-about-identity',element('h2','settings-about-name','米家Desktop'),element('p','settings-about-version',`版本 ${status.currentVersion}`));
  const check=button(status.state==='checking'?'检查中…':'检查更新','settings-action settings-about-button',()=>{void this.checkUpdate();});
  check.prepend(icon('refresh'));check.dataset.focusKey='app-update-check';check.disabled=busy||!status.supported;
  card.append(element('header','settings-about-header',element('div','settings-about-brand',logo,identity),check));
  const result=element('div','settings-update-result');result.dataset.state=this.updateError?'error':status.state;result.setAttribute('role','status');result.setAttribute('aria-live','polite');
  if(this.updateError||['downloading','ready','installing'].includes(status.state))result.append(element('span','settings-update-message',this.updateError||status.message));
  result.hidden=!result.childElementCount&&status.state!=='downloading';
  if(status.state==='downloading'){
   const progress=element('progress','settings-update-progress');progress.setAttribute('aria-label','更新下载进度');
   if(status.totalBytes){progress.max=status.totalBytes;progress.value=Math.min(status.downloadedBytes,status.totalBytes);}
   result.append(progress,element('small','settings-update-checked',`${(status.downloadedBytes/1048576).toFixed(1)} MB${status.totalBytes?` / ${(status.totalBytes/1048576).toFixed(1)} MB`:''}`));
  }
  const overview=element('div','settings-about-update',result),actions=element('div','settings-about-actions');
  if(status.canInstall){
   const install=button(status.state==='error'?'重试更新':'更新中…','settings-action settings-about-button settings-update-primary',()=>{void this.updateAction(()=>api.startAppUpdate());});install.dataset.focusKey='app-update-install';install.disabled=busy;actions.append(install);
  }else if(status.canDownload){
   const download=button(status.state==='downloading'?'更新中…':'立即更新','settings-action settings-about-button settings-update-primary',()=>{void this.updateAction(()=>api.startAppUpdate());});download.dataset.focusKey='app-update-download';download.disabled=busy;actions.append(download);
  }
  if(actions.childElementCount)overview.append(actions);overview.hidden=!result.childElementCount&&!actions.childElementCount;card.append(overview);
  if(status.notes&&status.latestVersion&&status.latestVersion!==status.currentVersion){const notes=element('details','settings-update-notes');notes.open=this.aboutNotesOpen;notes.addEventListener('toggle',()=>{this.aboutNotesOpen=notes.open;});notes.append(element('summary','',`版本 ${status.latestVersion} 更新内容`),element('p','',status.notes.slice(0,16000)));card.append(notes);}
  const footer=element('footer','settings-about-description');
  for(const [label,page,glyph]of [['GitHub','github','link'],['问题反馈','issues','info']]as const){const action=button(label,'settings-action settings-about-link',()=>{void this.updateAction(()=>api.openAppProject(page));});action.prepend(icon(glyph));footer.append(action);}
  const history=button('更新日志','settings-action settings-about-link',()=>{void this.updateAction(()=>api.openAppReleaseNotes());});history.prepend(icon('records'));history.dataset.focusKey='app-update-history';footer.append(history);card.append(footer);
  return card;
 }
 async load(force=false):Promise<void>{if(!isTauri())return;const version=this.version;try{const data=await api.applicationSettings();if(version!==this.version)return;if(this.data&&this.data.update.revision>data.update.revision)data.update=this.data.update;if(data.scope!==this.data?.scope){this.assistant.setAccount(data.scope);++this.version;}else if(this.data&&this.pending&&!force){data.settings=this.data.settings;data.autostart=this.data.autostart;}this.data=data;this.error='';}catch{this.error='设置不可用';}this.changed();}
 private save(change:(data:ApplicationSettingsView)=>void,autostart?:boolean):void{
  if(!this.data)return;const next=structuredClone(this.data);change(next);this.data=next;const version=++this.version;++this.pending;this.changed();
  this.queue=this.queue.catch(()=>{}).then(async()=>{try{const result=await api.changeApplicationSettings(next.settings,autostart);if(this.version===version){if(this.data&&this.data.update.revision>result.update.revision)result.update=this.data.update;this.data=result;this.error='';}}catch{if(this.version===version){await this.load(true);this.error='设置未保存';}}finally{--this.pending;}this.changed();});
 }
 private row(label:string,control:HTMLElement,description=''):HTMLElement{return element('div','settings-row',settingsCopy(label,description),control);}
 private toggle(key:string,label:string,value:boolean,change:(value:boolean)=>void,description=''):HTMLElement{
  const control=settingsSwitch(label,value,change);control.dataset.focusKey=key;return this.row(label,control,description);
 }
 private choice(key:string,label:string,value:string,options:{value:string;label:string}[],change:(value:string)=>void,description=''):HTMLElement{
     const select=dropdownSelect({label,options,value,className:'settings-select',change});select.dataset.focusKey=key;return this.row(label,select,description);
 }
 private number(key:string,label:string,value:number,change:(value:number)=>void):HTMLElement{
  const input=element('input','settings-number');input.type='text';input.inputMode='numeric';input.pattern='[0-9]*';input.maxLength=5;input.defaultValue=String(value);input.value=String(value);input.dataset.focusKey=key;input.setAttribute('aria-label',label);input.addEventListener('change',()=>{const n=Number(input.value);if(/^\d{4,5}$/.test(input.value)&&Number.isInteger(n)&&n>=1024&&n<=65535)change(n);else input.value=String(value);});return this.row(label,input);
 }
 private async action(operation:()=>Promise<unknown>):Promise<void>{try{await operation();this.error='';}catch{this.error='操作未完成';}this.changed();}
 private async copy():Promise<void>{const config=await api.mcpConnectionConfig();await navigator.clipboard.writeText(config);}
 card(category:'application'|'mcp'|'about',_view:SettingsPanelState,homes:readonly Home[],currentHome:string,openDeveloperMode?:()=>void):HTMLElement{
  const card=element('div','settings-card');const data=this.data;
  const developerEntry=()=>this.toggle('developer-mode-entry','开发者模式',false,()=>openDeveloperMode?.());
  if(!data){card.append(this.row(category==='application'?'应用设置':category==='about'?'版本信息':'MCP',element('span','settings-list-count',this.error||'--')));if(category==='application'&&openDeveloperMode)card.append(developerEntry());return card;}
  if(category==='about')return this.aboutCard();
  const settings=data.settings;
  if(category==='application'){
  const application=element('div','settings-groups'),startup=element('div','settings-card'),background=element('div','settings-card');
  startup.append(this.toggle('app-autostart','开机自启',data.autostart,value=>this.save(d=>{d.autostart=value;},value),'登录 Windows 后自动启动米家 Desktop'),
   this.toggle('app-start-monitor','启动后进入全屏监控',settings.startupMonitor,value=>this.save(d=>{d.settings.startupMonitor=value;if(value&&!d.settings.startupHome&&d.scope){const home=homes.find(h=>h.id===currentHome)??homes[0];if(home)d.settings.startupHome={scope:d.scope,homeId:home.id};}}),'启动应用时，直接打开指定家庭的监控画面'));
  const home=this.choice('app-start-home','启动监控的家庭',settings.startupHome?.scope===data.scope?(settings.startupHome&&'allHomes' in settings.startupHome?'@all':settings.startupHome?.homeId??''):'',
   [{value:'',label:'选择家庭'},{value:'@all',label:'全屋'},...homes.map(h=>({value:h.id,label:h.name}))],value=>this.save(d=>{d.settings.startupHome=value&&d.scope?(value==='@all'?{scope:d.scope,allHomes:true}:{scope:d.scope,homeId:value}):null;}),'仅在启动后进入全屏监控时生效');
  home.querySelector<HTMLButtonElement>('.settings-select')!.disabled=!settings.startupMonitor;
  startup.append(home);
  background.append(this.toggle('app-close-tray','关闭后在后台运行',settings.closeToTray,value=>this.save(d=>{d.settings.closeToTray=value;}),'关闭窗口后保留托盘图标与后台服务'),
   this.toggle('app-awake','全屏监控时保持唤醒',settings.keepAwake,value=>this.save(d=>{d.settings.keepAwake=value;}),'防止电脑在监控过程中自动休眠'));
  application.append(settingsGroup('启动',startup),settingsGroup('后台与电源',background));
  if(openDeveloperMode)application.append(element('div','settings-card',developerEntry()));
   if(this.error)application.append(element('p','settings-caption',this.error));return application;
  }
  const mcp=element('div','settings-mcp-layout'),connection=element('section','settings-card settings-mcp-connection');
  connection.setAttribute('aria-label','MCP 连接设置');
  const selectedCount=homes.filter(h=>mcpHomeSelected(settings.mcp,data.scope,h.id)).length;
  const state=!settings.mcp.enabled?'stopped':!selectedCount?'waiting':data.mcpStatus.state;
  const status=element('span','settings-mcp-status',state==='running'?'运行中':state==='waiting'?'请勾选家庭':state==='error'?'未启动':'已关闭');status.dataset.state=state;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const service=this.toggle('mcp-enabled','MCP 服务',settings.mcp.enabled,value=>this.save(d=>{d.settings.mcp.enabled=value;}),'允许此电脑上的 MCP 客户端连接。');service.classList.add('settings-mcp-service');service.insertBefore(status,service.lastElementChild);connection.append(service);
  const portField=this.number('mcp-local-port','本机端口',settings.mcp.localPort,value=>this.save(d=>{d.settings.mcp.localPort=value;}));
  portField.classList.add('settings-mcp-field');
  const address=element('div','settings-mcp-endpoint'),url=element('code','settings-mcp-url',`http://127.0.0.1:${settings.mcp.localPort}/mcp`),actions=element('div','settings-mcp-connection-actions');
  const action=(key:string,label:string,run:()=>Promise<unknown>,primary=false)=>{const node=button(label,`settings-action settings-mcp-button${primary?' settings-mcp-button-primary':''}`,()=>{void this.action(run);});node.prepend(settingsContentIcon(primary?'copy':'reset'));node.dataset.focusKey=key;actions.append(node);};
  action('mcp-copy-local','复制本机配置',()=>this.copy(),true);
  action('mcp-key-reset','重置访问密钥',async()=>{this.data=await api.mcpRotateKey();});
  address.append(element('span','settings-mcp-address-label','连接地址'),element('div','settings-mcp-address-value',url));connection.append(element('div','settings-mcp-fields',address,portField),actions);
  if(data.mcpStatus.state==='error'&&data.mcpStatus.error)connection.append(element('p','settings-caption',data.mcpStatus.error.message));
  this.assistant.setAccount(data.scope);
  mcp.append(settingsGroup('本机服务',connection),settingsGroup('智能家居助手',assistantAuthorization(this.assistant,!!data.scope)));
  const families=element('section','settings-mcp-families');families.setAttribute('aria-label','控制的家庭');
  families.append(element('header','settings-mcp-family-heading',element('h2','settings-group-title','控制的家庭'),element('span','settings-list-count',`已选择 ${selectedCount} / ${homes.length}`)));
  const list=element('div','settings-card settings-mcp-family-list');
  for(const home of homes){
   const check=element('input');check.type='checkbox';check.checked=mcpHomeSelected(settings.mcp,data.scope,home.id);check.disabled=!data.scope;check.dataset.focusKey=`mcp-family-${home.id}`;check.setAttribute('aria-label',`控制 ${home.name}`);
   check.addEventListener('change',()=>this.save(d=>{if(d.scope)selectMcpHome(d.settings.mcp,d.scope,home.id,check.checked);}));
   const copy=element('span','settings-mcp-family-copy',element('strong','',home.name),element('small','',`${home.rooms.length} 个房间 · ID: ${home.id}`));
   list.append(element('label','settings-mcp-family',copy,check));
  }
  if(!homes.length)list.append(element('p','settings-assistant-caption',data.scope?'暂未读取到家庭，请刷新家庭列表。':'登录后可选择控制的家庭。'));
  families.append(list);mcp.append(families);
  if(this.error)mcp.append(element('p','settings-caption',this.error));return mcp;
 }
}
