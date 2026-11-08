import type {AppError,ControlResult,Device,DeviceContext,DevicePanel} from './types';import {dispenserProfile} from './dispenser';import {DeviceOpening} from './device-opening';import {normalizeError} from './logic';
export type SterilizationChange={operation:'start'|'stop';expectedStatus:number};
function profile(panel:DevicePanel){
 const services=panel.services.filter(s=>s.siid===2),service=services[0];if(!dispenserProfile(panel)||services.length!==1||service.name!=='water-dispenser')return;
 const fields:[[number,string,string],[number,string,string],[number,string,string]]=[[1,'fault','uint32'],[2,'status','uint8'],[8,'progress','uint8']];
 for(const[piid,name,format]of fields){const rows=service.properties.filter(p=>p.piid===piid);if(rows.length!==1||rows[0].siid!==2||rows[0].name!==name||rows[0].format!==format||rows[0].unsupportedReason||!rows[0].access.includes('read'))return;}
 const expected=['Fault','Idle','Water Coming Out','In Water Shortage','High Temperature Sterilization','High Temperature Sterilization Stop','High Temperature Sterilization Complete'],list=service.properties.find(p=>p.piid===2)!.valueList;
 if(list?.length!==7||!expected.every((name,i)=>list.filter(v=>v.value===i&&v.description.toLowerCase()===name.toLowerCase()).length===1))return;return service;
}
export function sterilizationState(panel:DevicePanel):{status:number|null;progress:number|null;fault:number|null}{
 const service=profile(panel);const read=(piid:number,max:number)=>{const p=service?.properties.find(p=>p.piid===piid);return p?.code===0&&typeof p.value==='number'&&Number.isInteger(p.value)&&p.value>=0&&p.value<=max?p.value:null;};return{status:read(2,6),progress:read(8,100),fault:read(1,4294967295)};
}
export function sterilizationSupported(p:DevicePanel):boolean{
 const service=profile(p);return !!service&&[2,3].every(aiid=>{const a=service.actions.filter(a=>a.siid===2&&a.aiid===aiid&&a.name===(aiid===2?'start-sterilization':'stop-sterilization'));return a.length===1&&!a[0].in.length&&!a[0].out.length&&!a[0].unsupportedReason;});
}
export function sterilizationReason(device:Device,panel:DevicePanel,cached:boolean,operation:'start'|'stop'):string|undefined{if(!device.online)return'设备离线，恢复在线后可操作。';if(device.sharedReadOnly)return'此共享设备只有查看权限。';if(cached)return'正在读取设备的实时状态…';if(!sterilizationSupported(panel))return'设备没有提供已核实的杀菌动作。';const s=sterilizationState(panel);if(s.status===null)return'杀菌状态未能直接读取，请重新读取。';if(operation==='stop')return s.status===4?undefined:'设备当前未在执行高温杀菌。';if(s.status===0||s.fault!==null&&s.fault!==0)return'管线机存在故障，请先解决故障。';if(s.status===2)return'管线机出水中，请先停止出水。';if(s.status===3)return'管线机缺水，请检查管路连接。';if(s.status===4)return'设备已经在冲洗中，请勿重复开始。';if(s.status===5||s.status===6)return'请先按设备提示排空高温余水。';if(s.fault===null)return'设备故障状态未确认正常，请重新读取。';}
const identity=(c:DeviceContext)=>JSON.stringify([c.homeId,c.generation,c.did]);
const matches=(panel:DevicePanel,change:SterilizationChange)=>{const s=sterilizationState(panel).status;return change.operation==='start'?(s===4||s===6):(s===5||s===6);};
export class DispenserSterilization{
 private clock=0;get version(){return this.clock;}private key='';private context='';private receipts=new Map<string,{pending:boolean;message:string}>();confirming=false;readonly opening=new DeviceOpening(()=>this.changed());
 constructor(private transport:{run:(c:DeviceContext,v:SterilizationChange)=>Promise<ControlResult>;read:(c:DeviceContext)=>Promise<DevicePanel>},private changed:()=>void,private accept:(c:DeviceContext,p:DevicePanel)=>void,private failed:(e:AppError)=>void){}
 bind(c:DeviceContext,scope:string){const key=JSON.stringify([scope,c.homeId,c.did]);if(identity(c)!==this.context||key!==this.key){this.opening.cancel();this.confirming=false;}this.context=identity(c);this.key=key;}
 close(){this.context='';this.confirming=false;this.opening.cancel();}
 get pending(){return!!this.receipts.get(this.key)?.pending;}get blocked(){return this.receipts.has(this.key);}get message(){return this.receipts.get(this.key)?.message??'';}
 async run(c:DeviceContext,change:SterilizationChange):Promise<boolean>{if(this.blocked||identity(c)!==this.context)return false;this.clock++;this.confirming=false;const key=this.key,context=this.context,target={...change},receipt={pending:true,message:'正在等候设备状态回读…'};this.receipts.set(key,receipt);this.opening.begin();this.changed();
  try{const r=await this.transport.run(c,target);if(r.panel.did!==c.did||!sterilizationSupported(r.panel))throw Error('杀菌状态返回的设备不匹配。');if(key===this.key&&context===this.context){this.clock++;this.accept(c,r.panel);}if(r.verified&&matches(r.panel,target)){this.receipts.delete(key);return key===this.key&&context===this.context;}receipt.message=r.verified?'回读未能确认目标状态，请重新读取。':r.message;}
  catch(e){const error=normalizeError(e);receipt.message=error.message;if(key===this.key&&context===this.context)this.failed(error);}
  finally{receipt.pending=false;if(key===this.key&&context===this.context)this.opening.ready();this.changed();}return false;
 }
 async refresh(c:DeviceContext):Promise<boolean>{if(this.pending||identity(c)!==this.context)return false;this.clock++;const key=this.key,context=this.context,receipt={pending:true,message:'正在重新读取杀菌状态…'};this.receipts.set(key,receipt);this.opening.begin();this.changed();
  try{const p=await this.transport.read(c),s=sterilizationState(p);if(p.did!==c.did||!sterilizationSupported(p)||s.status===null||s.fault===null)throw Error('杀菌状态未能完整读取，请重试。');this.receipts.delete(key);if(key===this.key&&context===this.context){this.clock++;this.accept(c,p);return true;}}
  catch(e){const error=normalizeError(e);receipt.message=error.message;if(key===this.key&&context===this.context)this.failed(error);}
  finally{receipt.pending=false;if(key===this.key&&context===this.context)this.opening.ready();this.changed();}return false;
 }
}
