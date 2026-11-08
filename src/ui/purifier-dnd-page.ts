import {dismissOnBackdrop} from './dialog-dismiss';
import {describeOperation} from './operation-feedback';
import {officialIcon} from '../icons';
import {deviceSurfaces} from './device-surfaces';
import type {PurifierDnd,PurifierDndChange} from '../purifier-dnd';
import {button,element} from './dom';
import {deviceWait} from './device-loading';
import {purifierWheel} from './purifier-wheel';
interface Props {state:PurifierDnd;artwork:()=>HTMLElement;busy:boolean;online:boolean;back:()=>void;changed:()=>void;save:(change:Partial<Omit<PurifierDndChange,'revision'>>)=>void;read:()=>void}
export function purifierDndPage(p:Props):HTMLElement{
 const stage=element('div','device-stage'),page=element('section','device-page page-purifier-dnd'),back=button('','page-icon-button',p.back,'back');back.setAttribute('aria-label','返回设备设置');stage.append(page);page.append(element('header','device-page-header',back));
 const body=element('div','device-page-scroll purifier-dnd-content');page.append(body);body.append(element('h1','purifier-settings-title','勿扰模式'));
 const state=p.state,r=state.report;
 if(state.opening.waiting||!r){if(state.opening.waiting){if(state.opening.showing)body.append(deviceWait(p.artwork,'勿扰设置',false));}else{body.append(element('p','purifier-error',state.error?.message??'暂未读取勿扰设置。'));}return deviceSurfaces(stage);}
 const hero=element('div','purifier-dnd-intro');hero.append(officialIcon('purifier:dnd'));
 hero.append(element('p','','勿扰模式是允许用户在自定义时间段内关闭设备提示音，停止滤芯冲洗'));body.append(hero);
 const disabled=!state.canEdit||p.busy||!p.online;
 const toggle=(label:string,checked:boolean,run:()=>void)=>{const b=button('','purifier-dnd-row',run);b.setAttribute('role','switch');b.setAttribute('aria-label',label);b.setAttribute('aria-checked',String(checked));b.disabled=disabled;b.dataset.focusKey=`purifier-dnd-${label}`;b.append(element('span','',label),element('span',`purifier-settings-switch${checked?' checked':''}`));return b;};
 body.append(element('section','native-card purifier-dnd-card',toggle('勿扰模式',r.enabled===true,()=>p.save({enabled:r.enabled!==true,...(r.enabled!==true?{allDay:false}:{})}))));
 if(r.enabled){const detail=element('section','native-card purifier-dnd-card',toggle('全天勿扰',r.allDay===true,()=>p.save({allDay:r.allDay!==true})));body.append(detail);
  if(!r.allDay){for(const kind of ['start','end']as const){const time=kind==='start'?r.startTime:r.endTime,b=button('','purifier-dnd-row',()=>{const[h,m]=time.split(':').map(Number);state.picker={kind,hour:h,minute:m};p.changed();});b.disabled=disabled;b.dataset.focusKey=`purifier-dnd-${kind}`;b.append(element('span','',kind==='start'?'开始时间':'结束时间'),element('span','purifier-dnd-time',`${kind==='end'&&r.endTime<=r.startTime?'次日 ':''}${time}`));detail.append(b);}}
 }
 describeOperation(page,state.message);const message=r.reason||r.warnings[0];if(message){const notice=element('p','purifier-settings-help',message);notice.setAttribute('role','status');body.append(notice);}
 if(state.picker){const draft=state.picker,overlay=element('div','purifier-modal-backdrop'),dialog=element('section','purifier-confirm purifier-setting-dialog purifier-dnd-picker');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',draft.kind==='start'?'开始时间':'结束时间');
  dialog.append(element('h2','',draft.kind==='start'?'开始时间':'结束时间'));const wheels=element('div','purifier-dnd-wheels');
  for(const[key,max,label]of [['hour',24,'时'],['minute',60,'分']]as const){const wheel=purifierWheel(label,Array.from({length:max},(_,i)=>i),draft[key],value=>{draft[key]=value;},value=>String(value).padStart(2,'0'));wheels.append(element('div','purifier-wheel-column',wheel.node,element('span','purifier-wheel-unit',label)));}dialog.append(wheels);
  const close=()=>{state.picker=undefined;p.changed();};const confirm=button('确定','',()=>{const time=`${String(draft.hour).padStart(2,'0')}:${String(draft.minute).padStart(2,'0')}`;const other=draft.kind==='start'?r.endTime:r.startTime;if(time===other){const error=dialog.querySelector('.purifier-error')??element('p','purifier-error');error.textContent='开始时间和结束时间不能相同。';dialog.insertBefore(error,dialog.querySelector('footer'));return;}state.picker=undefined;p.save(draft.kind==='start'?{startTime:time}:{endTime:time});p.changed();});confirm.disabled=disabled;
  dialog.append(element('footer','',button('取消','',close),confirm));dismissOnBackdrop(overlay,close);overlay.append(dialog);page.append(overlay);dialog.tabIndex=-1;dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close();}if(e.key==='Tab'){const nodes=[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]),[role="listbox"]')];if(e.shiftKey&&(document.activeElement===nodes[0]||document.activeElement===dialog)){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}}});queueMicrotask(()=>{if(dialog.isConnected)dialog.focus();});
 }
 return deviceSurfaces(stage);
}
