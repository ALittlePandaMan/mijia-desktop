"use client";
import {useEffect,type RefObject} from 'react';

/** Enhance offscreen content only; SSR and unsupported browsers stay readable. */
export function useScrollReveal(root:RefObject<HTMLElement|null>){
 useEffect(()=>{
  const page=root.current;
  if(!page||typeof IntersectionObserver==='undefined')return;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  if(motion.matches)return;
  const targets=[...page.querySelectorAll<HTMLElement>('[data-reveal]')];
  // Read geometry before adding any transforms. Already visible/restored content
  // must never disappear when hydration finishes.
  const initial=targets.map(target=>({target,top:target.getBoundingClientRect().top}));
  const pending=new Set<HTMLElement>();
  const show=(target:HTMLElement,animate:boolean)=>{
   if(!pending.has(target)&&target.dataset.revealState!=='revealed')return;
   pending.delete(target);observer.unobserve(target);
   target.dataset.revealState=animate?'revealed':'complete';
  };
  const observer=new IntersectionObserver(entries=>{
   for(const entry of entries)if(entry.isIntersecting)show(entry.target as HTMLElement,true);
  },{rootMargin:`0px 0px -${Math.min(100,Math.round(innerHeight*.15))}px 0px`,threshold:0});
  for(const {target,top} of initial){
   if(top<innerHeight){target.dataset.revealState='complete';continue;}
   pending.add(target);target.dataset.revealState='pending';observer.observe(target);
  }
  const focus=(event:FocusEvent)=>{
   const target=event.target instanceof Element?event.target.closest<HTMLElement>('[data-reveal]'):null;
   if(target&&page.contains(target))show(target,false);
  };
  const finished=(event:AnimationEvent)=>{
   if(event.animationName==='scroll-reveal-enter'&&event.target instanceof HTMLElement&&event.target.dataset.revealState==='revealed')event.target.dataset.revealState='complete';
  };
  const reduce=()=>{
   if(!motion.matches)return;
   observer.disconnect();for(const target of targets)show(target,false);
  };
  page.addEventListener('focusin',focus);page.addEventListener('animationend',finished);motion.addEventListener('change',reduce);
  return()=>{
   observer.disconnect();page.removeEventListener('focusin',focus);page.removeEventListener('animationend',finished);motion.removeEventListener('change',reduce);
   for(const target of targets)delete target.dataset.revealState;
  };
 },[root]);
}
