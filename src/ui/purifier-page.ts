import type {Device,DevicePanel} from '../types';
import {detailProperty,detailServices} from '../appliance-details';
import {numericValue} from '../panel-layout';
import {waterHardness} from '../kitchen-controls';
import {deviceUnit} from '../device-labels';
import {element,button} from './dom';
import {deviceUnavailablePage} from './device-unavailable';
import {missingReadingText} from '../logic';

function purifierReadings(panel:DevicePanel|undefined){
 const services=detailServices(panel);
 const unique=(name:string)=>{
   const matches=services.filter(service=>service.name===name);
   return matches.length===1?matches[0]:undefined;
 };
 const water=unique('water-purifier'),sensor=unique('tds-sensor');
 const tds=sensor&&detailProperty(sensor,'tds-out');
 const temperature=water&&detailProperty(water,'temperature');
 return {
   tds:tds&&/^(u?int(8|16|32|64)|float|double)$/.test(tds.format)&&(!tds.unit||['ppm','none'].includes(tds.unit))?tds:undefined,
   temperature:temperature?.unit==='celsius'&&/^(u?int(8|16|32|64)|float|double)$/.test(temperature.format)?temperature:undefined,
 };
}

/** Desktop purifier is a status-only page. */
export function purifierPage(p:{device:Device;panel?:DevicePanel;back:()=>void;softener?:boolean}):HTMLElement{
 const {tds,temperature}=p.softener?{}:purifierReadings(p.panel);
 const hardness=p.softener?waterHardness(p.device,p.panel):undefined;
 const report=!p.softener&&p.device.model==='xiaomi.waterpuri.lx32'&&!p.panel?.unsupportedReason?p.panel?.purifier:undefined;
 if(!p.softener&&!tds&&!temperature&&!report)return deviceUnavailablePage(p.device,p.back);
 const stage=element('div','device-stage'),page=element('section','device-page page-purifier purifier-status-only');
 stage.append(page);page.dataset.purifierView='home';page.dataset.presentationTemplate=p.softener?'water-softener':'purifier';
 const back=button('','page-icon-button',p.back,'back');back.setAttribute('aria-label','返回家庭');page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',p.device.name))));
 const body=element('div','device-page-scroll');page.append(body);
  const hero=element('section','purifier-hero');
  if(p.softener||tds||report?.tds!=null){
   const property=p.softener?hardness:tds;
   const value=p.device.online?(report?report.tds:numericValue(property)):undefined;
   const digits=element('p','purifier-tds');
   if(property){digits.dataset.control='Status';digits.dataset.siid=String(property.siid);digits.dataset.piid=String(property.piid);digits.dataset.propertyName=property.name;}
   if(value!=null&&Number.isFinite(value)&&value>=0){
    const padding=Math.max(0,3-String(Math.trunc(value)).length);
    digits.append(element('span','purifier-tds-zero','0'.repeat(padding)),String(value));
   }else{digits.classList.add('reading-unavailable');digits.append(missingReadingText);}
   const unit=deviceUnit(hardness?.unit);
   hero.append(element('p','purifier-tds-label',p.softener?`当前水硬度${unit?` (${unit})`:''}`:'直饮水 TDS'),digits);
  }
  if(temperature||report?.temperature!=null){
   const value=p.device.online?(report?report.temperature:numericValue(temperature)):undefined;
   const valid=value!=null&&Number.isFinite(value);
   hero.append(element('p',valid?'purifier-temperature':'purifier-temperature reading-unavailable',valid?String(value):missingReadingText),
     element('p','purifier-temperature-label','自来水水温(℃)'));
  }
  const wave=element('div','purifier-wave');wave.setAttribute('aria-hidden','true');
  for(const [index,color]of ['#cbd9e5','#b4cbdf','#a4bfd5'].entries()){
   const layer=element('div',`purifier-wave-layer wave-${index}`);layer.style.setProperty('--water-color',`var(--water-layer-${index},${color})`);layer.innerHTML='<svg viewBox="0 0 1500 120" preserveAspectRatio="none"><path d="M0 50Q187.5 10 375 50T750 50Q937.5 10 1125 50T1500 50V120H0Z" fill="var(--water-color)"/></svg>';wave.append(layer);
  }
  hero.append(wave);body.append(hero);
 return stage;
}
