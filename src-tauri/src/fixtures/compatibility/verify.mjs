// Offline integrity check for pinned public interoperability fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'provenance.json')));
const required = ['switch', 'outlet', 'light', 'fan', 'air-conditioner', 'curtain', 'temperature-humidity-sensor',
  'fridge', 'washer', 'airer', 'water-purifier', 'water-dispenser', 'router', 'ir-remote-control',
  'air-purifier', 'humidifier', 'dehumidifier', 'air-fresh', 'vacuum', 'camera', 'speaker', 'television',
  'projector', 'air-fryer', 'occupancy-sensor', 'magnet-sensor', 'gas-sensor', 'smoke-sensor', 'scale',
  'bath-heater', 'ceiling-fan', 'sphygmomanometer', 'stb', 'air-condition-outlet', 'video-doorbell',
  'control-panel', 'relay', 'roller-shutter'];
const category = type => type.split(':')[3];
const seen = new Set();
let propertyCount = 0, actionCount = 0;
const statistics = [];
for (const row of manifest.records) {
  assert(!seen.has(row.model), `Duplicate model ${row.model}`);
  seen.add(row.model);
  assert.equal(row.registryRow.model, row.model);
  assert.equal(row.registryRow.type, row.type);
  assert.equal(row.registryRow.status, 'released');
  assert.equal(row.manufacturerPrefix, row.model.split('.')[0]);
  assert.equal(row.notInObservedAccountInventory, true);
  assert.equal(row.physicalDeviceVerified, false);
  assert.equal(category(row.type), row.category);
  assert.equal(new URL(row.source.url).origin, 'https://miot-spec.org');
  assert.equal(new URL(row.source.url).searchParams.get('type'), row.type);
  assert.equal(row.file, `${row.category}--${row.model}.json`);
  const bytes = fs.readFileSync(path.join(directory, row.file));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.sha256, row.file);
  const instance = JSON.parse(bytes);
  assert.equal(instance.type, row.type);
  assert(Array.isArray(instance.services) && instance.services.length);
  const serviceIds = new Set();
  const bindings = [];
  for (const service of instance.services) {
    assert(Number.isInteger(service.iid) && service.iid > 0);
    assert(!serviceIds.has(service.iid));
    serviceIds.add(service.iid);
    const propertyIds = new Set();
    for (const property of service.properties ?? []) {
      assert(Number.isInteger(property.iid) && property.iid > 0);
      assert(!propertyIds.has(property.iid));
      propertyIds.add(property.iid);
      assert(Array.isArray(property.access));
      assert(!Object.hasOwn(property, 'value'), 'A public fixture cannot contain live property values');
      assert(!Object.hasOwn(property, 'lastReported'));
      bindings.push({ service: category(service.type), siid: service.iid, name: category(property.type),
        piid: property.iid, format: property.format, access: property.access, unit: property.unit ?? null });
    }
    const actionIds = new Set();
    for (const action of service.actions ?? []) {
      assert(Number.isInteger(action.iid) && action.iid > 0);
      assert(!actionIds.has(action.iid));
      actionIds.add(action.iid);
      for (const input of action.in ?? []) assert(propertyIds.has(input), `${row.model} missing action input property ${input}`);
      actionCount++;
    }
  }
  assert.deepEqual(bindings, row.bindings, `Provenance bindings diverged from untouched fixture ${row.model}`);
  assert.equal(bindings.length, row.properties);
  propertyCount += bindings.length;
}
for (const name of required) {
  const rows = manifest.records.filter(row => row.category === name);
  assert(rows.length > 0, `Uncovered category ${name}`);
  const prefixes = [...new Set(rows.map(row => row.manufacturerPrefix))].sort();
  if (!['ir-remote-control', 'sphygmomanometer', 'roller-shutter'].includes(name)) assert(prefixes.length >= 2, `Cross-prefix coverage missing ${name}`);
  statistics.push({ category: name, models: rows.length, manufacturerPrefixes: prefixes,
    physicallyVerified: 0, scope: rows[0].verificationScope });
}
const mainServiceVariation = new Map();
for (const row of manifest.records) {
  for (const binding of row.bindings.filter(binding => binding.name === 'on' && binding.format === 'bool')) {
    mainServiceVariation.set(`${binding.siid}.${binding.piid}`, true);
  }
}
assert(mainServiceVariation.size > 5, 'Fixtures must exercise actual ID differences, not model string substitutions');
const report = { passed: true, categories: required.length, models: manifest.records.length,
  properties: propertyCount, actions: actionCount, distinctBooleanPowerBindings: [...mainServiceVariation.keys()].sort(),
  allRawHashesMatch: true, allRegistryRowsReleasedAndMatchDescriptor: true,
  allFixturesHaveNoLiveValues: true, nativeIpcCalls: 0, networkCalls: 0, physicalDeviceWrites: 0,
  physicalDeviceCompatibilityClaimed: false, statistics };
if (process.argv.includes('--report')) fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
