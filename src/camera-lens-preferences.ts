import {api} from './api';
import type {DeviceContext} from './types';
import type {LocalPreferences} from './local-preferences';
const views=new Map<string,Promise<LocalPreferences>>();
const pending=new Map<string,Promise<unknown>>();
function key(c:DeviceContext){return JSON.stringify([c.homeId,c.generation]);}
export async function primaryCameraLens(c:DeviceContext,allowed:readonly number[]):Promise<number>{
 const k=key(c);let view=views.get(k);if(!view){if(views.size>=4)views.clear();view=api.homePreferences(c.homeId,c.generation);views.set(k,view);void view.catch(()=>{if(views.get(k)===view)views.delete(k);});}
 const selected=(await view).cameraPrimaryLenses?.[c.did];return selected!==undefined&&allowed.includes(selected)?selected:allowed[0]??0;
}
export function rememberCameraLens(c:DeviceContext,lensId:number):Promise<void>{
 const k=key(c),next=(pending.get(k)??Promise.resolve()).catch(()=>{}).then(()=>api.changeHomePreferences(c.homeId,c.generation,{operation:'setCameraPrimaryLens',did:c.did,lensId})).then(view=>{views.set(k,Promise.resolve(view));});
 pending.set(k,next);void next.finally(()=>{if(pending.get(k)===next)pending.delete(k);}).catch(()=>{});return next;
}
