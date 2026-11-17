import { icon, type IconName } from '../icons';
import {quietFeedback} from './quiet-feedback';

export type Child = Node | string | null | undefined | false;

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  quietFeedback(node);
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

export function button(label: string, className: string, onClick: () => void, iconName?: IconName): HTMLButtonElement {
  const node = element('button', className, iconName ? icon(iconName) : null, label ? element('span', '', label) : null);
  node.type = 'button';
  node.addEventListener('click', onClick);
  if (!label && iconName) node.setAttribute('aria-label', ({ close: '关闭', refresh: '刷新', logout: '退出登录' } as Partial<Record<IconName, string>>)[iconName] ?? iconName);
  return node;
}
