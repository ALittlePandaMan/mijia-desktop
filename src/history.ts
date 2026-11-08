import type { HistoryChannel, HistorySelection, SensorHistory } from './types';
export interface HistorySlot { time: number; low: number | null; high: number | null; origin?: 'measured'|'carried'|'missing'; sourceTime?: number; source?: string }
function localHour(time:number):number {const date=new Date(time*1000);return time-date.getMinutes()*60-date.getSeconds()-date.getMilliseconds()/1000;}

/** New responses carry the source's verified bucket timestamp. Legacy fixture
 * responses retain their explicit gateway semantics without a second shift. */
function pointBucket(point: NonNullable<HistoryChannel['points']>[number]): number {
  if (point.bucketTime !== undefined && Number.isFinite(point.bucketTime)) return point.bucketTime;
  return point.gateway ? localHour(point.time) + 3600 : point.time;
}

function addPoint(slot:HistorySlot, point:HistoryChannel['points'][number]):void {
  slot.low = slot.low === null ? point.low : Math.min(slot.low, point.low);
  slot.high = slot.high === null ? point.high : Math.max(slot.high, point.high);
  slot.origin = 'measured';
  if(slot.sourceTime===undefined||point.time>=slot.sourceTime){slot.sourceTime=point.time;slot.source=point.source;}
}

/** Display-time grouping only. Rust verifies ownership, decodes and bounds values. */
export function historySlots(channel: HistoryChannel | undefined, end: number): HistorySlot[] {
  const last = localHour(end);
  const slots: HistorySlot[] = Array.from({ length: 25 }, (_, index) => ({ time: last - (24 - index) * 3600, low: null, high: null }));
  const byTime = new Map(slots.map(slot => [slot.time, slot]));
  for (const point of channel?.points ?? []) {
    if (!Number.isFinite(point.time) || !Number.isFinite(point.low) || !Number.isFinite(point.high) || point.low > point.high) continue;
    const key = localHour(pointBucket(point));
    const slot = byTime.get(key); if (!slot) continue;
    addPoint(slot, point);
  }
  return slots;
}

export function historyExtremes(slots: HistorySlot[]): { min: number; max: number; count: number } | undefined {
  const values = slots.flatMap(slot => slot.high === null ? [] : [slot.high]);
  return values.length ? { min: Math.min(...values), max: Math.max(...values), count: slots.filter(slot=>slot.high!==null&&slot.origin!=='carried').length } : undefined;
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function parseDateKey(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('日期格式无效。');
  const [year,month,day] = value.split('-').map(Number);
  const date = new Date(year,month-1,day);
  if (dateKey(date)!==value) throw Error('日期无效。');
  return date;
}
export function selectableDate(date: Date, period: 'day' | 'month', today = new Date()): boolean {
  const min = new Date(today.getFullYear()-1,today.getMonth(),today.getDate());
  const maximum = new Date(today.getFullYear(),today.getMonth(),today.getDate());
  const first = new Date(date.getFullYear(),date.getMonth(),period==='month'?1:date.getDate());
  const last = period==='month'?new Date(date.getFullYear(),date.getMonth()+1,0):first;
  return last>=min && first<=maximum;
}
export function calendarDates(month: Date): Date[] {
  const start = new Date(month.getFullYear(),month.getMonth(),1);
  const count = Math.ceil((start.getDay()+new Date(month.getFullYear(),month.getMonth()+1,0).getDate())/7)*7;
  start.setDate(1-start.getDay());
  return Array.from({length:count},(_,index)=>new Date(start.getFullYear(),start.getMonth(),start.getDate()+index));
}

/** Build measured buckets only. Cross-channel display carry is applied later. */
export function historyDetailSlots(channel: HistoryChannel | undefined, selection: HistorySelection, referenceTime: number, window?: Pick<SensorHistory,'start'|'end'>): HistorySlot[] {
  const date = parseDateKey(selection.date);
  const reference = new Date(referenceTime*1000);
  let slots: HistorySlot[];
  if(selection.period==='day') {
    const today = dateKey(date)===dateKey(reference);
    const first=today?localHour(reference.getTime()/1000)-24*3600:date.getTime()/1000;
    const next=new Date(date.getFullYear(),date.getMonth(),date.getDate()+1).getTime()/1000;
    const count=today?25:Math.round((next-first)/3600)+1;
    slots=Array.from({length:count},(_,index)=>({time:first+index*3600,low:null,high:null}));
  } else {
    const count=selection.period==='month'?new Date(date.getFullYear(),date.getMonth()+1,0).getDate():12;
    slots=Array.from({length:count},(_,index)=>({time:new Date(date.getFullYear(),selection.period==='month'?date.getMonth():index,selection.period==='month'?index+1:1).getTime()/1000,low:null,high:null}));
  }
  const key=(time:number):number=>{
    const at=new Date(time*1000);
    if(selection.period==='day') return localHour(time);
    else {at.setHours(0,0,0,0);if(selection.period==='year')at.setDate(1);}
    return at.getTime()/1000;
  };
  const byTime=new Map(slots.map(slot=>[slot.time,slot]));
  for(const point of channel?.points??[]) {
    if(![point.time,point.low,point.high].every(Number.isFinite)||point.low>point.high)continue;
    const bucket=pointBucket(point);
    if(window&&(bucket<=window.start||bucket>window.end))continue;
    const slot=byTime.get(key(bucket));if(!slot)continue;
    addPoint(slot,point);
  }
  return slots;
}

/** Mirror the native per-channel merge without inventing joint observations:
 * only an hour observed by the other channel may display this channel's last
 * measured value. Failed/partial sources and wholly missing hours stay empty. */
export function sensorHistorySlots(data:SensorHistory|undefined, selection?:HistorySelection, referenceTime=Date.now()/1000):Record<'temperature'|'humidity',HistorySlot[]> {
  const channels={temperature:data?.channels.find(c=>c.name==='temperature'),humidity:data?.channels.find(c=>c.name==='humidity')};
  const build=(name:'temperature'|'humidity')=>selection?historyDetailSlots(channels[name],selection,data?.referenceTime??referenceTime,data):historySlots(channels[name],data?.end??referenceTime);
  const slots={temperature:build('temperature'),humidity:build('humidity')};
  if(selection&&selection.period!=='day'||!channels.temperature?.complete||!channels.humidity?.complete||channels.temperature.error||channels.humidity.error)return slots;
  for(const name of ['temperature','humidity']as const){
    const other=slots[name==='temperature'?'humidity':'temperature'];
    // The fetched window starts before the visible day. Seed only from its
    // latest real bucket; the current device reading is never historical data.
    const first=slots[name][0]?.time;
    let prior:HistorySlot|undefined;
    for(const point of channels[name]?.points??[]){
      if(first===undefined||![point.time,point.low,point.high].every(Number.isFinite)||point.low>point.high)continue;
      const bucket=localHour(pointBucket(point));
      if(bucket>=first||data&&bucket<data.start||prior&&bucket<prior.time)continue;
      if(prior&&bucket===prior.time)addPoint(prior,point);
      else {prior={time:bucket,low:null,high:null};addPoint(prior,point);}
    }
    for(let i=0;i<slots[name].length;i++){
      const slot=slots[name][i];
      if(slot.high!==null){prior=slot;continue;}
      if(prior&&other[i]&&other[i].high!==null&&other[i].origin!=='carried'){
        slot.low=prior.low;slot.high=prior.high;slot.origin='carried';slot.sourceTime=prior.sourceTime;slot.source=prior.source;
      }
    }
  }
  return slots;
}

export function historySlotDescription(slot:HistorySlot,unit:string,precision:number):string {
  if(slot.high===null)return '暂无记录';
  return `${slot.high.toFixed(precision)}${unit}`;
}
