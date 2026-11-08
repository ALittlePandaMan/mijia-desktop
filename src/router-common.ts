import type {RouterClient} from './types';

export const COMMON_LIMIT=5;
export const canonicalClientMac=(mac:string):string|undefined=>/^([a-f\d]{2}:){5}[a-f\d]{2}$/i.test(mac)?mac.toUpperCase():undefined;
export function commonSections(items:RouterClient[],saved:string[]):{common:RouterClient[];other:RouterClient[]} {
 const selected=new Set(saved),byMac=new Map(items.map(item=>[item.mac.toUpperCase(),item]));return{common:saved.flatMap(mac=>{const item=byMac.get(mac);return item?[item]:[];}),other:items.filter(item=>!selected.has(item.mac.toUpperCase()))};
}
export class RouterCommonState {
 limitMac?:string;baseline?:string[];draft?:string[];candidates:string[]=[];message='';dragMac?:string;
 constructor(private changed:()=>void){}
 limit(mac:string):void{this.limitMac=canonicalClientMac(mac);this.changed();}
 dismiss():void{this.limitMac=undefined;this.changed();}
 manage(saved:string[]):void{if(!this.limitMac)return;this.baseline=[...saved];this.draft=[...saved];this.candidates=[this.limitMac];this.limitMac=undefined;this.message='';this.changed();}
 remove(mac:string):void{if(!this.draft||!this.draft.includes(mac))return;this.draft=this.draft.filter(item=>item!==mac);if(!this.candidates.includes(mac))this.candidates.push(mac);this.changed();}
 add(mac:string):void{if(!this.draft||this.draft.length>=COMMON_LIMIT||!this.candidates.includes(mac))return;this.draft=[...this.draft,mac];this.candidates=this.candidates.filter(item=>item!==mac);this.changed();}
 move(mac:string,target:string):void{if(!this.draft||mac===target)return;const from=this.draft.indexOf(mac),to=this.draft.indexOf(target);if(from<0||to<0)return;const result=[...this.draft];result.splice(from,1);result.splice(to,0,mac);this.draft=result;this.changed();}
 prepare(current:string[]):{expected:string[];macs:string[]}|undefined{if(!this.baseline||!this.draft)return;if(JSON.stringify(this.baseline)!==JSON.stringify(current)){this.message='常用设备列表已改变，请返回后重新打开。';this.changed();return;}return{expected:[...this.baseline],macs:[...this.draft]};}
 close():void{this.limitMac=undefined;this.baseline=undefined;this.draft=undefined;this.candidates=[];this.message='';this.dragMac=undefined;}
}
