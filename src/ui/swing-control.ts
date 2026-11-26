import { validChoices, validRange } from '../device-capabilities';
import { deviceChoiceLabel, deviceUnit } from '../device-labels';
import { coercePropertyInput, initialInput } from '../logic';
import { booleanValue, controlReason } from '../panel-layout';
import type { Property } from '../types';
import { renderControl, type ControlEnvironment, type ControlNode } from './controls';
import { element } from './dom';
import { dropdownSelect } from './dropdown';

interface SwingOptions {
  power?: Property;
  angle?: Property;
  title: string;
  direction: 'horizontal' | 'vertical';
  locked?: boolean;
}

export function swingControlCard(
  { power, angle, title, direction, locked }: SwingOptions,
  env: ControlEnvironment,
  render: (node: ControlNode) => HTMLElement = node => renderControl(node, env),
): HTMLElement {
  const swinging = booleanValue(power);
  const card = element('section', 'native-card p69-swing-card', render({ name: 'Power', props: {
    property: power, label: title, glyph: direction === 'horizontal' ? 'swing-horizontal' : 'swing-vertical', locked,
  } }));
  if (!angle) return card;
  const angleLocked = !!locked || swinging !== true;
  if (validRange(angle)) {
    card.append(render({ name: 'Slider', props: {
      property: angle, label: '摆风角度', unit: deviceUnit(angle.unit) || '°', theme: 'fan', locked: angleLocked || env.busy,
    } }));
  } else if (validChoices(angle) && swinging !== false) {
    const titleText = `${title}夹角`;
    const label = element('label', 'p69-angle-label', titleText);
    const select = dropdownSelect({
      label: titleText, className: 'p69-angle-select', value: initialInput(angle), placeholder: '',
      options: angle.valueList!.map((option, index) => ({
        value: String(index),
        label: typeof option.value === 'number' && angle.unit === 'arcdegrees'
          ? `${option.value}°` : deviceChoiceLabel(option.description, `选项${index + 1}`),
      })),
    });
    select.id = `p69-angle-${angle.siid}-${angle.piid}`;
    label.htmlFor = select.id;
    select.disabled = angleLocked || !!env.device.sharedReadOnly || !select.value || !!controlReason(angle, env.device.online, env.busy);
    select.addEventListener('change', () => {
      if (select.disabled || !select.isConnected) return;
      try { env.write(angle, coercePropertyInput(angle, select.value)); }
      catch (error) { env.error(error); }
    });
    card.append(element('div', `p69-angle-row${angleLocked ? ' control-off' : ''}`, label, select));
  }
  return card;
}
