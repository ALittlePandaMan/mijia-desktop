/** Delay only an empty loading surface. Cached/quick content appears at once;
 * an already visible loader stays long enough not to flash for a single frame. */
export class DeviceOpening {
 waiting=false;
 showing=false;
 private started=0;
 private epoch=0;
 private timer:ReturnType<typeof setTimeout>|undefined;
 constructor(private changed:()=>void,private delay=140,private minimum=180){}
 get hidden():boolean{return this.waiting&&!this.showing;}
 begin():void{this.cancel();this.waiting=true;const epoch=this.epoch;this.timer=setTimeout(()=>{if(epoch!==this.epoch)return;this.showing=true;this.started=Date.now();this.changed();},this.delay);}
 ready():void{if(!this.waiting)return;clearTimeout(this.timer);const remaining=this.showing?Math.max(0,this.minimum-(Date.now()-this.started)):0,epoch=this.epoch;const finish=()=>{if(epoch!==this.epoch)return;this.waiting=false;this.showing=false;this.timer=undefined;this.changed();};if(remaining)this.timer=setTimeout(finish,remaining);else finish();}
 cancel():void{clearTimeout(this.timer);this.timer=undefined;this.epoch++;this.waiting=false;this.showing=false;}
}
