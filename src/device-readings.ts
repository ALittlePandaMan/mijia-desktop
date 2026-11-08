import type {DevicePanel,Property} from './types';
import {propertyReading} from './panel-layout';
/** Original X1 v3 modules 11084/11087/11090/11246. Display projection only;
 * raw descriptor, values, units and every command binding remain unchanged. */
export function deviceReadingDisplay(panel:DevicePanel,p:Property):string|undefined {
 if(panel.model!=='chunmi.i_stove.x1'||panel.specType!=='urn:miot-spec-v2:device:integrated-stove:0000A056:chunmi-x1:1'||p.siid!==11)return undefined;
 const value=propertyReading(p).value;if(typeof value!=='string')return '暂无数据';
 if(p.piid===1&&p.name==='gas-stateleft')return /^-?\d{1,4}$/.test(value)?({'-2':'设备离线','0':'空闲','1':'运行中'}[String(Number(value))]??'未知状态'):'暂无数据';
 if(!/^[0-9a-f]{1,16}$/i.test(value))return '暂无数据';
 if(p.piid===9&&p.name==='gas-target-temp'||p.piid===10&&p.name==='gas-current-temp'){const n=parseInt(value,16);return Number.isSafeInteger(n)&&n<=65535?`${n}℃`:'暂无数据';}
 if(p.piid===13&&p.name==='gas-errorcode'&&value.length>=2){const n=parseInt(value.slice(0,2),16);return n===0?'无故障':`故障 ${n}`;}
 if(p.piid===38&&p.name==='gas-lefttime-left'&&value.length>=6){const minutes=parseInt(value.slice(2,4),16),seconds=parseInt(value.slice(4,6),16);return seconds<60?`${minutes}分${seconds}秒`:'暂无数据';}
 return '暂无数据';
}
