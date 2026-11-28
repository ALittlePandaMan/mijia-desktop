import {describe,expect,it,vi} from 'vitest';
import {customScaleRange,scaleMonthEnd,scaleValue,ScaleHistoryState,type ScaleHistory} from './scale-history';

const scaleCloudModel='yunmai.scales.ms103';
const device={homeId:'example-home',generation:7,did:'scale'};
const later={...device,homeId:'another-home',generation:8};
const sample=(memberId:string,weight:number,nextBefore:number|null=null):ScaleHistory=>({
  did:device.did,model:scaleCloudModel,memberId,members:[{id:'1',name:'示例成员一'},{id:'2',name:'示例成员二'}],
  source:'memberCloud',pendingSupported:true,
  records:[{key:`reading-${weight}`,timeMs:1700000000000,weight,metrics:{}}],nextBefore,omitted:0,
});
const tick=()=>Promise.resolve();

describe('scale history scope',()=>{
  it('browses and paginates device-only history without creating a member',async()=>{
    const model='z9527.scales.1356';
    const cursor=1699900000000;
    const history:ScaleHistory={...sample('1',64.8,cursor),source:'deviceHistory',pendingSupported:false,
      model,memberId:null,members:[]};
    const read=vi.fn().mockResolvedValue(history);
    const state=new ScaleHistoryState(read,()=>{},()=>{});
    state.open(device,model);
    await tick();
    expect(state.historyAvailable).toBe(true);
    expect(state.activeMember).toBeUndefined();
    state.show('pending');
    expect(state.view).toBe('overview');
    read.mockResolvedValueOnce({...history,nextBefore:null});
    state.show('history');
    await tick();
    state.showRecords();
    await tick();
    state.next();
    expect(read).toHaveBeenLastCalledWith(device,{before:cursor,memberId:undefined,start:undefined,pending:false});
  });

  it('keeps a current property reading distinct from measurements and clears it on closing',async()=>{
    const model='z9527.scales.1356';
    const reply:ScaleHistory={...sample('1',64.8),source:'deviceReading',pendingSupported:false,
      model,memberId:null,members:[],records:[],latestWeight:63.9};
    const read=vi.fn().mockResolvedValue(reply);
    const state=new ScaleHistoryState(read,()=>{},()=>{});
    state.open(device,model);
    await tick();
    expect(state.latestWeight).toBe(63.9);
    expect(state.recent).toEqual([]);
    expect(state.historyAvailable).toBe(false);
    state.show('history');
    expect(state.view).toBe('overview');
    expect(read).toHaveBeenCalledTimes(1);
    state.close();
    expect(state.latestWeight).toBeUndefined();
  });
  it('releases prior measurements on member changes and drops results after leaving the device',async()=>{
    const reply: ((value:ScaleHistory)=>void)[]=[];
    const read=vi.fn(()=>new Promise<ScaleHistory>(resolve=>reply.push(resolve)));
    const state=new ScaleHistoryState(read,()=>{},()=>{});
    state.open(device,scaleCloudModel);
    reply[0](sample('1',64.8));
    await tick();
    state.select('2');
    expect(state.recent).toEqual([]);
    state.select('1');
    reply[2](sample('1',65.1));
    reply[1](sample('2',79.3));
    await tick();
    expect(state.recent[0].weight).toBe(65.1);
    state.refresh();
    expect(state.loading).toBe(true);
    expect(state.recent[0].weight).toBe(65.1);
    state.open(later,scaleCloudModel);
    reply[3](sample('1',60.5));
    await tick();
    expect(state.recent).toEqual([]);
    expect(state.loading).toBe(true);
    reply[4](sample('1',67));
    await tick();
    expect(state.recent[0].weight).toBe(67);
    state.close();
    expect(state.members).toEqual([]);
    expect(state.report).toBeUndefined();
  });

  it('paginates all records independently of the chosen date range',async()=>{
    const cursor=1699900000000;
    const read=vi.fn().mockResolvedValueOnce(sample('1',64.8))
      .mockResolvedValueOnce({...sample('1',65),records:[]})
      .mockResolvedValueOnce(sample('1',64.8,cursor)).mockResolvedValueOnce(sample('1',65.2));
    const state=new ScaleHistoryState(read,()=>{},()=>{});
    state.open(device,scaleCloudModel);
    await tick();
    state.show('history');
    await tick();
    state.showRecords();
    await tick();
    state.next();
    expect(read).toHaveBeenLastCalledWith(device,{memberId:'1',before:cursor,pending:false,start:undefined});
    await tick();
    expect(state.page).toBe(1);
    expect(state.recent[0].weight).toBe(64.8);
    expect(state.report?.records[0].weight).toBe(65.2);
  });

  it('keeps the chosen custom date range when returning from the full record list',async()=>{
    const now=new Date(2026,10,28,12).getTime();
    const range=customScaleRange('2026-11-24','2026-11-27',now)!;
    expect(customScaleRange('2026-11-29','2026-11-29',now)).toBeUndefined();
    expect(customScaleRange('2026-11-28','2026-11-27',now)).toBeUndefined();
    expect(customScaleRange('2026-11-31','2026-11-31',now)).toBeUndefined();
    expect(new Date(range.start).getHours()).toBe(0);
    expect(new Date(range.end).getHours()).toBe(23);
    const read=vi.fn().mockResolvedValue(sample('1',64.8));
    const state=new ScaleHistoryState(read,()=>{},()=>{});
    state.open(device,scaleCloudModel);
    await tick();
    state.show('history');
    state.applyRange(range);
    expect(read).toHaveBeenLastCalledWith(device,{memberId:'1',before:expect.any(Number),start:range.start,pending:false});
    await tick();
    state.showRecords();
    await tick();
    expect(state.back()).toBe(true);
    expect(state.view).toBe('history');
    expect(state.period).toBe('custom');
    expect(state.range).toEqual(range);
  });

  it('accumulates range history across bounded reads and keeps each metric selection separate',async()=>{
    const base=Date.now()-1000;
    let page=0;
    const read=vi.fn(async(_context,query)=>{
      const result=sample('1',60+page);
      if(query.start===undefined)return result;
      result.records[0].timeMs=base-1000*page;
      result.nextBefore=page<3?result.records[0].timeMs-1:null;
      page++;
      return result;
    });
    const state=new ScaleHistoryState(read,()=>{},()=>{});
    state.open(device,scaleCloudModel);
    await tick();
    state.show('history');
    await vi.waitFor(()=>expect(state.loading).toBe(false));
    expect(state.report?.records.map(row=>row.weight)).toEqual([60,61,62]);
    state.next();
    await vi.waitFor(()=>expect(state.loading).toBe(false));
    const rows=state.report!.records;
    expect(rows.map(row=>row.weight)).toEqual([60,61,62,63]);
    expect(state.report!.nextBefore).toBeNull();
    state.choosePoint(rows[2],'bodyFat');
    expect(state.selectedPoint(rows,'weight')).toBe(rows[0]);
    expect(state.selectedPoint(rows,'bodyFat')).toBe(rows[2]);
    state.showReport(rows[2]);
    state.back();
    expect(state.view).toBe('history');
    expect(state.selectedPoint(rows,'bodyFat')).toBe(rows[2]);
  });

  it('jumps to a month independently of the chart and distinguishes muscle mass from its percentage',async()=>{
    const read=vi.fn().mockResolvedValue(sample('1',80));
    const state=new ScaleHistoryState(read,()=>{},()=>{});
    state.open(device,scaleCloudModel);
    await tick();
    state.show('history');
    await tick();
    state.showRecords();
    await tick();
    state.jumpToMonth('2024-02');
    expect(read).toHaveBeenLastCalledWith(device,{memberId:'1',start:undefined,before:new Date(2024,2,1).getTime()-1,pending:false});
    expect(scaleMonthEnd('2024-13')).toBeUndefined();
    const record=sample('1',80).records[0];
    expect(scaleValue(record,'muscleRate')).toBeUndefined();
    record.metrics.muscle=48;
    expect(scaleValue(record,'muscleRate')).toBe(60);
    expect(scaleValue(record,'muscle')).toBe(48);
    record.metrics.muscle=85;
    expect(scaleValue(record,'muscleRate')).toBeUndefined();
  });
});
