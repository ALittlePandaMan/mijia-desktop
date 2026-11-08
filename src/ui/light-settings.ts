import {icon} from '../icons';
import {deviceSurfaces} from './device-surfaces';
import { encodePlaneColor,planePoint,rgbHex,rgbPosition,type PlanePoint } from '../light-color';
import { flowSpeed,flowSpeedPosition,settingsChange,settingsSlot,type LightSettingsDraft,type LightSettingsKind, type LightSettingsOperation } from '../light-settings';
import type { LightSettingsReport } from '../types';
import { button,element } from './dom';
import {deviceWait} from './device-loading';

interface LightSettingsView {
  kind:LightSettingsKind;report?:LightSettingsReport;loading:boolean;error?:string;
  draft?:LightSettingsDraft;operation?:LightSettingsOperation;online:boolean;artwork?:()=>HTMLElement;
  back:()=>void;refresh:()=>void;edit:(index:number|'speed')=>void;
  change:(draft:LightSettingsDraft)=>void;cancel:()=>void;save:()=>void;
}

export function renderLightSettings(props:LightSettingsView):HTMLElement{
  const stage=element('div','device-stage'),page=element('section','device-page page-light-settings');
  const back=button('','page-icon-button',props.back,'back');back.setAttribute('aria-label','返回灯带控制');
  page.append(element('header','device-page-header',back,element('div','device-page-title',element('h2','',props.kind==='modes'?'模式设置':'流光模式'))));
  page.dataset.settingsLoading=String(props.loading);page.dataset.settingsKind=props.kind;
  page.dataset.pendingOperations=String(props.operation?.pending?1:0);page.dataset.uncertainOperations=String(props.operation?.phase==='uncertain'?1:0);
  page.setAttribute('aria-busy',String(props.loading||!!props.operation?.pending));
  const body=element('div','device-page-scroll light-settings-content');
  const reason=props.loading?'正在读取模式设置。':props.operation?.pending?'上一项设置仍待确认。':!props.online?'设备离线。':props.error??props.report?.writeReason;
  if(reason)page.setAttribute('aria-description',reason);
  if(props.error||props.operation?.error){const message=element('p','light-settings-error',props.error??props.operation?.error?.message);message.setAttribute('role','alert');body.append(message);}
  const row=(title:string,value:HTMLElement,index:number|'speed',unavailable?:string):void=>{
    const control=button('','light-settings-row',()=>{if(!control.disabled&&control.isConnected)props.edit(index);});
    control.dataset.settingsIndex=String(index);control.append(element('strong','',title),value,icon('chevron','light-settings-chevron original-right-chevron'));
    control.setAttribute('aria-label',title);control.disabled=!!(reason||unavailable);
    if(reason||unavailable)control.setAttribute('aria-description',reason??unavailable!);
    if(props.operation?.pending){const c=props.operation.change,target=c.operation==='setSpeed'?'speed':c.index;
      if(index===target&&(props.kind==='flow')===(c.operation!=='saveMode')){control.dataset.pending=props.operation.phase;control.setAttribute('aria-busy','true');}}
    body.append(control);
  };
  if(props.loading&&!props.report){body.append(deviceWait(props.artwork,'模式设置'));page.append(body);stage.append(page);return deviceSurfaces(stage);}
  if(props.kind==='flow'){
    const value=props.report?.speed.value,unavailable=props.report?.speed.reason??(value==null?'流光速度尚未读取。':undefined);
    const pending=props.operation?.pending&&props.operation.change.operation==='setSpeed'?props.operation.change.value:value;
    row('流光速度',element('span','light-settings-value',pending==null?'--':`${pending*100}ms`),'speed',unavailable);
  }
  for(let index=0;index<4;index++){
    const slot=settingsSlot(props.report,props.kind,index),raw=(props.kind==='modes'?props.report?.slots:props.report?.flowSlots)?.find(s=>s.index===index);
    const c=props.operation?.pending?props.operation.change:undefined;
    const pending=c&&c.operation!=='setSpeed'&&c.index===index&&(c.operation==='saveMode')===(props.kind==='modes')?c:undefined;
    const brightness=pending?.brightness??slot?.brightness,color=pending?.color??slot?.color;
    const tab=pending?.operation==='saveMode'?pending.tab:slot?.tab;
    const ct=pending?.operation==='saveMode'?pending.temperaturePercent:slot?.temperaturePercent;
    const value=element('span','light-settings-value');
    if(slot||pending){value.append(element('span','',props.kind==='modes'?`亮度 ${brightness}% | ${tab==='temperature'?`色温 ${ct}%`:'颜色'}`:`${brightness}% | `));
      if(tab==='color'||props.kind==='flow'){const swatch=element('span','light-settings-swatch');swatch.style.backgroundColor=rgbHex(color!);value.append(swatch);}
    }else value.append('--');
    row(`${props.kind==='modes'?'我的模式':'流光编辑'} ${index+1}`,value,index,slot?undefined:raw?.reason??'模式槽位尚未成功读取。');
  }
  page.append(body);
  if(props.draft)page.append(renderLightSettingsDialog(props));
  stage.append(page);return deviceSurfaces(stage);
}

function renderLightSettingsDialog(props:LightSettingsView):HTMLElement{
  const original=props.draft!,draft=structuredClone(original);
  const overlay=element('div','light-settings-overlay');
  const dialog=element('section','light-settings-dialog');dialog.tabIndex=-1;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  const title=draft.kind==='speed'?'流光速度':`${props.kind==='modes'?'我的模式':'流光编辑'} ${draft.index+1}`;
  dialog.setAttribute('aria-label',title);dialog.append(element('h3','',title));
  const content=element('div','light-settings-draft');
  const save=button('确定','',()=>{if(!save.disabled&&dialog.isConnected){props.change(structuredClone(draft));props.save();}});
  const alive=()=>dialog.isConnected;
  const changed=():void=>{
    if(!alive())return;props.change(structuredClone(draft));
    try{settingsChange(props.kind,draft);save.disabled=!!(!props.online||props.loading||props.report?.writeReason||props.operation?.pending);save.removeAttribute('aria-description');}
    catch(error){save.disabled=true;save.setAttribute('aria-description',(error as Error).message);}
  };
  const slider=(label:string,value:number,min:number,max:number,onInput:(value:number)=>number,show:(value:number)=>string=(value)=>`${value}%`,initialOutput=value):HTMLElement=>{
    const field=element('label','light-settings-draft-field',element('span','',`${label} ${show(initialOutput)}`)),input=element('input','light-settings-range');
    input.type='range';input.min=String(min);input.max=String(max);input.step='1';input.value=String(value);input.setAttribute('aria-label',label);
    const update=(v:number)=>{field.querySelector('span')!.textContent=`${label} ${show(v)}`;input.setAttribute('aria-valuetext',show(v));input.style.setProperty('--fill',`${Math.max(0,Math.min(100,(Number(input.value)-min)/(max-min)*100))}%`);};
    input.addEventListener('input',()=>{if(!alive())return;const v=onInput(Number(input.value));update(v);changed();});
    let pointer:number|undefined,initialInput='',snapshot:LightSettingsDraft|undefined,observer:MutationObserver|undefined;
    const end=(cancel:boolean):void=>{
      if(pointer===undefined)return;pointer=undefined;delete dialog.dataset.interacting;
      window.removeEventListener('pointerup',up,true);window.removeEventListener('blur',blur);observer?.disconnect();observer=undefined;
      if(cancel&&alive()&&snapshot){Object.assign(draft,snapshot);input.value=initialInput;
        update(snapshot.kind==='speed'?snapshot.value:label==='亮度'?snapshot.brightness:snapshot.temperaturePercent);changed();}
    };
    const up=(event:PointerEvent)=>{if(event.pointerId===pointer)end(false);},blur=()=>end(true);
    input.addEventListener('pointerdown',event=>{
      if(!alive()||event.button!==0||!event.isPrimary||pointer!==undefined)return;
      pointer=event.pointerId;initialInput=input.value;snapshot=structuredClone(draft);dialog.dataset.interacting='true';
      window.addEventListener('pointerup',up,true);window.addEventListener('blur',blur);
      observer=new MutationObserver(()=>{if(!alive())end(true);});observer.observe(document.documentElement,{childList:true,subtree:true});
    });
    input.addEventListener('pointercancel',event=>{if(event.pointerId===pointer)end(true);});
    field.append(input);update(initialOutput);return field;
  };
  if(draft.kind==='speed')content.append(slider('流光速度',flowSpeedPosition(draft.value),0,100,percent=>(draft.value=flowSpeed(percent)),value=>`${value*100}ms`,draft.value));
  else{
    content.append(slider('亮度',draft.brightness,0,100,value=>(draft.brightness=Math.max(props.kind==='flow'?1:0,value))));
    const colorContainer=element('div','light-settings-color-content');
    const drawColor=():void=>{
      colorContainer.replaceChildren();
      if(draft.tab==='temperature'){
        const temperature=slider('色温',draft.temperaturePercent,0,100,value=>(draft.temperaturePercent=value));temperature.classList.add('light-settings-temperature');colorContainer.append(temperature);return;
      }
      const heading=element('div','light-settings-color-heading',element('span','','颜色 | ')),swatch=element('span','light-settings-swatch');heading.append(swatch);
      const plane=element('div','light-color-plane light-settings-plane'),marker=element('span','light-color-marker');plane.append(marker);
      plane.tabIndex=0;plane.setAttribute('role','group');plane.setAttribute('aria-label','草稿 RGB 颜色');
      const display=(value:number,position=rgbPosition(value)):void=>{swatch.style.backgroundColor=rgbHex(value);marker.style.backgroundColor=rgbHex(value);marker.style.left=`${position.x*100}%`;marker.style.top=`${position.y*100}%`;plane.setAttribute('aria-label',`草稿 RGB 颜色 ${rgbHex(value)}`);};
      let pointer:number|undefined,startColor=draft.color,point:PlanePoint|undefined,observer:MutationObserver|undefined;
      const cleanup=():void=>{window.removeEventListener('blur',blur);observer?.disconnect();observer=undefined;};
      const end=(cancel:boolean):void=>{
        if(pointer===undefined)return;const id=pointer;pointer=undefined;cleanup();delete dialog.dataset.interacting;
        try{if(plane.hasPointerCapture(id))plane.releasePointerCapture(id);}catch{/* Native capture may already have ended. */}
        if(!alive())return;if(cancel){draft.color=startColor;point=undefined;display(draft.color);changed();}
      };
      const blur=()=>end(true);
      const sample=(event:PointerEvent,phase:'start'|'move'):void=>{
        const rect=plane.getBoundingClientRect(),width=plane.clientWidth,height=plane.clientHeight;
        if(!width||!height||!rect.width||!rect.height)throw Error('颜色面板尺寸不可用。');
        const x=(event.clientX-rect.left)*width/rect.width,y=(event.clientY-rect.top)*height/rect.height;
        point=planePoint(x,y,width,height,phase);draft.color=encodePlaneColor(point,'commit');
        display(draft.color,{x:Math.max(0,Math.min(1,x/width)),y:Math.max(0,Math.min(1,y/height))});changed();
      };
      plane.addEventListener('pointerdown',event=>{
        if(!alive()||event.button!==0||!event.isPrimary||pointer!==undefined)return;
        event.preventDefault();plane.focus({preventScroll:true});pointer=event.pointerId;startColor=draft.color;dialog.dataset.interacting='true';
        try{plane.setPointerCapture(pointer);window.addEventListener('blur',blur);observer=new MutationObserver(()=>{if(!alive())end(true);});observer.observe(document.documentElement,{childList:true,subtree:true});sample(event,'start');}
        catch{end(true);}
      });
      plane.addEventListener('pointermove',event=>{if(pointer===event.pointerId&&alive())try{sample(event,'move');}catch{end(true);}});
      plane.addEventListener('pointerup',event=>{if(pointer===event.pointerId)end(false);});
      for(const name of ['pointercancel','lostpointercapture'])plane.addEventListener(name,event=>{if((event as PointerEvent).pointerId===pointer)end(true);});
      plane.addEventListener('keydown',event=>{
        if(!alive()||pointer!==undefined||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
        event.preventDefault();if(!point){const p=rgbPosition(draft.color);point={x:Math.trunc(p.x*100),y:Math.trunc((1-p.y)*100)};}
        point={x:Math.max(0,Math.min(100,point.x+(event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0))),y:Math.max(0,Math.min(100,point.y+(event.key==='ArrowUp'?1:event.key==='ArrowDown'?-1:0)))};
        draft.color=encodePlaneColor(point,'commit');display(draft.color);changed();
      });
      display(draft.color);colorContainer.append(heading,plane);
    };
    if(props.kind==='modes'){
      const tabs=element('div','light-settings-draft-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','模式颜色类型');
      for(const [value,label]of [['temperature','色温'],['color','颜色']]as const){const tab=button(label,'',()=>{
        if(!alive())return;draft.tab=value;for(const t of tabs.querySelectorAll('button')){t.setAttribute('aria-selected',String(t===tab));t.classList.toggle('selected',t===tab);}drawColor();changed();
      });tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(draft.tab===value));tab.classList.toggle('selected',draft.tab===value);tabs.append(tab);}content.append(tabs);
    }
    content.append(colorContainer);drawColor();
  }
  const cancel=button('取消','',()=>{if(alive())props.cancel();});
  dialog.append(content,element('div','light-settings-dialog-actions',cancel,save));overlay.append(dialog);
  overlay.addEventListener('click',event=>{if(event.target===overlay)props.cancel();});
  dialog.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();props.cancel();return;}
    if(event.key!=='Tab')return;
    const stops=[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')],first=stops[0],last=stops.at(-1);
    if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  queueMicrotask(()=>{if(alive()){changed();dialog.focus({preventScroll:true});}});return overlay;
}
