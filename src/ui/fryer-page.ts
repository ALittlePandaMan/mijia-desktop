import {dismissOnBackdrop} from './dialog-dismiss';
import './fryer-page.css';
import {fryerModes,fryerMode,fryerDraft,fryerActive,fryerCooking,fryerRange,fryerSettingsProblem,fryerRemaining,fryerFinish,fryerClock,fryerReservationProblem,fryerStatus,type FryerState,type FryerView,type FryerDraft} from '../fryer';
import type {Device} from '../types';
import {element,button} from './dom';
import {icon} from '../icons';
import {purifierWheel} from './purifier-wheel';
import cookingAnimation from '../assets/mijia/fryer/cooking-bubbles.svg?raw';
const images=import.meta.glob('../assets/mijia/fryer/*.png',{eager:true,query:'?url',import:'default'}) as Record<string,string>;
function art(mode:number,kind:'icon'|'image'){const img=element('img','fryer-mode-art');img.src=images[`../assets/mijia/fryer/${mode}-${kind}.png`];img.alt='';img.draggable=false;return img;}
const bubbleNodes=new WeakMap<FryerState,HTMLElement>();
function bubbles(state:FryerState,playing:boolean):HTMLElement {
 let node=bubbleNodes.get(state);
 if(!node){node=element('div','fryer-bubbles');node.setAttribute('aria-hidden','true');node.innerHTML=cookingAnimation;bubbleNodes.set(state,node);}
 const svg=node.querySelector('svg')!;
 queueMicrotask(()=>{if(!node?.isConnected)return;const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;if(!playing||reduced){svg.pauseAnimations();if(reduced)svg.setCurrentTime(0);}else svg.unpauseAnimations();});
 return node;
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
  const grid=element('div','fryer-mode-grid');for(const mode of fryerModes){const b=button('','fryer-mode',()=>open(mode.mode));b.dataset.mode=String(mode.mode);b.append(art(mode.mode,'icon'),element('span','',mode.label));grid.append(b);}card.append(grid);
  body.append(card);return stage;
 }
 const draft:FryerDraft=current?{mode:m.mode,minutes:r!.minutes,temperature:r!.temperature,keepWarm:r!.keepWarm??false}:v.draft!;
 const running=current&&r,hero=element('div','fryer-hero');
 if(running&&(fryerCooking(r.status)||[2,9].includes(r.status)))hero.append(bubbles(p.state,fryerCooking(r.status)));else hero.append(art(m.mode,'image'));
 hero.append(element('h3','',running?fryerStatus(r):`大约需要 ${draft.minutes} 分钟`));
 if(running)hero.append(element('p','fryer-finish',taskTime(r)));body.append(hero);
 const fields=element('section','fryer-fields');
 const normalized=(patch:Partial<FryerDraft>)=>{const next={...draft,...patch},max=fryerRange(m,next.temperature).minutes[1];next.minutes=Math.min(max,next.minutes);if(next.temperature<=80||!m.keepWarm||!r?.autoKeepWarm)next.keepWarm=false;return next;};
 const edit=(patch:Partial<FryerDraft>)=>{const next=normalized(patch);
  if(fryerSettingsProblem(next,current?r:undefined))return;
  if(current)void p.state.change({operation:'adjust',minutes:next.minutes,temperature:next.temperature,keepWarm:next.keepWarm});else v.draft=next;p.changed();};
 const editable=!blocked&&(!r||!fryerActive(r.status)||current&&r.keepWarm!==null&&r.recipeId===m.recipeId&&([2,3,9].includes(r.status)||fryerCooking(r.status)));
 if(m.keepWarm){const row=button('','fryer-field fryer-warm',()=>edit({keepWarm:!draft.keepWarm}));row.setAttribute('role','switch');row.setAttribute('aria-label','自动保温');row.setAttribute('aria-checked',String(draft.keepWarm));row.disabled=!editable||draft.temperature<=80||!r?.autoKeepWarm||current&&r.keepWarm===null;
  row.append(element('span','fryer-field-copy',element('span','','自动保温'),element('small','','烹饪完成后将开启自动保温')),element('span',`fryer-switch${draft.keepWarm?' checked':''}`,element('i')));fields.append(row);}
 for(const kind of ['temperature','time']as const){const row=button('','fryer-field',()=>{v.picker=kind;p.changed();});row.disabled=!editable;row.setAttribute('aria-label',kind==='temperature'?'烹饪温度':'烹饪时间');row.append(element('span','',kind==='temperature'?'烹饪温度':'烹饪时间'),element('span','fryer-field-value',kind==='temperature'?`${draft.temperature}℃`:`${draft.minutes}分钟`),icon('chevron'));fields.append(row);}body.append(fields);
 const actions=element('footer','fryer-actions');
 if(current&&r){const stop=button(r.status===3?'取消预约':'终止','',()=>{v.confirmation='stop';p.changed();});stop.disabled=!p.device.online||!!p.device.sharedReadOnly||!actual||p.state.taskPending;actions.append(stop);
  if(fryerCooking(r.status)||r.status===2){const b=button(r.status===2?'继续':'暂停','primary',()=>void p.state.change({operation:r.status===2?'resume':'pause'}));b.disabled=blocked;actions.append(b);}
 }else{
  if(m.reservation){const b=button('预约','',()=>{v.picker='reservation';p.changed();});b.disabled=blocked||!!r&&fryerActive(r.status)||!!fryerSettingsProblem(draft,r);actions.append(b);}
  const start=button('开始','primary',()=>void p.state.change({operation:'start',...draft,finishAt:null}));start.disabled=blocked||!!r&&fryerActive(r.status)||!!fryerSettingsProblem(draft,r);actions.append(start);
 }body.append(actions);
 if(v.picker){const kind=v.picker,overlay=element('div','fryer-backdrop'),dialog=element('section','fryer-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',kind==='reservation'?'预约完成时间':kind==='temperature'?'烹饪温度':'烹饪时间');const close=()=>{v.picker=undefined;p.changed();};let save:()=>void;const confirm=button('确定','primary',()=>save());
  if(kind==='reservation'){
   const title=element('h3'),subtitle=element('p','fryer-reservation-start');dialog.append(title,subtitle);const now=new Date(),initial=new Date(Math.ceil((Date.now()+draft.minutes*60000)/60000)*60000);let day=initial.toDateString()===now.toDateString()?0:1,hour=initial.getHours(),minute=initial.getMinutes();
   const at=()=>{const d=new Date(now);d.setDate(d.getDate()+day);d.setHours(hour,minute,0,0);return d.getTime()/1000;};
   const update=()=>{const end=at(),why=fryerReservationProblem(end,draft.minutes);title.textContent=why??`预计${fryerClock(end,undefined,true)} 完成`;subtitle.textContent=why?'':`开始时间${fryerClock(end-draft.minutes*60,undefined,true)}`;confirm.disabled=!!why||blocked;};
   const days=purifierWheel('日期',[0,1],day,n=>{day=n;update();},n=>n?'明天':'今天'),hours=purifierWheel('时',Array.from({length:24},(_,i)=>i),hour,n=>{hour=n;update();},n=>`${String(n).padStart(2,'0')}时`),mins=purifierWheel('分',Array.from({length:60},(_,i)=>i),minute,n=>{minute=n;update();},n=>`${String(n).padStart(2,'0')}分`);
   dialog.append(element('div','fryer-wheels fryer-reservation-wheels',days.node,hours.node,mins.node));update();save=()=>{const end=at();if(!fryerReservationProblem(end,draft.minutes)){close();void p.state.change({operation:'start',...draft,finishAt:end});}};
  }else{
   dialog.append(element('h3','',kind==='temperature'?'烹饪温度':'烹饪时间'));const range=kind==='temperature'?fryerRange(m,draft.temperature).temperature:fryerRange(m,draft.temperature).minutes;let value=kind==='temperature'?draft.temperature:draft.minutes;const values=Array.from({length:Math.floor((range[1]-range[0])/range[2])+1},(_,i)=>range[0]+i*range[2]);const wheel=purifierWheel(kind==='temperature'?'温度':'时间',values,value,n=>{value=n;confirm.disabled=!!fryerSettingsProblem(normalized({[kind==='temperature'?'temperature':'minutes']:n}),current?r:undefined);},n=>`${n}${kind==='temperature'?'℃':'分'}`);dialog.append(element('div','fryer-wheels',wheel.node));save=()=>{close();edit(kind==='temperature'?{temperature:value}:{minutes:value});};
  }
  dialog.append(element('footer','',button('取消','',close),confirm));dismissOnBackdrop(overlay,close);overlay.append(dialog);page.append(overlay);trap(dialog,close);
 }
 if(v.confirmation){const overlay=element('div','fryer-backdrop'),dialog=element('section','fryer-dialog fryer-stop-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',r?.status===3?'取消预约':'终止烹饪');const close=()=>{v.confirmation=undefined;p.changed();};dialog.append(element('h3','',r?.status===3?'取消本次预约？':'终止本次烹饪？'),element('footer','',button('取消','',close),button('确定','primary',()=>{close();void p.state.change({operation:'stop'});})));dismissOnBackdrop(overlay,close);overlay.append(dialog);page.append(overlay);trap(dialog,close);}
 return stage;
}
function taskTime(r:NonNullable<FryerState['report']>):string {const finish=fryerFinish(r);if(finish!==undefined)return`${fryerClock(finish)} 完成`;if([2,8,9,11].includes(r.status))return`剩余 ${Math.ceil(fryerRemaining(r)/60)} 分钟`;return'';}
function trap(dialog:HTMLElement,close:()=>void){dialog.tabIndex=-1;dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}if(e.key==='Tab'){const a=[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]),[role="listbox"]')];if(e.shiftKey&&(document.activeElement===dialog||document.activeElement===a[0])){e.preventDefault();a.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===a.at(-1)){e.preventDefault();a[0]?.focus();}}});queueMicrotask(()=>{if(dialog.isConnected)dialog.focus();});}
