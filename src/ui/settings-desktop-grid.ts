import {desktopWidgets,type DesktopGridSettings,type DesktopGridPreset,type DesktopDisplayPatch,type DesktopPadding} from '../desktop-widgets';
import {icon} from '../icons';
import {element,button} from './dom';
import {settingsContentIcon,settingsCopy,settingsSymbol} from './settings-content';
import './settings-desktop-grid.css';

interface DesktopSelection{selectedDesktopDisplayId?:string}
const presets=[{value:'6x4',label:'6 × 4',columns:6,rows:4},{value:'8x6',label:'8 × 6',columns:8,rows:6}]as const;
const edges=[['top','上'],['right','右'],['bottom','下'],['left','左']]as const;
function gridThumbnail(preset:DesktopGridPreset,className:string):HTMLElement{
 const {columns,rows}=presets.find(p=>p.value===preset)!;
 const grid=element('span',className);grid.setAttribute('aria-hidden','true');grid.style.setProperty('--grid-columns',String(columns));grid.style.setProperty('--grid-rows',String(rows));
 for(let i=0;i<columns*rows;i++)grid.append(element('span','settings-desktop-cell'));
 return grid;
}

/** Selection and unsubmitted values stay in the settings view, never the layout file. */
export function desktopGridSettings(drafts=new Map<string,DesktopPadding>(),selection:DesktopSelection={}):HTMLElement{
 const root=element('div','settings-desktop-layout',element('div','settings-card',element('p','settings-empty','正在读取显示器')));
 root.dataset.loading='true';
 let settings:DesktopGridSettings,pending=false,saveFocus:string|undefined;
 const errors=new Map<string,string>(),rawDrafts=new Map<string,Record<string,string>>();
 const render=()=>{
  const active=document.activeElement instanceof HTMLElement&&root.contains(document.activeElement)?document.activeElement:undefined,focusKey=active?.dataset.focusKey??saveFocus;saveFocus=undefined;
  root.replaceChildren();
  if(!settings.supported){root.append(element('div','settings-card',element('p','settings-empty','当前系统暂不支持桌面卡片')));return;}
  if(!settings.displays.length){root.append(element('div','settings-card',element('p','settings-empty','未检测到可用显示器')));return;}
  const displays=settings.displays.map((display,index)=>({display,number:index+1})).sort((a,b)=>Number(!!b.display.primary)-Number(!!a.display.primary));
  const screen=settings.displays.find(s=>s.id===selection.selectedDesktopDisplayId)??displays[0].display;selection.selectedDesktopDisplayId=screen.id;
  const selectors=element('div','settings-desktop-displays');selectors.setAttribute('role','group');selectors.setAttribute('aria-label','选择显示器');
  for(const {display,number}of displays){
   const selected=display.id===screen.id,choose=button('','settings-desktop-display',()=>{selection.selectedDesktopDisplayId=display.id;render();});
   choose.dataset.focusKey=`desktop-display-${display.id}`;choose.setAttribute('aria-pressed',String(selected));choose.setAttribute('aria-label',`编辑${display.name}`);
   const symbol=settingsSymbol('device');symbol.append(element('span','settings-desktop-display-number',String(number)));
   choose.append(symbol,settingsCopy(display.name,`${display.width} × ${display.height} · 缩放 ${Math.round(display.scale*100)}%`));
   if(selected)choose.append(icon('check','settings-desktop-selected'));
   else{const state=element('span','settings-desktop-display-state',display.enabled?'已开启':'已关闭');state.dataset.enabled=String(display.enabled);choose.append(state);}
   selectors.append(choose);
  }
  const section=element('section','settings-card settings-desktop-screen');section.setAttribute('aria-label',`${screen.name}布局`);section.setAttribute('aria-busy',String(pending));
  const save=(preset?:DesktopGridPreset,patch?:DesktopDisplayPatch)=>{
   if(pending)return;pending=true;errors.delete(screen.id);saveFocus=(document.activeElement as HTMLElement|null)?.dataset.focusKey;
   for(const control of section.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button'))control.disabled=true;
   section.setAttribute('aria-busy','true');
   void desktopWidgets.grids(screen.id,preset,patch).then(next=>{
    if(patch?.padding){drafts.delete(screen.id);rawDrafts.delete(screen.id);}settings=next;
   }).catch(e=>{errors.set(screen.id,(e as {message?:string})?.message??'桌面卡片设置未能保存');}).finally(()=>{pending=false;render();});
  };
  const toggle=button('',`settings-toggle${screen.enabled?' checked':''}`,()=>save(undefined,{enabled:!screen.enabled}));
  toggle.setAttribute('role','switch');toggle.setAttribute('aria-checked',String(screen.enabled));toggle.setAttribute('aria-label',`${screen.name}桌面卡片`);toggle.dataset.focusKey=`desktop-enabled-${screen.id}`;toggle.disabled=pending;
  section.append(element('header','settings-desktop-enable',settingsSymbol('grid'),settingsCopy('在此屏幕显示桌面卡片','关闭后保留卡片与位置，下次开启时继续使用。'),toggle));
  const preview=element('div','settings-desktop-preview'),work=element('div','settings-desktop-preview-work',gridThumbnail(screen.preset,'settings-desktop-preview-grid'));
  preview.style.aspectRatio=`${screen.width} / ${screen.height}`;preview.style.maxWidth=`${298*screen.width/screen.height}px`;preview.append(work);preview.setAttribute('role','img');
  const measures=new Map<keyof DesktopPadding,{root:HTMLElement;label:HTMLElement}>();
  for(const [key]of edges){const label=element('span','settings-desktop-measure-label'),measure=element('span','settings-desktop-measure',element('span','settings-desktop-measure-line'),label);measure.dataset.edge=key;measure.setAttribute('aria-hidden','true');measure.hidden=true;measures.set(key,{root:measure,label});preview.append(measure);}
  const previewArea=element('div','settings-desktop-preview-area',element('h3','settings-desktop-label','布局预览'),element('div','settings-desktop-diagram',preview));
  const choices=element('div','settings-desktop-presets');choices.setAttribute('role','group');choices.setAttribute('aria-label',`${screen.name}桌面栅格`);
  for(const preset of presets){
   const selected=screen.preset===preset.value,available=screen.available.includes(preset.value),choose=button('','settings-desktop-preset',()=>{if(!selected)save(preset.value);});
   choose.disabled=pending||!available;choose.setAttribute('aria-pressed',String(selected));choose.setAttribute('aria-label',preset.label);choose.dataset.focusKey=`desktop-grid-${screen.id}-${preset.value}`;
   const heading=element('span','settings-desktop-preset-heading',element('span','',preset.label));if(selected)heading.append(icon('check'));
   choose.append(heading,gridThumbnail(preset.value,'settings-desktop-preset-grid'));if(!available)choose.title='当前屏幕的可用空间不足以使用此栅格。';choices.append(choose);
  }
  const gridSettings=element('div','settings-desktop-form-group',element('h3','settings-desktop-label','卡片栅格'),choices);
  const padding=element('div','settings-desktop-padding'),fields=new Map<keyof DesktopPadding,HTMLInputElement>(),values=drafts.get(screen.id)??screen.padding;
  const updatePreview=()=>{
   const value=Object.fromEntries([...fields].map(([key,input])=>[key,input.valueAsNumber]))as unknown as DesktopPadding;
   const valid=[...fields.values()].every(input=>input.validity.valid),width=screen.width/screen.scale,height=screen.height/screen.scale;
   const shown=valid&&value.left+value.right<width&&value.top+value.bottom<height?value:screen.padding;
   // Percentages refer to the screen box, not CSS padding's inline-size basis.
   for(const [key]of edges){const inset=`${shown[key]/(key==='top'||key==='bottom'?height:width)*100}%`;work.style.setProperty(key,inset);preview.style.setProperty(`--desktop-padding-${key}`,inset);const measure=measures.get(key)!;measure.root.hidden=shown[key]<=0;measure.label.textContent=`${shown[key]} px`;}
   preview.setAttribute('aria-label',`${screen.name}布局示意，${presets.find(p=>p.value===screen.preset)!.label}，上 ${shown.top}、右 ${shown.right}、下 ${shown.bottom}、左 ${shown.left} 逻辑像素留白`);
  };
  for(const [key,label]of edges){
   const input=element('input','settings-number');input.type='number';input.required=true;input.min='0';input.step='1';input.defaultValue=String(screen.padding[key]);input.value=rawDrafts.get(screen.id)?.[key]??(Number.isFinite(values[key])?String(values[key]):'');input.disabled=pending;
   input.setAttribute('aria-label',`${screen.name}${label}留白`);input.dataset.focusKey=`desktop-padding-${screen.id}-${key}`;fields.set(key,input);
   input.addEventListener('input',()=>{drafts.set(screen.id,Object.fromEntries([...fields].map(([k,v])=>[k,v.valueAsNumber]))as unknown as DesktopPadding);rawDrafts.set(screen.id,Object.fromEntries([...fields].map(([k,v])=>[k,v.value])));updatePreview();});
   padding.append(element('label','settings-desktop-padding-field',element('span','',label),element('span','settings-desktop-padding-input',input,element('span','settings-desktop-unit','px'))));
  }
  updatePreview();
  const paddingSettings=element('div','settings-desktop-form-group',element('h3','settings-desktop-label','桌面留白'),padding);
  section.append(element('div','settings-desktop-editor',previewArea,element('div','settings-desktop-form',gridSettings,paddingSettings)));
  const reset=button('重置留白','settings-action',()=>save(undefined,{padding:{top:0,right:0,bottom:0,left:0}}));reset.prepend(settingsContentIcon('reset'));reset.dataset.focusKey=`desktop-reset-${screen.id}`;reset.disabled=pending;
  const apply=button('应用留白','settings-action settings-desktop-apply',()=>{for(const input of fields.values())if(!input.reportValidity())return;save(undefined,{padding:Object.fromEntries([...fields].map(([key,input])=>[key,input.valueAsNumber]))as unknown as DesktopPadding});});apply.prepend(icon('check'));apply.dataset.focusKey=`desktop-apply-${screen.id}`;apply.disabled=pending;
  if(errors.has(screen.id)){const error=element('p','settings-error',errors.get(screen.id));error.setAttribute('role','alert');section.append(error);}
  section.append(element('footer','settings-desktop-actions',reset,apply));root.append(selectors,section);
  if(focusKey)root.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({preventScroll:true});
 };
 void desktopWidgets.grids().then(next=>{settings=next;render();}).catch(e=>{root.replaceChildren(element('p','settings-error',(e as {message?:string})?.message??'显示器设置暂不可用'));}).finally(()=>{root.dataset.loading='false';root.dispatchEvent(new Event('desktop-settings-ready'));});
 return root;
}
