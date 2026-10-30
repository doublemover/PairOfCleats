#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverFiles } from '../../../src/index/build/discover.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

// Keep the historical test ID; assert accepted-file semantics independently of the former crawler API.
applyTestEnv({ testing: '1' });
const root = resolveTestCachePath(process.cwd(), 'discover-max-files-no-raw-cap');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
try {
  for (let index = 0; index < 6; index += 1) await fs.writeFile(path.join(root, `a-${index}.js`), 'x'.repeat(256));
  await fs.writeFile(path.join(root, 'z-good.js'), 'x');
  const { ignoreMatcher } = await buildIgnoreMatcher({ root, userConfig: {} });
  const metrics = {};
  const skipped = [];
  const entries = await discoverFiles({ root, mode: 'code', ignoreMatcher, skippedFiles: skipped, maxFileBytes: 32, maxFiles: 1, metrics });
  assert.deepEqual(entries.map(entry => entry.rel), ['z-good.js']);
  assert.equal(skipped.filter(entry => entry.reason === 'oversize').length, 6);
  assert.equal(metrics.candidates, 7, 'raw rejection candidates never consume accepted capacity');
  assert.equal(metrics.candidateHighWater, 1);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('discover accepted maxFiles without raw candidate cap passed');
