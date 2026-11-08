import { describe, expect, it } from 'vitest';
import { coercePropertyInput, displayValue, initialInput, inputUnsupportedReason, isSessionError, normalizeError, sameContext, writeUnsupportedReason } from './logic';
import type { Property } from './types';

const property = (overrides: Partial<Property> = {}): Property => ({ siid: 2, piid: 1, name: 'level', description: '亮度', format: 'uint8', access: ['read', 'write'], ...overrides });

describe('MIoT 输入校验', () => {
  it('保留枚举值的 JSON 类型，不把布尔值或数字变成字符串', () => {
    const item = property({ valueList: [{ value: false, description: '关' }, { value: 2, description: '自动' }] });
    expect(coercePropertyInput(item, '0')).toBe(false);
    expect(coercePropertyInput(item, '1')).toBe(2);
    expect(() => coercePropertyInput(item, '-1')).toThrow();
    expect(() => coercePropertyInput(item, '20')).toThrow();
  });
  it('不接受空数值、无穷值、小数整数或溢出整数', () => {
    for (const value of ['', ' ', 'Infinity', '1.5', '-1', '256']) expect(() => coercePropertyInput(property(), value)).toThrow();
    expect(coercePropertyInput(property(), '255')).toBe(255);
    expect(() => coercePropertyInput(property({ format: 'uint64' }), '9007199254740993')).toThrow();
  });
  it('检查范围与步长，容许正常浮点误差', () => {
    const item = property({ format: 'float', valueRange: [0, 1, 0.1] });
    expect(coercePropertyInput(item, '0.3')).toBe(0.3);
    expect(() => coercePropertyInput(item, '0.35')).toThrow();
    expect(() => coercePropertyInput(item, '2')).toThrow();
  });
  it('禁用未知格式和无效范围', () => {
    expect(inputUnsupportedReason(property({ format: 'opaque' }))).toContain('暂不支持');
    expect(inputUnsupportedReason(property({ valueRange: [1, 0, 1] }))).toContain('范围无效');
    expect(inputUnsupportedReason(property({ valueRange: [0, 1, 0] }))).toContain('范围无效');
  });
  it('优先展示后端不支持的原因，输入转换也拒绝危险属性', () => {
    const item = property({ format: 'opaque', unsupportedReason: '恢复出厂设置不开放通用写入。' });
    expect(inputUnsupportedReason(item)).toBe('恢复出厂设置不开放通用写入。');
    expect(writeUnsupportedReason(item)).toBe('恢复出厂设置不开放通用写入。');
    expect(() => coercePropertyInput(item, '1')).toThrow('恢复出厂设置');
  });
  it('读取失败的可读属性关闭写入，而动作输入仍可独立收集参数', () => {
    const item = property({ code: -704042011, value: 42 });
    expect(writeUnsupportedReason(item)).toContain('暂不开放写入');
    expect(writeUnsupportedReason(item)).toContain('-704042011');
    expect(inputUnsupportedReason(item)).toBeUndefined();
    expect(coercePropertyInput(item, '17')).toBe(17);
    expect(initialInput(item)).toBe('');
  });
  it('可读属性无错误时可写，write-only 属性不因读取错误失去输入能力', () => {
    expect(writeUnsupportedReason(property({ code: 0 }))).toBeUndefined();
    expect(writeUnsupportedReason(property({ code: null }))).toBeUndefined();
    const writeOnly = property({ access: ['write'], code: -1 });
    expect(writeUnsupportedReason(writeOnly)).toBeUndefined();
    expect(coercePropertyInput(writeOnly, '23')).toBe(23);
    expect(displayValue(writeOnly)).toBe('不可回读');
  });
  it('只接受明确布尔值，保留字符串', () => {
    expect(coercePropertyInput(property({ format: 'bool' }), 'false')).toBe(false);
    expect(() => coercePropertyInput(property({ format: 'bool' }), 'yes')).toThrow();
    expect(coercePropertyInput(property({ format: 'string' }), '  hello  ')).toBe('  hello  ');
  });
  it('不把未知枚举值预选为第一项', () => {
    expect(initialInput(property({ value: 9, valueList: [{ value: 1, description: '一' }] }))).toBe('');
    expect(initialInput(property({ value: 1, code: -1 }))).toBe('');
    expect(initialInput(property({ value: 1, code: null }))).toBe('1');
  });
});

describe('设备状态和会话边界', () => {
  it('家庭、代次或设备不匹配时拒绝异步结果', () => {
    const current = { homeId: 'home-a', generation: 4, did: '123' };
    expect(sameContext(current, { ...current })).toBe(true);
    expect(sameContext(current, { ...current, homeId: 'home-b' })).toBe(false);
    expect(sameContext(current, { ...current, generation: 5 })).toBe(false);
    expect(sameContext(current, { ...current, did: '456' })).toBe(false);
    expect(sameContext(current, undefined)).toBe(false);
  });
  it('属性错误码优先于旧属性值显示', () => {
    expect(displayValue(property({ code: -704042011, value: 1 }))).toBe('读取失败（-704042011）');
    expect(displayValue(property({ format: 'bool', value: false }))).toBe('关闭');
    expect(displayValue(property({ code: null, value: null }))).toBe('尚未读取');
  });
  it('解析原生结构化错误，保留重试语义', () => {
    expect(normalizeError('{"kind":"offline","message":"设备离线","retryable":false}')).toEqual({ kind: 'offline', message: '设备离线', retryable: false });
    expect(normalizeError(new Error('网络异常')).message).toBe('网络异常');
  });
  it('原生authExpired触发会话失效，普通设备离线或权限错误不冒充账号失效', () => {
    expect(isSessionError(normalizeError({ kind: 'authExpired', message: '登录已失效', retryable: false }))).toBe(true);
    expect(isSessionError(normalizeError({ kind: 'offline', message: '设备离线', retryable: true }))).toBe(false);
    expect(isSessionError(normalizeError({ kind: 'permission', message: '设备权限不足', retryable: false }))).toBe(false);
  });
});
