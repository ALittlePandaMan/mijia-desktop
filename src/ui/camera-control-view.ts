import {cameraOutlineIcon,type CameraOutlineIcon} from './camera-outline-icons';
import {cameraSoundIcon} from './camera-sound-icons';
import {button,element} from './dom';
import {icon,officialIcon,type IconName} from '../icons';
import {cameraQualityOptions,type CameraQualitySizes} from '../camera-quality';
import type {CameraFeatures} from '../camera-types';
import {monitorPresetGrid,monitorPresets,type MonitorPreset} from '../monitor-layout';
import type {MonitorHome} from '../types';
import {dropdownMenu,type DropdownOption} from './dropdown';
import {dismissOutsideMenu} from './dialog-dismiss';

const cameraGlyphs:Partial<Record<IconName,string>>={power:'power',microphone:'microphone',camera:'snapshot',video:'record',ptz:'ptz',volume:'sound','volume-off':'muted',fullscreen:'fullscreen',play:'playback'};
export function cameraIcon(glyph:IconName):SVGSVGElement {
 if(glyph==='power'||glyph==='fullscreen')return cameraOutlineIcon(glyph);
 return cameraGlyphs[glyph]?officialIcon('camera:'+cameraGlyphs[glyph]):icon(glyph);
}
export function cameraTool(label:string,glyph:IconName,run:()=>void):HTMLButtonElement {
 const control=button('','camera-icon-button',run);
 control.append(cameraIcon(glyph));
 control.setAttribute('aria-description',label);control.setAttribute('aria-label',label);
 return control;
}

/** Shared monitor chrome. Media/session operations are supplied by the caller. */
export function monitorTool(label:string,glyph:CameraOutlineIcon,run:()=>void):HTMLButtonElement {
 const control=button('','monitor-tile-button',run);
 control.append(glyph==='sound'||glyph==='muted'?cameraSoundIcon(glyph==='sound'):cameraOutlineIcon(glyph));
 control.setAttribute('aria-description',label);control.setAttribute('aria-label',label);return control;
}
function qualityButtons(options:ReturnType<typeof cameraQualityOptions>,selected:string,select:(id:string)=>void,detail:boolean) {
 return options.map(q=>{
  const choice=button('','',()=>{if(q.available)select(q.id);});
  choice.append(element('span','',q.label));choice.disabled=!q.available;
  const checked=String(q.available&&(q.id===selected||q.aliases.includes(selected)));
  choice.setAttribute('role',detail?'radio':'menuitemradio');choice.setAttribute('aria-checked',checked);
  choice.dataset.quality=q.id;choice.dataset.qualityMode=q.mode;
  if(detail){choice.setAttribute('aria-pressed',checked);choice.append(officialIcon('camera:selected'));}
  return choice;
 });
}
export function renderMonitorQuality(menu:HTMLElement,qualities:CameraFeatures['qualities'],selected:string,select:(id:string)=>void,sizes:CameraQualitySizes={}):void {
 const focused=focusedCameraQuality(menu),options=cameraQualityOptions(qualities,sizes);
 menu.replaceChildren(...qualityButtons(options,selected,select,false));
 restoreCameraQualityFocus(menu,options,focused);
}
export function renderCameraQualityDialog(host:HTMLElement,qualities:CameraFeatures['qualities'],selected:string,select:(id:string)=>void,sizes:CameraQualitySizes={}):void {
 const focused=focusedCameraQuality(host),options=cameraQualityOptions(qualities,sizes);
 const group=element('div','camera-quality-options',...qualityButtons(options,selected,select,true));
 group.setAttribute('role','radiogroup');
 const dialog=element('div','camera-quality-dialog',element('h3','','视频画质选择'),group);
 dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','视频画质选择');
 host.replaceChildren(dialog);
 restoreCameraQualityFocus(host,options,focused);
}
function focusedCameraQuality(menu:HTMLElement):string|undefined {
 const active=document.activeElement;
 return active instanceof HTMLElement&&menu.contains(active)?active.dataset.quality:undefined;
}
function restoreCameraQualityFocus(menu:HTMLElement,options:ReturnType<typeof cameraQualityOptions>,focused?:string):void {
 if(!focused)return;
 const id=options.find(q=>q.id===focused||q.aliases.includes(focused))?.id;
 const choices=[...menu.querySelectorAll<HTMLButtonElement>('[data-quality]:not(:disabled)')];
 (choices.find(choice=>choice.dataset.quality===id)??choices.find(choice=>choice.getAttribute('aria-checked')==='true')??choices[0])?.focus({preventScroll:true});
}
export function monitorGridView():HTMLDivElement {return element('div','monitor-grid');}

export function sizeMonitorGrid(wall:HTMLElement,grid:HTMLElement,preset:MonitorPreset,count:number):void {
 const {columns,rows}=monitorPresetGrid(preset);
 const bounds=wall.getBoundingClientRect(),horizontalGap=columns-1,verticalGap=rows-1;
 const tileWidth=Math.max(0,Math.min((bounds.width-horizontalGap)/columns,(bounds.height-verticalGap)/rows*16/9));
 const tileHeight=tileWidth*9/16;
 grid.style.width=`${tileWidth*columns+horizontalGap}px`;
 grid.style.height=`${tileHeight*rows+verticalGap}px`;
 grid.style.gridTemplateColumns=`repeat(${columns},${tileWidth}px)`;
 grid.style.gridTemplateRows=`repeat(${rows},${tileHeight}px)`;
 wall.dataset.columns=String(columns);wall.dataset.rows=String(rows);
 const required=Math.max(0,columns*rows-count),blanks=grid.querySelectorAll('.monitor-blank');
 for(const blank of [...blanks].slice(required))blank.remove();
 for(let i=blanks.length;i<required;i++){
  const blank=element('div','monitor-blank');
  blank.setAttribute('aria-hidden','true');
  grid.append(blank);
 }
}

export function monitorSplitMenu(current:MonitorPreset,max:MonitorPreset,blocked:(preset:MonitorPreset)=>boolean,
 choose:(preset:MonitorPreset)=>void,dismiss:()=>void):HTMLElement {
 const presets=monitorPresets.filter(value=>value<=max);
 const menu=dropdownMenu({label:'分屏',className:'monitor-split-menu',selection:true,
  items:presets.map(value=>({value:String(value),label:`${value} 路`,selected:value===current,disabled:blocked(value)})),
  choose:value=>{const preset=presets.find(p=>String(p)===value);if(preset!==undefined)choose(preset);},dismiss});
 const heading=element('div','monitor-split-heading','分屏');
 heading.setAttribute('aria-hidden','true');menu.prepend(heading);
 menu.addEventListener('focusin',event=>(event.target as HTMLElement).scrollIntoView({block:'nearest'}));
 return menu;
}

export function monitorHomePicker(){
 let options:DropdownOption[]=[];
 let choose:(id:string|null)=>void=()=>{};
 let popup:HTMLElement|undefined;
 let cleanup:(()=>void)|undefined;
 const label=element('span','monitor-home-label');
 const trigger=button('','desktop-monitor-action monitor-home-trigger',()=>{
  if(dismiss(true)||trigger.disabled||!options.length)return;
  popup=dropdownMenu({label:'切换家庭',className:'monitor-split-menu monitor-home-menu',selection:true,
   items:options,choose:id=>{
    dismiss(true);
    if(!trigger.disabled&&!options.some(option=>option.value===id&&option.selected))choose(id||null);
   },dismiss:()=>dismiss(true)});
  root.append(popup);
  trigger.setAttribute('aria-expanded','true');
  trigger.setAttribute('aria-controls',popup.id);
  cleanup=dismissOutsideMenu(trigger,popup,()=>dismiss());
  (popup.querySelector<HTMLButtonElement>('[aria-checked=true]')??popup.querySelector('button'))?.focus({preventScroll:true});
 });
 trigger.append(label,icon('chevron'));
 trigger.setAttribute('aria-label','切换家庭');
 trigger.setAttribute('aria-haspopup','menu');
 trigger.setAttribute('aria-expanded','false');
 const root=element('div','monitor-home-picker',trigger);
 root.hidden=true;
 function dismiss(restoreFocus=false):boolean{
  if(!popup)return false;
  cleanup?.();cleanup=undefined;
  popup.remove();popup=undefined;
  trigger.setAttribute('aria-expanded','false');
  trigger.removeAttribute('aria-controls');
  if(restoreFocus)trigger.focus({preventScroll:true});
  return true;
 }
 return {root,dismiss,setBlocked(blocked:boolean){
  trigger.disabled=blocked||options.length<2;
  if(trigger.disabled)dismiss();
 },update(homes:readonly MonitorHome[],current:string|null,allowAll:boolean,select:(homeId:string|null)=>void){
  choose=select;
  const choices=homes.map(home=>({value:home.id,label:home.name+(home.shared?' · 共享':''),selected:home.id===current}));
  if(allowAll)choices.unshift({value:'',label:'全部家庭',selected:current===null});
  if(choices.length===options.length&&choices.every((option,i)=>
   option.value===options[i].value&&option.label===options[i].label&&option.selected===options[i].selected))return;
  dismiss(!!popup?.contains(document.activeElement));
  options=choices;
  root.hidden=!options.length;
  label.textContent=options.find(option=>option.selected)?.label??'切换家庭';
 }};
}

export function monitorPager(move:(delta:number)=>void) {
 const previous=button('上一页','monitor-page-button',()=>move(-1));
 const next=button('下一页','monitor-page-button',()=>move(1));
 const label=element('span','monitor-page-number');
 label.setAttribute('aria-live','polite');
 const root=element('nav','monitor-pagination',previous,label,next);
 root.setAttribute('aria-label','监控分页');root.hidden=true;
 return {root,previous,next,update(page:number,count:number,busy=false,fullscreen=false) {
  const hidden=count<2||fullscreen;
  if(root.hidden!==hidden)root.hidden=hidden;
  if(hidden)return;
  const text=`${page+1} / ${count}`;
  if(label.textContent!==text)label.textContent=text;
  const first=busy||page===0,last=busy||page+1===count;
  if(previous.disabled!==first)previous.disabled=first;
  if(next.disabled!==last)next.disabled=last;
 }};
}

export function layoutCameraLenses(deck:HTMLElement,primary:HTMLElement,secondary:HTMLElement|undefined,options:{
 dual:boolean; pip:boolean; selected:number; secondaryId?:number; insetRatio?:string;
}):void {
 const {dual,pip,selected,secondaryId,insetRatio}=options;
 deck.dataset.dual=String(dual);deck.dataset.layout=pip?'pip':'stack';deck.dataset.primaryLens=String(selected);
 primary.dataset.primary=String(!dual||selected===0);
 if(secondary){secondary.hidden=!dual;secondary.dataset.primary=String(selected===secondaryId);}
 if(insetRatio)deck.style.setProperty('--inset-ratio',insetRatio);
 const width=deck.clientWidth;
 deck.style.setProperty('--camera-inset',width&&width<360?'4px':'8px');
}

export function cameraReplaySeek(onChange:(seconds:number)=>void):HTMLInputElement {
 const slider=element('input');
 slider.type='range';slider.min='0';slider.step='1';slider.value='0';slider.setAttribute('aria-label','录像播放位置');
 slider.addEventListener('change',()=>onChange(Number(slider.value)));
 return slider;
}
export function cameraReplayTimeline(seek:HTMLInputElement,...actions:HTMLButtonElement[]):HTMLElement {
 return element('div','camera-playback-timeline camera-toolbar-motion',seek,element('div','camera-replay-actions',...actions));
}
export function paintReplayPause(control:HTMLButtonElement,paused:boolean):void {
 control.replaceChildren(officialIcon(paused?'camera:replay-play':'camera:replay-pause'));
 control.setAttribute('aria-label',paused?'继续播放':'暂停回看');control.setAttribute('aria-pressed',String(paused));
}
export function paintReplayRate(control:HTMLButtonElement,rate:number):void {
 control.replaceChildren(element('span','camera-rate-label',`${rate}×`));
 control.setAttribute('aria-description',`回看速度：${rate}倍`);control.setAttribute('aria-label',`回看速度：${rate}倍`);
}
