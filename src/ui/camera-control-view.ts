import {cameraOutlineIcon,type CameraOutlineIcon} from './camera-outline-icons';
import {cameraSoundIcon} from './camera-sound-icons';
import {button,element} from './dom';
import {cameraQualityOptions,type CameraQualitySizes} from '../camera-quality';
import type {CameraFeatures} from '../camera-types';
/** Shared monitor chrome. Media/session operations are supplied by the caller. */
export function monitorTool(label:string,glyph:CameraOutlineIcon,run:()=>void):HTMLButtonElement {
 const control=button('','monitor-tile-button',run);
 control.append(glyph==='sound'||glyph==='muted'?cameraSoundIcon(glyph==='sound'):cameraOutlineIcon(glyph));
 control.setAttribute('aria-description',label);control.setAttribute('aria-label',label);return control;
}
export function renderMonitorQuality(menu:HTMLElement,qualities:CameraFeatures['qualities'],selected:string,select:(id:string)=>void,sizes:CameraQualitySizes={}):void {
 const focused=focusedCameraQuality(menu),options=cameraQualityOptions(qualities,sizes);
 menu.replaceChildren();for(const q of options){
  const choice=button('','',()=>{if(q.available)select(q.id);});choice.append(element('span','',q.label));choice.disabled=!q.available;
  choice.setAttribute('role','menuitemradio');choice.setAttribute('aria-checked',String(q.available&&(q.id===selected||q.aliases.includes(selected))));choice.dataset.quality=q.id;choice.dataset.qualityMode=q.mode;menu.append(choice);
 }
 restoreCameraQualityFocus(menu,options,focused);
}
export function focusedCameraQuality(menu:HTMLElement):string|undefined {
 const active=document.activeElement;
 return active instanceof HTMLElement&&menu.contains(active)?active.dataset.quality:undefined;
}
export function restoreCameraQualityFocus(menu:HTMLElement,options:ReturnType<typeof cameraQualityOptions>,focused?:string):void {
 if(!focused)return;
 const id=options.find(q=>q.id===focused||q.aliases.includes(focused))?.id;
 const choices=[...menu.querySelectorAll<HTMLButtonElement>('[data-quality]:not(:disabled)')];
 (choices.find(choice=>choice.dataset.quality===id)??choices.find(choice=>choice.getAttribute('aria-checked')==='true')??choices[0])?.focus({preventScroll:true});
}
export function monitorGridView():HTMLDivElement {return element('div','monitor-grid');}
