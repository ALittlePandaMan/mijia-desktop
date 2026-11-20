import {api} from '../src/api';
import{CameraPlayer,type CameraSource}from'../src/camera-page';
import{MonitorWall}from'../src/ui/monitor-wall';
import type{MonitorTransport}from'../src/monitor';
import type{Device,HomeSnapshot}from'../src/types';
import{monitorInBackground,ResourceRevisions,setVisualWorkPaused,type ResourceState}from'../src/background-work';
import{listenResourceState}from'../src/resource-events';
import{settingsPage,createSettingsViewState,captureSettingsView,restoreSettingsView}from'../src/ui/settings-page';
import{renderMonitorQuality}from'../src/ui/camera-control-view';
import{CameraCare}from'../src/camera-care';
import{attachSurface,detachSurface,type SoftwareSurface}from'../src/media-surface';
import type{CameraOperation}from'../src/camera-types';
import{dismissOnBackdrop}from'../src/ui/dialog-dismiss';

const checks:{name:string;passed:boolean}[]=[];
function check(name:string,value:unknown){checks.push({name,passed:!!value});if(!value)throw Error(name);}
const wait=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(onCommand?:(op:CameraOperation)=>void){
 const calls:{stop:number;start:number;play:number;pause:number;watch:number;clip:unknown[]}={stop:0,start:0,play:0,pause:0,watch:0,clip:[]};let paused=false;
 const source:CameraSource={cameraFeatures:async()=>({qualities:[],listen:true,talk:true,ptz:false,playback:true}),startCamera:async()=>{calls.start++;return'mock-session';},stopCamera:async()=>{calls.stop++;},readCamera:async()=>[],cameraCommand:async(_context,_id,op)=>{onCommand?.(op);return{state:op.kind==='record'&&op.enabled?'recording':'ready'};},cameraMicrophone:async()=>{},cameraScreenshot:async()=>null};
 const player=new CameraPlayer(()=>{},source);document.querySelector('#fixture')!.append(player.stage);
 Reflect.set(player,'context',{homeId:'mock-home',generation:1,did:'mock-camera'});Reflect.set(player,'online',true);Reflect.set(player,'session','mock-session');Reflect.set(player,'busy',true);
 player.video.muted=true;Object.defineProperty(player.video,'paused',{configurable:true,get:()=>paused});player.video.pause=()=>{paused=true;calls.pause++;};player.video.play=async()=>{paused=false;calls.play++;};
 Reflect.set(player,'start',async()=>{calls.start++;Reflect.set(player,'session','resumed-session');});Reflect.set(player,'watchFrames',()=>{calls.watch++;});Reflect.set(player,'playClip',async(...args:unknown[])=>{calls.clip=args;});
 return{player,calls,paused:()=>paused};
}
async function run(){
 {
  const ops:CameraOperation[]=[],f=fixture(op=>ops.push(op));const state=()=>Reflect.apply(Reflect.get(f.player,'updateButtons'),f.player,[]);
  const record=()=>f.player.stage.querySelector<HTMLButtonElement>('[aria-label="开始录像"],[aria-label="结束录像"]')!;
  const surface={readyState:2,videoWidth:1280,videoHeight:720,currentTime:1,paused:false,muted:true,playbackRate:1,pause(){},dispose(){}};
  check('camera detail cannot record before the first frame',record().disabled);
  attachSurface(f.player.video,surface as unknown as SoftwareSurface);state();
  check('software-decoded detail frame enables the same native recording action',!record().disabled&&f.player.video.readyState===0);
  record().click();await wait();check('record keeps the original stream dimensions and lens',ops[0]?.kind==='record'&&ops[0].enabled&&ops[0].width===1280&&ops[0].height===720&&ops[0].lensId===0);
  surface.readyState=0;state();check('recording remains stoppable after a temporary frame loss',!record().disabled&&record().getAttribute('aria-label')==='结束录像');
  record().click();await wait();check('ending recording still uses the native route',ops[1]?.kind==='record'&&!ops[1].enabled);
  detachSurface(f.player.video);f.player.dispose();f.player.stage.remove();
 }
 {
  const ops:CameraOperation[]=[],f=fixture(op=>ops.push(op));
  f.player.applyFeatures({qualities:[],listen:true,talk:true,ptz:false,playback:true,lenses:[{id:0,label:'主镜头',ptz:false},{id:10,label:'副镜头',ptz:false}]});
  const secondary=Reflect.get(f.player,'secondary').video as HTMLVideoElement;
  const update=()=>Reflect.apply(Reflect.get(f.player,'updateButtons'),f.player,[]);
  const main=Reflect.get(f.player,'recordButton') as HTMLButtonElement,other=Reflect.get(f.player,'secondaryRecord') as HTMLButtonElement;
  const surface={readyState:2,videoWidth:640,videoHeight:360,currentTime:1,paused:false,muted:true,playbackRate:1,pause(){},dispose(){}};
  attachSurface(secondary,surface as unknown as SoftwareSurface);update();
  check('dual-lens detail enables capture only on the decoded lens',main.disabled&&!other.disabled);
  other.click();await wait();
  check('dual-lens recording still uses the selected physical lens',ops[0]?.kind==='record'&&ops[0].enabled&&ops[0].lensId===10);
  detachSurface(secondary);f.player.dispose();f.player.stage.remove();
 }
 {
  const care=new CameraCare(()=>{},()=>{},(c,date,id)=>api.cameraCareThumbnail(c,date,id));document.body.append(care.root);
  care.loading({homeId:'mock-home',did:'camera',generation:1},'2026-11-18');
  care.update({events:[{id:'event',time:1795006800,kind:'有人移动',duration:3,thumbnailAvailable:false,playbackAvailable:true}]});
  const trigger=care.root.querySelector<HTMLButtonElement>('.camera-care-filter-menu')!;
  trigger.click();const menu=()=>care.root.querySelector('.camera-care-filter-options');
  const pointer=(type:string)=>new PointerEvent(type,{bubbles:true,isPrimary:true,pointerId:1,button:0});
  menu()!.dispatchEvent(pointer('pointerdown'));check('care filter ignores a press within its menu',!!menu());
  document.body.dispatchEvent(pointer('pointerdown'));check('care filter closes on outside press without changing selection',!menu()&&trigger.getAttribute('aria-expanded')==='false');
  trigger.click();document.activeElement?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  check('Escape returns focus to the care filter trigger',!menu()&&document.activeElement===trigger);
  trigger.click();menu()!.querySelectorAll<HTMLButtonElement>('button')[1].click();trigger.click();
  check('choosing an event filter retains its checked state when reopened',menu()!.querySelector('[aria-checked=true]')?.textContent==='有人移动');
  care.clear();check('closing camera care retires the menu and its listeners',!menu());care.root.remove();
  const backdrop=document.createElement('div'),content=document.createElement('section');backdrop.append(content);document.body.append(backdrop);let closed=0;
  dismissOnBackdrop(backdrop,()=>closed++);
  content.dispatchEvent(pointer('pointerdown'));backdrop.dispatchEvent(pointer('pointerup'));backdrop.click();
  check('dragging from a dialog to the backdrop does not cancel it',closed===0);
  backdrop.dispatchEvent(pointer('pointerdown'));backdrop.dispatchEvent(pointer('pointerup'));backdrop.click();
  check('a deliberate backdrop click only runs the cancel callback',closed===1);backdrop.remove();
 }
 {
  const root=document.createElement('div'),view=createSettingsViewState('mcp');document.body.append(root);let baseline='8765';
  const render=()=>settingsPage({view,homeAvailable:false,changed:()=>{},homeName:'',devices:[],loading:false,pending:false,back:()=>{},retry:()=>{},change:()=>{},artwork:()=>document.createElement('span'),application:{card:()=>{const card=document.createElement('div'),input=document.createElement('input');input.className='settings-number';input.dataset.focusKey='test-port';input.defaultValue=input.value=baseline;card.append(input);return card;}}});
  root.append(render());root.querySelector('input')!.value='9555';captureSettingsView(root,view);root.replaceChildren(render());restoreSettingsView(root,view);check('settings redraw preserves an unsubmitted numeric draft',root.querySelector('input')!.value==='9555');
  baseline='9555';root.replaceChildren(render());restoreSettingsView(root,view);check('committed settings baseline retires the transient draft',root.querySelector('input')!.value==='9555'&&!view.panels.mcp.inputDrafts?.['test-port']);root.remove();
 }
 {const f=fixture();let polls=0;Reflect.set(f.player,'powerActive',true);Reflect.set(f.player,'refreshPower',async()=>{polls++;});Reflect.set(f.player,'powerTimer',setTimeout(()=>polls++,5));f.player.backgroundPause();await new Promise(r=>setTimeout(r,15));check('camera power background timer is released',polls===0&&Reflect.get(f.player,'powerTimer')===undefined);f.player.backgroundResume();check('camera power refresh resumes once',polls===1);f.player.dispose();}
 for(const flag of['recording','recordingPending','listening','soundPending','talking','talkPending','operation']){
  const f=fixture();Reflect.set(f.player,flag,flag==='recordingPending'?1:true);f.player.backgroundPause();check(`background preserves ${flag}`,f.calls.stop===0&&f.player.blocksSuspension);Reflect.set(f.player,flag,flag==='recordingPending'?0:false);f.player.dispose();
 }
 {const f=fixture();f.player.video.muted=false;f.player.backgroundPause();check('audible playback continues',f.calls.stop===0&&f.player.blocksSuspension);f.player.video.muted=true;f.player.dispose();}
 {const f=fixture();Reflect.set(Reflect.get(f.player,'cloudControls'),'saving',true);f.player.backgroundPause();check('export blocks suspension',f.calls.stop===0&&f.player.blocksSuspension);Reflect.set(Reflect.get(f.player,'cloudControls'),'saving',false);f.player.dispose();}
 {const f=fixture(),stage=f.player.stage,video=f.player.video;f.player.backgroundPause();await wait();check('silent live stream stops once and permits suspension',f.calls.stop===1&&!f.player.blocksSuspension);f.player.backgroundPause();check('repeated idle heartbeat does not stop twice',f.calls.stop===1);f.player.backgroundResume();await wait();check('live resumes without replacing video or controls',f.calls.start===1&&f.player.stage===stage&&f.player.video===video);f.player.dispose();}
 {const f=fixture(),clip={start:0,duration:120,event:false,channel:0};Reflect.set(f.player,'clip',clip);Reflect.set(f.player,'clipOffset',25);Reflect.set(f.player,'playbackRate',4);Reflect.set(f.player,'clipPaused',true);Object.defineProperty(f.player.video,'currentTime',{configurable:true,value:11,writable:true});f.player.backgroundPause();await wait();f.player.backgroundResume();await wait();check('SD replay preserves position speed and paused state',f.calls.clip[0]===clip&&f.calls.clip[1]===35&&f.calls.clip[2]===4&&f.calls.clip[3]===true);f.player.dispose();}
 {const f=fixture(),event={id:'mock-event'},timeline=Reflect.get(f.player,'cloudSequence');Reflect.set(f.player,'cloudEvent',event);f.player.video.playbackRate=2;
  Object.defineProperty(f.player.video,'src',{writable:true,value:''});f.player.video.load=()=>queueMicrotask(()=>f.player.video.dispatchEvent(new Event('loadedmetadata')));
  const data=new TextEncoder().encode('\0\0\0\x18ftypisom\0\0\0\0isom').buffer;
  await timeline.load({parts:[2],read:async()=>data,close:()=>{}},true);
  f.player.backgroundPause();check('cloud replay pauses without discarding its source',f.calls.stop===0&&f.paused()&&Reflect.get(f.player,'cloudEvent')===event&&!f.player.blocksSuspension);
  f.player.backgroundResume();await wait();check('cloud replay restores speed and playback',f.calls.play===2&&f.player.video.playbackRate===2);f.player.dispose();
 }
 {const f=fixture();f.player.backgroundPause();await wait();f.player.dispose();f.player.backgroundResume();await wait();check('disposed media does not restart after a delayed wake',f.calls.start===0);}
 {
  const calls={create:0,stop:0,retry:0};const transport:MonitorTransport={create:async()=>{calls.create++;return'group';},read:()=>new Promise(()=>{}),retry:async()=>{calls.retry++;},stop:async()=>{calls.stop++;}};
  const wall=new MonitorWall(()=>{},()=>{},transport);document.querySelector('#fixture')!.append(wall.root);
  const device=(did:string):Device=>({did,name:did,model:'chuangmi.camera.mock',online:false,roomId:'mock-room',roomName:'模拟房间',specType:'urn:miot-spec-v2:device:camera:mock:1'});
  wall.update({homeId:'mock-home',generation:1,devices:[device('one'),device('two')]}as HomeSnapshot,[]);await wait();
  const roots=[...wall.root.querySelectorAll('.monitor-tile')],tiles=[...Reflect.get(wall,'tiles').values()];Reflect.set(tiles[0],'recording',true);
  wall.setPaused(true);check('recording wall keeps its group while silent tile pauses',calls.stop===0&&!tiles[0].resourceIsPaused&&tiles[1].resourceIsPaused);
  wall.setPaused(false);await wait();check('selective wall wake retains recording and DOM',calls.create===1&&roots.every((root,i)=>wall.root.querySelectorAll('.monitor-tile')[i]===root));
  Reflect.set(tiles[0],'recording',false);Reflect.set(tiles[0],'quality','hd');wall.setPaused(true);await wait();check('fully silent wall releases decoders and keeps the original group',calls.stop===0&&tiles.every(tile=>tile.resourceIsPaused)&&!wall.blocksSuspension&&roots.every((root,i)=>wall.root.querySelectorAll('.monitor-tile')[i]===root));
  wall.setPaused(false);await wait();check('wall wakes on the existing group with its selected quality',calls.create===1&&calls.retry===0&&Reflect.get(tiles[0],'quality')==='hd');wall.close();check('explicit exit stops the original group',calls.stop===1);
 }
 {
  // Exercise the production subscription through Tauri's real JS event adapter.
  const callbacks=new Map<number,(event:{payload:ResourceState})=>void>(),listeners=new Map<number,{target:{kind:string;label?:string};handler:number}>();let sequence=0;
  const oldInternals=Reflect.get(window,'__TAURI_INTERNALS__'),oldEvents=Reflect.get(window,'__TAURI_EVENT_PLUGIN_INTERNALS__');
  Reflect.set(window,'__TAURI_INTERNALS__',{transformCallback:(callback:(event:{payload:ResourceState})=>void)=>{const id=++sequence;callbacks.set(id,callback);return id;},invoke:async(command:string,args:{target:{kind:string;label?:string};handler:number;eventId:number})=>{if(command==='plugin:event|listen'){const id=++sequence;listeners.set(id,args);return id;}if(command==='plugin:event|unlisten')listeners.delete(args.eventId);}});
  Reflect.set(window,'__TAURI_EVENT_PLUGIN_INTERNALS__',{unregisterListener:()=>{}});
  const emit=(label:string,revision:number,visible:boolean,monitorBackground?:boolean)=>{for(const entry of listeners.values())if(entry.target.kind==='Any'||entry.target.label===label)callbacks.get(entry.handler)?.({payload:{version:1,revision,visible,refreshMs:30000,monitorBackground}});};
  const calls={create:0,stop:0,retry:0};const transport:MonitorTransport={create:async()=>{calls.create++;return'fullscreen-group';},read:()=>new Promise(()=>{}),retry:async()=>{calls.retry++;},stop:async()=>{calls.stop++;}};
  const wall=new MonitorWall(()=>{},()=>{},transport);document.querySelector('#fixture')!.append(wall.root);
  const devices=Array.from({length:4},(_,i)=>({did:`fullscreen-${i}`,name:'模拟监控',model:'chuangmi.camera.mock',online:false,roomId:'mock-room',roomName:'模拟房间',specType:'urn:miot-spec-v2:device:camera:mock:1'}));
  wall.update({homeId:'mock-home',generation:1,devices}as HomeSnapshot,[]);await wait();const roots=[...wall.root.querySelectorAll('.monitor-tile')],videos=[...wall.root.querySelectorAll('video')];
  const revisions=new ResourceRevisions();const off=await listenResourceState('main',value=>{if(revisions.accept(value))wall.setPaused(monitorInBackground(value.monitorBackground,false,false),!value.visible);});
  try{
   emit('main',2,true,false);
   for(let i=0;i<20;i++){document.body.classList.add('desktop-native-fullscreen');emit('widget-a',100+i*2,false);emit('widget-b',500+i*2,false);window.dispatchEvent(new Event('resize'));await wait();document.body.classList.remove('desktop-native-fullscreen');emit('widget-a',101+i*2,true);emit('widget-b',501+i*2,true);}
   check('20 fullscreen cycles ignore covered desktop host events without reconnecting',calls.create===1&&calls.stop===0);
   check('fullscreen keeps all four monitor tiles and video nodes',roots.length===4&&videos.length===4&&roots.every((root,i)=>wall.root.querySelectorAll('.monitor-tile')[i]===root)&&videos.every((video,i)=>wall.root.querySelectorAll('video')[i]===video));
   const tiles=[...Reflect.get(wall,'tiles').values()];const mediaBefore=tiles.map(tile=>Reflect.get(tile.page,'mediaEpoch'));
   for(const [i,tile] of tiles.entries()){tile.root.dataset.playing='true';Reflect.set(tile,'quality',i===0?'hd':'auto');}
   emit('main',3,false,false);await wait();
   check('Alt+Tab coverage leaves the renderer, playing markers, and selected tiers intact',tiles.every((tile,i)=>!tile.resourceIsPaused&&Reflect.get(tile.page,'monitorHidden')&&Reflect.get(tile.page,'mediaEpoch')===mediaBefore[i]&&tile.root.dataset.playing==='true'&&Reflect.get(tile,'quality')===(i===0?'hd':'auto'))&&calls.create===1&&calls.stop===0&&calls.retry===0);
   emit('main',4,false,true);await wait();check('minimizing while still covered pauses presentation and keeps the group',calls.stop===0&&tiles.every(tile=>tile.resourceIsPaused));
   emit('widget-a',999,true);await wait();check('uncovering a host cannot wake a minimized main monitor',calls.create===1);
   emit('main',5,false,false);await wait();check('restoring under another window resumes the same group and selected tiers',calls.create===1&&tiles.every((tile,i)=>!tile.resourceIsPaused&&Reflect.get(tile,'quality')===(i===0?'hd':'auto')));
   emit('main',4,false,true);await wait();check('a delayed minimize event cannot blank restored monitor tiles',tiles.every(tile=>!tile.resourceIsPaused)&&calls.retry===0);
   emit('main',6,true,false);await wait();check('uncovering re-enables paint checks without reconnecting',tiles.every(tile=>!Reflect.get(tile.page,'monitorHidden'))&&calls.create===1&&calls.retry===0);
   off();await wait();check('fullscreen resource subscription is released on cleanup',listeners.size===0);
  }finally{off();wall.close();Reflect.set(window,'__TAURI_INTERNALS__',oldInternals);Reflect.set(window,'__TAURI_EVENT_PLUGIN_INTERNALS__',oldEvents);}
 }
 {
  const qualities=[{id:'sd',label:'流畅'},{id:'hd',label:'高清'},{id:'uhd',label:'超清'},{id:'auto',label:'自动'}];
  const low={width:848,height:480},high={width:2960,height:1666},sizes={sd:low,hd:high,uhd:low};
  const menu=document.createElement('div');document.body.append(menu);
  renderMonitorQuality(menu,qualities,'uhd',()=>{});
  check('monitor selects the native ultra tier when independently available',menu.textContent==='超清高清流畅自动'&&!!menu.querySelector('[data-quality=uhd][data-quality-mode=uhd][aria-checked=true]'));
  menu.querySelector<HTMLButtonElement>('[data-quality=uhd]')!.focus();
  renderMonitorQuality(menu,qualities,'uhd',()=>{},sizes);
  check('monitor quality menu folds a duplicate low stream and maps selection and focus to smooth without sizes',menu.textContent==='高清流畅自动'&&document.activeElement===menu.querySelector('[data-quality=sd][aria-checked=true]'));menu.remove();
  const f=fixture();f.player.applyFeatures({qualities,listen:true,talk:true,ptz:false,playback:false});
  f.player.syncControls('uhd',false);
  check('detail menu and toolbar show the native ultra tier',f.player.stage.querySelector('.camera-quality-button')?.textContent==='超清'&&f.player.stage.querySelector('[data-quality=uhd]')?.textContent==='超清');
  const readings=Reflect.get(f.player,'qualityReadings');for(const [quality,size]of Object.entries(sizes)){readings.reset(quality);for(let frame=0;frame<3;frame++)readings.observe(0,size,quality,quality);}
  Reflect.set(f.player,'quality','uhd');const panel=f.player.stage.querySelector<HTMLElement>('.camera-quality-modal')!;panel.hidden=false;Reflect.apply(Reflect.get(f.player,'renderQuality'),f.player,[]);
  check('camera detail uses the same plain tier labels without a diagnostic action',[...panel.querySelectorAll('[data-quality]')].map(choice=>choice.textContent?.trim()).join('')==='高清流畅自动'&&!!panel.querySelector('[data-quality=sd][aria-checked=true]')&&!panel.textContent?.includes('导出播放诊断'));
  check('detail toolbar uses the label of the matched stream while retaining its old selection',f.player.stage.querySelector('.camera-quality-button')?.textContent==='流畅'&&f.player.controls.quality==='uhd');
  f.player.dispose();f.player.stage.remove();
 }
 {
  const a=document.createElement('div'),b=document.createElement('div');document.body.append(a,b);const one=a.animate([{opacity:0},{opacity:1}],{duration:10000}),two=b.animate([{opacity:0},{opacity:1}],{duration:10000});
  setVisualWorkPaused(a,true);setVisualWorkPaused(b,true);setVisualWorkPaused(a,false);check('animation ownership is isolated per card',one.playState!=='paused'&&two.playState==='paused');setVisualWorkPaused(b,false);one.cancel();two.cancel();a.remove();b.remove();
 }
 return{complete:true,mockOnly:true,physicalDeviceWrites:0,checks};
}
(window as unknown as {runResourceChecks:()=>Promise<unknown>}).runResourceChecks=async()=>{try{return await run();}catch(error){return{complete:false,mockOnly:true,physicalDeviceWrites:0,checks,error:String(error)};}};
