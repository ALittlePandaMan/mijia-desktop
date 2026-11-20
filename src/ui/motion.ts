type MotionKind='page'|'popup';
const exits=new Map<HTMLElement,()=>void>();
export function motionDuration(kind:'fast'|'medium'|'page',fallback:number):number {
 const value=parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--motion-${kind}`));
 return Number.isFinite(value)?value:fallback;
}
export function enter(node:HTMLElement,kind:MotionKind):void {
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const name=kind==='page'?'motion-page-enter':'motion-popup-enter';node.classList.add(name);
 const done=(event:AnimationEvent)=>{if(event.target!==node)return;node.classList.remove(name);node.removeEventListener('animationend',done);node.removeEventListener('animationcancel',done);};
 node.addEventListener('animationend',done);node.addEventListener('animationcancel',done);
}
/** Exit affects only explicit navigation; device command callbacks never await it. */
export function leave(node:HTMLElement|null,done:()=>void):void {
 if(!node||node.querySelector('video')||matchMedia('(prefers-reduced-motion: reduce)').matches){done();return;}
 if(exits.has(node))return;
 const animation=node.animate([{opacity:1,transform:'none'},{opacity:0,transform:'translateY(4px)'}],{duration:motionDuration('page',220),easing:'ease-out'});
 const finish=()=>{if(!exits.delete(node))return;animation.cancel();done();};
 exits.set(node,finish);void animation.finished.then(finish,finish);
}
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const changed=()=>{if(reduced.matches)for(const finish of [...exits.values()])finish();};
reduced.addEventListener('change',changed);
window.addEventListener('pagehide',()=>{reduced.removeEventListener('change',changed);for(const finish of [...exits.values()])finish();},{once:true});
