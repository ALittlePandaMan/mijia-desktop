import {adjustableWaterTemperature,waterHeatingBindings,type WaterHeatingCategory} from '../water-heating';
import {waterHeatingFrame} from './bathroom-page';
import {numericValue} from '../panel-layout';
import {missingReadingText} from '../logic';
import type {ControlNode} from './controls';
import type {Device,DevicePanel,Property} from '../types';

const teaModes:Record<string,string>={'keep warm':'保温',boiled:'烧水','strong tea':'浓茶','light tea':'淡茶',
  'flower tea':'花茶','black tea':'红茶','green tea':'绿茶','dark tea':'黑茶','dried tangerine peel':'陈皮','mix milk':'冲奶'};

export function waterHeatingPage(p:{device:Device;panel?:DevicePanel;category:WaterHeatingCategory;
  artwork:()=>HTMLElement;back:()=>void;control:(node:ControlNode)=>HTMLElement}):HTMLElement {
  const {power,target,warm,soaking,mode,current}=waterHeatingBindings(p.panel,p.category);
  const cards:HTMLElement[]=[];
  if(power)cards.push(p.control({name:'Power',props:{...power,label:'电源',openLabel:'开启',closeLabel:'关闭'}}));
  if(current)cards.push(p.control({name:'Status',props:{property:current,label:'当前水温',unit:'℃'}}));
  if(mode)cards.push(p.control({name:'Selector',props:{property:mode,label:'模式',showValue:true,
    choiceLabel:description=>mode.valueList?.find(option=>option.description===description)?.localizedDescription??
      (p.category==='teabar'?teaModes[description.trim().toLowerCase()]:undefined)??description}}));
  const addTemperature=(property:Property|undefined,label:string)=>{
    if(!property)return;
    const value=p.device.online?numericValue(property):undefined;
    if(p.category==='water-dispenser'||!adjustableWaterTemperature(property)){
      cards.push(p.control({name:'Status',props:{label,unit:'℃',displayValue:value===undefined?missingReadingText:String(value)}}));
    }else if(property.valueList)cards.push(p.control({name:'Selector',props:{property,label,showValue:true,
      choiceLabel:description=>`${property.valueList!.find(v=>v.description===description)?.value??''}℃`}}));
    else cards.push(p.control({name:'Slider',props:{property,label,unit:'℃',style:'temperature'}}));
  };
  addTemperature(target,p.category==='teabar'?'沸点设置':'目标温度');
  addTemperature(warm,'保温温度');
  addTemperature(soaking,'泡煮温度');
  return waterHeatingFrame(p,p.category,cards);
}
