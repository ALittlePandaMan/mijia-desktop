import {listen} from '@tauri-apps/api/event';
import type {ResourceState} from './background-work';

/** Revisions and visibility belong to one window, never to its covered siblings. */
export function listenResourceState(label:string,accept:(state:ResourceState)=>void){
 return listen<ResourceState>('desktop-resource-state',event=>accept(event.payload),{target:label});
}
