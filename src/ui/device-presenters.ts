import {dropdownSelect} from './dropdown';
import {notice,type Notice} from './notice';
/** Shared desktop presentation. No account, IPC, or transport imports.
 * The host binds existing desktop behavior or an isolated browser simulation. */
import type {Device,DevicePanel,Property,Json,DeviceContext,HomeSnapshot,SensorHistory,AppError,HistorySelection,EnergySelection,EnergyReport} from '../types';
import {button,element} from './dom';
import type {IconName} from '../icons';
import {booleanValue,numericValue,findProperty,isReadableValue,climateChoiceLabel,fanModeLabel,fanSpeedProperty,lightGroupCounts,splitChildren,switchServices,controlReason} from '../panel-layout';
import {coercePropertyInput,initialInput,normalizeError,reportedValueText,sameContext} from '../logic';
import {deviceChoiceLabel,deviceServiceLabel} from '../device-labels';
import {dateKey,historyExtremes,sensorHistorySlots} from '../history';
import {historyChart} from './history-chart';
import {deviceWait} from './device-loading';
import {productHeader} from './product-header';
import {switchPolicy} from '../switch-mode';
import {renderLightColor} from './light-color';
import {lightWhitePresets} from './light-white';
import {energySupported} from '../energy';
import {energyEntrance} from './energy-page';
import type {ControlNode} from './controls';
export interface DevicePresenterHost {
 panel?:DevicePanel;context?:DeviceContext;panelEpoch:number;controlBusy:boolean;panelIsCached:boolean;panelNotice?:Notice;
 snapshot?:HomeSnapshot;linkedPanels:ReadonlyMap<string,DevicePanel>;linkedErrors?:ReadonlyMap<string,string>;
 sensorHistory?:SensorHistory;historyLoading:boolean;historyError?:AppError;
 energyData?:EnergyReport;energyLoading:boolean;energyError?:AppError;
 control:(node:ControlNode,device:Device)=>HTMLElement;
 deviceArtwork:(device:Device,className?:string,switchCount?:number,product?:boolean)=>HTMLElement;
 nativeSlider:(p:Property,label:string,unit:string,device:Device,disabled:boolean,theme:string)=>HTMLElement;
 nativeUnavailableFeature:(title:string,glyph:IconName,reason:string,subtitle?:string)=>HTMLElement;
 nativeTemperatureControl:(p:Property|undefined,device:Device,disabled:boolean)=>HTMLElement;
 nativeClimateChoices:(p:Property|undefined,title:string,device:Device,disabled:boolean)=>HTMLElement;
 nativeP69Swing:(p:Property|undefined,angle:Property|undefined,title:string,direction:'horizontal'|'vertical',device:Device,disabled:boolean)=>HTMLElement;
 renderYeelightStrip:(device:Device)=>HTMLElement;
 render:(preserve?:boolean)=>void;
 setBoundProperty:(p:Property,value:Json,did:string)=>Promise<unknown>;
 setProperty:(p:Property,value:Json)=>Promise<unknown>;
 selectHistoryDetail:(selection:HistorySelection)=>void;
 loadEnergy:(selection:EnergySelection)=>void;
}


export function renderLightPage(this: DevicePresenterHost, device: Device, group: boolean): HTMLElement {
    if(!group&&device.model==='yeelink.light.wyra01')return this.renderYeelightStrip(device);
    const on = findProperty(this.panel, ['light'], ['on']); const state = booleanValue(on);
    const view = element('div', `light-page-content${state === false ? ' device-is-off' : ''}`);
    const hero = element('div', 'light-hero');
    let status = state === undefined ? '状态未读取' : state ? '已开启' : '已关闭';
    if (group) {
      const counts = lightGroupCounts(device, this.snapshot?.devices ?? [], this.linkedPanels);
      status = !counts ? '灯组成员未读取' : counts.unread ? `${counts.on}个灯开启 · ${counts.off}个灯关闭 · ${counts.unread}个未读取` : counts.on === counts.total ? `${counts.total}个灯开启` : counts.off === counts.total ? `${counts.total}个灯关闭` : `${counts.on}个灯开启 · ${counts.off}个灯关闭`;
    }
    view.dataset.headerStatus=status;view.append(hero);
    const items: ControlNode[] = group ? [true, false].map(value => ({ name: 'Power', props: { property: on, label: value ? '全开' : '全关', style: 'wide', value, className: value ? 'power-open' : 'power-close', glyph: value ? 'light-all-on' : 'light-all-off' } })) : [{ name: 'Power', props: { property: on, label: '电源', style: 'wide', openLabel: '开启', closeLabel: '关闭' } }];
    view.append(this.control({ name: 'Container', props: { className: 'light-power-row' }, items }, device));
    if (group && !on) view.append(notice({ tone: 'warning', title: '灯组控制暂不可用', message: '云端灯组未提供可用 MIoT 开关；尚未核实灯组成员的控制协议，不能用任意同房间灯具代替。' }));
    for (const [name, label, unit, theme] of [['brightness', '亮度', '%', 'brightness'], ['color-temperature', '色温', 'K', 'temperature']] as const) {
      const property = findProperty(this.panel, ['light'], [name]);
      if (property) view.append(this.nativeSlider(property, label, unit, device, state !== true, theme));
    }
    const color=findProperty(this.panel,['light'],['color']);
    if(color){
      const context=this.context?{...this.context}:undefined,epoch=this.panelEpoch,current=()=>epoch===this.panelEpoch&&sameContext(context,this.context);
      const env={device,busy:this.controlBusy||this.panelIsCached,write:(property:Property,value:Json)=>{if(current())void this.setBoundProperty(property,value,device.did);},error:(error:unknown)=>{if(current()){this.panelNotice={tone:'error' as const,title:normalizeError(error).message};this.render(true);}},interactionEnded:()=>{if(current())this.render(true);}};
      const disabledReason=state!==true?'设备开启后可调节。':undefined;
      if(!findProperty(this.panel,['light'],['color-temperature']))view.append(lightWhitePresets(color,env,disabledReason));
      view.append(renderLightColor({property:color,tab:'color',disabledReason},env));
    }
    return view;
  }

export function renderAirConditionerPage(this: DevicePresenterHost, device: Device): HTMLElement {
    const on = findProperty(this.panel, ['air-conditioner'], ['on']);
    const mode = findProperty(this.panel, ['air-conditioner'], ['mode']);
    const target = findProperty(this.panel, ['air-conditioner'], ['target-temperature']);
    const fan = findProperty(this.panel, ['fan-control','air-conditioner'], ['fan-level','speed-level']);
    const indoor = findProperty(this.panel, ['environment'], ['temperature']);
    const state = booleanValue(on);
    const value = numericValue(target);
    const currentChoice = (property: Property | undefined): string => {
      if (!isReadableValue(property)) return '未读取';
      const choice = property.valueList?.find(item => JSON.stringify(item.value) === JSON.stringify(property.value));
      return choice ? climateChoiceLabel(choice.description) : '未知选项';
    };
    const view = element('div', `air-conditioner-content${state !== true ? ' device-is-off' : ''}`);
    const status = `${state === undefined ? '状态未读取' : state ? '开机' : '关机'} | ${currentChoice(mode)} | ${currentChoice(fan)}`;
    const hero = element('div', 'air-conditioner-hero', element('div', 'air-conditioner-temperature', element('strong', '', value === undefined ? '--' : String(value)), element('span', '', '℃')), element('p', '', status), indoor?element('p', '', numericValue(indoor) === undefined ? '室内温度: 未读取' : `室内温度: ${numericValue(indoor)}℃`):null);
    view.append(hero);
    if(findProperty(this.panel,['power-consumption'],['electric-power']))view.append(energyEntrance(this.energyData,this.panel,energySupported(device,this.panel)?()=>this.loadEnergy({period:'week',date:dateKey(new Date())}):undefined,this.energyLoading));
    const power = this.control({ name: 'Power', props: { property: on, label: '电源', style: 'wide', openLabel: '开机', closeLabel: '关机', className: 'air-conditioner-power' } }, device);
    if(on)view.append(power);
    if(target)view.append(this.nativeTemperatureControl(target, device, on?state !== true:false));
    if(mode)view.append(this.nativeClimateChoices(mode, '模式', device, on?state !== true:false));
    if(fan)view.append(this.nativeClimateChoices(fan, '风速', device, on?state !== true:false));
    return view;
  }

export function renderSensorPage(this: DevicePresenterHost, device: Device): HTMLElement {
    const view = element('div', 'sensor-page-content');
    const temperature = findProperty(this.panel, ['temperature-humidity-sensor'], ['temperature']);
    const humidity = findProperty(this.panel, ['temperature-humidity-sensor'], ['relative-humidity']);
    const tempUnit = temperature?.unit === 'celsius' ? '℃' : temperature?.unit ?? '单位未提供';
    const metrics: ControlNode[] = [
      { name: 'Status', props: { property: temperature, label: `温度(${tempUnit})`, precision: 1, style: 'metric', showSource: false } },
      { name: 'Status', props: { property: humidity, label: `湿度(${humidity?.unit === 'percentage' ? '%' : humidity?.unit ?? '单位未提供'})`, precision: 0, style: 'metric', showSource: false } },
    ];
    const hero = element('div', 'sensor-hero', this.control({ name: 'Container', props: { className: 'sensor-metrics' }, items: metrics }, device));
    const card = element('section', 'sensor-history-card');
    card.dataset.historyState = this.historyLoading ? 'loading' : this.historyError ? 'error' : 'loaded';
    if (this.sensorHistory) card.dataset.fetchedAt = String(this.sensorHistory.fetchedAt);
    const displayedHistory = sensorHistorySlots(this.sensorHistory);
    for (const [name, title, unit, precision] of [['temperature', '温度', '℃', 1], ['humidity', '湿度', '%', 0]] as const) {
      const entry = element('section', 'sensor-history-entry');
      const heading = element('header', 'sensor-history-heading', element('h3', '', title));
      heading.setAttribute('aria-description','云端历史');
      const channel = this.sensorHistory?.channels.find(channel => channel.name === name);
      const slots = displayedHistory[name];
      const message = this.historyError?.message ?? channel?.error ?? (!historyExtremes(slots) ? '暂无云端记录' : undefined);
      entry.append(heading,this.historyLoading&&!this.sensorHistory?deviceWait(()=>this.deviceArtwork(device),'历史数据'):message ? element('div', 'sensor-history-placeholder', message) : historyChart(slots, unit, precision));
      card.append(entry);
    }
    const more = button('查看更多', 'sensor-history-more', () => this.selectHistoryDetail({ period: 'day', date: dateKey(new Date()) }));
    more.disabled = this.historyError?.retryable === false;
    card.setAttribute('aria-description','显示最近24小时的云端记录；暂不含蓝牙设备内历史。');
    card.setAttribute('aria-description',(card.getAttribute('aria-description')??''));card.append(more);
    view.append(hero, card);

    return view;
  }

export function renderOutletPage(this: DevicePresenterHost, device: Device): HTMLElement {
    const view = element('div', 'outlet-page-content');
    view.append(productHeader(this.deviceArtwork(device,'',1,true),device.name,'outlet-hero'));
    const channels = switchServices(this.panel);
    const card = element('section', 'native-card outlet-channels', element('div', 'native-card-heading', '电源'));
    for (const service of channels) {
      const property = service.properties.find(p => p.name === 'on' && p.format === 'bool');
      const row = element('div', 'outlet-channel', this.deviceArtwork(device), element('strong', '', channels.length === 1 ? '开关' : deviceServiceLabel(service)));
      row.append(this.control({ name: 'Power', props: { property, label: channels.length === 1 ? device.name : service.description, style: 'round' } }, device));
      if (property?.lastReported) {const description=reportedValueText(property);if(description){row.setAttribute('aria-description',description);row.setAttribute('aria-description',description);row.dataset.readingSource='reported';}}
      card.append(row);
    }
    view.append(card);
    if(energySupported(device,this.panel)){
      view.append(energyEntrance(this.energyData,this.panel,()=>this.loadEnergy({period:'week',date:dateKey(new Date())}),this.energyLoading));
      if(this.energyError)view.append(notice({tone:'warning',title:this.energyError.message}));
      return view;
    }
    const power = findProperty(this.panel, ['power-consumption'], ['electric-power']);
    const consumption = findProperty(this.panel, ['power-consumption'], ['power-consumption']);
    if(power||consumption)view.append(energyEntrance(undefined,this.panel,undefined,false));
    view.append(this.nativeUnavailableFeature('用电统计', 'device', '暂不支持查看用电历史统计。'));
    return view;
  }

export function renderStandardFanPage(this: DevicePresenterHost, device: Device): HTMLElement {
    const on = findProperty(this.panel, ['fan'], ['on']); const state = booleanValue(on);
    const mode = findProperty(this.panel, ['fan'], ['mode']);
    const current = isReadableValue(mode) ? mode.valueList?.find(choice => JSON.stringify(choice.value) === JSON.stringify(mode.value)) : undefined;
    const view = element('div', `p69-fan-content${state !== true ? ' device-is-off' : ''}`);
    view.append(element('div', 'p69-fan-hero', element('h1', '', current ? fanModeLabel(current.description) : state === undefined ? '未读取' : state ? '运行中' : '关机')));
    const disabledReason = state !== true ? '风扇开启后可调节。' : undefined;
    const items: ControlNode[] = [{ name: 'Power', props: { property: on, label: '电源', style: 'wide', openLabel: '开启', closeLabel: '关闭' } }];
    if (mode) items.push({ name: 'Selector', props: { property: mode, label: '模式', style: 'standard', choiceLabel: fanModeLabel, choiceIcon: description => /natural|自然/i.test(description) ? 'leaf' : /sleep|睡眠/i.test(description) ? 'moon' : 'wind', disabledReason } });
    const gear = fanSpeedProperty(this.panel, 'gear');
    const stepless = fanSpeedProperty(this.panel, 'stepless');
    if (gear) items.push(gear.valueList!.length <= 4 ? { name: 'Selector', props: { property: gear, label: '风速档位', style: 'standard', showValue: true, choiceLabel: description => description.replace(/^Level\s*(\d+)$/i, '$1档'), choiceSymbol: description => description.replace(/^Level\s*(\d+)$/i, '$1'), disabledReason } } : { name: 'Slider', props: { property: gear, label: '风速档位', theme: 'fan', discrete: true, disabledReason } });
    if (!gear&&stepless) items.push({ name: 'Slider', props: { property: stepless, label: '无级调速', theme: 'fan', disabledReason } });
    const controls = this.control({ name: 'Container', props: {}, items }, device);
    for (const [name, label, direction] of [['horizontal-swing', '左右摆风', 'horizontal'], ['vertical-swing', '上下摆风', 'vertical']] as const) {
      const property = findProperty(this.panel, ['fan'], [name]);
      if (property) controls.append(this.nativeP69Swing(property, findProperty(this.panel, ['fan'], [name + '-included-angle']), label, direction, device, state !== true));
    }
    view.append(controls);
    return view;
  }

export function nativeTemperatureControl(this: DevicePresenterHost, property: Property | undefined, device: Device, disabledByPower: boolean): HTMLElement {
    return this.control({ name: 'Slider', props: { property, label: '温度调节', unit: '℃', style: 'temperature', disabledReason: disabledByPower ? '空调开启后可调节温度。' : undefined } }, device);
  }

export function nativeClimateChoices(this: DevicePresenterHost, property: Property | undefined, title: string, device: Device, disabledByPower: boolean): HTMLElement {
    const glyphs: Record<string, IconName> = { cool: 'snowflake', heat: 'sun', fan: 'fan', dry: 'droplet', low:'fan-low',medium:'fan-medium',high:'fan-high' };
    return this.control({ name: 'Selector', props: { property, label: title, style: 'climate', choiceLabel: climateChoiceLabel, choiceIcon: description => glyphs[description.toLowerCase().trim()], choiceSymbol: description => description.toLowerCase().trim()==='auto'?'A':undefined, disabledReason: disabledByPower ? `空调开启后可调节${title}。` : undefined } }, device);
  }

export function nativeP69Swing(this: DevicePresenterHost, property: Property | undefined, angle: Property | undefined, title: string, direction: 'horizontal' | 'vertical', device: Device, disabledByPower: boolean): HTMLElement {
    const state = booleanValue(property);
    const reason = controlReason(property, device.online, this.controlBusy) ?? (state === undefined ? '摆风状态未读取，请先读取状态。' : undefined);
    const card = element('section', 'native-card p69-swing-card');
    const row = this.control({ name: 'Power', props: { property, label: title, style: 'setting', glyph: direction === 'horizontal' ? 'swing-horizontal' : 'swing-vertical', disabledReason: disabledByPower ? '风扇开启后可调节摆风。' : undefined } }, device);
    card.append(row);
    if (state === true && angle) {
      const label = element('label', 'p69-angle-label', `${title}夹角`);
      const select=dropdownSelect({label:`${title}夹角`,className:'p69-angle-select',value:initialInput(angle),options:[{value:'',label:'未读取',disabled:true},...(angle.valueList??[]).map((option,index)=>({value:String(index),label:typeof option.value==='number'&&angle.unit==='arcdegrees'?`${option.value}°`:deviceChoiceLabel(option.description,`选项${index+1}`)}))]});
      select.id=`p69-angle-${angle.siid}-${angle.piid}`;label.htmlFor=select.id;
      const angleReason = controlReason(angle, device.online, this.controlBusy);
      select.disabled = !!angleReason || disabledByPower || !angle.valueList?.length || !isReadableValue(angle);
      if (angleReason) select.setAttribute('aria-description',angleReason); else if (disabledByPower) select.setAttribute('aria-description','风扇开启后可调节摆风夹角。');
      select.addEventListener('change', () => { try { void this.setProperty(angle, coercePropertyInput(angle, select.value)); } catch (error) { this.panelNotice = { tone: 'error', title: normalizeError(error).message }; this.render(); } });
      card.append(element('div', `p69-angle-row${disabledByPower ? ' control-off' : ''}`, label, select));
    }
    if (reason) card.setAttribute('aria-description', reason); return card;
  }


export function renderSwitchPage(this: DevicePresenterHost, device: Device): HTMLElement {
    const view = element('div', 'switch-page-content');
    const title = device.controlServiceId != null ? device.name : device.controlGroupName || device.name;
    const channelCount = splitChildren(this.snapshot?.devices ?? [], device).length || switchServices(this.panel).length || 1;
    view.append(productHeader(this.deviceArtwork(device,'',channelCount,true),title,'switch-hero'));
    const keys = element('section', 'native-card switch-keys', element('div', 'native-card-heading', '按键'));
    const children = splitChildren(this.snapshot?.devices ?? [], device);
    if (children.length) {
      for (const child of children) {
        const linked = child.did === this.context?.did ? this.panel : this.linkedPanels.get(child.did);
        // The parent already reads these exact service IIDs. Use that current
        // channel data while its independent child request is still pending.
        const parent=this.panel?.model===child.model?this.panel:undefined;
        const panel=linked??parent;
        const property = linked?findProperty(linked,['switch'],['on']):parent?.services.find(s=>s.name==='switch'&&s.siid===child.controlServiceId)?.properties.find(p=>p.name==='on');
        keys.append(renderSwitchKey.call(this, child, child.name, property, this.linkedErrors?.get(child.did),panel));
      }
    } else {
      const services = switchServices(this.panel);
      for (const service of services) keys.append(renderSwitchKey.call(this, device, services.length === 1 ? device.name : deviceServiceLabel(service), service.properties.find(item => item.name === 'on')));
      if (!services.length) keys.append(element('p', 'native-unavailable', '暂无可用按键'));
    }
    view.append(keys);
    return view;
  }

function renderSwitchKey(this: DevicePresenterHost, device: Device, name: string, property: Property | undefined, error?: string,panel:DevicePanel|undefined=this.panel): HTMLElement {
    const policy=switchPolicy(panel,property);
    const room=device.roomName || '未分配房间';
    const subtitle=policy.label?`${room} | 已转${policy.label}`:room;
    const row = element('div', 'switch-key-row', this.deviceArtwork(device,'switch-key-artwork',device.controlServiceId == null && device.model === 'linp.switch.e2db3' ? 3 : 1,true), element('div', 'switch-key-label', element('strong', '', name), element('span', '', subtitle)));
    if(policy.label)row.dataset.switchMode=policy.label;
    const toggle = this.control({ name: 'Power', props: { property, label: name, style: 'round', disabledReason: error??policy.reason } }, device);
    if(policy.label){
      toggle.classList.add('is-on');
      toggle.setAttribute('aria-pressed','true');
      toggle.setAttribute('aria-label',`${name}：已转${policy.label}，保持供电`);
    }
    row.append(toggle); return row;
  }

export function renderFanPage(this: DevicePresenterHost, device: Device): HTMLElement {
    const on = findProperty(this.panel, ['fan'], ['on']); const state = booleanValue(on);
    const humidity = findProperty(this.panel, ['environment'], ['relative-humidity']);
    const temperature = findProperty(this.panel, ['environment'], ['temperature']);
    const view = element('div', `fan-page-content${state === false ? ' device-is-off' : ''}`);
    const climate = element('div', 'fan-climate');
    for (const [property, label] of [[humidity, '湿度(%)'], [temperature, '室温(℃)']] as const) climate.append(element('div', '', element('strong', '', numericValue(property) === undefined ? '--' : String(numericValue(property))), element('span', '', label)));
    view.append(element('div', 'fan-hero', element('div', 'fan-big-status', state === undefined ? '未读取' : state ? '运行中' : '关机'), climate));
    view.append(this.control({ name: 'Power', props: { property: on, label: '电源', openLabel: '开启', closeLabel: '关闭', style: 'wide' } }, device));
    const mode = findProperty(this.panel, ['fan'], ['mode']);
    if (mode) view.append(this.control({ name: 'Selector', props: { property: mode, label: '模式', style: 'fan', choiceLabel: fanModeLabel, choiceIcon: description => /natural|自然/i.test(description) ? 'leaf' : /sleep|睡眠/i.test(description) ? 'moon' : /smart|智能|auto|自动/i.test(description) ? 'climate' : 'wind', disabledReason: state !== true ? '风扇开启后可调节模式。' : undefined } }, device));
    const speed = fanSpeedProperty(this.panel, 'gear')??findProperty(this.panel, ['fan'], ['fan-level', 'stepless-fan-level', 'speed-level']);
    if (speed) view.append(speed.valueList?.length ? nativeFanSpeed.call(this, speed, device, state !== true) : this.nativeSlider(speed, '风速档位', '', device, state !== true, 'fan'));
    for (const [name, label] of [['horizontal-swing', '左右摆风'], ['vertical-swing', '上下摆风']] as const) {
      const property = findProperty(this.panel, ['fan'], [name]); if (!property) continue;
      view.append(this.control({ name: 'Power', props: { property, label, style: 'wide', showToggle:true, glyph: name==='horizontal-swing'?'swing-horizontal':'swing-vertical', className: `fan-swing${booleanValue(property) === true ? ' is-on' : ''}`, disabledReason: state !== true ? '风扇开启后可调节摆风。' : undefined } }, device));
    }
    return view;
  }

function nativeFanSpeed(this: DevicePresenterHost, property: Property, device: Device, disabledByPower: boolean): HTMLElement {
    return this.control({ name: 'Slider', props: { property, label: '风速档位', theme: 'fan', discrete: true, choiceLabel: description => description.replace(/^Level\s*(\d+)$/i, '$1档'), disabledReason: disabledByPower ? '风扇开启后可调节风速。' : undefined } }, device);
  }
