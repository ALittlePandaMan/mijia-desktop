import './adjustment-surfaces.css';
import {icon,type IconName} from '../icons';
import {button,element} from './dom';
import type {CurtainOpening} from '../types';

export type BrightnessTone = 'white' | 'rgb';

export function setRangeReadout(slider: HTMLInputElement, text?: string): void {
  if (text === undefined) slider.dataset.unread = 'true';
  else delete slider.dataset.unread;
  slider.setAttribute('aria-valuetext', text ?? '无可用数值');
}

/** Share gesture cleanup while the hosting control owns its readback and writes. */
export function bindRangeInteraction(slider: HTMLInputElement, owner: HTMLElement, callbacks: {
  preview: (fromInput: boolean) => void;
  commit: () => void;
  start?: () => void;
  restore?: () => void;
  ended?: () => void;
}) {
  let pointer: number | undefined;
  let original = '';
  let cancelled = false;
  let observer: MutationObserver | undefined;
  const alive = () => owner.isConnected && owner.contains(slider);
  const allowed = () => alive() && !slider.disabled && !cancelled;
  const end = (cancel: boolean) => {
    if (cancel) cancelled = true;
    if (pointer === undefined) return;
    pointer = undefined;
    delete owner.dataset.interacting;
    window.removeEventListener('pointerup', release, true);
    window.removeEventListener('blur', cancelGesture);
    observer?.disconnect();
    observer = undefined;
    if (cancel && alive()) {
      slider.value = original;
      callbacks.preview(false);
      callbacks.restore?.();
    }
    if (callbacks.ended) requestAnimationFrame(() => { if (alive()) callbacks.ended?.(); });
  };
  const release = (event: PointerEvent) => { if (event.pointerId === pointer) end(false); };
  const cancelGesture = () => end(true);
  slider.addEventListener('pointerdown', event => {
    if (pointer !== undefined || event.button !== 0 || slider.disabled || !alive()) return;
    pointer = event.pointerId;
    original = slider.value;
    cancelled = false;
    callbacks.start?.();
    owner.dataset.interacting = 'true';
    window.addEventListener('pointerup', release, true);
    window.addEventListener('blur', cancelGesture);
    observer = new MutationObserver(() => { if (!alive()) cancelGesture(); });
    observer.observe(owner.ownerDocument.documentElement, {childList:true,subtree:true});
  });
  for (const event of ['pointercancel','lostpointercapture'] as const) {
    slider.addEventListener(event, e => { if (e.pointerId === pointer) cancelGesture(); });
  }
  slider.addEventListener('blur', cancelGesture);
  slider.addEventListener('keydown', () => { if (alive() && !slider.disabled) cancelled = false; });
  slider.addEventListener('input', () => { if (allowed()) callbacks.preview(true); });
  slider.addEventListener('change', () => { if (allowed()) callbacks.commit(); });
  return {get active() { return pointer !== undefined; }, allowed, cancel: cancelGesture};
}

export function curtainSliderSurface(slider:HTMLInputElement,canEdit:()=>boolean,opening:CurtainOpening='double'):HTMLElement{
  slider.classList.add('curtain-slider-input');
  const leftHandle=element('i','curtain-slider-handle');
  const left=element('span','curtain-slider-panel curtain-slider-left',leftHandle);
  const right=element('span','curtain-slider-panel curtain-slider-right',element('i','curtain-slider-handle'));
  const surface=element('div','curtain-slider-surface',left,right);
  surface.setAttribute('aria-hidden','true');
  const track=element('div','curtain-slider-track',surface,slider);
  track.dataset.curtainOpening=opening;
  // A handle travels toward its fabric stack as the opening percentage rises.
  let drag:{id:number;origin:number;direction:number;travel:number;inset:number;initial:string}|undefined;
  const move=(x:number)=>{
    if(!drag)return;
    const min=Number(slider.min),max=Number(slider.max);
    const delta=x-drag.origin;
    const distance=drag.direction===0?Math.abs(delta):delta*drag.direction;
    const fraction=Math.min(1,Math.max(0,(distance-drag.inset)/drag.travel));
    slider.value=String(min+fraction*(max-min));
    // The native range clamps and snaps to its current min/max/step.
    slider.dispatchEvent(new Event('input',{bubbles:true}));
  };
  slider.addEventListener('pointerdown',event=>{
    if(drag||slider.disabled||!canEdit()||event.button!==0)return;
    const rect=track.getBoundingClientRect();if(rect.width<=0)return;
    const variant=track.dataset.curtainOpening;
    const singleLeft=variant==='single-left',singleRight=variant==='single-right';
    const panel=singleRight?right:left;
    const bounds=panel.getBoundingClientRect(),handle=panel.firstElementChild!.getBoundingClientRect();
    const edge=singleRight?handle.left+handle.width/2-bounds.left:bounds.right-handle.left-handle.width/2;
    const inset=Math.max(0,Math.min(edge,rect.width*.08));
    const origin=singleLeft?rect.right:singleRight?rect.left:rect.x+rect.width/2;
    const direction=singleLeft?-1:singleRight?1:0;
    drag={id:event.pointerId,origin,direction,travel:rect.width*(direction===0?.42:.92),inset,initial:slider.value};
    event.preventDefault();slider.focus({preventScroll:true});slider.setPointerCapture(event.pointerId);move(event.clientX);
  });
  slider.addEventListener('pointermove',event=>{
    if(event.pointerId!==drag?.id||slider.disabled||!canEdit())return;
    event.preventDefault();move(event.clientX);
  });
  slider.addEventListener('pointerup',event=>{
    if(event.pointerId!==drag?.id)return;
    if(!slider.disabled&&canEdit()&&event.button===0){
      move(event.clientX);
      if(drag&&slider.value!==drag.initial)slider.dispatchEvent(new Event('change',{bubbles:true}));
    }
    drag=undefined;
  });
  for(const name of ['pointercancel','lostpointercapture'] as const)slider.addEventListener(name,event=>{
    if(event.pointerId===drag?.id)drag=undefined;
  });
  return track;
}

export function temperatureSurface(slider:HTMLInputElement,output:HTMLElement|null,step:(direction:-1|1)=>void){
  slider.classList.add('air-temperature-slider');
  output?.classList.add('air-temperature-current');
  const track=element('div','air-temperature-track',slider,output);
  const buttons=([-1,1] as const).map(direction=>{
    const control=button('','air-temperature-step',()=>{if(control.isConnected&&!control.disabled)step(direction);},direction<0?'minus':'plus');
    control.setAttribute('aria-label',direction<0?'降低目标温度':'升高目标温度');
    return control;
  });
  return {root:element('div','air-temperature-controls',buttons[0],track,buttons[1]),buttons};
}

export function brightnessSurface(slider:HTMLInputElement,tone:BrightnessTone='white',endpoints:readonly [IconName,IconName]=['light','sun']):HTMLElement{
  slider.classList.add('native-slider','brightness-slider');
  return element('div',`brightness-track brightness-${tone}`,slider,
    element('span','brightness-endpoint brightness-min',icon(endpoints[0])),
    element('span','brightness-endpoint brightness-max',icon(endpoints[1])));
}
