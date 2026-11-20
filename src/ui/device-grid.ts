import {applyCardMetrics} from './card-metrics';
import {deviceColumnCount} from '../home-grid';
import {cardSize,packCards,CARD_GAP,type CardSize,type CardSlot} from '../card-size';

const motions=new WeakMap<HTMLElement,Animation>();
export function deviceGridTracks(grid:HTMLElement){
 const columns=deviceColumnCount(innerWidth),width=(grid.clientWidth-CARD_GAP*(columns-1))/columns;
 return {columns,width,height:Math.min(width*.8,224)};
}
export function sizeDeviceGrid(grid:HTMLElement,ids?:readonly string[],animate=false,packed?:CardSlot[]):void{
 if(!grid.isConnected||!grid.clientWidth)return;
 const before=animate?new Map([...grid.querySelectorAll<HTMLElement>(':scope > .device-card')].map(card=>[card,card.getBoundingClientRect()])):undefined;
 if(before)for(const card of before.keys())motions.get(card)?.cancel();
 const {columns,width,height}=deviceGridTracks(grid);
 grid.style.setProperty('--grid-columns',String(columns));grid.style.gridAutoRows=`${(height-CARD_GAP)/2}px`;
 const cards=[...grid.querySelectorAll<HTMLElement>(':scope > .device-card')];
 const order=ids??cards.sort((a,b)=>Number(a.dataset.layoutOrder??0)-Number(b.dataset.layoutOrder??0)).map(c=>c.dataset.deviceId!);
 const sizes=Object.fromEntries(cards.map(c=>[c.dataset.deviceId!,cardSize(c.dataset.cardSize)])) as Record<string,CardSize>;
 const slots=packed??packCards(order,sizes,columns),visual=[...slots].sort((a,b)=>a.row-b.row||a.column-b.column);
 const nodes=new Map(cards.map(card=>[card.dataset.deviceId!,card]));
 const ranks=new Map(visual.map((slot,index)=>[slot.id,index]));
 const placeholder=grid.querySelector<HTMLElement>(':scope > .device-drag-slot');
 for(const [index,slot]of slots.entries()){
  const id=slot.id,card=nodes.get(id);if(!card)continue;
  card.dataset.layoutOrder=String(index);card.dataset.visualOrder=String(ranks.get(id));
  if(!packed)applyCardMetrics(card,width,height,sizes[id],animate);
  const target=placeholder?.dataset.dragFor===id?placeholder:card;
  const column=`${slot.column+1} / span ${slot.columns}`,row=`${slot.row+1} / span ${slot.rows}`;
  if(target.style.gridColumn!==column)target.style.gridColumn=column;
  if(target.style.gridRow!==row)target.style.gridRow=row;
  if(target===card){card.style.height='100%';card.style.aspectRatio='auto';card.style.maxHeight='none';}
 }
 // DOM order also defines Tab order, while data-layout-order retains the saved intent.
 if(!grid.querySelector('.device-drag-ghost')){
  const focus=document.activeElement instanceof HTMLElement&&grid.contains(document.activeElement)?document.activeElement:undefined;
  visual.forEach((slot,index)=>{const card=nodes.get(slot.id);if(card&&grid.children[index]!==card)grid.insertBefore(card,grid.children[index]??null);});
  if(focus?.isConnected&&document.activeElement!==focus)focus.focus({preventScroll:true});
 }
 if(before&&!matchMedia('(prefers-reduced-motion: reduce)').matches)for(const card of cards){const first=before.get(card)!,last=card.getBoundingClientRect();if(!first||Math.abs(first.x-last.x)+Math.abs(first.y-last.y)+Math.abs(first.width-last.width)+Math.abs(first.height-last.height)<.5)continue;
  const resized=Math.abs(first.width-last.width)+Math.abs(first.height-last.height)>.5;
  const animation=card.animate([{translate:`${first.x-last.x}px ${first.y-last.y}px`,...(resized?{width:`${first.width}px`,height:`${first.height}px`}:{})},{translate:'none',...(resized?{width:`${last.width}px`,height:`${last.height}px`}:{})}],{duration:resized?300:250,easing:'cubic-bezier(.2,0,0,1)'});motions.set(card,animation);
  const media=matchMedia('(prefers-reduced-motion: reduce)'),reduce=()=>{if(media.matches)animation.cancel();};media.addEventListener('change',reduce);void animation.finished.catch(()=>{}).then(()=>media.removeEventListener('change',reduce));
 }
}
