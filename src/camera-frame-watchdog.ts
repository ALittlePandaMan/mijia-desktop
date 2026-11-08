/** Transport packets can continue arriving even when MSE produces no frames. */
export class CameraFrameWatchdog {
 private timer?:ReturnType<typeof setTimeout>;
 private armed=false;
 constructor(private stalled:()=>void,private timeoutMs=25000){}
 data():void{if(!this.armed){this.armed=true;this.arm();}}
 frame():void{if(this.armed)this.arm();}
 private arm():void{if(this.timer!==undefined)clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=undefined;this.armed=false;this.stalled();},this.timeoutMs);}
 reset():void{if(this.timer!==undefined)clearTimeout(this.timer);this.timer=undefined;this.armed=false;}
}
