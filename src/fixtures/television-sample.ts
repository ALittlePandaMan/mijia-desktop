import instance from '../../src-tauri/src/fixtures/compatibility/television--xiaomi.tv.4kh1.json';
import type {DevicePanel,Json} from '../types';
interface RawProperty {iid:number;type:string;description:string;format:string;access:string[];unit?:string;'value-range'?:number[];'value-list'?:{value:Json;description:string}[]}
interface RawService {iid:number;type:string;description:string;properties?:RawProperty[];actions?:{iid:number;type:string;description:string;in:number[];out:number[]}[]}
export function televisionSample():DevicePanel {
 const raw=instance as unknown as {type:string;services:RawService[]};
 return{did:'fixture-tv',model:'xiaomi.tv.4kh1',specType:raw.type,services:raw.services.map(s=>({siid:s.iid,name:s.type.split(':')[3],description:s.description,properties:(s.properties??[]).map(p=>({siid:s.iid,piid:p.iid,name:p.type.split(':')[3],description:p.description,format:p.format,access:p.access,unit:p.unit,valueRange:p['value-range'] as [number,number,number]|undefined,valueList:p['value-list'],code:0,value:p.format==='bool'?false:p.format==='string'?'':p['value-range']?50:1})),actions:(s.actions??[]).map(a=>({siid:s.iid,aiid:a.iid,name:a.type.split(':')[3],description:a.description,in:a.in,out:a.out}))}))};
}
