export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface SessionView {
  loggedIn: boolean;
  userId?: string;
  region: string;
}

export interface AccountProfile {displayName:string|null;avatarUrl:string|null;fetchedAt:number}

export interface QrView {
  attemptId: string;
  qrDataUrl: string;
  expiresAt: number;
}

export interface LoginPoll {
  status: 'pending' | 'success' | 'expired';
  session?: SessionView;
}

export interface Room { id: string; name: string }
export interface Home {
  id: string;
  name: string;
  ownerId: string;
  rooms: Room[];
  shared: boolean;
}

export interface Device {
  splitDisplayAvailable?:boolean;
  did: string;
  name: string;
  model: string;
  online: boolean;
  sharedReadOnly?: boolean;
  hiddenOnHome?:boolean;
  roomId: string;
  roomName: string;
  icon?: string | null;
  customIcon?: string | null;
  productIcon?: string | null;
  specType?: string | null;
  unsupportedReason?: string | null;
  controlGroup?: string | null;
  controlGroupName?: string | null;
  controlServiceId?: number | null;
  groupMembers?: string[] | null;
}

export interface HomeSnapshot {
  homeId: string;
  generation: number;
  devices: Device[];
  order?: { roomIds: string[]; roomDevices: Record<string, string[]>; frontDevices: string[] } | null;
  orderNotice?: string | null;
}

export type HomeCardIntent = 'on'|'off'|'open'|'close'|'pause';
export interface CardControl {fieldId?:string;id:string;kind:'toggle'|'action'|'choices'|'stepper'|'slider';label:string;value:Json|null;state?:string|null;enabled:boolean;reason:string|null;options:{label:string;value:Json}[];range:{min:number;max:number;step:number;unit:string}|null;pending?:'sending'|'uncertain';message?:string;error?:string}
export interface HomeCardPresentation {did:string;templateId:string;revision:number;headerControl:string|null;rows:string[][];controls:CardControl[];projections?:{controlId:string;value:Json;effects?:{fieldId:string;value:Json}[];controls:{id:string;enabled:boolean;value:Json|null;label:string}[]}[]}
export interface CardControlChange {templateId:string;controlId:string;value:Json;requestId:string;confirmOnly?:boolean}
export interface CardControlResult {homeId:string;did:string;controlId:string;requestId:string;sequence?:number;submitted?:boolean;target?:Json|null;verified:boolean;actual:Json|null;message:string;presentation:HomeCardPresentation|null;card:HomeCardEntry|null;status:HomeCardStatus|null}
export interface HomeCardEntry {
    group?:{id:string;revision:number;readStartedAt?:number;members:{id:string;selected:boolean|null}[]}|null;
  did:string;kind:'power'|'curtain';selected:boolean|null;enabled:boolean;reason:string|null;
  visible:boolean;highlight:boolean;
  modeAllowed?:boolean|null;
  binding:{siid:number;piid:number};action:HomeCardIntent;cardType:number;
}
export interface HomeCardStatus {did:string;text:string;revision?:number;readStartedAt?:number;fields?:HomeCardStatusField[]}
export interface HomeCardStatusField {id:string;value:Json|null;text:string;writable:boolean;visible:boolean;live:boolean;format:{kind:'boolean'|'enum'|'number'|'position'|'raw';label:string;options:{value:Json;text:string}[];unit:string;precision:number|null;min:number|null;max:number|null;integral:boolean;percentage:boolean};gates:{enable:{field:string;value:Json|null}[]|null;disable:{field:string;value:Json|null}[]|null;unknown:boolean}[]}
export interface RouterReport {did:string;model:string;fetchedAt:number;network:'ok'|'unknown';uploadBps:number|null;downloadBps:number|null;wifi7:boolean|null;warnings:string[]}
export interface HomeCardReport {homeId:string;generation:number;cards:HomeCardEntry[];statuses?:HomeCardStatus[];presentations?:HomeCardPresentation[]}
export interface HomeCardResult {verified:boolean;message:string;card:HomeCardEntry|null;status?:HomeCardStatus|null;actual:HomeCardIntent|null}
export interface SwitchGroupResult {readback?:boolean;homeId:string;requestId:string;sequence:number;target:boolean;card:HomeCardEntry;failed:string[]}

export interface Property {
  pending?:'sending'|'uncertain';
  siid: number;
  piid: number;
  name: string;
  description: string;
  format: string;
  access: string[];
  unit?: string | null;
  value?: Json;
  code?: number | null;
  lastReported?: { value: Json; updatedAt: number | null; retrievedAt: number } | null;
  unsupportedReason?: string | null;
  valueList?: { value: Json; description: string }[] | null;
  valueRange?: number[] | null;
}

export interface LightModeSlot {index:number;mode:number;brightness:number|null;color:number|null;temperature:number|null;reason:string|null}
export interface LightModeReport {did:string;model:string;fetchedAt:number;slots:LightModeSlot[]}
export interface LightSettingsSlot {index:number;brightness:number|null;color:number|null;temperaturePercent:number|null;tab:'color'|'temperature';revision:string|null;reason:string|null}
export interface LightSettingsReport {did:string;model:string;fetchedAt:number;slots:LightSettingsSlot[];flowSlots:LightSettingsSlot[];speed:{value:number|null;reason:string|null};writeReason:string|null}
export type LightSettingsChange={operation:'saveMode';index:number;baseline:string;brightness:number;color:number;temperaturePercent:number;tab:'color'|'temperature'}|{operation:'saveFlow';index:number;baseline:string;brightness:number;color:number}|{operation:'setSpeed';baseline:number;value:number};
export interface LightSettingsResult {status:'confirmed'|'rejected'|'uncertain';message:string;report:LightSettingsReport|null}

export interface HistoryPoint { time: number; low: number; high: number; gateway: boolean; source?: string; bucketTime?: number; state?: 'measured' }
export interface HistoryChannel { name: 'temperature' | 'humidity'; unit: string; points: HistoryPoint[]; error: string | null; complete: boolean; sources?: string[]; completeness?: 'complete'|'partial'|'failed' }
export type HistoryPeriod = 'day' | 'month' | 'year';
export interface HistorySelection { period: HistoryPeriod; date: string }
export type EnergyPeriod='week'|'month'|'year';
export interface EnergySelection {period:EnergyPeriod;date:string}
export interface EnergySummary {today:number|null;yesterday:number|null;month:number|null;switches:number|null;switchesMore:boolean;complete:boolean}
export interface EnergyReport {did:string;model:string;fetchedAt:number;selection:EnergySelection;start:number;end:number;points:{time:number;value:number}[];summary:EnergySummary;complete:boolean;error:AppError|null;warnings:string[]}
export interface TimerEntry {key:string;on:boolean;enabled:boolean;time:string;repeat:string;dueAt:number|null;endTime:string|null;weekdays:number[];editReason:string|null}
export interface CountdownView {on:boolean;key:string|null;writeReason:string|null;active:boolean|null;dueAt:number|null;hours:number|null;minutes:number|null;durationSource:'default'|'stored'|'unknown'}
export interface TimerReport {did:string;model:string;fetchedAt:number;entries:TimerEntry[];countdowns:CountdownView[];unsupportedCount:number;warnings:string[];writeReason:string|null}
export type TimerMode='on'|'off'|'period';
export interface TimerDraft {key:string|null;mode:TimerMode;onTime:string|null;offTime:string|null;weekdays:number[];enabled:boolean}
export type TimerChange={operation:'save';draft:TimerDraft}|{operation:'setEnabled';key:string;enabled:boolean}|{operation:'delete';key:string};
export interface TimerChangeResult {verified:boolean;message:string;report:TimerReport|null;changedKey:string|null}
export type CountdownChange={operation:'set';on:boolean;key:string|null;hours:number;minutes:number}|{operation:'cancel';on:boolean;key:string};
export interface CountdownChangeResult {sceneVerified:boolean;preferencesVerified:boolean|null;message:string;report:TimerReport|null}
export interface SensorHistory {
  did: string;
  model: string;
  fetchedAt: number;
  start: number;
  end: number;
  referenceTime: number;
  selection: HistorySelection | null;
  channels: HistoryChannel[];
  warnings: string[];
}

export interface Action {
  siid: number;
  aiid: number;
  name: string;
  description: string;
  in: number[];
  out: number[];
  unsupportedReason?: string | null;
}

export interface Service {
  siid: number;
  name: string;
  description: string;
  properties: Property[];
  actions: Action[];
  events?: DeviceEvent[];
}

export interface DeviceEvent {siid:number;eiid:number;name:string;description:string;arguments:number[]}

export interface DevicePanel {
  did: string;
  model: string;
  specType?: string | null;
  services: Service[];
  capabilities?: import('./device-capabilities').DeviceCapabilities | null;
  unsupportedReason?: string | null;
  washerRuntime?:import('./washer-runtime').WasherRuntimeSnapshot|null;
  purifier?:import('./purifier').PurifierSnapshot|null;
  dispenser?:import('./dispenser').DispenserSnapshot|null;
}

export interface ControlResult {
  verified: boolean;
  message: string;
  panel: DevicePanel;
}

export interface AppError {
  kind: string;
  message: string;
  retryable: boolean;
}

export interface DeviceContext {
  homeId: string;
  generation: number;
  did: string;
}

export interface LightFavorite {
  id:string;name:string;brightness:number|null;color:number|null;temperaturePercent:number|null;
  tab:'color'|'temperature';revision:string;reason:string|null;
}
export interface LightFavoritesReport { did:string;model:string;fetchedAt:number;items:LightFavorite[] }
export interface LightFavoriteFields { name:string;brightness:number;color:number;temperaturePercent:number;tab:'color'|'temperature' }
export type LightFavoriteChange=({operation:'create'}&LightFavoriteFields)|({operation:'edit';id:string;baseline:string}&LightFavoriteFields)|{operation:'delete';id:string;baseline:string};
export interface LightFavoriteResult { status:'confirmed'|'rejected'|'uncertain';message:string;report:LightFavoritesReport|null }
