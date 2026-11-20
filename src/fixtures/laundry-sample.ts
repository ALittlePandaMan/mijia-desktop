import type {DevicePanel,Json} from '../types';
import type {WasherConfigReport} from '../washer';
import airerSchema from '../../src-tauri/src/fixtures/airer-panel.json';
import washerSchema from '../../src-tauri/src/fixtures/washer-panel.json';
import washerConfig from '../../src-tauri/src/fixtures/washer-config.json';

/** Offline showcase metadata. All values are synthetic; recorded values and
 * physical device identifiers from schema fixtures never reach the demo. */
export function laundrySample(kind:'airer'|'washer',did:string):DevicePanel {
 const schema=structuredClone(kind==='airer'?airerSchema:washerSchema) as unknown as DevicePanel;
 const defaults:Record<string,Json>=kind==='airer'?{'2:1':0,'2:2':0,'2:4':3,'2:6':60,'3:1':true,'3:3':60,'4:1':22,'4:2':0,'4:3':6,'4:4':0,'4:5':0,'4:6':20,'4:7':0,'4:8':100,'4:9':60,'4:10':60,'4:11':60}:{'2:1':false,'2:2':0,'2:3':24,'2:4':0,'2:5':40,'2:6':2,'2:7':800,'2:9':2,'2:10':0,'2:11':0,'2:16':1,'2:26':0,'2:28':false,'2:29':false};
 return {did,model:schema.model,specType:schema.specType,services:schema.services.filter(s=>s.name!=='device-information').map(service=>({...service,properties:service.properties.map(p=>{const value=defaults[`${p.siid}:${p.piid}`]??(p.format==='bool'?false:p.valueList?.[0]?.value??p.valueRange?.[0]??0);return {...p,value,code:0,lastReported:undefined,pending:undefined};})}))};
}
export function washerConfigSample(did:string):WasherConfigReport {
 return {did,model:'midjd8.washer.42',firmware:'showcase',fetchedAt:0,config:structuredClone(washerConfig) as unknown as WasherConfigReport['config']};
}
