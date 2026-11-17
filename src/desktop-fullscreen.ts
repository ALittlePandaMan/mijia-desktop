import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
let fullscreen=false;
export function nativeFullscreen():boolean{return fullscreen;}
export function adoptFullscreen(value:boolean):void{fullscreen=value;document.body.classList.toggle('desktop-native-fullscreen',value);window.dispatchEvent(new CustomEvent('desktop-fullscreen-state',{detail:value}));}
export async function setNativeFullscreen(value:boolean):Promise<void>{
 if(isTauri()){await getCurrentWindow().setFullscreen(value);adoptFullscreen(value);}else if(value){await document.documentElement.requestFullscreen();adoptFullscreen(true);}else{if(document.fullscreenElement)await document.exitFullscreen();adoptFullscreen(false);}
}
