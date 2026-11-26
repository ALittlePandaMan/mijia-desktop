import {deviceSurfaces} from './device-surfaces';
import type {RouterPageProps as Props} from './router-page-props';
import {routerPublicSpeed,routerSpeed} from '../router';
import {button,element} from './dom';
import {officialIcon} from '../icons';
import {deviceWait} from './device-loading';
import {missingReadingText} from '../logic';
function networkIllustration():SVGSVGElement {
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 400 400');svg.setAttribute('aria-hidden','true');
 // Independent geometric illustration; vendor package artwork is not bundled.
 svg.innerHTML='<g fill="#dce5f0" opacity=".48"><path d="m65 125 80-46 80 46-80 46zM145 200l80-46 80 46-80 46zM65 275l80-46 80 46-80 46zM225 125l60-35 60 35-60 35z"/><path d="m65 125 80 46v28l-80-46zm80 75 80 46v28l-80-46zm-80 75 80 46v28l-80-46zm160-150 60 35v28l-60-35z" fill="#d0dcec"/><path d="m145 171 80-46v28l-80 46zm80 75 80-46v28l-80 46zm-80 75 80-46v28l-80 46zm140-161 60-35v28l-60 35z" fill="#e8eef7"/></g><g fill="#6da5ff"><ellipse cx="285" cy="126" rx="47" ry="27" opacity=".04"/><ellipse cx="285" cy="126" rx="34" ry="20" opacity=".09"/><ellipse cx="285" cy="126" rx="21" ry="12" opacity=".15"/><ellipse cx="285" cy="126" rx="12" ry="7" opacity=".28"/></g>';
 return svg;
}
export function routerPage(p:Props):HTMLElement {
 const s=p.state,r=s.report,stage=element('div','device-stage'),page=element('section','device-page page-router page-router-home'),body=element('div','device-page-scroll router-content');
 stage.append(page);page.dataset.presentationTemplate='router';page.dataset.routerView='home';page.dataset.routerLoading=String(s.loading);page.setAttribute('aria-busy',String(s.loading));
 const back=button('','page-icon-button',p.back,'back');back.setAttribute('aria-label','返回家庭');
 page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',p.device.name))),body);
 if(p.device.online&&!r&&s.loading&&!p.panel){body.append(deviceWait(p.artwork,p.device.name,false));return deviceSurfaces(stage);}
 const report=p.device.online&&!s.error&&r?.did===p.device.did&&r.model===p.device.model?r:undefined;
 const panel=p.device.online&&p.panel?.did===p.device.did&&p.panel.model===p.device.model?p.panel:undefined;
 const normal=report?.network==='ok';
 const hero=element('section','router-hero',element('h1',`router-network${p.device.online?' normal':''}`,
   !p.device.online?'路由器已离线':normal?'网络连接正常':'路由器在线'));
 const speeds=element('div','router-speeds');
 for(const [kind,value] of [['up',report?.uploadBps],['down',report?.downloadBps]] as const){
   const speed=routerSpeed(value??routerPublicSpeed(panel,kind)),digits=element('strong','router-speed-value');
   const available=speed.value!=='--';
   if(!available){digits.textContent=missingReadingText;digits.classList.add('reading-unavailable');}
   else{
     const padded=speed.value.padStart(3,'0');
     [...padded].forEach((digit,index)=>digits.append(element('span',index<padded.length-speed.value.length?'placeholder':'',digit)));
   }
   const row=element('div','router-speed',digits,element('div','router-speed-unit',officialIcon('router:arrow-'+kind,'router-speed-arrow'),element('span','',speed.unit)));
   const label=kind==='up'?'上传速度':'下载速度';
   row.setAttribute('aria-label',available?`${label} ${speed.value}${speed.unit}`:label);
   speeds.append(row);
 }
 hero.append(speeds);
 if(report?.wifi7)hero.append(element('p','router-features','Wi-Fi 7'));
 hero.append(networkIllustration());
 body.append(hero);
 return deviceSurfaces(stage);
}
