import './bathroom-page.css';
import {bathroomAdjustable,bathroomChoiceKeys,bathroomCurrentValid,bathroomTemperature,propertiesFor,toiletCleaning,toiletCommon,toiletControls,toiletLabels,toiletSeated,toiletSettings,type BathroomCommand,type ToiletRole} from '../bathroom';
import {standardBathHeater} from '../bath-heater-spec';
import {validChoices} from '../device-capabilities';
import {deviceUnit} from '../device-labels';
import {detailProperty,detailServices} from '../appliance-details';
import {powerSwitchBinding} from '../water-heating';
import {bathModeIcon,icon,officialIcon,type IconName} from '../icons';
import type {Device,DevicePanel,Property} from '../types';
import {bathFrame} from './bath-heater-page';
import {deviceUnavailablePage} from './device-unavailable';
import type {ControlNode} from './controls';
import {deviceSurfaces} from './device-surfaces';
import {button,element} from './dom';
import {modeCard} from './mode-card';
import {powerCard,roundPowerButton} from './power-button';

interface PageProps {
  device:Device;
  panel:DevicePanel;
  disabled:boolean;
  back:()=>void;
  control:(node:ControlNode)=>HTMLElement;
  execute:(command:BathroomCommand)=>void;
  actionPending:(command:BathroomCommand)=>boolean;
}

function frame({device,back}:Pick<PageProps,'device'|'back'>,template:string,subtitle?:string){
  const goBack=button('','page-icon-button',back,'back');
  goBack.setAttribute('aria-label','返回家庭');
  const page=element('section',`device-page page-${template} page-bathroom`,
    element('header','device-page-header',goBack,element('div','device-page-title',element('h2','',device.name),subtitle?element('p','',subtitle):null)));
  page.dataset.presentationTemplate=template;
  page.dataset.visualAdapter=template;
  const body=element('div','device-page-scroll device-controls-region bathroom-content');
  page.append(body);
  return {stage:element('div','device-stage',page),body};
}

const heatingModes:Record<string,string>={
  free:'自由模式',freemode:'自由模式',energy:'节能',quickdry:'快烘',fastdry:'快烘',gentledry:'柔烘',softbaking:'柔烘',
  stove:'加热',heating:'加热',maintain:'恒温',temperature:'恒温',energysaving:'节能',ecomode:'节能模式',
  freeze:'防冻',airsupply:'送风',airsupplymode:'送风模式',disinfection:'消毒',disinfectionmode:'消毒模式',degermation:'除菌',
  cosy:'舒适',gentle:'柔和',warmup:'预热',heatpre:'预热',timing:'定时',timingmode:'定时模式',countdownmode:'倒计时',
  lowheat:'低温加热',midheat:'中温加热',highheat:'高温加热',hightemperature:'高温',
  dehumidify:'除湿',intelligentmodel:'智能模式',dryingmode:'烘干模式',drymode:'烘干模式',everyday:'每日',
  customize:'自定义',cycle:'循环',week:'每周',dayhourmode:'按日定时',nomode:'待机',cancel:'取消',
};

function heatGearIcon(option:NonNullable<Property['valueList']>[number],selected:boolean):IconName{
  const [key,caption]=bathroomChoiceKeys(option);
  const state=selected?'on':'off';
  if(/^(off|none|close|level0)$/.test(key)||/关|^无$/.test(caption))return `bath:bhf_switch:${state}`;
  if(/^(high|level2)$/.test(key)||/[强高]/.test(caption))return `bath:warm_wind_high_gear:${state}`;
  if(/^(low|level1)$/.test(key)||/[弱低]/.test(caption))return `bath:warm_wind_low_gear:${state}`;
  return caption==='自然风'?'wind':'sun';
}

function adjustment(p:Pick<PageProps,'control'>,property:Property,label:string,
  {temperature=false,omitChoiceNotes=false}:{temperature?:boolean;omitChoiceNotes?:boolean}={}):HTMLElement{
  const unit=deviceUnit(property.unit)||(omitChoiceNotes?'档':'');
  if(validChoices(property)){
    return p.control({name:'Selector',props:{
      property,label,showValue:true,
      choiceIcon:omitChoiceNotes&&property.name==='heat-level'?(description,selected)=>{
        const option=property.valueList!.find(choice=>choice.description===description);
        return option?heatGearIcon(option,selected):undefined;
      }:undefined,
      choiceLabel:description=>{
        const option=property.valueList!.find(c=>c.description===description);
        const keys=option?bathroomChoiceKeys(option):[];
        const caption=option?.localizedDescription??heatingModes[keys[0]]??(temperature&&typeof option?.value==='number'&&unit?`${option.value}${unit}`:description);
        return omitChoiceNotes?caption.replace(/\([^)]*\)|（[^）]*）/g,'').trim():caption;
      },
    }});
  }
  return p.control({name:'Slider',props:{property,label,unit,style:temperature?'temperature':undefined,theme:omitChoiceNotes?'fan':'bathroom'}});
}

export function bathroomHeatingPage(p:PageProps&{category:'water-heater'|'boiler'|'towel-rack';artwork:()=>HTMLElement}):HTMLElement{
  const serviceNames=p.category==='boiler'?['water-heater','boiler']:[p.category];
  const services=detailServices(p.panel).filter(s=>p.device.controlServiceId==null||s.siid===p.device.controlServiceId);
  const property=(name:string)=>{
    for(const serviceName of serviceNames){
      const matches=services.filter(service=>service.name===serviceName);
      if(matches.length===1){const value=detailProperty(matches[0],name);if(value)return value;}
    }
  };
  const power=powerSwitchBinding(property('on'));
  const target=property('target-temperature');
  const temperature=p.category!=='boiler'?bathroomTemperature(p.panel,p.category+'.target-temperature',true):
    target?.unit==='celsius'&&bathroomAdjustable(target)?target:undefined;
  const mode=p.category==='towel-rack'?propertiesFor(p.panel,['towel-rack.mode','bathroom-rack.gz-model'],
    property=>bathroomAdjustable(property)&&property.valueList?.length!==1)[0]:undefined;
  const cards:HTMLElement[]=[];
  if(power)cards.push(p.control({name:'Power',props:{...power,label:'电源',openLabel:'开启',closeLabel:'关闭'}}));
  if(mode)cards.push(adjustment(p,mode,'模式'));
  if(temperature)cards.push(adjustment(p,temperature,'目标温度',{temperature:true}));
  return waterHeatingFrame(p,p.category,cards);
}

export function waterHeatingFrame(p:Pick<PageProps,'device'|'back'>&{artwork:()=>HTMLElement},category:string,cards:HTMLElement[]):HTMLElement{
  if(!cards.length)return deviceUnavailablePage(p.device,p.back);
  const {stage,body}=frame(p,category);
  body.append(element('div','category-product',p.artwork(),element('h1','',p.device.name)));
  const controls=element('div','device-card-stack',...cards);
  body.append(controls);
  return deviceSurfaces(stage);
}

const toiletIcons:Record<ToiletRole,IconName>={
  lid:'curtain-open',seat:'curtain-close',eco:'leaf',foam:'droplet',light:'light',dry:'wind',flush:'fan',stop:'minus',
  rear:'droplet',front:'droplet',child:'droplet',auto:'droplet',move:'swing-horizontal',strong:'wind',massage:'refresh',nozzleClean:'droplet',
};
export function toiletPage(p:PageProps&{setting?:string;select:(setting:string)=>void}):HTMLElement{
  const seated=toiletSeated(p.panel);
  const {stage,body}=frame(p,'toilet',seated===undefined?undefined:seated?'已着座':'离座状态');
  const cards=element('div','device-card-stack toilet-cards');
  const bound=toiletControls(p.panel);
  for(const [group,label,roles] of [['common','常用功能',toiletCommon],['cleaning','清洁功能',toiletCleaning]] as const){
    const commands=bound.filter(c=>roles.includes(c.role));
    if(!commands.length)continue;
    const card=modeCard(label,commands.map(({role,command,blocked,selected})=>({
      label:toiletLabels[role],graphic:icon(toiletIcons[role]),selected,focusKey:`toilet-${role}`,
      press:command&&!p.disabled&&!blocked&&!p.actionPending(command)?()=>p.execute(command):undefined,
    })));
    card.dataset.modeGroup=group;
    cards.append(card);
  }
  const settings=toiletSettings(p.panel);
  if(settings.length){
    const key=(property:Property)=>`${property.siid}:${property.piid}`;
    const selected=settings.find(c=>key(c.property)===p.setting)??settings[0];
    const card=modeCard('挡位调节',settings.map(setting=>{
      const glyph:IconName=setting.label.includes('位置')?'swing-horizontal':setting.label.includes('风')?'wind':setting.label.includes('水压')?'droplet':'climate';
      const id=key(setting.property);
      return {label:setting.label,graphic:icon(glyph),selected:setting===selected,focusKey:`toilet-setting-${id}`,press:()=>p.select(id)};
    }));
    card.dataset.modeGroup='settings';
    const property=selected.property;
    const slider=p.control({name:'Slider',props:{property,label:selected.label,theme:'fan',
      unit:deviceUnit(property.unit)||'档',discrete:validChoices(property),
      locked:p.disabled||!bathroomCurrentValid(property),
      choiceLabel:description=>property.valueList?.find(c=>c.description===description)?.localizedDescription??description}});
    slider.classList.add('toilet-adjustment');
    card.append(slider);
    cards.append(card);
  }
  if(!cards.childElementCount)return deviceUnavailablePage(p.device,p.back);
  body.append(cards);
  return deviceSurfaces(stage);
}

export function standardBathHeaterPage(p:PageProps):HTMLElement{
  const {stage,body}=bathFrame(p.device,p.back);
  const bath=standardBathHeater(p.panel);
  const hero=element('div','bath-hero');
  if(bath.running&&bath.active.length)hero.append(element('p','','浴霸已开启'));
  hero.append(element('h1','',bath.running?bath.active.join(' | ')||'浴霸已开启':bath.known?'浴霸已关闭':bath.lightOn?'照明已开启':p.device.online?'浴霸':'设备离线'));
  const cards=element('div','bath-cards device-card-stack');
  const enabled=(command:BathroomCommand|undefined,locked=false)=>command&&!p.disabled&&!locked&&!p.actionPending(command)
    ?()=>p.execute(command):undefined;
  const power=(label:string,glyph:string,command:BathroomCommand|undefined,selected:boolean,locked=false)=>
    powerCard(label,roundPowerButton({label,on:selected,pressed:glyph==='light_switch'?selected:undefined,
      graphic:officialIcon('bath:'+glyph+':'+(selected?'on':'off')),press:enabled(command,locked)}));
  const primary=element('div','bath-power detail-power-row');
  if(bath.stop)primary.append(power('停止浴霸','bhf_switch',bath.stop,bath.running,bath.known&&!bath.running));
  if(bath.light)primary.append(power(bath.lightOn?'关闭照明':'开启照明','light_switch',bath.lightCommand,bath.lightOn));
  if(primary.childElementCount)cards.append(primary);
  for(const [group,label] of [['ventilation','换气'],['blowing','送风'],['modes','模式']] as const){
    const choices=bath.choices.filter(c=>c.group===group);
    const gears=bath.gears.filter(([g,,property])=>g===group&&property);
    if(!choices.length&&!gears.length)continue;
    const card=modeCard(label,choices.map(item=>({
      label:item.label,graphic:bathModeIcon(item.icon,item.selected),selected:item.selected,
      focusKey:`bath-${group}-${item.icon}-${item.label}`,press:enabled(item.command),
    })));
    card.dataset.modeGroup=group;
    for(const [,gearLabel,property] of gears){
      const gear=adjustment(p,property!,gearLabel,{omitChoiceNotes:true});
      gear.classList.add('bath-adjustment');
      card.append(gear);
    }
    cards.append(card);
  }
  if(!cards.childElementCount)return deviceUnavailablePage(p.device,p.back);
  body.append(hero,cards);
  return deviceSurfaces(stage);
}
