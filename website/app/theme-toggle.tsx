"use client";
import {useSyncExternalStore} from 'react';
import {getSiteTheme,setSiteTheme,subscribeToSiteTheme,type SiteTheme} from './site-theme';
const serverTheme=():SiteTheme=>'light';
export default function ThemeToggle(){
 const theme=useSyncExternalStore(subscribeToSiteTheme,getSiteTheme,serverTheme);
 return <button type="button" className="theme-toggle" aria-label="深色模式" aria-pressed={theme==='dark'} onClick={()=>setSiteTheme(getSiteTheme()==='dark'?'light':'dark',true)}>
  <span className="theme-icon theme-moon" aria-hidden="true"><svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.9 13.1A9 9 0 0 1 10.9 3.1 9 9 0 1 0 20.9 13.1Z"/></svg></span>
  <span className="theme-icon theme-sun" aria-hidden="true"><svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></span>
 </button>;
}
