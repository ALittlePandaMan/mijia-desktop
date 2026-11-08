import air from '../src-tauri/src/fixtures/miot/air-purifier.panel.json';
import humidifier from '../src-tauri/src/fixtures/miot/humidifier.panel.json';
import water from '../src-tauri/src/fixtures/miot/water-purifier.panel.json';
import vacuum from '../src-tauri/src/fixtures/miot/vacuum.panel.json';
import provenance from '../src-tauri/src/fixtures/miot/provenance.json';
import {describe,it,expect} from 'vitest';
import {coercePropertyInput} from './logic';
import {panelLayout} from './panel-layout';
import type {Device,DevicePanel,Json,Property} from './types';
const fixtures:Record<string,unknown>={'air-purifier.panel.json':air,'humidifier.panel.json':humidifier,'water-purifier.panel.json':water,'vacuum.panel.json':vacuum,'provenance.json':provenance};
const read=(file:string)=>fixtures[file];
const initial=(prop:Property):Json=>prop.valueList?.[0]?.value??(prop.format==='bool'?false:prop.format==='string'?'model-contract-only':prop.valueRange?.[0]??0);
describe('real published models absent from the account: protocol tests, no physical device claims',()=>{
 for(const category of ['air-purifier','humidifier','water-purifier','vacuum'])it(`${category} exposes model-defined fields without a model allowlist`,()=>{
  const panel=read(`${category}.panel.json`) as DevicePanel;
  const device:Device={did:panel.did,model:panel.model,name:category,online:true,roomId:'fixture',roomName:'fixture'};
  expect(panelLayout(device,panel)).toBe('generic');
  expect(panel.unsupportedReason).toBeNull();
  const props=panel.services.flatMap(service=>service.properties);expect(props.length).toBeGreaterThan(0);
  for(const prop of props.filter(prop=>prop.access.includes('write')&&!prop.unsupportedReason)){
   const value=initial(prop);expect(coercePropertyInput(prop,typeof value==='string'?value:String(value))).toEqual(value);
   if(prop.valueList?.length)expect(()=>coercePropertyInput(prop,'__not_in_real_enum__')).toThrow();
   if(prop.valueRange){const[,max,step]=prop.valueRange;expect(()=>coercePropertyInput(prop,String(max+step))).toThrow();}
  }
  for(const service of panel.services)for(const action of service.actions)for(const piid of action.in)expect(service.properties.some(prop=>prop.piid===piid)||!!action.unsupportedReason).toBe(true);
  const proof=provenance.records.find(r=>r.category===category);expect(proof?.notInAccessibleHomes).toBe(true);expect(proof?.physicalDeviceVerified).toBe(false);
 });
});
