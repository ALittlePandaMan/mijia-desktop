import {dismissOnBackdrop} from './dialog-dismiss';
import {describeOperation} from './operation-feedback';
import {deviceSurfaces} from './device-surfaces';
import type {Device,DevicePanel,Json,Property} from '../types';
import {cupLabel,type PurifierView} from '../purifier';
import {purifierSetting,purifierSettingReason,purifierModes,type PurifierSetting} from '../purifier-settings';
import {element,button} from './dom';
import {icon} from '../icons';
import type {PurifierOptions} from '../purifier-options';
interface Props{device:Device;panel:DevicePanel;view:PurifierView;cached:boolean;busy:boolean;back:()=>void;open:(page:'pipeline'|'water-mode'|'compatibility'|'dnd'|'guide')=>void;changed:()=>void;write:(property:Property,value:Json)=>void;refresh:()=>void;error?:string;dnd?:{enabled:boolean|null;visible:boolean};options?:PurifierOptions;push?:(enabled:boolean)=>void}
export function purifierSettingsPage(p:Props):HTMLElement{
 const stage=element('div','device-stage'),page=element('section','device-page page-purifier-settings'),header=element('header','device-page-header'),back=button('','page-icon-button',p.back,'back');back.setAttribute('aria-label','返回净水器');header.append(back);page.append(header);stage.append(page);page.dataset.purifierSettingView=p.view.page;
 const body=element('div','device-page-scroll purifier-settings-content'),title=p.view.page==='pipeline'?'管线机对接':p.view.page==='water-mode'?'无陈水设置':'设置';body.append(element('h1','purifier-settings-title',title));page.append(body);
 if(p.error){const message=element('p','purifier-error',p.error);message.setAttribute('role','alert');body.append(message);}
 const prop=(key:PurifierSetting)=>purifierSetting(p.panel,key),reason=(key:PurifierSetting)=>purifierSettingReason(p.panel,p.device,key,p.cached,p.busy);
 const submit=(key:PurifierSetting,value:Json)=>{const property=prop(key);if(property&&!reason(key)&&property.value!==value)p.write(property,value);};
 if(p.view.page==='functions'){
  const rows=element('section','purifier-settings-list');body.append(element('p','purifier-settings-section-label','功能设置'));
  const row=(label:string,value:string,run:()=>void,key?:PurifierSetting)=>{const b=button('','purifier-settings-row',run);b.append(element('strong','',label),element('span','',value),icon('chevron'));const why=key?reason(key):undefined;b.disabled=!!why;if(why)b.setAttribute('aria-description',why);rows.append(b);};
  const cups=p.panel.purifier?.cups??[],selected=prop('default-cup')?.value,mode=purifierModes.find(m=>m.value===prop('water-mode')?.value);
  row('默认杯量设置',selected===0?'记忆上次':cups.find(c=>c.id===selected)?cupLabel(cups.find(c=>c.id===selected)!.volumeMl):'--',()=>{p.view.settingDialog={kind:'cup',selected:typeof selected==='number'?selected:0};p.changed();},'default-cup');
  row('管线机对接',prop('pipeline')?.value===true?'已开启':prop('pipeline')?.value===false?'已关闭':'--',()=>p.open('pipeline'),'pipeline');
  row('滤芯安装指导','',()=>p.open('guide'));
  if(p.options?.report?.filterFlushingSupported===true){
   const toggle=(label:string,description:string,value:boolean|null,run:()=>void,why?:string)=>{const b=button('','purifier-settings-toggle',run);b.dataset.focusKey=`purifier-options-${label}`;b.setAttribute('role','switch');b.setAttribute('aria-label',label);b.setAttribute('aria-checked',String(value===true));b.disabled=!!why||p.busy||p.cached||!p.device.online;b.append(element('div','',element('strong','',label),element('p','',description)),element('span',`purifier-settings-switch${value===true?' checked':''}`));if(why)b.setAttribute('aria-description',why);rows.append(b);};
   const value=prop('flushing')?.value;
   toggle('滤芯冲洗','开启后，长时间不使用净水机时将自动冲洗滤芯',typeof value==='boolean'?value:null,()=>submit('flushing',value!==true),reason('flushing'));
   if(value===true)toggle('冲洗完成提醒',`开启后，滤芯冲洗完成后将推送消息${p.options.report.pushSource==='vendorDefault'?p.options.report.pushEnabled?'（默认开启）':'（默认关闭）':p.options.report.pushSource==='unknown'?'（状态未确认）':''}`,p.options.report.pushEnabled,()=>p.push?.(p.options!.report!.pushEnabled!==true),p.options.canSetPush?undefined:p.options.message||p.options.error?.message||p.options.report.pushReason||'请先读取当前提醒设置。');
  }
  row('无陈水设置',mode?.title??'--',()=>p.open('water-mode'),'water-mode');
  if(p.dnd?.visible)row('勿扰模式',p.dnd.enabled===true?'已开启':p.dnd.enabled===false?'已关闭':'--',()=>p.open('dnd'));
  body.append(rows);describeOperation(page,p.options?.message);const info=p.options?.report?.supportReason;if(info)body.append(element('p','purifier-settings-help',info));
 }else if(p.view.page==='water-mode'){
  const hero=element('div','purifier-mode-intro');hero.innerHTML='<svg viewBox="0 0 360 360" aria-hidden="true"><g fill="#8adff3"><circle cx="216" cy="64" r="52"/><circle cx="98" cy="125" r="38"/><circle cx="164" cy="207" r="30"/><circle cx="262" cy="230" r="22"/><circle cx="120" cy="298" r="15"/></g></svg>';
  hero.append(element('p','','无陈水模式通过用直饮水浸泡、冲洗滤芯，可以延长滤芯寿命、降低初始出水TDS。'));body.append(hero);
  const choices=element('div','purifier-mode-choices');choices.setAttribute('role','radiogroup');choices.setAttribute('aria-label','无陈水模式');
  for(const mode of purifierModes){const selected=prop('water-mode')?.value===mode.value,b=button('','native-card purifier-mode-choice',()=>submit('water-mode',mode.value));b.setAttribute('role','radio');b.setAttribute('aria-checked',String(selected));b.dataset.focusKey=`purifier-mode-${mode.value}`;b.classList.toggle('selected',selected);b.append(element('span','purifier-mode-check',selected?icon('check'):undefined),element('div','',element('strong','',mode.title),element('p','',mode.description)));b.disabled=!!reason('water-mode');choices.append(b);}body.append(choices);if(reason('water-mode'))body.append(element('p','purifier-settings-help',reason('water-mode')));
 }else if(p.view.page==='pipeline'){
  const drawing=element('div','purifier-pipeline-drawing');drawing.innerHTML='<svg viewBox="0 0 500 434" role="img" aria-label="净水器与管线机连接示意图"><g fill="none" stroke="#999" stroke-width="1.6"><rect x="94" y="60" width="92" height="274" rx="28"/><path d="M125 80v23m16-23v23m16-23v23m-54 226-4 6h82l-4-6"/><rect x="284" y="96" width="123" height="202" rx="3"/><circle cx="345" cy="147" r="29"/><path d="M340 176v6h10v-6m-25 44h40l-4 62h-32Zm0 16q10-4 20 0t19 0m-57 62v-12h76v12M186 305h35q13 0 13-13V151q0-12 12-12h38"/><path d="m202 300 9 5-9 5m37-92-5-9-5 9m34-84 9 5-9 5"/></g><text x="345" y="155" text-anchor="middle" font-size="22" fill="#999">99<tspan font-size="10">℃</tspan></text></svg>';
  body.append(drawing,element('p','purifier-settings-help','管线机是净水器的搭档，可以起到加热的效果。'));
  const value=prop('pipeline')?.value,b=button('','purifier-pipeline-control',()=>{if(reason('pipeline'))return;if(value===false){p.view.settingDialog={kind:'pipeline'};p.changed();}else submit('pipeline',false);});b.dataset.focusKey='purifier-pipeline-switch';b.setAttribute('role','switch');b.setAttribute('aria-checked',String(value===true));b.setAttribute('aria-label','管线机对接');b.disabled=!!reason('pipeline');b.append(element('span','purifier-filter-icon',icon('droplet')),element('div','',element('strong','','管线机对接'),element('p','',value===true?'已开启':value===false?'已关闭':'--')),element('span',`purifier-settings-switch${value===true?' checked':''}`));body.append(b);if(reason('pipeline'))body.append(element('p','purifier-settings-help',reason('pipeline')));
 }
 if(p.view.settingDialog){const current=p.view.settingDialog,overlay=element('div','purifier-modal-backdrop'),dialog=element('section','purifier-confirm purifier-setting-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',current.kind==='pipeline'?'确认启用管线机':'默认杯量设置');
  const close=()=>{p.view.settingDialog=undefined;p.changed();};
  if(current.kind==='pipeline'){dialog.append(element('h2','','确认启用管线机？'),element('p','','1、按管线机操作连接净水器；\n2、未连接管线机，打开此开关，会破坏净水器；'));}
  else{dialog.append(element('h2','','默认杯量设置'));const options=[{id:0,title:'记忆上次'},...(p.panel.purifier?.cups??[]).map(c=>({id:c.id,title:cupLabel(c.volumeMl)}))];for(const option of options){const b=button(option.title,'purifier-default-cup-choice',()=>{current.selected=option.id;p.changed();});b.setAttribute('role','radio');b.setAttribute('aria-checked',String(current.selected===option.id));if(current.selected===option.id)b.append(icon('check'));dialog.append(b);}}
  const confirm=button('确定','',()=>{const target=p.view.settingDialog;p.view.settingDialog=undefined;if(target?.kind==='pipeline')submit('pipeline',true);else if(target?.kind==='cup')submit('default-cup',target.selected);p.changed();});confirm.disabled=!!reason(current.kind==='pipeline'?'pipeline':'default-cup');dialog.append(element('footer','',button('取消','',close),confirm));dismissOnBackdrop(overlay,close);overlay.append(dialog);page.append(overlay);
  dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close();}if(e.key==='Tab'){const b=[...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];if(e.shiftKey&&(document.activeElement===b[0]||document.activeElement===dialog)){e.preventDefault();b.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===b.at(-1)){e.preventDefault();b[0]?.focus();}}});dialog.tabIndex=-1;queueMicrotask(()=>{if(dialog.isConnected)dialog.focus();});
 }
 return deviceSurfaces(stage);
}
