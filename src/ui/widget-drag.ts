import {cancelCardPress} from './card-press';
/** Windows owns hold, movement and release independently of WebView focus. */
export class WidgetDrag{
 constructor(_widgetId:string){}
 private card?:HTMLElement;private suppressedUntil=0;private disposed=false;private rebound?:Animation;
 get suppressOpen(){return performance.now()<this.suppressedUntil;}
 get active(){return this.suppressedUntil===Infinity;}
 native(phase:string,_kind:'move'='move'){
  if(this.disposed)return;
  if(phase==='started'){this.stopRebound();this.suppressedUntil=Infinity;if(this.card){cancelCardPress(this.card);this.card.classList.add('widget-moving');}}
  else{this.card?.classList.remove('widget-moving');if(phase==='ended'){
   this.suppressedUntil=performance.now()+500;
   this.stopRebound();
   if(this.card&&!matchMedia('(prefers-reduced-motion: reduce)').matches){const animation=this.card.animate([{transform:'scale(.985)'},{transform:'scale(1)'}],{duration:300,easing:'cubic-bezier(.2,.8,.2,1)'});this.rebound=animation;void animation.finished.then(()=>{if(this.rebound===animation)this.rebound=undefined;}).catch(()=>{});}
  }else if(this.suppressedUntil===Infinity)this.suppressedUntil=performance.now()+100;}
 }
 bind(card:HTMLElement,_report:(error:unknown)=>void):void{
  this.card=card;this.disposed=false;
  card.addEventListener('pointerdown',event=>{
   if(event.button!==0||(event.target as Element).closest('.device-shortcut,.card-control,.widget-menu'))return;
   this.stopRebound();
   // Native hit regions own hold/capture. The renderer only retires its press effect.
  });
 }
 reduceMotion(){this.stopRebound();}
 private stopRebound(){this.rebound?.cancel();this.rebound=undefined;}
 dispose(){this.disposed=true;this.stopRebound();this.card?.classList.remove('widget-moving');this.card=undefined;}
}
