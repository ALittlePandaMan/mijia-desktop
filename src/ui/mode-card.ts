import { button, element } from './dom';
import { controlHeading } from './control-heading';

export interface ModeOption {
  label: string;
  graphic: Node;
  press?: () => void;
  selected?: boolean;
  ariaLabel?: string;
  focusKey?: string;
  decorate?: (button: HTMLButtonElement) => void;
}

export function modeOptionButton(option: ModeOption): HTMLButtonElement {
  const choice = button('', `air-choice${option.selected ? ' selected' : ''}`, () => {
    if (!choice.disabled) option.press?.();
  });
  choice.disabled = !option.press;
  choice.setAttribute('aria-label', option.ariaLabel ?? option.label);
  if (option.selected !== undefined) choice.setAttribute('aria-pressed', String(option.selected));
  if (option.focusKey) choice.dataset.focusKey = option.focusKey;
  choice.append(element('span', 'air-choice-symbol', option.graphic), element('span', 'air-choice-label', option.label));
  option.decorate?.(choice);
  return choice;
}

export function modeCard(title: string, options: readonly ModeOption[], current?: string): HTMLElement {
  const heading = controlHeading(title, { tag: 'h3', titleClass: 'air-choices-title' });
  heading.setValue(current);
  const card = element('section', 'native-card air-choices-card', heading.root);
  if (!options.length) return card;
  const grid = element('div', 'air-choices');
  grid.style.setProperty('--choices', String(Math.min(4, options.length)));
  for (const option of options) grid.append(modeOptionButton(option));
  card.append(grid);
  return card;
}
