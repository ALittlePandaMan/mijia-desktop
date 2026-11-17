import type {Device,DevicePanel} from '../types';
import type {PurifierCommands,PurifierView} from '../purifier';
import {element,button} from './dom';
interface Props{device:Device;panel:DevicePanel;view:PurifierView;commands:PurifierCommands;cached:boolean;back:()=>void;home:()=>void;changed:()=>void;edit:(index:number,sort?:boolean)=>void;filter:(index:number)=>void;save:()=>void;refresh:()=>void;functions?:()=>void;tds?:()=>void;statistics?:()=>void;weekTotal?:number|null;error?:string;artwork:()=>HTMLElement}
/** Desktop purifier is a status-only page. */
export function purifierPage(p:Props):HTMLElement{
 const state=p.panel.purifier!,stage=element('div','device-stage'),page=element('section','device-page page-purifier purifier-status-only');stage.append(page);page.dataset.purifierView='home';
 const back=button('','page-icon-button',p.back,'back');back.setAttribute('aria-label','返回家庭');page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',p.device.name))));
 const body=element('div','device-page-scroll');page.append(body);
  const hero=element('section','purifier-hero');
  hero.append(element('p','purifier-tds-label','直饮水 TDS'));
  const tds=element('p','purifier-tds');if(state.tds!==null&&p.device.online){const value=String(state.tds);tds.append(element('span','purifier-tds-zero','0'.repeat(Math.max(0,3-value.length))),value);}else tds.append('--');
  hero.append(tds,element('p','purifier-temperature',p.device.online&&state.temperature!==null?String(state.temperature):'--'),element('p','purifier-temperature-label','自来水水温(℃)'));
  const wave=element('div','purifier-wave');wave.setAttribute('aria-hidden','true');
  for(const [index,color]of ['#cbd9e5','#b4cbdf','#a4bfd5'].entries()){
   const layer=element('div',`purifier-wave-layer wave-${index}`);layer.style.setProperty('--water-color',`var(--water-layer-${index},${color})`);layer.innerHTML='<svg viewBox="0 0 1500 120" preserveAspectRatio="none"><path d="M0 50Q187.5 10 375 50T750 50Q937.5 10 1125 50T1500 50V120H0Z" fill="var(--water-color)"/></svg>';wave.append(layer);
  }
  hero.append(wave);body.append(hero);
 return stage;
}
