/** Page-local, deterministic work gate. It never decides visibility or device access. */
export class BackgroundWork {
 private listeners=new Set<(paused:boolean)=>void>();private stopped=false;
 get paused(){return this.stopped;}
 setPaused(paused:boolean):void{if(this.stopped===paused)return;this.stopped=paused;for(const listener of [...this.listeners])listener(paused);}
 subscribe(listener:(paused:boolean)=>void):()=>void{this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 get subscribers(){return this.listeners.size;}
}
export const backgroundWork=new BackgroundWork();
export interface ResourceState {version:number;revision:number;visible:boolean;refreshMs:number;visibleCards?:string[];monitorBackground?:boolean}
/** Window coverage and document visibility are not a reason to reset monitor playback. */
export function monitorInBackground(native:boolean|undefined,windowHidden:boolean,trayBackground:boolean):boolean{
 return native??(windowHidden||trayBackground);
}
/** Platform state is authoritative. Ignore delayed events from an older transition. */
export class ResourceRevisions {
 private revision=-1;
 accept(state:ResourceState):boolean{if(state.version!==1||!Number.isSafeInteger(state.revision)||state.revision<this.revision)return false;this.revision=state.revision;return true;}
}
const pausedAnimations=new WeakMap<HTMLElement,Map<Animation,{time:number;at:number}>>();
export function setVisualWorkPaused(root:HTMLElement,paused:boolean):void{
 if(root.dataset.resourcePaused===String(paused))return;
 root.dataset.resourcePaused=String(paused);
 const savedAnimations=pausedAnimations.get(root)??new Map<Animation,{time:number;at:number}>();
 if(paused){pausedAnimations.set(root,savedAnimations);for(const animation of root.getAnimations?.({subtree:true})??[]){if(animation.playState==='running'&&!savedAnimations.has(animation)){savedAnimations.set(animation,{time:Number(animation.currentTime)||0,at:performance.now()});try{animation.pause();}catch{/* Detached animation. */}}}}
 else{
  for(const[animation,saved]of savedAnimations){try{if(animation.playState==='paused'){const time=saved.time+performance.now()-saved.at,end=Number(animation.effect?.getComputedTiming().endTime);if(Number.isFinite(end)&&time>=end)animation.finish();else{animation.currentTime=time;animation.play();}}}catch{/* Detached animation. */}}
  pausedAnimations.delete(root);
 }
}
