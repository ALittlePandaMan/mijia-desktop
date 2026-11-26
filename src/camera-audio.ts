import {encodePcma} from './camera-pcma';
import {CameraMicrophoneFrames} from './camera-microphone-frames';
import {CameraVoiceActivity} from './camera-voice-activity';
import {decodeCameraPacket} from './camera-packet';
import type{CameraEvent}from './camera-types';
interface DecodedAudio{numberOfFrames:number;numberOfChannels:number;sampleRate:number;copyTo(target:Float32Array,options:{planeIndex:number;format:string}):void;close():void}
interface Decoder{configure(config:object):void;decode(chunk:unknown):void;close():void;state:string;decodeQueueSize:number}
interface EncodedPacket{byteLength:number;copyTo(destination:Uint8Array):void}
interface Encoder{configure(config:object):void;encode(data:{close():void}):void;close():void;state:string;encodeQueueSize?:number}
interface AudioCodecs{AudioDecoder:new(callbacks:{output:(data:DecodedAudio)=>void;error:(error:Error)=>void})=>Decoder;EncodedAudioChunk:new(init:object)=>unknown;AudioEncoder:{new(callbacks:{output:(packet:EncodedPacket)=>void;error:(error:Error)=>void}):Encoder;isConfigSupported(config:object):Promise<{supported:boolean}>};AudioData:new(init:object)=>{close():void}}

const MAX_AUDIO_DATA=64*1024;
const AUDIO_START_TIMEOUT=2000;
const AUDIO_RESUME_TIMEOUT=3000;
const AUDIO_DECODE_FAILED='摄像机音轨解码失败。';
const BUFFERED_AUDIO_LIMIT=26;
const LIVE_AUDIO_LIMIT=.7;

function startAudioContext(context:AudioContext,signal:AbortSignal,message:string):Promise<void>{
 return new Promise((resolve,reject)=>{
  const unavailable=()=>finish(Error(message));
  const cancelled=()=>finish(signal.reason);
  const timer=setTimeout(unavailable,AUDIO_RESUME_TIMEOUT);
  function finish(error?:unknown){
   clearTimeout(timer);
   signal.removeEventListener('abort',cancelled);
   if(error)reject(error);else resolve();
  }
  signal.addEventListener('abort',cancelled,{once:true});
  try{void context.resume().then(()=>{if(context.state==='running')finish();else unavailable();},unavailable);}
  catch{unavailable();}
 });
}

/** Camera listening never opens the local microphone. */
export class CameraAudio{
 decoded=0;
 get microphoneActive():boolean{return !!this.microphone?.getAudioTracks().some(track=>track.readyState==='live');}
 get microphoneSpeaking():boolean{return this.voice?.speaking??false;}
 private context?:AudioContext;
 private gain?:GainNode;
 private decoder?:Decoder;
 private decoderTimestamp=0;
 private next=0;
 private readonly outputSources=new Set<AudioBufferSourceNode>();
 private outputError?:string;
 private finishFirstOutput?:(error?:string)=>void;
 private outputLifetime?:AbortController;
 private source?:MediaStreamAudioSourceNode;private processor?:ScriptProcessorNode;private microphone?:MediaStream;private sending=false;private epoch=0;
 private microphoneContext?:AudioContext;private encoder?:Encoder;private voice?:CameraVoiceActivity;private microphoneEvents?:AbortController;
 private microphoneQueue:string[]=[];
 private playbackBuffered=false;private playbackPaused=false;
 setPlaybackBuffered(buffered:boolean):void{this.playbackBuffered=buffered;}
 async pausePlayback():Promise<void>{
  this.playbackPaused=true;
  await this.context?.suspend();
 }
 async resumePlayback():Promise<void>{
  this.playbackPaused=false;
  if(this.context)await this.resumeOutput(this.context);
 }
 private resumeOutput(context:AudioContext):Promise<void>{
  const lifetime=this.outputLifetime??=new AbortController();
  return startAudioContext(context,lifetime.signal,'本机声音输出未启动，请检查 Windows 声音输出设备。');
 }
 async listen(enabled:boolean):Promise<void>{
  if(!enabled){this.closeListening();return;}
  const context=this.context??=new AudioContext();
  if(!this.gain){this.gain=context.createGain();this.gain.connect(context.destination);}
  // Request playback while the original button press still has user activation.
  await this.resumeOutput(context);
 }
 waitForOutput():Promise<void>{
  if(this.decoded)return Promise.resolve();
  if(!this.context)return Promise.reject(Error('声音已关闭。'));
  return new Promise((resolve,reject)=>{
   const finish=(error?:string)=>{
    clearTimeout(timer);
    this.finishFirstOutput=undefined;
    if(error)reject(Error(error));
    else resolve();
   };
   const timer=setTimeout(()=>finish(this.outputError??'没有收到可播放的摄像机音频。'),AUDIO_START_TIMEOUT);
   this.finishFirstOutput=finish;
  });
 }
 receive(event:CameraEvent,played:()=>void):void{
  if(!this.context||!event.data||!event.codec)return;
  if(event.data.length>MAX_AUDIO_DATA){this.outputError=AUDIO_DECODE_FAILED;return;}
  try{
   const bytes=decodeCameraPacket(event.data);
   if(event.codec==='opus'){
    this.receiveOpus(bytes,played);
    return;
   }
   const rate=event.sampleRate??8000,codec=event.codec;
   if(codec!=='pcm'&&codec!=='pcma'&&codec!=='pcmu'){
    this.outputError='摄像机返回了尚未支持的音轨编码。';
    return;
   }
   if(codec==='pcm'&&bytes.length%2!==0)throw Error(AUDIO_DECODE_FAILED);
   const samples=new Float32Array(codec==='pcm'?bytes.length/2:bytes.length);
   const pcm=codec==='pcm'?new DataView(bytes.buffer):undefined;
   for(let i=0;i<samples.length;i++){
    let sample:number;
    if(pcm)sample=pcm.getInt16(i*2,true);
    else if(codec==='pcma'){const a=bytes[i]^0x55,segment=(a&0x70)>>4;let v=(a&15)<<4;v=segment===0?v+8:segment===1?v+0x108:(v+0x108)<<(segment-1);sample=(a&0x80)?v:-v;}
    else{const u=(~bytes[i])&255;const v=(((u&15)<<3)+0x84)<<((u&0x70)>>4);sample=(u&128)?0x84-v:v-0x84;}
    samples[i]=sample/32768;
   }
   this.schedule([samples],rate,played);
  }catch{
   if(event.codec==='opus')this.clearDecoder();
   this.outputError=AUDIO_DECODE_FAILED;
  }
 }
 private receiveOpus(bytes:Uint8Array,played:()=>void):void{
  const codecs=window as unknown as AudioCodecs;
  if(!codecs.AudioDecoder||!codecs.EncodedAudioChunk){
   this.outputError='当前系统视频组件不支持摄像机的 Opus 音轨。';
   return;
  }
  if(!this.decoder){
   const decoder=new codecs.AudioDecoder({
    output:frame=>{
     try{
      if(this.decoder!==decoder)return;
      if(![1,2].includes(frame.numberOfChannels))throw Error(AUDIO_DECODE_FAILED);
      const channels=Array.from({length:frame.numberOfChannels},(_,planeIndex)=>{
       const samples=new Float32Array(frame.numberOfFrames);
       frame.copyTo(samples,{planeIndex,format:'f32-planar'});
       return samples;
      });
      this.schedule(channels,frame.sampleRate,played);
     }catch{this.outputError=AUDIO_DECODE_FAILED;}
     finally{frame.close();}
    },
    error:()=>{
     if(this.decoder!==decoder)return;
     this.clearDecoder();
     this.outputError=AUDIO_DECODE_FAILED;
    },
   });
   this.decoder=decoder;
   decoder.configure({codec:'opus',sampleRate:48000,numberOfChannels:2});
  }
  if(this.decoder.decodeQueueSize>=64)return;
  // Some cameras send an unsigned timestamp that cannot be passed to WebCodecs.
  // Output is scheduled using the decoded sample counts, so use a local clock here.
  this.decoderTimestamp=Math.max(this.decoderTimestamp+1,Math.round(performance.now()*1000));
  this.decoder.decode(new codecs.EncodedAudioChunk({type:'key',timestamp:this.decoderTimestamp,data:bytes}));
 }
 private schedule(channels:Float32Array<ArrayBuffer>[],rate:number,played:()=>void):void{
  const context=this.context,frames=channels[0].length;
  if(!context||!this.gain||!frames)return;
  const buffered=this.playbackBuffered||this.playbackPaused;
  const start=Math.max(context.currentTime+.06,this.next);
  // Skip excess live backlog instead of scheduling overlapping sound. SD playback
  // keeps a longer window for the existing video prefetch and pause behavior.
  if(start-context.currentTime+frames/rate>(buffered?BUFFERED_AUDIO_LIMIT:LIVE_AUDIO_LIMIT)||
     this.outputSources.size>=(buffered?2048:192))return;
  const buffer=context.createBuffer(channels.length,frames,rate);
  channels.forEach((samples,index)=>buffer.copyToChannel(samples,index));
  const source=context.createBufferSource();
  source.buffer=buffer;
  source.connect(this.gain);
  try{source.start(start);}catch(error){source.disconnect();throw error;}
  this.next=start+buffer.duration;
  this.outputSources.add(source);
  source.onended=()=>{this.outputSources.delete(source);source.disconnect();};
  this.outputError=undefined;
  this.decoded++;
  this.finishFirstOutput?.();
  played();
 }
 async startMicrophone(rate:number,send:(pcm:string)=>Promise<void>,failed:(message:string)=>void,codec='opus',activity?:(speaking:boolean)=>void):Promise<void>{
  this.stopMicrophone();const epoch=this.epoch;
  const codecs=window as unknown as AudioCodecs,config={codec:'opus',sampleRate:rate,numberOfChannels:1,bitrate:32000,opus:{frameDuration:20000}};
  if(![8000,16000].includes(rate))throw Error('此摄像头的麦克风采样格式尚未支持。');
  if(!['opus','pcma'].includes(codec))throw Error('尚未支持此摄像机的麦克风编码。');
  if(codec==='opus'&&(!codecs.AudioEncoder||!codecs.AudioData||!(await codecs.AudioEncoder.isConfigSupported(config)).supported))throw Error('当前系统视频组件 不支持此摄像机需要的 Opus 麦克风编码。');
  if(epoch!==this.epoch)return;
  if(!navigator.mediaDevices?.getUserMedia)throw Error('当前系统视频组件 无法申请麦克风，请确认系统麦克风权限后重试。');
  try{
  const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
  if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return;}
  this.microphone=stream;if(!this.microphoneActive)throw Error('没有取得可用的麦克风音轨。');
  // Capture at the browser/device rate; convert before encoding instead of
  // rejecting 44.1/48kHz hardware or forcing a low-rate hardware context.
  this.microphoneEvents=new AbortController();const signal=this.microphoneEvents.signal;
  const context=new AudioContext();this.microphoneContext=context;
  await startAudioContext(context,signal,'本机麦克风音频未启动，请检查 Windows 麦克风输入设备。');
  if(epoch!==this.epoch)return;
  this.source=context.createMediaStreamSource(stream);this.processor=context.createScriptProcessor(1024,1,1);let samples=0;
  if(activity)this.voice=new CameraVoiceActivity(speaking=>{if(epoch===this.epoch)activity(speaking);});
  context.addEventListener('statechange',()=>{if(epoch===this.epoch&&context.state!=='running')this.voice?.reset();},{signal});
  const enqueue=(bytes:Uint8Array)=>{if(epoch!==this.epoch)return;let binary='';bytes.forEach(b=>binary+=String.fromCharCode(b));this.microphoneQueue.push(btoa(binary));if(this.microphoneQueue.length>12){this.stopMicrophone();failed('麦克风发送未及时完成，通话已结束。');return;}if(this.sending)return;this.sending=true;void(async()=>{try{while(epoch===this.epoch&&this.microphoneQueue.length){await send(this.microphoneQueue.shift()!);}}catch(e){if(epoch===this.epoch){this.stopMicrophone();failed((e as Error)?.message??'麦克风发送中断。');}}finally{if(epoch===this.epoch)this.sending=false;}})();};
  const fail=(message:string)=>{if(epoch===this.epoch){this.stopMicrophone();failed(message);}};
  for(const track of stream.getAudioTracks()){track.addEventListener('ended',()=>fail('麦克风已断开，通话已结束。'),{once:true,signal});track.addEventListener('mute',()=>{if(epoch===this.epoch)this.voice?.reset();},{signal});}
  if(codec==='opus'){this.encoder=new codecs.AudioEncoder({output:packet=>{if(epoch!==this.epoch)return;const bytes=new Uint8Array(packet.byteLength);packet.copyTo(bytes);enqueue(bytes);},error:e=>fail(e.message)});this.encoder.configure(config);}
  const frames=new CameraMicrophoneFrames(rate,input=>{
   if(epoch!==this.epoch)return;this.voice?.push(input,rate);if(codec==='pcma'){enqueue(encodePcma(input));return;}
   if((this.encoder?.encodeQueueSize??0)>8){fail('本机音频编码未及时完成，通话已结束。');return;}
   const frame=new codecs.AudioData({format:'f32-planar',sampleRate:rate,numberOfFrames:input.length,numberOfChannels:1,timestamp:Math.round(samples*1000000/rate),data:input});samples+=input.length;try{this.encoder!.encode(frame);}finally{frame.close();}
  });
  this.processor.onaudioprocess=event=>{
   if(epoch!==this.epoch||codec==='opus'&&!this.encoder)return;
   try{frames.push(event.inputBuffer.getChannelData(0),event.inputBuffer.sampleRate);}catch(error){fail(microphoneError(error));}
  };
  this.source.connect(this.processor);this.processor.connect(this.microphoneContext.destination);
  }catch(error){if(epoch!==this.epoch)return;this.stopMicrophone();throw Error(microphoneError(error));}
 }
 stopMicrophone():void{this.microphoneEvents?.abort();this.microphoneEvents=undefined;this.voice?.reset();this.voice=undefined;++this.epoch;this.microphoneQueue=[];this.sending=false;this.processor?.disconnect();if(this.processor)this.processor.onaudioprocess=null;this.processor=undefined;this.source?.disconnect();this.source=undefined;this.microphone?.getTracks().forEach(t=>t.stop());this.microphone=undefined;if(this.encoder?.state!=='closed')this.encoder?.close();this.encoder=undefined;
  const context=this.microphoneContext;this.microphoneContext=undefined;
  if(context&&context.state!=='closed')void context.close().catch(()=>{});
 }
 private clearDecoder():void{
  const decoder=this.decoder;
  this.decoder=undefined;
  this.decoderTimestamp=0;
  if(decoder&&decoder.state!=='closed')decoder.close();
 }
 clearPlayback():void{
  this.clearDecoder();
  for(const source of this.outputSources){
   source.onended=null;
   source.stop();
   source.disconnect();
  }
  this.outputSources.clear();
  this.next=0;
  this.outputError=undefined;
 }
 closeListening():void{
  this.outputLifetime?.abort(Error('声音已关闭。'));
  this.outputLifetime=undefined;
  this.finishFirstOutput?.('声音已关闭。');
  this.clearPlayback();
  this.decoded=0;
  this.gain?.disconnect();
  this.gain=undefined;
  const context=this.context;
  this.context=undefined;
  if(context&&context.state!=='closed')void context.close().catch(()=>{});
 }
 dispose():void{this.playbackBuffered=this.playbackPaused=false;this.stopMicrophone();this.closeListening();}
}
function microphoneError(error:unknown):string{
 const name=(error as {name?:string})?.name;
 if(name==='NotAllowedError'||name==='SecurityError')return '麦克风访问被拒绝。请允许本应用使用麦克风，并检查 Windows“隐私和安全性 → 麦克风”中的桌面应用权限。';
 if(name==='NotFoundError')return '未找到麦克风，请连接或启用录音设备后重试。';
 if(name==='NotReadableError'||name==='AbortError')return '麦克风暂时无法使用，请检查设备是否被占用或已断开。';
 return (error as Error)?.message??'麦克风启动失败，请检查录音设备和权限。';
}
