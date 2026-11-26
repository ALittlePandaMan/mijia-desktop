import {airerIntents} from '../airer-spec';
import type {AirerIntent} from '../airer';
import {officialIcon} from '../icons';
import {modeOptionButton} from './mode-card';
import type {PositionMotion} from '../position-motion';
import type {Property} from '../types';
import {button,element} from './dom';
import {renderControl,type ControlEnvironment} from './controls';
import {controlHeading} from './control-heading';

export function airerHero(o:{position?:number;motion:PositionMotion;finished?:()=>void;caption?:(value:number)=>void}):HTMLElement {
  const hero=element('div','airer-hero');
  const diagram=element('div','airer-diagram');
  diagram.innerHTML='<svg viewBox="0 0 360 160" role="img" aria-label="晾衣机示意图"><rect x="110" y="26" width="140" height="10" rx="2" fill="#f7f7f7"/><path class="airer-cables" stroke="#a7b4c8" stroke-width="1.4"/><g class="airer-rack"><rect x="16" y="0" width="328" height="4" rx="1" fill="#f7f7f7"/><rect x="84" y="-3" width="192" height="7" rx="2" fill="#f7f7f7"/><rect x="91" y="4" width="178" height="6" rx="2" fill="#f6f6f6"/>'
    +Array.from({length:23},(_,i)=>`<circle cx="${98+i*7.4}" cy="7" r="1.3" fill="#d0d2d5"/>`).join('')
    +'<g stroke="#b8bdc6" stroke-width="1.3">'+Array.from({length:13},(_,i)=>`<path d="M${38+i*23} 4v4"/>`).join('')+'</g></g></svg>';
  const rack=diagram.querySelector<SVGGElement>('.airer-rack')!, cables=diagram.querySelector('.airer-cables')!;
  const paint=(value:number)=>{
    const offset=46+value*.7;
    rack.style.transform=`translateY(${offset}px)`;
    cables.setAttribute('d',`M128 36V${offset}M232 36V${offset}`);
    hero.dataset.position=value.toFixed(2);
    o.caption?.(value);
  };
  hero.append(diagram);paint(o.position??55);
  queueMicrotask(()=>{if(hero.isConnected)o.motion.attachPosition(hero,paint,o.finished);});
  return hero;
}

const motorPaths: Record<AirerIntent,string> = {
  up: 'M12 5.5 19 17H5Z',
  pause: 'M6.5 5v14m11-14v14',
  down: 'M12 18.5 5 7h14Z',
};

function activeMotorIcon(intent:AirerIntent):SVGSVGElement {
  const ns='http://www.w3.org/2000/svg';
  const graphic=document.createElementNS(ns,'svg'), path=document.createElementNS(ns,'path');
  graphic.classList.add('icon');
  graphic.setAttribute('viewBox','0 0 24 24');
  graphic.setAttribute('aria-hidden','true');
  path.setAttribute('d',motorPaths[intent]);
  path.setAttribute('fill','none');
  path.setAttribute('stroke','currentColor');
  path.setAttribute('stroke-linejoin','round');
  path.setAttribute('stroke-linecap','round');
  path.setAttribute('stroke-width','1.75');
  graphic.append(path);
  return graphic;
}

export function airerMotorCard(active:AirerIntent|undefined, permitted:(intent:AirerIntent)=>boolean, lift:(intent:AirerIntent)=>void):HTMLElement {
  const card=element('section','native-card airer-motor');
  card.setAttribute('aria-label','晾杆控制');
  const names={up:'上升',pause:'停止',down:'下降'};
  for(const intent of airerIntents){
    const selected=active===intent, enabled=permitted(intent);
    card.append(modeOptionButton({
      label:names[intent], selected, focusKey:`airer-${intent}`,
      graphic:selected?activeMotorIcon(intent):officialIcon(`airer:${intent}:${enabled?'nosel':'dis'}`),
      press:enabled?()=>lift(intent):undefined,
      decorate:control=>{control.classList.add('airer-motor-button');control.dataset.airerIntent=intent;},
    }));
  }
  return card;
}

export function airerPositionCard(property:Property,env:ControlEnvironment,previewValue?:(value:number|undefined)=>void):HTMLElement {
  const card=renderControl({name:'Slider',props:{property,label:'晾杆位置',unit:'%',theme:'airer-position',previewValue}},env);
  card.dataset.capabilityRole='airer.target-position';
  return card;
}

export function airerLightCard(power:Property|undefined,brightness:Property|undefined,env:ControlEnvironment):HTMLElement|undefined {
  if(!power&&!brightness)return;
  const on=power?.code===0&&(typeof power.value==='boolean'||power.value===0||power.value===1)?!!power.value:undefined;
  const card=brightness?renderControl({name:'Slider',props:{property:brightness,label:'照明',unit:brightness.valueList?'':'%',theme:'illumination',
    discrete:!!brightness.valueList,choiceLabel:description=>brightness.valueList?.find(c=>c.description===description)?.localizedDescription??description,
    disabledReason:power&&on!==true?'照明已关闭':undefined}},env)
    :element('section','native-card airer-light-simple',controlHeading('照明',{className:'native-slider-heading'}).root);
  card.classList.add('airer-light');
  if(power){
    const enabled=!env.busy&&on!==undefined&&env.device.online&&!env.device.sharedReadOnly&&power.access.includes('write');
    const toggle=button('', 'device-toggle airer-light-switch', () => {
      if(!toggle.disabled)env.write(power,power.format==='bool'?!on:Number(!on));
    });
    toggle.disabled=!enabled;
    toggle.setAttribute('role','switch');
    toggle.setAttribute('aria-label','照明开关');
    toggle.setAttribute('aria-checked',String(on===true));
    toggle.dataset.focusKey='airer-light';
    card.querySelector('.native-slider-heading')?.append(toggle);
  }
  return card;
}
