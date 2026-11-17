import { coercePropertyInput } from './logic';
import { isReadableValue, numericValue } from './panel-layout';
import type { Property } from './types';

export type LightColorTab = 'temperature' | 'color';
export interface PlanePoint { x: number; y: number }
// Original plugin 10109's logical dp geometry. Both the rendered marker and
// pointer/keyboard coordinates use this density-independent reference size.
export const COLOR_PLANE_MARKER_DIAMETER = 30;
export const COLOR_PLANE_MARKER_INSET = COLOR_PLANE_MARKER_DIAMETER / 2;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** A packed uint24 RGB needs the actual descriptor, not a matching label. */
export function rgbPropertyReason(property: Property | undefined): string | undefined {
  if (!property) return '此设备未提供 RGB 颜色属性。';
  if (property.unsupportedReason) return property.unsupportedReason;
  const range = property.valueRange;
  if (property.name !== 'color' || property.format !== 'uint32' || property.unit !== 'rgb' || property.valueList != null || !range || range.length !== 3 || range[0] !== 0 || range[1] !== 0xffffff || range[2] !== 1) return '此颜色编码或范围尚未适配。';
  return undefined;
}

export function rgbValue(property: Property | undefined): number | undefined {
  const value = numericValue(property);
  return !rgbPropertyReason(property) && value !== undefined && Number.isInteger(value) && value >= 0 && value <= 0xffffff ? value : undefined;
}

export function rgbHex(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) throw new Error('RGB 颜色值无效。');
  return `#${value.toString(16).padStart(6, '0')}`;
}

/** 10013.color2left/color2top, then 10109's inverse percentage. The installed
 * plugin rounds saturation to 2 decimals and puts red at the right edge. This
 * is an asymmetric display mapping; it must not encode protocol writes.
 */
export function rgbPosition(value: number): PlanePoint {
  rgbHex(value);
  const [r, g, b] = [(value >>> 16) & 255, (value >>> 8) & 255, value & 255].map(channel => channel / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta !== 0) hue = (max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) / 6;
  if (hue >= .99 || hue === 0) hue = 1;
  const largest = Math.round(max * 255), smallest = Math.round(min * 255);
  const saturation = Number((largest === 0 ? 0 : (largest - smallest) / Number(largest.toFixed(2))).toFixed(2));
  return { x: (100 - Math.trunc(100 * (1 - hue))) / 100, y: 1 - saturation };
}

/** 10109 uses a 15/30 dp inset, preserved as logical CSS px. Callers undo
 * outer CSS zoom before passing geometry; screen density never changes IID values.
 * Grant and move have different x denominators; release reuses the LAST point.
 * Clamping the grant's invalid edges is an intentional guard, not vendor parity.
 */
export function planePoint(x: number, y: number, width: number, height: number, phase: 'start' | 'move'): PlanePoint {
  if (![x, y, width, height].every(Number.isFinite) || width <= COLOR_PLANE_MARKER_DIAMETER || height <= COLOR_PLANE_MARKER_DIAMETER || !['start', 'move'].includes(phase)) throw new Error('颜色面板尺寸或坐标不可用。');
  const px = clamp(x, 0, width), py = clamp(y, 0, height);
  return {
    x: Math.trunc(clamp(phase === 'start' ? (px - COLOR_PLANE_MARKER_INSET) / (width - COLOR_PLANE_MARKER_DIAMETER) : px / width, 0, 1) * 100),
    y: 100 - Math.trunc((py - COLOR_PLANE_MARKER_INSET) / (height - COLOR_PLANE_MARKER_DIAMETER) * 100),
  };
}

/** Independent arithmetic for 10013.conversion: hue is quantized to an integer
 * percent and then to a pure RGB triplet BEFORE its hue is recovered for HSL.
 */
function hueChannels(percent: number): [number, number, number] {
  const step = 100 / 6;
  if (percent < step) return [255, Math.trunc(percent / step * 255), 0];
  if (percent < 2 * step) return [Math.trunc(255 * (1 - (percent - step) / step)), 255, 0];
  if (percent < 50) return [0, 255, Math.trunc((percent - 2 * step) / step * 255)];
  if (percent < 4 * step) return [0, Math.trunc(255 * (1 - (percent - 50) / step)), 255];
  if (percent < 5 * step) return [Math.trunc((percent - 4 * step) / step * 255), 0, 255];
  return [255, 0, Math.trunc(255 * (1 - (percent - 5 * step) / step))];
}

/** 10106 + 10013: S=1, L=1-max(y,15)/200 during preview, and a lower limit
 * of 5 at commit. Truncate channels without epsilon; rounding changes bytes.
 * There is no visual white substitution or background bit mask in this path.
 */
export function encodePlaneColor(point: PlanePoint, phase: 'preview' | 'commit' | 'favorite'): number {
  if (!Number.isInteger(point.x) || point.x < 0 || point.x > 100 || !Number.isInteger(point.y) || point.y > 200 || !['preview', 'commit', 'favorite'].includes(phase)) throw new Error('颜色面板取值无效。');
  const [r, g, b] = hueChannels(point.x), max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const hue = max === r ? 60 * (g - b) / delta + (g < b ? 360 : 0) : max === g ? 60 * (b - r) / delta + 120 : 60 * (r - g) / delta + 240;
  const lightness = 1 - Math.max(phase === 'favorite' ? 0 : phase === 'commit' ? 5 : 15, point.y) / 200;
  const chroma = 1 - Math.abs(2 * lightness - 1), second = chroma * (1 - Math.abs(hue / 60 % 2 - 1)), offset = lightness - chroma / 2;
  const sectors = [[chroma, second, 0], [second, chroma, 0], [0, chroma, second], [0, second, chroma], [second, 0, chroma], [chroma, 0, second]];
  const channels = sectors[Math.floor(hue / 60)].map(channel => Math.trunc(255 * (channel + offset)));
  return (channels[0] << 16) | (channels[1] << 8) | channels[2];
}

export function lightColorTab(mode: Property | undefined, hasTemperature: boolean, hasColor: boolean): LightColorTab {
  if (!hasColor) return 'temperature';
  const value = numericValue(mode);
  const description = isReadableValue(mode) && mode.format === 'uint8' && value !== undefined && Number.isInteger(value) && value >= 0 && value <= 255 ? mode.valueList?.find(item => item.value === value)?.description.replace(/[\s_-]/g, '').toLowerCase() : undefined;
  return hasTemperature && ['colourtemperature', 'colortemperature', 'ct', '色温'].includes(description ?? '') ? 'temperature' : 'color';
}

export function rangePercent(property: Property, value: number): number {
  const range = property.valueRange;
  if (!Number.isFinite(value) || property.valueList != null || !range || range.length !== 3 || range.some(n => !Number.isFinite(n)) || range[1] <= range[0] || range[2] <= 0 || typeof coercePropertyInput(property, String(value)) !== 'number') throw new Error('属性范围或当前值不可用。');
  return Math.trunc((value - range[0]) / (range[1] - range[0]) * 100);
}

/** Visual tint only. 10061's &250 mask and white substitution never modify
 * property values. Temperature follows 10067's 33+34+34 discrete gradient.
 */
export function lightTint(on: boolean | undefined, brightness: number | undefined, color: number | undefined, temperature: Property | undefined, tab: LightColorTab): string | undefined {
  if (on !== true || brightness === undefined || !Number.isInteger(brightness) || brightness < 0 || brightness > 100) return undefined;
  const alpha = Math.max(brightness / 100, .3);
  if (tab === 'color' && color !== undefined) {
    if (!Number.isInteger(color) || color < 0 || color > 0xffffff) return undefined;
    const displayed = color === 0xffffff ? 16770533 : color;
    return `rgba(${(displayed >>> 16) & 250},${(displayed >>> 8) & 250},${displayed & 250},${alpha})`;
  }
  const value = numericValue(temperature);
  if (tab !== 'temperature' || !temperature || temperature.name !== 'color-temperature' || temperature.unit !== 'kelvin' || temperature.format !== 'uint32' || value === undefined) return undefined;
  let index: number;
  try { index = rangePercent(temperature, value); } catch { return undefined; }
  return temperaturePalette(index, alpha);
}

export function temperaturePalette(index:number, alpha=1):string|undefined {
  if(!Number.isInteger(index)||index<0||index>100||!Number.isFinite(alpha)||alpha<0||alpha>1)return undefined;
  const stops = [[250, 128, 6], [251, 174, 45], [248, 252, 219], [239, 243, 255]];
  const segment = index < 33 ? 0 : index < 67 ? 1 : 2;
  const start = [0, 33, 67][segment], count = [33, 34, 34][segment];
  const channels = stops[segment].map((channel, i) => Math.trunc(channel + (stops[segment + 1][i] - channel) / count * (index - start)));
  return `rgba(${channels.join(',')},${alpha})`;
}
