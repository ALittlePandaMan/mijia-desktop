import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {distributionDocuments, copyDistributionFiles} from './distribution-files.mjs';

test('installer and portable share the exact public document list', () => {
  const resources = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8')).bundle.resources;
  assert.deepEqual(Object.keys(resources).sort(), [...distributionDocuments.map(name => '../' + name), '../licenses/', 'media-decoder/'].sort());
  for (const name of distributionDocuments) {
    assert.equal(fs.statSync(name).isFile(), true, name);
    assert.equal(resources['../' + name], name);
  }
});

test('copy distributes allowlisted documents and license bytes without development records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mijia-distribution-'));
  try {
    const source = path.join(root, 'source'), output = path.join(root, 'output');
    for (const name of distributionDocuments) {
      fs.mkdirSync(path.dirname(path.join(source, name)), {recursive: true});
      fs.writeFileSync(path.join(source, name), 'public:' + name);
    }
    fs.mkdirSync(path.join(source, 'licenses'), {recursive: true});
    fs.writeFileSync(path.join(source, 'licenses', 'NOTICE'), Buffer.from([0, 13, 10, 255]));
    fs.writeFileSync(path.join(source, 'docs', 'PRIVATE_REVIEW.md'), 'not distributed');
    copyDistributionFiles(output, source);
    for (const name of distributionDocuments) assert.equal(fs.readFileSync(path.join(output, name), 'utf8'), 'public:' + name);
    assert.equal(fs.existsSync(path.join(output, 'docs', 'PRIVATE_REVIEW.md')), false);
    assert.deepEqual(fs.readFileSync(path.join(output, 'licenses', 'NOTICE')), Buffer.from([0, 13, 10, 255]));
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
