import type {AppError,DeviceContext} from './types';
import {ReportOperations} from './report-operations';
export const ceilingFanModel='yeelink.ven_fan.vf3';
export interface CeilingFanReport{did:string;model:string;lightOn:boolean;fanOn:boolean;gear:0|1;swingAction:'swing'|'stop'|'angle';swingAngle:number;brightness:number;lightMode:'daylight'|'nightlight';revision:string}
export type CeilingFanChange={operation:'fan';on:boolean;gear?:0|1}|{operation:'gear';gear:0|1}|{operation:'light';on:boolean}|{operation:'swing';on:boolean}|{operation:'angle'|'brightness';value:number};
export function projectCeiling(r:CeilingFanReport,c:CeilingFanChange):CeilingFanReport{
 switch(c.operation){case'fan':return{...r,fanOn:c.on,gear:c.gear??r.gear};case'gear':return{...r,fanOn:true,gear:c.gear};case'light':return{...r,lightOn:c.on};case'swing':return{...r,swingAction:c.on?'swing':'stop'};case'angle':return{...r,swingAction:'angle',swingAngle:c.value};case'brightness':return{...r,brightness:c.value,lightMode:'daylight'};}
}
export class CeilingFanState{
 private state:ReportOperations<CeilingFanReport,CeilingFanChange>;
 constructor(api:{read:(c:DeviceContext)=>Promise<CeilingFanReport>;change:(c:DeviceContext,baseline:string,change:CeilingFanChange)=>Promise<{report:CeilingFanReport;confirmed:boolean}>},changed:()=>void,failed:(e:AppError)=>void){this.state=new ReportOperations({read:api.read,send:(c,r,i)=>api.change(c,r.revision,i),validate:(r,c)=>{if(r.did!==c.did||r.model!==ceilingFanModel||!r.revision||typeof r.fanOn!=='boolean'||typeof r.lightOn!=='boolean'||![0,1].includes(r.gear)||!Number.isInteger(r.swingAngle)||r.swingAngle<0||r.swingAngle>180||!Number.isInteger(r.brightness)||r.brightness<1||r.brightness>100||!['swing','stop','angle'].includes(r.swingAction)||!['daylight','nightlight'].includes(r.lightMode))throw Error('凉霸状态与当前设备不匹配。');},key:i=>['fan','gear'].includes(i.operation)?'fan':['swing','angle'].includes(i.operation)?'orientation':i.operation,project:projectCeiling,matches:(r,i)=>{const p=projectCeiling(r,i);return Object.keys(p).every(k=>p[k as keyof CeilingFanReport]===r[k as keyof CeilingFanReport]);}},changed,failed);}
 get report(){return this.state.report;}get actual(){return this.state.actual;}get error(){return this.state.error;}get loading(){return this.state.loading;}get pending(){return this.state.pending;}get message(){return this.state.message;}get uncertain(){return this.state.uncertain;}
 bind(c:DeviceContext,scope:string){this.state.bind(c,scope);}close(){this.state.close();}read(){return this.state.read();}adopt(){this.state.adopt();}change(c:CeilingFanChange){return this.state.change(c);}
}
