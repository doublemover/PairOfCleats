#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsonGateHarness } from '../helpers/json-gate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const harness = await createJsonGateHarness({
  rootDir: ROOT,
  scriptRelativePath: path.join('tools', 'ci', 'capability-gate.js'),
  tempPrefix: 'pairofcleats-cap-',
  jsonFileName: 'capabilities.json'
});

const result = harness.run(['--mode', 'ci'], { label: 'capability gate smoke test' });
if (result.status !== 0) process.exit(result.status ?? 1);

const payload = await harness.readPayload().catch(() => {
  console.error('capability gate did not write valid JSON');
  process.exit(1);
});

const expectedTopLevel = ['mode', 'timestamp', 'capabilities', 'probes'];
for (const key of expectedTopLevel) {
  if (!(key in payload)) {
    console.error(`capability gate JSON missing key: ${key}`);
    process.exit(1);
  }
}

const expectedProbes = ['sqlite', 'lmdb', 'hnsw', 'lancedb'];
for (const name of expectedProbes) {
  if (!(name in payload.probes)) {
    console.error(`capability gate JSON missing probe: ${name}`);
    process.exit(1);
  }
}

console.log('capability gate smoke test passed');
await harness.cleanup();
