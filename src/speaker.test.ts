import {expect,it,vi} from 'vitest';
import {audioBindings,audioDetailEligible,playbackActive,playbackBinding,playerPresentation,speakerMetadataSupported,SpeakerState,type SpeakerPlayer} from './speaker';
import type {Device,DevicePanel,Property,Service} from './types';
const data:SpeakerPlayer={did:'fixture',model:'xiaomi.wifispeaker.l05c',fetchedAt:1,status:2,hasSong:true,title:null,artist:null,cover:null,position:0,duration:25,volume:20};
it('paused background songs retain the player while confirmed idle uses the empty card',()=>{
 expect(playerPresentation(data)).toBe('song');expect(playerPresentation({...data,status:1})).toBe('song');
 expect(playerPresentation({...data,status:0,hasSong:false})).toBe('empty');
 expect(playerPresentation({...data,hasSong:false})).toBe('unknown');expect(playerPresentation(undefined)).toBe('loading');
});
it('does not expose the private music protocol based only on category',()=>{expect(speakerMetadataSupported(data.model)).toBe(true);expect(speakerMetadataSupported('other.speaker.device')).toBe(false)});
it('reads playing and paused codes from the same service that publishes its playback commands',()=>{
 const device:Device={did:'s',model:'speaker.fixture',name:'音箱',online:true,roomId:'',roomName:''};
 const property:Property={siid:3,piid:7,name:'playing-state',description:'',access:['read'],format:'uint8',
   valueList:[{value:2,description:'Playing'},{value:9,description:'Pause'},{value:0,description:'Stop'}],code:0,value:2};
 const service:Service={siid:3,name:'play-control',description:'',properties:[property],actions:[
   {siid:3,aiid:4,name:'play',description:'',in:[],out:[]},
   {siid:3,aiid:5,name:'pause',description:'',in:[],out:[]},
 ]};
 const panel:DevicePanel={did:device.did,model:device.model,services:[service]};
 const binding=audioBindings(device,panel);
 expect(binding).toMatchObject({state:property,play:{action:{aiid:4}},pause:{action:{aiid:5}}});
 expect(playbackActive(playbackBinding(binding.state))).toBe(true);
 expect(playbackActive(playbackBinding({...property,value:0}))).toBe(false);
 expect(playbackActive(playbackBinding({...property,code:-1}))).toBeUndefined();
 expect(playbackBinding(property)?.paused).toBe(9);
});
it('binds amplifier output and zero-input track actions without borrowing microphone or disc controls',()=>{
 const device={did:'fixture',model:'vidon.avamp.wd2',name:'功放',online:true,roomId:'',roomName:'',
   specType:'urn:miot-spec-v2:device:audio-video-amplifier:0000A0D6:vidon-wd2:1:0000C83D'} satisfies Device;
 const volume=(siid:number,piid:number)=>({siid,piid,name:'volume',description:'Volume',format:'uint8',access:['read','write'],valueRange:[0,30,1]});
 const services:Service[]=[
   {siid:2,name:'audio-video-amplifier',description:'',properties:[volume(2,2),volume(2,6)],actions:[]},
   {siid:3,name:'microphone',description:'',properties:[volume(3,1)],actions:[]},
   {siid:4,name:'play-control',description:'',properties:[],actions:[
     {siid:4,aiid:2,name:'next-song',description:'',in:[],out:[]},
     {siid:4,aiid:3,name:'next-cd',description:'',in:[],out:[]},
     {siid:4,aiid:4,name:'previous-song',description:'',in:[1],out:[]},
   ]},
 ];
 const panel={did:device.did,model:device.model,specType:device.specType,services};
 expect(audioBindings(device,panel)).toMatchObject({volume:{siid:2,piid:6},next:{action:{siid:4,aiid:2}},previous:undefined});
 expect(audioDetailEligible({model:'xiaomi.vacuum.d103cn',specType:'urn:miot-spec-v2:device:vacuum:d103cn:1'})).toBe(false);
});
it('keeps real setting volume usable when the track endpoint is unavailable; predicted or other-device seeds are ignored',async()=>{
 const changes:unknown[]=[];const state=new SpeakerState({read:async()=>{throw{kind:'unavailable',message:'无歌曲详情'};},change:async(_c,c)=>{changes.push(c);}},()=>{},()=>{});
 state.bind(context,'a');const panel:DevicePanel={did:data.did,model:data.model,services:[{siid:2,name:'speaker',description:'',actions:[],properties:[{siid:2,piid:1,name:'volume',description:'',format:'uint8',access:['read','write'],code:0,value:34,valueRange:[0,100,1]}]}]};
 state.seedPanel({...panel,did:'other'});expect(state.report).toBeUndefined();const predicted=structuredClone(panel);predicted.services[0].properties[0].pending='sending';state.seedPanel(predicted);expect(state.report).toBeUndefined();state.seedPanel(panel);await state.read();expect(state.report?.volume).toBe(34);expect(state.report?.status).toBeNull();expect(playerPresentation(state.report)).toBe('unknown');void state.mute();expect(state.report?.volume).toBe(0);await flush();expect(changes).toEqual([{operation:'volume',value:0}]);state.close();
});
const context={homeId:'home',generation:1,did:data.did};
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
it('resumes only when the paused player has a song and immediately projects the next button',async()=>{
 let report={...data,hasSong:false};
 const action=vi.fn(async()=>{report={...report,status:1};});
 const state=new SpeakerState({read:async()=>report,change:async()=>{},action},()=>{},()=>{});
 const bindings={volume:undefined,next:undefined,previous:undefined,play:undefined,pause:undefined,state:undefined,hasSong:undefined};
 try{
   state.bind(context,'a');await state.read();expect(state.playbackStatus(bindings).resumable).toBe(false);
   void state.setPlayback(true,{siid:4,aiid:1});await flush();expect(action).not.toHaveBeenCalled();
   report={...report,hasSong:true};await state.read();
   expect(state.playbackStatus(bindings).resumable).toBe(true);
   void state.setPlayback(true,{siid:4,aiid:1});
   expect(state.playbackStatus(bindings).playing).toBe(true);
   await flush();expect(action).toHaveBeenCalledWith(context,{siid:4,aiid:1});
 }finally{state.close();}
});
it('mutes immediately through player volume zero and restores the previous output without touching microphone',async()=>{
 const commands:unknown[]=[];let actual={...data},resolve!:()=>void;const state=new SpeakerState({read:async()=>actual,change:async(_c,c)=>{commands.push(c);await new Promise<void>(r=>resolve=r);}},()=>{},()=>{});
 state.bind(context,'a');await state.read();void state.mute();expect(state.report?.volume).toBe(0);expect(state.actual?.volume).toBe(20);await flush();expect(commands).toEqual([{operation:'volume',value:0}]);
 void state.mute();expect(state.report?.volume).toBe(20);resolve();await flush();expect(commands).toEqual([{operation:'volume',value:0},{operation:'volume',value:20}]);actual={...data};resolve();await flush();state.close();
});
it('keeps unconfirmed volume over stale reads and rolls back an explicit rejection',async()=>{
 vi.useFakeTimers();try{let rejected=false;const state=new SpeakerState({read:async()=>({...data}),change:async()=>{if(rejected)throw{kind:'permissionDenied',message:'拒绝'};}},()=>{},()=>{});
 state.bind(context,'a');await state.read();void state.volume(0);await flush();await vi.advanceTimersByTimeAsync(1500);expect(state.report?.volume).toBe(0);expect(state.uncertain).toBe(true);state.adopt();expect(state.report?.volume).toBe(20);rejected=true;void state.volume(40);expect(state.report?.volume).toBe(40);await flush();expect(state.report?.volume).toBe(20);state.close();}finally{vi.useRealTimers();}
});
it('binds previous and next to player commands and isolates late actions after leaving',async()=>{
 const commands:unknown[]=[];let resolve!:()=>void;const state=new SpeakerState({read:async()=>({...data}),change:async(c,i)=>{commands.push({context:c,change:i});await new Promise<void>(r=>resolve=r);}},()=>{},()=>{});
 state.bind(context,'a');await state.read();const first=state.step('previous');expect(state.stepPending('previous')).toBe(true);
 await state.step('previous');await flush();expect(commands).toEqual([{context,change:{operation:'previous'}}]);
 state.close();state.bind({...context,homeId:'other'},'a');resolve();await first;expect(state.stepPending('previous')).toBe(false);
 const next=state.step('next');await flush();expect(commands[1]).toEqual({context:{...context,homeId:'other'},change:{operation:'next'}});resolve();await next;state.close();
});
it('accepts a new output target after a transient status read failure without replaying previous commands',async()=>{
 let offlineRead=false;const commands:unknown[]=[];const state=new SpeakerState({read:async()=>{if(offlineRead)throw{kind:'network',message:'超时'};return {...data};},change:async(_c,c)=>{commands.push(c);}},()=>{},()=>{});
 state.bind(context,'a');await state.read();offlineRead=true;await state.read();expect(state.error?.kind).toBe('network');void state.mute();expect(state.report?.volume).toBe(0);await flush();expect(commands).toEqual([{operation:'volume',value:0}]);state.close();
});
