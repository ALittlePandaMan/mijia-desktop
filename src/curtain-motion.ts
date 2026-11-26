import {PositionMotion,type PositionReading} from './position-motion';
import type {CurtainCommand} from './curtain-detail';
export type CurtainReading=PositionReading;

type CurtainSelection = Pick<PositionReading,'position'|'status'|'revision'|'pending'|'outcome'> & {
 intent?:CurtainCommand;
 explicitlyPaused?:boolean;
};

/** Curtains share the same local position timeline as the airer. */
export class CurtainMotion extends PositionMotion{
 private pauseRevision?:number;
 private confirmedPause=false;

 selectCommand(reading?:CurtainSelection):CurtainCommand|undefined {
  if(!reading){
   this.pauseRevision=undefined;
   this.confirmedPause=false;
   return;
  }
  const {intent,position,status,revision,pending,outcome,explicitlyPaused}=reading;
  if(pending){
   this.pauseRevision=intent==='pause'?revision:undefined;
   if(intent)return intent;
  }
  if(!pending&&this.pauseRevision!==undefined){
   if(revision===this.pauseRevision&&outcome==='confirmed')this.confirmedPause=true;
   this.pauseRevision=undefined;
  }
  const atLimit=position===0||position===100;
  const direction=status===1&&position!==100?'open':status===2&&position!==0?'close':undefined;
  if(atLimit||direction||outcome==='confirmed'&&intent!=='pause')this.confirmedPause=false;
  if(direction)return direction;
  if(!atLimit&&(explicitlyPaused||this.confirmedPause))return 'pause';
  if(status===undefined&&outcome==='confirmed'&&this.local&&this.moving){
   if(intent==='open'&&position!==100)return intent;
   if(intent==='close'&&position!==0)return intent;
  }
 }

 override reset(){
  super.reset();
  this.selectCommand();
 }

 attach(node:HTMLElement,key:string,r:CurtainReading,paint?:(value:number,target:number)=>void,finished?:()=>void){
  this.update(key,r);this.attachPosition(node,(value,target)=>{node.style.setProperty('--openness',`${value}%`);node.dataset.openness=value.toFixed(2);paint?.(value,target);},finished);
 }
}
