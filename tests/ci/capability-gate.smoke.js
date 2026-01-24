#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const gatePath = path.join(ROOT, 'tools', 'ci', 'capability-gate.js');

const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-cap-'));
const jsonPath = path.join(tmpDir, 'capabilities.json');

const result = spawnSync(process.execPath, [gatePath, '--mode', 'pr', '--json', jsonPath], {
  encoding: 'utf8'
});

if (result.status !== 0) {
  console.error('capability gate smoke test failed');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(await fsPromises.readFile(jsonPath, 'utf8'));
} catch (error) {
  console.error('capability gate did not write valid JSON');
  process.exit(1);
}

const expectedTopLevel = ['mode', 'timestamp', 'capabilities', 'probes'];
for (const key of expectedTopLevel) {
  if (!(key in payload)) {
    console.error(`capability gate JSON missing key: ${key}`);
    process.exit(1);
  }
}

const expectedProbes = ['sqlite', 'lmdb', 'hnsw', 'tantivy', 'lancedb'];
for (const name of expectedProbes) {
  if (!(name in payload.probes)) {
    console.error(`capability gate JSON missing probe: ${name}`);
    process.exit(1);
  }
}

console.log('capability gate smoke test passed');
