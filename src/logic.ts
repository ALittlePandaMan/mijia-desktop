import type { AppError, DeviceContext, Json, Property } from './types';
import {deviceChoiceLabel,deviceUnit} from './device-labels';

const integerBounds: Record<string, [number, number]> = {
  uint8: [0, 255], uint16: [0, 65535], uint32: [0, 4294967295],
  uint64: [0, Number.MAX_SAFE_INTEGER], int8: [-128, 127], int16: [-32768, 32767],
  int32: [-2147483648, 2147483647], int64: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
};

export function formatSupported(property: Property): boolean {
  return ['bool', 'string', 'float', 'double'].includes(property.format) || property.format in integerBounds;
}

export function inputUnsupportedReason(property: Property): string | undefined {
  if (property.unsupportedReason) return property.unsupportedReason;
  if (!formatSupported(property)) return `暂不支持 ${property.format || '未知'} 格式的输入。`;
  if (property.valueRange && (property.valueRange.length !== 3 || property.valueRange.some(v => !Number.isFinite(v)) || property.valueRange[0] > property.valueRange[1] || property.valueRange[2] <= 0)) {
    return '设备描述中的取值范围无效，已禁用写入。';
  }
  if (property.valueList && property.valueList.length === 0) return '设备描述未提供可选值，已禁用写入。';
  return undefined;
}

export function writeUnsupportedReason(property: Property): string | undefined {
  const inputReason = inputUnsupportedReason(property);
  if (inputReason) return inputReason;
  if (property.access.includes('read') && property.code != null && property.code !== 0) {
    return `设备当前无法读取此属性（代码 ${property.code}），暂不开放写入以免误控。`;
  }
  return undefined;
}

export function coercePropertyInput(property: Property, input: string): Json {
  const unsupported = inputUnsupportedReason(property);
  if (unsupported) throw new Error(unsupported);
  if (property.valueList) {
    if (!/^\d+$/.test(input)) throw new Error('请选择有效的选项。');
    const option = property.valueList[Number(input)];
    if (!option) throw new Error('请选择有效的选项。');
    return option.value;
  }
  if (property.format === 'string') return input;
  if (property.format === 'bool') {
    if (input !== 'true' && input !== 'false') throw new Error('请选择开启或关闭。');
    return input === 'true';
  }
  if (input.trim() === '') throw new Error('请输入数值。');
  const value = Number(input);
  if (!Number.isFinite(value)) throw new Error('请输入有限数值。');
  const bounds = integerBounds[property.format];
  if (bounds && (!Number.isSafeInteger(value) || value < bounds[0] || value > bounds[1])) {
    throw new Error(`请输入 ${bounds[0]} 至 ${bounds[1]} 范围内的整数。`);
  }
  if (property.valueRange) {
    const [min, max, step] = property.valueRange;
    if (value < min || value > max) throw new Error(`数值须在 ${min} 至 ${max} 之间。`);
    const steps = (value - min) / step;
    if (Math.abs(steps - Math.round(steps)) > Math.min(1e-4, Math.max(1e-7, Number.EPSILON * Math.abs(steps) * 8))) {
      throw new Error(`数值须从 ${min} 开始，以 ${step} 为步长。`);
    }
  }
  return value;
}

export function initialInput(property: Property): string {
  if (property.code != null && property.code !== 0) return '';
  if (property.valueList) {
    const index = property.valueList.findIndex(item => JSON.stringify(item.value) === JSON.stringify(property.value));
    return index >= 0 ? String(index) : '';
  }
  if (property.value === undefined || property.value === null) return '';
  if (['string', 'number', 'boolean'].includes(typeof property.value)) return String(property.value);
  return '';
}

export function displayValue(property: Property): string {
  if (property.access.includes('write') && !property.access.includes('read')) return '不可回读';
  if (property.code != null && property.code !== 0) return `读取失败（${property.code}）`;
  if (property.value == null) return property.access.includes('read') ? '尚未读取' : '不可读取';
  const choice = property.valueList?.find(item => JSON.stringify(item.value) === JSON.stringify(property.value));
  if (choice) return deviceChoiceLabel(choice.description,`选项${property.valueList!.indexOf(choice)+1}`);
  if (property.value === true) return '开启';
  if (property.value === false) return '关闭';
  if (typeof property.value === 'object') return JSON.stringify(property.value);
  const unit = property.unit && property.unit !== 'none' ? ` ${deviceUnit(property.unit)}` : '';
  return `${property.value}${unit}`;
}

export function reportedTime(property: Property): string {
  const stamp = property.lastReported?.updatedAt;
  if (!stamp || !Number.isFinite(stamp) || stamp < 946684800 || stamp > 4102444800) return '上报时间未知';
  return new Date(stamp * 1000).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function reportedValueText(property: Property): string | undefined {
  if (!property.lastReported || property.lastReported.value == null) return undefined;
  return `云端记录：${displayValue({ ...property, value: property.lastReported.value, code: 0 })} · ${reportedTime(property)}`;
}

export function sameContext(a: DeviceContext | undefined, b: DeviceContext | undefined): boolean {
  return !!a && !!b && a.homeId === b.homeId && a.generation === b.generation && a.did === b.did;
}

export function normalizeError(error: unknown): AppError {
  if (typeof error === 'string') {
    try { return normalizeError(JSON.parse(error)); } catch { return { kind: 'unknown', message: error, retryable: true }; }
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const item = error as Record<string, unknown>;
    return {
      kind: typeof item.kind === 'string' ? item.kind : 'unknown',
      message: String(item.message),
      retryable: typeof item.retryable === 'boolean' ? item.retryable : true,
    };
  }
  return { kind: 'unknown', message: '操作未完成，请稍后重试。', retryable: true };
}

export function isSessionError(error: AppError): boolean {
  return ['auth', 'unauthorized', 'session_expired', 'login_required', 'authentication', 'auth_expired', 'authExpired'].includes(error.kind);
}
