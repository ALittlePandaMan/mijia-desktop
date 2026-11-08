import type { AppError,LightFavorite,LightFavoriteChange,LightFavoriteFields,LightFavoriteResult,LightFavoritesReport,Property } from './types';
import { controlReason } from './panel-layout';
import { coercePropertyInput } from './logic';
import { rgbPropertyReason } from './light-color';

export type LightFavoriteDraft=LightFavoriteFields&{id?:string;baseline?:string};
const integer=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max;
export function favoriteName(name:string):string{
  const n=name.trim();if(!n||n.length>4||/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/.test(name))throw Error('名称需为1–4个字符，不支持表情或控制字符。');return n;
}
export function validFavorite(item:LightFavorite):boolean{
  return!item.reason&&integer(item.brightness,1,100)&&integer(item.color,0,0xffffff)&&integer(item.temperaturePercent,0,100)&&['color','temperature'].includes(item.tab)&&!!item.id&&/^[a-f0-9]{64}$/.test(item.revision);
}
export function favoriteDraft(item?:LightFavorite):LightFavoriteDraft{
  if(!item)return{name:'',brightness:100,color:0xff0000,temperaturePercent:50,tab:'color'};
  if(!validFavorite(item))throw Error(item.reason??'收藏内容不可用。');
  return{id:item.id,baseline:item.revision,name:item.name,brightness:item.brightness!,color:item.color!,temperaturePercent:item.temperaturePercent!,tab:item.tab};
}
export function favoriteChange(draft:LightFavoriteDraft,report:LightFavoritesReport):LightFavoriteChange{
  const name=favoriteName(draft.name);
  if(report.items.some(item=>item.id!==draft.id&&item.name.trim()===name))throw Error('已有同名收藏。');
  if(!integer(draft.brightness,1,100)||!integer(draft.color,0,0xffffff)||!integer(draft.temperaturePercent,0,100)||!['color','temperature'].includes(draft.tab))throw Error('收藏内容超出有效范围。');
  const fields={name,brightness:draft.brightness,color:draft.color,temperaturePercent:draft.temperaturePercent,tab:draft.tab};
  if(!draft.id)return{operation:'create',...fields};
  if(!draft.baseline||!/^[a-f0-9]{64}$/.test(draft.baseline)||!report.items.some(item=>item.id===draft.id))throw Error('收藏已变化，请重新打开。');
  return{operation:'edit',id:draft.id,baseline:draft.baseline,...fields};
}
export function favoriteMatch(report:LightFavoritesReport,change:LightFavoriteChange):boolean{
  if(change.operation==='delete')return!report.items.some(item=>item.id===change.id);
  const items=report.items.filter(item=>change.operation==='create'?item.name.trim()===change.name:item.id===change.id);
  return items.length===1&&validFavorite(items[0])&&items[0].name.trim()===change.name&&items[0].brightness===change.brightness&&items[0].color===change.color&&items[0].temperaturePercent===change.temperaturePercent&&items[0].tab===change.tab;
}
/** SDK10202 sends brightness + one color property, never on or mode. Values
 * must also satisfy the actual descriptor; a favorite cannot fabricate access. */
export function favoriteWrites(item:LightFavorite,properties:Property[],online:boolean,busy:boolean):{property:Property;value:number}[]{
  if(!validFavorite(item))throw Error(item.reason??'收藏内容不可用。');
  const targets:[string,number][]=[['brightness',item.brightness!],[item.tab==='color'?'color':'color-temperature',item.tab==='color'?item.color!:2700+item.temperaturePercent!*38]];
  return targets.map(([name,value])=>{
    const matches=properties.filter(p=>p.siid===2&&p.piid===(name==='brightness'?2:name==='color'?4:3)&&p.name===name),property=matches.length===1?matches[0]:undefined;
    const reason=controlReason(property,online,busy);if(!property||reason)throw Error(reason??'设备未提供该收藏需要的属性。');
    if(name==='color'&&rgbPropertyReason(property))throw Error(rgbPropertyReason(property));
    if(coercePropertyInput(property,String(value))!==value)throw Error('收藏参数不符合当前设备模型。');return{property,value};
  });
}

/** Exactly one mutation; uncertain results only initiate readonly confirmation. */
export class LightFavoriteOperation{
  phase:'sending'|'uncertain'|'confirmed'|'rejected'='sending';report:LightFavoritesReport;error?:AppError;
  readonly change:LightFavoriteChange;private alive=true;private started=false;private flight?:Promise<void>;
  constructor(change:LightFavoriteChange,report:LightFavoritesReport,private submit:(c:LightFavoriteChange)=>Promise<LightFavoriteResult>,private query:(c:LightFavoriteChange)=>Promise<LightFavoriteResult>,private changed:()=>void,private wait=(ms:number):Promise<void>=>new Promise(r=>setTimeout(r,ms))){this.change=structuredClone(change);this.report=structuredClone(report);}
  get pending():boolean{return this.phase==='sending'||this.phase==='uncertain';}
  cancel():void{this.alive=false;}
  private accept(result:LightFavoriteResult):void{
    if(!this.alive||!this.pending)return;
    if(result.report){if(result.report.did!==this.report.did||result.report.model!==this.report.model){this.phase='uncertain';return;}this.report=result.report;}
    if(result.status==='confirmed'&&result.report&&favoriteMatch(result.report,this.change)){this.phase='confirmed';this.error=undefined;}
    else if(result.status==='rejected'){this.phase='rejected';this.error={kind:'lightFavoriteRejected',message:result.message,retryable:true};}
    else{this.phase='uncertain';this.error=undefined;}
  }
  private failure(error:unknown,query=false):void{
    const e=error as AppError;if(!this.alive)return;
    if(!query&&['invalidInput','invalidValue','permissionDenied','unsupported','authExpired','staleContext','lightFavoriteConflict','unconfirmed','busy'].includes(e.kind)){this.phase='rejected';this.error=e;}else this.phase='uncertain';
  }
  async refresh():Promise<void>{
    if(!this.alive||!this.pending||this.phase==='sending')return;if(this.flight)return this.flight;
    const p=(async()=>{try{this.accept(await this.query(this.change));}catch(e){this.failure(e,true);}finally{this.flight=undefined;if(this.alive)this.changed();}})();this.flight=p;return p;
  }
  async start():Promise<void>{
    if(!this.alive||this.started)return;this.started=true;this.changed();try{this.accept(await this.submit(this.change));}catch(e){this.failure(e);}if(!this.alive)return;this.changed();
    for(const ms of[1000,2500,5000]){if(!this.alive||!this.pending)return;await this.wait(ms);if(!this.alive||!this.pending)return;await this.refresh();}
  }
}
