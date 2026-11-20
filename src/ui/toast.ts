import {icon} from '../icons';
import './camera-media-toast.css';

let current:{owner:HTMLElement;node:HTMLDivElement;timer:ReturnType<typeof setTimeout>}|undefined;
function hide(node:HTMLElement):void{try{node.hidePopover?.();}catch{/* A fallback host has no open popover. */}}
function place():void{
 if(!current)return;
 const {node,owner}=current;if(!owner.isConnected){clearToast(owner);return;}
 const host=document.fullscreenElement??[...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1)??document.body;
 if(node.parentElement!==host){hide(node);host.append(node);}
 const body=document.body,title=body.classList.contains('desktop-framed')&&!body.classList.contains('monitor-mode')&&!document.fullscreenElement
  ?getComputedStyle(body).getPropertyValue('--desktop-title-height').trim()||'40px':'0px';
 node.style.setProperty('--camera-toast-top',`calc(${title} + 12px)`);
 try{node.showPopover?.();}catch{/* Positioned fallback for older WebViews. */}
}
/** Explicit completion feedback only. Never use for device control results. */
export function showToast(owner:HTMLElement,message:string,success=true):void{
 if(!owner.isConnected)return;if(current)clearToast(current.owner);
 const node=document.createElement('div');node.className='camera-media-toast';node.setAttribute('popover','manual');
 node.setAttribute('role','status');node.setAttribute('aria-live','polite');node.setAttribute('aria-atomic','true');
 const text=document.createElement('span');text.textContent=message;node.append(icon(success?'check':'info'),text);
 current={owner,node,timer:setTimeout(()=>clearToast(owner),3200)};
 document.addEventListener('fullscreenchange',place);place();
}
export function clearToast(owner:HTMLElement):void{
 if(!current||current.owner!==owner&&!owner.contains(current.owner))return;
 clearTimeout(current.timer);const node=current.node;current=undefined;
 document.removeEventListener('fullscreenchange',place);hide(node);node.remove();
}
