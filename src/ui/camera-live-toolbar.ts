import {button,element} from './dom';
import {officialIcon} from '../icons';

/** A second view of the same camera controls, with its own stable focus nodes.
 * It owns no camera session, decoder, poller, command queue or device state. */
export class CameraLiveToolbar{
 readonly root=element('div','camera-live-actions');
 private entries:{source:HTMLButtonElement;button:HTMLButtonElement;content:string}[]=[];
 constructor(bindings:({source:HTMLButtonElement;press:()=>void}|{node:HTMLButtonElement})[]){
  this.root.setAttribute('role','toolbar');this.root.setAttribute('aria-label','摄像机播放工具');
  for(const binding of bindings){if('node'in binding){this.root.append(binding.node);continue;}const b=button('',binding.source.className,binding.press);this.entries.push({source:binding.source,button:b,content:''});this.root.append(b);}
  this.sync();
 }
 sync():void{
  for(const e of this.entries){
   const s=e.source,b=e.button;if(b.disabled!==s.disabled)b.disabled=s.disabled;if(b.hidden!==s.hidden)b.hidden=s.hidden;
   const label=s.querySelector('span')?.textContent??'';
   for(const name of ['aria-label','aria-pressed','aria-busy','aria-description','title']){const value=s.getAttribute(name);if(value===null)b.removeAttribute(name);else if(b.getAttribute(name)!==value)b.setAttribute(name,value);}
   const glyph=s.querySelector<SVGSVGElement>('svg')?.dataset.iconName,key=JSON.stringify([glyph,label]);
   if(key!==e.content){e.content=key;const sourceIcon=s.querySelector<SVGSVGElement>('svg');b.replaceChildren(...(glyph?[sourceIcon?.dataset.iconSource==='desktop-custom'?sourceIcon.cloneNode(true):officialIcon(glyph)]:[]),...(label?[element('span','',label)]:[]));}
  }
 }
}
