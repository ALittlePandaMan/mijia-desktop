import type {AppError,DeviceContext} from './types';
import {ReportOperations} from './report-operations';
export const bathHeaterModel='yeelink.bhf_light.v13';
export interface BathHeaterReport{did:string;model:string;lightOn:boolean;mode:string;gears:number;bathDelay:number;lightDelay:number;targetTemperature:number;revision:string}
export type BathHeaterChange={operation:'mode';mode:string;gear:number;enabled?:boolean}|{operation:'light';on:boolean}|{operation:'stop'};
export function bathGear(r:BathHeaterReport,mode:string):number{return mode==='warmwind'?Math.floor(r.gears/100):mode==='coolwind'?Math.floor(r.gears/10)%10:mode==='venting'?r.gears%10:0}
export function bathSelected(r:BathHeaterReport|undefined,mode:string,gear=0):boolean{return !!r&&r.mode.split('|').includes(mode)&&bathGear(r,mode)===gear}
interface BathIntent{change:BathHeaterChange;enabled?:boolean}
export function projectBath(r:BathHeaterReport,c:BathHeaterChange,enabled=true):BathHeaterReport{
 if(c.operation==='light')return{...r,lightOn:c.on};if(c.operation==='stop')return{...r,mode:'bh_off'};
 let modes=r.mode==='bh_off'?[]:r.mode.split('|');if(c.mode==='venting')modes=modes.filter(m=>m!=='venting');else modes=modes.filter(m=>m==='venting');if(enabled)modes.push(c.mode);
 const place=c.mode==='warmwind'?100:c.mode==='coolwind'?10:c.mode==='venting'?1:0,gears=place?r.gears-bathGear(r,c.mode)*place+(enabled?c.gear:0)*place:r.gears;
 return{...r,mode:modes.join('|')||'bh_off',gears};
}
export class BathHeaterState{
 private state:ReportOperations<BathHeaterReport,BathIntent>;
 constructor(api:{read:(c:DeviceContext)=>Promise<BathHeaterReport>;change:(c:DeviceContext,baseline:string,change:BathHeaterChange)=>Promise<{report:BathHeaterReport;confirmed:boolean}>},changed:()=>void,failed:(e:AppError)=>void){this.state=new ReportOperations({read:api.read,send:(c,r,i)=>api.change(c,r.revision,i.change.operation==='mode'?{...i.change,enabled:i.enabled}:i.change),validate:(r,c)=>{if(r.did!==c.did||r.model!==bathHeaterModel||!r.revision||!Number.isFinite(r.targetTemperature)||r.targetTemperature<25||r.targetTemperature>45)throw Error('浴霸状态与当前设备不匹配。');},key:i=>i.change.operation==='light'?'light':i.change.operation==='stop'?'stop':i.change.mode==='venting'?'venting':'wind',supersedes:i=>i.change.operation==='stop'?['venting','wind']:i.change.operation==='mode'?['stop']:[],project:(r,i)=>projectBath(r,i.change,i.enabled),matches:(r,i)=>i.change.operation==='light'?r.lightOn===i.change.on:i.change.operation==='stop'?r.mode==='bh_off':i.enabled?bathSelected(r,i.change.mode,i.change.gear):!r.mode.split('|').includes(i.change.mode)},changed,failed);}
 get report(){return this.state.report;}get actual(){return this.state.actual;}get error(){return this.state.error;}get loading(){return this.state.loading;}get pending(){return this.state.pending;}get message(){return this.state.message;}get uncertain(){return this.state.uncertain;}
 bind(c:DeviceContext,scope:string){this.state.bind(c,scope);}close(){this.state.close();}read(){return this.state.read();}adopt(){this.state.adopt();}
 change(change:BathHeaterChange){return this.state.change({change,enabled:change.operation==='mode'?!bathSelected(this.report,change.mode,change.gear):undefined});}
}
