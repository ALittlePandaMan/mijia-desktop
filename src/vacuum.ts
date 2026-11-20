import type {AppError,DeviceContext} from './types';
import {ReportOperations} from './report-operations';
import {VacuumMapViewport} from './vacuum-map-view';
import {backgroundWork} from './background-work';
export const vacuumModel='xiaomi.vacuum.d103cn';
export interface VacuumMap{floorId?:number;timestampMs?:number|null;empty?:boolean;width:number;height:number;gridSize:number;origin:[number,number];cells:string;rooms:{id:number;name:string;x:number;y:number}[];robot?:{x:number;y:number;angle:number}|null;dock?:{x:number;y:number;angle:number}|null;rotation:number;path?:{x:number;y:number;isLine:boolean}[]}
export interface VacuumReport{did:string;model:string;baseline:string;status:number;battery:number;mode:number;suction:number;water:number;inStation:boolean;cleaning:boolean;paused:boolean;washStation:number;dustStatus:number;dustEnable:number;childLock:boolean;map?:VacuumMap|null;mapReason?:string|null}
export interface VacuumChanged{report:VacuumReport;confirmed:boolean}
export type VacuumChange={operation:'mode'|'suction'|'water';value:number}|{operation:'start'|'pause'|'dock'|'collect'}|{operation:'wash'|'dry';on:boolean};
export function vacuumSettingsLocked(r:VacuumReport):boolean{return r.cleaning||[1,7,12,15,23,25].includes(r.status);}
/** UI prediction only; transport baselines remain the unmodified device report. */
export function projectVacuum(r:VacuumReport,c:VacuumChange):VacuumReport{
 if('value'in c)return{...r,[c.operation]:c.value};
 switch(c.operation){
  case 'start':return{...r,cleaning:true,paused:false,inStation:false,status:r.mode===2?1:r.mode===1?7:12};
  case 'pause':return{...r,cleaning:false,paused:true,status:3};
  case 'dock':return{...r,cleaning:false,paused:false,status:5};
  case 'wash':return{...r,washStation:c.on?1:0};
  case 'dry':return{...r,washStation:c.on?2:0};
  case 'collect':return{...r,dustStatus:1};
 }
}
class MapRefresh{
 current?:VacuumMap;
 private floor?:number;private latestTime=0;private epoch=0;private signature?:string;
 private timer?:ReturnType<typeof setTimeout>;private inFlight?:Promise<void>;private unsubscribe?:()=>void;
 constructor(private read:(c:DeviceContext)=>Promise<VacuumMap>,private view:VacuumMapViewport,private changed:()=>void,private validate:(map:VacuumMap)=>void,private failed:(error:AppError)=>void){}
 bind(context:DeviceContext){
  const update=()=>{
   clearTimeout(this.timer);const epoch=++this.epoch;
   if(!backgroundWork.paused)void this.refresh(context,epoch);
  };
  this.unsubscribe=backgroundWork.subscribe(update);update();
 }
 private async refresh(context:DeviceContext,epoch:number){
  if(this.inFlight)await this.inFlight;
  if(epoch!==this.epoch)return;
  const work=(async()=>{
   try{
    const frame=await this.read(context);
    if(epoch!==this.epoch)return;
    this.validate(frame);
    if(frame.timestampMs&&frame.timestampMs<this.latestTime)return;
    if(frame.timestampMs)this.latestTime=frame.timestampMs;
    const next=frame.empty?undefined:frame;
    const floor=next?.floorId;
    if(!next||this.floor!==undefined&&floor!==undefined&&floor!==this.floor)this.view.reset();
    this.floor=floor;
    const signature=next&&JSON.stringify({...next,timestampMs:undefined});
    if(signature!==this.signature){this.signature=signature;this.current=next;this.changed();}
   }catch(error){if(epoch===this.epoch&&typeof error==='object'&&error&&'kind'in error&&error.kind==='authExpired')this.failed(error as AppError);}
   finally{if(epoch===this.epoch)this.timer=setTimeout(()=>void this.refresh(context,epoch),15000);}
  })();
  this.inFlight=work;await work;if(this.inFlight===work)this.inFlight=undefined;
 }
 close(){++this.epoch;clearTimeout(this.timer);this.unsubscribe?.();this.unsubscribe=undefined;this.current=undefined;this.signature=undefined;this.floor=undefined;this.latestTime=0;}
}
export class VacuumState{
 stationOpen=false;manualOpen=false;manualWater?:number;readonly viewport=new VacuumMapViewport();private contextKey='';private state:ReportOperations<VacuumReport,VacuumChange>;
 constructor(api:{read:(c:DeviceContext)=>Promise<VacuumReport>;readMap?:(c:DeviceContext)=>Promise<VacuumMap>;change:(c:DeviceContext,baseline:string,change:VacuumChange)=>Promise<{report:VacuumReport;confirmed:boolean}>},private changed:()=>void,failed:(e:AppError)=>void){this.state=new ReportOperations({read:api.read,send:async(c,r,i)=>{const result=await api.change(c,r.baseline,i);if(!result.report.map&&r.map)result.report.map=r.map;return result;},validate:(r,c)=>this.validate(r,c),key:c=>['mode','suction','water'].includes(c.operation)?c.operation:'action',project:projectVacuum,matches:(r,c)=>{switch(c.operation){case'mode':case'suction':case'water':return r[c.operation]===c.value;case'start':return r.cleaning;case'pause':return r.paused;case'dock':return r.inStation;case'wash':return c.on?[1,4].includes(r.washStation):r.washStation===0;case'dry':return c.on?r.washStation===2:r.washStation===0;case'collect':return r.dustStatus===1;}},allowed:(r,c)=>!r.childLock&&![11,14,16,19].includes(r.status)&&(!['mode','suction','water'].includes(c.operation)||!vacuumSettingsLocked(r)),interval:15000},()=>{if(this.report&&vacuumSettingsLocked(this.report)){this.manualOpen=false;this.manualWater=undefined;}this.changed();},failed);if(api.readMap)this.maps=new MapRefresh(api.readMap,this.viewport,changed,map=>this.validateMap(map),failed);}
 get report(){return this.state.report;}get actual(){return this.state.actual;}get error(){return this.state.error;}get loading(){return this.state.loading;}get pending(){return this.state.pending;}get message(){return this.state.message;}get uncertain(){return this.state.uncertain;}
 get pendingAction(){return this.state.intents.find(c=>!['mode','suction','water'].includes(c.operation));}
 get actionMessage(){const op=this.pendingAction?.operation;return op?({start:'正在启动清洁…',pause:'正在暂停…',dock:'正在返回基座…',wash:'正在调整拖布清洗…',dry:'正在调整烘干…',collect:'正在启动集尘…'}as Record<string,string>)[op]:undefined;}
 private maps?:MapRefresh;
 get displayedMap(){return this.maps?this.maps.current:this.report?.map;}
 bind(c:DeviceContext,scope:string){const key=JSON.stringify([scope,c]);if(key===this.contextKey)return;this.close();this.contextKey=key;this.state.bind(c,scope);this.maps?.bind(c);}close(){this.contextKey='';this.maps?.close();this.state.close();this.stationOpen=false;this.manualOpen=false;this.manualWater=undefined;this.viewport.reset();}
 redraw(){this.changed();}adopt(){this.state.adopt();}read(){return this.state.read();}
 async change(change:VacuumChange){const context=this.contextKey;if(this.state.loading)return;await Promise.resolve();if(context!==this.contextKey)return;return this.state.change(change);}
 showStation(open:boolean){this.stationOpen=open;this.changed();}
 showManual(open:boolean){if(open&&(!this.report||vacuumSettingsLocked(this.report!)||this.loading||this.error))return;this.manualOpen=open;this.manualWater=open?(this.report!.water>0?this.report!.water:10):undefined;this.changed();}
 setManualWater(value:number){if(this.manualOpen&&Number.isInteger(value)&&value>=1&&value<=15)this.manualWater=value;}
 private validate(r:VacuumReport,c:DeviceContext){if(r.did!==c.did||r.model!==vacuumModel||!r.baseline||!Number.isInteger(r.status)||!Number.isInteger(r.battery)||r.battery<0||r.battery>100||![0,1,2,3].includes(r.mode)||![0,1,2,3].includes(r.suction)||!([-5,-10,-15].includes(r.water)||Number.isInteger(r.water)&&r.water>=1&&r.water<=15)||[r.inStation,r.cleaning,r.paused,r.childLock].some(v=>typeof v!=='boolean'))throw Error('扫地机器人状态与当前设备不匹配。');if(r.map)this.validateMap(r.map);}
 private validateMap(m:VacuumMap){if(!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width<1||m.height<1||m.width>2048||m.height>2048||m.width*m.height>2000000||typeof m.cells!=='string'||m.cells.length>3000000||!Array.isArray(m.rooms)||m.rooms.length>50||atob(m.cells).length!==m.width*m.height||![0,90,180,270].includes(m.rotation)||m.rooms.some(a=>!Number.isFinite(a.x)||!Number.isFinite(a.y)||typeof a.name!=='string'||a.name.length>80||a.id<1||a.id>50))throw Error('扫地机器人地图格式异常。');if(m.path!==undefined&&(!Array.isArray(m.path)||m.path.length>100000||m.path.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||typeof p.isLine!=='boolean'||p.x< -50||p.x>m.width+50||p.y< -50||p.y>m.height+50)))throw Error('扫地机器人清扫路径格式异常。');}
}
