import {dismissOnBackdrop} from './dialog-dismiss';
import {describeOperation} from './operation-feedback';
import {deviceSurfaces} from './device-surfaces';
import {officialIcon} from '../icons';
import type {DispenserDnd,DispenserDndChange} from '../dispenser-dnd';
import {button,element} from './dom';import {deviceWait} from './device-loading';import {timeWheels} from './time-wheels';
import {bindDialogFocus} from './dialog-focus';
interface Props {state:DispenserDnd;artwork:()=>HTMLElement;busy:boolean;online:boolean;back:()=>void;changed:()=>void;save:(c:Partial<Omit<DispenserDndChange,'revision'>>)=>void;read:()=>void}
export function dispenserDndPage(p:Props):HTMLElement {
 const stage=element('div','device-stage'),page=element('section','device-page page-dispenser-dnd'),back=button('','page-icon-button',p.back,'back');back.setAttribute('aria-label','返回设备设置');stage.append(page);page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','','勿扰模式'))));
 const body=element('div','device-page-scroll dispenser-dnd-content');page.append(body);const state=p.state,r=state.report;
 if(state.opening.waiting||!r){if(state.opening.waiting){if(state.opening.showing)body.append(deviceWait(p.artwork,'勿扰设置',false));}else body.append(element('p','dispenser-dnd-notice',state.error?.message??'暂未读取勿扰设置。'));return deviceSurfaces(stage);}
 const hero=element('div','dispenser-dnd-hero');hero.append(officialIcon('dispenser:dnd'));hero.append(element('p','','勿扰模式是允许用户在自定义时间段内关闭设备声音反馈、调整屏幕为50%亮度'));body.append(hero);
 const disabled=!state.canEdit||p.busy||!p.online;
 const toggle=(label:string,checked:boolean,run:()=>void)=>{const b=button('','dispenser-dnd-row',run);b.setAttribute('role','switch');b.setAttribute('aria-label',label);b.setAttribute('aria-checked',String(checked));b.disabled=disabled;b.dataset.focusKey=`dispenser-dnd-${label}`;b.append(element('span','',label),element('span',`purifier-settings-switch${checked?' checked':''}`));return b;};
 body.append(element('section','native-card dispenser-dnd-card',toggle('开启勿扰模式',r.enabled===true,()=>p.save({enabled:r.enabled!==true,...(r.enabled!==true?{allDay:true}:{})}))));
 if(r.enabled){const details=element('section','native-card dispenser-dnd-card',toggle('全天',r.allDay===true,()=>p.save({allDay:r.allDay!==true})));for(const kind of ['start','end']as const){const time=kind==='start'?r.startTime:r.endTime,b=button('','dispenser-dnd-row',()=>{const[h,m]=time.split(':').map(Number);state.picker={kind,hour:h,minute:m};p.changed();});b.setAttribute('aria-label',kind==='start'?'开始时间':'结束时间');b.disabled=disabled||r.allDay===true;b.append(element('span','',kind==='start'?'开始时间':'结束时间'),element('span','dispenser-dnd-time',`${kind==='end'&&r.endTime<=r.startTime?'次日 ':''}${time}`));details.append(b);}body.append(details);}
 describeOperation(page,state.message);if(r.reason)body.setAttribute('aria-description',r.reason);
 
 if(state.picker){const draft=state.picker,overlay=element('div','dispenser-dialog-backdrop'),d=element('section','dispenser-dialog dispenser-dnd-picker'),title=draft.kind==='start'?'开始时间':'结束时间';d.tabIndex=-1;d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');d.setAttribute('aria-label',title);d.append(element('h3','',title));d.append(timeWheels(draft,'dispenser'));
  const close=()=>{state.picker=undefined;p.changed();},cancel=button('取消','',close),confirm=button('确定','',()=>{const time=`${String(draft.hour).padStart(2,'0')}:${String(draft.minute).padStart(2,'0')}`;if(time===(draft.kind==='start'?r.endTime:r.startTime)){let error=d.querySelector('.dispenser-name-error');if(!error){error=element('p','dispenser-name-error');d.append(error);}error.textContent='开始时间和结束时间不能相同。';return;}state.picker=undefined;p.save(draft.kind==='start'?{startTime:time}:{endTime:time});p.changed();});confirm.disabled=disabled;d.append(element('footer','',cancel,confirm));dismissOnBackdrop(overlay,close);overlay.append(d);page.append(overlay);
  bindDialogFocus(d,close);
 }
 return deviceSurfaces(stage);
}
