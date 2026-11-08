import { inputUnsupportedReason } from './logic';
import { miotCategory } from './panel-layout';
import {desktopHiddenPropertyKeys} from './daily-scope';
import type { Device, DevicePanel, Json, Property } from './types';
import {deviceChoiceLabel,devicePropertyLabel,deviceServiceLabel,deviceUnit} from './device-labels';

/** Read-only resource envelope. It contains data, never executable plugin code. */
export interface DeviceUiResources {
  did: string;
  model: string;
  specType: string | null;
  instance: Json | null;
  i18n: Json | null;
  customConfig: Json | null;
  route: { kind: 'standard' | 'dedicated' | 'unknown'; pluginId?: number; standardVersion?: number; reason?: string };
  fetchedAt: number;
  cacheState: 'fresh' | 'stale' | 'missing';
  diagnostics: string[];
}

export interface PropertyBinding { siid: number; piid: number }
interface ComponentBase { key: string; origin: 'official-custom-config' | 'miot-model' }
interface BoundProps { binding: PropertyBinding; label: string; unit?: string; iconUrl?: string; choiceLabels?: { value: Json; label: string }[] }
export type ComponentNode = ComponentBase & (
  | { name: 'Power'; props: BoundProps & { style: 'wide' | 'setting' } }
  | { name: 'Slider'; props: BoundProps }
  | { name: 'Selector'; props: BoundProps }
  | { name: 'Status'; props: BoundProps }
  | { name: 'PropertyEditor'; props: BoundProps }
  | { name: 'Action'; props: { siid: number; aiid: number; label: string; inputLabels?: Record<number, string> } }
  | { name: 'Adapter'; props: { adapter: string; data?: Json } }
  | { name: 'Container'; props: { label?: string }; items: ComponentNode[] }
);

export interface PanelDocument {
  did: string;
  model: string;
  category?: string;
  surface: 'home' | 'settings';
  source: 'official-standard' | 'miot-template';
  items: ComponentNode[];
  consumedPropertyKeys: string[];
  diagnostics: string[];
}

export interface CompilePanelOptions {
  device: Device;
  panel: DevicePanel;
  resources?: DeviceUiResources;
  surface?: 'home' | 'settings';
  /** False appends only official custom items to an existing visual adapter. */
  includeModelFallback?: boolean;
  language?: string;
}

type JsonObject = { [key: string]: Json };
const object = (value: Json | undefined): JsonObject | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
const text = (value: Json | undefined): string | undefined => typeof value === 'string' && value.trim() ? value.slice(0, 512) : undefined;
const iid = (value: Json | undefined): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const numeric = (format: string): boolean => /^(u?int(8|16|32|64)|float|double)$/.test(format);
const integerBounds: Record<string, [number, number]> = { uint8: [0, 255], uint16: [0, 65535], uint32: [0, 4294967295], uint64: [0, Number.MAX_SAFE_INTEGER], int8: [-128, 127], int16: [-32768, 32767], int32: [-2147483648, 2147483647], int64: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER] };
function validNumericValue(value: number, format: string): boolean {
  if (!Number.isFinite(value)) return false;
  const bounds = integerBounds[format];
  return !bounds || (Number.isSafeInteger(value) && value >= bounds[0] && value <= bounds[1]);
}
const propertyKey = (property: PropertyBinding): string => `${property.siid}.${property.piid}`;
const highRiskCategory = (category: string | undefined): boolean => /(^|[-])(lock|door|garage|gas|alarm)([-]|$)/.test(category ?? '');

export function schemaUnit(unit: string | null | undefined): string {
  return deviceUnit(unit);
}

/** Observed 14747 uses zero-padded iid keys and value-list INDEX keys. */
export function specTranslation(i18n: Json | null | undefined, key: string, language = 'zh_cn'): string | undefined {
  const raw = object(i18n ?? undefined);
  const dictionaries = object(raw?.data) ?? raw;
  if (!dictionaries) return undefined;
  const selected = language === 'zh' ? 'zh_cn' : language;
  for (const locale of [...new Set([selected, 'en', 'zh_cn'])]) {
    const value = text(object(dictionaries[locale])?.[key]);
    if (value) return value;
  }
  return undefined;
}

const specId = (value: number): string => String(value).padStart(3, '0');
const propertyI18nKey = (property: PropertyBinding): string => `service:${specId(property.siid)}:property:${specId(property.piid)}`;
function translatedChoices(property: Property, i18n: Json | null | undefined, language: string): { value: Json; label: string }[] | undefined {
  if (!property.valueList) return undefined;
  return property.valueList.map((choice, index) => ({ value: choice.value, label: deviceChoiceLabel(specTranslation(i18n, `${propertyI18nKey(property)}:valuelist:${specId(index)}`, language) ?? choice.description,`选项${index+1}`,['status','fault'].includes(property.name)?'state':undefined) }));
}

/** Only Xiaomi product image hosts; configuration cannot load local/active URLs. */
export function customIconUrl(value: Json | undefined): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return undefined;
    if (!['api.mi-img.com', 'api.xiaomi.net', 'mi-img.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return undefined;
    return url.href;
  } catch { return undefined; }
}

/** Model shape only. A transient failed reading must not change page structure. */
export function propertyShapeReason(property: Property): string | undefined {
  const reason = inputUnsupportedReason(property);
  if (reason) return reason;
  if (property.valueRange) {
    if (!numeric(property.format) || property.valueList || property.valueRange[0] >= property.valueRange[1]) return '属性的连续范围与数据类型不一致。';
    if (!property.valueRange.every(value => validNumericValue(value, property.format))) return '属性范围超出实际数据类型。';
  }
  if (property.valueList) {
    const values = property.valueList.map(item => item.value);
    if (values.length < 2 || values.length > 256 || new Set(values.map(value => JSON.stringify(value))).size !== values.length) return '属性枚举缺失、重复或过多。';
    if (values.some(value => property.format === 'bool' ? typeof value !== 'boolean' : property.format === 'string' ? typeof value !== 'string' : !numeric(property.format) || typeof value !== 'number' || !validNumericValue(value, property.format))) return '属性枚举与数据类型不一致。';
  }
  if (property.format === 'bool' && (property.valueRange || property.valueList)) return '布尔属性携带了不兼容的范围或枚举。';
  return undefined;
}

export function resolveComponentProperty(panel: DevicePanel, binding: PropertyBinding): Property | undefined {
  // Ambiguous IDs are rejected rather than choosing a coincidentally first item.
  const matches = panel.services.filter(service => service.siid === binding.siid).flatMap(service => service.properties.filter(property => property.piid === binding.piid && property.siid === service.siid));
  return matches.length === 1 ? matches[0] : undefined;
}

function propertyNode(property: Property, label: string, origin: ComponentBase['origin'], surface: PanelDocument['surface'], category: string | undefined, diagnostics: string[], iconUrl?: string, choiceLabels?: { value: Json; label: string }[]): ComponentNode | undefined {
  label=devicePropertyLabel(property,label);
  const key = `${origin}:${propertyKey(property)}`;
  const props: BoundProps = { binding: { siid: property.siid, piid: property.piid }, label, unit: schemaUnit(property.unit), ...(iconUrl ? { iconUrl } : {}), ...(choiceLabels ? { choiceLabels } : {}) };
  const readable = property.access.includes('read');
  const writable = property.access.includes('write');
  if (!readable && !writable) { diagnostics.push(`${propertyKey(property)} 没有可用的读写权限。`); return undefined; }
  const shapeReason = propertyShapeReason(property);
  if (shapeReason || highRiskCategory(category)) {
    diagnostics.push(`${propertyKey(property)} ${shapeReason ?? '高风险品类需要专用确认适配，通用面板只展示状态。'}`);
    return readable ? { key, origin, name: 'Status', props } : undefined;
  }
  if (!writable) return { key, origin, name: 'Status', props };
  if (!readable) {
    diagnostics.push(`${propertyKey(property)} 仅可写入，需要显式输入和确认适配。`);
    return { key, origin, name: 'PropertyEditor', props };
  }
  if (property.format === 'bool') return { key, origin, name: 'Power', props: { ...props, style: surface === 'settings' ? 'setting' : 'wide' } };
  if (property.valueRange) return { key, origin, name: 'Slider', props };
  if (property.valueList) return { key, origin, name: 'Selector', props };
  return { key, origin, name: 'PropertyEditor', props };
}

/**
 * Independent translation of observed schema, not a vendor JS interpreter.
 * Evidence: standard 14888.getCustomList; 17156.getFromCloud/getSpecItem;
 * 17186.customFunctions. Full plugin Utils.std feature trees are a different path.
 */
export function compilePanelDocument(options: CompilePanelOptions): PanelDocument {
  const { device, panel, resources, includeModelFallback = false } = options;
  const surface = options.surface ?? 'home';
  const language = options.language ?? 'zh_cn';
  const diagnostics: string[] = [];
  const document: PanelDocument = { did: device.did, model: device.model, category: miotCategory(panel.specType ?? device.specType), surface, source: 'miot-template', items: [], consumedPropertyKeys: [], diagnostics };
  if (panel.did !== device.did || panel.model !== device.model || panel.unsupportedReason) {
    diagnostics.push(panel.unsupportedReason ?? '设备与面板的身份不匹配。'); return document;
  }
  const consumed = new Set<string>();
  const hidden=desktopHiddenPropertyKeys(panel);
  // Logical switch cards expose load control only. Keep mode in the model for
  // reads/shortcut guards, but omit mode selectors from both custom and fallback UI.
  const hiddenSplitMode = (property:Property):boolean => device.controlServiceId != null
    && property.name === 'mode' && panel.services.some(service=>service.siid===property.siid&&service.name==='switch');
  let config: JsonObject | undefined;
  let i18n: Json | null | undefined;
  if (resources) {
    if (resources.did !== device.did || resources.model !== device.model || (resources.specType && panel.specType && resources.specType !== panel.specType)) diagnostics.push('页面资源与当前设备或模型不匹配，已忽略配置。');
    else {
      i18n = resources.i18n;
      if (resources.route.kind !== 'standard') diagnostics.push(resources.route.reason ?? '此设备尚未确认使用标准插件，未应用标准插件自定义配置。');
      else {
        const candidate = object(resources.customConfig);
        if (candidate && candidate.model !== device.model) diagnostics.push('custom_config.model 与当前设备不匹配，已忽略配置。');
        else if (candidate) config = candidate;
      }
      if (resources.cacheState === 'stale') diagnostics.push('页面布局来自缓存，后台正在刷新；设备状态仍以独立回读为准。');
      diagnostics.push(...resources.diagnostics);
    }
  }
  if (config) {
    const note = surface === 'home' ? 'home-setting' : 'setting-setting';
    const groups = Array.isArray(config.standard_infos) ? config.standard_infos.slice(0, 256) : [];
    if (config.standard_infos != null && !Array.isArray(config.standard_infos)) diagnostics.push('standard_infos 不是有效的功能分组数组。');
    const group = groups.map(object).find(item => item?.note === note);
    const entries = group && Array.isArray(group.customizeFuncList) ? group.customizeFuncList : [];
    if (entries.length > 256) diagnostics.push(`${note} 自定义功能过多，仅解析前 256 项。`);
    for (const [index, raw] of entries.slice(0, 256).entries()) {
      const item = object(raw); const info = object(item?.customizeInfo);
      if (!item || !info) { diagnostics.push(`${note}[${index}] 不是有效的自定义功能。`); continue; }
      if (item.format === 'pageEntry') { diagnostics.push(`${text(info.title) ?? text(item.note) ?? note} 需要厂商插件页面，桌面版尚未提供该适配。`); continue; }
      if (item.format !== 'specItem') { diagnostics.push(`${note}[${index}] 的格式尚未适配。`); continue; }
      if (info.miid != null && info.miid !== 0) { diagnostics.push(`${note}[${index}] 引用了 MIoT 模块 miid，当前通用属性链不支持该模块绑定。`); continue; }
      if (!iid(info.siid) || !iid(info.piid)) { diagnostics.push(`${note}[${index}] 缺少有效的属性 iid。`); continue; }
      const binding = { siid: info.siid, piid: info.piid };
      const property = resolveComponentProperty(panel, binding);
      if (!property) { diagnostics.push(`${propertyKey(binding)} 没有唯一匹配的真实模型属性。`); continue; }
      if (hiddenSplitMode(property)||hidden.has(propertyKey(property))) continue;
      // The official specItem path only supports bool, range and enums.
      if (property.format !== 'bool' && !property.valueRange && !property.valueList) { diagnostics.push(`${propertyKey(binding)} 不属于已核实的 specItem 控件类型。`); continue; }
      if (consumed.has(propertyKey(property))) { diagnostics.push(`${propertyKey(property)} 在自定义配置中重复，已保留第一项。`); continue; }
      const node = propertyNode(property, text(info.title) ?? specTranslation(i18n, propertyI18nKey(property), language) ?? (property.description || property.name), 'official-custom-config', surface, document.category, diagnostics, customIconUrl(info.icon), translatedChoices(property, i18n, language));
      if (node) { document.items.push(node); consumed.add(propertyKey(property)); document.source = 'official-standard'; }
    }
  }
  if (includeModelFallback) {
    for (const service of panel.services) {
      // Standard device-info is metadata, not a primary control section.
      if (service.name === 'device-information') continue;
      const items: ComponentNode[] = [];
      for (const property of service.properties) {
        if (hiddenSplitMode(property)||hidden.has(propertyKey(property))) continue;
        if (!iid(property.siid) || !iid(property.piid) || property.siid !== service.siid || consumed.has(propertyKey(property))) continue;
        if (resolveComponentProperty(panel, property) !== property) { diagnostics.push(`${propertyKey(property)} 的模型绑定不唯一。`); continue; }
        const node = propertyNode(property, specTranslation(i18n, propertyI18nKey(property), language) ?? (property.description || property.name), 'miot-model', surface, document.category, diagnostics, undefined, translatedChoices(property, i18n, language));
        if (node) { items.push(node); consumed.add(propertyKey(property)); }
      }
      for (const action of service.actions) {
        if (!iid(action.siid) || !iid(action.aiid) || action.siid !== service.siid) continue;
        const inputLabels: Record<number, string> = {};
        for (const piid of action.in) { const label = specTranslation(i18n, propertyI18nKey({ siid: service.siid, piid }), language); if (label) inputLabels[piid] = label; }
        items.push({ name: 'Action', origin: 'miot-model', key: `action:${action.siid}.${action.aiid}`, props: { siid: action.siid, aiid: action.aiid, label: specTranslation(i18n, `service:${specId(action.siid)}:action:${specId(action.aiid)}`, language) ?? (action.description || action.name), ...(Object.keys(inputLabels).length ? { inputLabels } : {}) } });
      }
      if (items.length) document.items.push({ name: 'Container', origin: 'miot-model', key: `service:${service.siid}`, props: { label: specTranslation(i18n, `service:${specId(service.siid)}`, language) ?? deviceServiceLabel(service) }, items });
    }
  }
  document.consumedPropertyKeys = [...consumed];
  return document;
}
