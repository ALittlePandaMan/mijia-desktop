import type { Action, DevicePanel, Property, Service } from '../types';
import { customIconUrl, propertyShapeReason, resolveComponentProperty, type ComponentNode, type PanelDocument } from '../ui-schema';
import { renderControl, type ControlEnvironment } from './controls';
import { element } from './dom';
import {sensorStatusLabel} from '../sensor-status';
import {deviceChoiceLabel,devicePropertyLabel,deviceServiceLabel} from '../device-labels';
import {sensorReadingVisible} from '../sensor-presentation';
import {capabilityCategory} from '../device-capabilities';

export interface SchemaRendererEnvironment extends ControlEnvironment {
  panel: DevicePanel;
  /** Return the existing action input/confirmation view; never fire an action here. */
  action?: (action: Action, service: Service) => HTMLElement;
  /** Existing explicit property input/confirmation view, e.g. write-only values. */
  propertyEditor?: (property: Property, service: Service, label: string) => HTMLElement;
  /** Dedicated visual integrations are registered locally, never by cloud script. */
  adapters?: Readonly<Record<string, (node: ComponentNode) => HTMLElement | undefined>>;
}

const unavailable = (label: string, reason: string): HTMLElement => {
  const view = element('section', 'native-card reading-card', element('h3', '', label));
  view.setAttribute('aria-description', reason); view.setAttribute('aria-disabled', 'true');
  return view;
};

function renderStatus(property: Property, label: string, unit: string | undefined, env: SchemaRendererEnvironment): HTMLElement {
  const serviceName=env.panel.services.find(s=>s.siid===property.siid)?.name;
  const view = renderControl({ name: 'Status', props: { property, label, unit, serviceName } }, env);
  const currentValue=view.dataset.readingSource==='reported'?property.lastReported?.value:property.value;
  if(view.dataset.readingSource!=='missing'){
    const status=sensorStatusLabel(serviceName,property,currentValue);
    const output=view.querySelector('.reading-value');
    if(status&&output){output.textContent=status;view.dataset.valueKind='text';}
  }
  if (property.valueList && view.dataset.readingSource !== 'missing') {
    const value = view.dataset.readingSource === 'reported' ? property.lastReported?.value : property.value;
    const choice = property.valueList.find(item => JSON.stringify(item.value) === JSON.stringify(value));
    const output = view.querySelector('.reading-value');
    if (choice && output) { output.textContent = deviceChoiceLabel(choice.description,undefined,['status','fault'].includes(property.name)?'state':undefined); view.dataset.valueKind = 'text'; }
  }
  return view;
}

function renderNode(node: ComponentNode, env: SchemaRendererEnvironment): HTMLElement | undefined {
  if (node.name === 'Container') {const service=env.panel.services.find(s=>node.key===`service:${s.siid}`),children=node.items.map(item=>renderNode(item,env)).filter((item):item is HTMLElement=>!!item);if(!children.length)return undefined;return element('section', node.items.length&&node.items.every(item=>item.name==='Action')?'service-section daily-actions':'service-section', node.props.label ? element('h3', '', /[\u3400-\u9fff]/.test(node.props.label)?node.props.label:service?deviceServiceLabel(service):'设备功能') : null, ...children);}
  if (node.name === 'Adapter') return env.adapters?.[node.props.adapter]?.(node);
  if (node.name === 'Action') {
    const matches = env.panel.services.filter(service => service.siid === node.props.siid).flatMap(service => service.actions.filter(action => action.siid === node.props.siid && action.aiid === node.props.aiid).map(action => ({ service, action })));
    if (matches.length !== 1) return undefined;
    const { action, service } = matches[0];
    const inputLabels = node.props.inputLabels;
    const localizedService = inputLabels ? { ...service, properties: service.properties.map(property => inputLabels[property.piid] ? { ...property, description: inputLabels[property.piid] } : property) } : service;
    return env.action?.({ ...action, description: node.props.label }, localizedService) ?? unavailable(node.props.label, '此动作需要显式输入及确认适配。');
  }
  const current = resolveComponentProperty(env.panel, node.props.binding);
  if (!current) return undefined;
  const service=env.panel.services.find(s=>s.siid===current.siid);
  if(service&&!sensorReadingVisible(capabilityCategory(env.panel.specType),service.name,current.name))return undefined;
  const choiceLabels = node.props.choiceLabels;
  const property = choiceLabels && current.valueList ? { ...current, valueList: current.valueList.map(choice => ({ ...choice, description: choiceLabels.find(item => JSON.stringify(item.value) === JSON.stringify(choice.value))?.label ?? choice.description })) } : current;
  if (node.name === 'PropertyEditor') {
    const service = env.panel.services.find(service => service.siid === property.siid);
    return service ? env.propertyEditor?.(property, service, node.props.label) ?? unavailable(node.props.label, '此属性需要显式输入及确认适配。') : undefined;
  }
  const label = devicePropertyLabel(property,node.props.label);
  // Layout resources may be cached; values/permissions always resolve anew.
  // If the model shape changed since compilation, downgrade the stale control.
  if (node.name !== 'Status' && (propertyShapeReason(property) || !property.access.includes('read') || !property.access.includes('write'))) return property.access.includes('read') ? renderStatus(property, label, node.props.unit, env) : unavailable(label, '属性定义或权限已变更，请刷新页面。');
  const view = node.name === 'Power' ? renderControl({ name: 'Power', props: { property, label, style: node.props.style } }, env)
    : node.name === 'Slider' ? renderControl({ name: 'Slider', props: { property, label, unit: node.props.unit } }, env)
    : node.name === 'Selector' ? renderControl({ name: 'Selector', props: { property, label, style: 'standard' } }, env)
    : renderStatus(property, label, node.props.unit, env);
  const imageUrl = customIconUrl(node.props.iconUrl);
  if (imageUrl && node.name === 'Power') {
    const image = element('img', 'schema-control-icon'); image.src = imageUrl; image.alt = ''; image.width = 40; image.height = 40; image.style.objectFit = 'contain'; image.style.flexShrink = '0'; image.referrerPolicy = 'no-referrer';
    const existing = view.querySelector('.p69-setting-icon, :scope > .icon');
    image.addEventListener('error', () => existing ? image.replaceWith(existing) : image.remove(), { once: true });
    if (existing) existing.replaceWith(image); else view.prepend(image);
  }
  view.dataset.schemaKey = node.key;
  return view;
}

export function renderPanelDocument(document: PanelDocument, env: SchemaRendererEnvironment): HTMLElement {
  const view = element('div', 'schema-panel');
  view.dataset.schemaSource = document.source;
  if (document.did !== env.device.did || document.model !== env.device.model || env.panel.did !== document.did || env.panel.model !== document.model || env.panel.unsupportedReason) {
    view.setAttribute('aria-description', '页面模型与当前设备不匹配，已停止渲染。'); return view;
  }
  for (const node of document.items) { const item = renderNode(node, env); if (item) view.append(item); }
  return view;
}
