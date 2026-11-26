import { inputUnsupportedReason } from './logic';
import { isReadableValue } from './panel-layout';
import type { LightModeSlot, Property } from './types';

// Observed in wyra01 plugin 1015788/1034439, module 10127. Values describe
// that model's mode property, never another manufacturer's similarly named enum.
export const wyraScenes = [
  { value: 1, name: '早安唤醒', glyph: 'morning' },
  { value: 2, name: '日落助眠', glyph: 'sunset' },
  { value: 3, name: '电影之夜', glyph: 'movie' },
  { value: 4, name: '暖心寿辰', glyph: 'birthday' },
  { value: 5, name: '约会之夜', glyph: 'date' },
  { value: 6, name: '家的温暖', glyph: 'home' },
  { value: 7, name: '夜灯模式', glyph: 'night' },
  { value: 8, name: '浪漫燃情', glyph: 'romance' },
  { value: 9, name: '闪烁提醒', glyph: 'flicker' },
  { value: 10, name: '烛光效果', glyph: 'candle' },
  { value: 16, name: '七色渐变', glyph: 'shade' },
  { value: 17, name: '三色跳变', glyph: 'jump' },
] as const;

export function wyraModeValue(property: Property | undefined): number | undefined {
  if (!property || property.name !== 'mode' || property.format !== 'uint8' ||
      property.valueRange || property.unit || !property.access.includes('read') ||
      !isReadableValue(property) || !Number.isSafeInteger(property.value)) return undefined;
  const list = property.valueList;
  if (!list?.length || list.some(option => typeof option.value !== 'number' ||
      !Number.isSafeInteger(option.value) || option.value < 0 || option.value > 255) ||
      new Set(list.map(option => option.value)).size !== list.length) return undefined;
  return list.some(option => option.value === property.value) ? property.value as number : undefined;
}

export function wyraModeReason(property: Property | undefined, target: number): string | undefined {
  if (wyraModeValue(property) === undefined) return '设备模式的描述或实时状态不可用。';
  if (!property!.access.includes('write')) return '设备模式仅可读取。';
  const reason = inputUnsupportedReason(property!);
  if (reason) return reason;
  if (!Number.isSafeInteger(target) || !property!.valueList!.some(option => option.value === target)) {
    return '当前型号的真实描述未提供这个模式。';
  }
  return undefined;
}

/** Private slots come from a separate read-only protocol adapter, not fabricated
 * MIoT metadata. Activation still sends only the real public mode property. */
export function validLightModeSlot(slot: LightModeSlot | undefined, index: number): slot is LightModeSlot {
  if (!slot || slot.reason || slot.index !== index || slot.mode !== index + 11 ||
      !Number.isInteger(index) || index < 0 || index > 3 ||
      typeof slot.brightness !== 'number' || !Number.isInteger(slot.brightness) ||
      slot.brightness < 0 || slot.brightness > 100) return false;
  if (slot.temperature != null) return slot.color == null && Number.isInteger(slot.temperature) && slot.temperature >= 2700 && slot.temperature <= 6500;
  return typeof slot.color === 'number' && Number.isInteger(slot.color) && slot.color >= 0 && slot.color <= 0xffffff;
}
