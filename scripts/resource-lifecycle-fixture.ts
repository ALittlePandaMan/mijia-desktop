import{CameraPlayer,type CameraSource}from'../src/camera-page';
import{MonitorWall}from'../src/ui/monitor-wall';
import type{MonitorTransport}from'../src/monitor';
import type{Device,HomeSnapshot}from'../src/types';
import{ResourceRevisions,setVisualWorkPaused,type ResourceState}from'../src/background-work';
import{listenResourceState}from'../src/resource-events';
import{settingsPage,createSettingsViewState,captureSettingsView,restoreSettingsView}from'../src/ui/settings-page';

const checks:{name:string;passed:boolean}[]=[];
function check(name:string,value:unknown){checks.push({name,passed:!!value});if(!value)throw Error(name);}
const wait=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(){
 const calls:{stop:number;start:number;play:number;pause:number;watch:number;clip:unknown[]}={stop:0,start:0,play:0,pause:0,watch:0,clip:[]};let paused=false;
 const source:CameraSource={cameraFeatures:async()=>({qualities:[],listen:true,talk:true,ptz:false,playback:true}),startCamera:async()=>{calls.start++;return'mock-session';},stopCamera:async()=>{calls.stop++;},readCamera:async()=>[],cameraCommand:async()=>({state:'ready'}),cameraMicrophone:async()=>{},cameraScreenshot:async()=>null};
 const player=new CameraPlayer(()=>{},source);document.querySelector('#fixture')!.append(player.stage);
 Reflect.set(player,'context',{homeId:'mock-home',generation:1,did:'mock-camera'});Reflect.set(player,'online',true);Reflect.set(player,'session','mock-session');Reflect.set(player,'busy',true);
 player.video.muted=true;Object.defineProperty(player.video,'paused',{configurable:true,get:()=>paused});player.video.pause=()=>{paused=true;calls.pause++;};player.video.play=async()=>{paused=false;calls.play++;};
 Reflect.set(player,'start',async()=>{calls.start++;Reflect.set(player,'session','resumed-session');});Reflect.set(player,'watchFrames',()=>{calls.watch++;});Reflect.set(player,'playClip',async(...args:unknown[])=>{calls.clip=args;});
 return{player,calls,paused:()=>paused};
}
async function run(){
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
 {const f=fixture(),event={id:'mock-event'};Reflect.set(f.player,'cloudEvent',event);f.player.video.playbackRate=2;f.player.backgroundPause();check('cloud replay pauses without discarding its source',f.calls.stop===0&&f.paused()&&Reflect.get(f.player,'cloudEvent')===event&&!f.player.blocksSuspension);f.player.backgroundResume();check('cloud replay restores speed and playback',f.calls.play===1&&f.player.video.playbackRate===2);f.player.dispose();}
 {const f=fixture();f.player.backgroundPause();await wait();f.player.dispose();f.player.backgroundResume();await wait();check('disposed media does not restart after a delayed wake',f.calls.start===0);}
 {
  const calls={create:0,stop:0,retry:0};const transport:MonitorTransport={create:async()=>{calls.create++;return'group';},read:()=>new Promise(()=>{}),retry:async()=>{calls.retry++;},stop:async()=>{calls.stop++;}};
  const wall=new MonitorWall(()=>{},()=>{},transport);document.querySelector('#fixture')!.append(wall.root);
  const device=(did:string):Device=>({did,name:did,model:'chuangmi.camera.mock',online:false,roomId:'mock-room',roomName:'模拟房间',specType:'urn:miot-spec-v2:device:camera:mock:1'});
  wall.update({homeId:'mock-home',generation:1,devices:[device('one'),device('two')]}as HomeSnapshot,[]);await wait();
  const roots=[...wall.root.querySelectorAll('.monitor-tile')],tiles=[...Reflect.get(wall,'tiles').values()];Reflect.set(tiles[0],'recording',true);
  wall.setPaused(true);check('recording wall keeps its group while silent tile pauses',calls.stop===0&&!tiles[0].resourceIsPaused&&tiles[1].resourceIsPaused);
  wall.setPaused(false);await wait();check('selective wall wake retains recording and DOM',calls.create===1&&roots.every((root,i)=>wall.root.querySelectorAll('.monitor-tile')[i]===root));
  Reflect.set(tiles[0],'recording',false);wall.setPaused(true);await wait();check('fully silent wall releases group without destroying tiles',calls.stop===1&&roots.every((root,i)=>wall.root.querySelectorAll('.monitor-tile')[i]===root));
  wall.setPaused(false);await wait();check('wall reopens one group on wake',calls.create===2);wall.close();
 }
 {
  // Exercise the production subscription through Tauri's real JS event adapter.
  const callbacks=new Map<number,(event:{payload:ResourceState})=>void>(),listeners=new Map<number,{target:{kind:string;label?:string};handler:number}>();let sequence=0;
  const oldInternals=Reflect.get(window,'__TAURI_INTERNALS__'),oldEvents=Reflect.get(window,'__TAURI_EVENT_PLUGIN_INTERNALS__');
  Reflect.set(window,'__TAURI_INTERNALS__',{transformCallback:(callback:(event:{payload:ResourceState})=>void)=>{const id=++sequence;callbacks.set(id,callback);return id;},invoke:async(command:string,args:{target:{kind:string;label?:string};handler:number;eventId:number})=>{if(command==='plugin:event|listen'){const id=++sequence;listeners.set(id,args);return id;}if(command==='plugin:event|unlisten')listeners.delete(args.eventId);}});
  Reflect.set(window,'__TAURI_EVENT_PLUGIN_INTERNALS__',{unregisterListener:()=>{}});
  const emit=(label:string,revision:number,visible:boolean)=>{for(const entry of listeners.values())if(entry.target.kind==='Any'||entry.target.label===label)callbacks.get(entry.handler)?.({payload:{version:1,revision,visible,refreshMs:30000}});};
  const calls={create:0,stop:0};const transport:MonitorTransport={create:async()=>{calls.create++;return'fullscreen-group';},read:()=>new Promise(()=>{}),retry:async()=>{},stop:async()=>{calls.stop++;}};
  const wall=new MonitorWall(()=>{},()=>{},transport);document.querySelector('#fixture')!.append(wall.root);
  const devices=Array.from({length:4},(_,i)=>({did:`fullscreen-${i}`,name:'模拟监控',model:'chuangmi.camera.mock',online:false,roomId:'mock-room',roomName:'模拟房间',specType:'urn:miot-spec-v2:device:camera:mock:1'}));
  wall.update({homeId:'mock-home',generation:1,devices}as HomeSnapshot,[]);await wait();const roots=[...wall.root.querySelectorAll('.monitor-tile')],videos=[...wall.root.querySelectorAll('video')];
  const revisions=new ResourceRevisions();const off=await listenResourceState('main',value=>{if(revisions.accept(value))wall.setPaused(!value.visible);});
  try{
   emit('main',2,true);
   for(let i=0;i<20;i++){document.body.classList.add('desktop-native-fullscreen');emit('widget-a',100+i*2,false);emit('widget-b',500+i*2,false);window.dispatchEvent(new Event('resize'));await wait();document.body.classList.remove('desktop-native-fullscreen');emit('widget-a',101+i*2,true);emit('widget-b',501+i*2,true);}
   check('20 fullscreen cycles ignore covered desktop host events without reconnecting',calls.create===1&&calls.stop===0);
   check('fullscreen keeps all four monitor tiles and video nodes',roots.length===4&&videos.length===4&&roots.every((root,i)=>wall.root.querySelectorAll('.monitor-tile')[i]===root)&&videos.every((video,i)=>wall.root.querySelectorAll('video')[i]===video));
   emit('main',3,false);await wait();check('own minimize still releases the monitor group despite higher foreign revisions',calls.stop===1);
   emit('widget-a',999,true);await wait();check('uncovering a host cannot wake a minimized main monitor',calls.create===1);
   emit('main',4,true);await wait();check('own restore resumes one monitor group',calls.create===2);
   off();await wait();check('fullscreen resource subscription is released on cleanup',listeners.size===0);
  }finally{off();wall.close();Reflect.set(window,'__TAURI_INTERNALS__',oldInternals);Reflect.set(window,'__TAURI_EVENT_PLUGIN_INTERNALS__',oldEvents);}
 }
 {
  const a=document.createElement('div'),b=document.createElement('div');document.body.append(a,b);const one=a.animate([{opacity:0},{opacity:1}],{duration:10000}),two=b.animate([{opacity:0},{opacity:1}],{duration:10000});
  setVisualWorkPaused(a,true);setVisualWorkPaused(b,true);setVisualWorkPaused(a,false);check('animation ownership is isolated per card',one.playState!=='paused'&&two.playState==='paused');setVisualWorkPaused(b,false);one.cancel();two.cancel();a.remove();b.remove();
 }
 return{complete:true,mockOnly:true,physicalDeviceWrites:0,checks};
}
(window as unknown as {runResourceChecks:()=>Promise<unknown>}).runResourceChecks=async()=>{try{return await run();}catch(error){return{complete:false,mockOnly:true,physicalDeviceWrites:0,checks,error:String(error)};}};
