#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadUserConfig } from '../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-artifact-write-concurrency-'));
const configPath = path.join(tempRoot, '.pairofcleats.json');

const writeConfig = async (value) => {
  await fs.writeFile(
    configPath,
    JSON.stringify({ indexing: { artifacts: { writeConcurrency: value } } }, null, 2),
    'utf8'
  );
};

try {
  await writeConfig(8);
  const valid = loadUserConfig(tempRoot);
  assert.equal(valid?.indexing?.artifacts?.writeConcurrency, 8, 'expected valid writeConcurrency to load');

  const invalidValues = [0, 33, 1.5, 'many'];
  for (const value of invalidValues) {
    await writeConfig(value);
    let failed = false;
    try {
      loadUserConfig(tempRoot);
    } catch (err) {
      failed = true;
      const message = String(err?.message || '');
      assert.ok(
        message.includes('writeConcurrency'),
        `expected config error to mention writeConcurrency for value=${JSON.stringify(value)}`
      );
    }
    assert.equal(failed, true, `expected invalid writeConcurrency value to be rejected: ${JSON.stringify(value)}`);
  }
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('artifact write concurrency config validation test passed');
