import type { Product } from '../developer-mode';
import { icon } from '../icons';
import { deviceArtwork } from './device-artwork';
import { deviceSurfaces } from './device-surfaces';
import { notice } from './notice';
import { deviceWait } from './device-loading';
import { button, element } from './dom';

export const scenarios = {
  on: '开启 / 在线', off: '关闭', offline: '离线', readonly: '共享只读', missing: '部分读取失败',
} as const;
export type Scenario = keyof typeof scenarios;

export function developerDetailPlaceholder(product: Product, loading: boolean, error: string, close: () => void, retry: () => void) {
  const back = button('', 'page-icon-button', close, 'back');
  back.setAttribute('aria-label', '返回产品目录');
  const body = element('div', 'device-page-scroll');
  const page = element('section', 'device-page page-generic', element('header', 'device-page-header',
    back, element('div', 'device-page-title', element('h2', '', product.name))), body);
  page.tabIndex = -1;
  if (loading) body.append(deviceWait(undefined, '公开设备能力'));
  else if (error) {
    const failure = notice({ tone: 'error', title: error });
    failure.append(button('重试', 'button button-small button-secondary', retry));
    body.append(failure);
  } else {
    body.append(product.icon ? deviceArtwork({
      did: `developer-preview:${product.model}`, name: product.name, model: product.model,
      roomId: '', roomName: product.room, online: true, productIcon: product.icon,
    }) : icon('device'));
    body.append(element('p', 'native-unavailable', '此型号暂无可用的公开设备能力'));
  }
  return deviceSurfaces(element('div', 'device-stage', page));
}
