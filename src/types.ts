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
export interface HomeCardEntry {
  did:string;kind:'power'|'curtain';selected:boolean|null;enabled:boolean;reason:string|null;
  visible:boolean;highlight:boolean;
  modeAllowed?:boolean|null;
  binding:{siid:number;piid:number};action:HomeCardIntent;cardType:number;
}
export interface HomeCardStatus {did:string;text:string}
export interface RouterClient {mac:string;name:string;ip:string|null;icon:string|null;online:boolean|null;blocked:boolean;connection:number|null;downloadBps:number|null;uploadBps:number|null;eventTime:number|null;signal?:number|null;wifiProtocol?:string|null;port?:string|null;portSpeed?:string|null;txRate?:string|null;rxRate?:string|null}
export interface RouterReport {did:string;model:string;fetchedAt:number;network:'ok'|'unknown';uploadBps:number|null;downloadBps:number|null;clients:RouterClient[]|null;filterMode:'black'|'white'|null;filteredClients:RouterClient[]|null;wifi7:boolean|null;mesh:boolean|null;firmware:string|null;indicatorTimerSupported:boolean|null;warnings:string[]}
export interface RouterIndicatorValues {on:boolean;timerOn:boolean;openTime:string;closeTime:string}
export interface RouterIndicatorReport {did:string;model:string;values:RouterIndicatorValues;revision:string}
export interface RouterIndicatorChange {baseline:string;values:RouterIndicatorValues}
export interface RouterIndicatorRead {report:RouterIndicatorReport;pending:RouterIndicatorChange|null}
export interface RouterIndicatorResult {status:'confirmed'|'uncertain';report:RouterIndicatorReport|null;message:string}
export interface RouterWifiNames {ssid:string;password:string}
export interface RouterWifiValues {merged:boolean;bands:RouterWifiNames[];enabled?:boolean[]}
export interface RouterWifiReport {did:string;model:string;revision:string;values:RouterWifiValues;enabled:boolean[];encrypted:boolean[];canMerge:boolean;specialCharacters:boolean;writeReason:string|null;protection?:{state:string;protectedBands:number[];reason:string|null}}
export interface RouterWifiChange {baseline:string;values:RouterWifiValues}
export interface RouterWifiRead {report:RouterWifiReport;pending:RouterWifiChange|null;externalPending?:boolean}
export interface RouterWifiResult {status:'confirmed'|'uncertain';report:RouterWifiReport|null;message:string}
export type RouterAdvancedField='mlo'|'muMimo'|'wifi5'|'relay'|'aiot'|'channelAdj';
export interface RouterAdvancedSwitch {field:RouterAdvancedField;value:boolean|null;mode:number|null;supported:boolean;reason:string|null}
export interface RouterRadioValues {on:boolean;encryption:string;power:string;hidden:boolean;channel:number;bandwidth:number}
export interface RouterRadioRules {encryptions:string[];canSwitch:boolean;channelVisible:boolean;remind2g:boolean;mesh:boolean;fiveOffOptimization:boolean;relayBand:number|null;writeReason:string|null;connection?:{state:string;protectedBands:number[];reason:string|null}}
export interface RouterAdvancedBand {on:boolean;encryption:string;power:string;hidden:boolean;channel:number|null;bandwidth:number|null;activeChannel:number|null;activeBandwidth:number|null;widths:number[];channels:{value:number;widths:number[]}[]}
export interface RouterAdvancedReport {did:string;model:string;revision:string;wifi:RouterWifiReport;switches:RouterAdvancedSwitch[];bands:RouterAdvancedBand[];reconnect:boolean;warnings:string[];workMode:number|null;radio:RouterRadioRules}
export interface RouterAdvancedChange {field:RouterAdvancedField|'configuration';on:boolean;baseline:string;wifi?:RouterWifiChange|null;bands?:RouterRadioValues[]|null}
export interface RouterDfsChallenge {id:string;seconds:number;waiting?:boolean}
export interface RouterAdvancedRead {report:RouterAdvancedReport;pending:RouterAdvancedChange|null;configPending:boolean;dfs?:RouterDfsChallenge|null}
export interface RouterAdvancedOutcome {status:'confirmed'|'uncertain'|'rejected'|'dfsRequired'|'waiting';report:RouterAdvancedReport|null;message:string;dfs?:RouterDfsChallenge|null}
export interface HomeCardReport {homeId:string;generation:number;cards:HomeCardEntry[];statuses?:HomeCardStatus[]}
export interface HomeCardResult {verified:boolean;message:string;card:HomeCardEntry|null;status?:HomeCardStatus|null;actual:HomeCardIntent|null}

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
