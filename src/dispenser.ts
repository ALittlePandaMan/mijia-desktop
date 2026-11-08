import type {AppError,ControlResult,DeviceContext,DevicePanel} from './types';
import {DeviceOpening} from './device-opening';
import {ReportOperations,panelReadback,panelDisplay} from './report-operations';
export const dispenserModel='xiaomi.ysj.gxj';
export interface DispenserMode {id:number;name:string;temperature:number;volumes:number[]}
export interface DispenserSnapshot {status:number|null;fault:number|null;temperature:number|null;modes:DispenserMode[];modeSource:string|null;modeError:string|null;childLock:number|null;screen:number|null;defaultMode:number|null;dnd:boolean|null;dndPeriod:string|null;progress:number|null;sterilizationCycle:number|null}
export type DispenserSetting='childLock'|'screen'|'defaultMode';
export type DispenserChange={operation:'setting';field:DispenserSetting;expected:number;value:number}|{operation:'modes';expected:string;modes:DispenserMode[]};
export type DispenserPicker={kind:'setting';field:DispenserSetting;expected:number;value:number}|{kind:'temperature'|'volume';value:number;index?:number;add?:boolean}|{kind:'name';value:string};
export interface DispenserView {page:'home'|'mode'|'new'|'sort'|'cups'|'settings'|'dnd'|'statistics'|'records'|'sterilization'|'reminders'|'compatibility'|'selfcheck'|'selfcheck-history'|'selfcheck-report';modeId?:number;draft?:DispenserMode;expected?:string;order?:DispenserMode[];volumes?:number[];selected?:number;picker?:DispenserPicker;discard?:boolean;dismissedDrain?:number}
export function dispenserProfile(p:DevicePanel):boolean{return p.model===dispenserModel&&!p.unsupportedReason&&!!p.specType?.startsWith('urn:miot-spec-v2:device:water-dispenser:')&&!!p.services.find(s=>s.siid===2)?.properties.find(p=>p.piid===7&&p.name==='local-mode-config'&&p.format==='string');}
export const volumeText=(n:number)=>n===999?'持续出水':`${n}ml`;
export const volumeChoices=[...Array.from({length:23},(_,i)=>80+i*10),...Array.from({length:13},(_,i)=>350+i*50),999];
export const settingChoices={childLock:['50℃及以上热水需要解锁','任意温度的水都需要解锁','任意温度的水都不用解锁'],screen:['无使用后1分钟','无使用后3分钟','无使用后5分钟','常亮']}as const;
export function modeNameError(name:string,modes:DispenserMode[],id?:number):string|undefined{
 const weight=name.split('').reduce((n,c)=>n+(c.charCodeAt(0)<=255?1:2),0);
 if(!name.trim())return'请输入模式名称';if(/[\[\],\u0000-\u001f\u007f-\u009f]/.test(name))return'名称不能包含逗号、方括号或控制字符';if(weight>12)return'最多6个汉字或12个字符';if(modes.some(m=>m.id!==id&&m.name===name))return'名称不能重复';
}
export function targetMatches(p:DevicePanel,c:DispenserChange):boolean{
 const s=p.dispenser;if(!dispenserProfile(p)||!s)return false;
 if(c.operation==='setting')return s[c.field]===c.value;
 return !s.modeError&&typeof s.modeSource==='string'&&s.modes.length===c.modes.length&&s.modes.every((m,i)=>{const n=c.modes[i];return m.id===n.id&&m.name===n.name&&m.temperature===n.temperature&&m.volumes.length===n.volumes.length&&m.volumes.every((v,j)=>v===n.volumes[j]);});
}
const identity=(c:DeviceContext)=>JSON.stringify([c.homeId,c.generation,c.did]);
export function projectDispenser(panel:DevicePanel,change:DispenserChange):DevicePanel{const s=panel.dispenser;if(!s)return panel;return{...panel,dispenser:change.operation==='setting'?{...s,[change.field]:change.value}:{...s,modes:structuredClone(change.modes)}};}
export class DispenserCommands{
 private state:ReportOperations<DevicePanel,DispenserChange>;private context='';private lastPanel?:DevicePanel;private unreadable=false;readonly opening=new DeviceOpening(()=>this.changed());
 constructor(transport:{change:(c:DeviceContext,v:DispenserChange)=>Promise<ControlResult>;read:(c:DeviceContext)=>Promise<DevicePanel>},private changed:()=>void,accept:(c:DeviceContext,p:DevicePanel)=>void,failed:(e:AppError)=>void){this.state=new ReportOperations({read:transport.read,accepted:accept,send:async(c,r,i)=>{const baseline=r.dispenser;if(!baseline)throw {kind:'unavailable',message:'当前管线机设置尚未读取。'};const change=i.operation==='setting'?{...i,expected:baseline[i.field]??i.expected}:{...i,expected:baseline.modeSource??i.expected};const result=await transport.change(c,change);return{report:result.panel,confirmed:result.verified};},validate:(p,c)=>{if(p.did!==c.did||!dispenserProfile(p))throw Error('回读与当前管线机不匹配。');},key:i=>i.operation==='setting'?i.field:'modes',project:projectDispenser,matches:targetMatches},changed,failed);}
 get version(){return this.state.version;}get pending(){return this.state.pending;}get blocked(){return this.unreadable||!!this.state.error;}get message(){return this.state.message;}get uncertain(){return this.state.uncertain;}get target(){return this.state.intents.at(-1);}
 bind(c:DeviceContext,scope:string){this.context=identity(c);this.state.bind(c,scope);if(this.state.actual)void this.state.read();}close(){this.context='';this.state.close();this.opening.cancel();this.lastPanel=undefined;}
 display(panel:DevicePanel){if(panel!==this.lastPanel){this.lastPanel=panel;this.state.seed(panelReadback(panel));}return panelDisplay(this.state.report??panel,panel);}
 adopt(){this.state.adopt();this.changed();}
 async change(c:DeviceContext,change:DispenserChange):Promise<boolean>{if(identity(c)!==this.context||this.blocked)return false;const copy=structuredClone(change);if(!this.state.actual)await this.state.read();void this.state.change(copy);return true;}
 async refresh(c:DeviceContext):Promise<boolean>{if(identity(c)!==this.context)return false;await this.state.read();this.unreadable=!!this.state.error||!this.state.actual?.dispenser?.modeSource||!!this.state.actual.dispenser.modeError;return !this.unreadable;}
}
