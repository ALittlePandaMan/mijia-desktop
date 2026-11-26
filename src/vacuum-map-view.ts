/** Screen-relative pan keeps the same view when the window or map frame changes. */
export class VacuumMapViewport {
 scale=1;x=0;y=0;
 reset():void{this.scale=1;this.x=this.y=0;}
 pan(x:number,y:number):void{if(!Number.isFinite(x)||!Number.isFinite(y))return;this.x+=x;this.y+=y;this.constrain();}
 zoom(factor:number,x=0,y=0):void{
  if(!Number.isFinite(factor)||factor<=0||![x,y].every(Number.isFinite))return;
  const next=Math.max(.85,Math.min(6,this.scale*factor)),ratio=next/this.scale;
  this.x=x-(x-this.x)*ratio;this.y=y-(y-this.y)*ratio;this.scale=next;this.constrain();
 }
 private constrain():void{const limit=(this.scale-1)/2+.3;this.x=Math.max(-limit,Math.min(limit,this.x));this.y=Math.max(-limit,Math.min(limit,this.y));}
}
