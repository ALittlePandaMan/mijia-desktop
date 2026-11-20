import {button,element} from './dom';
/** Original scroll-snap picker; selection is a local draft until its parent
 * dialog is confirmed. Uses logical scroll coordinates under the page zoom. */
export function purifierWheel(label:string,initial:number[],value:number,changed:(value:number)=>void,format:(value:number)=>string=String){
 const node=element('div','purifier-wheel');node.tabIndex=0;node.setAttribute('role','listbox');node.setAttribute('aria-label',label);
 let values=initial,index=0,timer:ReturnType<typeof setTimeout>|undefined;
 const mark=()=>{node.dataset.value=String(values[index]);[...node.children].forEach((child,i)=>{child.classList.toggle('selected',i===index);child.setAttribute('aria-selected',String(i===index));});};
 const choose=(next:number,scroll=true)=>{index=Math.max(0,Math.min(values.length-1,next));mark();changed(values[index]);if(scroll)node.scrollTo({top:index*42,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});};
 const setValues=(next:number[],selected:number)=>{values=next;index=Math.max(0,values.indexOf(selected));node.replaceChildren(...values.map((v,i)=>{const option=button(format(v),'purifier-wheel-option',()=>choose(i));option.tabIndex=-1;option.setAttribute('role','option');return option;}));mark();requestAnimationFrame(()=>{if(node.isConnected)node.scrollTop=index*42;});};
 node.addEventListener('scroll',()=>{clearTimeout(timer);timer=setTimeout(()=>{if(node.isConnected)choose(Math.round(node.scrollTop/42),false);},100);});
 node.addEventListener('keydown',e=>{const next=e.key==='ArrowDown'?index+1:e.key==='ArrowUp'?index-1:e.key==='Home'?0:e.key==='End'?values.length-1:undefined;if(next!==undefined){e.preventDefault();choose(next);}});
 setValues(initial,value);return{node,setValues};
}
