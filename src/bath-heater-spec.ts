import {bathroomAction,bathroomAdjustable,bathroomChoice,bathroomChoiceKeys,bathroomCurrentValid,bathroomToggle,bathroomWritable,propertiesFor,type BathroomCommand} from './bathroom';
import {validChoices} from './device-capabilities';
import type {DevicePanel,Property} from './types';

type Group='ventilation'|'blowing'|'modes';
export interface BathChoice {label:string;icon:string;group:Group;selected:boolean;command?:BathroomCommand}
const vent=['ventilate','ventilation','lownoiseventilate','lownoiseventilation','cruiseventilation','sventilation','inventilation','vertilate2','ventilate2','highventilation','lowventilation'];
const blowing=['fan','blow','heat','heat2','blowhigh','blowlow','warmweak','weakwarmth','weakwarm','warmstrong','strongwarmth','mildlywarm','weaklywarm','weakwarmair','weakheat','lowheat','windheatinglow','softwarmth','cozywarm','gentlewind','fanheater1'];
const modeLabels:Record<string,string>={
 ventilate:'换气',ventilation:'换气',lownoiseventilate:'低噪换气',lownoiseventilation:'低噪换气',
 cruiseventilation:'巡航换气',highventilation:'换气高档',lowventilation:'换气低档',
 fan:'吹风',blow:'吹风',heat:'暖风',warmweak:'暖风低档',warmstrong:'暖风高档',weakwarm:'暖风低档',
 blowhigh:'吹风高档',blowlow:'吹风低档',gentlewind:'柔风',softwarmth:'柔暖',
 quickheat:'极速加热',quickheating:'极速加热',warmup:'预热',defog:'恒温除雾',quickdefog:'快速除雾',
 fastdefog:'快速除雾',speedydefogging:'快速除雾',dry:'智能干燥',intelligentdrying:'智能干燥',
 dehumidify:'除湿',dehumidification:'除湿',hotdry:'暖风干燥',cooldry:'凉风干燥',colddry:'凉风干燥',
 shower:'沐浴',bath:'沐浴',smartbath:'智能沐浴',smartbathing:'智能沐浴',showermode:'沐浴模式',
 disinfection:'消毒',disinfect:'消毒',sterilization:'杀菌',sterilize:'杀菌',degerming:'除菌',
 deodorization:'除臭',deodorize:'除臭',deo:'除臭',purification:'净化',purify:'净化',deeppurification:'深度净化',
 constanttemperature:'恒温',smartconstanttemperature:'智能恒温',intelligentconstanttemperature:'智能恒温',
 constanttemperatureheating:'恒温暖风',smartheat:'智能取暖',smartheating:'智能取暖',
 warmweakness:'弱暖',weakwarmth:'弱暖',weaklywarm:'弱暖',weakwarmair:'弱暖',weakheat:'弱暖',lowheat:'弱暖',
 strongwarmth:'强暖',mildlywarm:'柔暖',cozywarm:'舒适暖风',manualmode:'手动模式',dryingmode:'干燥模式',coolingmode:'凉风模式',
};
const idleModes=['idle','off','close','none','modeless','关闭','待机','停止'];
const displayOnlyModes=['na','reserved','working','other','invalid','unknown','预留','其他'];

export function standardBathHeater(panel:DevicePanel){
  const choices:BathChoice[]=[];
  const active:string[]=[];
  let hasState=false;
  let unknown=false;
  let idle:BathroomCommand|undefined;
  let running=false;
  const components=propertiesFor(panel,['ptc-bath-heater.ventilation','ptc-bath-heater.blow','ptc-bath-heater.heating'],p=>bathroomWritable(p)&&(!!bathroomToggle(p)||validChoices(p)));
  const modes=propertiesFor(panel,['ptc-bath-heater.mode'],p=>bathroomWritable(p)&&validChoices(p));
  for(const mode of modes){
    const current=bathroomChoice(mode);
    hasState ||= !!current;
    unknown ||= !current;
    for(const choice of mode.valueList!){
      const keys=bathroomChoiceKeys(choice);
      if(keys.some(k=>idleModes.includes(k))){
        if(modes.length===1&&current)idle={property:mode,value:choice.value};
        continue;
      }
      if(keys.some(k=>displayOnlyModes.includes(k)))continue;
      const group=keys.some(k=>vent.includes(k)||/^换气|^通风/.test(k))?'ventilation'
        :keys.some(k=>blowing.includes(k)||/^吹风|^送风|^暖风|^弱暖|^强暖/.test(k))?'blowing':'modes';
      const label=modeLabels[keys[0]]??choice.localizedDescription??(/[^\x00-\x7F]/.test(choice.description)?choice.description:undefined);
      if(!label)continue;
      const selected=current===choice;
      if(selected){running=true;active.push(label);}
      choices.push({label,group,icon:group==='ventilation'?'ventilation_low_gear':group==='blowing'?'cool_wind_low_gear':
        keys.includes('quickheat')?'fast_warm':keys.includes('quickdefog')?'fast_defog':keys.includes('defog')?'defog':'drying',
        selected,command:current?{property:mode,value:choice.value}:undefined});
    }
  }
  for(const property of components){
    const group=property.name==='ventilation'?'ventilation':'blowing';
    const label=property.name==='ventilation'?'换气':property.name==='heating'?'暖风':'吹风';
    const glyph=group==='ventilation'?'ventilation_low_gear':property.name==='heating'?'warm_wind_low_gear':'cool_wind_low_gear';
    const toggle=bathroomToggle(property);
    const ready=bathroomCurrentValid(property);
    hasState ||= ready;
    unknown ||= !ready;
    if(toggle){
      const selected=ready&&property.value===toggle.on;
      if(selected){running=true;active.push(label);}
      if(!choices.some(c=>c.label===label))choices.push({label,group,icon:glyph,selected,command:ready?{property,value:selected?toggle.off:toggle.on}:undefined});
    }else for(const choice of property.valueList??[]){
      const [key]=bathroomChoiceKeys(choice);
      if(idleModes.includes(key))continue;
      const gear=({low:'低档',mid:'中档',medium:'中档',high:'高档'} as Record<string,string>)[key]??choice.localizedDescription;
      if(!gear)continue;
      const selected=ready&&property.value===choice.value;
      if(selected){running=true;active.push(label+gear);}
      choices.push({label:label+gear,group,icon:glyph,selected,command:ready?{property,value:choice.value}:undefined});
    }
  }
  for(const [service,actions] of [['yl-bath',['ventilation-low','ventilation-high','blow-low','blow-high','blow-natural']],['yl-bath-heater',['ventilation-low','blow-low']]] as const){
    for(const name of actions){
      const command=bathroomAction(panel,[service+'.'+name]);
      if(!command)continue;
      const [feature,gear]=name.split('-');
      const group=feature==='ventilation'?'ventilation':'blowing';
      const label=(group==='ventilation'?'换气':'吹风')+(gear==='high'?'高档':gear==='low'?'低档':'自然风');
      if(!choices.some(c=>c.label===label))choices.push({label,group,selected:false,
        icon:group==='ventilation'?'ventilation_'+gear+'_gear':'cool_wind_'+(gear==='high'?'high':'low')+'_gear',command});
    }
  }
  const status=propertiesFor(panel,['ptc-bath-heater.status'],p=>p.access.includes('read'))[0];
  const statusChoice=bathroomChoice(status);
  if(statusChoice){
    const keys=bathroomChoiceKeys(statusChoice);
    if(keys.some(k=>['busy','working','atwork','run','timedshutdown','delay','运行中','工作中'].includes(k))){running=true;hasState=true;}
    if(keys.some(k=>['idle','off','standby','free','done','空闲','待机'].includes(k)))hasState=true;
  }
  const stop=bathroomAction(panel,['ptc-bath-heater.stop-working'])??(components.length===0?idle:undefined);
  const light=propertiesFor(panel,['light.on'],p=>bathroomWritable(p)&&!!bathroomToggle(p))[0];
  const lightValues=light&&bathroomToggle(light);
  const lightOn=!!light&&!!lightValues&&bathroomCurrentValid(light)&&light.value===lightValues.on;
  const lightCommand=light&&lightValues&&bathroomCurrentValid(light)?{property:light,value:lightOn?lightValues.off:lightValues.on}:undefined;
  const gears:readonly [Group,string,Property|undefined][]=[
    ['ventilation','换气档位',propertiesFor(panel,['extend.ventilate-gear','product-setting.ventilation-level','custom.ventilate-level'],bathroomAdjustable)[0]],
    ['blowing','吹风档位',propertiesFor(panel,['product-setting.blow-level'],bathroomAdjustable)[0]],
    ['blowing','暖风档位',propertiesFor(panel,['ptc-bath-heater.heat-level'],bathroomAdjustable)[0]],
  ];
  return {choices,active:[...new Set(active)],running,known:hasState&&!unknown,stop,light,lightOn,lightCommand,gears};
}
