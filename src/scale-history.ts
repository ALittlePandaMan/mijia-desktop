import {normalizeError} from './logic';
import {dateKey,parseDateKey} from './history';
import type {AppError, DeviceContext} from './types';

export const scalePageSize=20;
export const scaleEarliest=1_640_966_400_000;
export const scalePeriods=[[7,'近7天'],[30,'近30天'],[90,'近90天'],[180,'近半年']] as const;
type Period=typeof scalePeriods[number][0];

export const scaleMetrics = {
  bodyFat: ['体脂率', '%'],
  muscleRate: ['肌肉率', '%'],
  bmi: ['BMI', ''],
  muscle: ['肌肉量', 'kg'],
  heartRate: ['心率', '次/分'],
  water: ['水分率', '%'],
  boneMass: ['骨盐量', 'kg'],
  skeletalMuscle: ['骨骼肌量', 'kg'],
  visceralFat: ['内脏脂肪等级', ''],
  protein: ['蛋白质率', '%'],
  basalMetabolism: ['基础代谢', 'kcal/日'],
  bodyAge: ['身体年龄', '岁'],
} as const;

export type ScaleMeasurement = {
  key: string;
  timeMs: number;
  weight: number;
  metrics: Partial<Record<keyof typeof scaleMetrics,number>>;
  adultBmi?: boolean;
};
export type ScaleMember = {id: string; name: string; icon?: string};
export type ScaleSource='memberCloud'|'deviceHistory'|'deviceReading'|'unavailable';
export type ScaleHistory = {
  did: string;
  model: string;
  members: ScaleMember[];
  memberId: string|null;
  source: ScaleSource;
  compositionSupported?: boolean;
  pendingSupported: boolean;
  pendingEditable?: boolean;
  pendingClaimMemberIds?: string[];
  latestWeight?: number;
  records: ScaleMeasurement[];
  nextBefore: number|null;
  omitted: number;
};

export type ScaleMetric='weight'|keyof typeof scaleMetrics;
export type ScaleDateRange={start:number;end:number};
export type ScaleQuery={memberId?:string;start?:number;before?:number;pending?:boolean};
export type ScaleRecordUpdate={kind:'claim'|'remove';memberId:string;targetMemberId?:string;records:Pick<ScaleMeasurement,'key'|'timeMs'>[]};
export type ScaleRecordChange=(context:DeviceContext,change:ScaleRecordUpdate)=>Promise<void>;
type Read=(context:DeviceContext,query:ScaleQuery)=>Promise<ScaleHistory>;
type View='overview'|'history'|'records'|'pending'|'report';

export function scaleRange(days:Period,now=Date.now()):ScaleDateRange {
  const end=new Date(now),start=new Date(now);
  start.setDate(start.getDate()-days+1);
  start.setHours(0,0,0,0);
  end.setHours(23,59,59,999);
  return {start:Math.max(scaleEarliest,start.getTime()),end:end.getTime()};
}

export function customScaleRange(startKey:string,endKey:string,now=Date.now()):ScaleDateRange|undefined {
  try{
    const start=parseDateKey(startKey),end=parseDateKey(endKey);
    if(start>end||endKey>dateKey(new Date(now)))return;
    end.setHours(23,59,59,999);
    if(end.getTime()<scaleEarliest)return;
    return {start:Math.max(scaleEarliest,start.getTime()),end:end.getTime()};
  }catch{return undefined;}
}

export function scaleValue(record:ScaleMeasurement,metric:ScaleMetric):number|undefined {
  if(metric==='muscleRate'&&record.metrics.muscleRate==null){
    const mass=record.metrics.muscle;
    if(mass==null||!Number.isFinite(mass)||!Number.isFinite(record.weight)||mass<=0||mass>record.weight)return;
    return Math.round(1000*mass/record.weight)/10;
  }
  return metric==='weight'?record.weight:record.metrics[metric];
}

export function scaleDay(time:number):number {
  const date=new Date(time);
  return Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())/86_400_000;
}

export function scaleMonthEnd(month:string,now=Date.now()):number|undefined {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||
    month<dateKey(new Date(scaleEarliest)).slice(0,7)||month>dateKey(new Date(now)).slice(0,7))return;
  const [year,index]=month.split('-').map(Number);
  return Math.min(now,new Date(year,index,1).getTime()-1);
}

/** The only retained records are the current member's latest and visible pages. */
export class ScaleHistoryState {
  private scope?: {context: DeviceContext; model: string};
  private serial = 0;
  private cursors: (number|undefined)[] = [undefined];
  private recentReady=false;
  private overviewPoint?:string;
  private readonly historyPoints=new Map<ScaleMetric,string>();
  private reportBack:'overview'|'records'|'history'='overview';
  memberId?: string;
  members: ScaleMember[] = [];
  recent: ScaleMeasurement[] = [];
  source?: ScaleSource;
  compositionSupported=false;
  pendingSupported=false;
  latestWeight?:number;
  otherMetricsOpen=false;
  report?: ScaleHistory;
  page = 0;
  loading = false;
  error?: AppError;
  mutationError?: AppError;
  view:View='overview';
  period:Period|'custom'=7;
  range=scaleRange(7);
  recordsMonth?:string;
  reportRecord?:ScaleMeasurement;
  readonly selectedKeys=new Set<string>();

  constructor(private readonly read:Read, private readonly changed:()=>void,
    private readonly failed:(error:AppError)=>void,private readonly changePending?:ScaleRecordChange) {}

  get supported():boolean { return !!this.scope&&this.source!=='unavailable'; }
  get historyAvailable():boolean { return this.source==='memberCloud'||this.source==='deviceHistory'; }
  private get recordAction():ScaleRecordChange|undefined {
    if(this.source==='memberCloud'&&this.memberId!==undefined&&this.view==='pending'&&this.report?.pendingEditable)return this.changePending;
  }
  get editable():boolean { return !!this.recordAction; }
  get claimMembers():ScaleMember[] {
    const ids=this.report?.pendingClaimMemberIds;
    return this.view==='pending'&&this.editable&&ids?this.members.filter(member=>ids.includes(member.id)):[];
  }
  get activeMember():ScaleMember|undefined { return this.members.find(member=>member.id===this.memberId); }

  open(context:DeviceContext,model:string):void {
    this.close();
    this.scope={context,model};
    void this.load(0);
  }

  close():void {
    this.scope=undefined;
    this.memberId=undefined;
    this.members=[];
    this.source=undefined;
    this.compositionSupported=false;
    this.pendingSupported=false;
    this.otherMetricsOpen=false;
    this.view='overview';
    this.period=7;
    this.range=scaleRange(7);
    this.recordsMonth=undefined;
    this.resetOverview();
    this.resetPages();
  }

  select(memberId:string):void {
    if(!this.scope||memberId===this.memberId||!this.members.some(member=>member.id===memberId))return;
    this.memberId=memberId;
    this.recordsMonth=undefined;
    this.resetOverview();
    this.resetPages();
    void this.load(0);
  }

  refresh():void {
    if(!this.scope||this.loading)return;
    if(this.error?.kind==='invalidInput'){
      this.memberId=undefined;
      this.view='overview';
      this.resetOverview();
    }
    // A refresh of the same member can show their last reading while the new page loads.
    this.resetPages();
    void this.load(0);
  }

  show(view:'history'|'pending'):void {
    if(view==='history'&&!this.historyAvailable||view==='pending'&&!this.pendingSupported)return;
    this.view=view;
    this.loadFirstPage();
  }

  showRecords():void {
    if(this.view!=='history')return;
    this.view='records';
    this.recordsMonth=undefined;
    this.loadFirstPage();
  }

  jumpToMonth(month:string):void {
    if(this.view!=='records'||month&&scaleMonthEnd(month)===undefined)return;
    this.recordsMonth=month||undefined;
    this.loadFirstPage();
  }

  showReport(record:ScaleMeasurement):void {
    if(this.loading||this.view!=='overview'&&this.view!=='records'&&this.view!=='history')return;
    const rows=this.view==='overview'?this.recent:this.report?.records;
    if(!rows?.includes(record))return;
    this.reportBack=this.view;
    this.view='report';
    this.reportRecord=record;
    this.changed();
  }

  back():boolean {
    if(this.view==='overview')return false;
    if(this.view==='report'){
      this.reportRecord=undefined;
      this.view=this.reportBack;
    }else if(this.view==='records'){
      this.show('history');
      return true;
    }
    else {
      this.view='overview';
      this.resetPages();
      if(this.scope&&!this.recentReady){void this.load(0);return true;}
    }
    this.changed();
    return true;
  }

  setPeriod(period:Period):void {
    this.applyRange(scaleRange(period),period);
  }

  applyRange(range:ScaleDateRange,period:Period|'custom'='custom'):void {
    this.period=period;
    this.range=range;
    this.loadFirstPage();
  }

  selectedPoint(rows:readonly ScaleMeasurement[],metric:ScaleMetric='weight'):ScaleMeasurement|undefined {
    const key=this.view==='overview'?this.overviewPoint:this.historyPoints.get(metric);
    return rows.find(row=>row.key===key)??rows[0];
  }

  choosePoint(record:ScaleMeasurement,metric:ScaleMetric='weight'):void {
    if(this.view==='overview')this.overviewPoint=record.key;
    else if(this.view==='history')this.historyPoints.set(metric,record.key);
  }

  selectRecord(key:string,selected:boolean):void {
    if(this.view!=='pending'||!this.editable||this.loading||!this.report?.records.some(record=>record.key===key))return;
    if(selected)this.selectedKeys.add(key);
    else this.selectedKeys.delete(key);
    this.mutationError=undefined;
    this.changed();
  }

  async mutateSelection(kind:ScaleRecordUpdate['kind'],targetMemberId?:string):Promise<void> {
    const scope=this.scope,memberId=this.memberId,change=this.recordAction;
    if(this.loading||!scope||!change||!memberId||!this.selectedKeys.size)return;
    if(kind==='claim'&&!this.claimMembers.some(member=>member.id===targetMemberId))return;
    const records=this.report?.records.filter(row=>this.selectedKeys.has(row.key)).map(({key,timeMs})=>({key,timeMs}));
    if(!records?.length)return;
    const serial=++this.serial;
    this.loading=true;
    this.error=undefined;
    this.mutationError=undefined;
    this.changed();
    let failure:AppError|undefined;
    try{
      await change(scope.context,kind==='claim'?{kind,memberId,targetMemberId,records}:{kind,memberId,records});
    }catch(error){
      if(serial!==this.serial)return;
      failure=normalizeError(error);
      this.failed(failure);
    }
    if(serial!==this.serial)return;
    if(kind!=='remove')this.resetOverview();
    this.resetPages();
    this.mutationError=failure;
    await this.load(0);
  }

  previous():void {
    if(!this.loading&&this.page>0)void this.load(this.page-1);
  }

  next():void {
    const before=this.report?.nextBefore;
    if(this.loading||before==null)return;
    this.cursors[this.page+1]=before;
    void this.load(this.page+1);
  }

  private loadFirstPage():void {
    this.resetPages();
    if(this.scope&&(this.historyAvailable||!this.recentReady))void this.load(0);
    else this.changed();
  }

  private resetPages():void {
    ++this.serial;
    this.report=undefined;
    this.cursors=[undefined];
    this.page=0;
    this.historyPoints.clear();
    this.reportRecord=undefined;
    this.selectedKeys.clear();
    this.loading=false;
    this.error=undefined;
    this.mutationError=undefined;
  }

  private resetOverview():void {
    this.recent=[];
    this.latestWeight=undefined;
    this.recentReady=false;
    this.overviewPoint=undefined;
  }

  private async load(page:number):Promise<void> {
    const scope=this.scope;
    if(!scope)return;
    const serial=++this.serial;
    const memberId=this.memberId,view=this.view;
    const ranged=view==='history';
    let before=this.cursors[page]??(ranged?Math.min(this.range.end,Date.now()):
      view==='records'&&this.recordsMonth?scaleMonthEnd(this.recordsMonth):undefined);
    let previous=ranged&&page>0?this.report:undefined;
    const current=()=>serial===this.serial&&this.scope===scope;
    this.loading=true;
    this.error=undefined;
    this.changed();
    try {
      // A yearly range can contain hundreds of readings. Show the first page
      // immediately, then continue serially within a bounded request budget.
      const days=scaleDay(this.range.end)-scaleDay(this.range.start)+1;
      const pageBudget=Math.min(24,Math.max(3,Math.ceil(days/scalePageSize)+1));
      let report:ScaleHistory;
      const collected=new Map((previous?.records??[]).map(row=>[row.key,row]));
      let omitted=previous?.omitted??0;
      for(let batch=0;;batch++){
        const requestedMember=previous?.memberId??memberId;
        report=await this.read(scope.context,{memberId:requestedMember,before,start:ranged?this.range.start:undefined,pending:view==='pending'});
        if(!current())return;
        const memberCloud=report.source==='memberCloud';
        const currentOnly=report.source==='deviceReading'||report.source==='unavailable';
        if(report.did!==scope.context.did||report.model!==scope.model||
          previous&&previous.source!==report.source||
          requestedMember!==undefined&&report.memberId!==requestedMember||
          report.memberId!==null&&!report.members.some(member=>member.id===report.memberId)||
          memberCloud&&report.memberId===null&&(report.records.length||report.nextBefore!==null)||
          !memberCloud&&(report.memberId!==null||report.members.length||report.pendingSupported)||
          report.pendingEditable&&(!memberCloud||view!=='pending'||report.memberId===null)||
          currentOnly&&(report.records.length||report.nextBefore!==null)||
          view==='pending'&&!report.pendingSupported||
          report.nextBefore!==null&&(!Number.isSafeInteger(report.nextBefore)||before!==undefined&&report.nextBefore>=before)){
          throw {kind:'protocol',message:'暂未取得有效的测量记录。',retryable:true} satisfies AppError;
        }
        if(!ranged)break;
        for(const row of report.records)collected.set(row.key,row);
        omitted+=report.omitted;
        if(report.nextBefore===null||batch+1===pageBudget){
          report={...report,records:[...collected.values()].sort((a,b)=>b.timeMs-a.timeMs),omitted};
          break;
        }
        if(batch===0){
          this.report={...report,records:[...collected.values()].sort((a,b)=>b.timeMs-a.timeMs),omitted};
          this.memberId=report.memberId??undefined;
          this.members=report.members;
          this.changed();
          if(!current())return;
        }
        before=report.nextBefore;
        previous=report;
      }
      this.memberId=report.memberId??undefined;
      this.members=report.members;
      this.report=report;
      this.page=page;
      this.source=report.source;
      this.compositionSupported ||= report.compositionSupported === true || report.records.some(row=>Object.keys(row.metrics).length>0);
      this.pendingSupported=report.pendingSupported;
      if(view==='overview'){
        this.recent=report.records;
        const latest=report.latestWeight;
        const deviceReading=report.source==='deviceReading'||report.source==='deviceHistory';
        this.latestWeight=deviceReading&&latest!==undefined&&Number.isFinite(latest)&&latest>0?latest:undefined;
        this.recentReady=true;
      }
      this.selectedKeys.clear();
      this.cursors.length=page+1;
    } catch(error) {
      if(!current())return;
      if(view==='overview')this.resetOverview();
      if(!ranged)this.report=undefined;
      this.error=normalizeError(error);
      this.failed(this.error);
    } finally {
      if(current()){
        this.loading=false;
        this.changed();
      }
    }
  }
}
