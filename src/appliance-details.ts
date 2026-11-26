import {capabilityCategory} from './device-capabilities';
import type {Device,DevicePanel,Property,Service} from './types';

const petAndPlantCategories:Record<string,string>={
  flowerpot:'flowerpot',
  litter_box:'cat-litter-box',
  pet_waterer:'pet-drinking-fountain',
  feeder:'pet-feeder',
  fishbowl:'fish-tank',
  s_lamp:'germicidal-lamp',
};

export function matchingPanel(device:Device,panel:DevicePanel|undefined):DevicePanel|undefined {
  return panel?.did===device.did&&panel.model===device.model?panel:undefined;
}

export function applianceDetailCategory(device:Device,panel?:DevicePanel):string|undefined {
  const category=capabilityCategory(matchingPanel(device,panel)?.specType??device.specType);
  if(category)return category;
  if(device.model==='xiaomi.station.rp05')return 'nas';
  const modelType=device.model.split('.')[1];
  if(modelType==='cs')return 'card-switch';
  if(modelType==='waterpuri'||modelType==='waterpurifier')return 'water-purifier';
  const kitchen:Record<string,string>={microwave:'microwave-oven',coffee:'coffee-machine',ihcooker:'induction-cooker',
    pre_cooker:'pressure-cooker',health_pot:'health-pot',ysj:'water-dispenser',plmachine:'water-dispenser',
    hood:'hood',i_stove:'integrated-stove',dishwasher:'dishwasher',steriliser:'sterilizer',oven:'oven',cm:'cooking-machine',
    ven_fan:'ceiling-fan',f_washer:'fruit-vegetable-purifier',w_soften:'water-softener',fryer:'air-fryer',
    mfcp:'multifunction-cooking-pot',milkheat:'baby-bottle-warmer',disposer:'garbage-disposal',icemake:'ice-maker',
    esteamer:'electric-steamer',boiler:'boiler',teabar:'teabar'};
  if(Object.hasOwn(kitchen,modelType))return kitchen[modelType];
  const living:Record<string,string>={curtain:'curtain',mosq:'mosquito-dispeller',toothbrush:'toothbrush',mirror:'mirror',
    mattress:'mattress',motor:'motor-controller',blanket:'electric-blanket',bed:'bed',dryer:'clothes-dryer',wopener:'window-opener',
    pillow:'pillow',valve:'electronic-valve',sofa:'sofa',beauty:'beauty-instrument',roller:'roller-shutter',
    razor:'shaver',hair:'hair-drier',dental:'oral-irrigator'};
  if(Object.hasOwn(living,modelType))return living[modelType];
  if(Object.hasOwn(petAndPlantCategories,modelType))return petAndPlantCategories[modelType];
  if(['kettle','cooker','juicer'].includes(modelType))return modelType;
  if(modelType==='gateway'||modelType==='fridge')return modelType;
}

const personalOtherModels=new Set(['doco.fcb.docov001','guoshi.other.sem01','kola.milk.v1']);
const unavailableApplianceCategories=new Set([
  'gateway','nas','intercom','microwave-oven','coffee-machine','induction-cooker','juicer',
  'oven','health-pot','cooking-machine','fruit-vegetable-purifier','baby-bottle-warmer','garbage-disposal','ice-maker',
  'toothbrush','mattress','motor-controller','bed','window-opener','pillow','electronic-valve',
  'beauty-instrument','roller-shutter','shaver','hair-drier','oral-irrigator',
  ...Object.values(petAndPlantCategories),
  // 运动健康
  'ab-wheel','analyzer','bracelet','cup','dumbbell','foot-bath','jump-rope','massage','massager',
  'moxibustion','scale','shoes','sleep-monitor','sphygmomanometer','stationary-bicycle','thermometer','treadmill','walking-pad','watch',
  // 出行车载
  'bike','car-air-purifier','carlight','charging-pile','driving-recorder','electric-power',
  'head-up-display','rearview-mirror','safety-seat','scooter','suitcase',
  // 办公学习
  'chair','laptop','printer','table',
  // 其他
  'fitting','ir-remote-control','pump','rangefinder',
]);

// Model types used in these four groups also identify devices whose account has no usable Spec.
const unavailableGroupModelTypes=new Set([
  'abwheel','ajh','analyzer','bleshoes','bp','bpm','bracelet','cup','db','exbike',
  'foot_bath','jmprope','lunar','magic_touch','massage','ro_skates','scales','thermo','treadmill','walkingpad','watch',
  'bike','carairpuri','cardvr','carlight','carseat','enstor','evc','hud','rv_mirror','scooter',
  'chair','desk','laptop','printer','sxb',
  'etool','fitting','intercom','ir','pump',
]);

export function unavailableApplianceDetail(category:string|undefined,model:string):boolean {
  return unavailableApplianceCategories.has(category??'')||
    unavailableGroupModelTypes.has(model.split('.')[1])||personalOtherModels.has(model);
}

export function simpleLivingDetail(category:string|undefined):category is 'mosquito-dispeller'|'mirror'|'electric-blanket'|'sofa' {
  return category==='mosquito-dispeller'||category==='mirror'||category==='electric-blanket'||category==='sofa';
}

export function specializedKitchenDetail(category:string|undefined):boolean {
  return ['kettle','water-dispenser','cooker','pressure-cooker','teabar','boiler','hood','integrated-stove',
    'dishwasher','sterilizer','ceiling-fan','water-softener','air-fryer','multifunction-cooking-pot','electric-steamer'].includes(category??'');
}

export function detailServices(panel:DevicePanel|undefined):Service[] {
  if(!panel||panel.unsupportedReason)return [];
  return panel.services.filter(s=>Number.isSafeInteger(s.siid)&&s.siid>0&&panel.services.filter(other=>other.siid===s.siid).length===1);
}

export function detailProperty(service:Service,name:string):Property|undefined {
  const matches=service.properties.filter(p=>p.name===name);
  if(matches.length!==1)return;
  const property=detailPropertyAt(service,matches[0].piid,name);
  if(property?.access.includes('read'))return property;
}

export function detailPropertyAt(service:Service,piid:number,name:string):Property|undefined {
  const matches=service.properties.filter(p=>p.piid===piid);
  if(matches.length!==1)return;
  const property=matches[0];
  if(property.name===name&&property.siid===service.siid&&Number.isSafeInteger(piid)&&piid>0&&!property.unsupportedReason)return property;
}

const alternateCardSwitches:Record<string,string>={
  'yoohoo.cs.ck01':'yoohoo-ck01',
  'znsn.cs.ck01':'znsn-ck01',
  'symi.cs.ck01':'symi-ck01',
  'lat888.cs.ck01':'lat888-ck01',
};

export function cardSwitchPower(panel:DevicePanel|undefined):Property|undefined {
  if(!panel||capabilityCategory(panel.specType)!=='card-switch')return;
  const services=detailServices(panel);
  const primary=services.filter(service=>service.name==='card-switch');
  if(primary.length!==1)return;
  const valid=(property:Property|undefined)=>property?.format==='bool'&&property.access.includes('write')&&!property.valueList&&!property.valueRange?property:undefined;
  if(primary[0].properties.some(p=>p.name==='on'))return valid(detailProperty(primary[0],'on'));
  const variant=Object.hasOwn(alternateCardSwitches,panel.model)?alternateCardSwitches[panel.model]:undefined;
  if(!variant||panel.specType!==`urn:miot-spec-v2:device:card-switch:0000A0AA:${variant}:1:0000C81B`)return;
  const basic=services.find(service=>service.name==='basic'&&service.siid===4);
  const power=basic&&detailProperty(basic,'power-ctrl');
  if(power?.piid===1)return valid(power);
}
