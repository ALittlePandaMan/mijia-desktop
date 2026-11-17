import {describeOperation} from './operation-feedback';
import {deviceSurfaces} from './device-surfaces';
import type { Device, DevicePanel } from '../types';
import { button, element } from './dom';
import { icon,officialIcon } from '../icons';
import { washerFields, washerFieldText, washerMinutes, type WasherConfigReport, type WasherDraft, type WasherProgram } from '../washer';
import type {WasherCommands} from '../washer-commands';
import {deviceWait} from './device-loading';

export type WasherView='home'|'more'|'program'|'records'|'runtime';
interface Props {
 device:Device;panel:DevicePanel;report?:WasherConfigReport;programs:WasherProgram[];draft?:WasherDraft;view:WasherView;loading:boolean;error?:string;
 back:()=>void;home:()=>void;more:()=>void;records?:(()=>void);select:(program:WasherProgram)=>void;change:(draft:WasherDraft)=>void;refresh:()=>void;
 commands:WasherCommands;orderAt?:number;order:()=>void;changeOrder:(at:number)=>void;cancelOrder:()=>void;start:()=>void;confirm:()=>void;
 artwork?:()=>HTMLElement;
}
/** Original standard-plugin static SVG assets, selected by verified program semantics. */
export function washerGlyph(name:string):HTMLElement {
 const span=element('span','washer-glyph');
 const names:Record<string,string>={smart:'WashLingYunSmartWash',quickWash:'WashQuick',dry:'WashDry',dryAirWash:'WashAir',followHeartWashDry:'PleasedWashDry',more:'WashMore',mix:'WashMix',spin:'WashSpin',delicateWash:'WashDelicate',heavyWash:'WashHeavy',rinseSpin:'WashRinseSpin',underwear:'WashUnderwear',wool:'WashWool',babyCare:'WashBaby',cotton:'WashCotton',degermingDry:'WashFungicidalMites',newClothesWash:'WashNewClothes',boiling:'WashHighTemperature',jacket:'WashJacket',jeans:'WashJeans',synthetic:'WashSynthetic',silk:'WashSilk',aromatherapyWash:'WashAromatherapy',drumClean:'WashDrumClean',intensive:'WashIntensive'};
 span.append(officialIcon('std:'+(names[name]??'WashMore')));
 return span;
}
export function washerPage(props:Props):HTMLElement {
 const selected=props.programs.find(p=>p.name===props.draft?.program);
 const stage=element('div','device-stage'),page=element('section',`device-page page-washer${props.view==='home'?'':' washer-subpage'}`);
 page.dataset.washerCommandState=props.commands.pending?'sending':props.commands.loading?'loading':props.commands.requestId?'uncertain':props.commands.preview?.canStart?'ready':'unavailable';
 const back=button('','page-icon-button',props.view==='home'?props.back:props.home,'back');back.setAttribute('aria-label',props.view==='home'?'返回家庭':'返回洗衣机');
 const title=props.view==='program'?selected?.title??'洗涤程序':props.view==='more'?'更多程序':props.device.name;
 page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',title))));
 const scroll=element('div','device-page-scroll');
 if(props.view==='home'){
  const content=element('div','washer-home-content'),hero=element('div','washer-home-hero');
  hero.append(element('i','washer-bubble bubble-one'),element('i','washer-bubble bubble-two'),element('i','washer-bubble bubble-three'));content.append(hero);
  const grid=element('section','native-card washer-program-grid');
  const programs=props.programs.length>6?props.programs.slice(0,5):props.programs;
  for(const program of programs){const item=button('','washer-program',()=>props.select(program));item.append(washerGlyph(program.name),element('span','',program.title));item.dataset.program=program.name;grid.append(item);}
  if(props.programs.length>6){const more=button('','washer-program',props.more);more.append(washerGlyph('more'),element('span','','更多'));grid.append(more);}
  if(!props.programs.length){if(props.loading)grid.append(deviceWait(props.artwork,props.device.name));else grid.append(element('p','washer-config-empty',props.error??'程序配置暂不可用'));}
  content.append(grid);
  if(props.records){
   const item=button('','native-card washer-feature',props.records);item.append(element('span','washer-feature-icon',icon('device')),element('span','','洗衣记录'),icon('chevron'));content.append(item);
  }
  scroll.append(content);
 }else if(props.view==='more'){
  const list=element('div','washer-more-list');
  for(const p of props.programs){const item=button('','washer-more-row',()=>props.select(p));item.append(washerGlyph(p.name),element('span','',p.title),icon('chevron'));item.dataset.program=p.name;list.append(item);}scroll.append(list);
 }else if(selected&&props.draft&&props.report){
  const draft=props.draft,fields=washerFields(props.report,selected,props.panel,draft);
  const hero=element('div','washer-program-hero',washerGlyph(selected.name));
  hero.append(element('div','washer-program-time',selected.autoTime?'自动称重':`${washerMinutes(selected,fields)} 分钟`));
  if(selected.autoTime)hero.append(element('p','','洗涤时间需根据衣物重量自动计算'));
  const rows=element('section','native-card washer-parameters');
  for(const field of fields.filter(f=>!f.hidden)){
   const toggle=typeof field.value==='boolean';
   const row=button('','washer-parameter',()=>props.change(toggle?{...draft,selector:undefined,values:{...draft.values,[field.name]:!field.value}}:{...draft,selector:field.name}));row.disabled=field.disabled||props.commands.locked;row.dataset.parameter=field.name;
   row.append(element('span','',field.label));
   if(toggle){row.setAttribute('role','switch');row.setAttribute('aria-checked',String(field.value));row.setAttribute('aria-label',field.label);row.append(element('span','washer-parameter-toggle'));}
   else row.append(element('span','washer-parameter-value',washerFieldText(field)),icon('chevron'));
   rows.append(row);
  }
  scroll.append(hero,rows);
  const footer=element('footer','washer-program-footer');
  const command=button('开始','washer-program-command',props.start);command.disabled=!props.commands.canStart;command.setAttribute('aria-busy',String(props.commands.pending));command.setAttribute('aria-description',props.commands.error??props.commands.preview?.reason??(props.commands.loading?'正在读取实时状态。':''));footer.append(command);page.append(footer);
  const message=props.commands.error??props.commands.result?.message;
  describeOperation(page,message);
  const field=fields.find(f=>f.name===draft.selector);
  if(field&&!props.commands.locked){
   const backdrop=element('div','washer-choice-backdrop'),dialog=element('section','washer-choice-dialog',element('h3','',field.label));dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',field.label);
   for(const value of field.choices){const choice=button(washerFieldText(field,value),`washer-choice${value===field.value?' selected':''}`,()=>props.change({...draft,selector:undefined,values:{...draft.values,[field.name]:value}}));choice.dataset.value=String(value);dialog.append(choice);}
   dialog.append(button('取消','washer-choice-cancel',()=>props.change({...draft,selector:undefined})));backdrop.append(dialog);backdrop.addEventListener('click',event=>{if(event.target===backdrop)props.change({...draft,selector:undefined});});page.append(backdrop);
  }
 }
 page.insertBefore(scroll,page.querySelector('footer'));stage.append(page);return deviceSurfaces(stage);
}
