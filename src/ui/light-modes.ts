import {officialIcon} from '../icons';
import { temperaturePalette, rgbHex } from '../light-color';
import { validLightModeSlot, wyraModeReason, wyraModeValue, wyraScenes } from '../light-modes';
import type { LightModeReport, LightModeSlot, Property,LightFavorite,LightFavoritesReport } from '../types';
import { validFavorite } from '../light-favorites';
import type { ControlEnvironment } from './controls';
import { button, element } from './dom';
import {deviceWait} from './device-loading';

export interface LightModesProps {
  artwork?:()=>HTMLElement;
  property?: Property;
  report?: LightModeReport;
  slotsReason?: string;
  expanded: boolean;
  expand: (expanded: boolean) => void;
  selectSlot?: (slot: LightModeSlot) => void;
  editModes?:()=>void;
  editFlow?:()=>void;
  sceneTab?:'standard'|'custom';selectSceneTab?:(tab:'standard'|'custom')=>void;
  favorites?:LightFavoritesReport;favoritesLoading?:boolean;favoritesError?:string;favoritesBusy?:boolean;
  addFavorite?:()=>void;editFavorite?:(item:LightFavorite)=>void;applyFavorite?:(item:LightFavorite)=>void;favoriteReason?:(item:LightFavorite)=>string|undefined;
}

function sceneGlyph(name:string,selected=false):SVGSVGElement {return officialIcon('yeelight:'+name+':'+(selected?'on':'off'));}

function slotColor(slot:LightModeSlot):string {
  if(slot.color!=null)return rgbHex(slot.color);
  // The palette is visual only. The Kelvin value remains a confirmed private
  // slot reading and is never substituted for a public property descriptor.
  const tint=temperaturePalette(Math.trunc((slot.temperature!-2700)/3800*100));
  return tint??'#f1f1f1';
}

export function renderLightModes(props:LightModesProps,env:ControlEnvironment):HTMLElement {
  const root=element('div','yeelight-modes');
  let selected=wyraModeValue(props.property);
  const modeButtons:{button:HTMLButtonElement;value:number}[]=[];
  const reason=(value:number):string|undefined=>!env.device.online?'设备离线，恢复在线后可操作。':env.busy?'正在更新设备状态。':wyraModeReason(props.property,value);
  const bind=(node:HTMLElement,name:string):void=>{
    node.dataset.control=name;
    if(props.property){node.dataset.siid=String(props.property.siid);node.dataset.piid=String(props.property.piid);}
    if(props.property?.pending){node.dataset.pending=props.property.pending;node.setAttribute('aria-busy','true');node.setAttribute('aria-description',props.property.pending==='uncertain'?'待确认，正在查询实际状态':'正在确认设备状态');}
  };
  const disable=(control:HTMLButtonElement,message:string|undefined):void=>{control.disabled=!!message;if(message)control.setAttribute('aria-description',message);};
  const my=element('section','native-card yeelight-modes-card yeelight-my-modes');bind(my,'LightModes');
  const edit=button('','yeelight-mode-edit',()=>{if(edit.isConnected&&!edit.disabled)props.editModes?.();},'chevron');edit.setAttribute('aria-label','模式设置');
  disable(edit,props.editModes?undefined:'模式设置入口暂不可用。');
  my.append(element('div','yeelight-mode-heading',element('h3','','我的模式'),edit));
  const slots=element('div','yeelight-mode-slots');
  const update=():void=>{
    for(const item of modeButtons){item.button.setAttribute('aria-pressed',String(item.value===selected));item.button.classList.toggle('selected',item.value===selected);const glyph=item.button.dataset.sceneGlyph;if(glyph)item.button.querySelector('.yeelight-scene-disc')?.replaceChildren(sceneGlyph(glyph,item.value===selected));}
    root.querySelector('.yeelight-flow-artwork')?.replaceChildren(sceneGlyph('shade',selected===15));
    flowSwitch.setAttribute('aria-checked',selected===undefined?'mixed':String(selected===15));flowSwitch.classList.toggle('selected',selected===15);
  };
  const choose=(value:number,slot?:LightModeSlot):void=>{
    if(!root.isConnected||reason(value)||!props.property)return;
    selected=value;update();
    if(slot)props.selectSlot?.(slot);
    env.write(props.property,value);
  };
  for(let index=0;index<4;index++){
    const matches=props.report?.slots.filter(slot=>slot.index===index)??[],slot=matches.length===1?matches[0]:undefined;
    const slotReason=slot?.reason,valid=validLightModeSlot(slot,index);
    const control=button('','yeelight-mode-slot',()=>{if(!control.disabled&&!props.slotsReason&&validLightModeSlot(slot,index))choose(index+11,slot);});control.setAttribute('aria-label',`我的模式 ${index+1}`);
    const inner=element('span','yeelight-mode-disc',valid?`${slot.brightness}%`:null);
    if(valid){inner.style.background=slotColor(slot);control.style.setProperty('--slot-color',slotColor(slot));}
    control.append(inner);control.dataset.mode=String(index+11);
    const unavailable=props.slotsReason??(!valid?slotReason??'模式槽位尚未读取。':undefined);
    disable(control,reason(index+11)??unavailable);modeButtons.push({button:control,value:index+11});slots.append(control);
  }
  my.append(slots);root.append(my);
  const scenes=element('section','native-card yeelight-modes-card yeelight-scene-modes');bind(scenes,'LightScenes');
  scenes.append(element('h3','','情景模式'));
  const isCustom=props.sceneTab==='custom';
  const standard=button('标准',isCustom?'':'selected',()=>{if(root.isConnected)props.selectSceneTab?.('standard');});standard.setAttribute('role','tab');standard.setAttribute('aria-selected',String(!isCustom));
  const custom=button('自定义',isCustom?'selected':'',()=>{if(root.isConnected&&!custom.disabled)props.selectSceneTab?.('custom');});custom.setAttribute('role','tab');custom.setAttribute('aria-selected',String(isCustom));disable(custom,props.selectSceneTab?undefined:'收藏入口暂不可用。');
  const tabs=element('div','yeelight-scene-tabs',standard,custom);tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','情景模式');scenes.append(tabs);
  const grid=element('div','yeelight-scene-grid');
  for(const scene of isCustom?[]:wyraScenes.slice(0,props.expanded?12:4)){
    const control=button('','yeelight-scene-button',()=>choose(scene.value));control.dataset.mode=String(scene.value);control.dataset.sceneGlyph=scene.glyph;
    control.append(element('span','yeelight-scene-ring',element('span','yeelight-scene-disc',sceneGlyph(scene.glyph,scene.value===selected))),element('span','yeelight-scene-name',scene.name));
    control.setAttribute('aria-label',scene.name);disable(control,reason(scene.value));modeButtons.push({button:control,value:scene.value});grid.append(control);
  }
  if(isCustom){
    grid.classList.add('yeelight-favorites-grid');
    if(props.favoritesLoading){grid.setAttribute('aria-busy','true');grid.append(deviceWait(props.artwork,'自定义场景'));}
    if(props.favoritesError){const message=element('p','light-favorites-error',props.favoritesError);message.setAttribute('role','alert');scenes.append(message);}
    const rows=props.favorites?.items??[],items=props.expanded?rows:rows.slice(0,4);
    for(const item of items){
      const valid=validFavorite(item),control=button('','yeelight-scene-button yeelight-favorite',()=>{if(control.isConnected&&!control.disabled&&!held&&!props.favoriteReason?.(item))props.applyFavorite?.(item);held=false;});
      control.dataset.favoriteId=item.id;control.setAttribute('aria-label',item.name);
      const inner=element('span','yeelight-scene-disc',valid?`${item.brightness}%`:'--');if(valid)inner.style.background=item.tab==='color'?rgbHex(item.color!):temperaturePalette(item.temperaturePercent!)??'';
      control.append(element('span','yeelight-scene-ring',inner),element('span','yeelight-scene-name',item.name));
      disable(control,props.favoritesBusy?'收藏仍待确认。':!valid?item.reason??'收藏内容不可用。':undefined);
      const activationReason=props.favoriteReason?.(item);if(activationReason)control.setAttribute('aria-description',activationReason+'；右键可编辑收藏。');
      let timer:ReturnType<typeof setTimeout>|undefined,held=false,startX=0,startY=0,pointer:number|undefined,observer:MutationObserver|undefined;
      const clear=()=>{clearTimeout(timer);timer=undefined;pointer=undefined;window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',up,true);window.removeEventListener('blur',clear);observer?.disconnect();observer=undefined;};
      const up=(event:PointerEvent)=>{if(pointer===event.pointerId)clear();};
      const edit=()=>{clear();if(control.isConnected&&!control.disabled){held=true;props.editFavorite?.(item);}};
      control.addEventListener('contextmenu',event=>{event.preventDefault();edit();});
      control.addEventListener('pointerdown',event=>{if(event.button!==0||control.disabled||!control.isConnected)return;clear();held=false;pointer=event.pointerId;startX=event.clientX;startY=event.clientY;timer=setTimeout(edit,400);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',up,true);window.addEventListener('blur',clear);observer=new MutationObserver(()=>{if(!control.isConnected)clear();});observer.observe(document.documentElement,{childList:true,subtree:true});});
      control.addEventListener('pointermove',event=>{if(Math.hypot(event.clientX-startX,event.clientY-startY)>8)clear();});
      for(const name of ['pointerup','pointercancel','lostpointercapture'])control.addEventListener(name,event=>{if((event as PointerEvent).pointerId===pointer)clear();});
      control.addEventListener('keydown',event=>{if(event.key==='F2'){event.preventDefault();edit();}});grid.append(control);
    }
    if((props.expanded||rows.length<4)&&props.favorites){const add=button('','yeelight-scene-button yeelight-favorite-add',()=>{if(add.isConnected&&!add.disabled)props.addFavorite?.();});add.setAttribute('aria-label','添加收藏');add.append(element('span','yeelight-scene-ring',element('span','yeelight-scene-disc',officialIcon('plus'))),element('span','yeelight-scene-name','添加'));disable(add,props.favoritesBusy?'收藏仍待确认。':undefined);grid.append(add);}
  }
  const more=button(props.expanded?'隐藏':'更多','yeelight-scenes-more',()=>{if(root.isConnected)props.expand(!props.expanded);},'chevron');more.setAttribute('aria-expanded',String(props.expanded));
  if(props.expanded)more.classList.add('expanded');scenes.append(grid);if(!isCustom||(props.favorites?.items.length??0)>=4)scenes.append(more);root.append(scenes);
  const flow=element('section','native-card yeelight-flow');bind(flow,'LightFlow');
  const flowGlyph=element('span','yeelight-flow-artwork',sceneGlyph('shade',selected===15));
  const flowEdit=button('','yeelight-flow-edit',()=>{if(flowEdit.isConnected&&!flowEdit.disabled)props.editFlow?.();},'more');flowEdit.setAttribute('aria-label','流光模式设置');disable(flowEdit,props.editFlow?undefined:'流光模式设置入口暂不可用。');
  const flowSwitch=button('','yeelight-flow-switch',()=>{if(!flowSwitch.disabled)choose(selected===15?0:15);});flowSwitch.setAttribute('role','switch');flowSwitch.setAttribute('aria-label','流光模式');flowSwitch.append(element('span','yeelight-flow-knob'));
  disable(flowSwitch,reason(0)??reason(15));
  flow.append(flowGlyph,element('strong','','流光模式'),flowEdit,flowSwitch);root.append(flow);update();
  return root;
}
