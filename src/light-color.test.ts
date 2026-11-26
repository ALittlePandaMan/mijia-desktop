import { describe, expect, it } from 'vitest';
import { COLOR_PLANE_MARKER_DIAMETER, COLOR_PLANE_MARKER_INSET, encodePlaneColor, lightColorTab, lightTint, planePoint, rangePercent, rgbHex, rgbPosition, rgbPropertyReason, rgbValue } from './light-color';
import type { Property } from './types';

// Descriptor and readback copied as data from the authenticated readonly
// yeelink.light.wyra01 instance (research/evidence/yeelight-strip-live-properties.json).
const rgb: Property = { siid: 2, piid: 4, name: 'color', description: 'Color', format: 'uint32', unit: 'rgb', access: ['read', 'write', 'notify'], code: 0, value: 16766464, valueRange: [0, 16777215, 1] };
const ct: Property = { ...rgb, piid: 3, name: 'color-temperature', description: 'Color Temperature', unit: 'kelvin', value: 2700, valueRange: [2700, 6500, 1] };
const mode: Property = { ...rgb, piid: 5, name: 'mode', unit: null, format: 'uint8', value: 0, valueRange: null, valueList: [{ value: 0, description: 'RGB' }, { value: 18, description: 'Colour Temperature' }] };

describe('wyra01 插件颜色的独立算术与真实描述边界', () => {
  it('使用真实uint32/rgb模型，保留原始颜色和合法黑色0', () => {
    expect(rgbPropertyReason(rgb)).toBeUndefined();
    expect(rgbValue(rgb)).toBe(16766464);
    expect(rgbHex(rgbValue(rgb)!)).toBe('#ffd600');
    expect(rgbValue({ ...rgb, value: 0 })).toBe(0);
    expect(rgbHex(0)).toBe('#000000');
  });
  it('拒绝名称相同但编码、单位、格式或范围不符的描述', () => {
    expect(rgbPropertyReason(undefined)).toBeTruthy();
    for (const change of [{ name: 'unknown' }, { format: 'float' }, { unit: 'hsv' }, { valueRange: [0, 0xffffff, 2] }, { valueRange: [1, 0xffffff, 1] }, { valueRange: [0, 0xffffff] }, { valueList: [] }, { valueRange: [0, NaN, 1] }, { unsupportedReason: '尚未适配' }]) {
      expect(rgbPropertyReason({ ...rgb, ...change })).toBeTruthy();
    }
  });
  it('错误回读与历史值不能作为当前可写颜色，写入独占属性也不能凭空读取', () => {
    expect(rgbValue({ ...rgb, code: -704002000, lastReported: { value: 1, updatedAt: 1, retrievedAt: 2 } })).toBeUndefined();
    expect(rgbValue({ ...rgb, access: ['write'] })).toBeUndefined();
    expect(rgbValue({ ...rgb, value: null })).toBeUndefined();
    for (const value of [NaN, Infinity, -1, 0x1000000, 1.5, '16711680', true]) expect(rgbValue({ ...rgb, value })).toBeUndefined();
  });
  it('颜色格式化拒绝浮点、越界与非有限值', () => {
    for (const value of [NaN, Infinity, -1, 0x1000000, 1.5]) expect(() => rgbHex(value)).toThrow();
    expect(rgbHex(0xffffff)).toBe('#ffffff');
  });
  it('原RN逻辑基准按15/30内缩量化，start与move使用不同x分母', () => {
    expect(COLOR_PLANE_MARKER_INSET).toBe(15);
    expect(COLOR_PLANE_MARKER_DIAMETER).toBe(30);
    expect(planePoint(100 / 1.5, 50 / 1.5, 300, 120, 'start')).toEqual({ x: 19, y: 80 });
    expect(planePoint(100 / 1.5, 50 / 1.5, 300, 120, 'move')).toEqual({ x: 22, y: 80 });
    expect(planePoint(15, 15, 300, 120, 'start')).toEqual({ x: 0, y: 100 });
    expect(planePoint(150, 60, 300, 120, 'start')).toEqual({ x: 50, y: 50 });
    expect(planePoint(285, 105, 300, 120, 'start')).toEqual({ x: 100, y: 0 });
  });
  it('连续色相须先量化为整数百分比和纯RGB，golden不是连续HSL近似', () => {
    expect(rgbHex(encodePlaneColor({ x: 19, y: 80 }, 'commit'))).toBe('#e2ff32');
    expect(rgbHex(encodePlaneColor(planePoint(223 / 1.5, 48, 300, 120, 'move'), 'commit'))).toBe('#5bfff4');
    expect(encodePlaneColor({ x: 50, y: 50 }, 'commit')).toBe(0x7fffff);
  });
  it('release复用start的最后百分比，单击不拖动不会因commit改写几何而跳色', () => {
    const lastPoint = planePoint(100 / 1.5, 50 / 1.5, 300, 120, 'start');
    expect(encodePlaneColor(lastPoint, 'preview')).toBe(0xe2ff32);
    expect(encodePlaneColor(lastPoint, 'commit')).toBe(0xe2ff32);
    expect(encodePlaneColor(lastPoint, 'commit')).not.toBe(encodePlaneColor(planePoint(100 / 1.5, 50 / 1.5, 300, 120, 'move'), 'commit'));
  });
  it('底部预览y>=15与release y>=5保留原版差异；禁止epsilon改变通道字节', () => {
    const bottom = planePoint(300, 120, 300, 120, 'move');
    expect(bottom).toEqual({ x: 100, y: -16 });
    expect(encodePlaneColor(bottom, 'preview')).toBe(0xffd8d8);
    expect(encodePlaneColor(bottom, 'commit')).toBe(0xfff2f2);
    expect(encodePlaneColor({ x: 0, y: 80 }, 'commit')).toBe(0xff3232);
  });
  it('读回marker遵循整百分比与饱和度两位小数，红色在右边缘', () => {
    expect(rgbPosition(0xff0000)).toEqual({ x: 1, y: 0 });
    expect(rgbPosition(0x00ff00)).toEqual({ x: .34, y: 0 });
    expect(rgbPosition(0x0000ff)).toEqual({ x: .67, y: 0 });
    expect(rgbPosition(0x00ffff)).toEqual({ x: .5, y: 0 });
    expect(rgbPosition(0)).toEqual({ x: 1, y: 1 });
    expect(rgbPosition(0xffffff)).toEqual({ x: 1, y: 1 });
  });
  it('边缘坐标主动夹取，坏尺寸和非有限坐标拒绝；编码不接受小数百分比', () => {
    expect(planePoint(-500, -500, 300, 120, 'start').x).toBe(0);
    expect(planePoint(1000, 1000, 300, 120, 'move').x).toBe(100);
    for (const args of [[0, 0, 30, 120], [0, 0, 300, 30], [NaN, 0, 300, 120], [0, Infinity, 300, 120]]) expect(() => planePoint(args[0], args[1], args[2], args[3], 'move')).toThrow();
    for (const point of [{ x: 1.5, y: 50 }, { x: -1, y: 50 }, { x: 101, y: 50 }, { x: 1, y: 1.5 }, { x: 1, y: Infinity }, { x: 1, y: 201 }]) expect(() => encodePlaneColor(point, 'commit')).toThrow();
  });
  it('原逻辑尺寸的中线与键盘一百分比步长使用同一内缩基准', () => {
    // On a 300×120 dp panel the editable vertical span is 90 dp: a 0.9 dp
    // move means one percentage step. These anchors are independent of zoom.
    expect(planePoint(150, 60, 300, 120, 'move')).toEqual({ x: 50, y: 50 });
    expect(planePoint(153, 60, 300, 120, 'move')).toEqual({ x: 51, y: 50 });
    expect(planePoint(150, 37.5, 300, 120, 'move')).toEqual({ x: 50, y: 75 });
    expect(planePoint(150, 36.6, 300, 120, 'move')).toEqual({ x: 50, y: 76 });
  });
  it('全部整数色相在有效纵轴内产出uint24，black0仍可作为合法编码结果', () => {
    for (let x = 0; x <= 100; x++) for (const y of [-16, 0, 5, 15, 50, 100, 115, 200]) {
      const value = encodePlaneColor({ x, y }, 'commit');
      expect(Number.isInteger(value) && value >= 0 && value <= 0xffffff).toBe(true);
    }
    expect(encodePlaneColor({ x: 0, y: 200 }, 'commit')).toBe(0);
  });
  it('页签依据实际成功回读的枚举描述，不假定数字18必然为色温', () => {
    expect(lightColorTab(mode, true, true)).toBe('color');
    expect(lightColorTab({ ...mode, value: 18 }, true, true)).toBe('temperature');
    expect(lightColorTab({ ...mode, value: 18, code: -1 }, true, true)).toBe('color');
    expect(lightColorTab({ ...mode, value: 18, format: 'float' }, true, true)).toBe('color');
    expect(lightColorTab({ ...mode, value: 18, valueList: [{ value: 18, description: '未知模式' }] }, true, true)).toBe('color');
    expect(lightColorTab(mode, true, false)).toBe('temperature');
    expect(lightColorTab({ ...mode, value: 18 }, false, true)).toBe('color');
  });
  it('色温按真实范围显示百分比，越界和不符合设备步长的值不能静默舍入', () => {
    expect(rangePercent(ct, 2700)).toBe(0);
    expect(rangePercent(ct, 4600)).toBe(50);
    expect(rangePercent(ct, 6500)).toBe(100);
    for (const value of [2699, 6501, 2700.5, NaN]) expect(() => rangePercent(ct, value)).toThrow();
    for (const change of [{ valueRange: [2700, 2700, 1] }, { valueRange: [2700, 6500, 0] }, { valueRange: [2700, 6500] }, { valueRange: [NaN, 6500, 1] }, { valueList: [{ value: 2700, description: 'low' }] }, { format: 'string' }]) expect(() => rangePercent({ ...ct, ...change }, 2700)).toThrow();
  });
  it('白色替代和&250仅用于视觉背景，不能污染真实RGB值与协议编码', () => {
    const white = { ...rgb, value: 0xffffff };
    expect(lightTint(true, 100, rgbValue(white), undefined, 'color')).toBe('rgba(250,224,224,1)');
    expect(rgbValue(white)).toBe(0xffffff);
    expect(rgbHex(rgbValue(white)!)).toBe('#ffffff');
    expect(encodePlaneColor({ x: 0, y: 100 }, 'commit')).toBe(0xff0000);
    expect(lightTint(true, 10, 0xff0000, undefined, 'color')).toBe('rgba(250,0,0,0.3)');
  });
  it('色温背景采用33+34+34离散表，末端不冒充完整末色', () => {
    expect(lightTint(true, 100, undefined, ct, 'temperature')).toBe('rgba(250,128,6,1)');
    expect(lightTint(true, 100, undefined, { ...ct, value: 4600 }, 'temperature')).toBe('rgba(249,213,132,1)');
    expect(lightTint(true, 100, undefined, { ...ct, value: 6500 }, 'temperature')).toBe('rgba(239,243,253,1)');
  });
  it('无状态、读取失败和非法亮度不生成伪造的彩色背景', () => {
    expect(lightTint(false, 100, 0xff0000, ct, 'color')).toBeUndefined();
    expect(lightTint(undefined, 100, 0xff0000, ct, 'color')).toBeUndefined();
    for (const brightness of [undefined, NaN, 1.5, -1, 101]) expect(lightTint(true, brightness, 0xff0000, ct, 'color')).toBeUndefined();
    expect(lightTint(true, 100, -1, ct, 'color')).toBeUndefined();
    expect(lightTint(true, 100, undefined, { ...ct, code: -704002000 }, 'temperature')).toBeUndefined();
    expect(lightTint(true, 100, undefined, { ...ct, value: 8000 }, 'temperature')).toBeUndefined();
  });
});
