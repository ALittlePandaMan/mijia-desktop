import './category-page.css';
import {desktopHiddenProperty,desktopScheduleField,desktopHiddenPropertyKeys} from '../daily-scope';
import {switchPolicy} from '../switch-mode';
import { capabilityActionBinding, capabilityBinding, capabilityCategoryTitle, resolveDeviceCapabilities, motionFeedback, type CapabilityProperty } from '../device-capabilities';
import type { IconName } from '../icons';
import { propertyReading,isReadableValue } from '../panel-layout';
import {deviceServiceLabel,deviceUnit} from '../device-labels';
import {sensorReadingVisible} from '../sensor-presentation';
import type { Action, Device, DevicePanel, Json, Property, Service } from '../types';
import { renderControl, type ControlEnvironment } from './controls';
import { button, element } from './dom';
import {coercePropertyInput} from '../logic';
import {deviceChoiceLabel,devicePropertyLabel} from '../device-labels';
import {deviceReadingDisplay} from '../device-readings';
import {applianceActionReason} from '../appliance-guards';

export interface CategoryPageProps {
  device: Device; panel: DevicePanel; busy: boolean; cached?: boolean;
  artwork?: () => HTMLElement;
  write: (property: Property, value: Json) => void;
  error: (error: unknown) => void;
  action?: (action: Action, service: Service, inputs?:Json[]) => void;
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
  if (bindings.filter(item => item.label === binding.label).length <= 1) return binding.label;
  const service = panel.services.find(service => service.siid === binding.siid && service.name === binding.service);
  // Service description is published metadata, not an assumed channel order.
  const siblings=panel.services.filter(s=>s.name===binding.service),prefix=service?deviceServiceLabel(service):'设备功能';
  return `${prefix}${siblings.length>1&&!/\d$/.test(prefix)?siblings.findIndex(s=>s.siid===binding.siid)+1:''} · ${binding.label}`;
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
      case 'power':
        node = renderControl({ name: 'Power', props: { style: 'wide', property, label, disabledReason, glyph: glyph(binding.service === 'light' ? 'light' : binding.name),
          openLabel: label === binding.label ? '开启' : `${label} · 开启`, closeLabel: label === binding.label ? '关闭' : `${label} · 关闭` } }, env);
        break;
      case 'toggle':
        node = renderControl({ name: 'Power', props: { style: 'setting', property, label, disabledReason, glyph: glyph(binding.name) } }, env);
        break;
      case 'range':
        node = renderControl({ name: 'Slider', props: { property, label, unit, disabledReason, theme: binding.name === 'brightness' ? 'brightness' : undefined } }, env);
        break;
      case 'enum':
        node = renderControl({ name: 'Selector', props: { property, label, disabledReason, style: 'standard', showValue: true,
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
    node.classList.add('device-control-unit'); controls.append(node);
  }
  if (p.action && capabilities.actions.length) {
    const actions = element('div', 'category-actions daily-actions device-control-unit');
    for (const binding of capabilities.actions) {
      if (desktopScheduleField(binding.service,binding.name)) continue;
      const bound = capabilityActionBinding(p.panel, binding);
      if (!bound) continue;
      const inputs: {property:Property;input:HTMLInputElement|HTMLSelectElement}[]=[];
      const form=element('div','native-card category-parameter-action device-control-unit');
      for(const piid of bound.action.in){
        const property=bound.service.properties.find(p=>p.piid===piid)!;
        let input:HTMLInputElement|HTMLSelectElement;
        if(property.valueList){const select=element('select','input');select.append(new Option('请选择',''));property.valueList.forEach((v,i)=>select.append(new Option(deviceChoiceLabel(v.description,`选项${i+1}`),String(i))));input=select}
        else{const field=element('input','input');field.type='number';const r=property.valueRange!;field.min=String(r[0]);field.max=String(r[1]);field.step=String(r[2]);field.value='';input=field}
        input.disabled=!p.device.online||!!p.device.sharedReadOnly||p.busy||!!p.cached;input.setAttribute('aria-label',devicePropertyLabel(property));
        form.append(element('label','category-parameter-label',element('span','',devicePropertyLabel(property)),input));inputs.push({property,input});
      }
      const control = button(binding.label, inputs.length?'button button-primary category-action':'native-card device-action category-action', () => {
        if (!control.disabled)try{const values=inputs.map(({property,input})=>{
          if(!input.value.trim())throw Error('请先填写动作参数。');
          return property.valueList?property.valueList[Number(input.value)].value:coercePropertyInput(property,input.value);
        });p.action?.(bound.action,bound.service,values)}catch(error){p.error(error)}
      }, capabilities.category==='speaker'&&['play','pause','previous','next'].includes(binding.name)?`speaker:${binding.name}` as IconName:binding.name==='play'?'play':binding.name==='previous'?'previous':binding.name==='next'?'next':/pause|stop/.test(binding.name) ? 'pause' : /close|off/.test(binding.name) ? 'power' : 'arrow');
      const actionReason=applianceActionReason(p.panel,bound.action);
      control.disabled = !p.device.online || !!p.device.sharedReadOnly || p.busy || !!p.cached || !!actionReason;
      if(actionReason)control.setAttribute('aria-description',actionReason);
      control.dataset.control = 'Action'; control.dataset.siid = String(binding.siid); control.dataset.aiid = String(binding.aiid);
      control.dataset.capabilityRole = binding.role;
      if (control.disabled) control.setAttribute('aria-description', !p.device.online ? '设备离线，恢复在线后可操作。' : p.device.sharedReadOnly ? '此共享设备仅有读取权限。' : p.cached ? '正在更新设备状态。' : '正在等待设备状态确认。');
      if(inputs.length){form.append(control);controls.append(form)}else actions.append(control);
    }
    if (actions.childElementCount) controls.append(actions);
  }
  if (!controls.childElementCount&&!p.omit) controls.append(element('div', 'native-card category-empty device-control-unit',
    element('h3', '', `暂无可用${capabilityCategoryTitle(capabilities.category)}功能`),
    element('p', '', p.panel.unsupportedReason ?? '此设备描述未提供可安全读取或操作的日常能力。')));
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
