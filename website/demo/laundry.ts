import {airerPage} from './desktop/src/ui/airer-page';
import {washerPage,type WasherView} from './desktop/src/ui/washer-page';
import {washerRuntimePage} from './desktop/src/ui/washer-runtime-page';
import {washerRecordsPage} from './desktop/src/ui/washer-records-page';
import {airerNight,type AirerView} from './desktop/src/airer';
import {PositionMotion} from './desktop/src/position-motion';
import {WasherCommands} from './desktop/src/washer-commands';
import {WasherRecords,type WasherLogRange,type WasherLogEntry} from './desktop/src/washer-records';
import {washerPrograms,newWasherDraft,changeWasherDraft,washerFields,washerMinutes,type WasherDraft} from './desktop/src/washer';
import {washerConfigSample} from './desktop/src/fixtures/laundry-sample';
import type {WasherRuntimeControl} from './desktop/src/washer-runtime';
import type {Device,DeviceContext,DevicePanel} from './desktop/src/types';
import {DemoStore,type DeviceId} from './store';

/** Only the data/command adapter is website-specific. Every visible laundry
 * page, program selector, parameter sheet, record and runtime control is desktop UI. */
export class DemoLaundry {
 private id?:DeviceId;
 private airerView:AirerView={page:'home'};
 private airerMotion=new PositionMotion();
 private view:WasherView='home';
 private draft?:WasherDraft;
 private confirmation?:WasherRuntimeControl;
 private queued=false;
 private commands:WasherCommands;
 private records:WasherRecords;
 private changed=()=>{if(this.queued||!this.id)return;this.queued=true;queueMicrotask(()=>{this.queued=false;if(this.id)this.redraw();});};
 constructor(private store:DemoStore,private redraw:()=>void,private close:()=>void){
  this.commands=new WasherCommands({
   preview:async(context,input)=>{const panel=store.panel(context.did as DeviceId),report=washerConfigSample(context.did),program=washerPrograms(report,panel).find(program=>program.name===input.program),draft={program:input.program,values:input.values},fields=program?washerFields(report,program,panel,draft):[];return {estimatedMinutes:program?washerMinutes(program,fields):0,canStart:!!program&&fields.length>0,reason:null,requestId:null,panel};},
   start:async(context,_request,input)=>{store.startWasher(context.did as DeviceId,{program:input.program,values:input.values});if(this.id===context.did){this.view='runtime';this.changed();}return {status:'confirmed',phase:'start',message:'',panel:store.panel(context.did as DeviceId)};},
   confirm:async(context)=>({status:'confirmed',phase:'start',message:'',panel:store.panel(context.did as DeviceId)}),
  },this.changed,panel=>{if(panel.did===this.id&&panel.washerRuntime?.active){this.view='runtime';this.changed();}},()=>{});
  this.records=new WasherRecords({
   records:async(context,range)=>{const logs=this.logs(range);return {did:context.did,range,fetchedAt:Date.now(),buckets:logs.map(entry=>({startTime:entry.startTime,endTime:entry.endTime,value:1})),frequentModes:[24,3,18],logs,nextId:null};},
   detail:async(context,range,_cursor,recordId)=>{const entry=this.logs(range).find(entry=>entry.id===recordId)!;return {did:context.did,entry,parameters:{waterTemperature:40,rinseTimes:2,spinSpeed:800,dryingLevel:0,nightWash:false,steam:false,highWater:false}};},
  },this.changed,()=>{});
 }
 private context():DeviceContext{return {homeId:'demo-home',generation:1,did:this.id!};}
 open(id:DeviceId){this.dispose();this.id=id;this.airerView={page:'home'};this.view=this.store.panel(id).washerRuntime?.active?'runtime':'home';}
 dispose(){this.id=undefined;this.airerMotion.reset();this.commands.reset();this.records.reset();this.draft=undefined;this.confirmation=undefined;}
 private home=()=>{this.view='home';this.draft=undefined;this.confirmation=undefined;this.commands.reset();this.changed();};
 private logs(range:WasherLogRange):WasherLogEntry[]{
  const end=new Date(range.endTime);end.setHours(10,0,0,0);
  return Array.from({length:range.aggregation==='month'?18:5},(_,i)=>{const startTime=end.getTime()-i*(range.aggregation==='month'?16:2)*86400000;return {id:'demo-wash-'+startTime,mode:[24,3,18][i%3],startTime,endTime:startTime+(i%3===1?15:54)*60000};}).filter(entry=>entry.startTime>=range.startTime&&entry.endTime<=range.endTime);
 }
 back():boolean{
  if(!this.id)return false;
  if(this.airerView.picker){this.airerView.picker=undefined;this.changed();return true;}
  if(this.airerView.page!=='home'){this.airerView={page:'home'};this.changed();return true;}
  if(this.view==='records'){
   if(this.records.picker){this.records.picker=undefined;this.changed();}
   else if(this.records.selected)this.records.closeDetail();else this.home();return true;
  }
  if(this.confirmation){this.confirmation=undefined;this.changed();return true;}
  if(this.draft?.selector){this.draft={...this.draft,selector:undefined};this.changed();return true;}
  if(this.view!=='home'&&this.view!=='runtime'){this.home();return true;}
  return false;
 }
 render(device:Device,artwork:()=>HTMLElement):HTMLElement{
  const id=this.id!,panel=this.store.panel(id),context=this.context();
  if(panel.model==='hyd.airer.1s'){const state=this.store.stateFor(id);this.airerMotion.update('demo-'+id,{position:state.airerPosition,status:state.airerStatus,target:state.airerTarget,journey:100/15});return airerPage({device,panel,view:this.airerView,cached:false,busy:false,artwork,back:this.close,
   commands:{display:value=>value,blocked:false,pendingIntent:undefined,message:'',uncertain:false,adopt:()=>{},motion:this.airerMotion,verifyMotion:async()=>{},opening:{showing:false}},
   home:()=>{this.airerView={page:'home'};this.changed();},changed:this.changed,
   lift:intent=>{const motor=panel.services.flatMap(service=>service.properties).find(p=>p.siid===2&&p.piid===2)!;this.store.write(id,motor,intent==='up'?1:intent==='down'?2:0);},
   write:(p,v)=>this.store.write(id,p,v),night:()=>{const night=airerNight(panel);if(night){this.airerView={page:'night',draft:{expected:{...night},target:{...night}}};this.changed();}},save:()=>{this.airerView={page:'home'};this.changed();},compatibility:()=>{},refresh:this.changed,
  });}
  const report=washerConfigSample(id),programs=washerPrograms(report,panel);
  if(this.view==='home'&&panel.washerRuntime?.active)this.view='runtime';
  if(this.view==='runtime')return washerRuntimePage({device,panel,programs,cached:false,commands:{pending:false,message:'',blocked:false},confirmation:this.confirmation,back:this.close,refresh:this.changed,
   choose:control=>{if(control.confirmation){this.confirmation=control;this.changed();}else this.runtime(control);},cancel:()=>{this.confirmation=undefined;this.changed();},submit:()=>{if(this.confirmation)this.runtime(this.confirmation);},
  });
  if(this.view==='records')return washerRecordsPage({state:this.records,programs,config:report,panel,artwork,
   back:()=>{if(this.records.selected)this.records.closeDetail();else this.home();},select:selection=>{void this.records.load(context,selection);},more:()=>{void this.records.load(context,this.records.selection,true);},retry:()=>{void this.records.retry(context);},bucket:index=>{void this.records.selectBucket(context,index);},open:row=>{void this.records.openDetail(context,row);},retryDetail:()=>{if(this.records.selected)void this.records.openDetail(context,this.records.selected);},changed:this.changed,
  });
  return washerPage({device,panel,report,programs,draft:this.draft,view:this.view,loading:false,commands:this.commands,artwork,back:this.close,home:this.home,more:()=>{this.view='more';this.changed();},records:()=>{this.view='records';void this.records.load(context);},
   select:program=>{this.commands.reset();this.draft=newWasherDraft(report,program);this.view='program';this.commands.edit(context,this.draft);this.changed();},
   change:draft=>{if(this.commands.locked||!this.draft)return;const program=programs.find(program=>program.name===draft.program);if(!program)return;const name=Object.keys(draft.values).find(key=>draft.values[key]!==this.draft!.values[key]);this.draft=name?changeWasherDraft(report,program,panel,this.draft,name,draft.values[name]):{...this.draft,selector:draft.selector};if(name)this.commands.edit(context,this.draft);this.changed();},
   refresh:()=>{if(this.draft)void this.commands.refresh(context,this.draft);},order:()=>{},changeOrder:()=>{},cancelOrder:()=>{},start:()=>{if(this.draft)void this.commands.start(context,this.draft);},confirm:()=>{if(this.draft)void this.commands.confirm(context,this.draft);},
  });
 }
 private runtime(control:WasherRuntimeControl){this.confirmation=undefined;this.store.controlWasher(this.id!,control.key);if(['stop','off'].includes(control.key))this.view='home';this.changed();}
}
