// Mock-only integration checks. Never opens a browser or connects to a device.
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'vite';

const id='virtual:card-demo-check',source=`
export {DemoStore,devices} from ${JSON.stringify(path.resolve('demo/store.ts').replaceAll('\\','/'))};
export {demoCardPresentation} from ${JSON.stringify(path.resolve('demo/card-presentation.ts').replaceAll('\\','/'))};
export {packCards} from ${JSON.stringify(path.resolve('demo/desktop/src/card-size.ts').replaceAll('\\','/'))};
export {swapCardIds} from ${JSON.stringify(path.resolve('demo/desktop/src/card-interaction.ts').replaceAll('\\','/'))};
`;
const result=await build({configFile:false,publicDir:false,logLevel:'silent',plugins:[{name:'mock-card-check-entry',resolveId(name){if(name===id)return '\0'+id;},load(name){if(name==='\0'+id)return source;}}],build:{ssr:true,write:false,rolldownOptions:{input:id,output:{format:'es'}}}});
const code=result.output.find(entry=>entry.type==='chunk'&&entry.isEntry).code;
const originalWindow=globalThis.window,originalMatchMedia=globalThis.matchMedia,originalFetch=globalThis.fetch;
globalThis.window={setInterval:()=>0};
globalThis.matchMedia=()=>({matches:false});
globalThis.fetch=()=>{throw Error('Network access is forbidden in card-demo checks');};
const stores=[];
try{
 const {DemoStore,devices,demoCardPresentation,packCards,swapCardIds}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const parent=new DemoStore(),commands=[],child=new DemoStore({send:command=>commands.push(command)});stores.push(parent,child);
 child.applySnapshot(parent.snapshot(),false);
 const ids=devices.map(device=>device.did),initial=child.snapshot();
 const livingOrder=child.cardOrder('living');
 const swapped=swapCardIds(livingOrder,'switch','fan',initial.cardSizes,4);
 assert.ok(swapped,'Two compatible cards must be able to exchange slots');
 assert.equal(swapCardIds(livingOrder,'switch','curtain',initial.cardSizes,4),undefined,'A swap cannot displace a third card');
 child.setCardOrder('living',swapped);
 assert.deepEqual(child.cardOrder('living'),swapped);
 parent.command(commands.shift());child.applySnapshot(parent.snapshot(),false);
 assert.deepEqual(parent.cardOrder('living'),swapped);
 assert.deepEqual(child.cardOrder('living'),swapped);
 assert.deepEqual(child.cardOrder('all'),ids,'Room rearrangement must stay in its own tab');
 assert.deepEqual(child.snapshot().cardSizes,initial.cardSizes);
 assert.deepEqual(child.snapshot().states,initial.states);
 parent.command({kind:'card-order',room:'living',ids:swapped.map(id=>id==='switch'?'bedroom-ac':id)});
 assert.deepEqual(parent.cardOrder('living'),swapped,'A room cannot admit unrelated device IDs');
 for(const size of ['small','large','medium']){
  child.setCardSize('bedroom-light',size);assert.equal(child.cardSize('bedroom-light'),size);
  parent.command(commands.shift());child.applySnapshot(parent.snapshot(),false);
  assert.equal(child.cardSize('bedroom-light'),size);assert.deepEqual(child.snapshot().states,initial.states);
  const slots=packCards(ids,child.snapshot().cardSizes,3),occupied=new Set();
  for(const slot of slots)for(let x=slot.column;x<slot.column+slot.columns;x++)for(let y=slot.row;y<slot.row+slot.rows;y++){const key=x+':'+y;assert(!occupied.has(key),'Mixed-size cards must not overlap');occupied.add(key);}
 }
 const ac=devices.find(device=>device.did==='ac'),property=(id,name)=>child.panel(id).services.flatMap(service=>service.properties).find(p=>p.name===name);
 const presentation=()=>demoCardPresentation(ac,child.panel('ac'));
 assert.equal(presentation().controls.find(control=>control.kind==='stepper').enabled,false);
 const sensorBefore=child.stateFor('thermo').temperature;
 child.write('ac',property('ac','on'),true);
 assert.equal(child.shortcut('ac').selected,true,'Power state must update before the parent receives the command');
 assert.equal(presentation().controls.find(control=>control.kind==='stepper').enabled,true,'Dependent input must enable immediately');
 child.write('ac',property('ac','target-temperature'),25);
 child.write('ac',property('ac','target-temperature'),26);
 assert.equal(child.stateFor('ac').acTarget,26);assert.equal(child.stateFor('thermo').temperature,sensorBefore);
 assert.deepEqual(commands.map(command=>[command.siid,command.piid,command.value]),[[2,1,true],[2,4,25],[2,4,26]]);
 for(const command of commands.splice(0))parent.command(command);
 child.applySnapshot(parent.snapshot(),false);assert.equal(child.stateFor('ac').acTarget,26);
 assert.equal(presentation().controls.find(control=>control.kind==='stepper').value,26);
 child.write('ac',property('ac','target-temperature'),99);assert.equal(child.stateFor('ac').acTarget,26);assert.equal(commands.length,0);
 const light=devices.find(device=>device.kind==='light'),lightModel=()=>demoCardPresentation(light,child.panel(light.did));
 child.write(light.did,property(light.did,'on'),false);assert.equal(lightModel().controls.find(control=>control.kind==='slider').enabled,false);
 child.write(light.did,property(light.did,'on'),true);assert.equal(lightModel().controls.find(control=>control.kind==='slider').enabled,true);
 const curtain=demoCardPresentation(devices.find(device=>device.did==='curtain'),child.panel('curtain'));
 assert.deepEqual(curtain.controls[0].options.map(option=>option.label),['打开','暂停','关闭']);
 assert.equal(demoCardPresentation(devices.find(device=>device.did==='fan'),child.panel('fan')),undefined,'Unsupported families must not acquire invented large-card controls');
 const unchanged=parent.snapshot();parent.command({kind:'card-size',device:'missing-device',size:'large'});parent.command({kind:'card-size',device:'ac',size:'extra-large'});assert.deepEqual(parent.snapshot(),unchanged);
 console.log(JSON.stringify({mockOnly:true,sizes:['small','medium','large'],mixedPacking:true,sharedPreviewState:true,immediateDependentInput:true,orderedCommands:true,ranges:true,sensorIsolation:true,realDeviceCalls:0}));
}finally{
 for(const store of stores)store.dispose();globalThis.window=originalWindow;globalThis.matchMedia=originalMatchMedia;globalThis.fetch=originalFetch;
}
