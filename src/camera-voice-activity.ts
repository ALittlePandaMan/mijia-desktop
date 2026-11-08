/** Local energy gate for a visual indicator, not speech recognition or delivery
 * confirmation. Consumes the existing mono 20ms capture without retaining it. */
export class CameraVoiceActivity{
 speaking=false;
 private floor=.003;private attack=0;private quiet=0;
 constructor(private changed:(speaking:boolean)=>void){}
 push(samples:Float32Array,rate:number):void{
  if(!samples.length)return;
  let sum=0,square=0;
  for(const sample of samples){sum+=sample;square+=sample*sample;}
  // Remove DC offset so a biased input does not look like sustained speech.
  const mean=sum/samples.length,rms=Math.sqrt(Math.max(0,square/samples.length-mean*mean));
  const ms=Math.min(40,samples.length*1000/rate);
  const open=Math.max(.012,this.floor*3.2),hold=Math.max(.007,this.floor*1.8);
  if(!this.speaking){
   if(rms>=open){this.attack+=ms;if(this.attack>=40){this.attack=0;this.quiet=0;this.set(true);}}
   else{this.attack=0;const blend=1-Math.exp(-ms/(rms<this.floor?300:1500));this.floor=Math.max(.001,Math.min(.02,this.floor+(rms-this.floor)*blend));}
  }else if(rms<hold){this.quiet+=ms;if(this.quiet>=240){this.quiet=0;this.set(false);}}
  else this.quiet=0;
 }
 reset():void{this.attack=this.quiet=0;this.floor=.003;this.set(false);}
 private set(speaking:boolean):void{if(speaking===this.speaking)return;this.speaking=speaking;this.changed(speaking);}
}
