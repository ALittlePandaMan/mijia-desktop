import { button, element } from './dom';

export function roundPowerButton(options: {
  label: string;
  graphic: Node;
  on?: boolean;
  pressed?: boolean | 'mixed';
  press?: () => void;
  className?: string;
  wholeCard?: boolean;
}): HTMLButtonElement {
  const discClasses = ['native-power', options.on && 'is-on', options.className].filter(Boolean).join(' ');
  const control = button('', options.wholeCard ? 'native-card detail-power-card' : discClasses, () => {
    if (!control.disabled) options.press?.();
  });
  if (options.wholeCard) {
    const disc = element('span', discClasses, options.graphic);
    disc.setAttribute('aria-hidden', 'true');
    control.append(disc, element('span', 'detail-power-label', options.label));
  } else control.append(options.graphic);
  control.disabled = !options.press;
  control.setAttribute('aria-label', options.label);
  if (options.pressed !== undefined) control.setAttribute('aria-pressed', String(options.pressed));
  return control;
}

export function powerCard(label: string, control: HTMLButtonElement): HTMLElement {
  const caption = element('span', 'detail-power-label', label);
  return element('div', 'native-card detail-power-card', control, caption);
}
