import type { Device, DevicePanel, Json, Property, Service } from './types';
import { coercePropertyInput, writeUnsupportedReason } from './logic';
import { capabilityBinding, capabilityCategory, resolveDeviceCapabilities, type DeviceCapabilities } from './device-capabilities';
import {deviceChoiceLabel} from './device-labels';
import {lightChannelBindings} from './light-bindings';
import {airPurifierBindings,environmentCategory,fanDetailBindings,simpleClimateBindings,simpleClimateCategory,type SimpleClimateCategory} from './environment-controls';
import {climateMeter} from './energy';

export type PanelLayout = 'switch' | 'light' | 'light-group' | 'curtain' | 'fan' | 'fan-p69' | 'fan-standard' | 'air-conditioner' | 'air-purifier' | 'outlet' | 'temperature-humidity-sensor' | 'generic' | SimpleClimateCategory;

export function miotCategory(type: string | null | undefined): string | undefined {
  const match = /^urn:miot-spec-v[23]:device:([a-z0-9-]+):/.exec(type ?? '');
  return match?.[1];
}

// The actual instance type selects a category, independently of the brand.
// A matching service is required: a fan's indicator light must not select a
// light page. Model exceptions only select previously observed visual profiles.
export function panelLayout(device: Device | undefined, panel?: DevicePanel): PanelLayout {
  if (!device || !panel || panel.did !== device.did || panel.model !== device.model || panel.unsupportedReason) return 'generic';
  const capabilities=resolveDeviceCapabilities(panel);
  const category = capabilityCategory(panel.specType ?? device.specType);
  const environment=environmentCategory(device,panel);
  if(simpleClimateCategory(environment))
    return Object.values(simpleClimateBindings(device,panel,environment)).some(Boolean)?environment:'generic';
  if(environment==='fan'){
    const {on,mode,gear,continuous,horizontal,vertical}=fanDetailBindings(device,panel);
    if(on||mode||gear||continuous||horizontal||vertical)
      return device.model==='dmaker.fan.p28'?'fan':device.model==='xiaomi.fan.p69'?'fan-p69':'fan-standard';
    return 'generic';
  }
  if(environment==='air-conditioner'||environment==='air-condition-outlet')
    return climateBindings(panel,capabilities,device.controlServiceId)||
      climateMeter(device,panel)?'air-conditioner':'generic';
  if(environment==='air-purifier')
    return Object.values(airPurifierBindings(device,panel)??{}).some(Boolean)?'air-purifier':'generic';
  if(lightChannelBindings(panel,panel.specType??device.specType).length)
    return device.model==='mijia.light.group3'?'light-group':'light';
  if(capabilities.profile!=='standard')return 'generic';
  const has = (name: string): boolean => panel.services.some(service => service.name === name);
  if (['switch', 'relay', 'control-panel'].includes(category ?? '') && switchServices(panel).length) return 'switch';
  // The compared curtain drawing includes a verified write-only transport.
  // Other models use the standard renderer unless independent motion readback
  // is known; an enum name alone does not validate that private interaction.
  if (category === 'curtain' && has('curtain') && hasObservedDeviceLayout(device.model)) return 'curtain';
  if (category === 'outlet' && switchServices(panel).length) return 'outlet';
  if (category === 'temperature-humidity-sensor' && has('temperature-humidity-sensor') &&
    ['temperature','relative-humidity'].every(name=>capabilities.properties.filter(p=>p.role===`temperature-humidity-sensor.${name}`&&p.kind==='reading'&&p.unit===(name==='temperature'?'celsius':'percentage')).length===1)) return 'temperature-humidity-sensor';
  return 'generic';
}

/** An air conditioner's own power and the socket relay are distinct endpoints. */
export function climateBindings(panel: DevicePanel | undefined, capabilities = panel && resolveDeviceCapabilities(panel), serviceId?: number | null) {
  if (!panel || !capabilities || !['air-conditioner', 'air-condition-outlet'].includes(capabilities.category ?? '')) return;
  if (panel.services.filter(s => s.name === 'air-conditioner'&&(serviceId==null||s.siid===serviceId)).length !== 1) return;
  const bound = (role: string, kinds: DeviceCapabilities['properties'][number]['kind'][], unit?: string) => {
    const matches = capabilities.properties.filter(p => p.role === role && kinds.includes(p.kind) && (!unit || p.unit === unit) &&
      (serviceId==null||p.siid===serviceId));
    return matches.length === 1 ? capabilityBinding(panel, matches[0]) : undefined;
  };
  const on = bound('air-conditioner.on', ['power']);
  if (!on) return;
  const fanKinds: DeviceCapabilities['properties'][number]['kind'][] = ['enum', 'range'];
  return {
    on,
    target: bound('air-conditioner.target-temperature', ['range', 'enum'], 'celsius'),
    mode: bound('air-conditioner.mode', ['enum']),
    fan: bound('fan-control.fan-level', fanKinds) ?? bound('fan-control.speed-level', fanKinds)
      ?? bound('air-conditioner.fan-level', fanKinds),
    indoor: bound('environment.temperature', ['reading'], 'celsius'),
    horizontal: bound('fan-control.horizontal-swing',['toggle'])??bound('air-conditioner.horizontal-swing',['toggle']),
    vertical: bound('fan-control.vertical-swing',['toggle'])??bound('air-conditioner.vertical-swing',['toggle']),
    relay: climateRelayBinding(panel,capabilities,serviceId),
  };
}

export function climateRelayBinding(panel: DevicePanel | undefined, capabilities = panel && resolveDeviceCapabilities(panel), serviceId?: number | null): Property | undefined {
  if(!panel||capabilities?.category!=='air-condition-outlet')return;
  const relays=capabilities.properties.filter(p=>p.role==='air-condition-outlet.on'&&p.kind==='power'&&(serviceId==null||p.siid===serviceId));
  if(relays.length===1)return capabilityBinding(panel,relays[0]);
}

// This records visual comparison scope, never protocol support or routing.
export function hasObservedDeviceLayout(model: string): boolean {
  return ['linp.switch.e2db3', 'mijia.light.group3', 'yeelink.light.wyra01', 'xiaomi.curtain.acn009', 'dmaker.fan.p28', 'xiaomi.fan.p69', 'lemesh.airc.b27m', 'yeelink.bhf_light.v13', 'yeelink.ven_fan.vf3'].includes(model);
}

export function findProperty(panel: DevicePanel | undefined, serviceNames: string[], propertyNames: string[]): Property | undefined {
  for (const name of propertyNames) {
    for (const service of panel?.services ?? []) {
      if (!serviceNames.includes(service.name)) continue;
      const property = service.properties.find(item => item.name === name);
      if (property) return property;
    }
  }
  return undefined;
}

export function isReadableValue(property: Property | undefined): property is Property & { value: Exclude<Json, null> } {
  return !!property && property.access.includes('read') && (property.code == null || property.code === 0) && property.value !== undefined && property.value !== null;
}

export function booleanValue(property: Property | undefined): boolean | undefined {
  return isReadableValue(property) && typeof property.value === 'boolean' ? property.value : undefined;
}

export function numericValue(property: Property | undefined): number | undefined {
  return isReadableValue(property) && typeof property.value === 'number' ? property.value : undefined;
}

// Display-only reading selection. Interactive controls deliberately continue to
// use booleanValue/numericValue, which accept direct readings only.
export function propertyReading(property: Property | undefined): { value: Json | undefined; source: 'live' | 'recent' | 'reported' | 'missing' } {
  if (isReadableValue(property)) return { value: property.value, source: 'live' };
  if (property?.access.includes('read') && property.recentObservation && property.recentObservation.expiresAt > Date.now()) return {value:property.recentObservation.value,source:'recent'};
  if (property?.access.includes('read') && property.lastReported?.value != null) return { value: property.lastReported.value, source: 'reported' };
  return { value: undefined, source: 'missing' };
}

export function controlReason(property: Property | undefined, online: boolean, busy: boolean): string | undefined {
  if (!online) return '设备离线，恢复在线后可操作。';
  if (!property) return '此型号的设备描述未提供这项功能。';
  if (!property.access.includes('write')) return '此属性仅支持读取。';
  const reason = writeUnsupportedReason(property);
  if (reason) return reason;
  if (busy) return '正在等待设备状态回读。';
  return undefined;
}

export function splitChildren(devices: Device[], selected: Device): Device[] {
  if (!selected.controlGroup || selected.controlServiceId != null) return [];
  return devices.filter(item => item.controlGroup === selected.controlGroup && item.controlServiceId != null)
    .sort((a, b) => a.controlServiceId! - b.controlServiceId!);
}

export function switchServices(panel: DevicePanel | undefined): Service[] {
  const category = capabilityCategory(panel?.specType);
  if (panel && category === 'air-condition-outlet') {
    const relays = resolveDeviceCapabilities(panel).properties.filter(p => p.role === 'air-condition-outlet.on' && p.kind === 'power');
    return relays.length === 1 && capabilityBinding(panel, relays[0]) ? panel.services.filter(s => s.siid === relays[0].siid) : [];
  }
  return (panel?.services ?? []).filter(service => (service.name === 'switch'||category==='outlet'&&service.name==='outlet') && service.properties.some(item => item.name === 'on' && item.format === 'bool'));
}

export function fanModeLabel(description: string): string {
  const name = description.toLowerCase().replace(/[\s_-]/g, '');
  const labels: Record<string, string> = {
    straightwind: '直吹风', directwind: '直吹风', naturalwind: '自然风',
    smartwind: '智能风', smart: '智能风', sleepwind: '睡眠风', sleep: '睡眠风',
  };
  return labels[name] ?? deviceChoiceLabel(description);
}

export function fanSpeedSteps(property: Property): { value: Json; label: string }[] {
  return (property.valueList ?? []).map(choice => ({
    value: choice.value,
    label: choice.description.replace(/^Level\s*(\d+)$/i, '$1档'),
  }));
}

export function fanSpeedIndex(property: Property): number {
  if (!isReadableValue(property)) return -1;
  return fanSpeedSteps(property).findIndex(choice => JSON.stringify(choice.value) === JSON.stringify(property.value));
}

export function fanSpeedProperty(panel: DevicePanel | undefined, kind: 'gear' | 'stepless'): Property | undefined {
  const properties = (panel?.services ?? []).filter(service => service.name === 'fan').flatMap(service => service.properties);
  return properties.find(property => ['fan-level','speed-level','stepless-fan-level'].includes(property.name) && (kind === 'gear'
    ? !!property.valueList?.length && !property.valueRange
    : !!property.valueRange && !property.valueList));
}

export function climateChoiceLabel(description: string): string {
  const labels: Record<string, string> = {
    cool: '制冷', heat: '制热', fan: '送风', dry: '除湿',
    auto: '自动', low: '低速', medium: '中速', high: '高速',
  };
  return labels[description.toLowerCase().trim()] ?? deviceChoiceLabel(description);
}

export function climateChoiceIndex(choice:NonNullable<Property['valueList']>[number],kind:'mode'|'fan'):number {
  const choices=kind==='mode' ? [
    /^(cool|cooling|制冷)(模式)?$/i,/^(heat|heating|制热)(模式)?$/i,
    /^(fan|fan[ -]?only|ventilation|送风|通风)(模式)?$/i,/^(dry|dehumidify|dehumidification|除湿)(模式)?$/i,
  ] : [
    /^(low(?:[ -]?(?:speed|level))?|低速|低[档挡])$/i,
    /^(mid|medium|middle|midium)(?:[ -]?(?:speed|level))?$|^(中速|中[档挡])$/i,
    /^(high(?:[ -]?(?:speed|level))?|高速|高[档挡])$/i,/^(auto|automatic|自动)(?:[ -]?speed)?$/i,
  ];
  return choices.findIndex(pattern=>pattern.test(choice.description.trim())||pattern.test(choice.localizedDescription?.trim()??''));
}

export function climateStepValue(property: Property, direction: -1 | 1): Json {
  const value = numericValue(property);
  const range = property.valueRange;
  if (value === undefined || !range || property.valueList) throw new Error('温度范围或当前状态不可用，请重新读取状态。');
  const next = Number((value + direction * range[2]).toFixed(8));
  return coercePropertyInput(property, String(next));
}

export function lightGroupCounts(group: Device, devices: Device[], panels: ReadonlyMap<string, DevicePanel>): { total: number; on: number; off: number; unread: number } | undefined {
  if (!group.groupMembers?.length) return undefined;
  const members = [...new Set(group.groupMembers)];
  const counts = { total: members.length, on: 0, off: 0, unread: 0 };
  for (const did of members) {
    const device = devices.find(item => item.did === did);
    const panel = panels.get(did);
    const state = device?.online && panel?.did === did ? booleanValue(findProperty(panel, ['light'], ['on'])) : undefined;
    if (state === true) counts.on++;
    else if (state === false) counts.off++;
    else counts.unread++;
  }
  return counts;
}
