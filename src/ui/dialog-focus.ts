const focusable='button:not(:disabled):not([tabindex="-1"]),input:not(:disabled):not([tabindex="-1"]),select:not(:disabled),[tabindex="0"]';

/** Keep keyboard focus inside a modal without changing its draft or close rules. */
export function bindDialogFocus(dialog:HTMLElement,close:()=>void):void {
 dialog.tabIndex=-1;
 dialog.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
  if(event.key!=='Tab')return;
  const items=[...dialog.querySelectorAll<HTMLElement>(focusable)].filter(node=>!node.closest('[hidden],[inert]'));
  const first=items[0],last=items.at(-1),active=dialog.ownerDocument.activeElement;
  if(!first){event.preventDefault();dialog.focus();}
  else if(event.shiftKey&&(active===dialog||active===first)){event.preventDefault();last?.focus();}
  else if(!event.shiftKey&&(active===dialog||active===last)){event.preventDefault();first.focus();}
 });
 queueMicrotask(()=>{if(dialog.isConnected)dialog.focus();});
}
