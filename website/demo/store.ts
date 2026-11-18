import type {DevicePanel,Property,Json,SensorHistory,HomeCardEntry,HistorySelection} from './desktop/src/types';
import {laundrySample,washerConfigSample} from './desktop/src/fixtures/laundry-sample';
import {washerPrograms,washerFields,washerMinutes,type WasherDraft} from './desktop/src/washer';
import {dateKey,parseDateKey} from './desktop/src/history';
import {televisionSample} from './desktop/src/fixtures/television-sample';
import {televisionRoles,type TelevisionRole} from './desktop/src/television';
import {cardCaption} from './desktop/src/home-cards';
import {demoCardStatus} from './card-status';
import {cardSize,type CardSize} from './desktop/src/card-size';
import type {RoomState} from './room-state';
import {devices,demoRooms,demoDevice,type DeviceId,type RoomId} from './catalog';
export {devices,demoRooms,demoDevice,type DeviceId,type RoomId} from './catalog';
export type DemoCommand={kind:'write';device:DeviceId;siid:number;piid:number;value:Json}|{kind:'toggle';device:DeviceId}|{kind:'tv';device:DeviceId;role:TelevisionRole}|{kind:'washer-start';device:DeviceId;draft:WasherDraft}|{kind:'washer-control';device:DeviceId;key:string}|{kind:'card-size';device:DeviceId;size:CardSize}|{kind:'card-order';room:CardRoom;ids:DeviceId[]}|{kind:'reset'};
type Sample={time:number;temperature:number;humidity:number};
type CardRoom=RoomId|'all';
type CardOrders=Partial<Record<CardRoom,DeviceId[]>>;
export type DemoSnapshot={states:Record<DeviceId,RoomState>;samples:Record<RoomId,Sample[]>;cardSizes:Partial<Record<DeviceId,CardSize>>;cardOrders?:CardOrders};
const initialCardSizes=():DemoSnapshot['cardSizes']=>Object.fromEntries(devices.map(device=>[device.did,['curtain','ac','light'].includes(device.kind)?'large':'medium']));
const membersByRoom=new Map<string,readonly DeviceId[]>(
 ['all',...demoRooms.map(room=>room.id)].map(room=>[room,devices.filter(device=>room==='all'||device.roomId===room).map(device=>device.did)])
);
function validCardOrder(room:string,ids:unknown):ids is DeviceId[]{
 const members=membersByRoom.get(room);
 return !!members&&Array.isArray(ids)&&ids.length===members.length&&new Set(ids).size===members.length&&ids.every(id=>members.includes(id));
}
export const initialState=():RoomState=>({mainLight:true,switchStrip:false,switchDownlights:true,lightOn:true,brightness:60,colorTemperature:4000,curtainPosition:60,curtainTarget:60,curtainMoving:false,fanOn:true,fanSpeed:2,fanSwing:true,fanMode:0,acOn:false,acTarget:24,acMode:2,acFan:0,temperature:28,humidity:52,tvOn:false,tvVolume:35,tvSelection:0,tvScreen:'home',airerPosition:60,airerLight:true,airerBrightness:60,airerTarget:60,airerStatus:3,washerOn:false,washerProgram:24,washerStatus:0,washerRemaining:0,washerLocked:false});
function initialStates(){return Object.fromEntries(devices.map(device=>{const state=initialState();if(device.roomId==='bedroom'){state.temperature=26;state.humidity=49;}if(device.roomId==='bathroom'){state.temperature=27;state.humidity=65;}if(device.roomId==='balcony'){state.temperature=29;state.humidity=55;}return[device.did,state];})) as Record<DeviceId,RoomState>;}
const emptySamples=()=>Object.fromEntries(demoRooms.map(room=>[room.id,[] as Sample[]])) as Record<RoomId,Sample[]>;
function property(siid:number,piid:number,name:string,value:Json,range?:number[],values?:[number,string][],unit?:string,readOnly=false):Property{return {siid,piid,name,description:name,format:typeof value==='boolean'?'bool':typeof value==='string'?'string':'float',access:readOnly?['read','notify']:['read','write','notify'],value,code:0,valueRange:range,valueList:values?.map(([value,description])=>({value,description})),unit};}
export class DemoStore {
 private states=initialStates();private samples=emptySamples();private cardSizes=initialCardSizes();private cardOrders:CardOrders={};private listeners=new Set<(environment:boolean)=>void>();private last=performance.now();private timer?:number;
 constructor(private options:{send?:(command:DemoCommand)=>void;visible?:()=>boolean}={}){if(!options.send)this.timer=window.setInterval(()=>this.tick(),50);}
 stateFor(id:DeviceId){return this.states[id];}
 cardSize(id:DeviceId){return cardSize(this.cardSizes[id]);}
 setCardSize(id:DeviceId,size:CardSize){if(!demoDevice(id)||!['small','medium','large'].includes(size))return;if(this.cardSize(id)===size)return;this.cardSizes={...this.cardSizes,[id]:size};this.emit();this.options.send?.({kind:'card-size',device:id,size});}
 cardOrder(room:CardRoom):readonly DeviceId[]{return this.cardOrders[room]??membersByRoom.get(room)!;}
 setCardOrder(room:CardRoom,ids:unknown){
  if(!validCardOrder(room,ids)||ids.every((id,index)=>id===this.cardOrder(room)[index]))return;
  this.cardOrders={...this.cardOrders,[room]:[...ids]};
  this.emit();
  this.options.send?.({kind:'card-order',room,ids:[...ids]});
 }
 snapshot():DemoSnapshot{return {states:Object.fromEntries(devices.map(device=>[device.did,{...this.states[device.did]}])) as DemoSnapshot['states'],samples:Object.fromEntries(demoRooms.map(room=>[room.id,this.samples[room.id].map(sample=>({...sample}))])) as DemoSnapshot['samples'],cardSizes:{...this.cardSizes},cardOrders:Object.fromEntries(Object.entries(this.cardOrders).map(([room,ids])=>[room,[...ids]]))};}
 applySnapshot(raw:unknown,environment:boolean){
  if(!raw||typeof raw!=='object')return;const {states,samples,cardSizes,cardOrders={}}=raw as DemoSnapshot,base=initialState();if(!states||!samples||!cardSizes||typeof cardSizes!=='object')return;
  if(Object.entries(cardSizes).some(([id,size])=>!demoDevice(id)||!['small','medium','large'].includes(size)))return;
  if(!cardOrders||typeof cardOrders!=='object'||Array.isArray(cardOrders)||Object.entries(cardOrders).some(([room,ids])=>!validCardOrder(room,ids)))return;
  for(const device of devices){const state=states[device.did];if(!state||typeof state!=='object')return;for(const key of Object.keys(base) as (keyof RoomState)[])if(typeof state[key]!==typeof base[key]||typeof state[key]==='number'&&!Number.isFinite(state[key]))return;}
  for(const room of demoRooms){const points=samples[room.id];if(!Array.isArray(points)||points.length>360||points.some(s=>!s||![s.time,s.temperature,s.humidity].every(Number.isFinite)))return;}
  this.states=Object.fromEntries(devices.map(device=>[device.did,{...states[device.did]}])) as DemoSnapshot['states'];this.samples=Object.fromEntries(demoRooms.map(room=>[room.id,samples[room.id].map(s=>({...s}))])) as DemoSnapshot['samples'];this.cardSizes={...cardSizes};this.cardOrders=Object.fromEntries(Object.entries(cardOrders).map(([room,ids])=>[room,[...ids]]));this.emit(environment);
 }
 command(raw:unknown){
  if(!raw||typeof raw!=='object')return;const c=raw as Record<string,unknown>;if(c.kind==='reset'){this.reset();return;}
  if(c.kind==='card-order'){if(typeof c.room==='string'&&membersByRoom.has(c.room))this.setCardOrder(c.room as CardRoom,c.ids);return;}
  const device=demoDevice(String(c.device));if(!device)return;const id=device.did;
  if(c.kind==='tv'&&device.kind==='tv'&&televisionRoles.includes(c.role as TelevisionRole)){this.tvPress(id,c.role as TelevisionRole);return;}
  if(c.kind==='washer-start'&&device.kind==='washer'&&c.draft&&typeof c.draft==='object'){this.startWasher(id,c.draft as WasherDraft);return;}
  if(c.kind==='washer-control'&&device.kind==='washer'&&typeof c.key==='string'){this.controlWasher(id,c.key);return;}
  if(c.kind==='toggle'){this.toggle(id);return;}
  if(c.kind==='card-size'&&['small','medium','large'].includes(c.size as string)){this.setCardSize(id,c.size as CardSize);return;}
  if(c.kind==='write'&&Number.isInteger(c.siid)&&Number.isInteger(c.piid)&&['boolean','string','number'].includes(typeof c.value)){const p=this.panel(id).services.flatMap(s=>s.properties).find(p=>p.siid===c.siid&&p.piid===c.piid);if(p)this.write(id,p,c.value as Json);}
 }
 subscribe(fn:(environment:boolean)=>void){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
 private emit(environment=false){for(const fn of this.listeners)fn(environment);}
 reset(){if(this.options.send){this.options.send({kind:'reset'});return;}this.states=initialStates();this.samples=emptySamples();this.cardSizes=initialCardSizes();this.cardOrders={};this.last=performance.now();this.emit();}
 panel(id:DeviceId):DevicePanel {
  const s=this.states[id],d=demoDevice(id)!,kind=d.kind;let services:DevicePanel['services']=[];const service=(siid:number,name:string,properties:Property[])=>({siid,name,description:name==='switch'?'主灯':name,properties,actions:[]});
  if(kind==='switch')services=[[2,'主灯',s.mainLight],[3,'灯带',s.switchStrip],[4,'筒灯',s.switchDownlights]].map(([siid,description,on])=>({...service(Number(siid),'switch',[property(Number(siid),1,'on',on as boolean)]),description:String(description)}));
  if(kind==='light')services=[service(2,'light',[property(2,1,'on',s.lightOn),property(2,2,'brightness',s.brightness,[1,100,1],undefined,'percentage'),property(2,3,'color-temperature',s.colorTemperature,[2700,6500,100],undefined,'kelvin')])];
  if(kind==='curtain')services=[service(2,'curtain',[property(2,2,'motor-control',s.curtainMoving?(s.curtainTarget>s.curtainPosition?1:2):0,undefined,[[0,'Pause'],[1,'Open'],[2,'Close']]),property(2,3,'status',s.curtainMoving?(s.curtainTarget>s.curtainPosition?1:2):0,undefined,[[0,'Stop'],[1,'Opening'],[2,'Closing']],undefined,true),property(2,4,'current-position',Math.round(s.curtainPosition),[0,100,1],undefined,'percentage',true),property(2,5,'target-position',s.curtainTarget,[0,100,1],undefined,'percentage'),property(2,11,'whole-journey-time',8,[0,100,1],undefined,'seconds',true)])];
  if(kind==='fan')services=[service(2,'fan',[property(2,1,'on',s.fanOn),property(2,2,'fan-level',s.fanSpeed,undefined,[[1,'Level1'],[2,'Level2'],[3,'Level3']]),property(2,3,'horizontal-swing',s.fanSwing),property(2,7,'mode',s.fanMode,undefined,[[0,'Straight Wind'],[1,'Sleep']])]),service(3,'environment',[property(3,1,'temperature',Number(s.temperature.toFixed(1)),undefined,undefined,'celsius',true),property(3,2,'relative-humidity',Math.round(s.humidity),undefined,undefined,'percentage',true)])];
  if(kind==='ac')services=[service(2,'air-conditioner',[property(2,1,'on',s.acOn),property(2,2,'mode',s.acMode,undefined,[[2,'Cool'],[3,'Dry'],[4,'Fan'],[5,'Heat']]),property(2,4,'target-temperature',s.acTarget,[16,31,.5],undefined,'celsius')]),service(3,'fan-control',[property(3,2,'fan-level',s.acFan,undefined,[[0,'Auto'],[1,'Low'],[2,'Medium'],[3,'High']])]),service(4,'environment',[property(4,1,'temperature',Number(s.temperature.toFixed(1)),undefined,undefined,'celsius',true)])];
  if(kind==='thermo')services=[service(2,'temperature-humidity-sensor',[property(2,1,'temperature',Number(s.temperature.toFixed(1)),undefined,undefined,'celsius',true),property(2,2,'relative-humidity',Math.round(s.humidity),undefined,undefined,'percentage',true)])];
  if(kind==='airer'||kind==='washer'){
   const panel=laundrySample(kind,id);
   for(const p of panel.services.flatMap(service=>service.properties)){
    if(kind==='airer'){if(p.siid===2&&p.name==='status')p.value=s.airerStatus;if(p.siid===2&&p.name==='target-position')p.value=s.airerTarget;if(p.siid===3&&p.name==='on')p.value=s.airerLight;if(p.siid===3&&p.name==='brightness')p.value=s.airerBrightness;if(p.siid===4&&p.name==='current-position')p.value=Math.round(s.airerPosition);}
    else if(p.siid===2){if(p.name==='on')p.value=s.washerOn;if(p.name==='status')p.value=s.washerStatus;if(p.name==='mode')p.value=s.washerProgram;if(p.name==='left-time')p.value=Math.ceil(s.washerRemaining);}
   }
   if(kind==='washer')panel.washerRuntime=this.washerRuntime(id);
   return panel;
  }
  if(kind==='tv'){const sample=televisionSample();for(const p of sample.services.flatMap(s=>s.properties)){if(p.name==='volume')p.value=s.tvVolume;if(p.name==='mute')p.value=s.tvVolume===0;if(p.name==='on')p.value=s.tvOn;}return {...sample,did:d.did,model:d.model};}
  return {did:d.did,model:d.model,specType:d.specType,services};
 }
 write(id:DeviceId,p:Property,value:Json){
  const actual=this.panel(id).services.flatMap(s=>s.properties).find(x=>x.siid===p.siid&&x.piid===p.piid);if(!actual?.access.includes('write')||typeof actual.value!==typeof value)return;
  if(actual.valueRange){const [min,max,step]=actual.valueRange;if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||Math.abs((value-min)/step-Math.round((value-min)/step))>1e-6)return;}if(actual.valueList&&!actual.valueList.some(c=>c.value===value))return;
  const s=this.states[id],kind=demoDevice(id)!.kind;const bool=(key:keyof RoomState)=>{if(typeof value==='boolean')(s as unknown as Record<string,Json>)[key]=value;},num=(key:keyof RoomState)=>{if(typeof value==='number'&&Number.isFinite(value))(s as unknown as Record<string,Json>)[key]=value;};
  if(kind==='switch'&&actual.name==='on')bool(actual.siid===2?'mainLight':actual.siid===3?'switchStrip':'switchDownlights');if(kind==='light'){if(actual.name==='on')bool('lightOn');if(actual.name==='brightness')num('brightness');if(actual.name==='color-temperature')num('colorTemperature');}
  if(kind==='curtain'){if(actual.name==='target-position'&&typeof value==='number')this.moveCurtain(id,value);if(actual.name==='motor-control'){if(value===0){s.curtainTarget=Math.round(s.curtainPosition);s.curtainMoving=false;}else if(value===1||value===2)this.moveCurtain(id,value===1?100:0);}}
  if(kind==='fan'){if(actual.name==='on')bool('fanOn');if(actual.name==='mode')num('fanMode');if(actual.name==='fan-level')num('fanSpeed');if(actual.name==='horizontal-swing')bool('fanSwing');}
  if(kind==='ac'){if(actual.name==='on')bool('acOn');if(actual.name==='mode')num('acMode');if(actual.name==='target-temperature')num('acTarget');if(actual.name==='fan-level')num('acFan');}
  if(kind==='airer'){if(actual.siid===3&&actual.name==='on')bool('airerLight');if(actual.siid===3&&actual.name==='brightness')num('airerBrightness');if(actual.name==='motor-control'){s.airerStatus=value===1?1:value===2?2:3;s.airerTarget=value===1?0:value===2?100:s.airerPosition;}if(actual.name==='target-position'&&typeof value==='number'){s.airerTarget=value;s.airerStatus=value<s.airerPosition?1:value>s.airerPosition?2:3;}}
  if(kind==='washer'){if(actual.name==='on'){bool('washerOn');s.washerStatus=s.washerOn?1:0;}if(actual.name==='mode'&&s.washerOn)num('washerProgram');}
  if(kind==='tv'){if(actual.name==='volume')s.tvVolume=Math.min(100,Math.max(0,Number(value)));if(actual.name==='mute'&&typeof value==='boolean')s.tvVolume=value?0:35;}this.emit();this.options.send?.({kind:'write',device:id,siid:actual.siid,piid:actual.piid,value});
 }
 shortcut(id:DeviceId):HomeCardEntry|undefined {
  const s=this.states[id],kind=demoDevice(id)!.kind;if(kind==='washer'||kind==='switch')return;if(kind==='curtain')return {did:id,kind:'curtain',selected:s.curtainPosition>0||s.curtainMoving,enabled:true,reason:null,visible:true,highlight:s.curtainMoving||s.curtainPosition>0,binding:{siid:2,piid:s.curtainMoving?2:5},action:s.curtainMoving?'pause':s.curtainPosition>0?'close':'open',cardType:1};
  const on=kind==='fan'?s.fanOn:kind==='ac'?s.acOn:kind==='light'?s.lightOn:kind==='airer'?s.airerLight:undefined;if(on===undefined)return;return {did:id,kind:'power',selected:on,enabled:true,reason:null,visible:true,highlight:on,binding:{siid:kind==='airer'?3:2,piid:1},action:on?'off':'on',cardType:1};
 }
 toggle(id:DeviceId){const properties=this.panel(id).services.flatMap(s=>s.properties);if(demoDevice(id)!.kind==='curtain'){const s=this.states[id],p=properties.find(p=>p.name===(s.curtainMoving?'motor-control':'target-position'))!;this.write(id,p,s.curtainMoving?0:s.curtainPosition>0?0:100);return;}const p=properties.find(p=>p.name==='on');if(p)this.write(id,p,!p.value);}
 caption(id:DeviceId){const device=demoDevice(id)!,status=demoCardStatus(device,this.panel(id));return cardCaption(device,device.roomName??'未分配房间',status?[status]:[]);}
 startWasher(id:DeviceId,draft:WasherDraft){
  if(demoDevice(id)?.kind!=='washer'||!draft||typeof draft.program!=='string'||!draft.values||typeof draft.values!=='object')return;
  const report=washerConfigSample(id),panel=this.panel(id),program=washerPrograms(report,panel).find(program=>program.name===draft.program);if(!program)return;
  const fields=washerFields(report,program,panel,draft);if(!fields.length||fields.some(field=>!field.hidden&&!field.choices.includes(field.value)))return;
  if(this.options.send){this.options.send({kind:'washer-start',device:id,draft:{program:draft.program,values:{...draft.values}}});return;}
  const s=this.states[id];s.washerOn=true;s.washerStatus=3;s.washerProgram=program.value;s.washerRemaining=Math.max(1,washerMinutes(program,fields));this.emit();
 }
 controlWasher(id:DeviceId,key:string){
  if(demoDevice(id)?.kind!=='washer'||!['pause','resume','stop','off','lock'].includes(key))return;
  if(this.options.send){this.options.send({kind:'washer-control',device:id,key});return;}
  const s=this.states[id];if(key==='lock')s.washerLocked=!s.washerLocked;
  else if(key==='pause'&&s.washerStatus===3)s.washerStatus=2;
  else if(key==='resume'&&s.washerStatus===2)s.washerStatus=3;
  else if(key==='stop'||key==='off'){s.washerStatus=0;s.washerOn=false;s.washerRemaining=0;}this.emit();
 }
 private washerRuntime(id:DeviceId):NonNullable<DevicePanel['washerRuntime']>{
  const s=this.states[id],state=s.washerStatus===3?'busy':s.washerStatus===2?'paused':s.washerStatus===5?'completed':s.washerOn?'idle':'off',active=['busy','paused','completed'].includes(state);
  const controls:NonNullable<DevicePanel['washerRuntime']>['controls']=active?[{key:'stop',label:'终止',kind:'action',siid:2,piid:null,aiid:1,value:null,enabled:true,reason:null,confirmation:'确定要终止洗涤吗？'},{key:state==='paused'?'resume':'pause',label:state==='paused'?'继续':'暂停',kind:'action',siid:2,piid:null,aiid:state==='paused'?2:3,value:null,enabled:state!=='completed',reason:null,confirmation:null},{key:'lock',label:'童锁',kind:'property',siid:3,piid:1,aiid:null,value:!s.washerLocked,enabled:true,reason:null,confirmation:null}]:[];
  return {state,active,mode:s.washerProgram,stage:state==='completed'?'washing completed':'washing',remainingMinutes:Math.ceil(s.washerRemaining),reservationMinutes:null,weighing:false,hasDrying:false,cleaning:false,locked:s.washerLocked,steps:[{id:2,label:'称重',progress:'done'},{id:5,label:'洗涤',progress:state==='completed'?'done':'current'},{id:6,label:'漂洗',progress:state==='completed'?'done':'pending'},{id:8,label:'脱水',progress:state==='completed'?'done':'pending'}],controls};
 }
 private moveCurtain(id:DeviceId,target:number){const s=this.states[id];s.curtainTarget=target;s.curtainMoving=Math.abs(target-s.curtainPosition)>.001;if(matchMedia('(prefers-reduced-motion: reduce)').matches){s.curtainPosition=target;s.curtainMoving=false;}}
 tvPress(id:DeviceId,role:TelevisionRole){if(this.options.send){this.options.send({kind:'tv',device:id,role});return;}if(demoDevice(id)?.kind!=='tv')return;const s=this.states[id];if(role==='power')s.tvOn=!s.tvOn;else if(s.tvOn){if(role==='volume-up'||role==='volume-down')s.tvVolume=Math.max(0,Math.min(100,s.tvVolume+(role==='volume-up'?5:-5)));if(['up','left','right','down'].includes(role))s.tvSelection=(s.tvSelection+(['up','left'].includes(role)?3:1))%4;if(role==='center')s.tvScreen=['video','nature','music','settings'][s.tvSelection];if(role==='home'||role==='back')s.tvScreen='home';if(role==='menu')s.tvScreen=s.tvScreen==='settings'?'home':'settings';}this.emit();}
 history(id:DeviceId,selection?:HistorySelection):SensorHistory {
  const state=this.states[id],now=Math.floor(Date.now()/1000),room=demoDevice(id)!.roomId,baseline=initialStates()[id],date=selection?parseDateKey(selection.date):new Date(),phase=demoRooms.findIndex(item=>item.id===room)*.6;
  let times:number[],start:number,end=now;
  if(selection?.period==='month'){
   start=new Date(date.getFullYear(),date.getMonth(),1).getTime()/1000-1;
   end=Math.min(now,new Date(date.getFullYear(),date.getMonth()+1,1).getTime()/1000-1);
   times=Array.from({length:new Date(date.getFullYear(),date.getMonth()+1,0).getDate()},(_,i)=>Math.min(end,new Date(date.getFullYear(),date.getMonth(),i+1,12).getTime()/1000)).filter((time,i,array)=>time>start&&array.indexOf(time)===i);
  }else if(selection?.period==='year'){
   start=new Date(date.getFullYear(),0,1).getTime()/1000-1;end=Math.min(now,new Date(date.getFullYear()+1,0,1).getTime()/1000-1);
   times=Array.from({length:12},(_,i)=>Math.min(end,new Date(date.getFullYear(),i,15,12).getTime()/1000)).filter((time,i,array)=>time>start&&array.indexOf(time)===i);
  }else{
   const today=!selection||dateKey(date)===dateKey(new Date()),first=today?Math.floor(now/3600)*3600-86400:date.getTime()/1000;
   start=first-1;end=today?now:Math.min(now,first+86400);times=Array.from({length:25},(_,i)=>first+i*3600).filter(time=>time<=end);
  }
  const channel=(name:'temperature'|'humidity')=>({name,unit:name==='temperature'?'celsius':'percentage',complete:true,error:null,points:times.map((time,i)=>{
   const smooth=Math.sin(i*.32+phase)*.75+Math.sin(i*.81+phase)*.2,spread=selection&&selection.period!=='day'?(name==='temperature'?1.2:4):0;
   const value=baseline[name]+smooth*(name==='temperature'?2.1:7.5),last=i===times.length-1&&(!selection||dateKey(date)===dateKey(new Date()))&&(!selection||selection.period==='day');
   const reading=last?state[name]:value;return {time,low:Number((reading-spread).toFixed(name==='temperature'?1:0)),high:Number((reading+spread).toFixed(name==='temperature'?1:0)),gateway:false};
  }).concat(!selection||selection.period==='day'?this.samples[room].filter(sample=>sample.time/1000>start&&sample.time/1000<=end).map(sample=>({time:sample.time/1000,low:sample[name],high:sample[name],gateway:false})):[])});
  return {did:id,model:demoDevice(id)!.model,fetchedAt:now,start,end,referenceTime:now,selection:selection??null,channels:[channel('temperature'),channel('humidity')],warnings:[]};
 }
 private tick(){
  const now=performance.now(),dt=Math.min(1,(now-this.last)/1000);this.last=now;if(document.hidden||this.options.visible&&!this.options.visible())return;let changed=false;
  for(const d of devices){const s=this.states[d.did];if(d.kind==='curtain'&&s.curtainMoving){const before=Math.round(s.curtainPosition),delta=s.curtainTarget-s.curtainPosition,step=12.5*dt;if(Math.abs(delta)<=step||matchMedia('(prefers-reduced-motion: reduce)').matches){s.curtainPosition=s.curtainTarget;s.curtainMoving=false;changed=true;}else s.curtainPosition+=Math.sign(delta)*step;if(before!==Math.round(s.curtainPosition))changed=true;}}
  for(const d of devices){const s=this.states[d.did];
   if(d.kind==='airer'&&[1,2].includes(s.airerStatus)){const before=Math.round(s.airerPosition),delta=s.airerTarget-s.airerPosition,step=15*dt;if(Math.abs(delta)<=step||matchMedia('(prefers-reduced-motion: reduce)').matches){s.airerPosition=s.airerTarget;s.airerStatus=s.airerPosition===0?0:s.airerPosition===100?4:3;changed=true;}else s.airerPosition+=Math.sign(delta)*step;if(before!==Math.round(s.airerPosition))changed=true;}
   if(d.kind==='washer'&&s.washerStatus===3){const before=Math.ceil(s.washerRemaining);s.washerRemaining=Math.max(0,s.washerRemaining-dt/60);if(!s.washerRemaining)s.washerStatus=5;if(before!==Math.ceil(s.washerRemaining))changed=true;}
  }
  for(const room of demoRooms){const members=devices.filter(d=>d.roomId===room.id),climate=members.find(d=>d.kind==='ac'),state=this.states[(climate??members[0]).did],baseline=room.id==='bedroom'?26:room.id==='bathroom'?27:room.id==='balcony'?29:28,baseHumidity=room.id==='bedroom'?49:room.id==='bathroom'?65:room.id==='balcony'?55:52;let target=baseline,humidity=baseHumidity,tau=30;
   if(climate&&state.acOn){tau=4;target=state.temperature;if(state.acMode===2)target=Math.min(state.temperature,state.acTarget);else if(state.acMode===5)target=Math.max(state.temperature,state.acTarget);else if(state.acMode===3)humidity=45;}
   const previous=`${state.temperature.toFixed(1)}:${Math.round(state.humidity)}`,temperature=state.temperature+(target-state.temperature)*(1-Math.exp(-dt/tau)),moisture=state.humidity+(humidity-state.humidity)*(1-Math.exp(-dt/tau));for(const d of members){this.states[d.did].temperature=temperature;this.states[d.did].humidity=moisture;}
   if(previous!==`${temperature.toFixed(1)}:${Math.round(moisture)}`){changed=true;const samples=this.samples[room.id];if(!samples.length||Date.now()-samples.at(-1)!.time>=10000){samples.push({time:Date.now(),temperature,humidity:moisture});if(samples.length>360)samples.shift();}}
  }
  if(changed)this.emit(true);
 }
 dispose(){clearInterval(this.timer);this.listeners.clear();}
}
