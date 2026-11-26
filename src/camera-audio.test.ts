import {afterEach,describe,expect,it,vi} from 'vitest';
import {CameraAudio} from './camera-audio';
import type {CameraEvent} from './camera-types';

const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

function outputFixture(){
 const starts:number[]=[],stopped=vi.fn(),disconnected=vi.fn(),close=vi.fn(async()=>{});
 let state:AudioContextState='suspended';
 const suspend=vi.fn(async()=>{state='suspended';}),resume=vi.fn(async()=>{state='running';});
 const copy=vi.fn();
 vi.stubGlobal('AudioContext',class{
  currentTime=0;
  get state(){return state;}
  destination={};
  close=close;
  suspend=suspend;
  resume=resume;
  createGain(){return {connect(){},disconnect(){}};}
  createBuffer(_channels:number,length:number,rate:number){return {duration:length/rate,copyToChannel:copy};}
  createBufferSource(){return {buffer:null,connect(){},disconnect:disconnected,start(time:number){starts.push(time);},stop:stopped,onended:null};}
 });
 return {starts,stopped,disconnected,close,suspend,resume,copy};
}

const pcm:CameraEvent={state:'audio',codec:'pcm',sampleRate:8000,data:btoa('\0'.repeat(1600))};

describe('camera output',()=>{
 it('bounds a stuck output device and releases a cancelled activation',async()=>{
  vi.useFakeTimers();
  const {resume,close}=outputFixture(),startup=deferred<void>();
  resume.mockReturnValue(startup.promise);
  const audio=new CameraAudio();
  const timedOut=expect(audio.listen(true)).rejects.toThrow('本机声音输出未启动');
  await vi.advanceTimersByTimeAsync(3000);
  await timedOut;
  const cancelled=expect(audio.listen(true)).rejects.toThrow('声音已关闭');
  audio.dispose();
  await cancelled;
  startup.resolve();
  await Promise.resolve();
  expect(close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
 });
 it('waits for playable audio despite invalid or unsupported packets',async()=>{
  vi.useFakeTimers();
  outputFixture();
  const audio=new CameraAudio(),played=vi.fn();
  await audio.listen(true);
  const output=audio.waitForOutput();
  audio.receive({...pcm,data:'invalid*base64'},played);
  audio.receive({...pcm,codec:'unsupported'},played);
  expect(played).not.toHaveBeenCalled();
  const failure=expect(output).rejects.toThrow('尚未支持');
  await vi.advanceTimersByTimeAsync(2000);
  await failure;
  const retry=audio.waitForOutput();
  audio.receive(pcm,played);
  await retry;
  expect(played).toHaveBeenCalledOnce();
  audio.dispose();
 });
 it('decodes Opus with a local clock even when the camera timestamp cannot fit',async()=>{
  outputFixture();
  const timestamps:number[]=[];
  const decode=vi.fn();
  vi.stubGlobal('window',{
   EncodedAudioChunk:class{
    constructor({timestamp}:{timestamp:number}){
     if(!Number.isSafeInteger(timestamp))throw TypeError('Timestamp is out of range');
     timestamps.push(timestamp);
    }
   },
   AudioDecoder:class{
    state='configured';decodeQueueSize=0;decode=decode;
    configure(){}
    close(){this.state='closed';}
   },
  });
  const audio=new CameraAudio();
  await audio.listen(true);
  const packet={state:'audio',codec:'opus',data:btoa('\xf8\xff\xfe')};
  for(const timestamp of [2**64,0,2**21,2**21])audio.receive({...packet,timestamp},()=>{});
  expect(decode).toHaveBeenCalledTimes(4);
  expect(timestamps[0]).toBeGreaterThan(0);
  expect(timestamps.slice(1).every((value,index)=>value>timestamps[index])).toBe(true);
  audio.dispose();
 });
 it('recovers from an Opus decoder error and discards a late output after release',async()=>{
  const {close,stopped,copy}=outputFixture();
  type Frame={numberOfFrames:number;numberOfChannels:number;sampleRate:number;copyTo:(samples:Float32Array,options:{planeIndex:number})=>void;close:()=>void};
  type Callbacks={output:(f:Frame)=>void;error:()=>void};
  const decoders:Callbacks[]=[];
  vi.stubGlobal('window',{
   EncodedAudioChunk:class{},
   AudioDecoder:class{
    state='configured';
    decodeQueueSize=0;
    constructor(callbacks:Callbacks){decoders.push(callbacks);}
    configure(){}
    decode(){}
    close(){this.state='closed';}
   },
  });
  const audio=new CameraAudio(),played=vi.fn();
  const event={state:'audio',codec:'opus',data:btoa('sample')};
  const frame={numberOfFrames:960,numberOfChannels:2,sampleRate:48000,copyTo:vi.fn((samples:Float32Array,options:{planeIndex:number})=>{
   samples[0]=options.planeIndex/2;
  }),close:vi.fn()};
  await audio.listen(true);
  const output=audio.waitForOutput();
  audio.receive(event,played);
  decoders[0].error();
  audio.receive(event,played);
  expect(decoders).toHaveLength(2);
  decoders[0].output(frame);
  decoders[1].output(frame);
  await output;
  audio.dispose();
  decoders[1].output(frame);
  expect(played).toHaveBeenCalledOnce();
  expect(frame.copyTo).toHaveBeenCalledTimes(2);
  expect(copy.mock.calls.map(([data,channel])=>[data[0],channel])).toEqual([[0,0],[.5,1]]);
  expect(frame.close).toHaveBeenCalledTimes(3);
  expect(stopped).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
 });
 it('bounds live audio without overlap and stops scheduled buffers after a seek',async()=>{
  const {starts,stopped,disconnected}=outputFixture();
  const audio=new CameraAudio();
  await audio.listen(true);
  for(let n=0;n<30;n++)audio.receive(pcm,()=>{});
  expect(starts).toHaveLength(6);
  expect(starts.at(-1)).toBeCloseTo(.56);
  audio.clearPlayback();
  expect(stopped).toHaveBeenCalledTimes(6);
  expect(disconnected).toHaveBeenCalledTimes(6);
  audio.receive(pcm,()=>{});
  expect(starts.at(-1)).toBeCloseTo(.06);
  audio.dispose();
 });
});

describe('buffered SD audio pause',()=>{
 it('keeps sequential queued audio while suspended and after resuming',async()=>{
  const {starts,suspend,resume}=outputFixture();
  const audio=new CameraAudio();await audio.listen(true);audio.setPlaybackBuffered(true);await audio.pausePlayback();
  for(let n=0;n<20;n++)audio.receive(pcm,()=>{});
  expect(suspend).toHaveBeenCalledOnce();expect(starts[19]).toBeCloseTo(1.96);
  await audio.resumePlayback();audio.receive(pcm,()=>{});expect(starts[20]).toBeCloseTo(2.06);expect(resume).toHaveBeenCalledTimes(2);audio.dispose();
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
  const resume=deferred<void>(),stop=vi.fn(),createSource=vi.fn(),close=vi.fn(async()=>{}),track={stop,readyState:'live'},stream={getTracks:()=>[track],getAudioTracks:()=>[track]} as unknown as MediaStream;
  vi.stubGlobal('window',{AudioEncoder:{isConfigSupported:async()=>({supported:true})},AudioData:class{}});
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:async()=>stream}});
  vi.stubGlobal('AudioContext',class{resume=()=>resume.promise;close=close;createMediaStreamSource=createSource;});
  const audio=new CameraAudio(),pending=audio.startMicrophone(16000,async()=>{},()=>{});await vi.waitFor(()=>expect(audio.microphoneActive).toBe(true));
  audio.dispose();resume.resolve();await pending;
  expect(createSource).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();expect(stop).toHaveBeenCalled();expect(audio.microphoneActive).toBe(false);
 });
 it('releases the microphone when the local input context never starts',async()=>{
  vi.useFakeTimers();
  const resume=deferred<void>(),stop=vi.fn(),close=vi.fn(async()=>{}),send=vi.fn();
  const track={stop,readyState:'live'},stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
  vi.stubGlobal('window',{});
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:async()=>stream}});
  vi.stubGlobal('AudioContext',class{state='suspended';resume=()=>resume.promise;close=close;});
  const audio=new CameraAudio();let failure='';
  const pending=audio.startMicrophone(8000,send,()=>{},'pcma').catch(error=>{failure=error.message;});
  try{
   await vi.advanceTimersByTimeAsync(0);expect(audio.microphoneActive).toBe(true);
   await vi.advanceTimersByTimeAsync(3000);
   expect(failure).toContain('本机麦克风音频未启动');
   expect(audio.microphoneActive).toBe(false);
   expect(stop).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();expect(send).not.toHaveBeenCalled();
  }finally{audio.dispose();resume.resolve();await pending;}
 });
 it('queues an encoder burst while the first IPC packet is pending',async()=>{
  const first=deferred<void>(),send=vi.fn().mockImplementationOnce(()=>first.promise).mockResolvedValue(undefined),failed=vi.fn();
  let output!:(packet:{byteLength:number;copyTo:(bytes:Uint8Array)=>void})=>void;
  class Encoder{static isConfigSupported=async()=>({supported:true});state='configured';constructor(callback:{output:typeof output}){output=callback.output;}configure(){}close(){this.state='closed';}}
  vi.stubGlobal('window',{AudioEncoder:Encoder,AudioData:class{}});
  const track=Object.assign(new EventTarget(),{stop:vi.fn(),readyState:'live'}),stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:async()=>stream}});
  const node=()=>({connect:vi.fn(),disconnect:vi.fn(),onaudioprocess:null});
  vi.stubGlobal('AudioContext',class extends EventTarget{state='running';resume=async()=>{};close=async()=>{};createMediaStreamSource=node;createScriptProcessor=node;destination={};});
  const audio=new CameraAudio();await audio.startMicrophone(16000,send,failed);
  for(let n=0;n<3;n++)output({byteLength:1,copyTo:bytes=>bytes.fill(n)});
  expect(send).toHaveBeenCalledOnce();first.resolve();await vi.waitFor(()=>expect(send).toHaveBeenCalledTimes(3));
  expect(failed).not.toHaveBeenCalled();audio.dispose();expect(audio.microphoneActive).toBe(false);
 });
});
