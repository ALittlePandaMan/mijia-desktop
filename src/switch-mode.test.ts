import {expect,it} from 'vitest';
import {switchPolicy} from './switch-mode';
import type {DevicePanel,Property} from './types';
const on:Property={siid:7,piid:4,name:'on',description:'',format:'bool',access:['read','write'],value:true,code:0};
function panel(value:number|null,code=0):DevicePanel{return {did:'fixture',model:'yeelink.switch.ylsw6',services:[{siid:7,name:'switch',description:'',actions:[],properties:[on,{...on,piid:9,name:'mode',format:'uint8',value,code,valueList:[{value:0,description:'Wired And Wireless'},... [1,2,3].map(value=>({value,description:'Wireless'}))]}]}]}}
it('labels every wireless variant and prevents toggling, including paused-power-on flex',()=>{
 for(const [value,label] of [[1,'无线开关'],[2,'灵动开关'],[3,'无线开关']] as const){const p=switchPolicy(panel(value),on);expect(p.label).toBe(label);expect(p.reason).toContain('不能切断供电')}
 expect(switchPolicy(panel(0),on)).toEqual({});
});
it('requires the current successful same-channel mode read, never a reported record',()=>{
 for(const p of [panel(null),panel(0,-1),panel(99)]){p.services[0].properties[1].lastReported={value:0,updatedAt:1,retrievedAt:1};expect(switchPolicy(p,on).reason).toBeTruthy()}
 const p=panel(1);p.services.unshift({...p.services[0],siid:6,properties:[{...on,siid:6}]});expect(switchPolicy(p,{...on,siid:6})).toEqual({});
});
it('does not call another brand mode 2 flex without evidence',()=>{const p=panel(2);p.model='other.switch.model';expect(switchPolicy(p,on).label).toBe('无线开关')});
