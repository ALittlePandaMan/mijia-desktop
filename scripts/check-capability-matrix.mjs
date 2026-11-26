// Revalidate saved public fixtures with the live TypeScript resolver. This never
// contacts Xiaomi, changes device values, or silently rewrites expected bindings.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createServer} from 'vite';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const server=await createServer({server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true,entries:[],include:[]}});
try {
 const {resolveDeviceCapabilities}=await server.ssrLoadModule('/src/device-capabilities.ts');
 for(const [name,directory] of [['device-capabilities-matrix','compatibility'],['device-catalog-matrix','catalog']]){
 const file=`src-tauri/src/fixtures/regression/${name}.json`;
 const report=JSON.parse(await fs.readFile(file,'utf8'));
 for(const row of report.records){
  const bytes=await fs.readFile(`src-tauri/src/fixtures/${directory}/${row.file}`);
  if(hash(bytes)!==row.sha256)throw Error(`Fixture changed: ${row.model}`);
  const raw=JSON.parse(bytes),panel={did:'public-model-fixture',model:row.model,specType:raw.type,services:raw.services.map(s=>({siid:s.iid,name:s.type.split(':')[3],description:s.description,
   properties:(s.properties??[]).map(p=>({siid:s.iid,piid:p.iid,name:p.type.split(':')[3],description:p.description,format:p.format,access:p.access??[],unit:p.unit,valueList:p['value-list'],valueRange:p['value-range']})),
   actions:(s.actions??[]).map(a=>({siid:s.iid,aiid:a.iid,name:a.type.split(':')[3],description:a.description,in:a.in??[],out:a.out??[]})),
   events:(s.events??[]).map(e=>({siid:s.iid,eiid:e.iid,name:e.type.split(':')[3],description:e.description,arguments:e.arguments??[]})),
  }))};
  if(!isDeepStrictEqual(resolveDeviceCapabilities(panel),row.capabilities))throw Error(`Semantic binding changed: ${row.model}`);
 }
 const policySha256=hash(await fs.readFile('src/device-capability-rules.json')),resolverSha256=hash(await fs.readFile('src/device-capabilities.ts'));
 if(process.argv.includes('--refresh-hashes')){
  Object.assign(report,{generatedAt:new Date().toISOString(),policySha256,resolverSha256});
  await fs.writeFile(file,JSON.stringify(report,null,2)+'\n');
 }else if(report.policySha256!==policySha256||report.resolverSha256!==resolverSha256)throw Error('Matrix source hash is stale; verify bindings and use --refresh-hashes.');
 console.log(JSON.stringify({matrix:name,models:report.records.length,bindingsUnchanged:true,sourceHashesCurrent:true}));
 }
} finally {await server.close();}
