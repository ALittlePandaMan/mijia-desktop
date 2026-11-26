/** A real backdrop press/release cancels; content clicks and drags do not.
 * Native dialog backdrop events target the dialog, so also check its bounds.
 * Listeners belong to this backdrop only and disappear with its DOM node. */
export function dismissOnBackdrop(backdrop:HTMLElement,dismiss:()=>void):void{
 let pointer:number|undefined,startedOutside=false,endedOutside=false;
 const outside=(event:MouseEvent):boolean=>{
  if(event.target!==backdrop)return false;
  if(!(backdrop instanceof HTMLDialogElement))return true;
  const box=backdrop.getBoundingClientRect();
  return event.clientX<box.left||event.clientX>=box.right||event.clientY<box.top||event.clientY>=box.bottom;
 };
 const reset=()=>{pointer=undefined;startedOutside=endedOutside=false;};
 backdrop.addEventListener('pointerdown',event=>{reset();if(event.isPrimary&&event.button===0){pointer=event.pointerId;startedOutside=outside(event);}});
 backdrop.addEventListener('pointerup',event=>{endedOutside=event.pointerId===pointer&&outside(event);});
 backdrop.addEventListener('pointercancel',reset);
 backdrop.addEventListener('click',event=>{const close=startedOutside&&endedOutside&&event.button===0&&outside(event);reset();if(close){event.stopPropagation();dismiss();}});
}

/** Listeners exist only while an anchored menu is open. */
export function dismissOutsideMenu(anchor:HTMLElement,menu:HTMLElement,dismiss:()=>void):()=>void{
 const lifecycle=new AbortController(),signal=lifecycle.signal;
 document.addEventListener('pointerdown',event=>{
  if(event.isPrimary&&event.button===0&&event.target instanceof Node&&!anchor.contains(event.target)&&!menu.contains(event.target))dismiss();
 },{capture:true,signal});
 window.addEventListener('blur',dismiss,{signal});
 const observer=new MutationObserver(()=>{if(!anchor.isConnected||!menu.isConnected)dismiss();});
 observer.observe(document.body,{childList:true,subtree:true});
 return()=>{lifecycle.abort();observer.disconnect();};
}
