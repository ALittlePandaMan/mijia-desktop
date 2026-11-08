import rules from './device-capability-rules.json';
import type { Action, DevicePanel, Json, Property, Service } from './types';

export type CapabilityKind = 'power' | 'toggle' | 'range' | 'enum' | 'reading' | 'command';
export interface CapabilityProperty {
  role: string; siid: number; piid: number; service: string; name: string;
  label: string; kind: CapabilityKind; unit: string | null;
}
export interface CapabilityAction {
  role: string; siid: number; aiid: number; service: string; name: string; label: string;
}
export interface DeviceCapabilities {
  version: 2; category: string | null; profile: 'standard' | 'none'; family: string; readOnly: boolean;
  properties: CapabilityProperty[]; actions: CapabilityAction[];
  privateFeatures: { feature: string; reason: string }[];
  events: {role:string;siid:number;eiid:number;service:string;name:string;arguments:number[]}[];
}
interface CategoryRule {
  title: string; primary: string[]; properties: Record<string, string[]>;
  actions: Record<string, string[]>; privateFeatures: { feature: string; reason: string }[];
  family?: string; readOnly?: boolean; readings?:Record<string,string[]>;
  safeSettings?:Record<string,string[]>; events?:Record<string,string[]>;
}
const categories: Record<string, CategoryRule> = rules.categories;
const aliases: Record<string, string> = rules.aliases;
const labels: Record<string, string> = rules.labels;
const actionLabels: Record<string, string> = rules.actionLabels;
const numbers = new Set(['uint8', 'uint16', 'uint32', 'uint64', 'int8', 'int16', 'int32', 'int64', 'float', 'double']);
const own = <T>(map: Record<string, T>, key: string): T | undefined => Object.hasOwn(map, key) ? map[key] : undefined;

export function capabilityCategory(type: string | null | undefined): string | undefined {
  const name = /^urn:miot-spec-v[23]:device:([a-z0-9-]+):/.exec(type ?? '')?.[1];
  return name ? own(aliases, name) ?? name : undefined;
}
export function capabilityCategoryTitle(category: string | null | undefined): string {
  return category ? own(categories, category)?.title ?? '设备' : '设备';
}
export function hasCapabilityCategory(category: string | null | undefined): boolean {
  return !!category && Object.hasOwn(categories, own(aliases, category) ?? category);
}
export function readOnlyCategory(type:string|null|undefined):boolean{
 const category=capabilityCategory(type);return !!category&&!!own(categories,category)?.readOnly;
}
function scalar(value: Json, format: string): boolean {
  return format === 'bool' ? typeof value === 'boolean' : numbers.has(format)
    ? typeof value === 'number' && Number.isFinite(value)
    : format === 'string' && typeof value === 'string';
}
function validChoices(property: Property): boolean {
  const choices = property.valueList;
  return !!choices?.length && !property.valueRange && choices.every(choice => scalar(choice.value, property.format))
    && new Set(choices.map(choice => JSON.stringify(choice.value))).size === choices.length;
}
function validRange(property: Property): boolean {
  const range = property.valueRange;
  return numbers.has(property.format) && !property.valueList && !!range && range.length === 3
    && range.every(Number.isFinite) && range[1] > range[0] && range[2] > 0;
}
function propertyKind(property: Property): CapabilityKind | undefined {
  if (property.unsupportedReason || !['bool', 'string', ...numbers].includes(property.format)) return undefined;
  if (property.name === 'on' && property.format !== 'bool') return undefined;
  if (['temperature', 'target-temperature', 'refrigerator-temperature', 'freezer-temperature', 'refrigerating-room', 'freezing-room', 'refrigerator-temperature-set', 'freezer-temperature-set'].includes(property.name)
    && (!numbers.has(property.format) || !['celsius', 'fahrenheit', 'kelvin'].includes(property.unit ?? ''))) return undefined;
  if (['relative-humidity', 'target-humidity'].includes(property.name)
    && (!numbers.has(property.format) || !['percentage', 'percent'].includes(property.unit ?? ''))) return undefined;
  const readable = property.access.includes('read');
  // A control requires direct readback, never just a writable identifier.
  if (readable && property.access.includes('write')) {
    if (property.format === 'bool' && !property.valueList && !property.valueRange) return property.name === 'on' ? 'power' : 'toggle';
    if (validChoices(property)) return 'enum';
    if (validRange(property)) return 'range';
  }
  return readable ? 'reading' : undefined;
}
function validIid(iid: number): boolean { return Number.isSafeInteger(iid) && iid > 0 && iid <= 0xffffffff; }

export function motionFeedback(panel:DevicePanel,siid:number):Property|undefined{
 const service=panel.services.find(s=>s.siid===siid);
 return service?.properties.find(p=>p.access.includes('read')&&(p.name==='current-position'&&validRange(p)||p.name==='status'&&validChoices(p)));
}
function motionKind(panel:DevicePanel,p:Property):boolean{
 return ['airer','curtain'].includes(capabilityCategory(panel.specType)??'')&&p.name==='motor-control'&&p.access.includes('write')&&!p.access.includes('read')&&validChoices(p)&&!!motionFeedback(panel,p.siid)&&p.valueList!.every(v=>/^(up|down|open|close|pause|stop|raise|lower)$/i.test(v.description.trim()));
}

/** Resolve public semantic abilities, not a brand or a guessed property number.
 * The shared JSON is also consumed by Rust; values and authorization remain in
 * the actual panel rather than being duplicated in this presentation manifest. */
export function resolveDeviceCapabilities(panel: DevicePanel): DeviceCapabilities {
  const category = capabilityCategory(panel.specType) ?? null;
  let rule = category ? own(categories, category) : undefined;
  const model=own(rules.models as Record<string,{specTypes:string[];primary:string[];properties:Record<string,string[]>;readings:Record<string,string[]>;events:Record<string,string[]>}>,panel.model);
  if(rule&&model?.specTypes.includes(panel.specType??''))rule={...rule,primary:[...rule.primary,...model.primary],properties:{...rule.properties,...model.properties},readings:{...rule.readings,...model.readings},events:{...rule.events,...model.events}};
  const result: DeviceCapabilities = { version: 2, category, profile: 'none', family:rule?.family??'other', readOnly:rule?.readOnly??false, properties: [], actions: [], privateFeatures: [],events:[] };
  if (!rule || panel.unsupportedReason) return result;
  result.privateFeatures = rule.privateFeatures.map(feature => ({ ...feature }));
  if (category === 'television' && panel.services.some(service => service.name === 'ir-tv-control')) {
    result.privateFeatures.push({ feature: 'ir-remote', reason: '此型号的电视按键采用红外专用协议，需已验证的码库与编码适配器，不能套用其他电视指令。' });
  }
  if (!panel.services.some(service => validIid(service.siid) && rule.primary.includes(service.name))) return result;
  const propertyIds = panel.services.flatMap(service => service.properties.map(property => `${property.siid}.${property.piid}`));
  const actionIds = panel.services.flatMap(service => service.actions.map(action => `${action.siid}.${action.aiid}`));
  for (const service of panel.services) {
    if (!validIid(service.siid) || rules.excludedServices.includes(service.name)) continue;
    // Duplicate service IDs are ambiguous even if their property names differ.
    if (panel.services.filter(item => item.siid === service.siid).length !== 1) continue;
    for (const property of service.properties) {
      if (property.siid !== service.siid || !validIid(property.piid) || propertyIds.filter(id => id === `${property.siid}.${property.piid}`).length !== 1) continue;
      const kind = propertyKind(property)??(motionKind(panel,property)?'command':undefined);
      if (!kind && property.name === 'motor-control' && own(rule.properties, service.name)?.includes(property.name)
        && property.access.includes('write') && !property.access.includes('read')
        && !result.privateFeatures.some(feature => feature.feature === 'movement-readback')) {
        result.privateFeatures.push({ feature: 'movement-readback', reason: '此型号的升降或开合指令没有属性回读能力；需验证独立运动状态后才能提供可靠控制。' });
      }
      if (!kind) continue;
      const retainedControl = (!rule.readOnly||!!own(rule.safeSettings??{},service.name)?.includes(property.name)) && (own(rule.properties, service.name)?.includes(property.name) ?? false);
      const readingService = rule.primary.includes(service.name) || !!own(rule.properties, service.name) || rules.readingServices.includes(service.name);
      const retainedReading = property.access.includes('read') && ((own(rule.readings??{},service.name)?.includes(property.name)??false)||readingService && !property.access.includes('write') && rules.readings.includes(property.name));
      // Switches stay deliberately limited to independent relay power.
      if (category === 'switch' && !(service.name === 'switch' && property.name === 'on')) continue;
      if (category === 'camera' && !(service.name === 'camera-control' && ['on', 'status', 'fault'].includes(property.name) || service.name === 'battery' && property.name === 'battery-level')) continue;
      if (!retainedControl && !retainedReading) continue;
      result.properties.push({ role: `${service.name}.${property.name}`, siid: property.siid, piid: property.piid,
        service: service.name, name: property.name, label: own(labels, property.name) ?? property.description,
        kind: retainedControl ? kind : 'reading', unit: property.unit ?? null });
    }
    for(const event of service.events??[]){
      if(event.siid!==service.siid||!validIid(event.eiid)||!own(rule.events??{},service.name)?.includes(event.name)||service.events!.filter(e=>e.eiid===event.eiid).length!==1||new Set(event.arguments).size!==event.arguments.length||!event.arguments.every(id=>service.properties.filter(p=>p.piid===id).length===1))continue;
      result.events.push({role:`${service.name}.${event.name}`,siid:service.siid,eiid:event.eiid,service:service.name,name:event.name,arguments:[...event.arguments]});
    }
    for (const action of service.actions) {
      if(category==='washer'&&panel.model!=='midjd8.washer.42'){
        const choices=(name:string)=>service.properties.find(p=>p.name===name&&p.access.includes('read'))?.valueList?.map(v=>v.description.trim().toLowerCase())??[];
        const status=choices('status'),fault=choices('fault');
        if(!fault.some(v=>['no fault','no faults'].includes(v))||!status.includes(action.name==='start-wash'?'paused':'busy'))continue;
      }
      if (action.siid !== service.siid || !validIid(action.aiid) || actionIds.filter(id => id === `${action.siid}.${action.aiid}`).length !== 1
        || action.unsupportedReason || rule.readOnly || !own(rule.actions, service.name)?.includes(action.name)) continue;
      if(action.in.length&&(!rules.parameterizedActions.includes(`${category}.${action.name}`)||new Set(action.in).size!==action.in.length||!action.in.every(iid=>{
        const props=service.properties.filter(p=>p.piid===iid&&p.siid===service.siid);return props.length===1&&rules.actionInputNames.includes(props[0].name)&&(validChoices(props[0])||validRange(props[0]));
      })))continue;
      result.actions.push({ role: `${service.name}.${action.name}`, siid: action.siid, aiid: action.aiid,
        service: service.name, name: action.name, label: own(actionLabels, action.name) ?? action.description });
    }
  }
  result.readOnly=!!rule.readOnly&&!result.properties.some(p=>p.kind!=='reading');
  result.profile = result.properties.length || result.actions.length||result.events.length ? 'standard' : 'none';
  return result;
}

/** Never return the first of two possible channels. Callers that intentionally
 * show multiple independent channels use capabilityProperties instead. */
export function capabilityProperty(panel: DevicePanel | undefined, role: string): Property | undefined {
  if (!panel) return undefined;
  const properties = capabilityProperties(panel, role);
  return properties.length === 1 ? properties[0] : undefined;
}
export function capabilityProperties(panel: DevicePanel, role: string): Property[] {
  return resolveDeviceCapabilities(panel).properties.filter(binding => binding.role === role)
    .flatMap(binding => { const property = capabilityBinding(panel, binding); return property ? [property] : []; });
}
export function capabilityBinding(panel: DevicePanel, binding: CapabilityProperty): Property | undefined {
  const matches = panel.services.filter(service => service.siid === binding.siid && service.name === binding.service)
    .flatMap(service => service.properties.filter(property => property.siid === binding.siid && property.piid === binding.piid && property.name === binding.name));
  return matches.length === 1 ? matches[0] : undefined;
}
export function capabilityActionBinding(panel: DevicePanel, binding: CapabilityAction): { service: Service; action: Action } | undefined {
  const matches = panel.services.filter(service => service.siid === binding.siid && service.name === binding.service)
    .flatMap(service => service.actions.filter(action => action.siid === binding.siid && action.aiid === binding.aiid && action.name === binding.name).map(action => ({ service, action })));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Filter shared generic panels with the same semantic manifest as dedicated
 * category pages. Unknown categories retain only their existing parent fallback. */
export function isCapabilityProperty(panel: DevicePanel, service: Service, property: Property): boolean {
  return resolveDeviceCapabilities(panel).properties.some(binding => binding.service === service.name && binding.siid === property.siid && binding.piid === property.piid && binding.name === property.name);
}
