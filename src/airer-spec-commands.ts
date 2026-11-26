import type {AirerIntent} from './airer';
import {airerPageEligible, airerRailAllows, standardAirerRails, type AirerRail} from './airer-spec';
import {ReportOperations} from './report-operations';
import type {AppError, ControlResult, Device, DeviceContext, DevicePanel, Json} from './types';

interface Lift { siid:number; piid:number; value:Json; intent:AirerIntent; pauseDuringTravel?:boolean }
const matchRail = (panel:DevicePanel, change:Lift) => standardAirerRails(panel).find(rail=>rail.motor.siid===change.siid&&rail.motor.piid===change.piid);
const operationKey = (siid:number) => `motor:${siid}`;
const atLimit = (rail:AirerRail) => rail.phase==='top'||rail.phase==='bottom'||
  (rail.phase==='pause'||rail.phase==='stopped')&&(rail.position===0||rail.position===100);

export class SpecAirerCommands {
  private state: ReportOperations<DevicePanel,Lift>;
  private scope='';
  private model='';
  private selected?:number;
  private readonly pauses = new Map<number,{revision:number;paused:boolean}>();

  constructor(transport:{read:(context:DeviceContext)=>Promise<DevicePanel>;write:(context:DeviceContext,change:Lift)=>Promise<ControlResult>},
    private changed:()=>void, accept:(context:DeviceContext,panel:DevicePanel)=>void, failed:(error:AppError)=>void) {
    const freshlyRead = new WeakSet<DevicePanel>();
    this.state=new ReportOperations({
      read:async context=>{const panel=await transport.read(context);freshlyRead.add(panel);return panel;},
      accepted:(context,panel)=>{if(freshlyRead.has(panel))accept(context,panel);},
      send:async (context,actual,change)=>{
        const result=await transport.write(context,change);
        if(result.panel.did!==actual.did||result.panel.model!==actual.model)throw {kind:'staleContext',message:''};
        return {report:result.verified?result.panel:actual,confirmed:result.verified};
      },
      validate:(panel,context)=>{if(panel.did!==context.did||panel.model!==this.model)throw {kind:'staleContext',message:''};},
      key:change=>operationKey(change.siid),
      project:panel=>panel,
      allowed:(panel,change)=>{
        const rail=matchRail(panel,change);
        return !!rail&&rail.values[change.intent]===change.value&&airerRailAllows(rail,change.intent);
      },
      verifyRead:(panel,change)=>{
        const rail=matchRail(panel,change);
        return !!rail&&rail.phase!=='unknown'&&(change.intent==='pause'||rail.phase!=='blocked'&&rail.fault!=='active');
      },
      matches:(panel,change)=>{
        const phase=matchRail(panel,change)?.phase;
        return phase===change.intent||phase==='stopped'&&change.intent==='pause'||
          phase==='top'&&change.intent!=='down'||phase==='bottom'&&change.intent!=='up';
      },
      interval:10000,
    },()=>{this.updatePauses();changed();},failed);
  }
  get rails(){return this.state.actual?standardAirerRails(this.state.actual):[];}
  get rail(){return this.rails.find(rail=>rail.motor.siid===this.selected)??this.rails[0];}
  get pending(){return this.state.pending;}
  get pendingIntent(){const rail=this.rail;return rail&&this.state.intents.find(change=>change.siid===rail.motor.siid)?.intent;}
  get error(){return this.state.error;}
  get activeIntent():AirerIntent|undefined {
    const rail=this.rail;
    if(!rail||rail.phase==='blocked'||rail.fault==='active')return;
    const pending=this.state.intents.find(change=>change.siid===rail.motor.siid);
    if(pending&&(pending.intent!=='pause'||pending.pauseDuringTravel))return pending.intent;
    if(rail.phase==='up'||rail.phase==='down')return rail.phase;
    if(!atLimit(rail)&&(rail.phase==='pause'||rail.phase==='stopped'&&this.pauses.get(rail.motor.siid)?.paused))return 'pause';
  }

  private updatePauses(){
    for(const rail of this.rails){
      const siid=rail.motor.siid, operation=this.state.operation(operationKey(siid)), previous=this.pauses.get(siid);
      if(operation?.pending||!operation&&!previous)continue;
      const revision=operation?.settledRevision??0;
      let paused=previous?.paused??false;
      if(atLimit(rail)||rail.fault==='active'||rail.phase==='blocked'||rail.phase==='up'||rail.phase==='down')paused=false;
      else if(operation?.outcome==='confirmed'&&revision!==previous?.revision){
        const confirmed=operation.confirmed as unknown as Lift|null;
        paused=confirmed?.pauseDuringTravel===true&&(rail.phase==='pause'||rail.phase==='stopped');
      }
      this.pauses.set(siid,{revision,paused});
    }
  }

  bind(device:Device,context:DeviceContext,scope:string,panel:DevicePanel){
    const key=JSON.stringify([scope,context]);
    if(this.scope===key||!airerPageEligible(device,panel))return;
    this.close();this.scope=key;this.model=panel.model;
    this.state.bind(context,scope);this.state.seed(panel);
  }
  close(){this.scope='';this.model='';this.selected=undefined;this.pauses.clear();this.state.reset();}
  select(siid:number){if(!this.rails.some(rail=>rail.motor.siid===siid))return;this.selected=siid;this.changed();}
  lift(intent:AirerIntent){
    const rail=this.rail,value=rail?.values[intent];
    if(!rail||value===undefined||!airerRailAllows(rail,intent)||this.error)return;
    const pauseDuringTravel=intent==='pause'&&this.activeIntent!==undefined;
    void this.state.change({siid:rail.motor.siid,piid:rail.motor.piid,value,intent,pauseDuringTravel});
  }
}
