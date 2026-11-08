import type {AppError,DeviceContext,RouterClient} from './types';
import {normalizeError,sameContext} from './logic';

export interface ClientNameChange {mac:string;expected:string;name:string}
export interface ClientNameOutcome {status:'confirmed'|'uncertain';message:string;client:RouterClient|null}
interface Transport {save:(context:DeviceContext,change:ClientNameChange)=>Promise<ClientNameOutcome>;confirm:(context:DeviceContext,change:ClientNameChange)=>Promise<ClientNameOutcome>}
export function validClientName(name:string):boolean{return !!name.trim()&&name.length<=24&&!/[\u0000-\u001f\u007f-\u009f]/u.test(name);}
export class RouterClientNameState {
 modalOpen=false;draft='';message='';pending=false;blocked=false;
 private epoch=0;private context?:DeviceContext;private scope='';private mac='';private expected='';private timer?:ReturnType<typeof setTimeout>;
 private unresolved=new Map<string,ClientNameChange>();
 constructor(private api:Transport,private changed:()=>void,private failed:(error:AppError)=>void,private accept:(context:DeviceContext,client:RouterClient)=>void){}
 private key():string{return JSON.stringify([this.scope,this.context?.homeId,this.context?.did,this.mac.toLowerCase()]);}
 bind(context:DeviceContext,scope:string,client:RouterClient):void{
  if(!sameContext(context,this.context)||scope!==this.scope||client.mac.toLowerCase()!==this.mac.toLowerCase()){
   this.close();this.context={...context};this.scope=scope;this.mac=client.mac;this.expected=client.name;
   const change=this.unresolved.get(this.key());this.blocked=!!change;if(change){this.message='名称修改尚未确认，正在查询实际状态。';this.schedule(context);}
  }else if(!this.modalOpen&&!this.blocked)this.expected=client.name;
 }
 close():void{++this.epoch;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.context=undefined;this.modalOpen=false;this.draft='';this.message='';this.pending=false;this.blocked=false;this.mac='';this.expected='';}
 reset():void{this.close();this.unresolved.clear();}
 open():void{if(!this.context||this.blocked||this.pending)return;this.draft=this.expected;this.message='';this.modalOpen=true;this.changed();}
 cancel():void{if(this.pending)return;this.modalOpen=false;this.draft='';this.message='';this.changed();}
 async save():Promise<void>{
  if(!this.context||!this.modalOpen||this.pending||this.blocked)return;
  if(!validClientName(this.draft)){this.message='请输入不超过 24 个字符的设备名称。';this.changed();return;}
  if(this.draft===this.expected){this.cancel();return;}
  const change={mac:this.mac,expected:this.expected,name:this.draft},context={...this.context};this.unresolved.set(this.key(),change);await this.submit(context,change,false);
 }
 private async submit(context:DeviceContext,change:ClientNameChange,readOnly:boolean):Promise<void>{
  const epoch=this.epoch,key=this.key(),current=()=>epoch===this.epoch&&sameContext(context,this.context);this.pending=true;this.blocked=true;this.changed();
  try{
   const result=await(readOnly?this.api.confirm(context,change):this.api.save(context,change));if(!current())return;
   this.message=result.message;
   if(result.status==='confirmed'&&result.client?.mac.toLowerCase()===change.mac.toLowerCase()&&result.client.name===change.name){
    this.unresolved.delete(key);this.blocked=false;this.modalOpen=false;this.draft='';this.expected=result.client.name;this.accept(context,result.client);return;
   }
   this.message='名称修改尚未回读确认，只会继续查询，不会重复发送。';
  }catch(e){if(!current())return;const error=normalizeError(e);this.failed(error);this.message=error.message;
   if(!readOnly&&!['network','protocol','busy','staleContext','offline'].includes(error.kind)){this.unresolved.delete(key);this.blocked=false;}
  }finally{if(current()){this.pending=false;this.changed();if(this.unresolved.has(key))this.schedule(context);}}
 }
 private schedule(context:DeviceContext):void{if(this.timer)clearTimeout(this.timer);const epoch=this.epoch;this.timer=setTimeout(()=>{this.timer=undefined;const change=this.unresolved.get(this.key());if(epoch===this.epoch&&sameContext(context,this.context)&&change&&!this.pending)void this.submit(context,change,true);},5000);}
}
