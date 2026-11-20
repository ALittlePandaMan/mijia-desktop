import './adjustment-surfaces.css';
import {icon} from '../icons';
import {button,element} from './dom';

export type BrightnessTone = 'white' | 'rgb';

export function curtainSliderSurface(slider:HTMLInputElement,canEdit:()=>boolean):HTMLElement{
  slider.classList.add('curtain-slider-input');
  const leftHandle=element('i','curtain-slider-handle');
  const left=element('span','curtain-slider-panel curtain-slider-left',leftHandle);
  const right=element('span','curtain-slider-panel curtain-slider-right',element('i','curtain-slider-handle'));
  const surface=element('div','curtain-slider-surface',left,right);
  surface.setAttribute('aria-hidden','true');
  const track=element('div','curtain-slider-track',surface,slider);
  // The centre is closed; either edge is fully open. Leave keyboard input to the range.
  let drag:{id:number;centre:number;travel:number;inset:number;initial:string}|undefined;
  const move=(x:number)=>{
    if(!drag)return;
    const min=Number(slider.min),max=Number(slider.max);
    const opening=Math.min(1,Math.max(0,(Math.abs(x-drag.centre)-drag.inset)/drag.travel));
    slider.value=String(min+opening*(max-min));
    // The native range clamps and snaps to its current min/max/step.
    slider.dispatchEvent(new Event('input',{bubbles:true}));
  };
  slider.addEventListener('pointerdown',event=>{
    if(drag||slider.disabled||!canEdit()||event.button!==0)return;
    const rect=track.getBoundingClientRect();if(rect.width<=0)return;
    const handle=leftHandle.getBoundingClientRect();
    const panel=left.getBoundingClientRect();
    const edge=panel.right-handle.left-handle.width/2;
    drag={id:event.pointerId,centre:rect.x+rect.width/2,travel:rect.width*.42,inset:Math.max(0,edge),initial:slider.value};
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
      if(slider.value!==drag.initial)slider.dispatchEvent(new Event('change',{bubbles:true}));
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

export function brightnessSurface(slider:HTMLInputElement,tone:BrightnessTone='white'):HTMLElement{
  slider.classList.add('native-slider','brightness-slider');
  return element('div',`brightness-track brightness-${tone}`,slider,
    element('span','brightness-endpoint brightness-min',icon('light')),
    element('span','brightness-endpoint brightness-max',icon('sun')));
}
