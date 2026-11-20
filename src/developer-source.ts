import type { api } from './api';
import type { CameraSource } from './camera-page';
import type { CareEvent } from './camera-care';
import type { Change, Preview } from './developer-mode';
import type { ControlResult, DeviceContext, DevicePanel } from './types';
import { projectDispenser } from './dispenser';
import { sameContext } from './logic';
import { cameraCardProfile } from './camera-profiles';
import profiles from './camera-profiles.json';
import { projectVacuum, type VacuumMap, type VacuumReport } from './vacuum';
import { projectBath, type BathHeaterReport } from './bath-heater';
import { projectCeiling, type CeilingFanReport } from './ceiling-fan';
import { projectFryer, type FryerSnapshot } from './fryer';
import { washerPrograms, type WasherConfigReport } from './washer';
import type { WasherRuntimeSnapshot } from './washer-runtime';
import washerConfigJson from '../src-tauri/src/fixtures/washer-config.json?raw';
import primaryVideo from './assets/developer/camera.webm?url';
import secondaryVideo from './assets/developer/camera-secondary.webm?url';

type PreviewApi = typeof api & CameraSource;
type Runtime = {
  awake?: boolean;
  vacuum?: VacuumReport;
  washer?: WasherRuntimeSnapshot;
  purifierCups?: NonNullable<DevicePanel['purifier']>['cups'];
  bath?: BathHeaterReport;
  ceiling?: CeilingFanReport;
  fryer?: FryerSnapshot;
  dispenser?: NonNullable<DevicePanel['dispenser']>;
};

const unavailable = () => ({ kind: 'unsupported', message: '暂无离线样本。', retryable: false });
const identity = (context: DeviceContext) => ({ did: context.did });
const now = () => Math.floor(Date.now() / 1000);
const startOf = (date: string) => Date.parse(date + 'T12:00:00+08:00') / 1000;
const sampleDuration = 8;
const washerConfig: WasherConfigReport['config'] = JSON.parse(washerConfigJson);
const clipUrl = (lens: number) => lens === 0 ? primaryVideo : secondaryVideo;
const thumbnail = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="#162b42"/><rect x="15" y="12" width="130" height="66" rx="4" fill="none" stroke="#6da8d2"/><path d="M50 65V30h55v35m7 0V46h15v19" fill="#438ca3"/></svg>',
);

function sampleMap(): VacuumMap {
  const width = 72, height = 48;
  const cells = Array.from({ length: width * height }, (_, offset) => {
    const x = offset % width, y = Math.floor(offset / width);
    if (x < 7 || x > 64 || y < 6 || y > 41) return 0;
    if (x === 7 || x === 64 || y === 6 || y === 41 || x === 40 && (y < 19 || y > 27)) return 255;
    return x < 40 ? 1 : 2;
  });
  return {
    width, height, gridSize: 50, origin: [0, 0], rotation: 0, cells: btoa(String.fromCharCode(...cells)),
    rooms: [{ id: 1, name: '客厅', x: 22, y: 22 }, { id: 2, name: '餐厅', x: 52, y: 24 }],
    robot: { x: 33, y: 31, angle: 0 }, dock: { x: 26, y: 34, angle: 0 },
    path: [{ x: 26, y: 34, isLine: false }, { x: 26, y: 31, isLine: true }, { x: 33, y: 31, isLine: true }],
  };
}

function washerRuntime(panel: DevicePanel, writable: boolean, state: string, mode = 24): WasherRuntimeSnapshot {
  const active = ['busy', 'paused', 'delay'].includes(state);
  const actions = panel.services.find(service => service.name === 'washer')?.actions ?? [];
  const controls = [
    { key: 'stop', label: '终止', names: ['stop-washing'], confirmation: '结束当前洗涤？' },
    state === 'paused' ? { key: 'resume', label: '继续', names: ['start-wash'], confirmation: null } :
      { key: 'pause', label: '暂停', names: ['pause'], confirmation: null },
  ].flatMap(item => {
    const action = actions.find(action => item.names.includes(action.name) && action.in.length === 0);
    return action ? [{ key: item.key, label: item.label, kind: 'action' as const, siid: action.siid,
      aiid: action.aiid, piid: null, value: null, enabled: active && writable, reason: null, confirmation: item.confirmation }] : [];
  });
  return {
    state, active, mode, stage: active ? 'main wash' : null, remainingMinutes: active ? 24 : null,
    reservationMinutes: null, weighing: false, hasDrying: false, cleaning: false, locked: false,
    steps: active ? [{ id: 1, label: '称重', progress: 'done' }, { id: 2, label: '主洗', progress: 'current' },
      { id: 3, label: '漂洗', progress: 'pending' }, { id: 4, label: '脱水', progress: 'pending' }] : [],
    controls,
  };
}

/** Per-model simulated values survive closing a preview, while each view owns its media and request lifetime. */
export function developerSource(
  context: DeviceContext,
  initial: Preview,
  runtime: Runtime,
  signal: AbortSignal,
  change: (change: Change) => Promise<Preview>,
): PreviewApi {
  const { device } = initial;
  let preview = initial;
  const active = (candidate: DeviceContext, write = false) => {
    signal.throwIfAborted();
    if (!sameContext(candidate, context) || write && (!device.online || device.sharedReadOnly)) throw unavailable();
  };
  const model = device.model;
  const report = (candidate: DeviceContext): DevicePanel => {
    active(candidate);
    return {
      ...preview.panel,
      ...(model === 'midjd8.washer.42' ? { washerRuntime: runtime.washer ??= washerRuntime(preview.panel, device.online && !device.sharedReadOnly, device.online ? 'busy' : 'off') } : {}),
      ...(model === 'xiaomi.waterpuri.lx32' ? { purifier: {
        status: 'idle', tds: 18, temperature: 23, fault: 0,
        cups: runtime.purifierCups ?? [{ id: 1, volumeMl: 250 }, { id: 2, volumeMl: 500 }, { id: 3, volumeMl: 1000 }],
        cupSource: 'cloud', cupError: null, canEditCups: device.online && !device.sharedReadOnly, editReason: null,
        filters: preview.panel.services.filter(service => service.name.includes('filter')).map(service => ({
          siid: service.siid, name: service.name, description: service.description, percent: 74, days: 120, antiFake: null,
        })),
      } } : {}),
      ...(model === 'xiaomi.ysj.gxj' ? { dispenser: {
        status: 1, fault: 0, temperature: 23, modes: [{ id: 1, name: '常温水', temperature: 25, volumes: [250, 500] }],
        modeSource: 'preview', modeError: null, childLock: 1, screen: 0, defaultMode: 1, dnd: false,
        dndPeriod: null, progress: null, sterilizationCycle: null,
        ...runtime.dispenser,
      } } : {}),
    };
  };
  const confirmed = (candidate: DeviceContext): ControlResult => ({ verified: true, message: '', panel: report(candidate) });
  let writeQueue = Promise.resolve();
  const write = (candidate: DeviceContext, selection: Change): Promise<ControlResult> => {
    const run = writeQueue.then(async () => {
      active(candidate, true);
      const updated = await change(selection);
      active(candidate);
      preview = updated;
      return confirmed(candidate);
    });
    writeQueue = run.then(() => {}, () => {});
    return run;
  };
  const profile = profiles.media.find(row => row.models.includes(model));
  const lenses = profile?.lenses ?? [{ id: 0, label: '主镜头', ptz: !!profile?.ptz }];
  const awake = (candidate: DeviceContext) => {
    active(candidate);
    return { awake: device.online ? runtime.awake ?? true : null, supported: true, writable: device.online && !device.sharedReadOnly, reason: null };
  };
  let sessionId: string | undefined;
  let eventVideo: Promise<ArrayBuffer> | undefined;
  const cameraSession = (candidate: DeviceContext, id: string) => {
    active(candidate);
    if (id !== sessionId || !device.online) throw unavailable();
  };
  const cameraEvents = (date: string): CareEvent[] => [
    { id: 'motion', time: startOf(date), kind: '有人移动', duration: sampleDuration, thumbnailAvailable: true, playbackAvailable: true },
    { id: 'change', time: startOf(date) - 3600, kind: '画面变动', duration: sampleDuration, thumbnailAvailable: true, playbackAvailable: true },
  ];
  const readMap = (candidate: DeviceContext) => { active(candidate); return sampleMap(); };
  const vacuum = (candidate: DeviceContext) => {
    active(candidate);
    return runtime.vacuum ??= { ...identity(candidate), model, baseline: 'preview', status: 2, battery: 76, mode: 0, suction: 1,
      water: 10, inStation: false, cleaning: false, paused: false, washStation: 0, dustStatus: 0, dustEnable: 1,
      childLock: !!device.sharedReadOnly };
  };
  const config = (candidate: DeviceContext): WasherConfigReport => {
    active(candidate);
    return { ...identity(candidate), model, firmware: 'preview', fetchedAt: now(), config: washerConfig };
  };
  const bath = (candidate: DeviceContext) => {
    active(candidate);
    return runtime.bath ??= { ...identity(candidate), model, lightOn: false, mode: 'bh_off', gears: 1,
      bathDelay: 0, lightDelay: 0, targetTemperature: 32, revision: 'preview' };
  };
  const ceiling = (candidate: DeviceContext) => {
    active(candidate);
    return runtime.ceiling ??= { ...identity(candidate), model, fanOn: false, lightOn: true, gear: 0,
      swingAction: 'stop', swingAngle: 90, brightness: 65, lightMode: 'daylight', revision: 'preview' };
  };
  const fryer = (candidate: DeviceContext) => {
    active(candidate);
    return runtime.fryer ??= { ...identity(candidate), model, fetchedAt: now(), revision: 'preview', status: 1,
      fault: 0, mode: 1, minutes: 15, temperature: 180, leftMinutes: 0, autoKeepWarm: false,
      keepWarm: false, recipeId: null, reservationMinutes: null };
  };

  const methods: Partial<PreviewApi> = {
    devicePanel: async c => report(c),
    readProperties: async c => report(c),
    observeProperties: async c => report(c),
    setProperty: (c, siid, piid, value) => write(c, { kind: 'property', siid, piid, value }),
    confirmProperty: async c => confirmed(c),
    runAction: async (c, siid, aiid) => {
      active(c, true);
      const panel = report(c);
      const action = panel.services.find(service => service.siid === siid)?.actions.find(action => action.aiid === aiid);
      if (!action) throw unavailable();
      if (model === 'midjd8.washer.42') {
        const state = ({ 'start-wash': 'busy', pause: 'paused', 'stop-washing': 'idle' } as Record<string, string>)[action.name];
        if (state) runtime.washer = washerRuntime(panel, true, state, runtime.washer?.mode ?? 24);
      }
      return confirmed(c);
    },
    deviceEvents: async (c, date) => { active(c); return { ...identity(c), date, records: [], nextCursor: null, complete: true, errors: [], rejected: 0 }; },
    previewVideo: clipUrl,
    cameraFeatures: async c => {
      active(c);
      return { qualities: profile?.qualities.map(({id,label,value}) => ({id,label,wireValue:value})) ??
        [{id:'auto',label:'自动'}, {id:'sd',label:'流畅'}], listen: true, talk: false, ptz: !!profile?.ptz,
        playback: !!cameraCardProfile(model), care: profile?.care ?? true, lenses };
    },
    startCamera: async c => { active(c); return sessionId = crypto.randomUUID(); },
    readCamera: async (c, id) => { cameraSession(c, id); return []; },
    stopCamera: async (_c, id) => { if (id === sessionId) sessionId = undefined; },
    cameraCommand: async (c, id, operation) => {
      cameraSession(c, id);
      if (operation.kind === 'recordings') return { state: 'ok', clips: lenses.map(lens => ({
        start: startOf(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })),
        duration: sampleDuration, channel: lens.id, event: true,
      })) };
      if (operation.kind === 'record') return { state: operation.enabled ? 'recording' : 'recording-stopped' };
      return { state: 'ok' };
    },
    cameraMicrophone: async () => { throw unavailable(); },
    cameraScreenshot: async (c, id) => { cameraSession(c, id); return null; },
    cameraPower: async c => awake(c),
    changeCameraPower: async (c, on) => { active(c, true); runtime.awake = on; return { confirmed: true, report: awake(c) }; },
    cameraAuxiliary: async c => { active(c); const missing = { supported:false, active:null, remainingSeconds:null, writable:false, reason:null }; return { alarm:missing, light:missing }; },
    cameraCare: async (c, date) => { active(c); return { events: cameraEvents(date) }; },
    cameraCareThumbnail: async c => { active(c); return thumbnail; },
    cameraCareVideo: async c => {
      active(c);
      let closed = false;
      return { parts: [sampleDuration], container: 'webm', close: () => { closed = true; }, read: async index => {
        active(c);
        if (closed || index !== 0) throw unavailable();
        eventVideo ??= import('./assets/developer/camera.webm?inline').then(({ default: asset }) => {
          const bytes = atob(asset.slice(asset.indexOf(',') + 1));
          return Uint8Array.from(bytes, byte => byte.charCodeAt(0)).buffer;
        });
        const bytes = await eventVideo;
        signal.throwIfAborted();
        if (closed) throw new DOMException('', 'AbortError');
        return bytes;
      } };
    },
    saveCloudVideo: async c => { active(c); return null; },
    doorbellCloud: async (c, date) => {
      active(c);
      return { date, complete: true, retentionDays: null, availableFrom: null, playbackAvailable: true, reason: '',
        events: cameraEvents(date).map(event => ({ ...event, type: event.id === 'motion' ? 'Pass' : 'Stay' })) };
    },
    vacuum: async c => vacuum(c),
    vacuumMap: async c => readMap(c),
    changeVacuum: async (c, _baseline, operation) => {
      active(c, true);
      runtime.vacuum = projectVacuum(vacuum(c), operation);
      return { report: runtime.vacuum, confirmed: true };
    },
    bathHeater: async c => bath(c),
    changeBathHeater: async (c, _baseline, operation) => {
      active(c, true); runtime.bath = projectBath(bath(c), operation, operation.operation === 'mode' ? operation.enabled : true);
      return { report: runtime.bath, confirmed: true };
    },
    ceilingFan: async c => ceiling(c),
    changeCeilingFan: async (c, _baseline, operation) => {
      active(c, true); runtime.ceiling = projectCeiling(ceiling(c), operation);
      return { report: runtime.ceiling, confirmed: true };
    },
    fryer: async c => fryer(c),
    changeFryer: async (c, _baseline, operation) => {
      active(c, true); runtime.fryer = projectFryer(fryer(c), operation);
      return { report: runtime.fryer, confirmed: true };
    },
    washerConfig: async c => config(c),
    washerProgramPreview: async (c, draft) => {
      active(c);
      const panel = report(c), program = washerPrograms(config(c), panel).find(item => item.name === draft.program);
      return { estimatedMinutes: program?.minutes ?? 0, canStart: !!program && device.online && !device.sharedReadOnly,
        reason: null, requestId: null, panel };
    },
    startWasherProgram: async (c, _id, draft) => {
      active(c, true);
      const panel = report(c), program = washerPrograms(config(c), panel).find(item => item.name === draft.program);
      if (!program) throw unavailable();
      runtime.washer = washerRuntime(panel, true, 'busy', program.value);
      return { status: 'confirmed', phase: 'start', message: '', panel: report(c) };
    },
    washerRecords: async (c, range) => {
      active(c);
      return { ...identity(c), range, fetchedAt: now(), buckets: [], frequentModes: [], logs: [], nextId: null };
    },
    purifierStatistics: async (c, selection) => {
      active(c);
      return { ...identity(c), fetchedAt: now(), selection, start: 0, end: 0, points: [], totalMl: null, warnings: [] };
    },
    purifierRecords: async c => {
      active(c);
      return { ...identity(c), fetchedAt: now(), start: 0, end: 0, records: [], nextBefore: null, ignoredZero: 0, rejected: 0, warnings: [] };
    },
    savePurifierCups: async (c, _expected, cups) => {
      active(c, true); runtime.purifierCups = structuredClone(cups); return confirmed(c);
    },
    routerOverview: async c => {
      active(c); return { ...identity(c), model, fetchedAt: now(), network: 'ok', uploadBps: 120000, downloadBps: 980000, wifi7: null, warnings: [] };
    },
    changeDispenser: async (c, operation) => {
      active(c, true);
      runtime.dispenser = projectDispenser(report(c), operation).dispenser ?? undefined;
      return confirmed(c);
    },
    outletTimers: async c => {
      active(c); return { ...identity(c), model, fetchedAt: now(), entries: [], countdowns: [], unsupportedCount: 0, warnings: [], writeReason: '暂无离线样本。' };
    },
    dispenserStatistics: async (c, selection) => {
      active(c);
      return { ...identity(c), fetchedAt: now(), selection, start: 0, end: 0, points: [], totalMl: null, warnings: [] };
    },
    dispenserRecords: async c => {
      active(c);
      return { ...identity(c), fetchedAt: now(), start: 0, end: 0, records: [], nextBefore: null, ignoredZero: 0, rejected: 0, warnings: [] };
    },
    scaleHistory: async c => {
      active(c);
      return { ...identity(c), model, members: [], accountId: null, records: [], fetchedAt: now(), nextBefore: null, omittedRecords: 0, canWrite: false };
    },
    irRemote: async c => { active(c); return { model, baseline: 'preview', keys: [] }; },
  };
  // No prototype or native API fallback. Newly added transports must opt into simulation.
  return new Proxy(Object.assign(Object.create(null), methods), {
    get: (own, key) => Object.hasOwn(own, key) ? own[key] : async () => { throw unavailable(); },
  }) as PreviewApi;
}

export type DeveloperRuntime = Runtime;
