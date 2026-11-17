import type {CardSize} from '../card-size';
import {fitCardControls} from './card-controls';
const clamp=(min:number,value:number,max:number)=>Math.max(min,Math.min(value,max));
export function cardMetrics(width:number,height:number,size:CardSize){
 const pad=clamp(12,Math.min(width*.06,height*.08),22),w=width-pad*2,h=height-pad*2,small=size==='small';
 return {title:small?clamp(13,(width-20)*.07,20):clamp(13,Math.min(w*.085,h*.14),24),room:small?clamp(10,(width-20)*.05,14):clamp(10,Math.min(w*.06,h*.10),16),art:small?clamp(32,(width-20)*.21,60):clamp(40,Math.min(w*.30,h*.42),90),symbol:clamp(30,Math.min(w*.24,h*.34),64),status:small?30:clamp(28,Math.min(w*.22,h*.30),44),dot:clamp(5,Math.min(w*.025,h*.04),7),padX:small?10:pad,padY:small?8:pad};
}
const states=new WeakMap<HTMLElement,{key:string;animations:Animation[];removeMedia?:()=>void}>();
/** Typography follows one medium cell, never the animated outer container. */
export function applyCardMetrics(card:HTMLElement,width:number,height:number,size:CardSize,animate=false){
 fitCardControls(card,size==='large'?width*2+12:width,size==='small'?(height-12)/2:height);
 const metrics=cardMetrics(width,height,size),key=JSON.stringify(metrics),prior=states.get(card);if(prior?.key===key)return;
 const specs:[string,Record<string,string>][]=[['h3',{fontSize:`${metrics.title}px`}],['.device-room',{fontSize:`${metrics.room}px`}],['.device-artwork,.device-product-image',{width:`${metrics.art}px`,height:`${metrics.art}px`}],['.device-artwork .icon',{width:`${metrics.symbol}px`,height:`${metrics.symbol}px`}],['.device-status',{width:`${metrics.status}px`,height:`${metrics.status}px`}],['.status-dot',{width:`${metrics.dot}px`,height:`${metrics.dot}px`}],['.device-card-content',{paddingLeft:`${metrics.padX}px`,paddingRight:`${metrics.padX}px`,paddingTop:`${metrics.padY}px`,paddingBottom:`${metrics.padY}px`}]];
 const transitions=animate&&!!prior&&!matchMedia('(prefers-reduced-motion: reduce)').matches?specs.flatMap(([selector,to])=>[...card.querySelectorAll<HTMLElement>(selector)].map(node=>{const style=getComputedStyle(node);return {node,to,from:Object.fromEntries(Object.keys(to).map(p=>[p,style[p as keyof CSSStyleDeclaration]])) as Keyframe};})):[];
 prior?.removeMedia?.();prior?.animations.forEach(a=>a.cancel());
 for(const [name,value]of Object.entries(metrics))card.style.setProperty(`--card-${name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}`,`${value}px`);
 const animations=transitions.filter(t=>Object.entries(t.to).some(([p,v])=>t.from[p]!==v)).map(t=>t.node.animate([t.from,t.to],{duration:300,easing:'cubic-bezier(.2,0,0,1)'}));const media=matchMedia('(prefers-reduced-motion: reduce)'),reduce=()=>{if(media.matches)cancelCardMetrics(card);};media.addEventListener('change',reduce);const removeMedia=()=>media.removeEventListener('change',reduce);states.set(card,{key,animations,removeMedia});void Promise.allSettled(animations.map(a=>a.finished)).then(removeMedia);
}
export function cancelCardMetrics(card:HTMLElement){const prior=states.get(card);prior?.removeMedia?.();prior?.animations.forEach(a=>a.cancel());}
