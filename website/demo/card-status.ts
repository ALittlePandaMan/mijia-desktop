import type {Device,DevicePanel,HomeCardStatus,Json,Property,Service} from './desktop/src/types';
import {deviceChoiceLabel,devicePropertyLabel} from './desktop/src/device-labels';
import configuration from './card-status-config.json';

// Browser adapter for desktop home_card_status.rs. Only simulated panel values
// enter this code; public card layouts decide which readings may be displayed.
type Matcher={key:string;value:Json;enable_type?:string[];disable_type?:string[]};
type Operation={enable_status?:Matcher[];disable_status?:Matcher[];set_prop?:string;action?:string};
type Item={cardType:number;prop_key?:string;grid_extra_key?:string;operation?:Operation[];grid_operation?:Operation[];access?:string[];prop_desc?:string[];service_desc?:string[];prop_name_ignore?:boolean;prop?:{format?:string;prop_unit?:string}};
type Layout={instance_type:number;card_layout:number[][];type?:string[];disable_type?:string[];min_support_version?:number;abtest?:string};
type Entry={disable_type?:string[];card_items:Item[];card_instance:Layout[]};
type Node={property:Property;service:Service};
type Bound={item:Item;nodes:Node[]};
const entries=configuration.entries as unknown as Record<string,Entry>;
const normalize=(text:string)=>text.trim().toLowerCase().replace(/[\s_.-]+/g,'');
const operations=(item:Item)=>item.grid_operation??item.operation??[];
const readable=(p:Property)=>p.access.includes('read')&&p.code===0&&p.value!==null&&p.value!==undefined&&!p.unsupportedReason;
const key=(p:Property)=>`${p.siid}:${p.piid}`;

function select(nodes:Node[],selector:string):Node[]{
 const [kind,service,name,...extra]=selector.split(':');if(extra.length||!service||!name)return [];
 return nodes.filter(node=>kind==='p'?node.service.name===service&&node.property.name===name:kind==='pi'?node.property.siid===Number(service)&&node.property.piid===Number(name):false);
}
function bind(entry:Entry,nodes:Node[],urn:string):Bound[]{
 if(entry.disable_type?.includes(urn))return [];
 for(const type of [6,5])for(const layout of entry.card_instance){
  if(layout.instance_type!==type||type===6&&!layout.type?.includes(urn)||layout.disable_type?.includes(urn)||(layout.min_support_version??0)>20||layout.abtest)continue;
  const indexes=layout.card_layout.flat(),bound=new Map<number,Node[][]>();let valid=indexes.length>0&&indexes.length<=64;
  for(const index of new Set(indexes)){
   const item=entry.card_items[index],required=indexes.filter(value=>value===index).length;
   const selector=item?.grid_extra_key??item?.prop_key;if(!selector){valid=false;break;}
   const selectors=new Set(selector.split(','));for(const op of operations(item)){const target=op.action??op.set_prop;if(target)selectors.add(target);}
   const rows=Array.from({length:required},()=>[] as Node[]);
   for(const selector of selectors){
    let candidates=select(nodes,selector).filter(node=>(item.access??[]).every(access=>node.property.access.includes(access)));
    if(candidates.length>required)candidates=candidates.filter(node=>(!item.prop_desc||item.prop_desc.some(text=>normalize(text)===normalize(node.property.description)))&&(!item.service_desc||item.service_desc.some(text=>normalize(text)===normalize(node.service.description))));
    if(candidates.length!==required){valid=false;break;}
    candidates.forEach((node,i)=>rows[i].push(node));
   }
   if(!valid)break;bound.set(index,rows);
  }
  if(valid){const used=new Map<number,number>();return indexes.map(index=>{const position=used.get(index)??0;used.set(index,position+1);return {item:entry.card_items[index],nodes:bound.get(index)![position]};});}
 }
 return [];
}

function enabled(item:Item,primary:Node,nodes:Node[],urn:string):boolean{
 const applies=(matcher:Matcher)=>!matcher.disable_type?.includes(urn)&&(!matcher.enable_type||matcher.enable_type.includes(urn));
 const dependency=(matcher:Matcher)=>{const all=select(nodes,matcher.key),local=all.filter(node=>node.property.siid===primary.property.siid);return {all,node:local.length===1?local[0]:all.length===1?all[0]:undefined};};
 const ops=operations(item),matchers=ops.flatMap(op=>[...(op.enable_status??[]),...(op.disable_status??[])]).filter(applies);
 const dependencies=matchers.map(dependency);
 if(dependencies.some(({all,node})=>all.length>0&&!node||node&&!node.property.access.includes('read')))return false;
 if(!dependencies.some(({node})=>node))return true;
 const matches=(matcher:Matcher):boolean|undefined=>{
  if(!applies(matcher))return false;
  const node=dependency(matcher).node;if(!node)return false;const p=node.property;if(!readable(p))return undefined;
  const actual=String(p.valueList?.find(choice=>choice.value===p.value)?.description??p.value).toLowerCase(),desired=String(matcher.value).toLowerCase();
  return actual===desired||typeof matcher.value==='boolean'&&actual===(matcher.value?'1':'0');
 };
 return ops.every(op=>{
  const enables=(op.enable_status??[]).map(matches);if(enables.includes(true))return true;
  const disables=(op.disable_status??[]).map(matches);if(enables.includes(undefined)||disables.includes(undefined))return false;
  return op.disable_status?!disables.includes(true):!op.enable_status;
 });
}

function numeric(item:Item,p:Property):string|undefined{
 let value=p.value;if(typeof value!=='number'||!Number.isFinite(value)||/^(u?int)/.test(p.format)&&!Number.isInteger(value))return;
 if(p.valueRange&&(value<p.valueRange[0]||value>p.valueRange[1]))return;
 if(p.name==='brightness'&&p.unit==='percentage'&&p.valueRange&&p.valueRange[1]>p.valueRange[0])value=Math.min(100,Math.max(1,Math.round((value-p.valueRange[0])/(p.valueRange[1]-p.valueRange[0])*99+1)));
 const unit=p.unit&&p.unit!=='none'?p.unit:item.prop?.prop_unit??'',units:Record<string,string>={celsius:'℃',percentage:'%',kelvin:'K',arcdegrees:'°',seconds:'秒',minutes:'分钟'};
 const format=/^%\.(\d)f$/.exec(item.prop?.format??''),precision=format?Number(format[1]):undefined;
 return `${precision!==undefined&&precision<=4?value.toFixed(precision):value}${units[unit]??unit}`;
}
function render(bound:Bound,nodes:Node[],urn:string):string|undefined{
 const {item,nodes:[primary]}=bound,p=primary.property;
 if(!readable(p)||!enabled(item,primary,nodes,urn))return;
 const curtain=urn.split(':')[3]==='curtain'&&p.name==='current-position';let text:string|undefined;
 if(curtain){const value=p.value;if(typeof value!=='number'||value<0||value>100)return;text=value<=2?'全关':value>=98?'全开':`打开${Math.round(value)}%`;}
 else if(item.cardType===8){
  if(p.valueList){const choice=p.valueList.find(choice=>choice.value===p.value);if(!choice)return;text=deviceChoiceLabel(choice.description,choice.description);}
  else if(p.format==='bool'){if(typeof p.value!=='boolean')return;text=p.value?'开':'关';}
  else text=numeric(item,p);
 }else text=numeric(item,p);
 if(text===undefined)return;
 return item.prop_name_ignore||item.cardType===3?text:`${devicePropertyLabel(p,p.description)} ${text}`;
}

export function demoCardStatus(device:Device,panel:DevicePanel):HomeCardStatus|undefined{
 if(!device.online||device.unsupportedReason)return;
 const nodes=panel.services.flatMap(service=>service.properties.map(property=>({service,property})));
 const switches=nodes.filter(node=>node.service.name==='switch'&&node.property.name==='on'&&node.property.format==='bool'&&node.property.access.includes('read'));
 if(switches.some(node=>readable(node.property)&&typeof node.property.value==='boolean'))return {did:device.did,text:switches.map(({property:p})=>readable(p)&&typeof p.value==='boolean'?p.value?'开':'关':'未读取').join(' ')};
 const urn=panel.specType??device.specType??'',entry=entries[urn.split(':')[3]];if(!entry)return;
 const seen=new Set<string>(),texts:string[]=[];
 for(const bound of bind(entry,nodes,urn)){
  const p=bound.nodes[0].property;
  if(![7,8,17].includes(bound.item.cardType)&&!(bound.item.cardType===3&&urn.split(':')[3]==='curtain'&&p.name==='current-position'))continue;
  const text=render(bound,nodes,urn);if(text&&!seen.has(key(p))){seen.add(key(p));texts.push(text);}
 }
 return texts.length?{did:device.did,text:texts.join(' ')}:undefined;
}
