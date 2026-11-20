"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import DemoFrame,{type DemoMode} from './demo-frame';
import {useScrollReveal} from './use-scroll-reveal';
import ThemeToggle from './theme-toggle';
import GithubStats from './github-stats';
import {siteAsset} from './site-path';
const repo='https://github.com/ALittlePandaMan/mijia-desktop';
const release='v1.0.0';
const installer=`${repo}/releases/download/${release}/mijia-desktop-${release}-windows-x64-setup.exe`;
const docs=`${repo}/blob/${release}/README.md#下载与使用`;
const navigation:{label:string;href:string;external?:boolean}[]=[
 {label:'首页',href:'#top'},
 {label:'功能亮点',href:'#features'},
 {label:'交互演示',href:'#showcase'},
 {label:'智能家居 MCP',href:'#mcp'},
 {label:'使用指南',href:docs,external:true},
 {label:'更新日志',href:repo+'/blob/main/CHANGELOG.md',external:true}
];
type Glyph='arrow'|'download'|'github'|'home'|'cloud'|'grid'|'sliders'|'folder'|'code'|'menu'|'close';
const paths:Record<Exclude<Glyph,'github'>,string>={arrow:'M4 12h16m-6-6 6 6-6 6',download:'M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4',home:'m3 10 9-7 9 7v10h-6v-6H9v6H3Z',cloud:'M7 18a5 5 0 0 1-1-10 6 6 0 0 1 11-2 6 6 0 0 1 1 12Zm2-6 3-3 3 3m-3-3v9',grid:'M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z',sliders:'M4 3v6m0 4v8M12 3v10m0 4v4M20 3v2m0 4v12M1 9h6m2 8h6m2-12h6',folder:'M3 6h7l2 3h9v11H3Z',code:'m8 5-6 7 6 7m8-14 6 7-6 7m-3-17-2 20',menu:'M4 6h16M4 12h16M4 18h16',close:'m6 6 12 12M6 18 18 6'};
function Icon({name}:{name:Glyph}){return <svg className="icon" viewBox="0 0 24 24" fill={name==='github'?'currentColor':'none'} stroke={name==='github'?'none':'currentColor'} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={name==='github'?'M12 2a10 10 0 0 0-3.2 19.5v-2c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5 1-.5 1.6 1 1.6 1 .9 1.5 2.3 1.1 2.9.8.1-.7.4-1.1.7-1.4-2.3-.2-4.6-1.1-4.6-4.9 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .9-.3 2.8 1 1.6-.4 3.3-.4 4.9 0 1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.8-2.3 4.7-4.6 4.9.4.4.7 1 .7 1.9v2.4A10 10 0 0 0 12 2Z':paths[name]}/></svg>;}

// Match the desktop caption SVGs; these spans are decorative, with no actions.
function WindowCaptionIcons(){return <span className="window-caption-icons" aria-hidden="true">{(['minimize','maximize','close'] as const).map(kind=><span className="window-caption-icon" key={kind}><svg viewBox="0 0 16 16" data-icon-name={'desktop:'+kind} data-icon-source="desktop-window" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{kind==='maximize'?<rect x="3.5" y="3.5" width="9" height="9" rx="1"/>:<path d={kind==='minimize'?'M3 8h10':'M3 3l10 10M13 3L3 13'}/>}</svg></span>)}</span>;}
function Preview({instance,mode,onMode}:{instance:'hero'|'showcase';mode:DemoMode;onMode?:(mode:DemoMode)=>void}){
 const windowRef=useRef<HTMLDivElement>(null),fullscreenButton=useRef<HTMLButtonElement>(null),currentMode=useRef(mode);
 const [fullscreen,setFullscreen]=useState(false),[canFullscreen,setCanFullscreen]=useState(false);
 currentMode.current=mode;
 const exitFullscreen=useCallback(()=>{
  const node=windowRef.current;
  if(node&&document.fullscreenElement&&node.contains(document.fullscreenElement))return document.exitFullscreen().catch(()=>{});
  return Promise.resolve();
 },[]);
 useEffect(()=>{
  const node=windowRef.current;if(!node)return;
  setCanFullscreen(document.fullscreenEnabled&&typeof node.requestFullscreen==='function');
  let wasFullscreen=false;
  const changed=()=>{
   const active=document.fullscreenElement===node;setFullscreen(active);
   if(wasFullscreen&&!active&&!document.fullscreenElement){
    if(currentMode.current==='monitor')fullscreenButton.current?.focus({preventScroll:true});
    else document.getElementById('tab-devices')?.focus({preventScroll:true});
   }
   wasFullscreen=active;
  };
  document.addEventListener('fullscreenchange',changed);
  return()=>document.removeEventListener('fullscreenchange',changed);
 },[]);
 useEffect(()=>{if(mode!=='monitor')void exitFullscreen();},[mode,exitFullscreen]);
 const toggleFullscreen=async()=>{
  const node=windowRef.current;if(!node)return;
  if(document.fullscreenElement){await exitFullscreen();return;}
  try{await node.requestFullscreen();}catch{node.setAttribute('aria-description','当前浏览器无法进入全屏');}
 };
 return <div className={'preview-container preview-'+instance}><div ref={windowRef} className={'desktop-window'+(mode==='monitor'?' is-monitor':'')}><div className="titlebar"><img src={siteAsset('app-icon-blue.svg')} width="20" height="20" alt=""/><span>米家</span>{mode==='monitor'&&<div className="preview-monitor-actions"><button type="button" onClick={()=>{void exitFullscreen();onMode?.('devices');}}>退出监控</button><button ref={fullscreenButton} type="button" disabled={!canFullscreen} aria-pressed={fullscreen} onClick={()=>{void toggleFullscreen();}}>{fullscreen?'退出全屏':'全屏'}</button></div>}<WindowCaptionIcons/></div><DemoFrame instance={instance} mode={mode} onMode={onMode} fullscreen={fullscreen} onExitFullscreen={exitFullscreen}/></div></div>;
}
const benefits:[Glyph,string,string][]=[
 ['home','按房间管理设备','从左上角切换家庭，再按客厅、卧室等房间查找设备。也可以在「全屋」浏览当前家庭的设备，点开卡片查看详情，例如温湿度计的历史曲线。'],
 ['cloud','扫码登录米家','用手机上的米家 App 扫描电脑上的登录二维码，确认后即可查看账号中的家庭和设备。智能家居助手会在后台连接，需要时可在设置里开启 MCP。'],
 ['grid','多路监控同屏','在设置中勾选支持的摄像机，可以只看当前家庭，也可以把多个家庭的画面排在同一屏。需要看细节时可放大单路，长时间查看可将整面监控墙切到全屏。'],
 ['sliders','卡片快捷控制','设备卡片有小、中、大三种尺寸，按住拖动可调整顺序，右键可切换大小。支持快捷控制的设备能在大卡片上直接操作，例如调空调温度、调灯光亮度或打开窗帘。'],
 ['folder','截图录像保存到电脑','在支持的摄像机画面上可以截图或录制视频。文件默认保存在系统的「视频／米家Desktop」目录，可在设置中更改保存位置或直接打开文件夹。'],
 ['code','免费开源','提供 Windows 安装版和便携版。安装版按提示安装，便携版完整解压后运行。原创代码采用 MIT 协议，可在 GitHub 查看源码、反馈问题或贡献代码。']
];

const mcpSection = (
 <section className="mcp-section shell" id="mcp" aria-labelledby="mcp-title">
  <div className="section-heading mcp-heading" data-reveal="heading">
   <span className="eyebrow">智能家居 MCP</span>
   <h2 id="mcp-title">用 AI 助手<span>控制米家设备</span></h2>
   <p>接入兼容的 AI 助手后，可以用自然语言控制设备、查询状态和启动场景。指令由米家云端执行。</p>
  </div>
  <figure className="mcp-conversation" data-reveal="preview">
   <figcaption>对话示例</figcaption>
   <div className="mcp-messages">
    <div className="mcp-message mcp-message-user">
     <span>你</span>
     <p>把客厅空调打开，设为 26°C。</p>
    </div>
    <div className="mcp-message">
     <span>AI 助手</span>
     <p>客厅空调已开启，温度设为 26°C。</p>
    </div>
   </div>
  </figure>
 </section>
);

export default function Promo(){
 const [mode,setMode]=useState<DemoMode>('devices'),[menu,setMenu]=useState(false),toggle=useRef<HTMLButtonElement>(null),header=useRef<HTMLElement>(null),page=useRef<HTMLDivElement>(null);
 useScrollReveal(page);
 useEffect(()=>{
  if(!menu)return;
  const node=header.current!,root=document.documentElement,body=document.body,rootOverflow=root.style.overflow,bodyOverflow=body.style.overflow;
  const desktop=matchMedia('(min-width:1024px)');
  root.style.overflow=body.style.overflow='hidden';
  node.querySelector<HTMLElement>('.mobile-menu-link')?.focus({preventScroll:true});
  const keydown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();setMenu(false);return;}
   if(event.key!=='Tab')return;
   const controls=[...node.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)')].filter(control=>control.getClientRects().length&&!control.closest('[inert]'));
   const first=controls[0],last=controls.at(-1);if(!first||!last)return;
   if(event.shiftKey&&(document.activeElement===first||!node.contains(document.activeElement))){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||!node.contains(document.activeElement))){event.preventDefault();first.focus();}
  };
  const resized=()=>{if(desktop.matches)setMenu(false);};
  window.addEventListener('keydown',keydown);desktop.addEventListener('change',resized);
  return()=>{
   root.style.overflow=rootOverflow;body.style.overflow=bodyOverflow;
   window.removeEventListener('keydown',keydown);desktop.removeEventListener('change',resized);
   if(node.contains(document.activeElement))(desktop.matches?node.querySelector<HTMLElement>('.desktop-nav a'):toggle.current)?.focus({preventScroll:true});
  };
 },[menu]);
 return <div id="top" ref={page}><a className="skip" href="#main">跳到主要内容</a>
  <header ref={header} className={'site-header'+(menu?' is-menu-open':'')} role={menu?'dialog':undefined} aria-modal={menu||undefined} aria-label={menu?'导航菜单':undefined}>
   <div className="nav-shell shell"><nav className="desktop-nav" aria-label="主导航">{navigation.map(item=><a key={item.href} href={item.href} target={item.external?'_blank':undefined} rel={item.external?'noreferrer':undefined}>{item.label}</a>)}<a href="#download">免费下载</a></nav><div className="header-actions"><ThemeToggle/><a className="github-link" href={repo} target="_blank" rel="noreferrer" aria-label="在 GitHub 查看源码"><Icon name="github"/></a><button type="button" className="nav-toggle" ref={toggle} aria-label={menu?'关闭导航':'打开导航'} aria-controls="mobile-navigation" aria-expanded={menu} onClick={()=>setMenu(open=>!open)}><span className="nav-toggle-glyph" aria-hidden="true"><span/><span/><span/></span></button></div></div>
   <div id="mobile-navigation" className="mobile-menu" aria-hidden={!menu} inert={!menu}><nav className="mobile-menu-nav shell" aria-label="移动导航">{navigation.map(item=><a className="mobile-menu-link" key={item.href} href={item.href} target={item.external?'_blank':undefined} rel={item.external?'noreferrer':undefined} onClick={()=>setMenu(false)}>{item.label}</a>)}<div className="mobile-menu-footer"><a className="button primary" href="#download" onClick={()=>setMenu(false)}><Icon name="download"/>免费下载</a><a className="mobile-menu-github" href={repo} target="_blank" rel="noreferrer" onClick={()=>setMenu(false)}><Icon name="github"/>查看源码</a></div></nav></div>
  </header>
  <main id="main" inert={menu}>
   <section className="hero shell"><div className="hero-copy"><h1 className="hero-brand"><img src={siteAsset('app-icon-blue.svg')} width="52" height="52" alt=""/><span>米家Desktop</span></h1><p className="hero-tagline">在电脑上用米家，<br/>管理设备，查看多路监控。</p><div className="hero-actions"><a className="button primary" href={installer}><Icon name="download"/>下载 Windows 版</a><a className="button secondary" href={docs} target="_blank" rel="noreferrer">使用指南<Icon name="arrow"/></a></div><div className="availability">Windows 10 / 11（x64）· 免费开源</div></div><div className="hero-product"><Preview instance="hero" mode="devices"/></div></section>
   <section className="features shell" id="features"><div className="section-heading" data-reveal="heading"><h2>功能亮点</h2><GithubStats/></div><div className="benefit-grid">{benefits.map(([icon,title,copy])=><article className="benefit-card" data-reveal="card" key={title}><span className="benefit-icon"><Icon name={icon}/></span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
   <section className="showcase-section shell" id="showcase"><div className="section-heading" data-reveal="heading"><h2>体验米家Desktop</h2></div><div className="mode-tabs" data-reveal="tabs" role="tablist" aria-label="交互演示模式">{([['devices','home','米家模式'],['monitor','grid','监控模式']] as const).map(([id,icon,label])=><button key={id} type="button" id={'tab-'+id} role="tab" aria-selected={mode===id} aria-controls="showcase-panel" tabIndex={mode===id?0:-1} onClick={()=>setMode(id)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'devices':event.key==='End'?'monitor':mode==='devices'?'monitor':'devices';setMode(next);document.getElementById('tab-'+next)?.focus();}}}><Icon name={icon}/>{label}</button>)}</div><div id="showcase-panel" data-reveal="preview" role="tabpanel" aria-labelledby={'tab-'+mode}><Preview instance="showcase" mode={mode} onMode={setMode}/></div></section>
   {mcpSection}
   <section className="download-section" id="download" aria-labelledby="download-title"><div className="shell download-content" data-reveal="download"><h2 id="download-title">下载米家Desktop</h2><p className="download-description">安装后，用小米账号扫码登录，即可在电脑上管理米家设备。</p><div className="download-actions"><a className="button download-primary" href={installer}><Icon name="download"/>下载 Windows 版</a><a className="button download-secondary" href={repo} target="_blank" rel="noreferrer">查看源码<Icon name="arrow"/></a></div><p className="download-platform">支持 Windows · <span>macOS 和 Linux 正在适配中</span></p></div></section>
  </main><footer className="site-footer" inert={menu}><div className="shell footer-content">
   <div className="footer-main">

    <nav className="footer-column" aria-labelledby="footer-product"><h3 id="footer-product">了解产品</h3><a href="#features">功能亮点</a><a href="#showcase">交互演示</a><a href="#download">免费下载</a></nav>
    <nav className="footer-column" aria-labelledby="footer-resources"><h3 id="footer-resources">使用帮助</h3><a href={docs} target="_blank" rel="noreferrer">使用指南</a><a href={repo+'/blob/main/docs/PLATFORMS.md'} target="_blank" rel="noreferrer">平台支持</a><a href={repo+'/blob/main/CHANGELOG.md'} target="_blank" rel="noreferrer">更新日志</a><a href={siteAsset('licenses/THIRD_PARTY_NOTICES.md')} target="_blank" rel="noreferrer">第三方说明</a></nav>
    <nav className="footer-column" aria-labelledby="footer-community"><h3 id="footer-community">开源社区</h3><a href={repo} target="_blank" rel="noreferrer">查看源码</a><a href={repo+'/pulls'} target="_blank" rel="noreferrer">参与贡献</a><a href={repo+'/issues'} target="_blank" rel="noreferrer">问题反馈</a></nav>
   </div>
   <div className="footer-bottom"><div className="footer-legal"><p>© 2026 米家Desktop · 原创代码采用 <a href={repo+'/blob/main/LICENSE'} target="_blank" rel="noreferrer">MIT 协议</a></p></div><p className="footer-credit">开发者 <a href="https://github.com/ALittlePandaMan" target="_blank" rel="noreferrer">ALittlePandaMan</a></p></div>
  </div></footer>
 </div>;
}
