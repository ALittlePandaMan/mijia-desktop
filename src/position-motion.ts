import {backgroundWork} from './background-work';
export interface PositionReading{position?:number;target?:number;status?:number;journey?:number;pending?:boolean;revision?:number;outcome?:'confirmed'|'rejected'}
const valid=(n:number|undefined):n is number=>n!==undefined&&Number.isFinite(n)&&n>=0&&n<=100;
/** A local operation owns a single timeline until its physical position is
 * confirmed. Target acknowledgements and delayed polls cannot restart it. */
export class PositionMotion{
 private key='';private from=100;private to=100;private started=0;private duration=0;private previous?:PositionReading;private held=false;private frame=0;private owned=false;private revision=-1;private serial=0;private completed=-1;private redraw?:()=>void;private resourceCleanup?:()=>void;
 constructor(private now=()=>performance.now()){}
 get moving(){return this.duration>0&&this.now()<this.started+this.duration;}
 get target(){return this.to;}
 get generation(){return this.serial;}
 get local(){return this.owned;}
 position(){const t=this.duration?Math.min(1,Math.max(0,(this.now()-this.started)/this.duration)):1;return this.from+(this.to-this.from)*t;}
 private move(to:number,duration:number){++this.serial;this.from=this.position();this.to=to;this.started=this.now();this.duration=duration;if(this.redraw&&!backgroundWork.paused){globalThis.cancelAnimationFrame?.(this.frame);this.frame=requestAnimationFrame(this.redraw);}}
 start(key:string,r:PositionReading){this.update(key,{...r,pending:true,revision:key===this.key?this.revision+1:0});}
 reconcile(position:number,force=false){if(valid(position)&&(force||!this.moving)){this.owned=false;this.held=false;this.move(position,Math.abs(position-this.position())>.1?400:0);}}
 pause(){this.move(this.position(),0);this.held=true;this.owned=true;}
 detach(){this.resourceCleanup?.();this.resourceCleanup=undefined;globalThis.cancelAnimationFrame?.(this.frame);this.frame=0;this.redraw=undefined;}
 reset(){this.detach();++this.serial;this.key='';this.previous=undefined;this.duration=0;this.held=false;this.owned=false;this.revision=-1;}
 update(key:string,r:PositionReading){
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
 attachPosition(node:HTMLElement,paint:(value:number,target:number)=>void,finished?:()=>void){
  this.detach();const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const draw=()=>{if(!node.isConnected||backgroundWork.paused)return;const value=reduced?this.to:this.position();paint(value,this.to);node.dataset.animating=String(!reduced&&this.moving);
   if(this.moving)this.frame=requestAnimationFrame(draw);
   else if(this.duration>0&&this.owned&&this.completed!==this.serial){this.completed=this.serial;finished?.();}
  };
  this.resourceCleanup=backgroundWork.subscribe(paused=>{cancelAnimationFrame(this.frame);if(!paused&&node.isConnected)this.frame=requestAnimationFrame(draw);});this.redraw=draw;paint(reduced?this.to:this.position(),this.to);this.frame=requestAnimationFrame(draw);
 }
}
