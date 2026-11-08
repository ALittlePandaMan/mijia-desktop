export interface CurtainReading{position?:number;target?:number;status?:number;journey?:number;pending?:boolean;revision?:number;outcome?:'confirmed'|'rejected'}
const valid=(n:number|undefined):n is number=>n!==undefined&&Number.isFinite(n)&&n>=0&&n<=100;
/** A local operation owns a single timeline until its physical position is
 * confirmed. Target acknowledgements and delayed polls cannot restart it. */
export class CurtainMotion{
 private key='';private from=100;private to=100;private started=0;private duration=0;private previous?:CurtainReading;private held=false;private frame=0;private owned=false;private revision=-1;
 constructor(private now=()=>performance.now()){}
 get moving(){return this.duration>0&&this.now()<this.started+this.duration;}
 get target(){return this.to;}
 position(){const t=this.duration?Math.min(1,Math.max(0,(this.now()-this.started)/this.duration)):1;return this.from+(this.to-this.from)*t;}
 private move(to:number,duration:number){this.from=this.position();this.to=to;this.started=this.now();this.duration=duration;}
 pause(){this.move(this.position(),0);this.held=true;this.owned=true;}
 detach(){globalThis.cancelAnimationFrame?.(this.frame);this.frame=0;}
 reset(){globalThis.cancelAnimationFrame?.(this.frame);this.frame=0;this.key='';this.previous=undefined;this.duration=0;this.held=false;this.owned=false;this.revision=-1;}
 update(key:string,r:CurtainReading){
  if(key!==this.key){this.key=key;this.previous=undefined;this.from=this.to=valid(r.position)?r.position:100;this.duration=0;this.held=false;this.owned=false;this.revision=-1;}
  const old=this.previous,newIntent=r.revision!==undefined?r.revision>this.revision:!!r.pending&&(!old?.pending||r.target!==old.target);
  if(newIntent&&r.pending&&valid(r.target)){
   this.revision=r.revision??this.revision+1;this.owned=true;this.held=false;const seconds=typeof r.journey==='number'&&Number.isFinite(r.journey)&&r.journey>0?r.journey:8;
   this.move(r.target,Math.min(300000,seconds*1000*Math.abs(r.target-this.position())/100));
  }else if(this.owned){
   if(r.outcome==='rejected'&&r.revision===this.revision&&valid(r.position)){this.owned=false;this.held=false;this.move(r.position,400);}
   else if(newIntent&&r.revision!==undefined&&!r.pending&&valid(r.position)){this.revision=r.revision;this.owned=false;this.held=false;this.move(r.position,400);}
   else if(!this.moving&&valid(r.position)&&Math.abs(r.position-this.to)<.5){this.owned=false;this.held=false;}
  }else if(!this.held){
   const changed=!old||old.position!==r.position||old.status!==r.status||old.target!==r.target;
   if((r.status===1||r.status===2)&&valid(r.target)&&changed&&(!this.moving||r.target!==this.to)){const seconds=r.journey&&r.journey>0?r.journey:8;this.move(r.target,seconds*1000*Math.abs(r.target-this.position())/100);}
   else if(valid(r.position)&&changed&&r.status!==1&&r.status!==2)this.move(r.position,old?400:0);
  }
  this.previous={...r};return this.position();
 }
 attach(node:HTMLElement,key:string,r:CurtainReading,paint?:(value:number,target:number)=>void){
  cancelAnimationFrame(this.frame);this.update(key,r);const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const draw=()=>{if(!node.isConnected)return;const value=reduced?this.to:this.position();node.style.setProperty('--openness',`${value}%`);node.dataset.openness=value.toFixed(2);node.dataset.animating=String(!reduced&&this.moving);paint?.(value,this.to);if(!reduced&&this.moving)this.frame=requestAnimationFrame(draw);};
  const initial=reduced?this.to:this.position();node.style.setProperty('--openness',`${initial}%`);node.dataset.openness=initial.toFixed(2);paint?.(initial,this.to);this.frame=requestAnimationFrame(draw);
 }
}
