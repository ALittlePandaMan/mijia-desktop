import './bath-heater-page.css';
import {bathGear,bathSelected,type BathHeaterState,type BathHeaterChange} from '../bath-heater';
import type {Device} from '../types';
import {bathModeIcon,officialIcon} from '../icons';
import {button,element} from './dom';
import {deviceWait} from './device-loading';
import {deviceSurfaces} from './device-surfaces';
import {modeCard,type ModeOption} from './mode-card';
import {powerCard,roundPowerButton} from './power-button';
export function bathFrame(device:Device,goBack:()=>void){
 const stage=element('div','device-stage'),page=element('section','device-page page-bath-heater'),body=element('div','device-page-scroll bath-content');
 stage.append(page);const back=button('','page-icon-button',goBack,'back');back.setAttribute('aria-label','返回家庭');
 page.dataset.presentationTemplate='bath-heater';
 page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',device.name))),body);
 return {stage,page,body};
}
export function bathHeaterPage(p:{device:Device;state:BathHeaterState;back:()=>void}):HTMLElement{
 const s=p.state,r=s.report,{stage,page,body}=bathFrame(p.device,p.back);
 page.dataset.bathReady=String(!!r&&!s.error);page.dataset.bathPending=String(s.pending);page.setAttribute('aria-busy',String(s.loading||s.pending));
 if(!r){body.append(deviceWait(()=>element('span'),p.device.name,false));if(s.error)body.append(element('p','bath-error',s.error.message));return deviceSurfaces(stage);}
 const cold=r.mode.split('|').every(m=>['venting','coolwind'].includes(m));page.classList.toggle('bath-cold',cold);
 const labels:Record<string,string>={venting:'换气',coolwind:'吹风',warmwind:'暖风',fastwarm:'极速加热',fastdefog:'快速除雾',defog:'恒温除雾',drying:'智能干燥'};
 const running=r.mode!=='bh_off',hero=element('div','bath-hero');
 if(running)hero.append(element('p','','浴霸已开启'));
 hero.append(element('h1','',running?r.mode.split('|').map(m=>labels[m]??m).join(' | '):'浴霸已关闭'));body.append(hero);
 const cards=element('div','bath-cards device-card-stack');body.append(cards);
 const disabled=!p.device.online||!!p.device.sharedReadOnly||s.loading||!!s.error;
 const power=(label:string,key:string,selected:boolean,change:BathHeaterChange,locked=false)=>{
  const control=roundPowerButton({label,graphic:officialIcon('bath:'+key+':'+(selected?'on':'off')),
   on:selected,pressed:change.operation==='stop'?undefined:selected,
   press:disabled||locked?undefined:()=>void s.change(change)});
  control.dataset.bathOperation=change.operation;
  control.dataset.focusKey=`bath-${key}`;
  return powerCard(label,control);
 };
 cards.append(element('div','bath-power detail-power-row',
  power('停止浴霸','bhf_switch',running,{operation:'stop'},!running),
  power(r.lightOn?'关闭照明':'开启照明','light_switch',r.lightOn,{operation:'light',on:!r.lightOn})));
 const option=(label:string,key:string,mode:string,gear:number):ModeOption=>{
  const selected=bathSelected(r,mode,gear);
  return {label,selected,graphic:bathModeIcon(key,selected),focusKey:`bath-${key}`,
   press:disabled?undefined:()=>void s.change({operation:'mode',mode,gear}),
   decorate:control=>{control.dataset.bathOperation='mode';}};
 };
 for(const [group,title,options] of [
  ['ventilation','换气',[
   option('换气高档','ventilation_high_gear','venting',3),option('换气低档','ventilation_low_gear','venting',1),
  ]],
  ['blowing','送风',[
   option('暖风高档','warm_wind_high_gear','warmwind',2),option('暖风低档','warm_wind_low_gear','warmwind',1),
   option('吹风高档','cool_wind_high_gear','coolwind',3),option('吹风低档','cool_wind_low_gear','coolwind',1),
  ]],
  ['modes','模式',[
   option(labels.fastwarm,'fast_warm','fastwarm',0),option(labels.fastdefog,'fast_defog','fastdefog',0),
   option(labels.defog,'defog','defog',0),option(labels.drying,'drying','drying',0),
  ]],
 ] as const){
  const card=modeCard(title,options);
  card.dataset.modeGroup=group;
  cards.append(card);
 }

 if(s.error)cards.append(element('p','bath-error',s.error.message));
 page.dataset.bathMode=r.mode;page.dataset.bathGear=String(bathGear(r,r.mode));return deviceSurfaces(stage);
}
