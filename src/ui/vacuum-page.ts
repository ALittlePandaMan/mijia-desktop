import type {Device, Json, Property} from '../types';
import {SpecVacuumState, vacuumSettingEnabled, vacuumSettingsLocked, type VacuumState, type VacuumChange, type VacuumReport} from '../vacuum';
import {vacuumAtStation, vacuumPhaseLabels, vacuumPrimaryAction, vacuumSettingTitles, vacuumStartModes, vacuumStationChoices, type VacuumActionRole, type VacuumSetting} from '../vacuum-spec';
import {vacuumIcon, vacuumModeIcon} from '../vacuum-icons';
import {icon} from '../icons';
import {button, element} from './dom';
import {deviceLoading} from './device-loading';
import {dismissOnBackdrop} from './dialog-dismiss';
import {vacuumMap} from './vacuum-map';
import {renderControl} from './controls';
import {modeCard} from './mode-card';
import {brightnessSurface} from './adjustment-surfaces';
import './vacuum-page.css';

interface ActionView { key: string; label: string; art: string; disabled?: boolean; run: () => void }
interface ChoiceView { value: Json; label: string; art: string; selected: boolean; run: () => void }
interface SettingView {
  key: VacuumSetting; current?: string; locked: boolean; choices: ChoiceView[];
  adjustment?: {property:Property; unit:string; run:(value:Json)=>void};
}
interface PickerView {
  title: string; min: number; max: number; step: number; unit: string; value: number;
  update: (value: number) => void; close: () => void; save: (value: number) => void;
}
interface VacuumView {
  status?: string; disabled: boolean; cleaning?: ActionView; station?: ActionView;
  stationActions: ActionView[]; settings: SettingView[]; locked: boolean; picker?: PickerView;
}
type NativeVacuumViewState = Pick<VacuumState, 'report' | 'change' | 'showManual' | 'manualOpen' | 'manualWater' | 'setManualWater'
  | 'showStation' | 'stationOpen' | 'loading' | 'pending' | 'error' | 'read' | 'displayedMap' | 'viewport' | 'redraw'>;
const mapFrames = new WeakMap<HTMLElement, object>();
const stationLabels: Partial<Record<VacuumActionRole, [string, string]>> = {
  dock: ['返回基站','icon_left_back_station'], wash: ['清洗拖布','icon_wash_rag'], stopWash: ['停止清洗拖布','icon_wash_rag'],
  dry: ['烘干拖布','icon_dry_mop'], stopDry: ['停止烘干','icon_dry_mop'], collect: ['集尘','icon_collect_dust'],
};
const nativeModes = [[2,'只扫地','sweep'],[0,'扫拖同步','both'],[1,'只拖地','mop'],[3,'先扫后拖','after']] as const;
const nativeSuction = [[0,'安静','quiet'],[1,'标准','standard'],[2,'强力','medium'],[3,'超强','strong']] as const;
const nativeWater = [[-5,'小','mophumidity1'],[-10,'标准','mophumidity2'],[-15,'大','mophumidity3'],[1,'手动','mop_manual']] as const;
const nativeStatus: Record<number,string> = {
  1:'清洁中',2:'待机中',3:'已暂停',4:'设备需要检查',5:'返回基站中',6:'充电中',7:'拖地中',8:'烘干拖布中',9:'清洗拖布中',10:'返回清洗中',
  11:'正在建图',12:'扫拖中',13:'充电完成',14:'设备升级中',15:'局部清洁中',16:'基站复位中',17:'安装拖布中',18:'拆卸拖布中',
  19:'基站自检中',20:'补水中',21:'拖布清洗已暂停',22:'集尘中',23:'遥控清洁中',24:'智能充电中',25:'复拖中',
};

function choiceIcon(setting: VacuumSetting, key: string): SVGSVGElement {
  return vacuumModeIcon(setting === 'mode' ? `mode-${key}-sel` : `${key}-select`);
}

function nativeView(state: NativeVacuumViewState, report: VacuumReport): VacuumView {
  const send = (change: VacuumChange) => void state.change(change);
  const group = (key: VacuumSetting, value: number, choices: readonly (readonly [number,string,string])[], locked = false): SettingView => {
    const manual = key === 'water' && value > 0;
    return { key, locked, current: manual ? '手动 ' + value : choices.find(choice => choice[0] === value)?.[1],
      choices: choices.map(([target,label,art]) => {
        const isManual = art === 'mop_manual';
        return { value:target, label, art, selected:isManual ? manual : target === value,
          run: () => isManual ? state.showManual(true) : send({operation:key,value:target}) };
      }) };
  };
  const station = (label: string, art: string, change: VacuumChange, disabled = false): ActionView =>
    ({ key:change.operation, label, art, disabled, run:() => send(change) });
  const washing = [1,4].includes(report.washStation);
  const drying = report.washStation === 2;
  const collecting = report.dustStatus === 1;
  const stationActions = [
    ...(!report.inStation ? [station('返回基站','icon_left_back_station',{operation:'dock'},[5,10].includes(report.status))] : []),
    station(washing ? '停止清洗拖布' : '清洗拖布','icon_wash_rag',{operation:'wash',on:!washing},!report.inStation || collecting || ![0,1,4].includes(report.washStation)),
    station(drying ? '停止烘干' : '烘干拖布','icon_dry_mop',{operation:'dry',on:!drying},!report.inStation || collecting || ![0,2].includes(report.washStation)),
    station(collecting ? '集尘中' : '集尘','icon_collect_dust',{operation:'collect'},!report.inStation || report.dustEnable !== 1 || collecting || report.washStation !== 0),
  ];
  const locked = vacuumSettingsLocked(report);
  return {
    status: nativeStatus[report.status] ?? vacuumPhaseLabels.unknown,
    disabled: report.childLock || [11,14,16,19].includes(report.status),
    cleaning: station(report.cleaning ? '暂停' : report.paused ? '继续清洁' : '开始清洁',
      report.cleaning ? 'pause' : report.paused ? 'continue_clean' : 'start_clean', {operation:report.cleaning ? 'pause' : 'start'},
      !report.cleaning && (report.washStation !== 0 || collecting)),
    station: {key:'base',label:report.inStation ? '基站' : '回基站',art:report.inStation ? 'icon_left_station' : 'icon_left_back_station',run:() => state.showStation(true)},
    stationActions, locked,
    settings: [group('mode',report.mode,nativeModes),group('suction',report.suction,nativeSuction,report.mode === 1),group('water',report.water,nativeWater,report.mode === 2)],
    picker: state.manualOpen && !locked && report.mode !== 2 ? {title:'拖布水量',min:1,max:15,step:1,unit:'',
      value:state.manualWater ?? (report.water > 0 ? report.water : 10), update:value => state.setManualWater(value),
      close:() => state.showManual(false), save:value => {state.showManual(false);send({operation:'water',value});}} : undefined,
  };
}

function standardView(state: SpecVacuumState): VacuumView | undefined {
  const report = state.report;
  if (!report) return;
  const clean = vacuumPrimaryAction(report);
  const paused = report.phase === 'paused';
  const settings: SettingView[] = [];
  for (const key of Object.keys(vacuumSettingTitles) as VacuumSetting[]) {
    const binding = report.settings[key];
    if (!binding) continue;
    const locked = !vacuumSettingEnabled(report, key);
    const range = binding.range;
    if (range) {
      settings.push({key,locked,choices:[],adjustment:{property:{...binding.property,value:binding.value},unit:range.unit,
        run:value=>void state.select(key,binding.property,value)}});
    } else {
      settings.push({key,locked,current:binding.choices.find(choice => choice.value === binding.value)?.label,
        choices:binding.choices.map(({value,label,art}) => ({value,label,art,selected:value === binding.value,run:() => void state.select(key,binding.property,value)}))});
    }
  }
  const startModes = vacuumStartModes(report);
  if (startModes.length) {
    const current = startModes.find(choice=>choice.value===report.startMode);
    settings.unshift({key:'mode',current:current?.label,locked:clean?.role!=='start'||paused,
      choices:startModes.map(({value,label,art})=>({value,label,art,selected:value===current?.value,run:()=>state.selectStartMode(value)}))});
  }
  const stationActions = vacuumStationChoices(report).map(binding => {
    const [label,art] = stationLabels[binding.role]!;
    return {key:binding.role,label,art,disabled:!binding.enabled,run:() => void state.run(binding)};
  });
  const atStation = vacuumAtStation(report);
  const stationWorking = report.stationPhase && ['washing','drying','collecting'].includes(report.stationPhase);
  return {status:stationWorking ? vacuumPhaseLabels[report.stationPhase!] : report.status ?? vacuumPhaseLabels[report.phase],disabled:report.blocked || !report.phaseRead,locked:report.phase === 'cleaning',
    cleaning:clean ? {key:clean.role, label:clean.role === 'pause' ? '暂停' : clean.role === 'stop' ? '停止清洁' : paused ? '继续清洁' : '开始清洁',
      art:clean.role === 'start' ? paused ? 'continue_clean' : 'start_clean' : 'pause',run:() => void state.run(clean)} : undefined,
    station:report.station ? {key:'base',label:'基站',art:atStation ? 'icon_left_station' : 'icon_left_back_station',
      disabled:!stationActions.length,run:() => state.showStation(true)} : undefined,
    stationActions,settings};
}

export function vacuumPage(o: {device: Device; state: NativeVacuumViewState | SpecVacuumState; back: () => void; previous?: HTMLElement | null; mapSupported?: boolean; error?: string; retry?: () => void}): HTMLElement {
  const {device,state,previous} = o;
  const report = state.report;
  const view = state instanceof SpecVacuumState ? standardView(state) : state.report && nativeView(state,state.report);
  const stage = element('div','device-stage');
  const page = element('section','device-page page-vacuum device-surfaces');
  page.dataset.presentationTemplate = 'vacuum';
  page.setAttribute('aria-busy',String(state.loading || state.pending));
  const back = button('','page-icon-button',o.back,'back');
  back.setAttribute('aria-label','返回家庭');
  const title = element('div','device-page-title',element('h2','',device.name),
    view?.status ? element('span','vacuum-status',device.online ? view.status : '设备离线') : null);
  const body = element('div','device-page-scroll vacuum-content');
  page.append(element('header','device-page-header',back,title),body);
  stage.append(page);
  if (!view) {
    const error = state.error?.message ?? o.error;
    if (error) {
      const feedback = element('div','vacuum-feedback',element('p','',error));
      feedback.setAttribute('role','status');
      if (!state.loading) feedback.append(button('重新读取','button button-secondary',o.retry ?? (() => void state.read())));
      body.append(feedback);
    } else body.append(deviceLoading(undefined,device.name));
    return stage;
  }
  const frame = state.displayedMap;
  const oldPage = previous?.querySelector('.page-vacuum'), oldBody = oldPage?.querySelector('.vacuum-content');
  const oldMap = oldBody?.querySelector<HTMLElement>('.vacuum-map');
  const retained = frame && oldMap && mapFrames.get(oldMap) === frame ? oldMap : undefined;
  if (!retained) {
    const map = frame ? vacuumMap(frame,state.viewport,() => state.redraw())
      : element('div','vacuum-map vacuum-map-empty',state.loading ? '' : !device.online ? '设备离线'
        : !o.mapSupported ? '此型号暂无法读取地图' : report && 'mapReason' in report ? report.mapReason ?? '暂无清洁地图' : '暂无清洁地图');
    if (frame) {
      mapFrames.set(map,frame);
    }
    body.append(map);
  }

  const disabled = !device.online || !!device.sharedReadOnly || view.disabled || state.loading || !!state.error;
  const renderAction = (action: ActionView, station = false) => {
    const b = button('',station ? 'vacuum-main-action vacuum-station-action' : 'vacuum-main-action',() => {if (!b.disabled) action.run();});
    b.append(vacuumIcon(action.art),element('span','',action.label));
    b.disabled = disabled || !!action.disabled;
    b.dataset.vacuumAction = action.key;
    b.dataset.focusKey = station ? 'vacuum-station-' + action.key : action.key === 'base' ? 'vacuum-base' : 'vacuum-cleaning';
    return b;
  };
  const actions = element('div','vacuum-main-actions');
  if (view.station) {
    const base = renderAction(view.station);
    base.append(icon('chevron','vacuum-base-arrow'));
    actions.append(base);
  }
  if (view.cleaning) actions.append(renderAction(view.cleaning));
  if (actions.childElementCount) body.append(actions);

  if (view.settings.length) {
    const settings = element('section','vacuum-settings');
    settings.setAttribute('aria-label','清洁设置');
    settings.dataset.settingsLocked = String(view.locked);
    for (const group of view.settings) {
      const label = vacuumSettingTitles[group.key];
      const locked = disabled || view.locked || group.locked;
      if (group.adjustment) {
        const {property,unit,run}=group.adjustment;
        const track=renderControl({name:'Slider',props:{property,label,unit,theme:'brightness',
          endpoints:group.key==='water'?['droplet','droplet']:['fan-low','fan-high']}},
          {device,busy:locked,write:(_property,value)=>run(value),error:()=>{},interactionEnded:()=>state.redraw()});
        track.classList.add('vacuum-setting-group','vacuum-range');
        const slider=track.querySelector('input');
        if(slider){slider.dataset.vacuumRange=group.key;slider.dataset.focusKey=`vacuum-range-${group.key}`;}
        settings.append(track);
        continue;
      }
      const card = modeCard(label, group.choices.map(choice => ({
        label:choice.label, graphic:choiceIcon(group.key,choice.art), selected:choice.selected,
        press:locked ? undefined : choice.run,
        focusKey:`vacuum-${group.key}-${choice.value}`,
        decorate:control => {
          control.dataset.vacuumOperation = group.key;
          control.dataset.vacuumValue = String(choice.value);
        },
      })), group.current);
      card.classList.add('vacuum-setting-group');
      card.setAttribute('aria-label',label);
      settings.append(card);
    }
    body.append(settings);
  }

  const dialog = (label: string, dismiss: () => void, children: HTMLElement[]) => {
    const section = element('section','vacuum-dialog',...children);
    section.setAttribute('role','dialog');
    section.setAttribute('aria-modal','true');
    section.setAttribute('aria-label',label);
    const overlay = element('div','vacuum-dialog-overlay',section);
    dismissOnBackdrop(overlay,dismiss);
    page.append(overlay);
    return section;
  };
  if (state.stationOpen && view.station) {
    const dismiss = () => state.showStation(false);
    dialog('基站',dismiss,[element('h3','','基站'), ...view.stationActions.map(action => renderAction(action,true)),
      button('关闭','vacuum-dialog-close',dismiss)]);
  } else if (view.picker) {
    const picker = view.picker;
    const value = element('output','',picker.value + picker.unit);
    const slider = element('input');
    slider.type = 'range';
    slider.min = String(picker.min); slider.max = String(picker.max); slider.step = String(picker.step);
    slider.value = String(picker.value);
    slider.dataset.focusKey = 'vacuum-manual-range';
    slider.setAttribute('aria-label',picker.title);
    slider.disabled = disabled;
    const paint=()=>{slider.style.setProperty('--fill',`${(Number(slider.value)-picker.min)/(picker.max-picker.min)*100}%`);};
    paint();
    slider.addEventListener('input',() => {paint();value.value = slider.value + picker.unit;picker.update(Number(slider.value));});
    const save = button('确定','button button-primary',() => {if (!save.disabled) picker.save(Number(slider.value));});
    save.disabled = disabled;
    const section = dialog(picker.title,picker.close,[element('h3','',picker.title,value),brightnessSurface(slider,'white',['droplet','droplet']),
      element('div','vacuum-water-scale',picker.min + picker.unit,element('span','',picker.max + picker.unit)),
      element('footer','',button('取消','button button-secondary',picker.close),save)]);
    slider.addEventListener('pointerdown',event => {
      if (slider.disabled || event.button !== 0) return;
      slider.setPointerCapture(event.pointerId);
      section.dataset.interacting = 'true';
    });
    for (const event of ['pointerup','pointercancel','lostpointercapture']) slider.addEventListener(event,() => {
      if (section.dataset.interacting) {delete section.dataset.interacting;state.redraw();}
    });
  }

  if (previous && oldPage && oldBody && oldMap) {
    oldPage.querySelector('header')?.replaceWith(page.querySelector('header')!);
    oldPage.setAttribute('aria-busy',String(state.loading || state.pending));
    for (const child of [...oldBody.children]) if (!retained || child !== oldMap) child.remove();
    oldBody.append(...body.children);
    oldPage.querySelector('.vacuum-dialog-overlay')?.remove();
    const overlay = page.querySelector('.vacuum-dialog-overlay');
    if (overlay) oldPage.append(overlay);
    return previous;
  }
  return stage;
}
