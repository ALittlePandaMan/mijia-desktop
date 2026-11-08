import qrcode from 'qrcode-generator';
import type {AppError,DeviceContext} from './types';
import {sameContext,normalizeError} from './logic';
import {routerModel} from './router';
export interface RouterPasswordReport {did:string;model:string;rows:{label:string;ssid:string;password:string}[];qr:string|null}
qrcode.stringToBytes=(s:string)=>Array.from(new TextEncoder().encode(s));
export function wifiQrMatrix(value:string):boolean[][] {
 if(!value.startsWith('WIFI:')||new TextEncoder().encode(value).length>2200)throw Error('Invalid Wi-Fi QR content');
 const code=qrcode(0,'M');code.addData(value,'Byte');code.make();
 return Array.from({length:code.getModuleCount()},(_,y)=>Array.from({length:code.getModuleCount()},(_,x)=>code.isDark(y,x)));
}
export class RouterPasswordState {
 report?:RouterPasswordReport;loading=false;revealed=false;matrix?:boolean[][];error?:AppError;
 private epoch=0;private context?:DeviceContext;private scope='';
 constructor(private read:(c:DeviceContext)=>Promise<RouterPasswordReport>,private changed:()=>void,private failed:(e:AppError)=>void){}
 get modalOpen():boolean{return !!this.matrix;}
 bind(c:DeviceContext,scope:string):void{if(!sameContext(c,this.context)||scope!==this.scope){this.close();this.context={...c};this.scope=scope;}}
 close():void{++this.epoch;this.context=undefined;this.report=undefined;this.matrix=undefined;this.loading=false;this.revealed=false;this.error=undefined;}
 hide():void{this.revealed=false;this.matrix=undefined;this.changed();}
 toggle():void{if(this.report&&!this.error){this.revealed=!this.revealed;this.changed();}}
 dismiss():void{this.matrix=undefined;this.changed();}
 share():void{if(!this.report?.qr||this.error)return;try{this.matrix=wifiQrMatrix(this.report.qr);}catch{this.error={kind:'protocol',message:'此Wi-Fi配置无法生成连接二维码。',retryable:false};}this.changed();}
 async load(c:DeviceContext):Promise<void>{
  if(this.loading||this.revealed||this.modalOpen||!sameContext(c,this.context))return;
  const epoch=this.epoch,current=()=>epoch===this.epoch&&sameContext(c,this.context);this.loading=true;this.changed();
  try{const r=await this.read({...c});if(!current())return;if(r.did!==c.did||r.model!==routerModel||!r.rows.length||r.rows.length>4||r.rows.some(row=>typeof row.label!=='string'||typeof row.ssid!=='string'||typeof row.password!=='string')||(r.qr!==null&&(typeof r.qr!=='string'||!r.qr.startsWith('WIFI:'))))throw{kind:'protocol',message:'Wi-Fi密码信息与当前路由器不匹配。',retryable:false};this.report=r;this.error=undefined;}
  catch(e){if(current()){this.report=undefined;this.revealed=false;this.matrix=undefined;this.error=normalizeError(e);this.failed(this.error);}}
  finally{if(current()){this.loading=false;this.changed();}}
 }
}
