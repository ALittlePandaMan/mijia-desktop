import './category-page.css';
import {desktopActionShortcut,desktopHiddenProperty,desktopScheduleField,desktopHiddenPropertyKeys} from '../daily-scope';
import {switchPolicy} from '../switch-mode';
import { capabilityActionBinding, capabilityBinding, resolveDeviceCapabilities, motionFeedback, type CapabilityProperty } from '../device-capabilities';
import type { IconName } from '../icons';
import { propertyReading,isReadableValue } from '../panel-layout';
import {deviceServiceLabel,deviceUnit} from '../device-labels';
import {sensorReadingVisible} from '../sensor-presentation';
import type { Action, Device, DevicePanel, Json, Property } from '../types';
import { renderControl, type ControlEnvironment } from './controls';
import { button, element } from './dom';
import {deviceReadingDisplay} from '../device-readings';

export interface CategoryPageProps {
  device: Device; panel: DevicePanel; busy: boolean; cached?: boolean;
  artwork?: () => HTMLElement;
  write: (property: Property, value: Json) => void;
  error: (error: unknown) => void;
  action?: (action: Action) => void;
  interactionEnded?: () => void;
  omit?:ReadonlySet<string>;
}
function glyph(name: string): IconName {
  if (name === 'mute') return 'volume-off';
  if (name === 'volume') return 'volume';
  if (name === 'horizontal-swing') return 'swing-horizontal';
  if (name === 'vertical-swing') return 'swing-vertical';
  if (name.includes('temperature') || name.includes('heating')) return 'sun';
  if (name.includes('humidity') || name.includes('water')) return 'droplet';
  if (name.includes('light') || name === 'brightness') return 'light';
  if (name.includes('lock')) return 'shield';
  if (name.includes('delay') || name.includes('time')) return 'clock';
  if (name.includes('swing') || name.includes('fan') || name.includes('blow')) return 'wind';
  return 'power';
}
function labelFor(panel: DevicePanel, binding: CapabilityProperty, bindings: CapabilityProperty[]): string {
  if(binding.role==='indicator-light.on'&&bindings.filter(item=>item.role===binding.role).length===1)return '指示灯';
  if (bindings.filter(item => item.label === binding.label).length <= 1) return binding.label;
  const service = panel.services.find(service => service.siid === binding.siid && service.name === binding.service);
  // Service description is published metadata, not an assumed channel order.
  const siblings=panel.services.filter(s=>s.name===binding.service),prefix=service?deviceServiceLabel(service):'设备功能';
  return `${prefix}${siblings.length>1&&!/\d$/.test(prefix)?siblings.findIndex(s=>s.siid===binding.siid)+1:''} · ${binding.label}`;
}

type ControlSection = 'power' | 'motion' | 'adjustment' | 'readings' | 'actions';
function sectionFor(binding: CapabilityProperty): ControlSection {
  if (binding.kind === 'reading') return 'readings';
  if (binding.kind === 'power' || binding.kind === 'toggle') return 'power';
  if (binding.kind === 'command' || binding.name === 'motor-control' || binding.name === 'target-position') return 'motion';
  return 'adjustment';
}

/** Shared daily page for published standard capabilities. Exact vendor pages
 * remain the caller's first choice; private commands never enter this renderer. */
export function renderCategoryPage(p: CategoryPageProps): HTMLElement {
  const capabilities = resolveDeviceCapabilities(p.panel);
  const view = element('div', 'category-page-content device-controls-region');
  view.dataset.category = capabilities.category ?? 'unknown';
  view.dataset.family=capabilities.family;
  view.dataset.readOnly=String(capabilities.readOnly);
  view.dataset.referenceKind = 'standard-capability';
  view.dataset.capabilityVersion = String(capabilities.version);
  const env: ControlEnvironment = { device: p.device, busy: p.busy || !!p.cached,
    write: p.write, error: p.error, interactionEnded: p.interactionEnded };
  if (p.artwork) {
    const hero = element('div', 'category-product', p.artwork());
    hero.append(element('h1', '', p.device.name)); view.append(hero);
  }
  const controls = element('div', 'category-controls device-card-stack');
  const sections = new Map<ControlSection,HTMLElement>();
  const append = (part: ControlSection, node: HTMLElement) => {
    let section = sections.get(part);
    if (!section) {
      section=element('div', 'device-card-stack category-section');
      section.dataset.controlSection=part;
      sections.set(part, section);
    }
    section.append(node);
  };
  const bindings = capabilities.properties;
  const hidden=desktopHiddenPropertyKeys(p.panel);
  for (const binding of bindings) {
    if(hidden.has(`${binding.siid}.${binding.piid}`))continue;
    if(p.omit?.has(`${binding.siid}.${binding.piid}`))continue;
    if(desktopHiddenProperty(capabilities.category,binding.name))continue;
    if(desktopScheduleField(binding.service,binding.name)||!sensorReadingVisible(capabilities.category,binding.service,binding.name))continue;
    if(capabilities.category==='temperature-humidity-sensor'&&binding.service==='battery')continue;
    const property = capabilityBinding(p.panel, binding);
    if (!property) continue;
    const label = labelFor(p.panel, binding, bindings), unit = deviceUnit(binding.unit);
    const policy=switchPolicy(p.panel,property);
    const disabledReason = p.device.sharedReadOnly ? '此共享设备仅有读取权限。' : policy.reason;
    let node: HTMLElement;
    switch (binding.kind) {
      case 'command': {
        node=element('section','native-card category-command device-control-unit');node.dataset.siid=String(property.siid);node.dataset.piid=String(property.piid);node.dataset.control='Motion';
        const feedback=motionFeedback(p.panel,property.siid);
        for(const option of property.valueList??[]){const key=option.description.trim().toLowerCase(),labels:Record<string,string>={up:'上升',raise:'上升',down:'下降',lower:'下降',open:'打开',close:'关闭',pause:'暂停',stop:'暂停'},b=button(labels[key]??'控制','category-action',()=>p.write(property,option.value),/pause|stop/.test(key)?'pause':'arrow');b.disabled=!p.device.online||!!p.device.sharedReadOnly||env.busy||!isReadableValue(feedback);b.setAttribute('aria-pressed',String(!!property.pending&&property.value===option.value));node.append(b);}
        break;
      }
      case 'power': {
        const indicator=binding.role==='indicator-light.on';
        node = renderControl({ name: 'Power', props: { property, label, disabledReason,
          glyph:glyph(indicator||binding.service==='light'?'light':binding.name),openLabel:indicator?label:label===binding.label?'开启':`${label} · 开启`,
          closeLabel:indicator?label:label===binding.label?'关闭':`${label} · 关闭` } }, env);
        break;
      }
      case 'toggle':
        node = renderControl({ name: 'Power', props: { property, label, disabledReason, glyph: glyph(binding.name) } }, env);
        break;
      case 'range':
        node = renderControl({ name: 'Slider', props: { property, label, unit, disabledReason,
          theme: binding.name === 'brightness' ? 'brightness' : ['fan-level','speed-level','stepless-fan-level'].includes(binding.name) ? 'fan' : undefined,
          style: binding.name === 'target-temperature' && binding.unit === 'celsius' ? 'temperature' : undefined } }, env);
        break;
      case 'enum':
        node = renderControl({ name: 'Selector', props: { property, label, disabledReason, showValue: true,
          choiceIcon: description => {
            const name = description.toLowerCase();
            return /auto|smart/.test(name) ? 'leaf' : /sleep|silent/.test(name) ? 'moon' : /heat/.test(name) ? 'sun' : /cool/.test(name) ? 'snowflake' : /dry/.test(name) ? 'droplet' : 'menu';
          } } }, env);
        break;
      case 'reading':
        node = renderControl({ name: 'Status', props: { property, label, unit, serviceName:binding.service,displayValue:deviceReadingDisplay(p.panel,property) } }, env);
        break;
    }
    node.dataset.capabilityRole = binding.role;
    if(binding.kind==='power'&&policy.label)node.append(element('span','switch-mode-label',policy.label));
    node.classList.add('device-control-unit'); append(sectionFor(binding),node);
  }
  if (p.action && capabilities.actions.length) {
    const actions = element('div', 'category-actions daily-actions device-control-unit');
    for (const binding of capabilities.actions) {
      if (desktopScheduleField(binding.service,binding.name)) continue;
      const bound = capabilityActionBinding(p.panel, binding);
      if (!bound || !desktopActionShortcut(bound.service,bound.action)) continue;
      const control = button(binding.label, 'button device-action category-action', () => {
        if (!control.disabled) p.action?.(bound.action);
      }, capabilities.category==='speaker'&&['play','pause','previous','next'].includes(binding.name)?`speaker:${binding.name}` as IconName:binding.name==='play'?'play':binding.name==='previous'?'previous':binding.name==='next'?'next':/pause|stop/.test(binding.name) ? 'pause' : /close|off/.test(binding.name) ? 'power' : 'arrow');
      control.disabled = !p.device.online || !!p.device.sharedReadOnly || p.busy || !!p.cached;
      control.dataset.control = 'Action'; control.dataset.siid = String(binding.siid); control.dataset.aiid = String(binding.aiid);
      control.dataset.capabilityRole = binding.role;
      actions.append(control);
    }
    if (actions.childElementCount) append('actions',actions);
  }
  const readingsFirst = capabilities.readOnly || ['sensor','security','health'].includes(capabilities.family);
  const order: ControlSection[] = readingsFirst
    ? ['readings','power','motion','adjustment','actions']
    : ['power','motion','adjustment','readings','actions'];
  for (const part of order) { const section = sections.get(part); if (section) controls.append(section); }
  view.append(controls);
  const privateFeatures=capabilities.privateFeatures.filter(feature=>!desktopScheduleField('',feature.feature));
  if (privateFeatures.length&&!p.omit) {
    const notes = element('div', 'category-private-notes');
    for (const feature of privateFeatures) notes.append(element('p', '', feature.reason));
    view.append(notes);
  }
  const latest = bindings.flatMap(binding => {
    const property = capabilityBinding(p.panel, binding); return property && propertyReading(property).source !== 'missing' ? [binding] : [];
  });
  view.dataset.readableCapabilities = String(bindings.length); view.dataset.populatedCapabilities = String(latest.length);
  return view;
}
