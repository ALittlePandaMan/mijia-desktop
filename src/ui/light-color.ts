import { coercePropertyInput } from '../logic';
import {
  COLOR_PLANE_MARKER_DIAMETER, COLOR_PLANE_MARKER_INSET, encodePlaneColor, lightColorTab, planePoint, rangePercent, rgbHex,
  rgbPosition, rgbPropertyReason, rgbValue, type LightColorTab,
} from '../light-color';
import { controlReason, numericValue } from '../panel-layout';
import type { Property } from '../types';
import type { ControlEnvironment } from './controls';
import { button, element } from './dom';

export interface LightColorProps {
  property?: Property;
  temperature?: Property;
  mode?: Property;
  tab?: LightColorTab;
  heading?: 'all'|'temperature-only';
  selectTab?: (tab: LightColorTab) => void;
  preview?: (property: Property, value: number) => void;
  disabledReason?: string;
  releaseProfile?:'favorite';
}

type Environment = ControlEnvironment & { interactionEnded?: () => void };
type Point = { x: number; y: number };

/** The installed wyra01 plugin changes its editing tab locally and sends only
 * the selected RGB/CT property on release. Preview state never changes props or
 * supplies a device default; the caller owns confirmation and context teardown. */
export function renderLightColor(props: LightColorProps, env: Environment): HTMLElement {
  const card = element('section', 'native-card light-color-card');
  card.dataset.control = 'LightColor';
  // Both tabs belong to this control, including the inactive tab. Supplemental
  // property rendering must not turn packed RGB into a numeric range or add CT.
  card.dataset.boundProperties = [props.property, props.temperature].filter((p): p is Property => !!p).map(p => `${p.siid}.${p.piid}`).join(' ');
  const hasColor = !!props.property, hasTemperature = !!props.temperature;
  let tab = props.tab ?? lightColorTab(props.mode, hasTemperature, hasColor);
  if (tab === 'color' && !hasColor) tab = 'temperature';
  if (tab === 'temperature' && !hasTemperature) tab = 'color';
  let cleanup: (() => void) | undefined;

  const bind = (property: Property | undefined): void => {
    delete card.dataset.siid; delete card.dataset.piid; delete card.dataset.pending;
    card.removeAttribute('aria-busy'); card.removeAttribute('aria-description');
    if (!property) return;
    card.dataset.siid = String(property.siid); card.dataset.piid = String(property.piid);
    if (property.pending) {
      card.dataset.pending = property.pending; card.setAttribute('aria-busy', 'true');
      card.setAttribute('aria-description', property.pending === 'uncertain' ? '待确认，正在查询实际状态' : '正在确认设备状态');
    }
  };

  const draw = (): void => {
    cleanup?.(); cleanup = undefined;
    delete card.dataset.interacting;
    const property = tab === 'color' ? props.property : props.temperature;
    bind(property);
    const commonReason = (env.device.sharedReadOnly?'此共享设备只有查看权限。':undefined) ?? controlReason(property, env.device.online, env.busy) ?? props.disabledReason;
    const initialColor = rgbValue(props.property), initialTemperature = numericValue(props.temperature);
    const headingValue = element('span', 'native-slider-value');
    const heading = element('div', 'native-slider-heading', element('strong', '', tab === 'color' ? '颜色' : '色温'), element('span', '', '|'), headingValue);
    const showSwatch = (value: number): void => {
      headingValue.className = 'light-color-swatch'; headingValue.textContent = '';
      headingValue.style.backgroundColor = rgbHex(value === 0xffffff ? 16770533 : value);
    };
    if (tab === 'color' && initialColor !== undefined) showSwatch(initialColor);
    else if (tab === 'temperature' && props.temperature && initialTemperature !== undefined) {
      try { headingValue.textContent = `${rangePercent(props.temperature, initialTemperature)}%`; }
      catch { headingValue.textContent = '未读取'; }
    } else headingValue.textContent = '未读取';
    card.replaceChildren(...(props.heading==='temperature-only'&&tab==='color'?[]:[heading]));

    if (hasColor && hasTemperature) {
      const tabs = element('div', 'light-color-tabs');
      tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '灯光颜色');
      for (const [choice, label] of [['temperature', '色温'], ['color', '颜色']] as const) {
        const control = button(label, `light-color-tab${tab === choice ? ' selected' : ''}`, () => {
          if (control.disabled || tab === choice || !card.isConnected) return;
          tab = choice; props.selectTab?.(choice);
          if (card.isConnected) draw();
        });
        control.setAttribute('role', 'tab'); control.setAttribute('aria-selected', String(tab === choice));
        control.disabled = !!props.disabledReason || !env.device.online || env.busy;
        tabs.append(control);
      }
      card.append(tabs);
    }

    if (tab === 'temperature') {
      const temperature = props.temperature, range = temperature?.valueRange;
      let valid = false;
      if (temperature && temperature.name === 'color-temperature' && initialTemperature !== undefined && !temperature.valueList && temperature.unit === 'kelvin' && range?.length === 3) {
        try {
          const current = coercePropertyInput(temperature, String(initialTemperature));
          valid = range[1] > range[0] && typeof current === 'number' && current === initialTemperature;
        }
        catch { /* Unknown or invalid state never acquires a fictitious range value. */ }
      }
      if(props.releaseProfile==='favorite'&&(range?.[0]!==2700||range?.[1]!==6500||range?.[2]!==1))valid=false;
      const unavailable = commonReason ?? (!valid ? '色温范围或实时状态不可用，请重新读取状态。' : undefined);
      card.classList.toggle('control-off', !!unavailable);
      if (!temperature || !range || !valid || initialTemperature === undefined) {
        if (unavailable) card.setAttribute('aria-description', unavailable);
        return;
      }
      const slider = element('input', 'native-slider light-temperature-slider');
      slider.type = 'range'; slider.min = String(range[0]); slider.max = String(range[1]); slider.step = String(props.releaseProfile==='favorite'?38:range[2]); slider.value = String(initialTemperature);
      slider.setAttribute('aria-label', '色温'); slider.disabled = !!unavailable;
      if (unavailable) slider.setAttribute('aria-description', unavailable);
      const update = (value: number): void => {
        headingValue.textContent = `${rangePercent(temperature, value)}%`;
        slider.setAttribute('aria-valuetext', `${value} K`);
        slider.style.setProperty('--fill', `${(value - range[0]) / (range[1] - range[0]) * 100}%`);
      };
      let pointer: number | undefined, cancelled = false, ended = false;
      let observer: MutationObserver | undefined;
      const alive = (): boolean => card.isConnected && card.contains(slider);
      const enabled = (): boolean => !slider.disabled && !controlReason(temperature, env.device.online, env.busy) && !props.disabledReason && numericValue(temperature) !== undefined;
      const detach = (): void => {
        window.removeEventListener('blur', blur); window.removeEventListener('pointerup', pointerUp, true);
        observer?.disconnect(); observer = undefined;
      };
      const end = (cancel: boolean, notify = true): void => {
        if (pointer === undefined) return;
        pointer = undefined; cancelled = cancel; detach(); delete card.dataset.interacting;
        if (cancel && alive()) { slider.value = String(initialTemperature); update(initialTemperature); props.preview?.(temperature, initialTemperature); }
        if (notify && !ended) {
          ended = true;
          // Native range change follows pointerup; let it submit before a
          // deferred parent redraw replaces this input.
          requestAnimationFrame(() => { if (alive()) env.interactionEnded?.(); });
        }
      };
      const blur = (): void => end(true);
      const pointerUp = (event: PointerEvent): void => { if (event.pointerId === pointer) end(false); };
      slider.addEventListener('pointerdown', event => {
        if (!enabled() || event.button !== 0 || !event.isPrimary || !alive() || pointer !== undefined) return;
        pointer = event.pointerId; cancelled = false; ended = false; card.dataset.interacting = 'true';
        window.addEventListener('blur', blur); window.addEventListener('pointerup', pointerUp, true);
        observer = new MutationObserver(() => { if (!alive()) end(true, false); });
        observer.observe(document.documentElement, { childList: true, subtree: true });
      });
      for (const name of ['pointercancel', 'lostpointercapture']) slider.addEventListener(name, event => { if ((event as PointerEvent).pointerId === pointer) end(true); });
      slider.addEventListener('keydown', () => { if (enabled() && alive()) cancelled = false; });
      slider.addEventListener('input', () => {
        if (!enabled() || cancelled || !alive()) return;
        try {
          const value = Number(coercePropertyInput(temperature, slider.value));
          update(value); props.preview?.(temperature, value);
        } catch (error) { env.error(error); }
      });
      slider.addEventListener('change', () => {
        if (!enabled() || cancelled || !alive()) return;
        try { env.write(temperature, coercePropertyInput(temperature, slider.value)); }
        catch (error) { env.error(error); }
      });
      cleanup = () => end(true, false);
      update(initialTemperature); card.append(slider); return;
    }

    const unavailable = commonReason ?? rgbPropertyReason(props.property) ?? (initialColor === undefined ? '颜色状态尚未读取，请先读取状态。' : undefined);
    card.classList.toggle('control-off', !!unavailable);
    const plane = element('div', 'light-color-plane');
    plane.setAttribute('role', 'group'); plane.setAttribute('aria-label', 'RGB 颜色');
    plane.setAttribute('aria-disabled', String(!!unavailable)); plane.tabIndex = unavailable ? -1 : 0;
    if (unavailable) plane.setAttribute('aria-description', unavailable);
    const marker = element('span', 'light-color-marker'); marker.setAttribute('aria-hidden', 'true');
    plane.append(marker); card.append(plane);
    let pointer: number | undefined, point: Point | undefined, currentColor = initialColor;
    let observer: MutationObserver | undefined;
    const alive = (): boolean => card.isConnected && card.contains(plane);
    const enabled = (): boolean => !unavailable && !controlReason(props.property, env.device.online, env.busy) && !props.disabledReason && !rgbPropertyReason(props.property) && rgbValue(props.property) !== undefined;
    const showColor = (value: number, position = rgbPosition(value)): void => {
      marker.hidden = false; marker.style.left = `${position.x * 100}%`; marker.style.top = `${position.y * 100}%`;
      marker.style.backgroundColor = rgbHex(value); showSwatch(value);
      plane.setAttribute('aria-label', `RGB 颜色 ${rgbHex(value)}`);
    };
    if (initialColor !== undefined) showColor(initialColor); else marker.hidden = true;
    const dimensions = (): { width: number; height: number } => ({ width: plane.clientWidth, height: plane.clientHeight });
    const local = (event: PointerEvent): { x: number; y: number; width: number; height: number } => {
      const bounds = plane.getBoundingClientRect(), { width, height } = dimensions();
      if (!bounds.width || !bounds.height || !width || !height) throw new Error('颜色面板尺寸不可用。');
      return { x: (event.clientX - bounds.left) * width / bounds.width, y: (event.clientY - bounds.top) * height / bounds.height, width, height };
    };
    let position: Point | undefined;
    const displayPoint = (value: number): void => {
      currentColor = value; showColor(value, position);
      if (props.property) props.preview?.(props.property, value);
    };
    const preview = (event: PointerEvent, phase: 'start' | 'move'): void => {
      const location = local(event);
      point = planePoint(location.x, location.y, location.width, location.height, phase);
      position = { x: Math.max(0, Math.min(1, location.x / location.width)), y: Math.max(0, Math.min(1, location.y / location.height)) };
      displayPoint(encodePlaneColor(point, 'preview'));
    };
    const detach = (): void => {
      window.removeEventListener('blur', blur); observer?.disconnect(); observer = undefined;
    };
    const end = (commit: boolean, notify = true): void => {
      if (pointer === undefined) return;
      const endedPointer = pointer; pointer = undefined; detach(); delete card.dataset.interacting;
      try { if (plane.hasPointerCapture(endedPointer)) plane.releasePointerCapture(endedPointer); }
      catch { /* Teardown may already have released the native pointer. */ }
      if (!alive()) return;
      try {
        if (commit && enabled() && point && props.property) {
          const value = encodePlaneColor(point, props.releaseProfile??'commit');
          displayPoint(value); env.write(props.property, coercePropertyInput(props.property, String(value)));
        } else if (initialColor !== undefined) {
          currentColor = initialColor; point = undefined; position = undefined;
          showColor(initialColor); if (props.property) props.preview?.(props.property, initialColor);
        }
      } catch (error) { env.error(error); }
      finally { if (notify && alive()) env.interactionEnded?.(); }
    };
    const blur = (): void => end(false);
    plane.addEventListener('pointerdown', event => {
      if (!enabled() || event.button !== 0 || !event.isPrimary || pointer !== undefined || !alive()) return;
      event.preventDefault(); plane.focus({ preventScroll: true });
      pointer = event.pointerId; card.dataset.interacting = 'true';
      try {
        plane.setPointerCapture(event.pointerId);
        window.addEventListener('blur', blur);
        observer = new MutationObserver(() => { if (!alive()) end(false, false); });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        preview(event, 'start');
      } catch (error) { end(false); env.error(error); }
    });
    plane.addEventListener('pointermove', event => {
      if (pointer !== event.pointerId || !alive()) return;
      if (!enabled()) { end(false); return; }
      try { preview(event, 'move'); }
      catch (error) { end(false); env.error(error); }
    });
    plane.addEventListener('pointerup', event => { if (pointer === event.pointerId) end(true); });
    for (const name of ['pointercancel', 'lostpointercapture']) plane.addEventListener(name, event => { if ((event as PointerEvent).pointerId === pointer) end(false); });
    plane.addEventListener('keydown', event => {
      if (!enabled() || !props.property || currentColor === undefined || !alive() || pointer !== undefined || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      try {
        const { width, height } = dimensions();
        if (!point) {
          const current = rgbPosition(currentColor);
          point = planePoint(current.x * width, current.y * (height - COLOR_PLANE_MARKER_DIAMETER) + COLOR_PLANE_MARKER_INSET, width, height, 'move');
        }
        point = { x: Math.max(0, Math.min(100, point.x + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0))), y: Math.max(0, Math.min(100, point.y + (event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0))) };
        position = { x: point.x / 100, y: (COLOR_PLANE_MARKER_INSET + (100 - point.y) / 100 * (height - COLOR_PLANE_MARKER_DIAMETER)) / height };
        const value = encodePlaneColor(point, props.releaseProfile??'commit');
        displayPoint(value); env.write(props.property, coercePropertyInput(props.property, String(value)));
      } catch (error) { env.error(error); }
    });
    cleanup = () => end(false, false);
  };
  draw(); return card;
}
