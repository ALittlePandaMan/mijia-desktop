"use client";
import {useEffect,useRef} from 'react';
import {connectDemoSession} from './demo-session';
import {siteAsset} from './site-path';
import {getSiteTheme,SITE_THEME_EVENT} from './site-theme';
export type DemoMode='devices'|'monitor';
export default function DemoFrame({instance,mode,onMode,fullscreen=false,onExitFullscreen}:{instance:'hero'|'showcase';mode:DemoMode;onMode?:(mode:DemoMode)=>void;fullscreen?:boolean;onExitFullscreen?:()=>void}){
 const frame=useRef<HTMLIFrameElement>(null),current=useRef({mode,fullscreen,onMode,onExitFullscreen}),intersecting=useRef(true);current.current={mode,fullscreen,onMode,onExitFullscreen};
 useEffect(()=>{const node=frame.current;if(!node)return;const connection=connectDemoSession(instance,node);
  const size=()=>{node.contentWindow?.postMessage({type:'mijia-demo:viewport',instance,bounded:current.current.fullscreen||getComputedStyle(node).aspectRatio!=='auto'},location.origin);};
  const theme=()=>{node.contentWindow?.postMessage({type:'mijia-demo:theme',instance,theme:getSiteTheme()},location.origin);};
  const send=()=>{size();theme();node.contentWindow?.postMessage({type:'mijia-demo:mode',instance,mode:current.current.mode},location.origin);node.contentWindow?.postMessage({type:'mijia-demo:fullscreen',instance,active:current.current.fullscreen},location.origin);node.contentWindow?.postMessage({type:'mijia-demo:visibility',instance,visible:intersecting.current},location.origin);connection.visible(intersecting.current);};
  const receive=(event:MessageEvent)=>{if(event.origin!==location.origin||event.source!==node.contentWindow||event.data?.instance!==instance)return;const data=event.data;if(data.type==='mijia-demo:ready')send();if(data.type==='mijia-demo:mode'&&['devices','monitor'].includes(data.mode))current.current.onMode?.(data.mode);if(data.type==='mijia-demo:fullscreen-exit')current.current.onExitFullscreen?.();if(data.type==='mijia-demo:resize'&&!current.current.fullscreen&&data.mode===current.current.mode&&typeof data.height==='number'&&Number.isFinite(data.height)&&data.height>=120&&data.height<=4096)node.style.setProperty('--demo-content-height',`${Math.ceil(data.height)}px`);};
  const connect=()=>{node.contentWindow?.postMessage({type:'mijia-demo:connect',instance},location.origin);send();};
  window.addEventListener('message',receive);window.addEventListener(SITE_THEME_EVENT,theme);node.addEventListener('load',connect);const observer=new IntersectionObserver(entries=>{intersecting.current=entries[0]?.isIntersecting??true;send();}),resize=new ResizeObserver(size);observer.observe(node);resize.observe(node);connect();
  return()=>{observer.disconnect();resize.disconnect();connection.close();window.removeEventListener('message',receive);window.removeEventListener(SITE_THEME_EVENT,theme);node.removeEventListener('load',connect);};
 },[instance]);
 useEffect(()=>{frame.current?.contentWindow?.postMessage({type:'mijia-demo:mode',instance,mode},location.origin);},[instance,mode]);
 useEffect(()=>{const node=frame.current;if(!node)return;node.contentWindow?.postMessage({type:'mijia-demo:fullscreen',instance,active:fullscreen},location.origin);node.contentWindow?.postMessage({type:'mijia-demo:viewport',instance,bounded:fullscreen||getComputedStyle(node).aspectRatio!=='auto'},location.origin);},[instance,fullscreen]);
 return <iframe ref={frame} className="live-demo-frame" src={siteAsset('demo/index.html?instance='+instance)} aria-label={instance==='hero'?'米家Desktop 设备控制演示':'米家Desktop 设备与监控界面演示'} sandbox="allow-scripts allow-same-origin allow-downloads" allow="fullscreen" allowFullScreen loading={instance==='hero'?'eager':'lazy'}/>;
}
