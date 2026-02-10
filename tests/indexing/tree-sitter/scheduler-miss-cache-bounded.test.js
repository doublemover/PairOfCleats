#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createTreeSitterSchedulerLookup } from '../../../src/index/build/tree-sitter-scheduler/lookup.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-scheduler-miss-cache-'));
applyTestEnv({ cacheRoot: tempRoot });

const outDir = path.join(tempRoot, 'out');
await fs.mkdir(outDir, { recursive: true });

const lookup = createTreeSitterSchedulerLookup({
  outDir,
  index: new Map(),
  maxMissCacheEntries: 3
});

const missingPaths = ['a.js', 'b.js', 'c.js', 'd.js', 'e.js'];
for (const virtualPath of missingPaths) {
  const row = await lookup.loadRow(virtualPath);
  assert.equal(row, null, `expected missing row for ${virtualPath}`);
}

const stats = lookup.stats();
assert.ok(stats.missEntries <= 3, `expected bounded miss cache, got ${stats.missEntries}`);

const repeatMiss = await lookup.loadRow('a.js');
assert.equal(repeatMiss, null, 'expected repeated misses to remain safe');

console.log('scheduler miss cache bounded test passed');
