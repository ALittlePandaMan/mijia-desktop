import {deviceSurfaces} from './device-surfaces';
import {deviceChannelPicker} from './device-channel-picker';
import type { Device, DevicePanel, Json } from '../types';
import { button, element } from './dom';
import { icon,officialIcon } from '../icons';
import { isDryerPanel, washerFields, washerFieldText, washerMinutes, type WasherConfigReport, type WasherDraft, type WasherProgram } from '../washer';
import type {WasherCommands} from '../washer-commands';
import {deviceWait} from './device-loading';
import {dismissOnBackdrop} from './dialog-dismiss';
import {washerHomeStatus,washerProgramsLocked,washerRuntimeFinish,washerRuntimeMode,type WasherRuntimeSnapshot} from '../washer-runtime';
import {reservationPicker} from './reservation-picker';

export type WasherView='home'|'more'|'program'|'runtime';
interface Props {
 device:Device;panel:DevicePanel;report?:WasherConfigReport;programs:WasherProgram[];draft?:WasherDraft;view:WasherView;loading:boolean;
 back:()=>void;home:()=>void;more:()=>void;select:(program:WasherProgram)=>void;change:(draft:WasherDraft)=>void;refresh:()=>void;
 commands:WasherCommands;reservationOpen?:boolean;order?:()=>void;reserve?:(at:number)=>void;cancelOrder?:()=>void;start:()=>void;confirm:()=>void;
 artwork?:()=>HTMLElement;runtime?:WasherRuntimeSnapshot;runtimeReadAt?:number;openRuntime?:()=>void;powerControl?:HTMLElement;
 modeOnly?:boolean;modeSetting?:{selected:boolean;disabled:boolean;apply:()=>void};
 drums?:{siid:number;label:string;status?:string;selected:boolean;select:()=>void}[];
}
/** Original standard-plugin static SVG assets, selected by verified program semantics. */
export function washerGlyph(name:string):HTMLElement {
 const span=element('span','washer-glyph');
 const names:Record<string,string>={smart:'WashLingYunSmartWash',quickWash:'WashQuick',dry:'WashDry',dryAirWash:'WashAir',followHeartWashDry:'PleasedWashDry',more:'WashMore',mix:'WashMix',spin:'WashSpin',delicateWash:'WashDelicate',heavyWash:'WashHeavy',rinseSpin:'WashRinseSpin',underwear:'WashUnderwear',wool:'WashWool',babyCare:'WashBaby',cotton:'WashCotton',degermingDry:'WashFungicidalMites',newClothesWash:'WashNewClothes',boiling:'WashHighTemperature',jacket:'WashJacket',jeans:'WashJeans',synthetic:'WashSynthetic',silk:'WashSilk',aromatherapyWash:'WashAromatherapy',drumClean:'WashDrumClean',intensive:'WashIntensive'};
 span.append(officialIcon('std:'+(names[name]??'WashMore')));
 return span;
}
export function washerStatusCard(title:string,description:string,state:string,open?:()=>void):HTMLElement{
 const card=open?button('','washer-home-status',open):element('div','washer-home-status');
 if(open)card.dataset.focusKey='washer-runtime-entry';
 const glyph=state==='paused'?'WashStatusCardPause':state==='completed'?'WashCompleted':state==='delay'?'WashDelayTimeBlue':'WashStatusCardDoing';
 card.append(element('span','washer-home-status-icon',officialIcon('std:'+glyph)),
  element('span','washer-home-status-copy',element('strong','',title),description?element('span','',description):null));
 if(open)card.append(icon('chevron'));
 return card;
}
interface WasherProgramTile {name:string;title:string;glyph:string;select:()=>void;disabled:boolean}
function washerProgramTile(tile:WasherProgramTile,list=false):HTMLButtonElement{
 const item=button('',list?'washer-more-row':'washer-program',tile.select);item.disabled=tile.disabled;item.dataset.program=tile.name;
 item.append(washerGlyph(tile.glyph),element('span','',tile.title));if(list)item.append(icon('chevron'));
 return item;
}
export function washerProgramGrid(tiles:WasherProgramTile[],more:()=>void,locked:boolean):HTMLElement{
 const grid=element('section','native-card washer-program-grid'),hasMore=tiles.length>6;
 for(const tile of hasMore?tiles.slice(0,5):tiles)grid.append(washerProgramTile(tile));
 if(hasMore){
  const item=washerProgramTile({name:'more',title:'更多',glyph:'more',select:more,disabled:locked});
  delete item.dataset.program;item.dataset.focusKey='washer-more-entry';grid.append(item);
 }
 return grid;
}
export function washerProgramList(tiles:WasherProgramTile[]):HTMLElement{
 return element('div','washer-more-list',...tiles.map(tile=>washerProgramTile(tile,true)));
}
export function washerHomeHero():HTMLElement{
 return element('div','washer-home-hero',element('i','washer-bubble bubble-one'),element('i','washer-bubble bubble-two'),element('i','washer-bubble bubble-three'));
}

export function washerParameterRow({id,label,value,disabled,chevron=true,press}:{
 id:string;label:string;value?:string|boolean;disabled:boolean;chevron?:boolean;press:()=>void;
}):HTMLButtonElement {
 const row=button('','washer-parameter',()=>{if(!row.disabled)press();});
 row.disabled=disabled;
 row.dataset.parameter=id;
 row.append(element('span','',label));
 if(typeof value==='boolean'){
  row.setAttribute('role','switch');row.setAttribute('aria-checked',String(value));row.setAttribute('aria-label',label);
  row.append(element('span','washer-parameter-toggle'));
 }else{
  if(value!==undefined)row.append(element('span','washer-parameter-value',value));
  if(chevron)row.append(icon('chevron'));
 }
 return row;
}
export function washerParameterChoices<T extends Json>(label:string,options:readonly {value:T;label:string}[],current:T,
 choose:(value:T)=>void,cancel:()=>void):HTMLElement {
 const dialog=element('section','washer-choice-dialog',element('h3','',label));
 dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',label);
 for(const option of options){
  const choice=button(option.label,`washer-choice${option.value===current?' selected':''}`,()=>choose(option.value));
  choice.dataset.value=String(option.value);
  dialog.append(choice);
 }
 dialog.append(button('取消','washer-choice-cancel',cancel));
 const backdrop=element('div','washer-choice-backdrop',dialog);
 dismissOnBackdrop(backdrop,cancel);
 return backdrop;
}
export function washerPage(props:Props):HTMLElement {
 const dryer=isDryerPanel(props.panel);
 const selected=props.programs.find(p=>p.name===props.draft?.program);
 const stage=element('div','device-stage'),page=element('section',`device-page page-washer${props.view==='home'?'':' washer-subpage'}${props.view==='program'?' washer-program-page':''}`);
 page.dataset.washerCommandState=props.commands.pending?'sending':props.commands.loading?'loading':props.commands.requestId?'uncertain':props.commands.preview?.canStart?'ready':'unavailable';
 if(dryer)page.dataset.presentationTemplate='dryer';
 const back=button('','page-icon-button',props.view==='home'?props.back:props.home,'back');back.setAttribute('aria-label',props.view==='home'?'返回家庭':dryer?'返回干衣机':'返回洗衣机');
 const title=props.view==='program'?selected?.title??(dryer?'烘干程序':'洗涤程序'):props.view==='more'?'更多':props.device.name;
 const zone=props.view!=='home'?props.drums?.find(d=>d.selected)?.label:undefined;
 page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',title),zone?element('p','',zone):null)));
 const scroll=element('div',props.view==='program'?'device-page-scroll washer-program-scroll':'device-page-scroll');
 const runtime=props.runtime?.active?props.runtime:undefined;
 const locked=washerProgramsLocked(props.runtime)||!props.device.online||!!props.device.sharedReadOnly||!!props.drums&&(!props.runtime||props.runtime.state==='unknown');
 const programTiles=props.programs.map(program=>({name:program.name,title:program.title,glyph:program.published?.glyph??program.name,
  select:()=>props.select(program),disabled:locked}));
 if(props.view==='home'){
  const hero=washerHomeHero(),content=element('div','washer-home-content',hero);
  const controls=props.programs.length||props.powerControl?element('div','washer-home-controls'):content;
  if(props.powerControl)controls.append(props.powerControl);
  if(props.drums){
   hero.classList.add('washer-drums-hero');
   if(props.artwork)hero.append(element('div','washer-drums-art',props.artwork()));
   controls.append(deviceChannelPicker('washer',props.drums.map(drum=>({...drum,id:drum.siid}))));
  }
  if(runtime){
   page.dataset.washerRunning='true';
   const mode=washerRuntimeMode(runtime,props.programs);
   const finish=washerRuntimeFinish(runtime,props.runtimeReadAt);
   const time=finish?`预计${finish}完成`:['busy','paused'].includes(runtime.state)&&!runtime.weighing&&runtime.remainingMinutes!==null?`剩余${runtime.remainingMinutes}分钟`:undefined;
   const description=[mode,time].filter(Boolean).join(' | ');
   controls.append(washerStatusCard(washerHomeStatus(runtime),description,runtime.state,props.openRuntime));
  }
  if(programTiles.length)controls.append(washerProgramGrid(programTiles,props.more,locked));
  else if(props.loading&&!runtime&&!props.powerControl)content.append(deviceWait(props.artwork,props.device.name));
  if(controls!==content)content.append(controls);
  scroll.append(content);
 }else if(props.view==='more'){
  scroll.append(washerProgramList(programTiles));
 }else if(selected&&props.draft){
  const draft=props.draft,fields=props.modeOnly?[]:washerFields(props.report,selected,props.panel,draft);
  const duration=washerMinutes(selected,fields);
  const hero=element('div','washer-program-hero',washerGlyph(selected.published?.glyph??selected.name));
  if(selected.autoTime||duration>0)hero.append(element('div','washer-program-time',selected.autoTime?'自动称重':`${duration} 分钟`));
  if(selected.autoTime)hero.append(element('p','','洗涤时间需根据衣物重量自动计算'));
  const rows=element('section','native-card washer-parameters');
  for(const field of fields.filter(f=>!f.hidden)){
   const toggle=typeof field.value==='boolean';
   rows.append(washerParameterRow({
    id:field.name,label:field.label,value:typeof field.value==='boolean'?field.value:washerFieldText(field),
    disabled:locked||field.disabled||props.commands.locked,chevron:!field.disabled,
    press:()=>props.change(toggle?{...draft,selector:undefined,values:{...draft.values,[field.name]:!field.value}}:{...draft,selector:field.name}),
   }));
  }
  scroll.append(hero);
  if(rows.childElementCount)scroll.append(rows);
  const footer=element('footer','washer-program-footer');
  const needsRead=!!props.commands.requestId;
  const canStart=!locked&&props.commands.canStart;
  const estimate=props.commands.preview?.estimatedMinutes??duration,lead=estimate+6;
  const order=button('预约','washer-program-command washer-program-order',()=>props.order?.());
  order.dataset.focusKey='washer-program-order';
  order.disabled=!props.order||!selected.isOrder||!canStart||lead>=1440||dryer&&estimate<=0;
  const start=button(needsRead?'刷新状态':'开始','washer-program-command washer-program-start',needsRead?props.confirm:props.start);
  start.disabled=needsRead?props.commands.pending:!canStart;
  if(!props.modeOnly){
   start.setAttribute('aria-busy',String(props.commands.pending));footer.append(order,start);page.append(footer);
  }else if(props.modeSetting){
   const mode=props.modeSetting;
   const apply=button(mode.selected?'当前模式':'应用模式','washer-program-command washer-program-start',mode.apply);
   apply.dataset.focusKey='washer-program-mode';
   apply.disabled=locked||mode.disabled||mode.selected;
   footer.append(apply);page.append(footer);
  }
  if(props.reservationOpen&&props.reserve&&props.cancelOrder){
   const now=Date.now()/1000;
   page.append(reservationPicker({
    durationMinutes:estimate>0?estimate:undefined,earliestAt:now+lead*60,blocked:order.disabled,close:props.cancelOrder,
    problem:at=>at>Date.now()/1000+86400?'预约时间不能超过24小时。':at<Date.now()/1000+lead*60?`完成时间须预留完整${dryer?'烘干':'洗涤'}时长。`:undefined,
    submit:at=>props.reserve?.(at*1000),
   }));
  }
  const field=fields.find(f=>f.name===draft.selector);
  if(field&&!locked&&!props.commands.locked){
   page.append(washerParameterChoices(field.label,field.choices.map(value=>({value,label:washerFieldText(field,value)})),field.value,
    value=>props.change({...draft,selector:undefined,values:{...draft.values,[field.name]:value}}),
    ()=>props.change({...draft,selector:undefined})));
  }
 }
 page.insertBefore(scroll,page.querySelector('footer'));stage.append(page);return deviceSurfaces(stage);
}
