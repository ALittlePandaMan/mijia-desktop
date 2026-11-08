import type {Device,DevicePanel,Property} from './types';
import {controlReason,isReadableValue} from './panel-layout';
export type PurifierSetting='pipeline'|'water-mode'|'default-cup'|'flushing';
const bindings={pipeline:[2,5,'pipeline-connection','bool'],'water-mode':[2,4,'no-old-water-mode','uint8'],'default-cup':[7,2,'out-water-cup','uint8'],flushing:[2,7,'holiday-mode','bool']}as const;
export function isPurifierSetting(p:Property):boolean{return Object.values(bindings).some(([siid,piid,name,format])=>p.siid===siid&&p.piid===piid&&p.name===name&&p.format===format);}
export function purifierSetting(panel:DevicePanel,key:PurifierSetting):Property|undefined{
 if(panel.model!=='xiaomi.waterpuri.lx32'||panel.unsupportedReason)return;
 const[siid,piid,name,format]=bindings[key],rows=panel.services.flatMap(s=>s.properties.filter(p=>s.siid===siid&&p.siid===siid&&p.piid===piid&&p.name===name&&p.format===format));return rows.length===1?rows[0]:undefined;
}
export function purifierSettingReason(panel:DevicePanel,device:Device,key:PurifierSetting,cached:boolean,busy:boolean):string|undefined{
 const p=purifierSetting(panel,key);
 if(panel.did!==device.did||panel.model!==device.model)return'设备设置与当前设备不匹配。';
 if(device.sharedReadOnly)return'此共享设备只有查看权限。';
 if(cached)return'请先读取当前设备状态。';
 const reason=controlReason(p,device.online,busy||!!p?.pending);if(reason)return reason;
 if(!p||p.code!==0||!isReadableValue(p)||(key==='pipeline'||key==='flushing'?typeof p.value!=='boolean':typeof p.value!=='number'||!Number.isInteger(p.value)))return'请先读取此设置的当前状态。';
 if(key==='water-mode'&&!purifierModes.some(mode=>mode.value===p.value))return'当前无陈水模式尚未识别，请重新读取。';
 if(key==='flushing'){
  const tds=panel.services.flatMap(s=>s.siid===4?s.properties:[]).find(p=>p.siid===4&&p.piid===2&&p.name==='tds-out');if(tds?.code!==0||tds.unsupportedReason||typeof tds.value!=='number'||!Number.isFinite(tds.value))return'请先读取当前设备水质状态。';
 }
 if(key==='pipeline'||key==='default-cup'){
  const status=panel.services.flatMap(s=>s.siid===2?s.properties:[]).find(p=>p.siid===2&&p.piid===2&&p.name==='status'),meaning=status?.code===0&&isReadableValue(status)?status.valueList?.find(v=>v.value===status.value)?.description.toLowerCase():undefined;
  if(meaning!=='idle')return meaning==='busy'?'请在制水结束后操作。':'请先读取当前制水状态。';
 }
 if(key==='default-cup'&&!panel.purifier?.cups.length)return'请先读取当前杯量。';
}
export const purifierModes=[{value:0,title:'零陈水模式',description:'日常用水后智能冲洗滤芯，提升出水水质，所产生的额外水耗适中'},{value:1,title:'增强零陈水模式',description:'日常用水后智能冲洗滤芯，进一步提升出水水质，所产生的额外水耗偏高'},{value:2,title:'关闭零陈水',description:'日常用水后不进行智能冲洗，仅在长期未用时启动防异味冲洗，所产生的额外水耗最低'}]as const;
