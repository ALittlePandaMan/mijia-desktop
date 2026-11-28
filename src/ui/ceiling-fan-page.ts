import './ceiling-fan-page.css';
import type {CeilingFanState,CeilingFanChange} from '../ceiling-fan';
import type {Device,DevicePanel} from '../types';
import {icon,officialIcon,type IconName} from '../icons';
import {kitchenFanBindings,switchState} from '../kitchen-controls';
import {deviceUnit} from '../device-labels';
import type {ControlNode} from './controls';
import {modeCard,type ModeOption} from './mode-card';
import {powerCardRow,roundPowerButton} from './power-button';
import {button,element} from './dom';
import {deviceWait} from './device-loading';
import {deviceSurfaces} from './device-surfaces';
import {deviceUnavailablePage} from './device-unavailable';

function ceilingFrame(p:{device:Device;back:()=>void}){
 const stage=element('div','device-stage'),page=element('section','device-page page-ceiling-fan');
 const body=element('div','device-page-scroll ceiling-content'),back=button('','page-icon-button',p.back,'back');
 back.setAttribute('aria-label','返回家庭');
 page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',p.device.name))),body);
 page.dataset.presentationTemplate='ceiling-fan';
 stage.append(page);
 return {stage,page,body};
}

function ceilingHero(running:boolean,high=false){
 const hero=element('div','ceiling-hero',officialIcon('ceiling:rotor'));
 hero.classList.toggle('is-running',running);hero.classList.toggle('is-high',high);
 return hero;
}

const windLevels = [
 {label:'吹风低挡',key:'low',glyph:'ceiling-wind-low',gear:0},
 {label:'吹风高挡',key:'high',glyph:'ceiling-wind-high',gear:1},
] as const;

function windLevel(description:string) {
 const name=description.trim().toLowerCase();
 return windLevels.find(level=>level.key===name);
}

export function standardCeilingFanPage(p:{device:Device;panel?:DevicePanel;back:()=>void;control:(node:ControlNode)=>HTMLElement}):HTMLElement{
 const {on,light,speed,mode,swing}=kitchenFanBindings(p.device,p.panel,'ceiling-fan');
 if(!on&&!light&&!speed&&!mode&&!swing)return deviceUnavailablePage(p.device,p.back);
 const {stage,page,body}=ceilingFrame(p);
 page.classList.add('page-standard-ceiling-fan');
 const fanOn=switchState(on)===true;
 body.append(ceilingHero(fanOn));
 const cards=element('div','ceiling-cards device-card-stack');
 const switches:HTMLElement[]=[];
 const locked=!!on&&!fanOn;
 if(light)switches.push(p.control({name:'Power',props:{...light,label:'照明',wholeCard:true,
  glyph:'light',openLabel:'开启照明',closeLabel:'关闭照明'}}));
 if(on)switches.push(p.control({name:'Power',props:{...on,label:'吹风',wholeCard:true,
  glyph:'wind',openLabel:'开启吹风',closeLabel:'停止吹风'}}));
 if(switches.length)cards.append(powerCardRow('ceiling-power',...switches));
 if(mode){const card=p.control({name:'Selector',props:{property:mode,label:'模式',showValue:true,
  choiceLabel:description=>mode.valueList?.find(choice=>choice.description===description)?.localizedDescription??description,locked}});card.dataset.modeGroup='modes';cards.append(card);}
 if(speed?.valueList?.length){
  const card=p.control({name:'Selector',props:{property:speed,label:'风速挡位',presentation:'options',showValue:true,locked,
   choiceLabel:(description,choice)=>windLevel(description)?.label??choice?.localizedDescription,
   choiceIcon:description=>windLevel(description)?.glyph??'wind'}});
  card.dataset.modeGroup='speed';
  cards.append(card);
 }else if(speed)cards.append(p.control({name:'Slider',props:{property:speed,label:'风速',unit:deviceUnit(speed.unit),theme:'fan',locked}}));
 if(swing)cards.append(p.control({name:'Power',props:{...swing,label:'自由摆风',glyph:'ceiling-swing',locked}}));
 body.append(cards);
 return deviceSurfaces(stage);
}
/** Exact vf3 main page: original blue surface, rotor and original state artwork. */
export function ceilingFanPage(p:{device:Device;state:Pick<CeilingFanState,'report'|'pending'|'error'|'loading'|'change'>;back:()=>void}):HTMLElement{
 const s=p.state,r=s.report,{stage,page,body}=ceilingFrame(p);
 page.dataset.ceilingReady=String(!!r&&!s.error);page.dataset.ceilingPending=String(s.pending);page.setAttribute('aria-busy',String(s.loading||s.pending));
 if(!r){
  body.append(s.error?element('p','ceiling-error',s.error.message):deviceWait(undefined,p.device.name,false));
  return deviceSurfaces(stage);
 }
 page.dataset.fanOn=String(r.fanOn);page.dataset.lightOn=String(r.lightOn);page.dataset.swingAction=r.swingAction;
 body.append(ceilingHero(r.fanOn,r.gear===1));
 const cards=element('div','ceiling-cards device-card-stack');body.append(cards);const disabled=!p.device.online||!!p.device.sharedReadOnly||s.loading||!!s.error;
 const power=(label:string,key:'light'|'fan',selected:boolean,change:CeilingFanChange)=>{
  const control=roundPowerButton({label,on:selected,pressed:selected,wholeCard:true,
   graphic:icon(key==='light'?'light':'wind'),press:disabled?undefined:()=>void s.change(change)});
  control.dataset.ceilingOperation=change.operation;
  control.dataset.focusKey=`ceiling-${key}`;
  return control;
 };
 cards.append(powerCardRow('ceiling-power',
  power(r.lightOn?'关闭照明':'开启照明','light',r.lightOn,{operation:'light',on:!r.lightOn}),
  power(r.fanOn?'停止吹风':'开启吹风','fan',r.fanOn,{operation:'fan',on:!r.fanOn,gear:r.gear})));
 const option=(label:string,key:string,glyph:IconName,selected:boolean,change:CeilingFanChange,locked=false):ModeOption=>({
  label,selected,graphic:icon(glyph),
  focusKey:`ceiling-${key}`,press:disabled||locked?undefined:()=>void s.change(change),
  decorate:control=>{control.dataset.ceilingOperation=change.operation;},
 });
 const options=windLevels.map(({label,key,glyph,gear})=>{
  const selected=r.fanOn&&r.gear===gear;
  return option(label,key,glyph,selected,{operation:'fan',on:!selected,gear});
 });
 const swinging=r.swingAction==='swing';
 options.push(option('自由摆风','swing','ceiling-swing',r.fanOn&&swinging,{operation:'swing',on:!swinging},!r.fanOn));
 const modes=modeCard('模式',options,r.fanOn?windLevels[r.gear].label:'未开启');
 modes.dataset.modeGroup='modes';
 cards.append(modes);

 if(s.error)cards.append(element('p','ceiling-error',s.error.message));return deviceSurfaces(stage);
}
