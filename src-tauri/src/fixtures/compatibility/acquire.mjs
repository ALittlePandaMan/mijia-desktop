// Maintainer helper: collect public MIoT metadata; never authenticate or invoke a device.
// Does not run as part of the product or ordinary test suite.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../../..');
const cache = path.join(process.env.LOCALAPPDATA ?? '', 'io.mijiadesktop.client/public-spec-v1');
const inventoryPath = path.join(root, 'research/evidence/remaining-device-ui-inventory.json');
const observed = JSON.parse(fs.readFileSync(inventoryPath));
const accountModels = new Set(observed.models.map(row => row.model));
const priorManifestPath = path.join(directory, 'provenance.json');
const priorManifest = fs.existsSync(priorManifestPath) ? JSON.parse(fs.readFileSync(priorManifestPath)) : { records: [] };
const envelopes = fs.readdirSync(cache).filter(file => file.endsWith('.json'))
  .flatMap(file => { try { return [JSON.parse(fs.readFileSync(path.join(cache, file)))]; } catch { return []; } });
const registry = envelopes.find(entry => entry.key === 'instances-released-v1');
if (!registry?.value?.instances?.length) throw new Error('No public released registry cache available');
const category = type => type.split(':')[3];
const latest = new Map();
for (const row of registry.value.instances) {
  if (row.status !== 'released') continue;
  if (!latest.has(row.model) || Number(latest.get(row.model).version) <= Number(row.version)) latest.set(row.model, row);
}
// Model identifiers selected from released registry rows, not synthesized variants.
const selections = {
  switch: ['lumi.ctrl_ln2.aq1', 'yeelink.switch.sw1'],
  outlet: ['cuco.plug.cp1', 'chuangmi.plug.212a01'],
  light: ['yeelink.light.bslamp2', 'philips.light.bceil'],
  fan: ['dmaker.fan.1c', 'zhimi.fan.za1'],
  'air-conditioner': ['xiaomi.airc.1r04r1', 'viomi.airc.m1'],
  curtain: ['lumi.curtain.acn002', 'dooya.curtain.230x5'],
  'temperature-humidity-sensor': ['miaomiaoce.sensor_ht.t1', 'cleargrass.sensor_ht.dk1', 'xiaomi.sensor_ht.minigl'],
  fridge: ['viomi.fridge.b1', 'minij.fridge.448w'],
  washer: ['viomi.washer.s1', 'minij.washer.v1'],
  airer: ['hyd.airer.1s1', 'dooya.airer.2m'],
  'water-purifier': ['bj352.waterpuri.k10', 'dmaker.waterpuri.600g'],
  'water-dispenser': ['chunmi.ysj.tsa1', 'yunmi.plmachine.mg2'],
  router: ['xiaomi.router.cr5508', 'isa.router.mr01hl'],
  'ir-remote-control': ['bymiot.ir.wlv1'],
  'air-purifier': ['1245.airpurifier.dl01', 'zhimi.airpurifier.ma2'],
  humidifier: ['als1.humidifier.js03', 'deerma.humidifier.jsq'],
  dehumidifier: ['dmaker.derh.22l', 'deye.derh.612s'],
  'air-fresh': ['dmaker.airfresh.a1', 'zhimi.airfresh.va2'],
  vacuum: ['360sdj.vacuum.s', 'dreame.vacuum.ma1808'],
  camera: ['chuangmi.camera.019e04', 'lumi.camera.aq1'],
  speaker: ['xiaomi.wifispeaker.l04m', 'onemore.wifispeaker.sm4'],
  television: ['xiaomi.tv.4kh1', 'orvibo.tv.ltv1'],
  projector: ['fengmi.projector.015fc2', 'gimi.projector.fm01'],
  'air-fryer': ['careli.fryer.maf01', 'viomi.fryer.v2'],
  'occupancy-sensor': ['linp.sensor_occupy.es2', 'xiaomi.sensor_occupy.p1'],
  'magnet-sensor': ['cgllc.magnet.hodor', 'lumi.magnet.acn001'],
  'gas-sensor': ['lumi.sensor_gas.acn02', 'bkxh.sensor_gas.s2'],
  'smoke-sensor': ['lumi.sensor_smoke.acn01', 'bkxh.sensor_smoke.s1'],
  scale: ['yunmai.scales.ms104', 'xiaomi.scales.ms110'],
  'bath-heater': ['yeelink.bhf_light.v1', 'aupu.bhf_light.360ap'],
  'ceiling-fan': ['yeelink.ven_fan.vf1', 'opple.ven_fan.liba'],
  sphygmomanometer: ['ihealth.bp.bpm1'],
  stb: ['heiman.stb.rc1', 'coolki.stb.yk0001'],
  'air-condition-outlet': ['lumi.acpartner.mcn04', 'cuco.acpartner.ap2a'],
  'video-doorbell': ['chuangmi.cateye.ipc018', 'loock.cateye.v01'],
  'control-panel': ['xiaomi.controller.oh10p', 'yeelink.controller.v2'],
  relay: ['lumi.relay.c2acn01', 'pwzn.relay.apple'],
  'roller-shutter': ['shuse.roller.sr01'],
};

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const jobs = Object.entries(selections).flatMap(([expectedCategory, models]) => models.map(model => {
  const row = latest.get(model);
  if (!row) throw new Error(`Selected model missing from released registry: ${model}`);
  if (category(row.type) !== expectedCategory) throw new Error(`Wrong category: ${model} ${row.type}`);
  if (accountModels.has(model)) throw new Error(`Expected an absent account model: ${model}`);
  return { expectedCategory, row };
}));
const results = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const { expectedCategory, row } = jobs[next++];
    const url = `https://miot-spec.org/miot-spec-v2/instance?type=${encodeURIComponent(row.type)}`;
    const local = envelopes.find(entry => entry.key === `instance:${row.type}`);
    let value, source;
    const prior = priorManifest.records.find(record => record.model === row.model && record.type === row.type);
    const priorPath = prior && path.join(directory, prior.file);
    if (priorPath && fs.existsSync(priorPath) && hash(fs.readFileSync(priorPath)) === prior.sha256) {
      value = JSON.parse(fs.readFileSync(priorPath));
      source = { kind: prior.source.kind, retrievedAt: prior.source.retrievedAt };
    }
    else if (local) { value = local.value; source = { kind: 'existing-public-metadata-cache', retrievedAt: new Date(local.fetched_at * 1000).toISOString() }; }
    else {
      let response;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          response = await fetch(url, { signal: AbortSignal.timeout(20000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          value = await response.json();
          break;
        } catch (error) { if (attempt === 2) throw new Error(`${row.model}: ${error.message}`); }
      }
      source = { kind: 'public-miot-instance-endpoint', retrievedAt: new Date().toISOString() };
    }
    if (value?.type !== row.type || !Array.isArray(value.services) || !value.services.length) throw new Error(`Invalid descriptor for ${row.model}`);
    const file = `${expectedCategory}--${row.model}.json`;
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    fs.writeFileSync(path.join(directory, file), bytes);
    const serviceNames = value.services.map(service => service.type.split(':')[3]);
    const properties = value.services.flatMap(service => (service.properties ?? []).map(property => ({
      service: service.type.split(':')[3], siid: service.iid, name: property.type.split(':')[3], piid: property.iid,
      format: property.format, access: property.access, unit: property.unit ?? null,
      ...(property['value-range'] ? { valueRange: property['value-range'] } : {}),
      ...(property['value-list'] ? { valueList: property['value-list'] } : {}),
    })));
    results.push({
      model: row.model, category: expectedCategory, manufacturerPrefix: row.model.split('.')[0], file,
      type: row.type, registryRow: row, source: { url, ...source }, sha256: hash(bytes),
      notInObservedAccountInventory: true, physicalDeviceVerified: false,
      verificationScope: ['router', 'ir-remote-control', 'stb'].includes(expectedCategory) ? 'published-descriptor-only-private-protocol' : 'public-description-and-standard-capability-contract',
      serviceNames, properties: properties.length, actions: value.services.reduce((total, service) => total + (service.actions?.length ?? 0), 0),
      bindings: properties.map(({ service, siid, name, piid, format, access, unit }) => ({ service, siid, name, piid, format, access, unit })),
    });
    console.log(`${results.length}/${jobs.length} ${expectedCategory} ${row.model} ${properties.length} properties`);
  }
}
await Promise.all([worker(), worker(), worker()]);
results.sort((a, b) => a.category.localeCompare(b.category) || a.model.localeCompare(b.model));
fs.writeFileSync(path.join(directory, 'provenance.json'), JSON.stringify({
  schemaVersion: 1, collectedAt: new Date().toISOString(),
  scope: 'Public released MIoT instance descriptions; no credentials, account/device identifiers, values, or physical control.',
  registry: { url: 'https://miot-spec.org/miot-spec-v2/instances?status=released', retrievedAt: new Date(registry.fetched_at * 1000).toISOString(), records: registry.value.instances.length },
  inventoryComparison: { source: 'research/evidence/remaining-device-ui-inventory.json', checkedAt: observed.checkedAt, uniqueModels: accountModels.size, limitation: 'Absence compared only with this observed inventory; this is not a claim about future/current inventory changes.' },
  licensing: 'Factual public interoperability descriptors retained for reproducible compatibility tests with source URLs and hashes. No APK/plugin implementation, images, fonts, or credentials are included. Availability of the endpoint does not imply an upstream software license grant.',
  limitations: [
    'Manufacturer prefixes identify registry namespaces; different prefixes are not proof of different legal manufacturers.',
    'A published descriptor proves property/action structure, not device reachability, history availability, or successful physical writes.',
    'Private router/IR protocols are not inferred from a standard descriptor. These fixtures must not enable generic private network/remote functions.',
    'Existing UI category reuse requires matching standard services, formats, access, units and enumeration/range support. Missing optional features remain absent.',
  ],
  records: results,
}, null, 2) + '\n');
console.log(JSON.stringify({ models: results.length, categories: Object.keys(selections).length, writesToDevices: 0 }));
