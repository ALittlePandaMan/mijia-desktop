import type {HostFrame,HostCard} from './desktop-widgets';
/** Bounded by live card identities, even if the WebView cannot paint a frame. */
export class HostFrames {
 private revision=-1;private reset=false;private viewport?:HostFrame['viewport'];private hints:HostFrame['hints'];private cards=new Map<string,HostCard>();private removed=new Set<string>();private painted=new Set<string>();
 push(next:HostFrame):boolean{
  if(next.revision<this.revision)return false;
  this.revision=next.revision;this.viewport=next.viewport;this.hints=next.hints;
  if(next.reset){this.reset=true;this.cards.clear();this.removed.clear();}
  for(const id of next.removed){this.cards.delete(id);if(!this.reset&&this.painted.has(id))this.removed.add(id);}
  for(const card of next.cards){this.removed.delete(card.view.id);this.cards.set(card.view.id,card);}
  return true;
 }
 drain():HostFrame|undefined{if(!this.viewport)return;const frame={revision:this.revision,reset:this.reset,viewport:this.viewport,cards:[...this.cards.values()],removed:[...this.removed],hints:this.hints};if(this.reset)this.painted.clear();for(const id of this.removed)this.painted.delete(id);for(const id of this.cards.keys())this.painted.add(id);this.reset=false;this.viewport=undefined;this.cards.clear();this.removed.clear();return frame;}
 get bufferedIdentities(){return this.cards.size+this.removed.size;}
}
