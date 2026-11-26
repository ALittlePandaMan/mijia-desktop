import {selectableSofaMode,simpleLivingBindings,sofaMode,type LivingCategory} from '../living-details';
import {booleanValue} from '../panel-layout';
import type {Device,DevicePanel} from '../types';
import {waterHeatingFrame} from './bathroom-page';
import type {ControlNode} from './controls';

export function livingDetailPage(p:{device:Device;panel?:DevicePanel;category:LivingCategory;artwork:()=>HTMLElement;
  back:()=>void;control:(node:ControlNode)=>HTMLElement}):HTMLElement {
  if(p.category==='sofa'){
    const mode=sofaMode(p.panel);
    const cards=mode?[p.control({name:'Selector',props:{...mode,showValue:true,
      choiceVisible:selectableSofaMode,choiceLabel:description=>mode.property.valueList?.find(
        choice=>choice.description===description)?.localizedDescription??description}})]:[];
    return waterHeatingFrame(p,p.category,cards);
  }
  const {powers,temperatures,remoteLocked}=simpleLivingBindings(p.panel,p.category);
  const cards:HTMLElement[]=[];
  for(const power of powers){
    const light=p.category==='mirror';
    const zone=powers.length>1?power.label.slice(0,2):'';
    cards.push(p.control({name:'Power',props:{...power,openLabel:light?'开灯':`开启${zone}`,closeLabel:light?'关灯':`关闭${zone}`,
      locked:remoteLocked&&booleanValue(power.property)!==true}}));
  }
  for(const {property,label} of temperatures){
    if(property.valueList)cards.push(p.control({name:'Selector',props:{property,label,showValue:true,locked:remoteLocked,
      choiceLabel:description=>`${property.valueList!.find(option=>option.description===description)?.value}℃`}}));
    else cards.push(p.control({name:'Slider',props:{property,label,unit:'℃',style:'temperature',locked:remoteLocked}}));
  }
  return waterHeatingFrame(p,p.category,cards);
}
