import type {CardControl,HomeCardPresentation,Json} from '../types';
import {missingReadingText} from '../logic';
import {button,element} from './dom';
import {bindRangeInteraction,brightnessSurface,curtainSliderSurface,setRangeReadout,temperatureSurface} from './adjustment-surfaces';
import {controlHeading} from './control-heading';

type Activate=(id:string,value:Json)=>void;
interface ControlNode {root:HTMLElement;update:(control:CardControl,activate:Activate)=>void;cancel:()=>void}
interface Mounted {header:HTMLElement;body:HTMLElement;key:string;nodes:Map<string,ControlNode>;presentation?:HomeCardPresentation;interactive:boolean;activate:Activate}
interface CardControlBounds {width:number;height:number;trackHeight:number;bottomInset:number;headerHeight:number;compactHeaderHeight:number}
const mounted=new WeakMap<HTMLElement,Mounted>(),sizes=new WeakMap<HTMLElement,CardControlBounds>();
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const numberText=(v:unknown,unit='')=>typeof v==='number'&&Number.isFinite(v)?`${Number(v.toFixed(3))}${unit}`:undefined;
const hasTrack=(control:CardControl|undefined)=>control?.kind==='slider'||control?.appearance==='temperature';

/** Geometry arrives from the existing grid/host sizing path, never a layout read. */
export function fitCardControls(card:HTMLElement,bounds:CardControlBounds):void{
 sizes.set(card,bounds);const state=mounted.get(card);if(!state)return;
 const p=state.presentation;
 const {width,height,trackHeight,bottomInset,headerHeight,compactHeaderHeight}=bounds;
 const bottomTrack=p?.rows.at(-1)?.some(id=>hasTrack(p.controls.find(control=>control.id===id)))??false;
 const fits=(compact:boolean)=>{
  if(!p?.rows.length||p.rows.length>3)return false;
  const gap=compact?4:8,pad=compact?8:12,row=compact?32:44;
  const header=compact&&bottomTrack?compactHeaderHeight+2:headerHeight+gap;
  let required=pad+(bottomTrack?bottomInset:pad)+header+(p.rows.length-1)*gap;
  for(const ids of p.rows){
   let w=Math.max(0,ids.length-1)*gap,h=row;
   for(const id of ids){
    const c=p.controls.find(c=>c.id===id);
    const temperature=c?.appearance==='temperature';
    w+=c?.kind==='choices'?Math.max(1,c.options.length)*44+Math.max(0,c.options.length-1)*4:temperature?Math.max(112,2*trackHeight+(compact?12:24)+32):c?.kind==='stepper'||c?.kind==='slider'?112:64;
    if(hasTrack(c))h=Math.max(h,trackHeight+(compact?16:20));
   }
   if(w>width-pad*2)return false;
   required+=h;
  }
  return height>=required;
 };
 const normal=fits(false),compact=!normal;
 const shown=card.dataset.cardSize==='large'&&(normal||fits(true));
 const header=shown&&state.header.querySelector('.device-shortcut')!==null;
 card.classList.toggle('has-card-template',shown);card.classList.toggle('has-template-header',header);card.classList.toggle('card-template-compact',compact);
 card.classList.toggle('has-template-track',shown&&bottomTrack);
 state.header.hidden=!header;state.body.hidden=!shown;
 state.header.inert=state.body.inert=!shown||!state.interactive;
 if(!shown||!state.interactive)for(const node of state.nodes.values())node.cancel();
}
function createControl(header=false):ControlNode{
 const root=element('div','card-control');root.dataset.cardControl='';let model:CardControl,activate:Activate;
 let structure='';
 let range:HTMLInputElement|undefined,valueNode:HTMLElement|undefined,gesture:ReturnType<typeof bindRangeInteraction>|undefined;
 let setRangeCaption:((text?:string)=>void)|undefined;
 let steps:HTMLButtonElement[]=[];
 const cancel=()=>gesture?.cancel();
 const showRange=(value:number|null=range?Number(range.value):null)=>{
  if(!range||!model.range)return;
  const fill=value===null?0:100*(value-model.range.min)/(model.range.max-model.range.min);
  const caption=numberText(value,model.range.unit);
  setRangeCaption?.(caption);
  setRangeReadout(range,caption);
  range.style.setProperty('--fill',`${fill}%`);
  root.style.setProperty('--control-progress',`${fill}%`);
  if(model.appearance==='curtain-position')root.style.setProperty('--curtain-progress',`${fill}%`);
 };
 const canActivate=()=>model.enabled&&(!(model.kind==='toggle'||model.kind==='choices')||model.value!==null);
 const send=(value:Json)=>{if(canActivate()&&root.isConnected)activate(model.id,value);};
 for(const name of ['pointerdown','pointerup','click','dblclick','contextmenu','keydown'] as const)root.addEventListener(name,e=>e.stopPropagation());
 const update=(next:CardControl,nextActivate:Activate)=>{
  model=next;activate=nextActivate;root.dataset.controlId=model.id;root.dataset.controlKind=model.kind;
  const key=JSON.stringify([model.kind,model.appearance,model.options]);
  if(key!==structure){cancel();structure=key;root.replaceChildren();range=undefined;gesture=undefined;valueNode=undefined;setRangeCaption=undefined;steps=[];
   root.dataset.appearance=model.appearance??'';
   if(model.kind==='toggle'||model.kind==='action'){
    const classes=model.kind==='toggle'&&header?'device-status device-shortcut card-control-power':`card-control-button${model.kind==='toggle'?' card-control-power':''}`;
    const b=button('',classes,()=>send(model.kind==='toggle'?!Boolean(model.value):model.value),model.kind==='toggle'?'power':undefined);
    if(model.kind==='action')b.append(element('span','card-control-action-label',model.label));
    if(model.kind==='toggle'&&!header)b.append(element('span','card-control-toggle-label',model.label));root.append(b);
   }else if(model.kind==='reading'){
    valueNode=element('strong','card-control-value');root.append(element('span','card-control-label',model.label),valueNode);
   }else if(model.kind==='choices'){
    for(const option of model.options)root.append(button(option.label,'card-control-choice',()=>send(option.value)));
   }else if(model.kind==='stepper'&&model.appearance!=='temperature'){
    const label=element('span','card-control-label',model.label);valueNode=element('strong','card-control-value');
    const step=(direction:number)=>{const r=model.range,v=model.value;if(!r||typeof v!=='number')return;send(Number(Math.max(r.min,Math.min(r.max,v+direction*r.step)).toFixed(8)));};
    const minus=button('','card-control-step',()=>step(-1),'minus'),plus=button('','card-control-step',()=>step(1),'plus');minus.setAttribute('aria-label','降低目标温度');plus.setAttribute('aria-label','升高目标温度');
    root.append(label,element('div','card-control-stepper',minus,valueNode,plus));
   }else{
    const temperature=model.appearance==='temperature',brightness=model.appearance?.endsWith('brightness'),curtain=model.appearance==='curtain-position';
    range=element('input',temperature||brightness||curtain?'':'card-control-slider');range.type='range';range.setAttribute('aria-label',model.label);
    const heading=controlHeading(model.label,{className:'card-control-slider-heading',titleClass:'card-control-label',valueClass:'card-control-value'});
    setRangeCaption=heading.setValue;
    root.append(heading.root);
    if(temperature){
     const surface=temperatureSurface(range,null,direction=>{
      if(!model.range||typeof model.value!=='number')return;
      const value=Number((model.value+direction*model.range.step).toFixed(8));
      if(value>=model.range.min&&value<=model.range.max)send(value);
     });
     steps=surface.buttons;root.append(surface.root);
    }else if(brightness)root.append(brightnessSurface(range,model.appearance==='rgb-brightness'?'rgb':'white'));
    else if(!curtain)root.append(range);
    const slider=range;
    gesture=bindRangeInteraction(slider,root,{preview:()=>showRange(),commit:()=>send(Number(slider.value))});
    if(curtain)root.append(curtainSliderSurface(slider,gesture.allowed,model.curtainOpening));
   }
  }
  root.setAttribute('aria-busy','false');root.classList.toggle('is-pending',!!model.pending);root.classList.toggle('is-on',model.kind==='toggle'&&model.value===true);
  for(const b of root.querySelectorAll<HTMLButtonElement>('button'))b.disabled=!canActivate();
  if(model.kind==='toggle'){const b=root.querySelector('button')!;b.classList.toggle('is-on',model.value===true);b.setAttribute('aria-label',`${model.value===true?'关闭':'打开'}${header?'设备':model.label}`);b.setAttribute('aria-pressed',model.value===null?'mixed':String(model.value===true));}
  if(model.kind==='action')root.querySelector('.card-control-action-label')!.textContent=model.label;
  if(model.kind==='reading'&&valueNode){
   valueNode.textContent=model.state||missingReadingText;
   valueNode.classList.toggle('reading-unavailable',valueNode.textContent===missingReadingText);
  }
  if(model.kind==='choices')for(const [i,b]of [...root.querySelectorAll<HTMLButtonElement>('button')].entries()){const selected=equal(model.value,model.options[i].value);b.classList.toggle('is-selected',selected);b.setAttribute('aria-pressed',String(selected));}
  if(model.kind==='stepper'&&!range){
   if(valueNode)valueNode.textContent=numberText(model.value,model.range?.unit)??'';
   const bs=root.querySelectorAll<HTMLButtonElement>('button'),v=model.value,r=model.range;
   bs[0].disabled=!model.enabled||typeof v!=='number'||!r||v<=r.min;bs[1].disabled=!model.enabled||typeof v!=='number'||!r||v>=r.max;
  }
  if(range){
   if(model.appearance==='curtain-position'){
    const track=range.parentElement!;
    const opening=model.curtainOpening??'double';
    if(track.dataset.curtainOpening!==opening){cancel();track.dataset.curtainOpening=opening;}
   }
   const r=model.range,value=typeof model.value==='number'&&Number.isFinite(model.value)?model.value:null;
   range.disabled=!model.enabled||!r||value===null;
   if(range.disabled&&gesture?.active)cancel();
   if(!gesture?.active&&r){range.min=String(r.min);range.max=String(r.max);range.step=String(r.step);range.value=String(value??r.min);showRange(value);}
   for(const [i,step] of steps.entries()){
    const next=value===null||!r?null:Number((value+(i===0?-1:1)*r.step).toFixed(8));
    step.disabled=range.disabled||!r||next===null||next<r.min||next>r.max;
   }
  }
 };
 return {root,update,cancel};
}
/** Patch controls in place, including after a size round trip or live readback. */
export function updateCardControls(card:HTMLElement,presentation:HomeCardPresentation|undefined,activate:Activate,interactive=true):void{
 if(card.dataset.batteryOnly==='true')presentation=undefined;
 let state=mounted.get(card);
 if(!state){const content=card.querySelector('.device-card-content');if(!content)return;
  state={header:element('div','card-template-header'),body:element('div','card-template-controls'),key:'',nodes:new Map(),interactive,activate};content.append(state.header,state.body);mounted.set(card,state);
 }
 state.presentation=presentation;state.interactive=interactive;state.activate=activate;
 const key=presentation?JSON.stringify([presentation.templateId,presentation.headerControl,presentation.rows]):'';
 if(key!==state.key){for(const node of state.nodes.values())node.cancel();state.header.replaceChildren();state.body.replaceChildren();state.nodes.clear();state.key=key;
  if(presentation){
   for(const c of presentation.controls)state.nodes.set(c.id,createControl(c.id===presentation.headerControl));
   if(presentation.headerControl){const node=state.nodes.get(presentation.headerControl);if(node)state.header.append(node.root);}
   for(const row of presentation.rows){const line=element('div','card-control-row');for(const id of row){const node=state.nodes.get(id);if(node)line.append(node.root);}state.body.append(line);}
  }
 }
 for(const c of presentation?.controls??[])state.nodes.get(c.id)?.update({...c,enabled:c.enabled&&interactive},activate);
 const bounds=sizes.get(card);if(bounds)fitCardControls(card,bounds);
}
export function cancelCardControls(card:HTMLElement){for(const node of mounted.get(card)?.nodes.values()??[])node.cancel();}
