import {describeOperation} from './operation-feedback';
import {deviceSurfaces} from './device-surfaces';
import type {Device,DevicePanel,Json,Property} from '../types';
import {fridgeProperty,fridgeCurrent,fridgeChoices,fridgeRange,fridgeReason,type FridgeCommands,type FridgeField} from '../fridge';
import {element,button} from './dom';
import {icon,officialIcon} from '../icons';
import {standardFridge} from '../fridge-spec';
import {controlReason,isReadableValue,numericValue} from '../panel-layout';
import {deviceModeLabel} from '../device-labels';
import {renderControl,type ControlEnvironment} from './controls';
import {deviceUnavailablePage} from './device-unavailable';
import {modeCard} from './mode-card';
import {missingReadingText} from '../logic';

export function fridgeHero(zones:readonly {label:string;value:number|undefined}[]):HTMLElement {
 const metrics=element('div','fridge-setpoints');
 for(const {label,value} of zones)metrics.append(element('div','fridge-setpoint',
  element('strong',value===undefined?'reading-unavailable':'',String(value??missingReadingText)),element('span','',`${label}(℃)`)));
 return element('div','fridge-hero',metrics);
}

function fridgeChoiceCard(title:string,choices:readonly {value:Json;label:string;meaning:string}[],value:Json|undefined,blocked:boolean,scope:string,write:(value:Json)=>void):HTMLElement {
 return modeCard(title,choices.map(choice=>{
  const selected=choice.value===value;
  const meaning=choice.meaning.toLowerCase().replace(/[\s_-]/g,'');
  const glyph=/^(smart|auto|智能)$/.test(meaning)?'smart':/cool|速冷/.test(meaning)?'cool':
    /freez|frozen|速冻|零度|zerodegree/.test(meaning)?'freeze':/premium|臻品/.test(meaning)?'premium':/maternal|infant|母婴/.test(meaning)?'maternal':undefined;
  return {label:choice.label,selected,focusKey:`fridge-${scope}-${choice.value}`,
   graphic:glyph?officialIcon('fridge:'+glyph):icon(/手动|manual/.test(meaning)?'edit':'menu'),
   press:blocked?undefined:()=>{if(!selected)write(choice.value);}};
 }));
}

export function fridgeTemperatureCard(title:string,property:Property|undefined,env:ControlEnvironment,reason?:string):HTMLElement {
 const card=renderControl({name:'Slider',props:{property,label:title,unit:'℃',style:'temperature',disabledReason:reason}},env);
 const slider=card.querySelector<HTMLInputElement>('input');
 if(slider)slider.setAttribute('aria-label',`${title}温度`);
 const steps=card.querySelectorAll<HTMLButtonElement>('.air-temperature-step');
 if(steps.length===2){
  steps[0].setAttribute('aria-label',`${title}温度减一`);
  steps[1].setAttribute('aria-label',`${title}温度加一`);
 }
 return card;
}

export function standardFridgePage(device:Device,panel:DevicePanel|undefined,env:ControlEnvironment,back:()=>void):HTMLElement {
 const {mode,zones}=standardFridge(panel);
 if(!mode&&!zones.length)return deviceUnavailablePage(device,back);
 const backButton=button('','page-icon-button',back,'back');
 backButton.setAttribute('aria-label','返回家庭');
 const body=element('div','device-page-scroll fridge-content');
 const page=element('section','device-page page-fridge',element('header','device-page-header',backButton,
   element('div','device-page-title',element('h2','',device.name))),body);
 page.dataset.presentationTemplate='fridge';
 const readings=zones.filter(zone=>zone.target||zone.temperature).map(zone=>({
   label:zone.label,value:zone.target?.valueList&&!zone.target.unit?numericValue(zone.temperature):numericValue(zone.target)??numericValue(zone.temperature),
 }));
 if(readings.length)body.append(fridgeHero(readings));
 const choices=(p:Property,title:string,temperature=false)=>{
   const options=p.valueList!.flatMap(choice=>{
     const manual=p===mode&&['viomi.fridge.u69','viomi.fridge.x49'].includes(device.model)&&/^none$/i.test(choice.description.trim());
     const description=choice.localizedDescription??(manual?'手动':choice.description);
     const label=temperature&&typeof choice.value==='number'&&/^[+-]?\d+(?:\.\d+)?$/.test(description.trim())
       ?`${choice.value}℃`:deviceModeLabel(manual?'手动':undefined,description,choice.description);
     return label?[{value:choice.value,label,meaning:description}]:[];
   });
   if(!options.length)return;
   const value=isReadableValue(p)?p.value:undefined;
   const disabled=!!env.device.sharedReadOnly||!!controlReason(p,env.device.online,env.busy)||!options.some(option=>option.value===value);
   const card=fridgeChoiceCard(title,options,value,disabled,`${p.siid}-${p.piid}`,next=>env.write(p,next));
   card.dataset.siid=String(p.siid);card.dataset.piid=String(p.piid);
   return card;
 };
 const modes=mode&&choices(mode,'冰箱模式');
 if(modes)body.append(modes);
 for(const {label,target,mode:zoneMode} of zones){
   if(target?.valueList&&target.access.includes('write')){
     const card=choices(target,label,true);if(card)body.append(card);
   }
   else if(target?.valueRange&&target.access.includes('write'))body.append(fridgeTemperatureCard(label,target,env));
   const zoneModes=zoneMode&&choices(zoneMode,label);if(zoneModes)body.append(zoneModes);
 }
 if(!body.childElementCount)return deviceUnavailablePage(device,back);
 return deviceSurfaces(element('div','device-stage',page));
}
interface Props{
 device:Device;panel:DevicePanel;commands:FridgeCommands;cached:boolean;busy:boolean;
 back:()=>void;changed:()=>void;write:(field:FridgeField,value:number)=>void;error?:string;
}
export function fridgePage(p:Props):HTMLElement{
 const panel=p.commands.display(p.panel);
 const back=button('','page-icon-button',p.back,'back');
 back.setAttribute('aria-label','返回家庭');
 const header=element('header','device-page-header',back,element('div','device-page-title',element('h2','',p.device.name)));
 const body=element('div','device-page-scroll fridge-content');
 const page=element('section','device-page page-fridge',header,body);
 page.dataset.presentationTemplate='fridge';
 const blocked=p.busy||p.commands.blocked||p.cached||!p.device.online||!!p.device.sharedReadOnly;
 const visible=(field:FridgeField)=>p.commands.target?.field===field?p.commands.target.value:fridgeCurrent(panel,field);
 const modeCard=(field:'mode'|'maternal',title:string)=>{
  const choices=fridgeChoices(panel,field);
  return fridgeChoiceCard(title,choices,visible(field),blocked||!!fridgeReason(panel,field),field,value=>{
   if(typeof value==='number'&&value!==fridgeCurrent(panel,field))p.write(field,value);
  });
 };
 const zones=[['refrigerating','冷藏室'],['freezing','冷冻室']] as const;
 body.append(fridgeHero(zones.filter(([field])=>fridgeProperty(panel,field)).map(([field,label])=>({label,value:visible(field)}))));
 const fridge=panel.services.find(s=>s.name==='fridge');
 const fault=fridge?.properties.find(q=>q.name==='fault'),door=fridge?.properties.find(q=>q.name==='door-not-close-remind');
 if(fault?.code===0&&typeof fault.value==='number'&&fault.value!==0)body.append(element('div','native-card fridge-warning',icon('warning'),element('span','',`设备异常（${fault.value}）`)));
 if(door?.code===0&&door.valueList?.some(v=>v.description==='Some'&&v.value===door.value))body.append(element('div','native-card fridge-warning',icon('warning'),element('span','','请检查冰箱门是否关好')));
 body.append(modeCard('mode','冰箱模式'));
 for(const [field,title] of zones){
  const property=fridgeProperty(panel,field);
  if(!property)continue;
  const reading={...property,value:visible(field),valueRange:fridgeRange(panel,field)};
  body.append(fridgeTemperatureCard(title,reading,{
   device:p.device,busy:blocked,write:(_,value)=>{if(typeof value==='number')p.write(field,value);},
   error:()=>{},interactionEnded:p.changed,
  },fridgeReason(panel,field)));
 }
 if(fridgeProperty(panel,'maternal'))body.append(modeCard('maternal','母婴室'));
 describeOperation(page,p.error);
 return deviceSurfaces(element('div','device-stage',page));
}
