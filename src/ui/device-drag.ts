import {deviceGridTracks,sizeDeviceGrid} from './device-grid';
import { moveDeviceIds } from '../local-preferences';
import { cancelCardPress, cardPressBounds } from './card-press';
import {CARD_HOLD_MS} from './card-hold';
import {DRAG_START_DIP,insertCardIds} from '../card-interaction';
import {CARD_GAP,cardSize,packCards} from '../card-size';

/** Device cards preview the same packed insertion that will be saved. */
export {CARD_HOLD_MS} from './card-hold';
export const CARD_SCALE_MS = 300;
export const CARD_REFLOW_MS = 200;
interface DragState {
  card: HTMLElement; grid: HTMLElement; id: string; pointer: number;
  startX: number; startY: number; x: number; y: number; grabX: number; grabY: number; offsetX: number; offsetY: number;
  started: boolean; movedEarly: boolean; timer?: ReturnType<typeof setTimeout>;
  moved?: boolean;
  ghost?: HTMLElement; slot?: HTMLElement; styles?: Record<string, string>; raise?: Animation; frame?: number; original: string[];
  scrollTop: number; viewport?: HTMLElement;
  hitX?:number;hitY?:number;hitScroll?:number;viewportBounds?:DOMRect;previewOrder?:string[];
  baseRects?:Map<string,DOMRect>;baseGrid?:DOMRect;tail?:{top:number;right:number};candidate?:string[];candidateKey?:string;preview?:HTMLElement;liftRect?:DOMRect;ghostWidth?:number;ghostHeight?:number;
}
interface DragCallbacks {
  begin: (id: string, pointerDrag?:boolean) => boolean;
  preview: (ids: string[]) => void;
  ended: () => void;
  arranging?: () => boolean;
  order?: () => readonly string[];
  requireHold?: boolean;
  heldTouch?: (id: string, x: number, y: number) => void;
}
function visualCards(grid: HTMLElement, selector: string): HTMLElement[] {
  return [...grid.querySelectorAll<HTMLElement>(`:scope > ${selector}`)].sort((a, b) => Number(a.dataset.visualOrder ?? a.style.order ?? 0) - Number(b.dataset.visualOrder ?? b.style.order ?? 0));
}
export class DeviceDrag {
  private state?: DragState;
  private landing?: { state: DragState; animation?: Animation };
  private reflows = new Map<HTMLElement, Animation>();
  constructor(private callbacks: DragCallbacks, private surface:{grid:string;card:string;id:'deviceId'|'sceneId'}={grid:'.device-grid',card:'.device-card',id:'deviceId'}) {}
  private cards(grid:HTMLElement):HTMLElement[]{return visualCards(grid,this.surface.card);}
  private id(card:HTMLElement):string{return card.dataset[this.surface.id]!;}
  get active(): boolean { return !!this.state?.started || !!this.landing; }
  get dragging(): boolean { return !!this.state?.started; }
  /** A released pointer must not block a new action while the card lands. */
  settleLanding(): boolean {
    if (this.state) return false;
    const landing = this.landing;
    if (landing) {
      this.landing = undefined; landing.animation?.cancel(); this.clearFloating(landing.state);
      document.body.classList.remove('device-drag-active'); this.callbacks.ended();
    }
    return true;
  }
  cancel(): void {
    const state = this.state; this.state = undefined;
    if (state) {
      clearTimeout(state.timer); if (state.frame !== undefined) cancelAnimationFrame(state.frame);
      if (state.started) this.order(state.grid, state.original, false);
      this.clearFloating(state); delete state.card.dataset.interacting;
      if (state.card.hasPointerCapture(state.pointer)) state.card.releasePointerCapture(state.pointer);
    }
    if (this.landing) {
      const landing = this.landing; this.landing = undefined; landing.animation?.cancel();
      this.clearFloating(landing.state);
    }
    for (const animation of this.reflows.values()) animation.cancel(); this.reflows.clear();
    document.body.classList.remove('device-drag-active');
  }
  moveByKeyboard(card: HTMLElement, target: string): void {
    const grid = card.closest<HTMLElement>(this.surface.grid); if (!grid || this.active) return;
    const original=this.callbacks.order?.()??this.cards(grid).map(c=>this.id(c));
    const side=original.indexOf(target)<original.indexOf(this.id(card))?'before':'after';
    const ids=this.surface.id==='deviceId'?insertCardIds(original,this.id(card),target,side):moveDeviceIds(original,this.id(card),target);
    if (ids && this.callbacks.begin(this.id(card))) this.order(grid, ids, true, true);
  }
  bind(card: HTMLElement, id: string, locked: boolean): void {
    card.dataset[this.surface.id] = id; card.dataset.dragLocked = String(locked);
    card.addEventListener('dragstart', event => event.preventDefault());
    if (locked) return;
    card.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.state || (event.target as Element).closest('.device-shortcut,.card-control')) return;
      const landingRect=this.landing?.state.card===card?card.getBoundingClientRect():undefined;
      if(landingRect)this.landing?.animation?.pause();else this.settleLanding();
      const grid = card.closest<HTMLElement>(this.surface.grid); if (!grid) return;
      const rect = landingRect ?? card.getBoundingClientRect(), viewport = card.closest<HTMLElement>('.home-screen') ?? undefined;
      const state: DragState = { card, grid, id, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
        grabX: (event.clientX - rect.x) / Math.max(1, rect.width), grabY: (event.clientY - rect.y) / Math.max(1, rect.height),
        offsetX: 0, offsetY: 0, started: false, movedEarly: false,
        liftRect:landingRect,original: this.cards(grid).map(c => this.id(c)), scrollTop: viewport?.scrollTop ?? 0, viewport };
      this.state = state; card.setPointerCapture(event.pointerId);
      state.timer = setTimeout(() => this.start(state), CARD_HOLD_MS);
    });
    card.addEventListener('pointermove', event => {
      const state = this.state; if (!state || state.card !== card || state.pointer !== event.pointerId) return;
      state.x = event.clientX; state.y = event.clientY;
      if (Math.hypot(state.x-state.startX,state.y-state.startY)>=DRAG_START_DIP) state.moved = true;
      if (!state.started) {
        if (!state.moved) return;
        if (this.callbacks.requireHold || event.pointerType==='touch'&&!this.callbacks.arranging?.()) {
          clearTimeout(state.timer); state.movedEarly = true; return;
        }
        this.start(state);
        if (!state.started) return;
      }
      if (state.ghost) { event.preventDefault(); this.queueFrame(state); }
    });
    card.addEventListener('pointerup', event => this.end(event, card, true));
    card.addEventListener('pointercancel', event => this.end(event, card, false));
    card.addEventListener('lostpointercapture', event => this.end(event, card, false));
  }
  private start(state: DragState): void {
    if (this.state !== state || state.started || state.movedEarly || !state.card.isConnected) return;
    // Capture the visible press before the arrangement toolbar changes layout.
    const visible = state.liftRect ?? state.card.getBoundingClientRect();
    const transform = getComputedStyle(state.card).transform;
    const measuredScale = transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a;
    const scale = Number.isFinite(measuredScale) && measuredScale > 0 ? measuredScale : 1;
    const width = visible.width / scale, height = visible.height / scale;
    const rect = new DOMRect(state.startX - state.grabX * width, state.startY - state.grabY * height, width, height);
    if(this.landing?.state.card===state.card){
      const old=this.landing;this.landing=undefined;old.animation?.cancel();this.clearFloating(old.state);
      if(!state.card.hasPointerCapture(state.pointer)&&state.card.isConnected)try{state.card.setPointerCapture(state.pointer);}catch{/* The release event can also settle a short drag. */}
    }
    if(!this.callbacks.begin(state.id,true))return;
    state.original=[...(this.callbacks.order?.()??state.original)];
    clearTimeout(state.timer);
    state.started = true; state.card.dataset.interacting = 'true';
    state.scrollTop = state.viewport?.scrollTop ?? 0;
    state.viewportBounds=state.viewport?.getBoundingClientRect();
    state.offsetX = rect.x - state.startX; state.offsetY = rect.y - state.startY;
    state.baseGrid=state.grid.getBoundingClientRect();
    if(this.surface.id==='deviceId'){
      const {columns,width,height}=deviceGridTracks(state.grid);
      const sizes=Object.fromEntries(this.cards(state.grid).map(c=>[this.id(c),cardSize(c.dataset.cardSize)]));
      const slots=packCards(state.original,sizes,columns),base=state.baseGrid,half=(height-CARD_GAP)/2;
      state.baseRects=new Map(slots.map(slot=>[slot.id,new DOMRect(base.x+slot.column*(width+CARD_GAP),base.y+slot.row*(half+CARD_GAP),slot.columns*(width+CARD_GAP)-CARD_GAP,slot.rows*(half+CARD_GAP)-CARD_GAP)]));
      const band=Math.max(...slots.map(slot=>Math.floor(slot.row/2)));
      state.tail={top:base.y+band*(height+CARD_GAP),right:Math.max(...slots.filter(slot=>Math.floor(slot.row/2)===band).map(slot=>state.baseRects!.get(slot.id)!.right))};
    }else{
      for(const animation of this.reflows.values())animation.cancel();this.reflows.clear();
      state.baseRects=new Map(this.cards(state.grid).map(c=>[this.id(c),cardPressBounds(c)]));
    }
    state.ghostWidth=rect.width;state.ghostHeight=rect.height;
    this.lift(state, rect, scale);
  }
  private lift(state: DragState, rect: DOMRect, scale: number): void {
    this.reflows.get(state.card)?.cancel(); this.reflows.delete(state.card);
    cancelCardPress(state.card);
    // Keep the original card/image mounted throughout lift, movement and landing.
    // Only the empty grid slot is temporary; there is no clone-to-image handoff.
    const ghost = state.card, slot = document.createElement('div');
    slot.className = 'device-drag-slot drag-placeholder'; slot.dataset.dragFor = state.id; slot.setAttribute('aria-hidden', 'true');
    slot.style.height = `${rect.height}px`; slot.style.order = ghost.style.order;slot.style.gridColumn=ghost.style.gridColumn;slot.style.gridRow=ghost.style.gridRow;
    state.styles = Object.fromEntries(['width', 'height', 'left', 'top', 'translate', 'transform-origin'].map(key => [key, ghost.style.getPropertyValue(key)]));
    ghost.style.width = `${rect.width}px`; ghost.style.height = `${rect.height}px`; ghost.style.left = `${rect.x}px`; ghost.style.top = `${rect.y}px`;
    ghost.style.transformOrigin = `${state.grabX * rect.width}px ${state.grabY * rect.height}px`;
    this.translate(state, ghost);
    ghost.classList.add('device-drag-ghost'); ghost.before(slot); state.ghost = ghost; state.slot = slot;
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)state.raise=ghost.animate([{ transform: `scale(${scale})` }, { transform: 'scale(1.05)' }], { duration: CARD_SCALE_MS, easing: 'cubic-bezier(.2,.8,.2,1)' });
    const preview=document.createElement('div');preview.className='device-drop-preview';preview.setAttribute('aria-hidden','true');preview.style.setProperty('--drop-color',getComputedStyle(ghost).backgroundColor);preview.hidden=true;state.grid.append(preview);state.preview=preview;
    document.body.classList.add('device-drag-active');
    this.queueFrame(state);
  }
  private queueFrame(state:DragState):void{
    if(state.frame!==undefined)return;
    state.frame=requestAnimationFrame(()=>{
      state.frame=undefined;
      if(this.state!==state||!state.moved)return;
      const viewport=state.viewport,bounds=state.viewportBounds,before=viewport?.scrollTop;
      if(viewport&&bounds){
        const edge=60;
        if(state.y>bounds.bottom-edge)viewport.scrollBy(0,Math.min(12,(state.y-bounds.bottom+edge)/5));
        else if(state.y<bounds.top+edge)viewport.scrollBy(0,-Math.min(12,(bounds.top+edge-state.y)/5));
      }
      this.position(state);
      if(before!==viewport?.scrollTop)this.queueFrame(state);
    });
  }
  private clearFloating(state: DragState): void {
    state.raise?.cancel(); state.slot?.remove();state.preview?.remove(); state.card.classList.remove('device-drag-ghost','device-drag-landing');
    for (const [key, value] of Object.entries(state.styles ?? {})) value ? state.card.style.setProperty(key, value) : state.card.style.removeProperty(key);
    state.ghost = undefined; state.slot = undefined;
    if(state.grid.classList.contains('device-grid'))sizeDeviceGrid(state.grid);
  }
  private translate(state: DragState, ghost: HTMLElement): void {
    ghost.style.translate=`${state.x-state.startX}px ${state.y-state.startY}px`;
  }
  private position(state: DragState,final=false): void {
    const ghost = state.ghost; if (!ghost) return;
    this.translate(state, ghost);
    const scroll=state.viewport?.scrollTop??0;
    if(!final&&state.hitX===state.x&&state.hitY===state.y&&scroll===state.hitScroll)return;
    state.hitX=state.x;state.hitY=state.y;state.hitScroll=scroll;
    const centerX=state.x+state.offsetX+state.ghostWidth!/2,centerY=state.y+state.offsetY+state.ghostHeight!/2;
    const base=state.baseGrid!,shift=scroll-state.scrollTop,frames=state.baseRects!;
    const grid=new DOMRect(base.x,base.y-shift,base.width,base.height);
    if(this.surface.id==='deviceId'){
      this.positionDevice(state,grid,frames,centerX,centerY+shift);
      return;
    }
    const local=(r:DOMRect)=>new DOMRect(r.x,r.y-shift,r.width,r.height);
    const inside=centerX>=grid.left&&centerX<=grid.right&&centerY>=grid.top-20&&centerY<=grid.bottom+20;
    const target=inside?[...frames].find(([id,r])=>{const b=local(r);return id!==state.id&&centerX>=b.left&&centerX<=b.right&&centerY>=b.top&&centerY<=b.bottom;}):undefined;
    let next:string[]|undefined,invalid=false,key='outside',invalidRect:DOMRect|undefined;
    if(inside){
     if(target){key=target[0];if(state.candidateKey===key)return;next=moveDeviceIds(state.original,state.id,key);invalid=!next;invalidRect=local(target[1]);}
     else{const own=local(frames.get(state.id)!);const atOrigin=centerX>=own.left&&centerX<=own.right&&centerY>=own.top&&centerY<=own.bottom;
      key=atOrigin?'origin':'empty';next=atOrigin?[...state.original]:[...state.original.filter(id=>id!==state.id),state.id];}
    }
    if(state.candidateKey===key)return;state.candidateKey=key;state.candidate=next;
    const order=next??state.original;
    if(!(state.previewOrder??state.original).every((id,index)=>id===order[index]))this.order(state.grid,order,true);
    state.previewOrder=order;
    const preview=state.preview!;preview.hidden=!inside;preview.classList.toggle('invalid',invalid);
    if(inside){const r=invalidRect??state.slot!.getBoundingClientRect();Object.assign(preview.style,{left:`${r.x-grid.x}px`,top:`${r.y-grid.y}px`,width:`${r.width}px`,height:`${r.height}px`});}
  }
  private positionDevice(state:DragState,grid:DOMRect,frames:Map<string,DOMRect>,x:number,y:number):void{
    const base=state.baseGrid!;
    let key='outside',next:string[]|undefined;
    if(x>=base.left&&x<=base.right&&y>=base.top&&y<=base.bottom+20){
      const target=[...frames].find(([,rect])=>x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom);
      if(target?.[0]===state.id)key='origin';
      else if(target){
        const [id,rect]=target,offset=x-(rect.left+rect.width/2);
        const before=JSON.stringify([id,'before']),after=JSON.stringify([id,'after']);
        if(Math.abs(offset)<4&&(state.candidateKey===before||state.candidateKey===after))return;
        const side=(Math.abs(offset)<4?state.original.indexOf(id)<state.original.indexOf(state.id):offset<0)?'before':'after';
        key=side==='before'?before:after;
        next=insertCardIds(state.original,state.id,id,side);
      }else if(y>=base.bottom+CARD_GAP||y>=state.tail!.top&&y<=base.bottom&&x>=state.tail!.right+CARD_GAP){
        key='tail';next=insertCardIds(state.original,state.id);
      }else return; // A gutter keeps the previous candidate stable.
    }
    if(state.candidateKey===key)return;
    state.candidateKey=key;state.candidate=next;
    const order=next??state.original;
    if(!(state.previewOrder??state.original).every((id,index)=>id===order[index]))this.order(state.grid,order,true);
    state.previewOrder=order;
    const preview=state.preview!;preview.hidden=!next;
    if(next){const r=state.slot!.getBoundingClientRect();Object.assign(preview.style,{left:`${r.x-grid.x}px`,top:`${r.y-grid.y}px`,width:`${r.width}px`,height:`${r.height}px`});}
  }
  private order(grid: HTMLElement, ids: string[], animate: boolean,commit=false): void {
    const cards=this.cards(grid),deviceGrid=this.surface.id==='deviceId';
    const packed=deviceGrid?packCards(ids,Object.fromEntries(cards.map(c=>[this.id(c),cardSize(c.dataset.cardSize)])),deviceGridTracks(grid).columns):undefined;
    const slots=packed?new Map(packed.map(slot=>[slot.id,slot])):undefined;
    const moving=cards.filter(card=>{
      if(card.classList.contains('device-drag-ghost'))return false;
      if(!slots)return true;
      const slot=slots.get(this.id(card));
      return !!slot&&(card.style.gridColumn!==`${slot.column+1} / span ${slot.columns}`||card.style.gridRow!==`${slot.row+1} / span ${slot.rows}`);
    });
    const before=animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches?new Map(moving.map(card=>[card,card.getBoundingClientRect()])):undefined;
    for(const card of moving){this.reflows.get(card)?.cancel();this.reflows.delete(card);}
    const ranks = new Map(ids.map((id, index) => [id, index]));
    for (const card of cards) { const index = ranks.get(this.id(card)); if (index !== undefined) { card.style.order = String(index); card.dataset.reorderIndex = String(index); } }
    for (const slot of grid.querySelectorAll<HTMLElement>('.device-drag-slot')) { const index = ranks.get(slot.dataset.dragFor!); if (index !== undefined) slot.style.order = String(index); }
    if(deviceGrid)sizeDeviceGrid(grid,ids,false,packed);
    const after=before?new Map(moving.map(card=>[card,card.getBoundingClientRect()])):undefined;
    if(after)for(const card of moving){
      const first=before!.get(card)!,last=after.get(card)!,x=first.x-last.x,y=first.y-last.y;
      if (Math.abs(x) < .5 && Math.abs(y) < .5) continue;
      const animation = card.animate([{ translate: `${x}px ${y}px` }, { translate: 'none' }], { duration: CARD_REFLOW_MS, easing: 'cubic-bezier(.2,0,0,1)' });
      this.reflows.set(card, animation); void animation.finished.catch(() => {}).then(() => { if (this.reflows.get(card) === animation) this.reflows.delete(card); });
    }
    if(commit)this.callbacks.preview(ids);
  }
  private end(event: PointerEvent, card: HTMLElement, commit: boolean): void {
    const state = this.state; if (!state || state.card !== card || state.pointer !== event.pointerId) return;
    if (commit) {
      state.x=event.clientX; state.y=event.clientY;
      if (Math.hypot(state.x-state.startX,state.y-state.startY)>=DRAG_START_DIP) state.moved = true;
      if (!state.started && !state.movedEarly && state.moved) {
        if (this.callbacks.requireHold) state.movedEarly = true;
        else if (event.pointerType!=='touch') this.start(state);
      }
      if (state.started) this.position(state,true);
    }
    this.state = undefined; clearTimeout(state.timer); if (state.frame !== undefined) cancelAnimationFrame(state.frame);
    if (card.hasPointerCapture(state.pointer)) card.releasePointerCapture(state.pointer);
    if (state.started || state.movedEarly) {
      event.preventDefault(); event.stopPropagation();
      const suppress = (click: MouseEvent): void => { click.preventDefault(); click.stopImmediatePropagation(); };
      document.addEventListener('click', suppress, { capture: true, once: true }); setTimeout(() => document.removeEventListener('click', suppress, true), 0);
    }
    delete card.dataset.interacting;
    if (!state.started || !state.ghost) { this.settleLanding();document.body.classList.remove('device-drag-active'); this.callbacks.ended(); return; }
    const final=commit&&state.candidate?state.candidate:state.original;if(!(state.previewOrder??state.original).every((id,index)=>id===final[index]))this.order(state.grid,final,true);if(commit&&state.candidate)this.callbacks.preview([...state.candidate]);state.preview?.remove();
    const heldTouch = commit && event.pointerType === 'touch' && !state.moved;
    const ghost = state.ghost, bounds = state.slot!.getBoundingClientRect(), transform = getComputedStyle(ghost).transform, landing = { state, animation: undefined as Animation | undefined };
    state.raise?.cancel();
    this.landing = landing;
    const cleanup = (): void => {
      if (this.landing !== landing) return;
      this.landing = undefined; landing.animation?.cancel(); this.clearFloating(state); document.body.classList.remove('device-drag-active'); this.callbacks.ended();
      if (heldTouch) this.callbacks.heldTouch?.(state.id, state.x, state.y);
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { cleanup(); return; }
    ghost.classList.add('device-drag-landing');
    landing.animation = ghost.animate([{ translate: ghost.style.translate||'0px 0px', transform }, { translate: `${bounds.x-parseFloat(ghost.style.left)}px ${bounds.y-parseFloat(ghost.style.top)}px`, transform: 'scale(1)' }], { duration: 160, easing: 'cubic-bezier(.2,0,0,1)', fill: 'forwards' });
    void landing.animation.finished.then(cleanup, cleanup);
  }
}
