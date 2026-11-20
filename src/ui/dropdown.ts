import {icon} from '../icons';
import {element} from './dom';
import './dropdown.css';

export interface DropdownOption {
 value:string;label:string;disabled?:boolean;selected?:boolean;className?:string;focusKey?:string;
}
interface MenuOptions {
 label:string;items:readonly DropdownOption[];className?:string;id?:string;role?:'menu'|'listbox';selection?:boolean;
 choose:(value:string)=>void;dismiss?:()=>void;
}
let sequence=0;
let active:{close:()=>void}|undefined;
export function hasOpenDropdown():boolean{return !!active;}

/** Shared option surface for value pickers and action menus. */
export function dropdownMenu(options:MenuOptions):HTMLElement {
 const menu=element('div',`dropdown-surface ${options.className??''}`.trim()),role=options.role??'menu';
 menu.id=options.id??`dropdown-menu-${++sequence}`;menu.setAttribute('role',role);menu.setAttribute('aria-label',options.label);
 for(const option of options.items){
  const item=element('button',`dropdown-item${option.selected?' is-selected chosen':''}${option.className?' '+option.className:''}`,element('span','dropdown-item-label',option.label));
  item.type='button';item.value=option.value;item.disabled=!!option.disabled;item.id=`dropdown-option-${++sequence}`;
  item.setAttribute('role',role==='listbox'?'option':options.selection?'menuitemradio':'menuitem');
  if(role==='listbox')item.setAttribute('aria-selected',String(!!option.selected));
  else if(options.selection)item.setAttribute('aria-checked',String(!!option.selected));
  if(option.focusKey)item.dataset.focusKey=option.focusKey;
  if(role==='listbox')item.tabIndex=-1;
  if(option.selected){const marker=element('span','dropdown-selection');marker.setAttribute('aria-hidden','true');item.append(marker);}
  item.addEventListener('click',()=>{if(!item.disabled)options.choose(option.value);});menu.append(item);
 }
 if(role==='menu'){
  let search='',lastSearch=0;
  menu.addEventListener('keydown',event=>{
   if(event.key==='Tab'&&options.dismiss){event.stopPropagation();options.dismiss();return;}
   if(event.key==='Escape'&&options.dismiss){event.preventDefault();event.stopPropagation();options.dismiss();return;}
   if(event.key==='Enter'||event.key===' '){const item=(event.target as Element).closest<HTMLButtonElement>('.dropdown-item');if(item&&!item.disabled){event.preventDefault();event.stopPropagation();item.click();}return;}
   const items=[...menu.querySelectorAll<HTMLButtonElement>('.dropdown-item:not(:disabled)')];if(!items.length)return;
   const index=items.indexOf(document.activeElement as HTMLButtonElement);let next:number|undefined;
   if(event.key==='ArrowDown'||event.key==='ArrowUp')next=(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
   else if(event.key==='Home')next=0;else if(event.key==='End')next=items.length-1;
   else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){const now=Date.now();search=(now-lastSearch<600?search:'')+event.key.toLocaleLowerCase();lastSearch=now;const found=items.findIndex(item=>item.textContent?.toLocaleLowerCase().startsWith(search));if(found>=0)next=found;}
   if(next!==undefined){event.preventDefault();event.stopPropagation();items[next].focus({preventScroll:true});}
  });
 }
 return menu;
}

export interface DropdownSelectOptions {
 label:string;options:readonly DropdownOption[];value?:string;className?:string;placeholder?:string;change?:(value:string)=>void;
}
/** A button-valued form control; no native select or hidden native popup. */
export function dropdownSelect(options:DropdownSelectOptions):HTMLButtonElement {
 const trigger=element('button',`dropdown-select ${options.className??''}`.trim()),label=element('span','dropdown-value');
 trigger.type='button';trigger.setAttribute('role','combobox');trigger.setAttribute('aria-label',options.label);trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
 const chevron=icon('chevron','dropdown-chevron dropdown-chevron-original');
 trigger.append(label,chevron);
 let value='',popup:HTMLElement|undefined,cleanup:()=>void=()=>{},highlight=-1,search='',lastSearch=0;
 const update=(next:string)=>{value=options.options.some(option=>option.value===next)?next:'';label.textContent=options.options.find(option=>option.value===value)?.label??options.placeholder??'请选择';};
 Object.defineProperty(trigger,'value',{configurable:true,get:()=>value,set:(next:string)=>update(String(next))});update(options.value??'');
 const close=(focus=false)=>{
  if(!popup)return;const panel=popup;popup=undefined;cleanup();cleanup=()=>{};
  if(active?.close===dismiss)active=undefined;
  panel.remove();trigger.classList.remove('is-open');trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-controls');trigger.removeAttribute('aria-activedescendant');
  if(focus&&trigger.isConnected&&!trigger.disabled)trigger.focus({preventScroll:true});
 };
 const dismiss=()=>close();
 const highlightItem=(index:number)=>{
  if(!popup)return;const items=[...popup.querySelectorAll<HTMLButtonElement>('.dropdown-item')];if(!items[index]||items[index].disabled)return;
  highlight=index;for(const [i,item]of items.entries())item.classList.toggle('is-highlighted',i===index);
  trigger.setAttribute('aria-activedescendant',items[index].id);items[index].scrollIntoView({block:'nearest'});
 };
 const open=()=>{
  if(trigger.disabled||popup||!trigger.isConnected)return;active?.close();active={close:dismiss};
  popup=dropdownMenu({label:options.label,role:'listbox',className:'dropdown-popup',items:options.options.map(option=>({...option,selected:option.value===value})),choose:next=>{
   const changed=next!==value;trigger.value=next;close(true);
   if(changed){trigger.dispatchEvent(new Event('input',{bubbles:true}));trigger.dispatchEvent(new Event('change',{bubbles:true}));options.change?.(value);}
  }});
  const panel=popup;panel.dataset.open='true';panel.id=`dropdown-list-${++sequence}`;trigger.setAttribute('aria-controls',panel.id);trigger.setAttribute('aria-expanded','true');trigger.classList.add('is-open');
  const host=trigger.closest('dialog')??document.body;
  const topLayer=typeof panel.showPopover==='function';if(topLayer)panel.setAttribute('popover','manual');
  host.append(panel);if(topLayer)panel.showPopover();
  const position=()=>{
   if(!trigger.isConnected||trigger.disabled){close();return;}
   const anchor=trigger.getBoundingClientRect(),edge=12,gap=6,viewport=window.visualViewport;
   const left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;
   panel.style.minWidth=`${Math.min(anchor.width,width-edge*2)}px`;panel.style.maxWidth=`${Math.max(0,width-edge*2)}px`;panel.style.maxHeight=`${Math.max(0,height-edge*2)}px`;
   const box=panel.getBoundingClientRect(),below=top+height-edge-anchor.bottom-gap,above=anchor.top-top-edge-gap,up=box.height>below&&above>below;
   panel.style.maxHeight=`${Math.max(0,Math.min(320,up?above:below))}px`;
   const measured=panel.getBoundingClientRect();panel.style.left=`${Math.max(left+edge,Math.min(anchor.left,left+width-edge-measured.width))}px`;panel.style.top=`${up?Math.max(top+edge,anchor.top-gap-measured.height):Math.max(top+edge,anchor.bottom+gap)}px`;
   panel.dataset.placement=up?'above':'below';
  };
  position();
  const abort=new AbortController(),signal=abort.signal;
  document.addEventListener('pointerdown',event=>{if(event.target instanceof Node&&!panel.contains(event.target)&&!trigger.contains(event.target))close();},{capture:true,signal});
  document.addEventListener('focusin',event=>{if(event.target instanceof Node&&!panel.contains(event.target)&&!trigger.contains(event.target))close();},{signal});
  document.addEventListener('scroll',event=>{if(event.target instanceof Node&&!panel.contains(event.target))close();},{capture:true,signal});
  window.addEventListener('resize',position,{signal});window.addEventListener('blur',dismiss,{signal});
  panel.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse')event.preventDefault();},{signal});
  panel.addEventListener('pointermove',event=>{const item=(event.target as Element).closest<HTMLButtonElement>('.dropdown-item');if(item&&!item.disabled)highlightItem([...panel.children].indexOf(item));},{signal});
  const observer=new MutationObserver(()=>{if(!trigger.isConnected||trigger.disabled)close();});observer.observe(document.body,{childList:true,subtree:true});observer.observe(trigger,{attributes:true,attributeFilter:['disabled','hidden']});
  const resize=new ResizeObserver(position);resize.observe(trigger);
  cleanup=()=>{abort.abort();observer.disconnect();resize.disconnect();};
  const selected=options.options.findIndex(option=>option.value===value&&!option.disabled);highlightItem(selected>=0?selected:options.options.findIndex(option=>!option.disabled));
 };
 trigger.addEventListener('click',()=>{if(popup)close();else open();});
 trigger.addEventListener('keydown',event=>{
  if(event.key==='Tab'){close();return;}
  if(event.key==='Escape'&&popup){event.preventDefault();event.stopPropagation();close(true);return;}
  if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)){
   event.preventDefault();event.stopPropagation();const wasOpen=!!popup;if(!wasOpen)open();else if(event.key==='Enter'||event.key===' '){popup?.querySelector<HTMLButtonElement>('.is-highlighted')?.click();return;}
   const enabled=options.options.map((option,index)=>option.disabled?-1:index).filter(index=>index>=0);if(!enabled.length)return;
   if(event.key==='Home')highlightItem(enabled[0]);else if(event.key==='End')highlightItem(enabled.at(-1)!);
   else if(wasOpen&&(event.key==='ArrowDown'||event.key==='ArrowUp'))highlightItem(enabled[(enabled.indexOf(highlight)+(event.key==='ArrowDown'?1:-1)+enabled.length)%enabled.length]);
  }else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.isComposing){
   open();const now=Date.now();search=(now-lastSearch<600?search:'')+event.key.toLocaleLowerCase();lastSearch=now;
   const index=options.options.findIndex(option=>!option.disabled&&option.label.toLocaleLowerCase().startsWith(search));if(index>=0){event.preventDefault();event.stopPropagation();highlightItem(index);}
  }
 });
 return trigger;
}
