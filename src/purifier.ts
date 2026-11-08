import type {AppError,ControlResult,DeviceContext,DevicePanel} from './types';
export interface PurifierCup {id:number;volumeMl:number}
export interface PurifierSnapshot {status:'idle'|'busy'|'waiting'|'unknown';tds:number|null;temperature:number|null;fault:number|null;cups:PurifierCup[];cupSource:string|null;cupError:string|null;canEditCups:boolean;editReason:string|null;filters:{siid:number;name:string;description:string;percent:number|null;days:number|null;antiFake:boolean|null}[]}
export const cupLabel=(ml:number):string=>ml<1000?`${ml}ml`:`${ml/1000}L`;
export interface PurifierDraft {expected:string;cups:PurifierCup[];index:number;sort:boolean}
export interface PurifierView {page:'home'|'cup'|'sort'|'filter'|'functions'|'compatibility'|'pipeline'|'water-mode'|'dnd'|'guide'|'tds'|'statistics';filter:number;draft?:PurifierDraft;deleteIndex?:number;picker?:{liters:number;ml:number};confirm?:'leave'|'sort'|{delete:number};settingDialog?:{kind:'pipeline'}|{kind:'cup';selected:number}}
export const newPurifierView=():PurifierView=>({page:'home',filter:0});
export function cupDraft(snapshot:PurifierSnapshot,index:number,sort=false):PurifierDraft|undefined{
 if(!snapshot.canEditCups||snapshot.cupSource===null||index<0||index>snapshot.cups.length)return;
 const cups=snapshot.cups.map(c=>({...c}));
 if(!sort&&index===cups.length){const id=[1,2,3,4,5,6].find(id=>!cups.some(c=>c.id===id));if(!id)return;cups.push({id,volumeMl:800});}
 return{expected:snapshot.cupSource,cups,index,sort};
}
interface Transport {save:(context:DeviceContext,expected:string,cups:PurifierCup[])=>Promise<ControlResult>;read:(context:DeviceContext)=>Promise<DevicePanel>}
interface Receipt {pending:boolean;message:string}
const identity=(c:DeviceContext)=>JSON.stringify([c.homeId,c.generation,c.did]);
const error=(e:unknown):AppError=>e&&typeof e==='object'&&'message'in e?e as AppError:{kind:'unknown',message:'杯量保存结果暂未确认。',retryable:true};
/** Drafts never write. Exactly one save per explicit submit; an uncertain result
 * survives closing/reopening and only an explicit live read unlocks editing. */
export class PurifierCommands {
 private records=new Map<string,Receipt>();private key='';private context='';
 constructor(private transport:Transport,private changed:()=>void,private accept:(context:DeviceContext,panel:DevicePanel)=>void,private failed:(e:AppError)=>void){}
 bind(c:DeviceContext,scope:string):void{this.key=JSON.stringify([scope,c.homeId,c.did]);this.context=identity(c);}
 get pending():boolean{return !!this.records.get(this.key)?.pending;}
 get blocked():boolean{return this.records.has(this.key);}
 get message():string{return this.records.get(this.key)?.message??'';}
 async save(context:DeviceContext,draft:PurifierDraft):Promise<boolean>{
  if(this.blocked||identity(context)!==this.context)return false;
  const key=this.key,id=this.context,target=draft.cups.map(c=>({...c})),receipt={pending:true,message:''};this.records.set(key,receipt);this.changed();
  try{const result=await this.transport.save(context,draft.expected,target);
   if(result.panel.did!==context.did||result.panel.model!=='xiaomi.waterpuri.lx32')throw Error('设备标识不匹配，请重新读取。');
   if(this.records.get(key)!==receipt)return false;
   if(this.key===key&&this.context===id)this.accept(context,result.panel);
   if(result.verified&&JSON.stringify(result.panel.purifier?.cups)===JSON.stringify(target)){this.records.delete(key);return this.key===key&&this.context===id;}
   if(result.verified){receipt.message='回读杯量与目标不一致，请重新读取。';return false;}
   receipt.message=result.message;
  }catch(e){const failure=error(e);receipt.message=failure.message;if(this.key===key&&this.context===id)this.failed(failure);}
  finally{receipt.pending=false;this.changed();}return false;
 }
 async refresh(context:DeviceContext):Promise<boolean>{
  if(this.pending||this.context!==identity(context))return false;
  const key=this.key,id=this.context,receipt={pending:true,message:''};this.records.set(key,receipt);this.changed();
  try{const panel=await this.transport.read(context);
   if(panel.did!==context.did||panel.model!=='xiaomi.waterpuri.lx32'||panel.purifier?.cupSource===null||!panel.purifier?.cups.length)throw Error('未能读取当前杯量，请检查设备后重试。');
   this.records.delete(key);if(this.key===key&&this.context===id){this.accept(context,panel);return true;}
  }catch(e){receipt.message=error(e).message;if(this.key===key&&this.context===id)this.failed(error(e));}
  finally{receipt.pending=false;this.changed();}return false;
 }
}
