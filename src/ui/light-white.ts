import {coercePropertyInput} from '../logic';
import {controlReason} from '../panel-layout';
import {rgbHex,rgbPropertyReason,rgbValue} from '../light-color';
import type {Property} from '../types';
import type {ControlEnvironment} from './controls';
import {button,element} from './dom';

/** RGB white shades, sent through the published color property. These are
 * color presets, not a fabricated Kelvin property or a measured temperature. */
export function lightWhitePresets(property:Property,env:ControlEnvironment,disabledReason?:string):HTMLElement{
 const card=element('section','native-card light-white-card device-control-unit',element('h3','','白光色调'));
 card.dataset.control='WhitePresets';card.dataset.siid=String(property.siid);card.dataset.piid=String(property.piid);
 const choices=element('div','light-white-choices daily-actions');
 const reason=(env.device.sharedReadOnly?'此共享设备只有查看权限。':undefined)??controlReason(property,env.device.online,env.busy)??rgbPropertyReason(property)??disabledReason??(rgbValue(property)===undefined?'颜色状态尚未读取，请重新读取。':undefined);
 for(const[label,value]of [['暖白',0xffb576],['自然白',0xffe4c4],['冷白',0xf2f6ff]]as const){
  const selected=rgbValue(property)===value,b=button(label,`light-white-choice${selected?' selected':''}`,()=>{if(!b.disabled)try{env.write(property,coercePropertyInput(property,String(value)));}catch(e){env.error(e);}});
  b.prepend(element('span','light-white-swatch'));b.style.setProperty('--white-color',rgbHex(value));b.setAttribute('aria-pressed',String(selected));b.disabled=!!reason;if(reason)b.setAttribute('aria-description',reason);choices.append(b);
 }card.append(choices);return card;
}
