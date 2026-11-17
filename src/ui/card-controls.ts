import type {CardControl,HomeCardPresentation,Json} from '../types';
import {button,element} from './dom';

type Activate=(id:string,value:Json)=>void;
interface ControlNode {root:HTMLElement;update:(control:CardControl,activate:Activate)=>void;cancel:()=>void}
interface Mounted {header:HTMLElement;body:HTMLElement;key:string;nodes:Map<string,ControlNode>;presentation?:HomeCardPresentation;interactive:boolean;activate:Activate}
const mounted=new WeakMap<HTMLElement,Mounted>(),sizes=new WeakMap<HTMLElement,{width:number;height:number}>();
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const numberText=(v:unknown,unit='')=>typeof v==='number'?`${Number(v.toFixed(3))}${unit}`:'未读取';

/** Geometry arrives from the existing grid/host sizing path, never a layout read. */
export function fitCardControls(card:HTMLElement,width:number,height:number):void{
 sizes.set(card,{width,height});const state=mounted.get(card);if(!state)return;
 const p=state.presentation,compact=height<140,gap=compact?4:8,pad=compact?8:12,header=compact?40:52,row=compact?32:44;
 const fits=!!p&&p.rows.length>0&&p.rows.length<=3&&height>=pad*2+header+gap+p.rows.length*row+(p.rows.length-1)*gap
  &&p.rows.every(r=>r.reduce((sum,id)=>{const c=p.controls.find(c=>c.id===id);return sum+(c?.kind==='choices'?Math.max(1,c.options.length)*44+Math.max(0,c.options.length-1)*4:c?.kind==='stepper'||c?.kind==='slider'?112:64);},0)+Math.max(0,r.length-1)*gap<=width-pad*2);
 const shown=card.dataset.cardSize==='large'&&fits;
 card.classList.toggle('has-card-template',shown);card.classList.toggle('has-template-header',shown&&!!p?.headerControl);card.classList.toggle('card-template-compact',compact);
 state.header.hidden=!shown||!p?.headerControl;state.body.hidden=!shown;
 state.header.inert=state.body.inert=!shown||!state.interactive;
 if(!shown||!state.interactive)for(const node of state.nodes.values())node.cancel();
}
function createControl():ControlNode{
 const root=element('div','card-control');root.dataset.cardControl='';let model:CardControl,activate:Activate;
 let structure='',interacting=false,cancelled=false,pointer:number|undefined,initial='';
 let range:HTMLInputElement|undefined,valueNode:HTMLElement|undefined,observer:MutationObserver|undefined;
 const cancel=()=>{cancelled=true;if(interacting&&range){range.value=initial;showRange();}end(true);};
 const blur=()=>cancel();
 const end=(cancelledInteraction=false)=>{if(!interacting)return;interacting=false;pointer=undefined;cancelled=cancelledInteraction;delete root.dataset.interacting;window.removeEventListener('pointerup',up,true);window.removeEventListener('blur',blur);observer?.disconnect();observer=undefined;};
 const up=(event:PointerEvent)=>{if(event.pointerId===pointer)end();};
 const showRange=()=>{if(!range||!model.range)return;const value=Number(range.value);if(valueNode)valueNode.textContent=numberText(value,model.range.unit);root.style.setProperty('--control-progress',`${100*(value-model.range.min)/(model.range.max-model.range.min)}%`);};
 const send=(value:Json)=>{if(model.enabled&&root.isConnected)activate(model.id,value);};
 for(const name of ['pointerdown','pointerup','click','dblclick','contextmenu','keydown'] as const)root.addEventListener(name,e=>e.stopPropagation());
 const update=(next:CardControl,nextActivate:Activate)=>{
  model=next;activate=nextActivate;root.dataset.controlId=model.id;root.dataset.controlKind=model.kind;
  const key=JSON.stringify([model.kind,model.options]);
  if(key!==structure){cancel();structure=key;root.replaceChildren();range=undefined;valueNode=undefined;
   if(model.kind==='toggle'||model.kind==='action'){
    const b=button('',`card-control-button${model.kind==='toggle'?' card-control-power':''}`,()=>send(model.kind==='toggle'?!Boolean(model.value):model.value),model.kind==='toggle'?'power':undefined);
    if(model.kind==='action')b.append(element('span','card-control-action-label',model.label));root.append(b);
   }else if(model.kind==='choices'){
    for(const option of model.options)root.append(button(option.label,'card-control-choice',()=>send(option.value)));
   }else if(model.kind==='stepper'){
    const label=element('span','card-control-label',model.label);valueNode=element('strong','card-control-value');
    const step=(direction:number)=>{const r=model.range,v=model.value;if(!r||typeof v!=='number')return;send(Number(Math.max(r.min,Math.min(r.max,v+direction*r.step)).toFixed(8)));};
    const minus=button('','card-control-step',()=>step(-1),'minus'),plus=button('','card-control-step',()=>step(1),'plus');minus.setAttribute('aria-label','降低目标温度');plus.setAttribute('aria-label','升高目标温度');
    root.append(label,element('div','card-control-stepper',minus,valueNode,plus));
   }else{
    valueNode=element('span','card-control-value');range=element('input','card-control-slider');range.type='range';range.setAttribute('aria-label',model.label);
    root.append(element('div','card-control-slider-heading',element('span','card-control-label',model.label),valueNode),range);
    range.addEventListener('pointerdown',e=>{if(!model.enabled||e.button!==0||!range)return;interacting=true;cancelled=false;pointer=e.pointerId;initial=range.value;root.dataset.interacting='true';window.addEventListener('pointerup',up,true);window.addEventListener('blur',blur);observer=new MutationObserver(()=>{if(!root.isConnected)cancel();});observer.observe(document.documentElement,{childList:true,subtree:true});});
    range.addEventListener('input',showRange);
    range.addEventListener('blur',cancel);
    range.addEventListener('keydown',()=>{cancelled=false;});
    for(const name of ['pointercancel','lostpointercapture'] as const)range.addEventListener(name,e=>{if(e.pointerId===pointer)cancel();});
    range.addEventListener('change',()=>{if(range&&!cancelled&&model.enabled&&root.isConnected)send(Number(range.value));});
   }
  }
  root.setAttribute('aria-busy','false');root.classList.toggle('is-pending',!!model.pending);root.classList.toggle('is-on',model.kind==='toggle'&&model.value===true);
  root.title='';
  for(const b of root.querySelectorAll<HTMLButtonElement>('button'))b.disabled=!model.enabled;
  if(model.kind==='toggle'){const b=root.querySelector('button')!;b.setAttribute('aria-label',`${model.value===true?'关闭':'打开'}设备`);b.setAttribute('aria-pressed',model.value===null?'mixed':String(model.value===true));}
  if(model.kind==='action')root.querySelector('.card-control-action-label')!.textContent=model.label;
  if(model.kind==='choices')for(const [i,b]of [...root.querySelectorAll<HTMLButtonElement>('button')].entries()){const selected=equal(model.value,model.options[i].value);b.classList.toggle('is-selected',selected);b.setAttribute('aria-pressed',String(selected));}
  if(model.kind==='stepper'){
   if(valueNode)valueNode.textContent=numberText(model.value,model.range?.unit);
   const bs=root.querySelectorAll<HTMLButtonElement>('button'),v=model.value,r=model.range;
   bs[0].disabled=!model.enabled||typeof v!=='number'||!r||v<=r.min;bs[1].disabled=!model.enabled||typeof v!=='number'||!r||v>=r.max;
  }
  if(range&&model.range){range.disabled=!model.enabled;if(!interacting){range.min=String(model.range.min);range.max=String(model.range.max);range.step=String(model.range.step);if(typeof model.value==='number')range.value=String(model.value);showRange();if(model.value===null&&valueNode)valueNode.textContent='未读取';}}
 };
 return {root,update,cancel};
}
/** Patch controls in place, including after a size round trip or live readback. */
export function updateCardControls(card:HTMLElement,presentation:HomeCardPresentation|undefined,activate:Activate,interactive=true):void{
 let state=mounted.get(card);
 if(!state){const content=card.querySelector('.device-card-content');if(!content)return;
  state={header:element('div','card-template-header'),body:element('div','card-template-controls'),key:'',nodes:new Map(),interactive,activate};content.append(state.header,state.body);mounted.set(card,state);
 }
 state.presentation=presentation;state.interactive=interactive;state.activate=activate;
 const key=presentation?JSON.stringify([presentation.templateId,presentation.headerControl,presentation.rows]):'';
 if(key!==state.key){for(const node of state.nodes.values())node.cancel();state.header.replaceChildren();state.body.replaceChildren();state.nodes.clear();state.key=key;
  if(presentation){
   for(const c of presentation.controls)state.nodes.set(c.id,createControl());
   if(presentation.headerControl){const node=state.nodes.get(presentation.headerControl);if(node)state.header.append(node.root);}
   for(const row of presentation.rows){const line=element('div','card-control-row');for(const id of row){const node=state.nodes.get(id);if(node)line.append(node.root);}state.body.append(line);}
  }
 }
 for(const c of presentation?.controls??[])state.nodes.get(c.id)?.update({...c,enabled:c.enabled&&interactive},activate);
 const size=sizes.get(card);if(size)fitCardControls(card,size.width,size.height);
}
export function cancelCardControls(card:HTMLElement){for(const node of mounted.get(card)?.nodes.values()??[])node.cancel();}
