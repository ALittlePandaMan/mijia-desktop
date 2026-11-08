import type {Action,DevicePanel} from './types';
import {capabilityCategory} from './device-capabilities';
import {isReadableValue} from './panel-layout';
/** Original standard washer runtime semantics; starting a new program remains
 * exclusively in the firmware/config-validated program transaction. */
export function applianceActionReason(panel:DevicePanel,action:Action):string|undefined {
 if(panel.model==='midjd8.washer.42'||capabilityCategory(panel.specType)!=='washer')return;
 const service=panel.services.find(s=>s.siid===action.siid&&s.name==='washer');if(!service)return '设备动作尚未适配。';
 const meaning=(name:string)=>{const p=service.properties.find(p=>p.name===name);return isReadableValue(p)?p.valueList?.find(v=>v.value===p.value)?.description.trim().toLowerCase():undefined;};
 const status=meaning('status'),fault=meaning('fault');
 if(fault!=='no faults'&&fault!=='no fault')return '故障状态尚未确认或设备存在故障。';
 const lock=panel.services.filter(s=>s.name==='physical-controls-locked').flatMap(s=>s.properties).find(p=>p.name==='physical-controls-locked');if(lock&&(!isReadableValue(lock)||lock.value!==false))return '请先解除童锁。';
 const enabled=action.name==='pause'?status==='busy':action.name==='start-wash'?status==='paused':action.name==='stop-washing'?status==='busy'||status==='paused':false;
 return enabled?undefined:'当前运行状态不支持此操作。';
}
