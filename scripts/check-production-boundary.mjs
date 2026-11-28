import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const markers = [
  'developer_catalog_', 'developer_component_library_open', 'developer-preview:',
  'developer-mode-entry', 'account-developer-mode', 'component-library',
  'public-preview-specs.rs', '开发者模式', '设备组件库',
  'previewScaleChange', 'playPreviewLive', 'previewWasherDefault', 'vacuum-map-example',
  'simulated_seating', 'removeRecords', 'pub(super) fn preview(config: &ConfigBundle',
];
const developerPath = /^(?:component-library\/|src\/component-library\/|src\/assets\/developer\/|src\/(?:ui\/)?developer-[^/]+|src\/fixtures\/scale-preview\.ts$|src-tauri\/src\/developer[-_][^/]+|scripts\/check-(?:developer-mode|component-library)\.mjs$|vite\.library\.config\.ts$)/;
const source = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);

function assertClean(file) {
  const contents = readFileSync(file);
  for (const marker of markers) assert.ok(!contents.includes(marker), `${file} contains ${marker}`);
}

for (const file of source) {
  assert.ok(!developerPath.test(file), `Development feature in production: ${file}`);
  if (/^(?:src\/|src-tauri\/src\/).*\.(?:rs|ts|css)$/.test(file) && !file.endsWith('.test.ts')) assertClean(file);
}
for (const file of ['package.json', 'vite.config.ts', 'src-tauri/tauri.conf.json', 'src-tauri/build.rs', '.github/workflows/ci.yml', 'README.md', 'CHANGELOG.md', 'docs/DEVICE_COVERAGE.md']) assertClean(file);

function checkBundle(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    assert.ok(!/developer[-_.]|component-library/i.test(entry.name), `Development asset in production: ${file}`);
    if (entry.isDirectory()) checkBundle(file);
    else if (/\.(?:html|js|css|json|map)$/i.test(entry.name)) assertClean(file);
  }
}

const args = process.argv.slice(2);
if (args.includes('--dist')) {
  assert.ok(lstatSync(join('dist', 'index.html')).isFile(), 'Missing production frontend');
  assert.ok(lstatSync(join('dist', 'widget.html')).isFile(), 'Missing production desktop cards');
  if (source.includes('monitor.html')) {
    assert.ok(lstatSync(join('dist', 'monitor.html')).isFile(), 'Missing production monitor window');
  }
  checkBundle('dist');
}
const binary = args.indexOf('--binary');
if (binary !== -1) {
  assert.ok(args[binary + 1], 'Expected a compiled executable path');
  assertClean(args[binary + 1]);
}
console.log('Production boundary verified.');
