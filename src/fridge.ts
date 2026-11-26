import type {AppError,ControlResult,DeviceContext,DevicePanel,Property} from './types';
import {ReportOperations,panelReadback,panelDisplay} from './report-operations';
export const fridgeModel='midjd.fridge.f01';
export type FridgeField='mode'|'refrigerating'|'freezing'|'maternal';
export interface FridgeChange {field:FridgeField;expected:number;value:number}
const roles={mode:['fridge',undefined,'mode','uint8'],refrigerating:['fridge-chamber','Refrigerating Chamber','target-temperature','int8'],freezing:['fridge-chamber','Freezing Chamber','target-temperature','int8'],maternal:['fridge-chamber','Maternal-infant Chamber','mode','uint8']}as const;
export function fridgeProperty(panel:DevicePanel,field:FridgeField):Property|undefined{
 if(panel.model!==fridgeModel||panel.unsupportedReason||!panel.specType?.startsWith('urn:miot-spec-v2:device:fridge:'))return;
 const[service,description,name,format]=roles[field],rows=panel.services.filter(s=>s.name===service&&(!description||s.description===description)).flatMap(s=>s.properties.filter(p=>p.siid===s.siid&&p.name===name&&p.format===format&&!p.unsupportedReason));return rows.length===1?rows[0]:undefined;
}
export function fridgeProfile(panel:DevicePanel):boolean{return !!fridgeProperty(panel,'mode')&&!!fridgeProperty(panel,'refrigerating')&&!!fridgeProperty(panel,'freezing');}
export function fridgeCurrent(panel:DevicePanel,field:FridgeField):number|undefined{const p=fridgeProperty(panel,field);return p?.code===0&&p.access.includes('read')&&typeof p.value==='number'&&Number.isInteger(p.value)?p.value:undefined;}
const mainLabels:Record<string,string>={'Smart':'智能','Quick Cooling':'速冷','Quick Frozen':'速冻'};
const maternalLabels:Record<string,string>={'Premium':'臻品','Maternal-infant Products':'母婴','Zero Degree':'零度'};
export function fridgeChoices(panel:DevicePanel,field:'mode'|'maternal'):{value:number;label:string;meaning:string}[]{const p=fridgeProperty(panel,field),labels=field==='mode'?mainLabels:maternalLabels;return Object.entries(labels).flatMap(([meaning,label])=>{const values=p?.valueList?.filter(v=>v.description===meaning&&typeof v.value==='number'&&Number.isInteger(v.value));return values?.length===1?[{value:values[0].value as number,label,meaning}]:[];});}
export function fridgeRange(panel:DevicePanel,field:'refrigerating'|'freezing'):[number,number,number]|undefined{const p=fridgeProperty(panel,field),r=p?.valueRange;if(p?.valueList||!r||r.length!==3||!r.every(Number.isFinite)||!r.every(Number.isInteger)||r[0]>=r[1]||r[2]<=0)return;return r as[number,number,number];}
export function fridgeReason(panel:DevicePanel,field:FridgeField):string|undefined{const p=fridgeProperty(panel,field);if(!p?.access.includes('write')||fridgeCurrent(panel,field)===undefined)return'请先读取有效的当前设置。';if((field==='refrigerating'||field==='freezing')&&!fridgeRange(panel,field))return'此温区未提供有效范围。';}
const identity=(c:DeviceContext)=>JSON.stringify([c.homeId,c.generation,c.did]);
export function projectFridge(panel:DevicePanel,change:FridgeChange):DevicePanel{
 const binding=fridgeProperty(panel,change.field);if(!binding)return panel;
 const patch=new Map<string,number>([[`${binding.siid}/${binding.piid}`,change.value]]);
 if(change.field==='mode'){
  const choice=fridgeChoices(panel,'mode').find(c=>c.value===change.value);
  const set=(field:'refrigerating'|'freezing',value:number|undefined)=>{const p=fridgeProperty(panel,field);if(p&&value!==undefined)patch.set(`${p.siid}/${p.piid}`,value);};
  if(choice?.meaning==='Smart'){set('refrigerating',5);set('freezing',-18);}if(choice?.meaning==='Quick Cooling')set('refrigerating',fridgeRange(panel,'refrigerating')?.[0]);if(choice?.meaning==='Quick Frozen')set('freezing',fridgeRange(panel,'freezing')?.[0]);
 }
 return{...panel,services:panel.services.map(s=>({...s,properties:s.properties.map(p=>patch.has(`${p.siid}/${p.piid}`)?{...p,value:patch.get(`${p.siid}/${p.piid}`)!}:p)}))};
}
export class FridgeCommands{
 private state:ReportOperations<DevicePanel,FridgeChange>;
 private context='';
 constructor(transport:{change:(c:DeviceContext,v:FridgeChange)=>Promise<ControlResult>;read:(c:DeviceContext)=>Promise<DevicePanel>},changed:()=>void,accept:(c:DeviceContext,p:DevicePanel)=>void,failed:(e:AppError)=>void){
  this.state=new ReportOperations({
   read:transport.read,accepted:accept,
   send:async(c,report,change)=>{
    const expected=fridgeCurrent(report,change.field);
    if(expected===undefined)throw {kind:'unavailable',message:'当前设置尚未读取。'};
    const result=await transport.change(c,{...change,expected});
    return {report:result.panel,confirmed:result.verified};
   },
   validate:(panel,c)=>{if(panel.did!==c.did||!fridgeProfile(panel))throw Error('回读与当前冰箱不匹配。');},
   key:change=>change.field,
   supersedes:change=>change.field==='mode'?['refrigerating','freezing']:change.field==='maternal'?[]:['mode'],
   project:projectFridge,
   verifyRead:(report,change)=>fridgeCurrent(report,change.field)!==undefined,
   matches:(report,change)=>fridgeCurrent(report,change.field)===change.value,
  },changed,failed);
 }
 get version(){return this.state.version;}
 get pending(){return this.state.pending;}
 get blocked(){return !!this.state.error;}
 get target(){return this.state.intents.at(-1);}
 bind(c:DeviceContext,scope:string){
  this.context=identity(c);
  if(this.state.bind(c,scope)&&this.state.actual)void this.state.read();
 }
 close(){this.context='';this.state.close();}
 display(panel:DevicePanel){
  if(!this.state.actual)this.state.seed(panelReadback(panel));
  return panelDisplay(this.state.report??panel,panel);
 }
 async change(c:DeviceContext,change:FridgeChange):Promise<boolean>{
  if(this.blocked||identity(c)!==this.context||!this.state.actual)return false;
  void this.state.change({...change});return true;
 }
}
