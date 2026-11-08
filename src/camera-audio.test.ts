import {afterEach,describe,expect,it,vi} from 'vitest';
import {CameraAudio} from './camera-audio';

const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
afterEach(()=>vi.unstubAllGlobals());
describe('buffered SD audio pause',()=>{
 it('keeps sequential queued audio while suspended and after resuming',async()=>{
  const starts:number[]=[],suspend=vi.fn(async()=>{}),resume=vi.fn(async()=>{});
  vi.stubGlobal('AudioContext',class{currentTime=0;destination={};resume=resume;suspend=suspend;close=async()=>{};createGain(){return{connect(){},disconnect(){}}}createBuffer(_channels:number,length:number,rate:number){return{duration:length/rate,copyToChannel(){}}}createBufferSource(){return{buffer:null,connect(){},disconnect(){},start(time:number){starts.push(time)},onended:null}}});
  const audio=new CameraAudio();await audio.listen(true);audio.setPlaybackBuffered(true);await audio.pausePlayback();
  const event={state:'audio',codec:'pcm',sampleRate:8000,data:btoa('\0'.repeat(1600))};for(let n=0;n<20;n++)audio.receive(event,()=>{});
  expect(suspend).toHaveBeenCalledOnce();expect(starts[19]).toBeCloseTo(1.96);
  await audio.resumePlayback();audio.receive(event,()=>{});expect(starts[20]).toBeCloseTo(2.06);expect(resume).toHaveBeenCalledTimes(2);audio.dispose();
 });
});
describe('camera microphone cancellation without real capture',()=>{
 it('does not request permission after codec discovery was cancelled',async()=>{
  const supported=deferred<{supported:boolean}>(),getUserMedia=vi.fn();
  vi.stubGlobal('window',{AudioEncoder:{isConfigSupported:()=>supported.promise},AudioData:class{}});
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});
  const audio=new CameraAudio(),pending=audio.startMicrophone(16000,async()=>{},()=>{});
  audio.stopMicrophone();supported.resolve({supported:true});await pending;
  expect(getUserMedia).not.toHaveBeenCalled();expect(audio.microphoneActive).toBe(false);
 });
 it('stops a late permission grant after leaving the device',async()=>{
  const grant=deferred<MediaStream>(),stop=vi.fn(),track={stop,readyState:'live'},stream={getTracks:()=>[track],getAudioTracks:()=>[track]} as unknown as MediaStream;
  vi.stubGlobal('window',{AudioEncoder:{isConfigSupported:async()=>({supported:true})},AudioData:class{}});
  const getUserMedia=vi.fn(()=>grant.promise);vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});
  const audio=new CameraAudio(),pending=audio.startMicrophone(16000,async()=>{},()=>{});await vi.waitFor(()=>expect(getUserMedia).toHaveBeenCalledOnce());
  audio.dispose();grant.resolve(stream);await pending;
  expect(stop).toHaveBeenCalledOnce();expect(audio.microphoneActive).toBe(false);
 });
 it('cannot create a sender after AudioContext resume completes late',async()=>{
  const resume=deferred<void>(),stop=vi.fn(),createSource=vi.fn(),close=vi.fn(),track={stop,readyState:'live'},stream={getTracks:()=>[track],getAudioTracks:()=>[track]} as unknown as MediaStream;
  vi.stubGlobal('window',{AudioEncoder:{isConfigSupported:async()=>({supported:true})},AudioData:class{}});
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:async()=>stream}});
  vi.stubGlobal('AudioContext',class{resume=()=>resume.promise;close=close;createMediaStreamSource=createSource;});
  const audio=new CameraAudio(),pending=audio.startMicrophone(16000,async()=>{},()=>{});await vi.waitFor(()=>expect(audio.microphoneActive).toBe(true));
  audio.dispose();resume.resolve();await pending;
  expect(createSource).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();expect(stop).toHaveBeenCalled();expect(audio.microphoneActive).toBe(false);
 });
 it('queues an encoder burst while the first IPC packet is pending',async()=>{
  const first=deferred<void>(),send=vi.fn().mockImplementationOnce(()=>first.promise).mockResolvedValue(undefined),failed=vi.fn();
  let output!:(packet:{byteLength:number;copyTo:(bytes:Uint8Array)=>void})=>void;
  class Encoder{static isConfigSupported=async()=>({supported:true});state='configured';constructor(callback:{output:typeof output}){output=callback.output;}configure(){}close(){this.state='closed';}}
  vi.stubGlobal('window',{AudioEncoder:Encoder,AudioData:class{}});
  const track={stop:vi.fn(),readyState:'live'},stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:async()=>stream}});
  const node=()=>({connect:vi.fn(),disconnect:vi.fn(),onaudioprocess:null});
  vi.stubGlobal('AudioContext',class{resume=async()=>{};close=async()=>{};createMediaStreamSource=node;createScriptProcessor=node;destination={};});
  const audio=new CameraAudio();await audio.startMicrophone(16000,send,failed);
  for(let n=0;n<3;n++)output({byteLength:1,copyTo:bytes=>bytes.fill(n)});
  expect(send).toHaveBeenCalledOnce();first.resolve();await vi.waitFor(()=>expect(send).toHaveBeenCalledTimes(3));
  expect(failed).not.toHaveBeenCalled();audio.dispose();expect(audio.microphoneActive).toBe(false);
 });
});
