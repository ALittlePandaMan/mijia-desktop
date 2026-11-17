import { describe, expect, it } from 'vitest';
import { booleanValue, climateChoiceLabel, climateStepValue, controlReason, enumValue, fanModeLabel, fanSpeedIndex, fanSpeedProperty, fanSpeedSteps, findProperty, lightGroupCounts, miotCategory, numericValue, panelLayout, propertyReading, splitChildren } from './panel-layout';
import { coercePropertyInput } from './logic';
import type { Device, DevicePanel, Property } from './types';

const p: Property = { siid: 4, piid: 9, name: 'on', description: '开关', format: 'bool', access: ['read', 'write'], code: 0, value: false };
const device = (did: string, group?: string, service?: number): Device => ({ did, name: '同名设备', model: 'linp.switch.e2db3', online: true, roomId: 'r', roomName: '餐厅', controlGroup: group, controlServiceId: service });

describe('原版布局的实际协议绑定', () => {
  it('点击单个逻辑按键不重新展开同组的其他按键',()=>{
    const parent=device('p','g'),a=device('a','g',7),b=device('b','g',9);
    expect(splitChildren([parent,a,b],parent).map(d=>d.did)).toEqual(['a','b']);
    expect(splitChildren([parent,a,b],a)).toEqual([]);
  });
  it('不同品牌按真实设备品类与服务共用模板，绑定仍保留各自iid', () => {
    for (const model of ['linp.switch.e2db3', 'another.brand.example']) {
      const item = { ...device('d'), model };
      const panel: DevicePanel = { did: 'd', model, specType: 'urn:miot-spec-v2:device:switch:0000A000:vendor-a-v1:1', services: [{ siid: 4, name: 'switch', description: '', properties: [p], actions: [] }] };
      expect(panelLayout(item, panel)).toBe('switch');
      expect(findProperty(panel, ['switch'], ['on'])?.siid).toBe(4);
    }
  });
  it('不从型号或中文名称猜品类，不把风扇的指示灯当灯具', () => {
    const item = { ...device('d'), model: 'unknown.light.fake', name: '开关' };
    const panel: DevicePanel = { did: 'd', model: item.model, services: [{ siid: 4, name: 'switch', description: '', properties: [p], actions: [] }] };
    expect(panelLayout(item, panel)).toBe('generic');
    expect(panelLayout(item, { ...panel, specType: 'urn:miot-spec-v2:device:fan:0000A005:vendor:1', services: [{ ...panel.services[0], name: 'light' }] })).toBe('generic');
    expect(miotCategory('urn:miot-spec-v2:property:fan:00000001')).toBeUndefined();
  });
  it('优先采用实际解析的instance品类，并拒绝不匹配或受限面板', () => {
    const item = { ...device('d'), specType: 'urn:miot-spec-v2:device:light:0000A001:old:1' };
    const panel: DevicePanel = { did: 'd', model: item.model, specType: 'urn:miot-spec-v2:device:switch:0000A000:vendor:1', services: [{ siid: 4, name: 'switch', description: '', properties: [p], actions: [] }] };
    expect(panelLayout(item, panel)).toBe('switch');
    expect(panelLayout(item, { ...panel, did: 'other' })).toBe('generic');
    expect(panelLayout(item, { ...panel, unsupportedReason: '没有权限' })).toBe('generic');
    expect(panelLayout(item, { ...panel, services: [] })).toBe('generic');
  });
  it('风扇共用品类模板，只为已观察型号选择特定视觉配置', () => {
    for (const [model, expected] of [['dmaker.fan.p28', 'fan'], ['xiaomi.fan.p69', 'fan-p69'], ['other.fan.example', 'fan-standard']]) {
      const item = { ...device('d'), model };
      const panel: DevicePanel = { did: 'd', model, specType: 'urn:miot-spec-v2:device:fan:0000A005:vendor:1', services: [{ siid: 9, name: 'fan', description: '', properties: [{ ...p, siid: 9 }], actions: [] }] };
      expect(panelLayout(item, panel)).toBe(expected);
    }
  });
  it('按MIoT名称查找实际服务和属性，保留返回的iid而非假定编号', () => {
    const panel: DevicePanel = { did: 'd', model: '', services: [{ siid: 4, name: 'switch', description: '', properties: [p], actions: [] }, { siid: 2, name: 'light', description: '', properties: [{ ...p, siid: 2, name: 'brightness' }], actions: [] }] };
    expect(findProperty(panel, ['switch'], ['on'])).toEqual(p);
    expect(findProperty(panel, ['fan'], ['on'])).toBeUndefined();
  });
  it('温湿度与插座按真实品类选择，辅助环境服务不会误选传感器页', () => {
    const item = device('d');
    const panel: DevicePanel = { did: 'd', model: item.model, specType: 'urn:miot-spec-v2:device:temperature-humidity-sensor:0000A00A:vendor:1', services: [{ siid: 9, name: 'temperature-humidity-sensor', description: '', properties: [{ ...p, siid: 9, piid: 1002, name: 'temperature', format:'float',unit:'celsius',access:['read','notify'],value:0 },{...p,siid:9,piid:1003,name:'relative-humidity',format:'uint8',unit:'percentage',access:['read','notify'],value:0}], actions: [] }] };
    expect(panelLayout(item, panel)).toBe('temperature-humidity-sensor');
    expect(findProperty(panel, ['temperature-humidity-sensor'], ['temperature'])?.piid).toBe(1002);
    expect(panelLayout(item,{...panel,services:panel.services.map(s=>({...s,properties:s.properties.slice(0,1)}))})).toBe('generic');
    expect(panelLayout(item, { ...panel, services: [{ ...panel.services[0], name: 'environment' }] })).toBe('generic');
    expect(panelLayout(item, { ...panel, specType: 'urn:miot-spec-v2:device:outlet:0000A002:vendor:1', services: [{ siid: 4, name: 'switch', description: '', properties: [p], actions: [] }] })).toBe('outlet');
  });
  it('缓存只供显示，不能填入实时开关值、滑条值或解除写入限制', () => {
    const cached = { ...p, value: undefined, code: -704010000, lastReported: { value: true, updatedAt: 1793000000, retrievedAt: 1793008000 } };
    expect(propertyReading(cached)).toEqual({ value: true, source: 'reported' });
    expect(booleanValue(cached)).toBeUndefined();
    expect(numericValue({ ...cached, lastReported: { ...cached.lastReported, value: 28.2 } })).toBeUndefined();
    expect(controlReason(cached, true, false)).toContain('暂不开放写入');
    expect(propertyReading({ ...cached, value: false, code: 0 })).toEqual({ value: false, source: 'live' });
    expect(propertyReading({ ...cached, access: ['write'] })).toEqual({ value: undefined, source: 'missing' });
  });
  it('分键仅按服务端父设备分组，不依据名称、型号或房间合并', () => {
    const devices = [device('parent', 'A'), device('b', 'A', 4), device('c', 'B', 3), device('a', 'A', 2), device('same')];
    expect(splitChildren(devices, devices[0]).map(item => item.did)).toEqual(['a', 'b']);
    expect(splitChildren(devices, devices[4])).toEqual([]);
  });
  it('不将错误回读或数值枚举强制解释为布尔开关', () => {
    expect(booleanValue(p)).toBe(false);
    expect(booleanValue({ ...p, value: 1 })).toBeUndefined();
    expect(booleanValue({ ...p, code: -1, value: true })).toBeUndefined();
    expect(controlReason({ ...p, access: ['read'] }, true, false)).toContain('仅支持读取');
    expect(controlReason({ ...p, code: -1 }, true, false)).toContain('暂不开放写入');
  });
  it('窗帘按设备描述的枚举值绑定，不假定打开/暂停/关闭的数字', () => {
    const motor = { ...p, valueList: [{ description: 'Open', value: 17 }, { description: 'Pause', value: 8 }, { description: 'Close', value: 30 }] };
    expect(enumValue(motor, 'open')).toBe(17);
    expect(enumValue(motor, 'pause')).toBe(8);
    expect(enumValue({ ...p, valueList: [{ description: '厂商状态', value: 1 }] }, 'close')).toBeUndefined();
  });
  it('四档风速使用实际枚举值，滑杆索引不能冒充连续风速值', () => {
    const speed: Property = { ...p, name: 'fan-level', format: 'uint8', value: 4, valueRange: null, valueList: [1, 2, 3, 4].map(value => ({ value, description: `Level${value}` })) };
    expect(fanSpeedSteps(speed).map(choice => choice.label)).toEqual(['1档', '2档', '3档', '4档']);
    expect(fanSpeedIndex(speed)).toBe(3);
    expect(coercePropertyInput(speed, '3')).toBe(4);
    const nonContinuous = { ...speed, value: 30, valueList: [{ value: 10, description: '低速' }, { value: 30, description: '高速' }] };
    expect(fanSpeedIndex(nonContinuous)).toBe(1);
    expect(coercePropertyInput(nonContinuous, '1')).toBe(30);
    expect(fanSpeedIndex({ ...speed, value: 8 })).toBe(-1);
    expect(fanSpeedIndex({ ...speed, code: -1 })).toBe(-1);
  });
  it('p69按结构区分同名四档与无级风速，保留0开始的实际枚举值', () => {
    const gear: Property = { ...p, name: 'fan-level', format: 'uint8', piid: 4, value: 3, valueList: [0, 1, 2, 3].map(value => ({ value, description: `Level${value + 1}` })) };
    const stepless: Property = { ...p, name: 'fan-level', format: 'uint8', piid: 5, value: 100, valueRange: [1, 100, 1] };
    const panel: DevicePanel = { did: 'fan', model: 'xiaomi.fan.p69', services: [{ siid: 2, name: 'fan', description: '', properties: [stepless, gear], actions: [] }] };
    expect(fanSpeedProperty(panel, 'gear')).toEqual(gear);
    expect(fanSpeedProperty(panel, 'stepless')).toEqual(stepless);
    expect(fanSpeedIndex(gear)).toBe(3);
    expect(fanSpeedSteps(gear)[3].label).toBe('4档');
    expect(coercePropertyInput(gear, '3')).toBe(3);
    expect(fanSpeedProperty({ ...panel, services: [{ ...panel.services[0], properties: [stepless] }] }, 'gear')).toBeUndefined();
  });
  it('翻译真实风扇模式枚举，未识别含义保持明确的未知状态', () => {
    expect(['Straight Wind', 'Natural Wind', 'Smart', 'Sleep'].map(fanModeLabel)).toEqual(['直吹风', '自然风', '智能风', '睡眠风']);
    expect(fanModeLabel('Custom Vendor Mode')).toBe('未识别状态');
  });
  it('空调按各自服务选择属性，不把风扇或环境温度绑定为目标温度', () => {
    const target = { ...p, name: 'target-temperature', siid: 2, piid: 3 };
    const fan = { ...p, name: 'fan-level', siid: 3, piid: 1 };
    const indoor = { ...p, name: 'temperature', siid: 4, piid: 1, access: ['read'] };
    const panel: DevicePanel = { did: 'air', model: 'lemesh.airc.b27m', services: [
      { siid: 2, name: 'air-conditioner', description: '', properties: [target], actions: [] },
      { siid: 3, name: 'fan-control', description: '', properties: [fan], actions: [] },
      { siid: 4, name: 'environment', description: '', properties: [indoor], actions: [] },
    ] };
    expect(findProperty(panel, ['air-conditioner'], ['target-temperature'])).toEqual(target);
    expect(findProperty(panel, ['fan-control'], ['fan-level'])).toEqual(fan);
    expect(findProperty(panel, ['environment'], ['temperature'])).toEqual(indoor);
    expect(findProperty(panel, ['air-conditioner'], ['temperature'])).toBeUndefined();
  });
  it('空调升降温遵守设备实际范围与步长，并拒绝边界、未知或错误回读', () => {
    const temperature: Property = { ...p, name: 'target-temperature', format: 'uint8', valueRange: [16, 32, 1], value: 22 };
    expect(climateStepValue(temperature, -1)).toBe(21);
    expect(climateStepValue(temperature, 1)).toBe(23);
    expect(() => climateStepValue({ ...temperature, value: 16 }, -1)).toThrow();
    expect(() => climateStepValue({ ...temperature, value: 32 }, 1)).toThrow();
    expect(() => climateStepValue({ ...temperature, code: -1 }, 1)).toThrow();
    expect(() => climateStepValue({ ...temperature, valueRange: null }, 1)).toThrow();
    expect(climateStepValue({ ...temperature, format: 'float', valueRange: [16, 32, 0.5], value: 22.5 }, 1)).toBe(23);
  });
  it('空调只翻译已知枚举描述，不更改协议值或猜测未知语义', () => {
    expect(['Cool', 'Heat', 'Fan', 'Dry', 'Auto', 'Low', 'Medium', 'High'].map(climateChoiceLabel)).toEqual(['制冷', '制热', '送风', '除湿', '自动', '低速', '中速', '高速']);
    expect(climateChoiceLabel('Vendor Mode')).toBe('未识别状态');
  });
  it('灯组仅统计服务端明确成员的独立属性，不以灯组开关或同名设备替代', () => {
    const group: Device = { ...device('group'), model: 'mijia.light.group3', groupMembers: ['a', 'b', 'a'] };
    const devices = [group, device('a'), device('b'), device('unrelated')];
    const panel = (did: string, value: boolean): DevicePanel => ({ did, model: '', services: [{ siid: 8, name: 'light', description: '', properties: [{ ...p, siid: 8, value }], actions: [] }] });
    const panels = new Map([['group', panel('group', false)], ['a', panel('a', true)], ['b', panel('b', false)], ['unrelated', panel('unrelated', true)]]);
    expect(lightGroupCounts(group, devices, panels)).toEqual({ total: 2, on: 1, off: 1, unread: 0 });
    expect(lightGroupCounts({ ...group, groupMembers: null }, devices, panels)).toBeUndefined();
  });
  it('灯组成员缺失、离线、错误回读或标识不匹配时计为未读取', () => {
    const group: Device = { ...device('group'), groupMembers: ['missing', 'offline', 'failed', 'mismatch'] };
    const devices = [group, { ...device('offline'), online: false }, device('failed'), device('mismatch')];
    const panel = (did: string, code = 0): DevicePanel => ({ did, model: '', services: [{ siid: 2, name: 'light', description: '', properties: [{ ...p, value: false, code }], actions: [] }] });
    const panels = new Map([['offline', panel('offline')], ['failed', panel('failed', -1)], ['mismatch', panel('another')]]);
    expect(lightGroupCounts(group, devices, panels)).toEqual({ total: 4, on: 0, off: 0, unread: 4 });
  });
});
