import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {officialIcon} from '../icons';
import {element} from './dom';
import './desktop-frame.css';
import {showThemedWindow} from '../appearance';

export interface DesktopWindow {
  minimize():Promise<void>;
  toggleMaximize():Promise<void>;
  close():Promise<void>;
  startDragging():Promise<void>;
  isMaximized():Promise<boolean>;
  isMinimized?():Promise<boolean>;
  setFullscreen?(value:boolean):Promise<void>;
  onResized(handler:()=>void):Promise<()=>void>;
}

type CaptionIcon='minimize'|'maximize'|'restore'|'close';
function captionIcon(kind:CaptionIcon):SVGSVGElement {
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 16 16');svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');
  svg.dataset.iconName='desktop:'+kind;svg.dataset.iconSource='desktop-window';
  svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.5');
  svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
  if(kind==='maximize'||kind==='restore'){
    if(kind==='restore'){
      const back=document.createElementNS(ns,'path');back.setAttribute('d','M5.5 5.5v-3h8v8h-3');svg.append(back);
    }
    const box=document.createElementNS(ns,'rect');
    for(const [name,value]of Object.entries(kind==='maximize'?{x:'3.5',y:'3.5',width:'9',height:'9',rx:'1'}:{x:'2.5',y:'5.5',width:'8',height:'8',rx:'1'}))box.setAttribute(name,value);
    svg.append(box);
  }else{
    const path=document.createElementNS(ns,'path');path.setAttribute('d',kind==='minimize'?'M3 8h10':'M3 3l10 10M13 3L3 13');svg.append(path);
  }
  return svg;
}

/** Separate from App renders so device updates never recreate the window frame. */
export function mountDesktopFrame(native:DesktopWindow):HTMLElement {
  const lifetime=new AbortController();let disposed=false,unlisten:(()=>void)|undefined;
  window.addEventListener('pagehide',()=>{disposed=true;lifetime.abort();unlisten?.();},{once:true});
  document.body.classList.add('desktop-framed');
  const bar=element('header','desktop-titlebar');
  const drag=element('div','desktop-title-drag',officialIcon('desktop:app'),element('span','','米家'));
  const actions=element('div','desktop-window-actions');
  const monitorActions=element('div','desktop-monitor-actions');
  const exit=element('button','desktop-monitor-action','退出监控');exit.type='button';exit.addEventListener('click',()=>window.dispatchEvent(new Event('monitor-exit')));
  const fullscreen=element('button','desktop-monitor-action','全屏');fullscreen.type='button';fullscreen.addEventListener('click',()=>{void(document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()).catch(()=>{});});
  document.addEventListener('fullscreenchange',()=>{fullscreen.textContent=document.fullscreenElement?'退出全屏':'全屏';if(native.setFullscreen)run(()=>native.setFullscreen!(!!document.fullscreenElement));},{signal:lifetime.signal});monitorActions.append(exit,fullscreen);
  const run=(operation:()=>Promise<void>)=>{void operation().catch(error=>console.warn('Window action failed',error));};
  const control=(label:string,asset:CaptionIcon,operation:()=>Promise<void>)=>{
    const button=element('button','desktop-window-button',captionIcon(asset));
    button.type='button';button.setAttribute('aria-label',label);button.title=label;
    button.addEventListener('click',()=>run(operation));actions.append(button);return button;
  };
  control('最小化','minimize',()=>native.minimize());
  const maximize=control('最大化','maximize',()=>native.toggleMaximize());
  control('关闭窗口','close',()=>native.close()).classList.add('desktop-window-close');
  const update=async()=>{
    if(native.isMinimized)window.dispatchEvent(new CustomEvent('desktop-window-state',{detail:{minimized:await native.isMinimized()}}));
    const maximized=await native.isMaximized();
    if(disposed)return;
    maximize.replaceChildren(captionIcon(maximized?'restore':'maximize'));
    maximize.setAttribute('aria-label',maximized?'还原':'最大化');maximize.title=maximized?'还原':'最大化';
    maximize.setAttribute('aria-pressed',String(maximized));
  };
  drag.addEventListener('mousedown',event=>{
    if(event.button!==0)return;
    run(()=>event.detail===2?native.toggleMaximize():native.startDragging());
  });
  run(update);run(async()=>{const release=await native.onResized(()=>run(update));if(disposed)release();else unlisten=release;});
  bar.append(drag,monitorActions,actions);document.body.prepend(bar);return bar;
}

export function setupDesktopFrame():void {
  if(isTauri()){mountDesktopFrame(getCurrentWindow());void showThemedWindow().catch(error=>console.warn('Window show failed',error));}
}
