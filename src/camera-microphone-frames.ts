/** Streaming mono resampling into exact 20ms frames. No growing capture buffer. */
export class CameraMicrophoneFrames{
 private previous=0;private samples=0;private next=0;private offset=0;private frame:Float32Array;private inputRate=0;
 constructor(private outputRate:number,private emit:(frame:Float32Array)=>void){this.frame=new Float32Array(outputRate/50);}
 push(input:Float32Array,inputRate:number):void{
  if(!Number.isFinite(inputRate)||inputRate<8000||inputRate>192000)throw Error('麦克风返回了不支持的采样率。');
  if(this.inputRate&&this.inputRate!==inputRate)throw Error('麦克风采样率在通话中发生变化，请重新开启通话。');this.inputRate=inputRate;
  for(let i=0;i<input.length;i++){
   const current=this.samples++,value=input[i];
   while(this.next<=current){const ratio=current===0?1:Math.max(0,Math.min(1,this.next-(current-1)));this.frame[this.offset++]=this.previous+(value-this.previous)*ratio;this.next+=inputRate/this.outputRate;if(this.offset===this.frame.length){const ready=this.frame;this.frame=new Float32Array(ready.length);this.offset=0;this.emit(ready);}}
   this.previous=value;
  }
 }
}
