#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { touchCasObject, writeCasObject } from '../../../src/shared/cache-cas.js';

applyTestEnv();

const root = process.cwd();
const toolPath = path.join(root, 'tools', 'index', 'cache-gc.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-cache-gc-access-'));
const cacheRoot = path.join(tempRoot, 'cache');
await fs.mkdir(cacheRoot, { recursive: true });

const oldCreatedAt = '2020-01-01T00:00:00.000Z';
const recentlyTouchedAt = Date.now();

const recentlyAccessed = await writeCasObject({
  cacheRoot,
  content: Buffer.from('recently-accessed-object', 'utf8'),
  now: oldCreatedAt
});
await touchCasObject(cacheRoot, recentlyAccessed.hash, recentlyTouchedAt);

const stale = await writeCasObject({
  cacheRoot,
  content: Buffer.from('stale-object', 'utf8'),
  now: oldCreatedAt
});

const run = spawnSync(
  process.execPath,
  [
    toolPath,
    '--dry-run',
    '--json',
    '--cache-root',
    cacheRoot,
    '--grace-days',
    '30'
  ],
  {
    encoding: 'utf8',
    env: { ...process.env }
  }
);

assert.equal(run.status, 0, run.stderr || run.stdout);
const payload = JSON.parse(run.stdout);
const candidateHashes = payload.candidates.map((entry) => entry.hash);

assert.ok(
  candidateHashes.includes(stale.hash),
  'stale object should be a delete candidate'
);
assert.ok(
  !candidateHashes.includes(recentlyAccessed.hash),
  'recently accessed object should not be a delete candidate even when created long ago'
);

console.log('cache gc preserves recent access test passed');
