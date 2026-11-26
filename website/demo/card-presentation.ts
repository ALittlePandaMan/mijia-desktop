import configuration from './desktop/src-tauri/src/fixtures/home_card_presentations.json';
import {deviceChoiceLabel} from './desktop/src/device-labels';
import type {CardControl,Device,DevicePanel,HomeCardPresentation,Json,Property} from './desktop/src/types';

type Matcher={key:string;value:Json;enable_type?:string[];disable_type?:string[]};
type Item={cardType:number;prop_key?:string;desc_sort?:string[];param_delta?:number;prop?:{prop_unit?:string};operation?:{disable_status?:Matcher[];enable_status?:Matcher[]}[]};
type Entry={types:string[];card_items:Item[];card_instance:{instance_type:number;card_layout:number[][]}[]};
const entries=configuration as unknown as Entry[];
const kinds:Record<number,CardControl['kind']>={1:'toggle',3:'choices',4:'stepper',5:'slider'};
const labels:Record<number,string>={1:'电源',3:'模式',4:'目标温度',5:'亮度'};
const normalize=(text:string)=>text.toLowerCase().replace(/[\s_.-]/g,'');

/** Bind the desktop's original templates only to the three simulated families
 * present in this demo. No cloud inventory, sessions, or device commands. */
export function demoCardPresentation(device:Device,panel:DevicePanel):HomeCardPresentation|undefined{
 const category=device.specType?.split(':')[3];if(!category||!['light','air-conditioner','curtain'].includes(category))return;
 const entry=entries.find(row=>row.types.includes(category)),layout=entry?.card_instance.find(row=>row.instance_type===9)?.card_layout;
 if(!entry||!layout)return;
 const resolve=(selector:string):Property|undefined=>{const [kind,service,name]=selector.split(':');return kind==='p'?panel.services.find(s=>s.name===service)?.properties.find(p=>p.name===name):undefined;};
 const controls:CardControl[]=[];const rows:string[][]=[];
 for(const row of layout){const ids:string[]=[];for(const index of row){
  const item=entry.card_items[index],p=item?.prop_key&&resolve(item.prop_key),kind=item&&kinds[item.cardType];
  if(!p||!kind||!p.access.includes('write'))return;
  const matches=(matcher:Matcher)=>{if(matcher.disable_type?.includes(device.specType??'')||matcher.enable_type&&!matcher.enable_type.includes(device.specType??''))return false;const dependency=resolve(matcher.key);if(!dependency||dependency.code!==0)return true;const semantic=dependency.valueList?.find(v=>v.value===dependency.value)?.description;return dependency.value===matcher.value||typeof matcher.value==='string'&&!!semantic&&normalize(semantic)===normalize(matcher.value);};
  const gated=item.operation?.some(op=>op.disable_status?.some(matches)||op.enable_status?.some(m=>!matches(m)))??false;
  const id=`${p.siid}:${p.piid}`,list=p.valueList??[],options=(item.desc_sort?item.desc_sort.flatMap(name=>list.filter(option=>normalize(option.description)===normalize(name))):list).map(option=>({label:deviceChoiceLabel(option.description),value:option.value}));
  const range=p.valueRange?{min:p.valueRange[0],max:p.valueRange[1],step:Math.max(p.valueRange[2],item.param_delta??p.valueRange[2]),unit:item.prop?.prop_unit??(kind==='stepper'?'℃':'%')}:null;
  const enabled=device.online&&!device.sharedReadOnly&&!gated&&p.code===0&&!p.unsupportedReason;
  controls.push({id,fieldId:id,kind,label:labels[item.cardType],value:p.value??null,enabled,reason:enabled?null:'当前状态不允许此操作',options,range});ids.push(id);
 }rows.push(ids);}
 const headerControl=rows[0]?.length===1&&controls.find(c=>c.id===rows[0][0])?.kind==='toggle'?rows.shift()![0]:null;
 return {did:device.did,templateId:'demo-desktop-'+category,revision:1,headerControl,rows,controls};
}
