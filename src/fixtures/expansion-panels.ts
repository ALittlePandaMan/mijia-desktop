import manifest from '../../src-tauri/src/fixtures/expansion/provenance.json';
import type {DevicePanel} from '../types';
const sources=import.meta.glob<any>('../../src-tauri/src/fixtures/expansion/*.json',{eager:true,import:'default'});
/** Raw published schemas only. Test callers add explicitly simulated values. */
export function expansionPanel(model:string):DevicePanel {
 const row=manifest.records.find(r=>r.model===model);if(!row)throw Error('Unknown expansion fixture');
 const raw=sources['../../src-tauri/src/fixtures/expansion/'+row.file];
 if(!raw)throw Error(`Missing published fixture: ${row.file}`);
 return{did:'public-fixture',model,specType:raw.type,services:raw.services.filter((s:any)=>s.iid>0).map((s:any)=>({siid:s.iid,name:s.type.split(':')[3],description:s.description??'',properties:(s.properties??[]).map((p:any)=>({siid:s.iid,piid:p.iid,name:p.type.split(':')[3],description:p.description??'',format:p.format,access:p.access??[],unit:p.unit,valueList:p['value-list'],valueRange:p['value-range']})),actions:(s.actions??[]).map((a:any)=>({siid:s.iid,aiid:a.iid,name:a.type.split(':')[3],description:a.description??'',in:a.in??[],out:a.out??[]})),events:(s.events??[]).map((e:any)=>({siid:s.iid,eiid:e.iid,name:e.type.split(':')[3],description:e.description??'',arguments:e.arguments??[]}))}))};
}
