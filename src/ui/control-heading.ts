import { element } from './dom';

interface HeadingOptions {
  tag?: 'div' | 'h3';
  className?: string;
  titleClass?: string;
  valueClass?: string;
  separator?: boolean;
}

export function controlHeading(title: string, options: HeadingOptions = {}) {
  const name = element('strong', options.titleClass, title);
  const root = element(options.tag ?? 'div', options.className ? 'control-heading ' + options.className : 'control-heading', name);
  const divider = options.separator === false ? undefined : element('span', '', '|');
  divider?.setAttribute('aria-hidden', 'true');
  const value = element('span', options.valueClass);

  function setValue(content?: string | HTMLElement): void {
    if (content === undefined || content === '') {
      divider?.remove();
      value.remove();
      return;
    }
    if (typeof content === 'string') value.textContent = content;
    else if (value.firstChild !== content) value.replaceChildren(content);
    if (!value.parentElement) name.after(...(divider ? [divider, value] : [value]));
  }

  return { root, setValue };
}
