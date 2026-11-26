// Mock-only integration checks. Never opens a browser or connects to a device.
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'vite';

const id='virtual:card-demo-check',source=`
export {DemoStore,devices} from ${JSON.stringify(path.resolve('demo/store.ts').replaceAll('\\','/'))};
export {demoCardPresentation} from ${JSON.stringify(path.resolve('demo/card-presentation.ts').replaceAll('\\','/'))};
export {packCards} from ${JSON.stringify(path.resolve('demo/desktop/src/card-size.ts').replaceAll('\\','/'))};
export {insertCardIds} from ${JSON.stringify(path.resolve('demo/desktop/src/card-interaction.ts').replaceAll('\\','/'))};
`;
const result=await build({configFile:false,publicDir:false,logLevel:'silent',plugins:[{name:'mock-card-check-entry',resolveId(name){if(name===id)return '\0'+id;},load(name){if(name==='\0'+id)return source;}}],build:{ssr:true,write:false,rolldownOptions:{input:id,output:{format:'es'}}}});
const code=result.output.find(entry=>entry.type==='chunk'&&entry.isEntry).code;
const originalWindow=globalThis.window,originalMatchMedia=globalThis.matchMedia,originalFetch=globalThis.fetch;
globalThis.window={setInterval:()=>0};
globalThis.matchMedia=()=>({matches:false});
globalThis.fetch=()=>{throw Error('Network access is forbidden in card-demo checks');};
const stores=[];
try{
 const {DemoStore,devices,demoCardPresentation,packCards,insertCardIds}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const parent=new DemoStore(),commands=[],child=new DemoStore({send:command=>commands.push(command)});stores.push(parent,child);
 child.applySnapshot(parent.snapshot(),false);
 const ids=devices.map(device=>device.did),initial=child.snapshot();
 const livingOrder=child.cardOrder('living');
 const swapped=insertCardIds(livingOrder,'switch','fan','after');
 assert.ok(swapped,'A card must be able to move after another card');
 assert.deepEqual(swapped.filter(id=>id!=='switch'),livingOrder.filter(id=>id!=='switch'),'An insertion keeps the relative ordering of all other cards');
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
 const temperature=()=>presentation().controls.find(control=>control.kind==='stepper');
 assert.equal(presentation().headerControl,'2:1');
 assert.equal(temperature().appearance,'temperature');
 assert.deepEqual(temperature().range,{min:16,max:31,step:0.5,unit:'℃'});
 assert.equal(temperature().enabled,false);
 const sensorBefore=child.stateFor('thermo').temperature;
 child.write('ac',property('ac','on'),true);
 assert.equal(child.shortcut('ac').selected,true,'Power state must update before the parent receives the command');
 assert.equal(temperature().enabled,true,'Dependent input must enable immediately');
 child.write('ac',property('ac','target-temperature'),25);
 child.write('ac',property('ac','target-temperature'),26);
 assert.equal(child.stateFor('ac').acTarget,26);assert.equal(child.stateFor('thermo').temperature,sensorBefore);
 assert.deepEqual(commands.map(command=>[command.siid,command.piid,command.value]),[[2,1,true],[2,4,25],[2,4,26]]);
 for(const command of commands.splice(0))parent.command(command);
 child.applySnapshot(parent.snapshot(),false);assert.equal(child.stateFor('ac').acTarget,26);
 assert.equal(temperature().value,26);
 child.write('ac',property('ac','target-temperature'),99);assert.equal(child.stateFor('ac').acTarget,26);assert.equal(commands.length,0);
 child.write('ac',property('ac','mode'),4);
 assert.equal(temperature().enabled,false,'Fan-only mode keeps the temperature control unavailable');
 const light=devices.find(device=>device.kind==='light'),lightModel=()=>demoCardPresentation(light,child.panel(light.did));
 const brightness=()=>lightModel().controls.find(control=>control.appearance==='white-brightness');
 assert.equal(lightModel().headerControl,'2:1');
 child.write(light.did,property(light.did,'on'),false);assert.equal(brightness().enabled,false);
 assert.equal(brightness().value,60,'Disabled brightness retains its last reading');
 child.write(light.did,property(light.did,'on'),true);assert.equal(brightness().enabled,true);
 const curtain=devices.find(device=>device.did==='curtain'),curtainModel=()=>demoCardPresentation(curtain,child.panel(curtain.did));
 assert.equal(curtainModel().headerControl,null,'The curtain keeps its original header shortcut');
 assert.deepEqual(curtainModel().rows,[['2:5']]);
 assert.equal(curtainModel().controls[0].appearance,'curtain-position');
 assert.equal(curtainModel().controls[0].curtainOpening,'double');
 child.write(curtain.did,property(curtain.did,'target-position'),40);
 assert.equal(curtainModel().controls[0].value,40);
 assert.equal(child.stateFor(curtain.did).curtainPosition,60,'The target does not overwrite the live position');
 assert.equal(child.shortcut(curtain.did).action,'pause');
 assert.equal(child.canUseLargeCard('fan'),false,'Unsupported families must not acquire invented large-card controls');
 assert.equal(child.canUseLargeCard('curtain'),true);
 child.setCardSize('fan','large');assert.equal(child.cardSize('fan'),'medium');
 const unchanged=parent.snapshot();parent.command({kind:'card-size',device:'missing-device',size:'large'});parent.command({kind:'card-size',device:'ac',size:'extra-large'});assert.deepEqual(parent.snapshot(),unchanged);
 console.log(JSON.stringify({mockOnly:true,sizes:['small','medium','large'],mixedPacking:true,sharedPreviewState:true,immediateDependentInput:true,orderedCommands:true,ranges:true,sensorIsolation:true,realDeviceCalls:0}));
}finally{
 for(const store of stores)store.dispose();globalThis.window=originalWindow;globalThis.matchMedia=originalMatchMedia;globalThis.fetch=originalFetch;
}
