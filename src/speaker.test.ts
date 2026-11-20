import {expect,it,vi} from 'vitest';
import {playerPresentation,speakerMetadataSupported,SpeakerState,type SpeakerPlayer} from './speaker';
import type {DevicePanel} from './types';
const data:SpeakerPlayer={did:'fixture',model:'xiaomi.wifispeaker.l05c',fetchedAt:1,status:2,hasSong:true,title:null,artist:null,cover:null,position:0,duration:25,volume:20};
it('paused background songs retain the player while confirmed idle uses the empty card',()=>{
 expect(playerPresentation(data)).toBe('song');expect(playerPresentation({...data,status:1})).toBe('song');
 expect(playerPresentation({...data,status:0,hasSong:false})).toBe('empty');
 expect(playerPresentation({...data,hasSong:false})).toBe('unknown');expect(playerPresentation(undefined)).toBe('loading');
});
it('does not expose the private music protocol based only on category',()=>{expect(speakerMetadataSupported(data.model)).toBe(true);expect(speakerMetadataSupported('other.speaker.device')).toBe(false)});
it('keeps real setting volume usable when the track endpoint is unavailable; predicted or other-device seeds are ignored',async()=>{
 const changes:unknown[]=[];const state=new SpeakerState({read:async()=>{throw{kind:'unavailable',message:'无歌曲详情'};},change:async(_c,c)=>{changes.push(c);}},()=>{},()=>{});
 state.bind(context,'a');const panel:DevicePanel={did:data.did,model:data.model,services:[{siid:2,name:'speaker',description:'',actions:[],properties:[{siid:2,piid:1,name:'volume',description:'',format:'uint8',access:['read','write'],code:0,value:34,valueRange:[0,100,1]}]}]};
 state.seedPanel({...panel,did:'other'});expect(state.report).toBeUndefined();const predicted=structuredClone(panel);predicted.services[0].properties[0].pending='sending';state.seedPanel(predicted);expect(state.report).toBeUndefined();state.seedPanel(panel);await state.read();expect(state.report?.volume).toBe(34);expect(state.report?.status).toBeNull();expect(playerPresentation(state.report)).toBe('unknown');void state.mute();expect(state.report?.volume).toBe(0);await flush();expect(changes).toEqual([{operation:'volume',value:0}]);state.close();
});
const context={homeId:'home',generation:1,did:data.did};
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
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
 state.bind(context,'a');await state.read();const first=state.step('previous');expect(state.actionMessage).toContain('上一首');await flush();expect(commands).toEqual([{context,change:{operation:'previous'}}]);state.close();state.bind({...context,homeId:'other'},'a');resolve();await first;expect(state.actionMessage).toBe('');const next=state.step('next');await flush();expect(commands[1]).toEqual({context:{...context,homeId:'other'},change:{operation:'next'}});resolve();await next;state.close();
});
it('accepts a new output target after a transient status read failure without replaying previous commands',async()=>{
 let offlineRead=false;const commands:unknown[]=[];const state=new SpeakerState({read:async()=>{if(offlineRead)throw{kind:'network',message:'超时'};return {...data};},change:async(_c,c)=>{commands.push(c);}},()=>{},()=>{});
 state.bind(context,'a');await state.read();offlineRead=true;await state.read();expect(state.error?.kind).toBe('network');void state.mute();expect(state.report?.volume).toBe(0);await flush();expect(commands).toEqual([{operation:'volume',value:0}]);state.close();
});
