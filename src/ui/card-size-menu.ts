import type {CardSize} from '../card-size';
import {officialIcon} from '../icons';
import {button,element} from './dom';

/** Shared app/desktop menu; selecting a size never installs pointer handlers. */
export function cardSizeMenu(current:CardSize,change:(size:CardSize)=>void,available:(size:CardSize)=>boolean=()=>true):HTMLElement{
 const group=element('div','card-size-menu');group.setAttribute('role','group');group.setAttribute('aria-label','卡片大小');
 for(const [size,label]of [['large','设为大卡片'],['medium','设为中卡片'],['small','设为小卡片']]as const){
  if(size===current)continue;
  const item=button(label,'account-menu-item card-size-menu-item',()=>change(size));item.prepend(officialIcon('card-size:'+size,'card-size-menu-symbol'));item.dataset.cardSizeChoice=size;item.setAttribute('role','menuitem');item.disabled=!available(size);if(item.disabled)item.title='周围空间不足，无法切换到此尺寸';group.append(item);
 }
 return group;
}
export function cardMenuKeys(menu:HTMLElement,close:()=>void):void{
 menu.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
  const items=[...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=items.indexOf(document.activeElement as HTMLButtonElement);let next:number|undefined;
  if(event.key==='ArrowDown')next=(index+1)%items.length;else if(event.key==='ArrowUp')next=(index+items.length-1)%items.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=items.length-1;
  if(next!==undefined&&items[next]){event.preventDefault();event.stopPropagation();items[next].focus();}
 });
}
