import type {AppError,DeviceContext,RouterReport} from './types';
import {normalizeError,sameContext} from './logic';
export const routerModel='xiaomi.router.rn02';
export function routerSpeed(value:number|null|undefined):{value:string;unit:string}{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)return{value:'--',unit:''};
 return value>=1000000?{value:(value/1000000).toFixed(0),unit:'MB/S'}:{value:(value/1000).toFixed(0),unit:'KB/S'};
}
export class RouterState {
 report?:RouterReport;error?:AppError;loading=false;
 private epoch=0;private context?:DeviceContext;private scope='';private timer?:ReturnType<typeof setTimeout>;
 constructor(private read:(context:DeviceContext)=>Promise<RouterReport>,private changed:()=>void,private failed:(error:AppError)=>void){}
 bind(context:DeviceContext,scope:string):void{if(!sameContext(context,this.context)||scope!==this.scope){this.close();this.context={...context};this.scope=scope;}}
 close():void{++this.epoch;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.context=undefined;this.report=undefined;this.error=undefined;this.loading=false;}
 async load(context:DeviceContext):Promise<void>{
  if(this.loading||!sameContext(context,this.context))return;
  if(this.timer)clearTimeout(this.timer);this.timer=undefined;
  const epoch=this.epoch,current=()=>epoch===this.epoch&&sameContext(context,this.context);
  this.loading=true;this.changed();
  try{const report=await this.read({...context});if(!current())return;if(report.did!==context.did||report.model!==routerModel)throw{kind:'protocol',message:'路由器状态与当前设备不匹配。',retryable:false};this.report=report;this.error=undefined;}
  catch(error){if(!current())return;this.error=normalizeError(error);this.failed(this.error);}
  finally{if(current()){this.loading=false;this.changed();if(this.error?.kind!=='authExpired')this.timer=setTimeout(()=>{this.timer=undefined;void this.load(context);},10000);}}
 }
}
