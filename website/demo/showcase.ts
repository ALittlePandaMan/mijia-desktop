import './desktop/src/style.css';
import './desktop/src/theme.css';
import './desktop/src/ui/quiet-feedback.css';
import './desktop/src/ui/monitor-wall.css';
import './desktop/src/ui/camera-toolbar-motion.css';
import './desktop/src/camera-player.css';
import './showcase.css';
import {element,button} from './desktop/src/ui/dom';
import {officialIcon} from './desktop/src/icons';
import {deviceSurfaces} from './desktop/src/ui/device-surfaces';
import {dismissOnBackdrop} from './desktop/src/ui/dialog-dismiss';
import {renderControl} from './desktop/src/ui/controls';
import {curtainView} from './desktop/src/ui/curtain-view';
import * as views from './desktop/src/ui/device-presenters';
import {televisionPage} from './desktop/src/ui/television-page';
import {renderHistoryDetail,type HistoryDetailView} from './desktop/src/ui/history-detail';
import {disposeHistoryCharts} from './desktop/src/ui/history-chart';
import type {Device,Property,Json,HistorySelection} from './desktop/src/types';
import {DemoStore,devices,demoRooms,demoDevice,type DeviceId,type RoomId} from './store';
import {ImageFrameSource} from './camera-source';
import {DemoMonitor} from './monitor-demo';
import {DemoLaundry} from './laundry';
import {DemoCards} from './cards';

const instance=new URLSearchParams(location.search).get('instance')==='hero'?'hero':'showcase';
const root=document.querySelector<HTMLElement>('#showcase')!,store=new DemoStore({send:command=>window.parent.postMessage({type:'mijia-demo:command',instance,command},location.origin)});
const deviceLayout=element('div','showcase-layout'),left=element('section','showcase-left'),home=element('main','home-screen'),grid=element('div','device-grid');
const top=element('div','home-topbar',element('span','home-title','我的家',officialIcon('home:dropdown'))),rooms=element('nav','room-tabs');rooms.setAttribute('aria-label','演示房间');
let currentRoom:RoomId|'all'='all';
const roomScroll=new Map<string,number>();
for(const room of [{id:'all',name:'全屋'},...demoRooms] as const){const tab=button(room.name,'room-tab'+(room.id==='all'?' active':''),()=>selectRoom(room.id));tab.dataset.roomId=room.id;tab.setAttribute('aria-pressed',String(room.id==='all'));rooms.append(tab);}
home.append(top,rooms,element('div','home-content',grid));left.append(home);
deviceLayout.append(left);
const source=new ImageFrameSource(()=>monitor.sourceChanged());
const monitor=new DemoMonitor(source);
root.append(deviceLayout,monitor.root);
let selected:DeviceId|undefined,detail:HTMLElement|undefined,epoch=0,historySelection:HistorySelection|undefined,historyPicker:HistoryDetailView['picker'];
const laundry=new DemoLaundry(store,()=>{if(selected)renderDetail(true);},closeDetail);
type DemoMode='devices'|'monitor';
let mode:DemoMode='devices',visible=true,parentFullscreen=false,parentFullscreenExitedAt=-Infinity;
let parentTheme:'light'|'dark'|undefined;
let sizeFrame=0,lastReportedHeight=0,lastReportedMode:DemoMode|undefined;
function reportSize(){
 if(sizeFrame)return;sizeFrame=requestAnimationFrame(()=>{sizeFrame=0;if(document.fullscreenElement||parentFullscreen)return;const height=Math.ceil(root.getBoundingClientRect().height);if(height<120||(height===lastReportedHeight&&mode===lastReportedMode))return;lastReportedHeight=height;lastReportedMode=mode;window.parent.postMessage({type:'mijia-demo:resize',instance,mode,height},location.origin);});
}
const sizeObserver=new ResizeObserver(reportSize);sizeObserver.observe(root);document.fonts.ready.then(reportSize);document.addEventListener('fullscreenchange',reportSize);
function artwork(device:Device,className='',_switchCount=3,product=false):HTMLElement {const art=element('span',`device-artwork ${className}`),image=element('img','device-product-image'),selected=demoDevice(device.did),kind=selected?.kind??'switch';art.dataset.artworkSource='selected-product-image';art.dataset.productKind=kind;image.src='../devices/'+(selected?.artworkId??kind)+'.png';image.alt='';image.loading=product||className==='switch-key-artwork'?'eager':'lazy';image.referrerPolicy='no-referrer';image.decoding='async';art.append(image);return art;}
const cardGrid=new DemoCards(grid,store,artwork,openDetail,reportSize);
function selectRoom(room:RoomId|'all'){
 if(room===currentRoom)return;roomScroll.set(currentRoom,home.scrollTop);currentRoom=room;
 for(const tab of rooms.querySelectorAll<HTMLButtonElement>('button')){const active=tab.dataset.roomId===room;tab.classList.toggle('active',active);tab.setAttribute('aria-pressed',String(active));}
 cardGrid.selectRoom(room);home.scrollTop=roomScroll.get(room)??0;reportSize();
}

function createHost():views.DevicePresenterHost {
 const device=devices.find(d=>d.did===selected)!,id=selected!;
 const write=(p:Property,value:Json)=>store.write(id,p,value);
 const host:views.DevicePresenterHost={
  panel:store.panel(id),get context(){return selected?{homeId:'demo-home',generation:1,did:selected}:undefined;},get panelEpoch(){return epoch;},controlBusy:false,panelIsCached:false,linkedPanels:new Map(),sensorHistory:store.history(id),historyLoading:false,energyLoading:false,
  control:(node,d)=>renderControl(node,{device:d,busy:false,write,error:()=>{},interactionEnded:()=>{}}),deviceArtwork:artwork,
  nativeSlider:(p,label,unit,d,disabled,theme)=>host.control({name:'Slider',props:{property:p,label,unit,theme,disabledReason:disabled?'设备开启后可调节。':undefined}},d),
  nativeUnavailableFeature:()=>{const e=element('span');e.hidden=true;return e;},
  nativeTemperatureControl:(...args)=>views.nativeTemperatureControl.call(host,...args),nativeClimateChoices:(...args)=>views.nativeClimateChoices.call(host,...args),nativeP69Swing:(...args)=>views.nativeP69Swing.call(host,...args),
  renderYeelightStrip:()=>views.renderLightPage.call(host,device,false),render:()=>renderDetail(true),setBoundProperty:async(p,value)=>write(p,value),setProperty:async(p,value)=>write(p,value),
  selectHistoryDetail:selection=>{historySelection=selection;renderDetail(true);},loadEnergy:()=>{},
 };return host;
}
function openDetail(id:DeviceId){if(mode!=='devices')return;cardGrid.closeMenu();selected=id;epoch++;historySelection=undefined;if(['airer','washer'].includes(demoDevice(id)!.kind))laundry.open(id);else laundry.dispose();home.inert=true;renderDetail(false);}
function closeDetail(restoreFocus=true){if(!selected)return;const id=selected;selected=undefined;laundry.dispose();epoch++;detail?.remove();detail=undefined;disposeHistoryCharts();home.inert=false;if(restoreFocus&&document.hasFocus())cardGrid.focus(id);}
function renderCurtain(device:Device,host:views.DevicePresenterHost){
 const id=device.did as DeviceId,panel=store.panel(id),properties=panel.services.flatMap(s=>s.properties),target=properties.find(p=>p.name==='target-position')!,position=properties.find(p=>p.name==='current-position')!;
 const {view,backdrop}=curtainView({device,panel,busy:false,cached:false,write:(property,value)=>store.write(id,property,value)});
 backdrop.style.setProperty('--openness',`${store.stateFor(id).curtainPosition}%`);
 view.append(host.control({name:'Slider',props:{property:target,valueProperty:position,label:'窗帘开合',unit:'%',theme:'curtain'}},device));return view;
}
function syncCurtainDetail(){
 if(!selected||demoDevice(selected)!.kind!=='curtain')return;const s=store.stateFor(selected),position=Math.round(s.curtainPosition),backdrop=detail?.querySelector<HTMLElement>('.curtain-drawing'),slider=detail?.querySelector<HTMLElement>('.slider-curtain');
 backdrop?.style.setProperty('--openness',`${s.curtainPosition}%`);
 if(!slider)return;slider.dataset.displayPosition=s.curtainPosition.toFixed(2);if(slider.dataset.interacting)return;
 const output=slider.querySelector('.native-slider-value'),input=slider.querySelector<HTMLInputElement>('input');if(output)output.textContent=`${position}%`;
 slider.style.setProperty('--curtain-progress',`${s.curtainPosition}%`);if(input){input.value=String(s.curtainMoving?s.curtainTarget:position);input.setAttribute('aria-valuetext',`目标 ${s.curtainTarget}%，当前 ${position}%`);}
}
function renderDetail(preserve:boolean){
 if(!selected)return;const id=selected,device=demoDevice(id)!,kind=device.kind,host=createHost(),focus=document.activeElement as HTMLElement|null,ownsFocus=!!detail?.contains(focus)&&document.hasFocus(),focusLabel=preserve&&ownsFocus?focus?.getAttribute('aria-label'):null,scroll=preserve?detail?.querySelector('.device-page-scroll')?.scrollTop??0:0;
 const focusable='button,input,select,[tabindex="0"]',focusIndex=preserve&&ownsFocus?Array.from(detail!.querySelectorAll(focusable)).indexOf(focus!):-1;
 let stage:HTMLElement;disposeHistoryCharts();
 if(kind==='airer'||kind==='washer')stage=laundry.render(device,()=>artwork(device,'',1,true));
 else if(kind==='tv')stage=televisionPage({device,panel:store.panel(id),busy:false,cached:false,back:closeDetail,press:role=>store.tvPress(id,role)});
 else if(kind==='thermo'&&historySelection)stage=renderHistoryDetail({selection:historySelection,data:store.history(id,historySelection),loading:false,picker:historyPicker,showPicker:picker=>{historyPicker=picker;renderDetail(true);},select:selection=>{historySelection=selection;renderDetail(true);},back:()=>{historySelection=undefined;renderDetail(false);},retry:()=>{}});
 else {
  const body=kind==='switch'?views.renderSwitchPage.call(host,device):kind==='light'?views.renderLightPage.call(host,device,false):kind==='curtain'?renderCurtain(device,host):kind==='fan'?views.renderFanPage.call(host,device):kind==='ac'?views.renderAirConditionerPage.call(host,device):views.renderSensorPage.call(host,device);
  const layout=kind==='switch'?'switch':kind==='light'?'light':kind==='curtain'?'curtain':kind==='fan'?'fan':kind==='ac'?'air-conditioner':'temperature-humidity-sensor';
  const title=element('div','device-page-title',element('h2','',device.name));if(body.dataset.headerStatus)title.append(element('p','device-header-status',body.dataset.headerStatus));
  const back=button('','page-icon-button',closeDetail,'back');back.setAttribute('aria-label','返回家庭');const page=element('section',`device-page page-${layout}`,element('header','device-page-header',back,title),element('div','device-page-scroll',body));stage=deviceSurfaces(element('div','device-stage',page));
 }
 const page=stage.querySelector<HTMLElement>('.device-page')!;page.setAttribute('role','dialog');page.setAttribute('aria-modal','true');page.setAttribute('aria-label',device.name+'控制');stage.classList.add('showcase-device-dialog');dismissOnBackdrop(stage,closeDetail);
 detail?.remove();detail=stage;left.append(stage);syncCurtainDetail();const body=stage.querySelector<HTMLElement>('.device-page-scroll');if(body)body.scrollTop=scroll;
 const target=focusLabel?stage.querySelector<HTMLElement>(`[aria-label="${CSS.escape(focusLabel)}"]`):undefined;if(!preserve||ownsFocus)(target??(focusIndex>=0?stage.querySelectorAll<HTMLElement>(focusable)[focusIndex]:undefined)??stage.querySelector<HTMLElement>('.page-icon-button'))?.focus({preventScroll:true});
}
function refresh(environment:boolean){
 cardGrid.refresh();
 if(selected&&demoDevice(selected)!.kind!=='curtain'&&(!environment||['airer','washer'].includes(demoDevice(selected)!.kind)))renderDetail(true);
 syncCurtainDetail();
 if(environment&&selected){const s=store.stateFor(selected),kind=demoDevice(selected)!.kind;if(kind==='thermo'&&!historySelection){const t=detail?.querySelector<HTMLElement>('[data-property-name=temperature] .reading-value'),h=detail?.querySelector<HTMLElement>('[data-property-name=relative-humidity] .reading-value');if(t)t.textContent=s.temperature.toFixed(1);if(h)h.textContent=String(Math.round(s.humidity));}if(kind==='ac'){const indoor=detail?.querySelector<HTMLElement>('.air-conditioner-hero>p:last-child');if(indoor)indoor.textContent=`室内温度: ${s.temperature.toFixed(1)}℃`;}}
}
const unsubscribe=store.subscribe(refresh);refresh(false);
function requestMode(next:'devices'|'monitor'){setMode(next);window.parent.postMessage({type:'mijia-demo:mode',instance,mode:next},location.origin);}
function setMode(next:DemoMode){if(instance==='hero'&&next!=='devices')return;lastReportedMode=undefined;if(next===mode){reportSize();return;}cardGrid.cancelInteraction();closeDetail(false);mode=next;deviceLayout.hidden=next!=='devices';monitor.setActive(next==='monitor');reportSize();}
monitor.setActive(false);
let revision=-1;
window.addEventListener('message',event=>{if(event.source!==window.parent||event.origin!==location.origin||event.data?.instance!==instance)return;const data=event.data;if(data.type==='mijia-demo:theme'&&(data.theme==='light'||data.theme==='dark')){parentTheme=data.theme;theme();}if(data.type==='mijia-demo:connect')window.parent.postMessage({type:'mijia-demo:ready',instance},location.origin);if(data.type==='mijia-demo:viewport'&&typeof data.bounded==='boolean'){document.documentElement.classList.toggle('bounded-preview',data.bounded);reportSize();}if(data.type==='mijia-demo:mode'&&['devices','monitor'].includes(data.mode))setMode(data.mode);if(data.type==='mijia-demo:fullscreen'&&typeof data.active==='boolean'){if(parentFullscreen&&!data.active)parentFullscreenExitedAt=performance.now();parentFullscreen=data.active;reportSize();}if(data.type==='mijia-demo:visibility'){visible=data.visible===true;monitor.setVisible(visible);}if(data.type==='mijia-demo:state'&&Number.isSafeInteger(data.revision)&&data.revision>=revision){revision=data.revision;store.applySnapshot(data.snapshot,data.environment===true);}});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'){if(mode==='monitor'){
  // Native Esc can exit the parent fullscreen before delivering this key event.
  // Consume that same key so it cannot also leave monitor mode.
  if(parentFullscreen)window.parent.postMessage({type:'mijia-demo:fullscreen-exit',instance},location.origin);
  else if(performance.now()-parentFullscreenExitedAt>=250&&!monitor.escape())requestMode('devices');
 }else if(cardGrid.cancelDrag()){}else if(selected){if(historySelection){historySelection=undefined;renderDetail(false);}else if(laundry.back()){}else closeDetail();}else return;event.preventDefault();event.stopPropagation();}
 if(event.key==='Tab'){const scope=monitor.focusScope()??detail;if(!scope)return;const focusables=[...scope.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(n=>n.getClientRects().length>0);if(!focusables.length)return;const first=focusables[0],last=focusables.at(-1)!;if(event.shiftKey&&(document.activeElement===first||!scope.contains(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!scope.contains(document.activeElement))){event.preventDefault();first.focus();}}
});
const system=matchMedia('(prefers-color-scheme: dark)'),theme=()=>{document.documentElement.dataset.theme=parentTheme??(system.matches?'dark':'light');window.dispatchEvent(new Event('appearance-change'));};theme();system.addEventListener('change',theme);
window.parent.postMessage({type:'mijia-demo:ready',instance},location.origin);
window.addEventListener('pagehide',()=>{unsubscribe();sizeObserver.disconnect();cardGrid.dispose();cancelAnimationFrame(sizeFrame);document.removeEventListener('fullscreenchange',reportSize);system.removeEventListener('change',theme);store.dispose();laundry.dispose();void monitor.dispose().finally(()=>source.dispose());disposeHistoryCharts();},{once:true});
