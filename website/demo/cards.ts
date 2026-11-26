import {deviceCardView} from './desktop/src/ui/device-card-view';
import {sizeDeviceGrid} from './desktop/src/ui/device-grid';
import {DeviceDrag} from './desktop/src/ui/device-drag';
import {CardPress} from './desktop/src/ui/card-press';
import {cardSizeMenu,cardMenuKeys} from './desktop/src/ui/card-size-menu';
import {cancelCardControls,updateCardControls} from './desktop/src/ui/card-controls';
import {cancelCardMetrics} from './desktop/src/ui/card-metrics';
import {updateHomeShortcut} from './desktop/src/ui/home-shortcut';
import {cardActive} from './desktop/src/home-cards';
import {element} from './desktop/src/ui/dom';
import type {Device,Json} from './desktop/src/types';
import {demoCardPresentation} from './card-presentation';
import {DemoStore,devices,demoDevice,type DeviceId,type RoomId} from './store';

/** Original desktop cards, menu and packing, with in-memory demo data only. */
export class DemoCards{
 private cards=new Map<DeviceId,HTMLElement>();private room:RoomId|'all'='all';private observer:ResizeObserver;private width=0;private layoutFrame=0;private animate=false;
 private menu?:HTMLElement;private opener?:HTMLElement;
 private drag:DeviceDrag;
 private press=new CardPress();
 private renderedOrder:readonly DeviceId[]=[];
 constructor(private grid:HTMLElement,private store:DemoStore,artwork:(device:Device)=>HTMLElement,open:(id:DeviceId)=>void,private changed:()=>void){
  this.drag=new DeviceDrag({
   requireHold:true,
   begin:()=>{this.closeMenu();return true;},
   order:()=>this.store.cardOrder(this.room),
   preview:ids=>this.store.setCardOrder(this.room,ids),
   ended:()=>this.layout(),
   heldTouch:(id,x,y)=>{const device=demoDevice(id);if(device)this.openMenu(device.did,x,y);},
  });
  for(const device of devices){const id=device.did,card=deviceCardView({size:store.cardSize(id),device,shortcut:store.shortcut(id),pending:false,artwork:artwork(device),caption:store.caption(id),selected:false,open:()=>{if(this.drag.settleLanding())this.press.activate(card,id,()=>open(id));},activate:()=>store.toggle(id),presentation:demoCardPresentation(device,store.panel(id)),activateControl:(control,value)=>this.write(id,control,value)});
   card.setAttribute('aria-description',device.name+'，长按可拖拽，右键可切换卡片大小');
   this.press.bind(card,id);
   this.drag.bind(card,id,false);
   card.addEventListener('contextmenu',event=>{event.preventDefault();if(event.pointerType!=='touch')this.openMenu(id,event.clientX,event.clientY);});
   card.addEventListener('keydown',event=>{if(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey){event.preventDefault();const bounds=card.getBoundingClientRect();this.openMenu(id,bounds.left+12,bounds.top+12);}});
   this.cards.set(id,card);grid.append(card);
  }
  this.observer=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width??0;if(width&&width!==this.width){this.width=width;this.layout();}});this.observer.observe(grid);
  grid.addEventListener('touchmove',this.dragTouch,{passive:false});
  document.addEventListener('pointerdown',this.outside,true);
  window.addEventListener('resize',this.resized);
  window.addEventListener('blur',this.cancelGesture);
  this.layout();
 }
 // A swipe before the hold pans natively. Once lifted, the same finger moves the card.
 private dragTouch=(event:TouchEvent)=>{if(this.drag.dragging&&event.touches.length===1&&event.cancelable)event.preventDefault();};
 private cancelGesture=()=>{this.drag.cancel();this.press.clear();this.layout();};
 private write(id:DeviceId,controlId:string,value:Json){const device=demoDevice(id)!,panel=this.store.panel(id),control=demoCardPresentation(device,panel)?.controls.find(c=>c.id===controlId);if(!control?.enabled)return;const p=panel.services.flatMap(s=>s.properties).find(p=>`${p.siid}:${p.piid}`===controlId);if(p)this.store.write(id,p,value);}
 private layout(animate=false){
  this.animate||=animate;
  if(this.layoutFrame||this.drag.active)return;
  this.layoutFrame=requestAnimationFrame(()=>{
   this.layoutFrame=0;
   if(this.drag.active||!this.grid.clientWidth)return;
   const ids=this.store.cardOrder(this.room);
   sizeDeviceGrid(this.grid,ids,this.animate);
   this.renderedOrder=ids;
   this.animate=false;
   this.changed();
  });
 }
 refresh(){let resized=false;for(const device of devices){const id=device.did,card=this.cards.get(id)!,size=this.store.cardSize(id),shortcut=this.store.shortcut(id);if(card.dataset.cardSize!==size){card.dataset.cardSize=size;resized=true;}card.querySelector('.device-room')!.textContent=this.store.caption(id);card.classList.toggle('is-active',cardActive(shortcut,device));const status=card.querySelector('.device-status');if(status)updateHomeShortcut(status,device,shortcut,false,()=>this.store.toggle(id));updateCardControls(card,demoCardPresentation(device,this.store.panel(id)),(control,value)=>this.write(id,control,value));}if(resized||this.store.cardOrder(this.room).some((id,index)=>id!==this.renderedOrder[index]))this.layout(true);}
 selectRoom(room:RoomId|'all'){this.cancelInteraction();this.room=room;for(const device of devices){const card=this.cards.get(device.did)!;if(room==='all'||device.roomId===room){if(!card.isConnected)this.grid.append(card);}else{cancelCardControls(card);cancelCardMetrics(card);card.remove();}}this.refresh();this.layout();}
 private openMenu(id:DeviceId,x:number,y:number){
  if(!this.drag.settleLanding())return;
  this.closeMenu();
  const card=this.cards.get(id)!;this.opener=card.querySelector<HTMLElement>('.device-card-open')??card;
  const menu=element('div','device-context-menu');menu.setAttribute('role','menu');menu.setAttribute('aria-label',demoDevice(id)!.name+'卡片大小');
  menu.append(cardSizeMenu(this.store.cardSize(id),size=>{this.closeMenu(true);this.store.setCardSize(id,size);},undefined,this.store.canUseLargeCard(id)));
  cardMenuKeys(menu,()=>this.closeMenu(true));this.menu=menu;document.body.append(menu);
  menu.style.left=`${Math.max(8,Math.min(x,innerWidth-menu.offsetWidth-8))}px`;menu.style.top=`${Math.max(8,Math.min(y,innerHeight-menu.offsetHeight-8))}px`;
  menu.querySelector<HTMLButtonElement>('button:not([hidden]):not(:disabled)')?.focus({preventScroll:true});
 }
 private outside=(event:PointerEvent)=>{if(this.menu&&!this.menu.contains(event.target as Node))this.closeMenu();};
 private resized=()=>this.cancelInteraction();
 cancelInteraction(){this.closeMenu();this.cancelGesture();}
 cancelDrag():boolean{if(!this.drag.active)return false;this.cancelGesture();return true;}
 closeMenu(restoreFocus=false){this.menu?.remove();this.menu=undefined;if(restoreFocus&&this.opener?.isConnected)this.opener.focus({preventScroll:true});this.opener=undefined;}
 focus(id:DeviceId){this.cards.get(id)?.querySelector<HTMLElement>('.device-card-open')?.focus({preventScroll:true});}
 dispose(){this.closeMenu();this.drag.cancel();this.press.clear();cancelAnimationFrame(this.layoutFrame);this.observer.disconnect();this.grid.removeEventListener('touchmove',this.dragTouch);document.removeEventListener('pointerdown',this.outside,true);window.removeEventListener('resize',this.resized);window.removeEventListener('blur',this.cancelGesture);for(const card of this.cards.values()){cancelCardControls(card);cancelCardMetrics(card);}}
}
