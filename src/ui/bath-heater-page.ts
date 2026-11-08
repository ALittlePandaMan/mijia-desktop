import './bath-heater-page.css';
import {bathGear,bathSelected,type BathHeaterState,type BathHeaterChange} from '../bath-heater';
import type {Device} from '../types';
import {officialIcon} from '../icons';
import {button,element} from './dom';
import {deviceWait} from './device-loading';
import {operationFeedback} from './operation-feedback';
import {deviceSurfaces} from './device-surfaces';
export function bathHeaterPage(p:{device:Device;state:BathHeaterState;back:()=>void}):HTMLElement{
 const s=p.state,r=s.report,stage=element('div','device-stage'),page=element('section','device-page page-bath-heater'),body=element('div','device-page-scroll bath-content');
 stage.append(page);const back=button('','page-icon-button',p.back,'back');back.setAttribute('aria-label','返回家庭');
 page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',p.device.name))),body);
 page.dataset.bathReady=String(!!r&&!s.error);page.dataset.bathPending=String(s.pending);page.setAttribute('aria-busy',String(s.loading||s.pending));
 if(!r){body.append(deviceWait(()=>element('span'),p.device.name,false));if(s.error)body.append(element('p','bath-error',s.error.message));return deviceSurfaces(stage);}
 const cold=r.mode.split('|').every(m=>['venting','coolwind'].includes(m));page.classList.toggle('bath-cold',cold);
 const labels:Record<string,string>={venting:'换气',coolwind:'吹风',warmwind:'暖风',fastwarm:'极速加热',fastdefog:'快速除雾',defog:'恒温除雾',drying:'智能干燥'};
 const running=r.mode!=='bh_off',hero=element('div','bath-hero');
 if(running)hero.append(element('p','','浴霸已开启'));
 hero.append(element('h1','',running?r.mode.split('|').map(m=>labels[m]??m).join(' | '):'浴霸已关闭'));body.append(hero);
 const cards=element('div','bath-cards');body.append(cards);
 const disabled=!p.device.online||!!p.device.sharedReadOnly||s.loading||!!s.error;
 const control=(label:string,key:string,selected:boolean,change:BathHeaterChange,extraDisabled=false)=>{
  const b=button('','bath-choice',()=>{if(!b.disabled)void s.change(change)});
  b.disabled=disabled||extraDisabled;b.setAttribute('aria-label',label);b.setAttribute('aria-pressed',String(selected));b.dataset.bathOperation=change.operation;
  b.classList.toggle('is-selected',selected);b.append(officialIcon('bath:'+key+':'+(selected?'on':'off')),element('span','',label));return b;
 };
 const power=element('div','bath-power');power.append(control('停止浴霸','bhf_switch',running,{operation:'stop'},!running),control(r.lightOn?'关闭照明':'开启照明','light_switch',r.lightOn,{operation:'light',on:!r.lightOn}));cards.append(power);
 const wind=element('section','bath-card bath-wind');wind.append(element('h3','','换气'));
 const ventilation=element('div','bath-ventilation');for(const[label,g,key]of[['换气高档',3,'ventilation_high_gear'],['换气低档',1,'ventilation_low_gear']]as const)ventilation.append(control(label,key,bathSelected(r,'venting',g),{operation:'mode',mode:'venting',gear:g}));wind.append(ventilation,element('hr'),element('h3','','送风'));
 const blowing=element('div','bath-four');for(const[label,mode,g,key]of[['暖风高档','warmwind',2,'warm_wind_high_gear'],['暖风低档','warmwind',1,'warm_wind_low_gear'],['吹风高档','coolwind',3,'cool_wind_high_gear'],['吹风低档','coolwind',1,'cool_wind_low_gear']]as const)blowing.append(control(label,key,bathSelected(r,mode,g),{operation:'mode',mode,gear:g}));wind.append(blowing);cards.append(wind);
 const modes=element('section','bath-card',element('h3','','模式')),grid=element('div','bath-four');for(const[mode,key]of[['fastwarm','fast_warm'],['fastdefog','fast_defog'],['defog','defog'],['drying','drying']]as const)grid.append(control(labels[mode],key,bathSelected(r,mode),{operation:'mode',mode,gear:0}));modes.append(grid);cards.append(modes);
 if(s.message)cards.append(operationFeedback(s.message,s.uncertain?()=>s.adopt():undefined));
 if(s.error)cards.append(element('p','bath-error',s.error.message));
 page.dataset.bathMode=r.mode;page.dataset.bathGear=String(bathGear(r,r.mode));return deviceSurfaces(stage);
}
