import {invoke} from '@tauri-apps/api/core';
import type {Device,HomeCardEntry,HomeCardStatus,HomeCardIntent,HomeCardResult,DeviceContext,AppError} from './types';
export type DesktopGridPreset='6x4'|'8x6';
export interface WidgetGeometry{size?:import('./card-size').CardSize;monitor:string;x:number;y:number;width:number;grid?:{preset:DesktopGridPreset;column:number;halfRow:number;step:number}}
export interface WidgetView{id:string;homeId:string;revision:number;device:Device|null;card:HomeCardEntry|null;status:HomeCardStatus|null;presentation?:import('./types').HomeCardPresentation|null;presentationStale?:boolean;groupIntent?:import('./types').SwitchGroupResult|null;controlIntent?:import('./types').CardControlResult|null;pending:HomeCardIntent|null;origin?:string|null;error:AppError|null;geometry:WidgetGeometry}
export interface HostViewport{clip?:{x:number;y:number;width:number;height:number};monitor:string;width:number;height:number;scale:number}
export interface WidgetGesture{sequence:number;kind:'move'}
export interface HostCard{baseWidth?:number;preview?:boolean;gesture?:WidgetGesture|null;contentScale?:number;view:WidgetView;x:number;y:number;width:number;height:number;z:number;interactive:boolean}
export interface GridHint{x:number;y:number;width:number;height:number;state:string}
export interface HostFrame{revision:number;reset:boolean;viewport:HostViewport;cards:HostCard[];removed:string[];hints?:GridHint[]}
export interface DesktopPadding{top:number;right:number;bottom:number;left:number}
export interface DesktopDisplayPatch{enabled?:boolean;padding?:DesktopPadding}
export interface DesktopGridSettings{supported:boolean;displays:{id:string;name:string;primary?:boolean;width:number;height:number;scale:number;enabled:boolean;padding:DesktopPadding;preset:DesktopGridPreset;available:DesktopGridPreset[]}[]}
export interface WidgetSupport{enabledDisplays?:number;supported:boolean;reason:string|null;pins:{id:string;homeId:string;did:string}[]}
/** Availability is visual only; the native save rechecks the current layout. */
export function widgetSizeAvailable(geometry:WidgetGeometry,size:import('./card-size').CardSize,others:readonly WidgetGeometry[]):boolean{
 const at=geometry.grid;if(!at)return true;const cols=at.preset==='6x4'?6:8,rows=at.preset==='6x4'?8:12;
 const column=at.column,row=size==='small'?at.halfRow:Math.floor(at.halfRow/2)*2,w=size==='large'?2:1,h=size==='small'?1:2;
 if(column+w>cols||row+h>rows)return false;
 return others.every(g=>{const p=g.grid;if(g.monitor!==geometry.monitor||!p)return true;const width=g.size==='large'?2:1,height=g.size==='small'?1:2;return column>=p.column+width||column+w<=p.column||row>=p.halfRow+height||row+h<=p.halfRow;});
}
export const desktopWidgets={
 grids:(monitor?:string,preset?:DesktopGridPreset,patch?:DesktopDisplayPatch)=>invoke<DesktopGridSettings>('desktop_widget_grids',{monitor,preset,...patch}),
 regions:(widgetId:string,width:number,height:number,regions:{kind:string;x:number;y:number;width:number;height:number}[],presentation?:{x:number;y:number;width:number;height:number})=>invoke<void>('desktop_widget_regions',{widgetId,width,height,regions,presentation}),
 support:()=>invoke<WidgetSupport>('desktop_widget_support'),
 pin:(c:DeviceContext)=>invoke<WidgetSupport>('desktop_widget_pin',{...c}),
 unpin:(id?:string)=>invoke<void>('desktop_widget_unpin',{id}),
 snapshot:()=>invoke<HostFrame>('desktop_widget_snapshot'),
 viewport:(cssWidth:number,reducedMotion:boolean,revision:number)=>invoke<HostViewport>('desktop_widget_viewport',{cssWidth,reducedMotion,revision}),
 resize:(widgetId:string,size:import('./card-size').CardSize)=>invoke<WidgetGeometry>('desktop_widget_geometry',{widgetId,size}),
 largeAvailable:(widgetId:string)=>invoke<boolean>('desktop_widget_large_available',{widgetId}),
 menu:(rect:{x:number;y:number;width:number;height:number}|null)=>invoke<void>('desktop_widget_menu',{rect}),
 control:(intent:HomeCardIntent,confirm=false,context?:DeviceContext,widgetId?:string)=>{
  const guard=import.meta.env.DEV?(window as Window&{__MIJIA_UI_TEST_GUARD?:{blocked:number}}).__MIJIA_UI_TEST_GUARD:undefined;
  if(guard&&!confirm){guard.blocked++;return Promise.reject({kind:'uiTestWriteBlocked',message:'界面验证已阻止原生写入。',retryable:false});}
  return invoke<HomeCardResult>('desktop_widget_control',{intent,confirm,...context,widgetId});
 },
 open:(widgetId?:string)=>invoke<void>('desktop_widget_open',{widgetId}),
 switchGroup:(widgetId:string,groupId:string,on:boolean,requestId:string,confirmOnly=false)=>{
  const guard=import.meta.env.DEV?(window as Window&{__MIJIA_UI_TEST_GUARD?:{blocked:number}}).__MIJIA_UI_TEST_GUARD:undefined;if(guard&&!confirmOnly){guard.blocked++;return Promise.reject({kind:'permissionDenied',message:'测试禁止真实设备操作。'});}
  return invoke<import('./types').SwitchGroupResult>('desktop_widget_switch_group',{widgetId,groupId,on,requestId,confirmOnly});
 },
 cardControl:(widgetId:string,change:import('./types').CardControlChange)=>{
  const guard=import.meta.env.DEV?(window as Window&{__MIJIA_UI_TEST_GUARD?:{blocked:number}}).__MIJIA_UI_TEST_GUARD:undefined;
  if(guard&&!change.confirmOnly){guard.blocked++;return Promise.reject({kind:'uiTestWriteBlocked',message:'界面验证已阻止原生写入。',retryable:false});}
  return invoke<import('./types').CardControlResult>('desktop_widget_card_control',{widgetId,change});
 },
 gesture:(widgetId:string,phase:'arm'|'begin'|'move'|'end'|'cancel',kind?:'move')=>invoke<WidgetGeometry>('desktop_widget_gesture',{widgetId,change:{phase,kind}}),
};
/** Window-independent intent/result revision gate; stale readbacks cannot win. */
export class WidgetRevisions{
 private revisions=new Map<string,number>();
 accept(home:string,did:string,revision:number):boolean{const key=JSON.stringify([home,did]);if(revision<(this.revisions.get(key)??0))return false;this.revisions.set(key,revision);return true;}
 clear(){this.revisions.clear();}
}
/** Preserve locally queued taps, but relinquish an older, conflicting intent
 * when another window has already submitted its replacement. */
export function externalIntentSupersedes(own:string,origin:string|null|undefined,intent:HomeCardIntent,target:unknown):boolean{
 if(!origin||origin===own||target===undefined)return false;
 const normalized=typeof target==='boolean'?(target?'on':'off'):target===100?'open':target===0?'close':target;
 return normalized!==intent;
}
