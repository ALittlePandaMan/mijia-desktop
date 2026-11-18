export type SiteTheme='light'|'dark';
type ThemePreference=SiteTheme|'system';
export const SITE_THEME_KEY='mijia-site-theme:v1';
export const SITE_THEME_EVENT='mijia-site:theme';
const systemQuery='(prefers-color-scheme: dark)';

// Run before the first paint; only the resolved HTML attribute is client-owned.
export const siteThemeInit=`(()=>{let choice='system';try{const saved=localStorage.getItem(${JSON.stringify(SITE_THEME_KEY)});if(saved==='light'||saved==='dark')choice=saved;}catch{}const root=document.documentElement;root.dataset.siteThemePreference=choice;root.dataset.siteTheme=choice==='dark'||(choice==='system'&&matchMedia('${systemQuery}').matches)?'dark':'light';})();`;

export function getSiteTheme():SiteTheme {
 return document.documentElement.dataset.siteTheme==='dark'?'dark':'light';
}
export function setSiteTheme(preference:ThemePreference,persist=false){
 const root=document.documentElement;
 root.dataset.siteThemePreference=preference;
 root.dataset.siteTheme=preference==='system'?(matchMedia(systemQuery).matches?'dark':'light'):preference;
 if(persist){try{localStorage.setItem(SITE_THEME_KEY,preference);}catch{}}
 window.dispatchEvent(new Event(SITE_THEME_EVENT));
}
export function subscribeToSiteTheme(changed:()=>void){
 const system=matchMedia(systemQuery);
 const systemChanged=()=>{if(document.documentElement.dataset.siteThemePreference==='system')setSiteTheme('system');};
 const storageChanged=(event:StorageEvent)=>{
  if(event.key!==SITE_THEME_KEY&&event.key!==null)return;
  const preference=event.newValue;
  setSiteTheme(preference==='light'||preference==='dark'?preference:'system');
 };
 window.addEventListener(SITE_THEME_EVENT,changed);
 window.addEventListener('storage',storageChanged);
 system.addEventListener('change',systemChanged);
 return()=>{window.removeEventListener(SITE_THEME_EVENT,changed);window.removeEventListener('storage',storageChanged);system.removeEventListener('change',systemChanged);};
}
