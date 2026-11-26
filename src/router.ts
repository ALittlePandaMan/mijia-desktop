import type {AppError,Device,DeviceContext,DevicePanel,RouterReport} from './types';
import {normalizeError,sameContext} from './logic';
import {capabilityCategory} from './device-capabilities';
import {numericValue} from './panel-layout';
export const routerModel='xiaomi.router.rn02';
const rateUnits:ReadonlyMap<string,number>=new Map([['b/s',1],['byte/s',1],['kbyte/s',1000],['mbyte/s',1000000]]);
export function routerPageEligible(device:Device,panel?:DevicePanel):boolean {
 const type=panel?.did===device.did&&panel.model===device.model?panel.specType:undefined;
 return capabilityCategory(type??device.specType)==='router'||/^[^.]+\.router\.[^.]+$/.test(device.model);
}

export function routerPublicSpeed(panel:DevicePanel|undefined,direction:'up'|'down'):number|undefined {
 if(!panel||panel.unsupportedReason)return;
 const routers=panel.services.filter(service=>service.name==='router');
 if(routers.length!==1||panel.services.filter(service=>service.siid===routers[0].siid).length!==1)return;
 const service=routers[0];
 const name=direction==='up'?'upload-speed':'download-speed';
 const matches=service.properties.filter(property=>property.name===name);
 if(matches.length!==1)return;
 const property=matches[0];
 if(property.siid!==service.siid||property.unsupportedReason||service.properties.filter(p=>p.piid===property.piid).length!==1||
   !/^(u?int(8|16|32|64)|float|double)$/.test(property.format))return;
 const multiplier=rateUnits.get(property.unit?.toLowerCase()??'');
 const value=numericValue(property);
 if(multiplier===undefined||value===undefined||!Number.isFinite(value)||value<0)return;
 const bytes=Math.round(value*multiplier);
 return Number.isSafeInteger(bytes)?bytes:undefined;
}

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
