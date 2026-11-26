import type {HomeCardStatus,HomeCardStatusField,Json,HomeCardEntry} from './types';
import type {DisplayIntent} from './local-display-intent';
import {missingReadingText} from './logic';
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function valid(field:HomeCardStatusField,value:Json):boolean{
 const f=field.format;if(f.kind==='raw')return typeof value==='boolean'||typeof value==='number'||typeof value==='string';
 if(f.kind==='boolean')return typeof value==='boolean';if(f.kind==='enum')return f.options.some(o=>equal(o.value,value));
 return typeof value==='number'&&Number.isFinite(value)&&(!f.integral||Number.isInteger(value))&&(f.min==null||value>=f.min)&&(f.max==null||value<=f.max);
}
function formatted(field:HomeCardStatusField,value:Json|undefined):string{
 if(value==null||!valid(field,value))return '';const f=field.format;let text='';
 if(f.kind==='boolean')text=value?'开':'关';
 else if(f.kind==='enum')text=f.options.find(o=>equal(o.value,value))?.text??'';
 else if(f.kind==='position'){const n=value as number;text=n<=2?'全关':n>=98?'全开':`打开${Math.round(n)}%`;}
 else if(f.kind==='number'){let n=value as number;if(f.percentage&&f.min!=null&&f.max!=null)n=Math.max(1,Math.min(100,Math.round((n-f.min)/(f.max-f.min)*99+1)));text=(f.precision==null?String(n):n.toFixed(f.precision))+f.unit;}
 return text&&f.label?`${f.label} ${text}`:text;
}
function gateAllows(field:HomeCardStatusField,values:Map<string,Json|undefined>):boolean{
 for(const g of field.gates){if(g.unknown)return false;const match=(m:{field:string;value:Json|null})=>m.value!=null&&equal(values.get(m.field),m.value);if(g.enable?.some(match))continue;if(g.disable?.some(match))return false;if(g.enable&&!g.disable)return false;
  if([...(g.enable??[]),...(g.disable??[])].some(m=>m.field&&values.get(m.field)==null))return false;
 }return true;
}
/** All captions are projected from authenticated format metadata and active intents.
 * No parsing of localized status strings, and no mutation of confirmed snapshots. */
export function projectCardStatus(status:HomeCardStatus|undefined,intents:readonly DisplayIntent[]):string|undefined{
 if(!status)return;const fields=status.fields;if(!fields?.length)return status.text;
 const hasMissingSwitch=(f:HomeCardStatusField)=>f.visible&&f.format.kind==='boolean'&&f.value==null&&!!f.text;
 const fieldText=(f:HomeCardStatusField)=>hasMissingSwitch(f)?missingReadingText:f.text;
 const baseline=()=>status.text&&fields.some(hasMissingSwitch)
  ?fields.filter(f=>f.visible).map(fieldText).filter(Boolean).join(' '):status.text;
 if(!intents.length)return baseline();
 const values=new Map<string,Json|undefined>(fields.map(f=>[f.id,f.value??undefined])),changed=new Set<string>();
 for(const i of [...intents].sort((a,b)=>a.order-b.order)){const f=fields.find(f=>f.id===i.fieldId);if(f&&(f.writable||i.effect)&&valid(f,i.value)){values.set(f.id,i.value);changed.add(f.id);}}
 if(!changed.size)return baseline();
 return fields.filter(f=>f.visible).map(f=>{const affected=changed.has(f.id)||f.gates.some(g=>[...(g.enable??[]),...(g.disable??[])].some(m=>changed.has(m.field)));return affected?(gateAllows(f,values)?formatted(f,values.get(f.id)):''):fieldText(f);}).filter(Boolean).join(' ');
}
/** Cache fallback remains display-only and must not erase the last live value. */
export function retainConfirmedStatus(previous:HomeCardStatus|undefined,incoming:HomeCardStatus):HomeCardStatus{
 if(previous?.revision!=null&&incoming.revision!=null&&incoming.revision<previous.revision)return previous;
 if(!incoming.fields?.length)return incoming;
 const now=Date.now(),readAt=incoming.readStartedAt||now;
 let retained=false;
 const fields=incoming.fields.map(f=>{
  const old=previous?.fields?.find(p=>p.id===f.id);
  if(f.live){const liveAt=f.liveAt??(previous?.revision===incoming.revision?old?.liveAt:undefined)??readAt;return f.liveAt===liveAt?f:{...f,liveAt};}
  const liveAt=old?.liveAt??(old?.live?previous?.readStartedAt:undefined);
  if(!old||liveAt==null||now-liveAt>=30000)return f;
  retained=true;return {...f,value:old.value,text:old.text,liveAt};
 });
 if(fields.every((f,i)=>f===incoming.fields![i]))return incoming;
 if(!retained)return {...incoming,fields};
 const values=new Map<string,Json|undefined>(fields.map(f=>[f.id,f.value??undefined]));
 return {...incoming,fields,text:fields.filter(f=>f.visible&&gateAllows(f,values)).map(f=>f.text||formatted(f,f.value??undefined)).filter(Boolean).join(' ')};
}
export function confirmGroupCaption(status:HomeCardStatus|undefined,card:HomeCardEntry):HomeCardStatus|undefined{
 const group=card.group;
 if(!group||!status?.fields?.length||(status.revision??0)>group.revision)return status;
 const values=new Map(group.members.map(member=>[member.id,member.selected]));
 let changed=false;
 const fields=status.fields.map(field=>{
  const value=values.get(field.id);if(typeof value!=='boolean'||field.format.kind!=='boolean')return field;
  changed=true;return {...field,value,text:formatted(field,value),live:true};
 });
 if(!changed)return status;
 return {...status,revision:group.revision,readStartedAt:group.readStartedAt,fields,text:fields.filter(field=>field.visible).map(field=>field.text).filter(Boolean).join(' ')};
}
