import type {SavedCameraMedia} from '../camera-types';
import {icon} from '../icons';
import './camera-media-toast.css';

// Completion feedback is shared by monitor, borrowed detail and replay. The
// same saved file can arrive in a command reply and a later polling event.
const completed=new Set<string>();
let current:{owner:HTMLElement;node:HTMLDivElement;timer:ReturnType<typeof setTimeout>}|undefined;
function hidePopover(node:HTMLElement):void{if(typeof node.hidePopover==='function')try{node.hidePopover();}catch{/* No open popover on the fallback host. */}}

function place():void{
 if(!current)return;
 const {node,owner}=current;
 if(!owner.isConnected){clearCameraMediaToast(owner);return;}
 const dialogs=[...document.querySelectorAll<HTMLDialogElement>('dialog[open]')];
 const host=document.fullscreenElement??dialogs.at(-1)??document.body;
 if(node.parentElement!==host){hidePopover(node);host.append(node);}
 const body=document.body,title=body.classList.contains('desktop-framed')&&!body.classList.contains('monitor-mode')&&!document.fullscreenElement
  ?getComputedStyle(body).getPropertyValue('--desktop-title-height').trim()||'40px':'0px';
 node.style.setProperty('--camera-toast-top',`calc(${title} + 12px)`);
 // Top-layer placement keeps the toast visible above native dialogs and video
 // fullscreen without stealing focus or changing any camera state.
 if(typeof node.showPopover==='function')try{node.showPopover();}catch{/* The positioned host is the fallback on older WebViews. */}
}

export function showCameraMediaSaved(owner:HTMLElement,file:SavedCameraMedia):void{
 if(!owner.isConnected)return;
 const key=file.kind+':'+file.id;
 if(completed.has(key))return;
 if(completed.size>=64)completed.delete(completed.values().next().value!);
 completed.add(key);
 if(current)clearCameraMediaToast(current.owner);
 const node=document.createElement('div');node.className='camera-media-toast';node.setAttribute('popover','manual');
 node.setAttribute('role','status');node.setAttribute('aria-live','polite');node.setAttribute('aria-atomic','true');
 const text=document.createElement('span');text.textContent=file.kind==='screenshot'?'截图已保存':'录像已保存';node.append(icon('check'),text);
 current={owner,node,timer:setTimeout(()=>clearCameraMediaToast(owner),3200)};
 document.addEventListener('fullscreenchange',place);place();
}

export function clearCameraMediaToast(owner:HTMLElement):void{
 if(!current||current.owner!==owner&&!owner.contains(current.owner))return;
 clearTimeout(current.timer);const node=current.node;current=undefined;
 document.removeEventListener('fullscreenchange',place);
 hidePopover(node);node.remove();
}
