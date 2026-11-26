import {kitchenCycleBindings,kitchenFanBindings,switchState,type KitchenCycleCategory} from '../kitchen-controls';
import type {Device,DevicePanel,Json,Property} from '../types';
import {deviceChoiceLabel,deviceUnit} from '../device-labels';
import {button,element} from './dom';
import {waterHeatingFrame} from './bathroom-page';
import {washerGlyph,washerHomeHero,washerProgramGrid,washerProgramList,washerStatusCard} from './washer-page';
import {washerRuntimeFrame} from './washer-runtime-page';
import {washerHomeStatus,washerRuntimeFinish,type WasherRuntimeSnapshot} from '../washer-runtime';
import {deviceUnavailablePage} from './device-unavailable';
import {deviceSurfaces} from './device-surfaces';
import {controlReason} from '../panel-layout';
import type {ControlNode} from './controls';

interface KitchenPageProps {
  device:Device;
  panel?:DevicePanel;
  artwork:()=>HTMLElement;
  back:()=>void;
  control:(node:ControlNode)=>HTMLElement;
}

export function hoodPage(p:KitchenPageProps,category:'hood'|'integrated-stove'):HTMLElement {
  const {on,light,mode,speed}=kitchenFanBindings(p.device,p.panel,category);
  const cards:HTMLElement[]=[];
  const locked=!!on&&switchState(on)!==true;
  if(on)cards.push(p.control({name:'Power',props:{...on,label:'烟机',openLabel:'启动',closeLabel:'关闭'}}));
  if(light)cards.push(p.control({name:'Power',props:{...light,label:'照明',glyph:'light',openLabel:'打开照明',closeLabel:'关闭照明'}}));
  if(mode)cards.push(p.control({name:'Selector',props:{property:mode,label:'模式',showValue:true,locked,
    choiceLabel:description=>mode.valueList?.find(choice=>choice.description===description)?.localizedDescription??deviceChoiceLabel(description)}}));
  if(speed)cards.push(p.control({name:'Slider',props:{property:speed,label:speed.valueList?'风速档位':'风速',unit:deviceUnit(speed.unit),theme:'fan',
    discrete:!!speed.valueList,locked,choiceLabel:description=>speed.valueList?.find(choice=>choice.description===description)?.localizedDescription??description}}));
  return waterHeatingFrame(p,category,cards);
}

export type KitchenCycleView='runtime'|'more'|{mode:Json;fromMore:boolean}|undefined;

export function kitchenCyclePage(p:KitchenPageProps&{cached:boolean;readAt?:number;view:KitchenCycleView;
  open:(view:KitchenCycleView)=>void;write:(property:Property,value:Json)=>void},category:KitchenCycleCategory):HTMLElement {
  const {mode,phase,choices,selected,remaining,duration,canSelect}=kitchenCycleBindings(p.device,p.panel,category);
  const state=p.device.online&&phase?{working:'busy',paused:'paused',scheduled:'delay',completed:'completed',idle:'idle'}[phase]:'unknown';
  const active=['busy','paused','delay'].includes(state);
  const runtime:WasherRuntimeSnapshot={state,active,mode:null,modeLabel:selected?.label,
    stage:null,remainingMinutes:remaining??null,reservationMinutes:null,weighing:false,hasDrying:false,cleaning:false,locked:null,steps:[],controls:[]};
  const name=category==='dishwasher'?'洗碗机':'消毒柜';
  if(p.view==='runtime')return deviceSurfaces(washerRuntimeFrame({title:selected?.label??p.device.name,kind:category,
    runtime,readAt:p.readAt,back:()=>p.open(undefined)}).stage);
  if(!choices.length&&!active)return deviceUnavailablePage(p.device,p.back);
  const draft=typeof p.view==='object'?p.view:undefined;
  const program=draft&&choices.find(choice=>choice.value===draft.mode);
  const more=p.view==='more';
  const detail=more||!!program;
  const back=button('','page-icon-button',detail?()=>p.open(draft?.fromMore?'more':undefined):p.back,'back');
  back.setAttribute('aria-label',detail?`返回${name}`:'返回家庭');
  const scroll=element('div',program?'device-page-scroll washer-program-scroll':'device-page-scroll');
  const page=element('section',`device-page page-washer page-${category}${detail?' washer-subpage':''}${program?' washer-program-page':''}`,
    element('header','device-page-header',back,element('div','device-page-title',element('h2','',program?.label??(more?'更多':p.device.name)))),scroll);
  page.dataset.presentationTemplate=category;page.dataset.visualAdapter=category;
  const locked=active||!p.device.online;
  const tiles=choices.map(choice=>({name:String(choice.value),title:choice.label,glyph:choice.glyph,disabled:locked,
    select:()=>p.open({mode:choice.value,fromMore:more})}));
  if(more)scroll.append(washerProgramList(tiles));
  else if(program){
    const actual=program.label===selected?.label;
    scroll.append(element('div','washer-program-hero',washerGlyph(program.glyph),actual&&duration?element('div','washer-program-time',`${duration} 分钟`):null));
    if(mode?.access.includes('write')){
      const apply=button(actual?'当前模式':'应用模式','washer-program-command washer-program-start',()=>{
        if(!apply.disabled)p.write(mode,program.value);
      });
      apply.disabled=actual||!canSelect||!!p.device.sharedReadOnly||!!controlReason(mode,p.device.online,p.cached);
      apply.dataset.focusKey='washer-program-mode';page.append(element('footer','washer-program-footer',apply));
    }
  }else{
    const controls=element('div','washer-home-controls');
    if(active){
      page.dataset.washerRunning='true';
      const finish=washerRuntimeFinish(runtime,p.readAt);
      const time=finish?`预计${finish}完成`:remaining!==undefined&&state!=='delay'?`剩余${remaining}分钟`:undefined;
      controls.append(washerStatusCard(washerHomeStatus(runtime),[selected?.label,time].filter(Boolean).join(' | '),state,()=>p.open('runtime')));
    }
    if(tiles.length){
      const grid=washerProgramGrid(tiles,()=>p.open('more'),locked);
      grid.setAttribute('aria-label',selected?`模式 · ${selected.label}`:'模式');
      if(mode){grid.dataset.siid=String(mode.siid);grid.dataset.piid=String(mode.piid);grid.dataset.propertyName=mode.name;}
      controls.append(grid);
    }
    scroll.append(element('div','washer-home-content',washerHomeHero(),controls));
  }
  return deviceSurfaces(element('div','device-stage',page));
}
