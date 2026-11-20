import { describe, expect, it } from 'vitest';
import air from '../src-tauri/src/fixtures/miot/air-purifier.panel.json';
import water from '../src-tauri/src/fixtures/miot/water-purifier.panel.json';
import humidifier from '../src-tauri/src/fixtures/miot/humidifier.panel.json';
import vacuum from '../src-tauri/src/fixtures/miot/vacuum.panel.json';
import { compilePanelDocument, customIconUrl, propertyShapeReason, resolveComponentProperty, schemaUnit, specTranslation, type ComponentNode, type DeviceUiResources } from './ui-schema';
import type { Device, DevicePanel, Json, Property } from './types';

const device: Device = { did: 'test-device', model: 'different.brand.switch', name: '协议测试', online: true, roomId: 'test-room', roomName: '测试' };
const type = 'urn:miot-spec-v2:device:switch:0000A000:test-v1:1';
const property = (piid: number, extra: Partial<Property> = {}): Property => ({ siid: 9, piid, name: 'on', description: '开关', format: 'bool', access: ['read', 'write'], value: false, code: 0, ...extra });
const panel = (properties: Property[] = [property(7)]): DevicePanel => ({ did: device.did, model: device.model, specType: type, services: [{ siid: 9, name: 'switch', description: '开关', properties, actions: [] }] });
// Synthetic values in the observed real schema, not a captured cloud response:
// 1006883-17156.getFromCloud/getSpecItem; 17186.customFunctions; packaged
// 20198 setting-setting/customizeFuncList/specItem/customizeInfo.{siid,piid,title}.
// The real packaged example is voc777.lock.t30pro / 16.1..16.7 (evidence only).
const entry = (piid: number, title: string, extra: Record<string, Json> = {}): Json => ({ note: `property-${piid}`, format: 'specItem', customizeInfo: { siid: 9, piid, title, ...extra } });
const resource = (entries: Json[], extra: Partial<DeviceUiResources> = {}): DeviceUiResources => ({ did: device.did, model: device.model, specType: type, instance: null, i18n: null, customConfig: { model: device.model, standard_infos: [{ note: 'home-setting', customizeFuncList: entries }, { note: 'setting-setting', customizeFuncList: entries }] }, route: { kind: 'standard', pluginId: 1006883 }, fetchedAt: 1793060000, cacheState: 'fresh', diagnostics: [], ...extra });
const flatten = (items: ComponentNode[]): ComponentNode[] => items.flatMap(item => item.name === 'Container' ? flatten(item.items) : [item]);

describe('official schema translation: model/protocol tests, no physical-device claims', () => {
  it('shows time units in Chinese while preserving the actual value, step and binding',()=>{
    const time=property(5,{name:'target-time',format:'uint32',unit:'minutes',value:5,valueRange:[1,1440,1]});
    const current=panel([time]),doc=compilePanelDocument({device,panel:current,resources:resource([entry(5,'工作时间')])});
    const node=flatten(doc.items).find(n=>n.name==='Slider');expect(node?.name==='Slider'&&node.props.unit).toBe('分钟');expect(node?.name==='Slider'&&node.props.binding).toEqual({siid:9,piid:5});expect(resolveComponentProperty(current,{siid:9,piid:5})).toBe(time);expect(time).toMatchObject({unit:'minutes',value:5,valueRange:[1,1440,1]});
    expect(['seconds','minutes','hours','days'].map(schemaUnit)).toEqual(['秒','分钟','小时','天']);expect(schemaUnit('unknown-unit')).toBe('unknown-unit');
  });
  it('logical switch omits wired/wireless/flex mode selectors in custom and fallback UI while retaining read definitions',()=>{
    const mode=property(3,{name:'mode',format:'uint8',value:0,valueList:[{value:0,description:'Wired And Wireless'},{value:1,description:'Wireless'},{value:2,description:'Wireless'}]});
    const current=panel([property(7),mode]);
    for(const resources of [undefined,resource([entry(3,'灵动 / 无线'),entry(7,'电源')])])for(const surface of ['home','settings'] as const){
      const doc=compilePanelDocument({device:{...device,controlServiceId:9},panel:current,resources,surface,includeModelFallback:true});
      expect(flatten(doc.items).filter(item=>'binding' in item.props).map(item=>'binding' in item.props?item.props.binding.piid:0)).toEqual([7]);
    }
    expect(current.services[0].properties).toContain(mode);
    expect(flatten(compilePanelDocument({device,panel:current,includeModelFallback:true}).items).some(item=>'binding' in item.props&&item.props.binding.piid===3)).toBe(true);
  });
  it('keeps customizeFuncList order and actual IDs, independent of brand and localized names', () => {
    const current = panel([property(7), property(3, { format: 'uint8', name: 'mode', value: 30, valueList: [{ value: 10, description: '第一档' }, { value: 30, description: '第二档' }] }), property(5, { format: 'uint8', name: 'brightness', unit: 'percentage', value: 45, valueRange: [1, 100, 1] })]);
    const doc = compilePanelDocument({ device, panel: current, resources: resource([entry(3, '模式'), entry(7, '按钮'), entry(5, '亮度')]) });
    expect(doc.source).toBe('official-standard');
    expect(doc.items.map(item => item.name)).toEqual(['Selector', 'Power', 'Slider']);
    expect(doc.consumedPropertyKeys).toEqual(['9.3', '9.7', '9.5']);
    expect(doc.items.map(item => 'binding' in item.props ? item.props.binding.piid : null)).toEqual([3, 7, 5]);
    expect(doc.diagnostics).toEqual([]);
  });

  it('has no copied property state; resolves the most recent confirmed or optimistic state', () => {
    const doc = compilePanelDocument({ device, panel: panel(), resources: resource([entry(7, '按钮')]) });
    const node = doc.items[0];
    expect('binding' in node.props).toBe(true);
    if (!('binding' in node.props)) throw Error('missing binding');
    expect(node.props).not.toHaveProperty('value');
    expect(resolveComponentProperty(panel([property(7, { value: true, pending: 'sending' })]), node.props.binding)?.pending).toBe('sending');
    expect(resolveComponentProperty(panel([property(7, { value: false })]), node.props.binding)?.value).toBe(false);
  });

  it('rejects resource/model/type/route mismatch and panel identity mismatch', () => {
    for (const changes of [{ did: 'other' }, { model: 'other.brand' }, { specType: `${type}-other` }, { route: { kind: 'dedicated' as const } }, { customConfig: { model: 'other.brand', standard_infos: [] } }]) {
      const doc = compilePanelDocument({ device, panel: panel(), resources: resource([entry(7, '按钮')], changes) });
      expect(doc.items).toEqual([]); expect(doc.diagnostics.length).toBeGreaterThan(0);
    }
    expect(compilePanelDocument({ device, panel: { ...panel(), did: 'other' }, includeModelFallback: true }).items).toEqual([]);
  });

  it('selects home vs settings layout without creating the removed per-device settings menu', () => {
    const home = compilePanelDocument({ device, panel: panel(), resources: resource([entry(7, '按钮')]) });
    const settings = compilePanelDocument({ device, panel: panel(), resources: resource([entry(7, '按钮')]), surface: 'settings' });
    expect(home.items[0]).toMatchObject({ name: 'Power', props: { style: 'wide' } });
    expect(settings.items[0]).toMatchObject({ name: 'Power', props: { style: 'setting' } });
    expect(settings.items).toHaveLength(1);
  });

  it('rejects miid modules, string IDs and absent or ambiguous model IDs', () => {
    for (const extra of [{ miid: 1 }, { miid: '0' }, { siid: '9' }, { piid: 0 }, { siid: 99 }] as Record<string, Json>[]) {
      const doc = compilePanelDocument({ device, panel: panel(), resources: resource([entry(7, '按钮', extra)]) });
      expect(doc.items).toEqual([]); expect(doc.diagnostics.length).toBeGreaterThan(0);
    }
    const doc = compilePanelDocument({ device, panel: panel([property(7), property(7)]), resources: resource([entry(7, '按钮')]) });
    expect(doc.items).toEqual([]); expect(doc.diagnostics[0]).toContain('唯一');
  });

  it('does not infer global visibility from selected or reorder from functionList', () => {
    const resources = resource([{ ...(entry(7, '仍可用') as object), selected: '0', hidden: true } as Json]);
    const custom = resources.customConfig as { [key: string]: Json };
    (custom.standard_infos as { [key: string]: Json }[])[0].functionList = [{ note: 'property-7', selected: '0' }];
    const doc = compilePanelDocument({ device, panel: panel(), resources });
    expect(doc.items).toHaveLength(1); expect(doc.items[0].props).toHaveProperty('label', '仍可用');
  });

  it('reports plugin pageEntry and unknown format, never creates fake working links', () => {
    const doc = compilePanelDocument({ device, panel: panel(), resources: resource([{ note: 'page', format: 'pageEntry', customizeInfo: { title: '厂商页面', pageName: 'vendor', pageParams: 'doSomething()' } }, { note: 'unknown', format: 'javascript', customizeInfo: { name: 'button', onClick: 'danger' } }]) });
    expect(doc.items).toEqual([]); expect(doc.diagnostics.join(' ')).toContain('厂商插件');
    expect(doc.diagnostics.join(' ')).toContain('格式尚未适配');
  });

  it('validates bool, enum, numeric range, format bounds and read/write access', () => {
    for (const changes of [{ valueRange: [0, 100, 0], format: 'uint8' }, { valueRange: [0, 999, 1], format: 'uint8' }, { valueList: [{ value: 1, description: 'A' }, { value: 1, description: 'B' }], format: 'uint8' }, { valueList: [{ value: '1', description: 'A' }, { value: '2', description: 'B' }], format: 'uint8' }, { valueList: [{ value: 1, description: 'A' }, { value: 999, description: 'B' }], format: 'uint8' }, { valueRange: [0, 1, 1], format: 'bool' }]) {
      expect(propertyShapeReason(property(7, changes))).toBeTruthy();
      const doc = compilePanelDocument({ device, panel: panel([property(7, changes)]), resources: resource([entry(7, '按钮')]) });
      expect(doc.items[0].name).toBe('Status');
    }
    expect(compilePanelDocument({ device, panel: panel([property(7, { access: ['read'] })]), resources: resource([entry(7, '只读')]) }).items[0].name).toBe('Status');
    expect(compilePanelDocument({ device, panel: panel([property(7, { access: [] })]), resources: resource([entry(7, '无权限')]) }).items).toEqual([]);
  });

  it('keeps write-only and free scalar input plus action parameters for explicit adapters', () => {
    const current = panel([property(1, { access: ['write'] }), property(2, { format: 'string', name: 'message', value: 'abc' }), property(3, { name: 'unbounded', format: 'uint32', value: 5 })]);
    current.services[0].actions = [{ siid: 9, aiid: 11, name: 'play', description: '输入参数动作', in: [2, 3], out: [] }];
    const doc = compilePanelDocument({ device, panel: current, includeModelFallback: true });
    expect(flatten(doc.items).map(item => item.name)).toEqual(['PropertyEditor', 'PropertyEditor', 'PropertyEditor', 'Action']);
    expect(current.services[0].actions[0].in).toEqual([2, 3]);
    expect(doc.items[0].name).toBe('Container');
  });

  it('does not duplicate configured properties when compiling the generic model', () => {
    const doc = compilePanelDocument({ device, panel: panel([property(7), property(8)]), resources: resource([entry(7, '自定义'), entry(7, '重复')]), includeModelFallback: true });
    expect(flatten(doc.items)).toHaveLength(2);
    expect(doc.consumedPropertyKeys).toEqual(['9.7', '9.8']);
    expect(doc.diagnostics.join(' ')).toContain('重复');
  });

  it('leaves cached layout stale and never promotes lastReported into real control state', () => {
    const failed = property(7, { value: undefined, code: -1, lastReported: { value: true, updatedAt: 1793060000, retrievedAt: 1793060100 } });
    const doc = compilePanelDocument({ device, panel: panel([failed]), resources: resource([entry(7, '按钮')], { cacheState: 'stale' }) });
    expect(doc.items[0].name).toBe('Power');
    expect(doc.items[0].props).not.toHaveProperty('value');
    expect(failed.value).toBeUndefined(); expect(doc.diagnostics.join(' ')).toContain('缓存');
  });

  it('does not apply ordinary optimistic control semantics to lock actions', () => {
    const current = { ...panel(), specType: 'urn:miot-spec-v2:device:lock:0000A038:test-v1:1' };
    const doc = compilePanelDocument({ device, panel: current, includeModelFallback: true });
    expect(flatten(doc.items)[0].name).toBe('Status');
    expect(doc.diagnostics.join(' ')).toContain('高风险');
  });

  it('treats labels as text, permits only Xiaomi HTTPS image hosts, and preserves unknown icons as absent', () => {
    const attack = '<img src=x onerror=alert(1)>中文标题';
    expect(compilePanelDocument({ device, panel: panel(), resources: resource([entry(7, attack)]) }).items[0].props).toHaveProperty('label', attack);
    for (const value of ['javascript:alert(1)', 'file:///secret', 'data:image/svg+xml,hello', 'https://api.mi-img.com.evil.example/a.png', 'http://cnbj1-fds.api.xiaomi.net/a.png', 'https://user:pw@cdn.cnbj1.fds.api.mi-img.com/a.png']) expect(customIconUrl(value)).toBeUndefined();
    expect(customIconUrl('https://cdn.cnbj1.fds.api.mi-img.com/a.png')).toBe('https://cdn.cnbj1.fds.api.mi-img.com/a.png');
  });

  it('uses the observed i18n iid/index schema and language fallbacks without changing raw enum values', () => {
    // 14747.getI18nKey / getI18nForSpecs: valuelist is an index, not value.
    const i18n: Json = { data: { zh_cn: { 'service:009': '功能', 'service:009:property:007': '开关状态', 'service:009:property:007:valuelist:000': '低速', 'service:009:property:007:valuelist:001': '高速' }, en: { 'service:009:property:008': 'Fallback English' } } };
    const current = panel([property(7, { name: 'mode', format: 'uint8', value: 30, valueList: [{ value: 10, description: 'Low' }, { value: 30, description: 'High' }] }), property(8)]);
    const doc = compilePanelDocument({ device, panel: current, resources: resource([], { i18n }), includeModelFallback: true });
    const nodes = flatten(doc.items);
    expect(doc.items[0].props).toHaveProperty('label', '功能');
    expect(nodes[0].props).toMatchObject({ label: '开关状态', choiceLabels: [{ value: 10, label: '低速' }, { value: 30, label: '高速' }] });
    expect(nodes[1].props).toHaveProperty('label', '开关');
    expect(current.services[0].properties[0].valueList?.[0]).toEqual({ value: 10, description: 'Low' });
    expect(specTranslation(i18n, 'service:009:property:007', 'zh')).toBe('开关状态');
    expect(specTranslation(i18n, 'service:009:property:007', 'xx')).toBe('开关状态');
  });

  it('gives official custom titles precedence over model translations and rejects mismatched translations', () => {
    const i18n: Json = { zh_cn: { 'service:009:property:007': '模型翻译' } };
    expect(compilePanelDocument({ device, panel: panel(), resources: resource([entry(7, '配置标题')], { i18n }) }).items[0].props).toHaveProperty('label', '配置标题');
    const doc = compilePanelDocument({ device, panel: panel(), resources: resource([], { did: 'other', i18n }), includeModelFallback: true });
    expect(flatten(doc.items)[0].props).toHaveProperty('label', '开关');
  });

  it('localizes action and input labels separately while preserving real action input IDs', () => {
    const current = panel([property(7, { format: 'string', name: 'text', description: 'Text' })]);
    current.services[0].actions = [{ siid: 9, aiid: 6, name: 'play', description: 'Play', in: [7], out: [] }];
    const i18n: Json = { zh_cn: { 'service:009:property:007': '文本内容', 'service:009:action:006': '播放' } };
    const doc = compilePanelDocument({ device, panel: current, resources: resource([], { i18n }), includeModelFallback: true });
    expect(flatten(doc.items).find(node => node.name === 'Action')?.props).toMatchObject({ label: '播放', inputLabels: { 7: '文本内容' }, siid: 9, aiid: 6 });
    expect(current.services[0].actions[0].in).toEqual([7]);
  });

  for (const [name, fixture] of Object.entries({ air, water, humidifier, vacuum })) it(`compiles the actual published ${name} model beyond the current account, without claiming hardware validation`, () => {
    const current = fixture as DevicePanel;
    const item = { ...device, did: current.did, model: current.model };
    const doc = compilePanelDocument({ device: item, panel: current, includeModelFallback: true });
    const exposed = current.services.filter(service => service.name !== 'device-information').flatMap(service => service.properties).some(property => property.access.includes('read') || property.access.includes('write')) || current.services.some(service => service.actions.length);
    if (exposed) expect(doc.items.length).toBeGreaterThan(0);
    else expect(doc.items).toEqual([]); // Real humidifier model declares no read/write access: no fake controls.
    for (const node of flatten(doc.items)) if ('binding' in node.props) expect(resolveComponentProperty(current, node.props.binding)).toBeDefined();
    for (const service of current.services) for (const action of service.actions) expect(flatten(doc.items)).toContainEqual(expect.objectContaining({ name: 'Action', props: expect.objectContaining({ siid: service.siid, aiid: action.aiid }) }));
  });
});
