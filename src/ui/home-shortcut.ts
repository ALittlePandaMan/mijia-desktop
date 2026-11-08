import type {Device,HomeCardEntry,HomeCardIntent} from '../types';
import {cardIntent} from '../home-cards';
import {button,element} from './dom';
import {icon,type IconName} from '../icons';

type Activate=(intent:HomeCardIntent)=>void;
interface Binding {card:HomeCardEntry;activate:Activate}
const bindings=new WeakMap<HTMLButtonElement,Binding>();
const labels:Record<HomeCardIntent,string>={on:'打开',off:'关闭',open:'打开',close:'关闭',pause:'暂停'};
function shortcutGlyph(card:HomeCardEntry):IconName {
  if(card.kind!=='curtain')return 'power';
  return card.action==='pause'?'pause':card.action==='close'?'curtain-close':'curtain-open';
}

function update(control:HTMLButtonElement,device:Device,card:HomeCardEntry,pending:boolean,activate:Activate):void {
  bindings.set(control,{card,activate});
  const glyph=shortcutGlyph(card);
  if(control.querySelector<SVGSVGElement>('.icon')?.dataset.iconName!==glyph)control.replaceChildren(icon(glyph));
  control.classList.toggle('is-online',device.online);
  control.classList.toggle('is-on',card.kind==='power'&&card.selected===true&&device.online);
  control.disabled=!card.enabled;
  control.dataset.shortcutKind=card.kind;control.dataset.shortcutState=card.selected===null?'unknown':card.selected?'on':'off';
  const camera=card.kind==='power'&&(device.specType?.split(':')[3]==='camera'||device.model.includes('.camera.'));
  control.setAttribute('aria-label',`${camera?(cardIntent(card)==='on'?'唤醒':'休眠'):labels[cardIntent(card)]}${device.name}`);
  control.setAttribute('aria-busy',String(pending));
  if(card.kind==='power')control.setAttribute('aria-pressed',card.selected===null?'mixed':String(card.selected));
  else control.removeAttribute('aria-pressed');
  if(card.reason)control.setAttribute('aria-description',card.reason);
  else control.removeAttribute('aria-description');
}

/** Keep a live button mounted so pointer/focus and the release spring survive
 * optimistic updates and cloud readback. The callback uses its latest intent. */
export function updateHomeShortcut(current:Element,device:Device,card:HomeCardEntry|undefined,pending:boolean,activate:Activate):void {
  if(current instanceof HTMLButtonElement&&bindings.has(current)&&card?.visible&&current.dataset.shortcutKind===card.kind){
    update(current,device,card,pending,activate);
  }else current.replaceWith(homeShortcut(device,card,pending,activate));
}

export function homeShortcut(device:Device,card:HomeCardEntry|undefined,pending:boolean,activate:(intent:HomeCardIntent)=>void):HTMLElement {
  if(!card?.visible){
    const status=element('span',`device-status no-shortcut${device.online?' is-online':''}`);
    status.setAttribute('aria-hidden','true');return status;
  }
  const control=button('','device-status device-shortcut',()=>{const state=bindings.get(control);if(state&&control.isConnected&&!control.disabled)state.activate(cardIntent(state.card));},shortcutGlyph(card));
  update(control,device,card,pending,activate);
  for(const name of ['pointerdown','pointerup','click','dblclick','contextmenu','keydown'] as const)control.addEventListener(name,event=>event.stopPropagation());
  return control;
}
