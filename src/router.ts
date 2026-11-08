import type {AppError,DeviceContext,RouterClient,RouterReport} from './types';
import {normalizeError,sameContext} from './logic';
export const routerModel='xiaomi.router.rn02';
export type RouterTab='online'|'offline'|'filter';
export interface RouterView {page:'optimize'|'speed'|'home'|'clients'|'client'|'common'|'classify'|'qos'|'networkTools'|'safety'|'access'|'filterList'|'blockRecords'|'website'|'urlBlack'|'urlWhite'|'family'|'settings'|'indicator'|'wifi'|'advanced'|'internet'|'ports'|'ipv6';tab:RouterTab;mac?:string;accessBack?:'client'|'safety'|'clients'}
export function routerSpeed(value:number|null|undefined):{value:string;unit:string}{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)return{value:'--',unit:''};
 return value>=1000000?{value:(value/1000000).toFixed(0),unit:'MB/S'}:{value:(value/1000).toFixed(0),unit:'KB/S'};
}
export function routerClients(report:RouterReport|undefined,tab:RouterTab):RouterClient[]|null {
 if(!report)return null;
 if(tab==='filter')return report.filteredClients;
 return report.clients?.filter(client=>!client.blocked&&client.online===(tab==='online'))??null;
}
export function connectionLabel(type:number|null):string {
 return ({1:'2.4GHz接入',2:'5GHz接入',3:'访客网络接入',4:'有线接入',5:'Zigbee接入',6:'5GHz游戏网络接入',7:'5GHz接入'} as Record<number,string>)[type??-1]??'连接方式未知';
}
/** rn02 plugin 11162 + 10370: show only actual, applicable quality fields. */
export function routerClientQuality(client:RouterClient):[string,string][] {
 const rows:[string,string][]=[];
 if(client.connection===4){if(client.port&&client.portSpeed)rows.push(['有线端口及协商速率',`${client.port}-${client.portSpeed}`]);return rows;}
 if(![1,2,3,6,7].includes(client.connection??-1))return rows;
 if(client.wifiProtocol)rows.push(['无线网络协议',client.wifiProtocol]);
 if(client.txRate)rows.push(['发送速率',client.txRate]);
 if(client.rxRate)rows.push(['接收速率',client.rxRate]);
 const signal=client.signal;
 if(client.online===true&&typeof signal==='number'&&Number.isInteger(signal)&&signal>=-127&&signal<0){const strength=signal< -70?'弱':signal< -55?'中':'强';rows.push(['信号强度',`${strength}(${signal}dB)`]);}
 return rows;
}
export function routerEventTime(seconds:number|null,now=Date.now()):string {
 if(!seconds||!Number.isSafeInteger(seconds)||seconds<0)return'';
 const duration=now/1000-seconds;if(duration<0)return'';
 if(duration<3600)return duration<60?'刚刚':`${Math.floor(duration/60)}分钟前`;
 if(duration<86400)return`${Math.floor(duration/3600)}小时前`;
 const date=new Date(seconds*1000);if(!Number.isFinite(date.getTime()))return'';return`${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}
export class RouterState {
 report?:RouterReport;error?:AppError;loading=false;
 private epoch=0;private context?:DeviceContext;private scope='';private timer?:ReturnType<typeof setTimeout>;
 constructor(private read:(context:DeviceContext)=>Promise<RouterReport>,private changed:()=>void,private failed:(error:AppError)=>void){}
 bind(context:DeviceContext,scope:string):void{if(!sameContext(context,this.context)||scope!==this.scope){this.close();this.context={...context};this.scope=scope;}}
 close():void{++this.epoch;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.context=undefined;this.report=undefined;this.error=undefined;this.loading=false;}
 applyClient(context:DeviceContext,client:RouterClient):void{
  if(!sameContext(context,this.context)||!this.report)return;
  const update=(items:RouterClient[]|null)=>items?.map(item=>item.mac.toLowerCase()===client.mac.toLowerCase()?{...item,name:client.name}:item)??null;
  this.report={...this.report,clients:update(this.report.clients),filteredClients:update(this.report.filteredClients)};
  ++this.epoch;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.loading=false;this.changed();void this.load(context);
 }
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
