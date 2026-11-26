import {capabilityActionBinding, capabilityBinding, capabilityCategory, resolveDeviceCapabilities} from './device-capabilities';
import type {Action, Device, DevicePanel, Json, Property} from './types';

export type VacuumSetting = 'mode' | 'suction' | 'water';
export type VacuumPhase = 'idle' | 'charging' | 'charged' | 'cleaning' | 'paused' | 'returning' | 'mapping' | 'washing' | 'drying' | 'collecting' | 'blocked' | 'unknown';
type Choice = NonNullable<Property['valueList']>[number];
export interface VacuumChoice { value: Json; label: string; art: string; mode?: 'sweep'|'both'|'mop'|'after' }
export interface VacuumSettingBinding {
  property: Property;
  choices: VacuumChoice[];
  range?: { min: number; max: number; step: number; unit: string };
  value?: Json;
}
export type VacuumActionRole = 'start' | 'pause' | 'stop' | 'dock' | 'wash' | 'stopWash' | 'dry' | 'stopDry' | 'collect';
export interface VacuumActionBinding { role: VacuumActionRole; action: Action; target: VacuumPhase }
interface VacuumStationChoice extends VacuumActionBinding { enabled: boolean }
export interface VacuumSpecReport {
  did: string;
  model: string;
  phase: VacuumPhase;
  status?: string;
  phaseRead: boolean;
  blocked: boolean;
  settings: Partial<Record<VacuumSetting, VacuumSettingBinding>>;
  actions: Record<string, Action>;
  startMode?: string;
  station: boolean;
  batteryDocked: boolean;
  stationPhase?: VacuumPhase;
}

export function vacuumPageEligible(device: Device | undefined, panel: DevicePanel | undefined): boolean {
  return !!device && !!panel && panel.did === device.did && panel.model === device.model && isVacuumPanel(panel);
}

export function isVacuumPanel(panel: DevicePanel): boolean {
  return !panel.unsupportedReason && capabilityCategory(panel.specType) === 'vacuum' && panel.services.some(s => s.name === 'vacuum');
}

export function specVacuumMapEligible(panel: DevicePanel): boolean {
  if (!isVacuumPanel(panel) || !(panel.model === 'xiaomi.vacuum.d110ch' || panel.model.startsWith('dreame.vacuum.'))) return false;
  const maps = panel.services.filter(service => service.name === 'map');
  if (maps.length !== 1) return false;
  const [service] = maps;
  const action = service.actions.find(action => action.name === 'map-req' && action.in.length === 1 && !action.unsupportedReason);
  return !!action && service.properties.some(property => property.piid === action.in[0] && property.name === 'frame-info' && property.format === 'string')
    && service.properties.some(property => action.out.includes(property.piid) && property.name === 'map-data' && property.format === 'string');
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s/_-]+/g, '');
const chinese = (value?: string) => !!value && /[\u3400-\u9fff]/.test(value);
const live = (property?: Property) => property?.code === 0 ? property.value : undefined;
const roles = {
  mode: ['vacuum.sweep-mop-type', 'vacuum.wdr-mode', 'vacuum.sweep-mode', 'other-status.only-mop', 'vacuum.mode', 'vacuum.sweep-type'],
  suction: ['vacuum.suction-level', 'vacuum-custom.suction-level', 'vacuum.suction-state', 'sweep.suction-state', 'viomi-vacuum.suction-grade', 'vacuum.fan-level', 'vacuum-extend.cleaning-mode', 'clean.mode', 'vacuum.mode', 'vacuum.speed-level'],
  water: ['vacuum.mop-water-output-level', 'vacuum.water-level', 'vacuum.target-water-level', 'other-status.target-water-level', 'sweep.water-state', 'viomi-vacuum.water-grade', 'vacuum-extend.mop-mode', 'custom.water-level', 'custom.water-set'],
} satisfies Record<VacuumSetting, string[]>;

export const vacuumSettingTitles: Record<VacuumSetting, string> = { mode: '模式', suction: '吸力', water: '拖布水量' };
export const vacuumPhaseLabels: Record<VacuumPhase, string> = {
  idle: '待机中', charging: '充电中', charged: '充电完成', cleaning: '清洁中', paused: '已暂停', returning: '回充中',
  mapping: '正在建图', washing: '清洗拖布中', drying: '烘干拖布中', collecting: '集尘中', blocked: '设备需要检查', unknown: '设备在线',
};

function semantic<T>(table: Record<string, T>, choice: Choice): T | undefined {
  for (const label of [choice.localizedDescription, choice.description]) {
    const key = normalize(label ?? '');
    if (Object.hasOwn(table, key)) return table[key];
  }
}

const phaseAliases: Record<string, VacuumPhase> = {
  idle: 'idle', standby: 'idle', ready: 'idle', sleep: 'idle', sleeping: 'idle', dormant: 'idle', '空闲': 'idle', '待机': 'idle', '待机中': 'idle', '休眠': 'idle', '睡眠': 'idle', '睡眠中': 'idle',
  sweeeping: 'cleaning', sweeping: 'cleaning', areasweeping: 'cleaning', partialsweeping: 'cleaning', spotsweeping: 'cleaning',
  cleaning: 'cleaning', mopping: 'cleaning', vacuummopping: 'cleaning', vacuumingandmopping: 'cleaning', sweepingandmopping: 'cleaning', sweepingmopping: 'cleaning', busy: 'cleaning',
  '清扫中': 'cleaning', '扫地中': 'cleaning', '拖地中': 'cleaning', '正在拖地': 'cleaning', '扫拖中': 'cleaning', '正在清扫': 'cleaning', '清洁中': 'cleaning', '工作中': 'cleaning',
  paused: 'paused', pause: 'paused', '暂停': 'paused', '暂停中': 'paused', '已暂停': 'paused',
  charging: 'charging', '充电中': 'charging', '正在充电': 'charging', charged: 'charged', chargingcompleted: 'charged', chargingover: 'charged', fullcharge: 'charged', '充满': 'charged', '已充满': 'charged', '充电完成': 'charged', '充电已完成': 'charged',
  gocharging: 'returning', returning: 'returning', returningtothedocktocharge: 'returning', gowash: 'returning', '正在回充': 'returning', '回充中': 'returning', '返回清洗中': 'returning',
  building: 'mapping', buildingmap: 'mapping', mapping: 'mapping', '建图中': 'mapping', '正在建图': 'mapping',
  washing: 'washing', inthewash: 'washing', themoppadisbeingcleaned: 'washing', '清洗中': 'washing', '正在清洗拖布': 'washing', '洗拖布中': 'washing',
  drying: 'drying', inthedry: 'drying', themoppadisbeingdried: 'drying', '烘干中': 'drying', '风干中': 'drying', '正在烘干拖布': 'drying',
  dusting: 'collecting', dustcollecting: 'collecting', inthedust: 'collecting', '集尘中': 'collecting', '正在集尘': 'collecting',
  error: 'blocked', fault: 'blocked', updating: 'blocked', upgrading: 'blocked', shutdown: 'blocked', '异常': 'blocked', '故障': 'blocked', '升级中': 'blocked', '关机': 'blocked',
};

export function vacuumPhase(choice: Choice): VacuumPhase {
  // A localized status may say “暂停” for an Error. Preserve the specific protocol state.
  return semantic(phaseAliases, { ...choice, localizedDescription: undefined }) ?? semantic(phaseAliases, choice) ?? 'unknown';
}

const modeAliases: Record<string, VacuumChoice['mode'] | 'auto' | 'edge' | 'spot'> = {
  sweep: 'sweep', sweeponly: 'sweep', onlysweep: 'sweep', vacuum: 'sweep', vacuumonly: 'sweep', '扫地': 'sweep', '只扫地': 'sweep', '单扫': 'sweep', '扫地模式': 'sweep',
  mop: 'mop', moponly: 'mop', onlymop: 'mop', mopping: 'mop', '拖地': 'mop', '只拖地': 'mop', '单拖': 'mop', '拖地模式': 'mop',
  sweepmop: 'both', sweepandmop: 'both', mopandsweep: 'both', vacuumandmop: 'both', '扫拖': 'both', '扫拖同步': 'both', '扫拖一体': 'both', '扫拖模式': 'both',
  sweepbeforemopping: 'after', sweepthenmop: 'after', '先扫后拖': 'after',
  auto: 'auto', autoclean: 'auto', global: 'auto', all: 'auto', '自动清扫': 'auto', '全局': 'auto', '全局清扫': 'auto', '全屋清扫':'auto',
  edge: 'edge', wall: 'edge', wallflowclean: 'edge', wallfollow: 'edge', '沿边': 'edge', '沿边清扫': 'edge',
  spot: 'spot', spotclean: 'spot', point: 'spot', '定点': 'spot', '定点清扫': 'spot',
};
const modes = {
  sweep: ['只扫地', 'sweep'], both: ['扫拖同步', 'both'], mop: ['只拖地', 'mop'], after: ['先扫后拖', 'after'],
  auto: ['全局清扫', 'sweep'], edge: ['沿边清扫', 'sweep'], spot: ['定点清扫', 'sweep'],
} as const;
const suctionAliases: Record<string, [string, string]> = {
  silent: ['安静', 'quiet'], slient: ['安静', 'quiet'], quiet: ['安静', 'quiet'], min: ['安静', 'quiet'], '安静': ['安静', 'quiet'], '静音': ['静音', 'quiet'],
  '轻柔': ['轻柔', 'quiet'], modequiet: ['安静', 'quiet'], modestandard: ['标准', 'standard'], modemedium: ['中档', 'medium'], modestrong: ['强力', 'strong'],
  eco: ['节能', 'quiet'], '节能': ['节能', 'quiet'],
  basic: ['标准', 'standard'], normal: ['标准', 'standard'], standard: ['标准', 'standard'], '标准': ['标准', 'standard'],
  medium: ['中档', 'medium'], '中档': ['中档', 'medium'], '中挡': ['中档', 'medium'], strong: ['强力', 'medium'], enhance: ['强力', 'medium'], '强力': ['强力', 'medium'], '强劲': ['强劲', 'medium'],
  turbo: ['超强', 'strong'], fullspeed: ['超强', 'strong'], max: ['超强', 'strong'], '超强': ['超强', 'strong'],
  auto: ['自动', 'standard'], '自动': ['自动', 'standard'], off: ['关闭', 'quiet'], close: ['关闭', 'quiet'], '关': ['关闭', 'quiet'],
};
const waterAliases: Record<string, [string, string]> = {
  low: ['小', 'mophumidity1'], '低': ['小', 'mophumidity1'], '水量低': ['小', 'mophumidity1'], '低水量': ['小', 'mophumidity1'],
  mid: ['标准', 'mophumidity2'], middle: ['标准', 'mophumidity2'], medium: ['标准', 'mophumidity2'], standard: ['标准', 'mophumidity2'], '中': ['标准', 'mophumidity2'], '水量中': ['标准', 'mophumidity2'], '中水量': ['标准', 'mophumidity2'],
  high: ['大', 'mophumidity3'], hig: ['大', 'mophumidity3'], height: ['大', 'mophumidity3'], '高': ['大', 'mophumidity3'], '水量高': ['大', 'mophumidity3'], '高水量': ['大', 'mophumidity3'],
  off: ['关闭', 'mophumidity1'], close: ['关闭', 'mophumidity1'], '关': ['关闭', 'mophumidity1'],
};
const ordinals: Record<string, number> = { first: 1, fisrt: 1, second: 2, third: 3, three: 3, fourth: 4 };

function choiceView(choice: Choice, setting: VacuumSetting, role: string): VacuumChoice | undefined {
  if (setting === 'mode') {
    const meaning = semantic(modeAliases, choice);
    if (!meaning) return;
    if (role === 'vacuum.sweep-type' && !chinese(choice.localizedDescription)) {
      const wire = semantic(modeAliases, {...choice,localizedDescription:undefined});
      if (wire && wire !== meaning) return;
    }
    const [label, art] = modes[meaning];
    return { value: choice.value, label, art, mode: meaning === 'auto' || meaning === 'edge' || meaning === 'spot' ? undefined : meaning };
  }
  const known = semantic(setting === 'suction' ? suctionAliases : waterAliases, choice);
  if (known) return { value: choice.value, label: known[0], art: known[1] };
  for (const label of [choice.localizedDescription, choice.description]) {
    const level = /^(?:level)?(\d{1,2})(?:档|挡)?$/.exec(normalize(label ?? ''))?.[1];
    const ordinal = normalize(label ?? '').replace(/gear$/, '');
    const rank = level === undefined ? Object.hasOwn(ordinals,ordinal) ? ordinals[ordinal] : undefined : Number(level);
    if (rank !== undefined) return { value: choice.value, label: rank === 0 ? '关闭' : `${rank} 档`, art: setting === 'suction' ? 'standard' : `mophumidity${Math.min(Math.max(1,rank),3)}` };
    // Generic “mode” can mean other things. Do not infer suction from it.
    if (role !== 'vacuum.mode' && chinese(label)) return { value: choice.value, label: label!.trim(), art: setting === 'suction' ? 'standard' : 'mophumidity2' };
  }
}

function settingBinding(property: Property, setting: VacuumSetting, role: string): VacuumSettingBinding | undefined {
  const value = live(property);
  if (role === 'other-status.only-mop') {
    return {property,value:typeof value === 'boolean' ? value : undefined,choices:[
      {value:false,label:'常规清洁',art:'both'}, {value:true,label:'只拖地',art:'mop',mode:'mop'},
    ]};
  }
  if (property.valueList) {
    const choices = property.valueList.flatMap(choice => {
      const view = choiceView(choice, setting, role);
      return view ? [view] : [];
    });
    if (choices.length < 2 || new Set(choices.map(choice => choice.label)).size !== choices.length) return;
    if (setting === 'mode') {
      if (role === 'vacuum.sweep-type' && choices.length !== property.valueList.length) return;
      const order = ['只扫地', '扫拖同步', '只拖地', '先扫后拖'];
      if (choices.every(choice => choice.mode)) choices.sort((a,b) => order.indexOf(a.label) - order.indexOf(b.label));
    }
    return { property, choices, value: property.valueList.some(choice => choice.value === value) ? value : undefined };
  }
  if (setting === 'mode' || role === 'vacuum.mode' || role === 'vacuum-extend.cleaning-mode' || !property.valueRange) return;
  const [min, max, step] = property.valueRange;
  const count = Math.round((max - min) / step) + 1;
  const range = { min, max, step, unit: property.unit === 'percentage' ? '%' : '' };
  const choices = count <= 4 && [min, max, step].every(Number.isSafeInteger)
    ? Array.from({length: count}, (_,i) => ({ value: min + i * step, label: `${i+1} 档`, art: setting === 'water' ? `mophumidity${Math.min(i+1,3)}` : ['quiet','standard','medium','strong'][i] })) : [];
  const verified = typeof value === 'number' && rangeAllows(range, value) ? value : undefined;
  return { property, choices, value: verified, range: choices.length ? undefined : range };
}

function rangeAllows(range: NonNullable<VacuumSettingBinding['range']>, value: number): boolean {
  const increments = (value - range.min) / range.step;
  return Number.isFinite(value) && value >= range.min && value <= range.max && Math.abs(increments - Math.round(increments)) < 1e-7;
}

export function vacuumSettingAllows(binding: VacuumSettingBinding, value: Json): boolean {
  return binding.value !== undefined && (binding.range && typeof value === 'number' ? rangeAllows(binding.range, value) : binding.choices.some(choice => choice.value === value));
}

export function vacuumSpecReport(panel: DevicePanel): VacuumSpecReport {
  const caps = resolveDeviceCapabilities(panel);
  const property = (role: string, setting = false) => {
    const matches = caps.properties.filter(binding => binding.role === role && (!setting || ['enum','range'].includes(binding.kind)
      || role === 'other-status.only-mop' && binding.kind === 'toggle'));
    return matches.length === 1 ? capabilityBinding(panel, matches[0]) : undefined;
  };
  const actions: VacuumSpecReport['actions'] = {};
  for (const binding of caps.actions) {
    if (caps.actions.filter(action => action.role === binding.role).length !== 1) continue;
    const match = capabilityActionBinding(panel, binding)?.action;
    if (match && !match.in.length) actions[binding.role] = match;
  }
  const settings: VacuumSpecReport['settings'] = {};
  for (const setting of Object.keys(roles) as VacuumSetting[]) {
    for (const role of roles[setting]) {
      const endpoint = property(role, true);
      if (!endpoint || Object.values(settings).some(bound => bound.property === endpoint)) continue;
      const binding = settingBinding(endpoint, setting, role);
      if (binding) { settings[setting] = binding; break; }
    }
  }
  const status = property('vacuum.status');
  const declares = (name: string) => panel.services.some(service => service.name === 'vacuum' && service.properties.some(p => p.name === name));
  const statusValue = live(status);
  const current = status?.valueList?.find(choice => choice.value === statusValue);
  const phase = current ? vacuumPhase(current) : 'unknown';
  const fault = property('vacuum.fault');
  const faultValue = live(fault);
  const faultChoice = fault?.valueList?.find(choice => choice.value === faultValue);
  const noFaultLabel = /^(nofaults?|noerrors?|normal|everythingisok|none|ok|无故障|无异常|正常|无)$/;
  const noFault = faultChoice ? [faultChoice.description,faultChoice.localizedDescription].some(label=>noFaultLabel.test(normalize(label??''))) : faultValue === 0;
  const stationStatus = property('vacuum.base-station-working-status');
  const stationValue = live(stationStatus);
  const stationChoice = stationStatus?.valueList?.find(choice => choice.value === stationValue);
  const stationPhase = stationChoice ? vacuumPhase(stationChoice) : typeof stationValue === 'string'
    ? vacuumPhase({value:stationValue,description:stationValue}) : stationStatus ? 'unknown' : undefined;
  const battery = property('battery.charging-state');
  const batteryState = battery?.valueList?.find(choice => choice.value === live(battery));
  const batteryDocked = !!batteryState && ['charging','charged'].includes(vacuumPhase(batteryState));
  const station = !!(stationStatus || actions['vacuum.start-dry'] || actions['vacuum.start-mop-wash'] || actions['vacuum.start-dust-arrest'] || actions['custom.start-dust']);
  const report: VacuumSpecReport = { did: panel.did, model: panel.model, phase, status: current && chinese(current.localizedDescription) && phase !== 'blocked' ? current.localizedDescription : undefined,
    phaseRead: !declares('status') || phase !== 'unknown',
    blocked: declares('fault') && !noFault || ['mapping','blocked'].includes(phase), settings, actions, station, stationPhase, batteryDocked };
  return {...report,startMode:vacuumStartModes(report)[0]?.value};
}

/** Starting values for a healthy catalog simulation. Real panels keep live readings. */
export function vacuumPreviewChoices(report: VacuumSpecReport): [Property, Json][] {
  const {mode,suction,water} = report.settings;
  const preferred = [
    [mode, mode?.choices.find(choice=>choice.mode==='both') ?? mode?.choices.find(choice=>choice.mode==='sweep') ?? mode?.choices[0]],
    [suction, suction?.choices.find(choice=>choice.label==='标准') ?? suction?.choices.find(choice=>choice.label==='自动')
      ?? suction?.choices.find(choice=>choice.label!=='关闭')],
    [water, water?.choices.find(choice=>choice.label==='标准')
      ?? (water?.choices.length ? water.choices[Math.floor(water.choices.length / 2)] : undefined)],
  ] as const;
  return preferred.flatMap(([binding,choice]) =>
    binding?.property.code===0 && choice ? [[binding.property,choice.value]] : []);
}

export function selectedVacuumMode(report: VacuumSpecReport): VacuumChoice['mode'] {
  const mode = report.settings.mode;
  return mode?.choices.find(choice => choice.value === mode.value)?.mode;
}

export function vacuumStartModes(report: VacuumSpecReport): (VacuumChoice & {value: string; action: Action})[] {
  if (report.settings.mode) return [];
  const sweep = report.actions['vacuum.start-only-sweep'] ? 'vacuum.start-only-sweep' : 'vacuum.start-sweep';
  const choices = [[sweep, sweep.endsWith('only-sweep') ? '只扫地' : '清扫', 'sweep'],
    ['vacuum.start-sweep-mop','扫拖同步','both'],['vacuum.start-mop','只拖地','mop'],['vacuum.start-sweep-before-mopping','先扫后拖','after']] as const;
  const bound = choices.flatMap(([value,label,art]) => report.actions[value] ? [{value,label,art,action:report.actions[value]}] : []);
  return bound.length > 1 ? bound : [];
}

export function vacuumPrimaryAction(report: VacuumSpecReport): VacuumActionBinding | undefined {
  const { actions, phase } = report;
  if (report.stationPhase && ['washing','drying','collecting'].includes(report.stationPhase)) return;
  if (phase === 'cleaning') {
    const pause = actions['vacuum.pause-sweeping'] ?? actions['vacuum.pause'];
    if (pause) return { role: 'pause', action: pause, target: 'paused' };
    const stop = actions['vacuum.stop-sweeping'];
    return stop ? { role: 'stop', action: stop, target: 'idle' } : undefined;
  }
  if (!['idle','paused','charging','charged','unknown'].includes(phase)) return;
  const selected = vacuumStartModes(report).find(choice => choice.value === report.startMode);
  const mode = selectedVacuumMode(report);
  const modeAction = mode && ({ mop: 'start-mop', both: 'start-sweep-mop', sweep: 'start-only-sweep', after: 'start-sweep-before-mopping' })[mode];
  const action = (phase === 'paused' ? actions['vacuum.continue-sweep'] : undefined)
    ?? selected?.action ?? (modeAction ? actions[`vacuum.${modeAction}`] : undefined) ?? actions['vacuum.start-sweep'];
  return action ? { role: 'start', action, target: 'cleaning' } : undefined;
}

export function vacuumActionMatches(report: VacuumSpecReport, action: VacuumActionBinding): boolean {
  const primary = vacuumPrimaryAction(report);
  const candidates = [primary, ...vacuumStationActions(report)];
  if (primary?.role === 'start' && !(report.phase === 'paused' && report.actions['vacuum.continue-sweep'])) {
    candidates.push(...vacuumStartModes(report).map(choice => ({role:'start',action:choice.action,target:'cleaning'} as const)));
  }
  return candidates.some(candidate => candidate?.role === action.role && candidate.target === action.target
    && candidate.action.siid === action.action.siid && candidate.action.aiid === action.action.aiid);
}

const stationWork: VacuumPhase[] = ['washing','drying','collecting'];
export function vacuumStationPhase(report: VacuumSpecReport): VacuumPhase | undefined {
  return stationWork.includes(report.phase) ? report.phase : report.stationPhase;
}

export function vacuumAtStation(report: VacuumSpecReport): boolean {
  const station = vacuumStationPhase(report);
  return !!station && stationWork.includes(station) || ['charging','charged'].includes(report.phase)
    || report.batteryDocked && ['idle','unknown'].includes(report.phase);
}

export function vacuumStationChoices(report: VacuumSpecReport): VacuumStationChoice[] {
  if (!report.station) return [];
  const { actions, phase } = report;
  const current = vacuumStationPhase(report);
  const atStation = vacuumAtStation(report);
  const canRun = report.phaseRead && !report.blocked;
  const ready = canRun && atStation && (current === undefined || current === 'idle');
  const available: [VacuumActionRole, Action | undefined, VacuumPhase, boolean][] = [];
  const dock = actions['battery.start-charge'] ?? actions['vacuum.start-charge'];
  if (!atStation) available.push(['dock',dock,'returning',canRun && ['idle','cleaning','paused'].includes(phase)]);
  available.push(
    current === 'washing' && actions['vacuum.stop-mop-wash']
      ? ['stopWash',actions['vacuum.stop-mop-wash'],'idle',canRun] : ['wash',actions['vacuum.start-mop-wash'],'washing',ready],
    current === 'drying' && actions['vacuum.stop-dry']
      ? ['stopDry',actions['vacuum.stop-dry'],'idle',canRun] : ['dry',actions['vacuum.start-dry'],'drying',ready],
    ['collect',actions['vacuum.start-dust-arrest'] ?? actions['custom.start-dust'],'collecting',ready],
  );
  return available.flatMap(([role,action,target,enabled]) => action ? [{role,action,target,enabled}] : []);
}

export function vacuumStationActions(report: VacuumSpecReport): VacuumActionBinding[] {
  return vacuumStationChoices(report).filter(choice => choice.enabled);
}

export function vacuumPreviewStatus(panel: DevicePanel, phase: VacuumPhase, source: 'status'|'base-station-working-status' = 'status'): { property: Property; value: Json } | undefined {
  const property = panel.services.find(service => service.name === 'vacuum')?.properties.find(property => property.name === source);
  const choice = (phase === 'idle' ? property?.valueList?.find(choice => /^idle$/i.test(choice.description.trim())) : undefined)
    ?? property?.valueList?.find(choice => vacuumPhase(choice) === phase);
  return property && choice ? { property, value: choice.value } : undefined;
}
