import {encodePcma} from './camera-pcma';
import {CameraMicrophoneFrames} from './camera-microphone-frames';
import {CameraVoiceActivity} from './camera-voice-activity';
import type{CameraEvent}from './camera-types';
interface DecodedAudio{numberOfFrames:number;numberOfChannels:number;sampleRate:number;copyTo(target:Float32Array,options:{planeIndex:number;format:string}):void;close():void}
interface Decoder{configure(config:object):void;decode(chunk:unknown):void;close():void;state:string}
interface EncodedPacket{byteLength:number;copyTo(destination:Uint8Array):void}
interface Encoder{configure(config:object):void;encode(data:{close():void}):void;close():void;state:string;encodeQueueSize?:number}
interface AudioCodecs{AudioDecoder:new(callbacks:{output:(data:DecodedAudio)=>void;error:(error:Error)=>void})=>Decoder;EncodedAudioChunk:new(init:object)=>unknown;AudioEncoder:{new(callbacks:{output:(packet:EncodedPacket)=>void;error:(error:Error)=>void}):Encoder;isConfigSupported(config:object):Promise<{supported:boolean}>};AudioData:new(init:object)=>{close():void}}
/** Camera listening never opens the local microphone. */
export class CameraAudio{
 decoded=0;
 get microphoneActive():boolean{return !!this.microphone?.getAudioTracks().some(track=>track.readyState==='live');}
 get microphoneSpeaking():boolean{return this.voice?.speaking??false;}
 private context?:AudioContext;private gain?:GainNode;private decoder?:Decoder;private next=0;private source?:MediaStreamAudioSourceNode;private processor?:ScriptProcessorNode;private microphone?:MediaStream;private sending=false;private epoch=0;
 private microphoneContext?:AudioContext;private encoder?:Encoder;private voice?:CameraVoiceActivity;private microphoneEvents?:AbortController;
 private microphoneQueue:string[]=[];
 private playbackBuffered=false;private playbackPaused=false;
 setPlaybackBuffered(buffered:boolean):void{this.playbackBuffered=buffered;}
 async pausePlayback():Promise<void>{this.playbackPaused=true;await this.context?.suspend();}
 async resumePlayback():Promise<void>{await this.context?.resume();this.playbackPaused=false;}
 async listen(enabled:boolean):Promise<void>{
  if(!enabled){this.closeListening();return;}
  this.context??=new AudioContext();if(!this.gain){this.gain=this.context.createGain();this.gain.connect(this.context.destination);}
  await this.context.resume();
 }
 receive(event:CameraEvent,error:(message:string)=>void):void{
  if(!this.context||!event.data||!event.codec)return;
  const bytes=Uint8Array.from(atob(event.data),c=>c.charCodeAt(0)),rate=event.sampleRate??8000;
  if(event.codec==='opus'){
   const codecs=window as unknown as AudioCodecs;if(!codecs.AudioDecoder){error('当前系统视频组件 不支持摄像机的 Opus 音轨。');return;}
   try{
    if(!this.decoder){this.decoder=new codecs.AudioDecoder({output:frame=>{try{const samples=new Float32Array(frame.numberOfFrames);frame.copyTo(samples,{planeIndex:0,format:'f32-planar'});this.schedule(samples,frame.sampleRate);}finally{frame.close();}},error:e=>error(e.message)});this.decoder.configure({codec:'opus',sampleRate:rate,numberOfChannels:1});}
    this.decoder.decode(new codecs.EncodedAudioChunk({type:'key',timestamp:(event.timestamp??0)*1000,data:bytes}));
   }catch{error('摄像机音轨解码失败。');}
  }else{
   const samples=new Float32Array(event.codec==='pcm'?Math.floor(bytes.length/2):bytes.length);
   for(let i=0;i<samples.length;i++){
    let sample=0;
    if(event.codec==='pcm'){sample=new DataView(bytes.buffer).getInt16(i*2,true);}
    else if(event.codec==='pcma'){const a=bytes[i]^0x55,segment=(a&0x70)>>4;let v=(a&15)<<4;v=segment===0?v+8:segment===1?v+0x108:(v+0x108)<<(segment-1);sample=(a&0x80)?v:-v;}
    else if(event.codec==='pcmu'){const u=(~bytes[i])&255;const v=(((u&15)<<3)+0x84)<<((u&0x70)>>4);sample=(u&128)?0x84-v:v-0x84;}
    else{error('摄像机返回了尚未支持的音轨编码。');return;}
    samples[i]=sample/32768;
   }this.schedule(samples,rate);
  }
 }
 private schedule(samples:Float32Array,rate:number):void{
  const context=this.context;if(!context||!this.gain||samples.length===0)return;
  this.decoded++;const buffer=context.createBuffer(1,samples.length,rate);buffer.copyToChannel(new Float32Array(samples),0);const source=context.createBufferSource();source.buffer=buffer;source.connect(this.gain);
  // SD audio must retain the same queued time as the paused video. Live listening
  // still trims latency; clamping a paused SD queue would overlap later packets.
  this.next=Math.max(context.currentTime+.06,this.playbackBuffered||this.playbackPaused?this.next:Math.min(this.next,context.currentTime+.7));source.start(this.next);this.next+=buffer.duration;source.onended=()=>source.disconnect();
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
  const context=new AudioContext();this.microphoneContext=context;await context.resume();
  if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return;}
  this.source=context.createMediaStreamSource(stream);this.processor=context.createScriptProcessor(1024,1,1);let samples=0;
  this.microphoneEvents=new AbortController();const signal=this.microphoneEvents.signal;
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
 stopMicrophone():void{this.microphoneEvents?.abort();this.microphoneEvents=undefined;this.voice?.reset();this.voice=undefined;++this.epoch;this.microphoneQueue=[];this.sending=false;this.processor?.disconnect();if(this.processor)this.processor.onaudioprocess=null;this.processor=undefined;this.source?.disconnect();this.source=undefined;this.microphone?.getTracks().forEach(t=>t.stop());this.microphone=undefined;if(this.encoder?.state!=='closed')this.encoder?.close();this.encoder=undefined;void this.microphoneContext?.close();this.microphoneContext=undefined;}
 closeListening():void{if(this.decoder?.state!=='closed')this.decoder?.close();this.decoder=undefined;this.gain?.disconnect();this.gain=undefined;this.next=0;if(!this.microphone){void this.context?.close();this.context=undefined;}}
 clearPlayback():void{if(this.decoder?.state!=='closed')this.decoder?.close();this.decoder=undefined;this.gain?.disconnect();this.gain=undefined;this.next=0;if(this.context){this.gain=this.context.createGain();this.gain.connect(this.context.destination);}}
 dispose():void{this.playbackBuffered=this.playbackPaused=false;this.stopMicrophone();this.closeListening();}
}
function microphoneError(error:unknown):string{
 const name=(error as {name?:string})?.name;
 if(name==='NotAllowedError'||name==='SecurityError')return '麦克风访问被拒绝。请允许本应用使用麦克风，并检查 Windows“隐私和安全性 → 麦克风”中的桌面应用权限。';
 if(name==='NotFoundError')return '未找到麦克风，请连接或启用录音设备后重试。';
 if(name==='NotReadableError'||name==='AbortError')return '麦克风暂时无法使用，请检查设备是否被占用或已断开。';
 return (error as Error)?.message??'麦克风启动失败，请检查录音设备和权限。';
}
