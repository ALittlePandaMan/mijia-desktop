import {cameraOutlineIcon,type CameraOutlineIcon} from './camera-outline-icons';
import {cameraSoundIcon} from './camera-sound-icons';
import {button,element} from './dom';
import {cameraQualityOptions,type CameraDecodedSize,type CameraQualitySizes} from '../camera-quality';
import type {CameraFeatures} from '../camera-types';
/** Shared monitor chrome. Media/session operations are supplied by the caller. */
export function monitorTool(label:string,glyph:CameraOutlineIcon,run:()=>void):HTMLButtonElement {
 const control=button('','monitor-tile-button',run);
 control.append(glyph==='sound'||glyph==='muted'?cameraSoundIcon(glyph==='sound'):cameraOutlineIcon(glyph));
 control.setAttribute('aria-description',label);control.setAttribute('aria-label',label);return control;
}
export function renderMonitorQuality(menu:HTMLElement,qualities:CameraFeatures['qualities'],selected:string,select:(id:string)=>void,frame?:CameraDecodedSize,decodedQuality?:string,sizes:CameraQualitySizes={}):void {
 menu.replaceChildren();for(const q of cameraQualityOptions(qualities,frame,decodedQuality,sizes)){
  const choice=button('','',()=>{if(q.available)select(q.id);});choice.append(element('span','',q.label));choice.disabled=!q.available;
  choice.setAttribute('role','menuitemradio');choice.setAttribute('aria-checked',String(q.available&&(q.id===selected||q.aliases.includes(selected))));choice.dataset.quality=q.id;choice.dataset.qualityMode=q.mode;menu.append(choice);
 }
}
export function monitorGridView():HTMLDivElement {return element('div','monitor-grid');}
