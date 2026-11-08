import './ceiling-fan-page.css';
import type {CeilingFanState,CeilingFanChange} from '../ceiling-fan';
import type {Device} from '../types';
import {officialIcon} from '../icons';
import {button,element} from './dom';
import {deviceWait} from './device-loading';
import {operationFeedback} from './operation-feedback';
import {deviceSurfaces} from './device-surfaces';
/** Exact vf3 main page: original blue surface, rotor and original state artwork. */
export function ceilingFanPage(p:{device:Device;state:CeilingFanState;back:()=>void}):HTMLElement{
 const s=p.state,r=s.report,stage=element('div','device-stage'),page=element('section','device-page page-ceiling-fan'),body=element('div','device-page-scroll ceiling-content');stage.append(page);
 const back=button('','page-icon-button',p.back,'back');back.setAttribute('aria-label','返回家庭');page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',p.device.name))),body);
 page.dataset.ceilingReady=String(!!r&&!s.error);page.dataset.ceilingPending=String(s.pending);page.setAttribute('aria-busy',String(s.loading||s.pending));
 if(!r){body.append(deviceWait(()=>element('span'),p.device.name,false));if(s.error)body.append(element('p','ceiling-error',s.error.message));return deviceSurfaces(stage);}
 page.dataset.fanOn=String(r.fanOn);page.dataset.lightOn=String(r.lightOn);page.dataset.swingAction=r.swingAction;
 const hero=element('div','ceiling-hero',officialIcon('ceiling:rotor'));hero.classList.toggle('is-running',r.fanOn);hero.classList.toggle('is-high',r.gear===1);body.append(hero);
 const cards=element('div','ceiling-cards');body.append(cards);const disabled=!p.device.online||!!p.device.sharedReadOnly||s.loading||!!s.error;
 const control=(label:string,key:string,state:string,selected:boolean,change:CeilingFanChange,extraDisabled=false)=>{
  const b=button('','ceiling-choice',()=>{if(!b.disabled)void s.change(change)});b.disabled=disabled||extraDisabled;b.dataset.ceilingOperation=change.operation;b.setAttribute('aria-label',label);b.setAttribute('aria-pressed',String(selected));b.classList.toggle('is-selected',selected);b.append(officialIcon('ceiling:'+key+':'+state),element('span','',label));return b;
 };
 const power=element('div','ceiling-power');power.append(control(r.lightOn?'关闭照明':'开启照明','light',r.lightOn?'selected':'normal',r.lightOn,{operation:'light',on:!r.lightOn}),control(r.fanOn?'停止吹风':'开启吹风','fan',r.fanOn?'selected':'normal',r.fanOn,{operation:'fan',on:!r.fanOn,gear:r.gear}));cards.append(power);
 const modes=element('section','ceiling-card ceiling-modes',element('h3','','模式')),choices=element('div','ceiling-three');
 for(const[label,key,gear]of[['吹风低挡','low',0],['吹风高挡','high',1]]as const){const selected=r.fanOn&&r.gear===gear;choices.append(control(label,key,!r.fanOn?'default':selected?'selected':'un_selected',selected,{operation:'fan',on:!selected,gear}));}
 choices.append(control('自由摆风','swing',!r.fanOn?'default':r.swingAction==='swing'?'selected':'un_selected',r.fanOn&&r.swingAction==='swing',{operation:'swing',on:r.swingAction!=='swing'},!r.fanOn));modes.append(choices);cards.append(modes);
 if(s.message)cards.append(operationFeedback(s.message,s.uncertain?()=>s.adopt():undefined));
 if(s.error)cards.append(element('p','ceiling-error',s.error.message));return deviceSurfaces(stage);
}
