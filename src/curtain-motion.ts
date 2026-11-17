import {PositionMotion,type PositionReading} from './position-motion';
export type CurtainReading=PositionReading;
/** Curtains share the same local position timeline as the airer. */
export class CurtainMotion extends PositionMotion{
 attach(node:HTMLElement,key:string,r:CurtainReading,paint?:(value:number,target:number)=>void,finished?:()=>void){
  this.update(key,r);this.attachPosition(node,(value,target)=>{node.style.setProperty('--openness',`${value}%`);node.dataset.openness=value.toFixed(2);paint?.(value,target);},finished);
 }
}
