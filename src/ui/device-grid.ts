import {applyCardMetrics} from './card-metrics';
import {deviceColumnCount} from '../home-grid';
import {cardSize,packCards,CARD_GAP,type CardSize} from '../card-size';

const motions=new WeakMap<HTMLElement,Animation>();
export function sizeDeviceGrid(grid:HTMLElement,ids?:readonly string[],animate=false):void{
 if(!grid.isConnected||!grid.clientWidth)return;
 const before=animate?new Map([...grid.querySelectorAll<HTMLElement>(':scope > .device-card')].map(card=>[card,card.getBoundingClientRect()])):undefined;
 if(before)for(const card of before.keys())motions.get(card)?.cancel();
 const columns=deviceColumnCount(innerWidth),width=(grid.clientWidth-CARD_GAP*(columns-1))/columns,height=Math.min(width*.8,224);
 grid.style.setProperty('--grid-columns',String(columns));grid.style.gridAutoRows=`${(height-CARD_GAP)/2}px`;
 const cards=[...grid.querySelectorAll<HTMLElement>(':scope > .device-card')];
 const order=ids??cards.sort((a,b)=>Number(a.dataset.layoutOrder??0)-Number(b.dataset.layoutOrder??0)).map(c=>c.dataset.deviceId!);
 const sizes=Object.fromEntries(cards.map(c=>[c.dataset.deviceId!,cardSize(c.dataset.cardSize)])) as Record<string,CardSize>;
 const slots=packCards(order,sizes,columns),visual=[...slots].sort((a,b)=>a.row-b.row||a.column-b.column);
 for(const card of cards){const id=card.dataset.deviceId!,slot=slots.find(s=>s.id===id);if(!slot)continue;card.dataset.layoutOrder=String(order.indexOf(id));card.dataset.visualOrder=String(visual.findIndex(s=>s.id===id));
  applyCardMetrics(card,width,height,sizes[id],animate);
  const target=grid.querySelector<HTMLElement>(`.device-drag-slot[data-drag-for="${CSS.escape(id)}"]`)??card;
  target.style.gridColumn=`${slot.column+1} / span ${slot.columns}`;target.style.gridRow=`${slot.row+1} / span ${slot.rows}`;
  if(target===card){card.style.height='100%';card.style.aspectRatio='auto';card.style.maxHeight='none';}
 }
 // DOM order also defines Tab order, while data-layout-order retains the saved intent.
 if(!grid.querySelector('.device-drag-ghost')){
  const focus=document.activeElement instanceof HTMLElement&&grid.contains(document.activeElement)?document.activeElement:undefined;
  visual.forEach((slot,index)=>{const card=cards.find(c=>c.dataset.deviceId===slot.id)!;if(grid.children[index]!==card)grid.insertBefore(card,grid.children[index]??null);});
  if(focus?.isConnected&&document.activeElement!==focus)focus.focus({preventScroll:true});
 }
 if(before&&!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const card of cards){const first=before.get(card)!,last=card.getBoundingClientRect();if(!first||Math.abs(first.x-last.x)+Math.abs(first.y-last.y)+Math.abs(first.width-last.width)+Math.abs(first.height-last.height)<.5)continue;
  const resized=Math.abs(first.width-last.width)+Math.abs(first.height-last.height)>.5;
  const animation=card.animate([{translate:`${first.x-last.x}px ${first.y-last.y}px`,...(resized?{width:`${first.width}px`,height:`${first.height}px`}:{})},{translate:'none',...(resized?{width:`${last.width}px`,height:`${last.height}px`}:{})}],{duration:resized?300:250,easing:'cubic-bezier(.2,0,0,1)'});motions.set(card,animation);
  const media=matchMedia('(prefers-reduced-motion: reduce)'),reduce=()=>{if(media.matches)animation.cancel();};media.addEventListener('change',reduce);void animation.finished.catch(()=>{}).then(()=>media.removeEventListener('change',reduce));
 }
}
