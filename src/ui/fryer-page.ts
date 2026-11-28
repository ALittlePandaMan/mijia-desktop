import {dismissOnBackdrop} from './dialog-dismiss';
import './fryer-page.css';
import {fryerModes,fryerMode,fryerDraft,fryerActive,fryerCooking,fryerRange,fryerSettingsProblem,fryerRemaining,fryerFinish,fryerClock,fryerReservationProblem,fryerStatus,type FryerState,type FryerView,type FryerDraft} from '../fryer';
import type {Device} from '../types';
import {element,button} from './dom';
import {icon} from '../icons';
import {purifierWheel} from './purifier-wheel';
import {reservationPicker,trapWheelDialog} from './reservation-picker';
import {actionFooter,footerButton} from './action-footer';
import cookingAnimation from '../assets/mijia/fryer/cooking-bubbles.svg?raw';
const images=import.meta.glob('../assets/mijia/fryer/*.png',{eager:true,query:'?url',import:'default'}) as Record<string,string>;
export function fryerModeArtwork(mode:number,kind:'icon'|'image'){const img=element('img','fryer-mode-art');img.src=images[`../assets/mijia/fryer/${mode}-${kind}.png`];img.alt='';img.draggable=false;return img;}
const bubbleNodes=new WeakMap<object,HTMLElement>();
export function cookingBubbles(state:object,playing:boolean):HTMLElement {
 let node=bubbleNodes.get(state);
 if(!node){node=element('div','fryer-bubbles');node.setAttribute('aria-hidden','true');node.innerHTML=cookingAnimation;bubbleNodes.set(state,node);}
 const svg=node.querySelector('svg')!;
 queueMicrotask(()=>{if(!node?.isConnected)return;const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;if(!playing||reduced){svg.pauseAnimations();if(reduced)svg.setCurrentTime(0);}else svg.unpauseAnimations();});
 return node;
}
export type FryerSetting='temperature'|'time';
const settingNames:Record<FryerSetting,string>={temperature:'烹饪温度',time:'烹饪时间'};
export function fryerDetailHero(art:HTMLElement|undefined,title:string|undefined,finish?:string):HTMLElement{
 return element('div','fryer-hero',art,title?element('h3','',title):null,finish?element('p','fryer-finish',finish):null);
}
export function fryerSettingRow(kind:FryerSetting,value:string|undefined,open:()=>void,disabled:boolean):HTMLButtonElement{
 const label=settingNames[kind],row=button('','fryer-field',()=>{if(!row.disabled)open();});
 row.disabled=disabled;row.setAttribute('aria-label',label);row.dataset.focusKey=`fryer-${kind}`;
 row.append(element('span','',label),element('span','fryer-field-value',value),icon('chevron'));
 return row;
}
export function fryerWarmRow(value:boolean|undefined,change:()=>void,disabled:boolean):HTMLButtonElement{
 const row=button('','fryer-field fryer-warm',change);
 row.setAttribute('role','switch');row.setAttribute('aria-label','自动保温');row.setAttribute('aria-checked',String(value===true));
 row.disabled=disabled;row.dataset.focusKey='fryer-keep-warm';
 row.append(element('span','fryer-field-copy',element('span','','自动保温'),element('small','','烹饪完成后将开启自动保温')),
  element('span',`fryer-switch${value===true?' checked':''}`,element('i')));
 return row;
}
function fryerDurationWheels(range:readonly [number,number,number],value:number,select:(seconds:number)=>void):HTMLElement[]|undefined {
 const [min,max,step]=range,start=Math.floor(min/60),end=Math.floor(max/60);
 if(!range.every(Number.isInteger)||min<0||end-start>1440)return;
 const secondsFor=(minute:number)=>{
  const base=minute*60,first=min+Math.max(0,Math.ceil((base-min)/step))*step,last=Math.min(base+59,max);
  return first>last?[]:Array.from({length:Math.floor((last-first)/step)+1},(_,index)=>first+index*step-base);
 };
 const minutes=Array.from({length:end-start+1},(_,index)=>start+index).filter(minute=>secondsFor(minute).length);
 if(!minutes.length)return;
 let minute=Math.floor(value/60),second=value%60;
 const seconds=purifierWheel('秒',secondsFor(minute),second,next=>{second=next;select(minute*60+second);},n=>`${n}秒`);
 const minuteWheel=purifierWheel('分钟',minutes,minute,next=>{
  if(next===minute)return;
  minute=next;
  const valid=secondsFor(minute);
  if(!valid.includes(second))second=valid[0];
  seconds.setValues(valid,second);
  select(minute*60+second);
 },n=>`${n}分`);
 return [minuteWheel.node,seconds.node];
}
export function fryerValuePicker(p:{kind:FryerSetting;value:number;range?:readonly [number,number,number];values?:number[];seconds?:boolean;
 format:(value:number)=>string;blocked?:boolean;problem?:(value:number)=>string|undefined;apply:(value:number)=>void;close:()=>void}):HTMLElement{
 const label=settingNames[p.kind],overlay=element('div','fryer-backdrop'),dialog=element('section','fryer-dialog',element('h3','',label));
 dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',label);
 const legal=(n:number)=>{
  if(!Number.isFinite(n))return false;
  if(p.values)return p.values.includes(n);
  if(!p.range)return false;
  const [min,max,step]=p.range,index=(n-min)/step;
  return n>=min&&n<=max&&Math.abs(index-Math.round(index))<1e-7;
 };
 let value=legal(p.value)?p.value:p.values?.[0]??p.range?.[0]??NaN;
 const confirm=button('确定','primary',()=>{if(!confirm.disabled)p.apply(value);});
 const select=(next:number)=>{value=next;confirm.disabled=!!p.blocked||!legal(next)||!!p.problem?.(next);};
 const count=p.range?Math.floor((p.range[1]-p.range[0])/p.range[2]+1e-8)+1:0;
 const values=p.values??(p.range&&count<=1441?Array.from({length:count},(_,i)=>Number((p.range![0]+i*p.range![2]).toFixed(8))):undefined);
 if(values?.length){
  const wheel=purifierWheel(p.kind==='temperature'?'温度':'时间',values,value,select,p.format);
  dialog.append(element('div','fryer-wheels',wheel.node));
 }else if(p.range){
  const wheels=p.seconds?fryerDurationWheels(p.range,value,select):undefined;
  if(wheels)dialog.append(element('div','fryer-wheels',...wheels));
  else {
   const input=element('input','fryer-number-value');
   input.type='number';input.min=String(p.range[0]);input.max=String(p.range[1]);input.step=String(p.range[2]);input.value=String(value);
   input.setAttribute('aria-label',label);input.addEventListener('input',()=>select(input.validity.valid?input.valueAsNumber:NaN));
   dialog.append(element('div','fryer-wheels',input));
  }
 }
 select(value);dialog.append(element('footer','',button('取消','',p.close),confirm));
 dismissOnBackdrop(overlay,p.close);overlay.append(dialog);trapWheelDialog(dialog,p.close);return overlay;
}
export function fryerStopDialog(reserved:boolean,close:()=>void,stop:()=>void,disabled=false):HTMLElement{
 const confirm=button('确定','primary',stop);confirm.disabled=disabled;
 const dialog=element('section','fryer-dialog fryer-stop-dialog',element('h3','',reserved?'取消本次预约？':'终止本次烹饪？'),
  element('footer','',button('取消','',close),confirm));
 dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',reserved?'取消预约':'终止烹饪');
 const overlay=element('div','fryer-backdrop',dialog);dismissOnBackdrop(overlay,close);trapWheelDialog(dialog,close);return overlay;
}
interface Props {device:Device;state:FryerState;view:FryerView;changed:()=>void;back:()=>void}
export function fryerPage(p:Props):HTMLElement {
 const r=p.state.report,v=p.view,actual=p.state.actual,m=v.draft?fryerMode(v.draft.mode):undefined,current=!!r&&!!m&&r.mode===m.mode&&fryerActive(r.status),blocked=!p.device.online||!!p.device.sharedReadOnly||!actual||p.state.taskPending||!!r?.fault;
 const stage=element('div','device-stage'),page=element('section','device-page page-fryer'),header=element('header','device-page-header'),back=button('','page-icon-button',()=>{if(v.draft){v.draft=undefined;v.picker=undefined;p.changed();}else p.back();},'back');
 back.setAttribute('aria-label',v.draft?'返回模式':'返回家庭');header.append(back,element('div','device-page-title',element('h2','',m?.label??p.device.name)));page.append(header);stage.append(page);
 const body=element('div',`device-page-scroll fryer-content ${m?'fryer-detail':'fryer-home'}`);page.append(body);
 const problem=!p.device.online?'设备离线':p.device.sharedReadOnly?'此共享设备仅有读取权限':p.state.error&&['authExpired','permissionDenied','unsupported','invalidInput','invalidValue','conflict'].includes(p.state.error.kind)?p.state.error.message:r?.fault?'设备存在故障，请检查空气炸锅。':undefined;
 if(problem)body.append(element('p','fryer-error',problem));
 const open=(id:number)=>{const mode=fryerMode(id);if(mode){v.draft=fryerDraft(mode,r);p.changed();}};
 if(!m){
  if(r&&fryerActive(r.status)){
   const task=button('','fryer-task',()=>open(r.mode));task.disabled=!fryerMode(r.mode);task.append(element('span','fryer-task-icon',icon('clock')),element('span','fryer-task-copy',element('strong','',`${fryerMode(r.mode)?.label??'当前任务'}${fryerStatus(r)}`),element('small','',taskTime(r))),icon('chevron'));body.append(task);
  }
  const card=element('section','fryer-modes');card.append(element('p','fryer-section-title','设备上的模式'));
  const grid=element('div','fryer-mode-grid');for(const mode of fryerModes){const b=button('','fryer-mode',()=>open(mode.mode));b.dataset.mode=String(mode.mode);b.append(fryerModeArtwork(mode.mode,'icon'),element('span','',mode.label));grid.append(b);}card.append(grid);
  body.append(card);return stage;
 }
 const draft:FryerDraft=current?{mode:m.mode,minutes:r!.minutes,temperature:r!.temperature,keepWarm:r!.keepWarm??false}:v.draft!;
 const running=current&&r;
 const art=running&&(fryerCooking(r.status)||[2,9].includes(r.status))?cookingBubbles(p.state,fryerCooking(r.status)):fryerModeArtwork(m.mode,'image');
 body.append(fryerDetailHero(art,running?fryerStatus(r):`大约需要 ${draft.minutes} 分钟`,running?taskTime(r):undefined));
 const fields=element('section','fryer-fields');
 const normalized=(patch:Partial<FryerDraft>)=>{const next={...draft,...patch},max=fryerRange(m,next.temperature).minutes[1];next.minutes=Math.min(max,next.minutes);if(next.temperature<=80||!m.keepWarm||!r?.autoKeepWarm)next.keepWarm=false;return next;};
 const edit=(patch:Partial<FryerDraft>)=>{const next=normalized(patch);
  if(fryerSettingsProblem(next,current?r:undefined))return;
  if(current)void p.state.change({operation:'adjust',minutes:next.minutes,temperature:next.temperature,keepWarm:next.keepWarm});else v.draft=next;p.changed();};
 const editable=!blocked&&(!r||!fryerActive(r.status)||current&&r.keepWarm!==null&&r.recipeId===m.recipeId&&([2,3,9].includes(r.status)||fryerCooking(r.status)));
 if(m.keepWarm)fields.append(fryerWarmRow(draft.keepWarm,()=>edit({keepWarm:!draft.keepWarm}),!editable||draft.temperature<=80||!r?.autoKeepWarm||current&&r.keepWarm===null));
 for(const kind of ['temperature','time']as const)fields.append(fryerSettingRow(kind,kind==='temperature'?`${draft.temperature}℃`:`${draft.minutes}分钟`,()=>{v.picker=kind;p.changed();},!editable));
 body.append(fields);
 const actions=actionFooter('fryer-actions');
 if(current&&r){const stop=footerButton(r.status===3?'取消预约':'终止',()=>{v.confirmation='stop';p.changed();});stop.disabled=!p.device.online||!!p.device.sharedReadOnly||!actual||p.state.taskPending;actions.append(stop);
  if(fryerCooking(r.status)||r.status===2){
   const resume=r.status===2;
   const action=footerButton(resume?'继续':'暂停',()=>void p.state.change({operation:resume?'resume':'pause'}),'primary');
   action.classList.add('action-white-text');action.disabled=blocked;actions.append(action);
  }
 }else{
  if(m.reservation){const b=footerButton('预约',()=>{v.picker='reservation';p.changed();});b.disabled=blocked||!!r&&fryerActive(r.status)||!!fryerSettingsProblem(draft,r);actions.append(b);}
  const start=footerButton('开始',()=>void p.state.change({operation:'start',...draft,finishAt:null}),'primary');start.disabled=blocked||!!r&&fryerActive(r.status)||!!fryerSettingsProblem(draft,r);actions.append(start);
 }body.append(actions);
 if(v.picker){
  const kind=v.picker,close=()=>{v.picker=undefined;p.changed();};
  if(kind==='reservation'){
   page.append(reservationPicker({durationMinutes:draft.minutes,earliestAt:Date.now()/1000+draft.minutes*60,blocked,close,
    problem:at=>fryerReservationProblem(at,draft.minutes),submit:finishAt=>{close();void p.state.change({operation:'start',...draft,finishAt});}}));
  }else{
   const range=kind==='temperature'?fryerRange(m,draft.temperature).temperature:fryerRange(m,draft.temperature).minutes;
   const patch=(value:number)=>kind==='temperature'?{temperature:value}:{minutes:value};
   page.append(fryerValuePicker({kind,range,value:kind==='temperature'?draft.temperature:draft.minutes,blocked:!editable,
    format:n=>`${n}${kind==='temperature'?'℃':'分'}`,problem:n=>fryerSettingsProblem(normalized(patch(n)),current?r:undefined),
    apply:n=>{v.picker=undefined;edit(patch(n));},close}));
  }
 }
 if(v.confirmation){const close=()=>{v.confirmation=undefined;p.changed();};page.append(fryerStopDialog(r?.status===3,close,()=>{close();void p.state.change({operation:'stop'});},!p.device.online||!!p.device.sharedReadOnly||!actual||p.state.taskPending));}
 return stage;
}
function taskTime(r:NonNullable<FryerState['report']>):string {const finish=fryerFinish(r);if(finish!==undefined)return`${fryerClock(finish)} 完成`;if([2,8,9,11].includes(r.status))return`剩余 ${Math.ceil(fryerRemaining(r)/60)} 分钟`;return'';}
